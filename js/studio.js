/**
 * PianoWorks AI Engine - True ONNX Jazz Intelligence [Total Timeline Synchronization Edition]
 * (時間軸の秒単位ズレを完全修正し、ユーザーが刻んだ秒数のまま曲全体の時計と伴奏を完全追従させる決定版)
 */
import { THEORY } from './utils.js';

let musicSession = null;
let lastKvCache = {};
let lastHiddenTensor = null;
let confirmedShapeCandidate = null; 

export async function loadMusicModel() {
    try {
        if (window.ort) {
            musicSession = await window.ort.InferenceSession.create('model_token.onnx');
        } else {
            musicSession = { dummy: true, outputNames: ['logits'] };
        }
        return true;
    } catch (e) {
        musicSession = { dummy: true, outputNames: ['logits'] };
        return false;
    }
}

/**
 * 推論実行（曲の全体をユーザーのタイムラインに完全同期・安全秒数ベース）
 */
export async function runInference(inputTokens, context = {}) {
    if (!inputTokens || inputTokens.length === 0) return [];

    // ★ ジャンルごとの演奏パラメータ（コードの響きだけでなく、スウィング・音域・強弱・和音密度も変える）
    const genre = context.genre || 'jazz';
    const GENRE_PARAMS = {
        jazz: {
            swing: 0.62,           // 拍の長短比（大きいほどスウィング感が強い）
            octaveRange: [50, 82], // 使用する音域（MIDIノート番号）
            velocityBase: 0.54, velocityHumanBase: 0.68, velocityJitter: 0.06,
            chordEvery: 4          // 何ステップに1回、AI由来の和音を鳴らすか
        },
        anison: {
            swing: 0.5,            // ストレート（アニソン／ポップらしい均等な8分）
            octaveRange: [60, 88], // 明るく高めの音域
            velocityBase: 0.62, velocityHumanBase: 0.74, velocityJitter: 0.03,
            chordEvery: 3
        },
        classic: {
            swing: 0.52,           // ほぼ均等（クラシックらしい端正なリズム）
            octaveRange: [48, 76], // 落ち着いた中音域中心
            velocityBase: 0.46, velocityHumanBase: 0.58, velocityJitter: 0.02,
            chordEvery: 6
        }
    };
    const genreParams = GENRE_PARAMS[genre] || GENRE_PARAMS.jazz;

    const dynamicBpm = Math.min(170, Math.max(60, context.baseBpm || 105));
    let noteLengthMode = dynamicBpm >= 125 ? '16th' : '8th';
    
    // 🌟 基準となる1ステップの長さを「秒（seconds）」で計算 (例: 120BPMの8分音符なら 0.25秒)
    const quarterNoteSec = 60 / dynamicBpm;
    const defaultStepDurationSec = quarterNoteSec / ((noteLengthMode === '16th') ? 4 : 2);
    
    // 🌟 再生開始の初期遅延マージン（秒単位: 0.05秒）
    let timeAccumulator = 0.05; 
    let generatedNotes = [];

    const numToGenerate = dynamicBpm >= 125 ? 28 : 20;
    const currentKey = context.key || "C";
    const currentScale = context.scale || "major";
    const availableMidis = THEORY.getAvailableMidis(currentKey, currentScale);

    // ユーザーの入力フレーズ（音階 ＋ タイムスタンプのセット）
    const humanNotes = inputTokens.filter(t => t && t.note);
    let humanPlacementStart = -1;

    if (humanNotes.length > 0) {
        const maxStartIndex = numToGenerate - humanNotes.length;
        humanPlacementStart = maxStartIndex > 1 ? Math.floor(Math.random() * (maxStartIndex - 1)) + 1 : 0;
        console.log(`🎯 AI Engine: 曲全体の時計をユーザーのリズムに完全同期します。[開始ステップ: ${humanPlacementStart}]`);
    }

    let contextMidiHistory = inputTokens.map(t => THEORY.noteToMidi(t.note));
    let lastMidi = contextMidiHistory[contextMidiHistory.length - 1] || 62; 

    if (!lastHiddenTensor) {
        lastHiddenTensor = new ort.Tensor('float32', new Float32Array(1024), [1, 1024]);
    }

    const shapeCandidates = [[1, 4, 0, 64], [1, 8, 0, 32], [4, 0, 64], [1, 1, 0, 1024]];
    let currentShapeIdx = 0;
    let onnxFailedCompletely = false;

    // ── 音楽生成メインループ ──
    for (let i = 0; i < numToGenerate; i++) {
        const progress = i / numToGenerate;
        const isEvenStep = (i % 2 === 0);
        
        let predictedMidi = lastMidi;
        let isHumanOrigin = false;
        
        // 🌟 デフォルトのステップ時間（秒）★ ジャンルごとのスウィング比率を適用
        let currentStepDurationSec = defaultStepDurationSec * (isEvenStep ? genreParams.swing : (1 - genreParams.swing));

        // 🌟 ユーザーモチーフ注入区間の判定
        if (humanPlacementStart !== -1 && i >= humanPlacementStart && i < humanPlacementStart + humanNotes.length) {
            const humanIndex = i - humanPlacementStart;
            const currentHumanNote = humanNotes[humanIndex];
            
            predictedMidi = THEORY.noteToMidi(currentHumanNote.note);
            isHumanOrigin = true;
            
            // 🌟【完全同期の修正】ユーザーが実際に弾いた時の「前の音からの経過秒数」を割り出す
            if (humanIndex > 0) {
                const prevHumanNote = humanNotes[humanIndex - 1];
                const diffSec = currentHumanNote.time - prevHumanNote.time;
                
                // 異常値（同時押し、または2秒以上の極端な間隔）でなければ、その秒数そのものを全体の時計の進み幅にする
                if (diffSec > 0.04 && diffSec < 2.0) {
                    currentStepDurationSec = diffSec;
                }
            }
        }

        // AIの自動推論処理
        if (!isHumanOrigin) {
            if (musicSession && !musicSession.dummy && !onnxFailedCompletely) {
                try {
                    const slicedHistory = contextMidiHistory.slice(-16); 
                    const int64History = new BigInt64Array(slicedHistory.map(num => BigInt(num)));
                    const tensorIn = new ort.Tensor('int64', int64History, [1, int64History.length]);
                    let results = null;

                    if (confirmedShapeCandidate) {
                        const feeds = { x: tensorIn, hidden: lastHiddenTensor };
                        results = await musicSession.run(feeds);
                    } else {
                        while (!results && currentShapeIdx < shapeCandidates.length) {
                            const feeds = { x: tensorIn, hidden: lastHiddenTensor };
                            try {
                                results = await musicSession.run(feeds);
                                confirmedShapeCandidate = shapeCandidates[currentShapeIdx]; 
                            } catch (err) { currentShapeIdx++; }
                        }
                        if (!results) onnxFailedCompletely = true;
                    }

                    if (results) {
                        const logitsTensor = results.logits || results.output || results[Object.keys(results)[0]];
                        const logits = logitsTensor.data;
                        if (results.hidden) lastHiddenTensor = results.hidden;

                        const temp = 0.7;
                        let maxIdx = 60;
                        let maxLogit = -Infinity;
                        
                        availableMidis.forEach(midi => {
                            let logit = logits[midi] / temp;
                            const distance = Math.abs(midi - lastMidi);
                            if (distance > 6) logit -= (distance - 6) * 2.5;
                            if (logit > maxLogit) { maxLogit = logit; maxIdx = midi; }
                        });
                        predictedMidi = maxIdx;
                    }
                } catch (e) { onnxFailedCompletely = true; }
            }
            if (!musicSession || musicSession.dummy || onnxFailedCompletely) {
                predictedMidi = lastMidi + [-1, 0, 1, 2, -2][Math.floor(Math.random() * 5)];
            }
        }

        // ピッチの確定
        let targetMidi = predictedMidi;
        if (!isHumanOrigin) {
            targetMidi = availableMidis.reduce((prev, curr) => Math.abs(curr - predictedMidi) < Math.abs(prev - predictedMidi) ? curr : prev);
            // ★ ジャンルごとの音域に収める（アニソンは明るく高め、クラシックは中音域中心、ジャズは広め）
            const [octMin, octMax] = genreParams.octaveRange;
            while (targetMidi < octMin) targetMidi += 12;
            while (targetMidi > octMax) targetMidi -= 12;
        }

        lastMidi = targetMidi;
        contextMidiHistory.push(lastMidi);

        // 🌟 確定した「秒数」の分だけ全体のタイムラインを進める（ミリ秒を掛け算して再生エンジンに渡す）
        timeAccumulator += currentStepDurationSec;
        const finalTimeOffsetMs = timeAccumulator * 1000; // 👈 再生エンジンが期待するミリ秒単位へここで安全変換

        // コード（伴奏）の追加 ★ ジャンルごとに和音を鳴らす頻度を変える
        let playChord = isHumanOrigin ? true : (i % genreParams.chordEvery === 2 % genreParams.chordEvery);

        // ★ ドロップダウンで選んだ風味（jazz / anison / classic）ごとに伴奏のコード構成を変える
        const CHORD_VOICINGS = {
            // jazz: 7th中心の、少し複雑で洒落た響き（既存のデフォルト）
            jazz: {
                ai: [[0, 4, 7, 11], [2, 5, 9, 12], [7, 11, 14, 17]],
                human: [3, 7, 10, 14]
            },
            // anison: 三和音＋9th中心の、明るくポップな響き
            anison: {
                ai: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [9, 12, 16]],
                human: [4, 7, 11]
            },
            // classic: シンプルな三和音中心の、清潔で落ち着いた響き
            classic: {
                ai: [[0, 4, 7], [0, 3, 7], [5, 8, 12], [7, 10, 14]],
                human: [4, 7]
            }
        };
        const voicing = CHORD_VOICINGS[genre] || CHORD_VOICINGS.jazz;

        const chordIdx = Math.floor(progress * voicing.ai.length) % voicing.ai.length;
        let currentVoice = isHumanOrigin ? voicing.human : voicing.ai[chordIdx];

        // ★ ジャンルごとの強弱の特徴（アニソン＝明るく強め／クラシック＝均一で控えめ／ジャズ＝ジッターでアクセント強調）
        const baseVel = isHumanOrigin ? genreParams.velocityHumanBase : genreParams.velocityBase;
        let finalVelocity = Math.max(0.30, Math.min(0.80,
            baseVel + (Math.random() * genreParams.velocityJitter * 2 - genreParams.velocityJitter)
        ));

        if (playChord) {
            currentVoice.forEach((interval) => {
                let chordMidi = (Math.floor(targetMidi / 12) * 12) - 12 + interval;
                if (chordMidi >= 42 && chordMidi <= 68) { 
                    generatedNotes.push({
                        note: THEORY.midiToNote(chordMidi).replace('#', 's'),
                        velocity: finalVelocity * 0.55, 
                        timeOffset: finalTimeOffsetMs // 👈 ユーザーの間隔と完全に一致した伴奏タイミング
                    });
                }
            });
        }

        // メイン音符の追加
        generatedNotes.push({
            note: THEORY.midiToNote(targetMidi).replace('#', 's'),
            velocity: finalVelocity,
            timeOffset: finalTimeOffsetMs // 👈 ユーザーの間隔と完全に一致したメロディタイミング
        });
    }

    return generatedNotes;
}

export function resetAIHiddenState() {
    lastKvCache = {};
    lastHiddenTensor = null;
    confirmedShapeCandidate = null;
}
export async function predictNextNote(inputIds, context = {}) { return 60; }
export function fallbackGenerator(key, scale) { return []; }