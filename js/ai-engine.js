/**
 * PianoWorks AI Engine - Algorithmic Composition Engine
 * (ONNX/AIモデルは廃止。フレーズ構造・重み付けされた音の動き・モチーフの反復と変奏・
 *  休符による「間」を組み合わせた、アルゴリズム作曲エンジンに全面切り替え)
 */
import { THEORY } from './utils.js';

// ★ 互換性のために残しているだけの関数。呼び出し元（studio.js等）を壊さないよう、
//   何もせず即座に成功を返す（かつてのONNXモデル読み込みは廃止した）。
export async function loadMusicModel() {
    console.log("%c🎼 [AI Engine] アルゴリズム作曲エンジンを使用します（ONNXモデルは使用しません）。", "color: #4caf50; font-weight: bold;");
    return true;
}

// ★★★ 重み付けされた「音階上の移動量（度数）」を1つ選ぶ ★★★
//   weights は [{ step: 度数の移動量, weight: 選ばれやすさ }, ...] の配列
function weightedStepDegrees(weights) {
    const total = weights.reduce((s, w) => s + w.weight, 0);
    let r = Math.random() * total;
    for (const w of weights) {
        if (r < w.weight) return w.step;
        r -= w.weight;
    }
    return weights[weights.length - 1].step;
}

// ★ 現在のMIDIノートに一番近い、availableMidis配列上のインデックスを探す
function findNearestIndex(midi, availableMidis) {
    let bestIdx = 0, bestDist = Infinity;
    availableMidis.forEach((m, idx) => {
        const d = Math.abs(m - midi);
        if (d < bestDist) { bestDist = d; bestIdx = idx; }
    });
    return bestIdx;
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
            chordEvery: 4,          // 何ステップに1回、AI由来の和音を鳴らすか
            restChance: 0.15        // ★ ジャズは「間」を活かすジャンルなので休符多め
        },
        anison: {
            swing: 0.5,            // ストレート（アニソン／ポップらしい均等な8分）
            octaveRange: [60, 88], // 明るく高めの音域
            velocityBase: 0.62, velocityHumanBase: 0.74, velocityJitter: 0.03,
            chordEvery: 3,
            restChance: 0.05        // ★ アニソンは音数多めで畳みかける印象にしたいので休符少なめ
        },
        classic: {
            swing: 0.52,           // ほぼ均等（クラシックらしい端正なリズム）
            octaveRange: [48, 76], // 落ち着いた中音域中心
            velocityBase: 0.46, velocityHumanBase: 0.58, velocityJitter: 0.02,
            chordEvery: 6,
            restChance: 0.08
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

    // ★★★ フレーズ構造のための状態 ★★★
    // 4〜7音を1フレーズとして扱い、フレーズの終わりには着地感のある動きを選びやすくする。
    // また、直前のフレーズの「音の動きのパターン」を一定確率で覚えておき、
    // 次のフレーズの冒頭で違う音から再利用する（＝モチーフの反復・変奏）。
    let phraseStep = 0;
    let phraseLength = 4 + Math.floor(Math.random() * 4);
    let currentMotif = [];
    let motifQueue = [];

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
        // ★★★ 休符判定 ★★★
        // ユーザー自身の音は絶対に間引かない（isHumanOrigin確定後に判定するため、
        // ここでは「AI自動生成の番のときだけ」休符の可能性を考える）
        let isRestStep = false;

        if (!isHumanOrigin) {
            // ★★★ アルゴリズム作曲：フレーズ構造＋重み付けされた音の動き＋モチーフの反復 ★★★
            isRestStep = Math.random() < genreParams.restChance;

            if (isRestStep) {
                // ★ 「間」を作る：この1ステップは音を出さない（predictedMidi/lastMidiは更新しない）
                predictedMidi = lastMidi;
            } else {
                const availIdx = findNearestIndex(lastMidi, availableMidis);
                let stepDeg;

                if (motifQueue.length > 0) {
                    // ★ 前のフレーズの動きのパターンを再利用（＝モチーフの変奏）
                    stepDeg = motifQueue.shift();
                } else {
                    const isPhraseEnd = (phraseStep === phraseLength - 1);
                    stepDeg = isPhraseEnd
                        // ★ フレーズの終わりは、着地感を出すため小さい動きに収束させやすくする
                        ? weightedStepDegrees([
                            { step: 0, weight: 25 },
                            { step: 1, weight: 20 }, { step: -1, weight: 20 },
                            { step: 2, weight: 15 }, { step: -2, weight: 15 },
                        ])
                        // ★ 通常時：小さい動きが多く、たまに跳躍する、人間の旋律に近い分布
                        : weightedStepDegrees([
                            { step: 1, weight: 24 }, { step: -1, weight: 24 },
                            { step: 2, weight: 14 }, { step: -2, weight: 14 },
                            { step: 0, weight: 6 },
                            { step: 3, weight: 6 }, { step: -3, weight: 6 },
                            { step: 4, weight: 3 }, { step: -4, weight: 3 },
                        ]);
                }

                const nextIdx = Math.max(0, Math.min(availableMidis.length - 1, availIdx + stepDeg));
                predictedMidi = availableMidis[nextIdx];

                currentMotif.push(stepDeg);
                phraseStep++;
                if (phraseStep >= phraseLength) {
                    phraseStep = 0;
                    phraseLength = 4 + Math.floor(Math.random() * 4);
                    // ★ 30%の確率で、このフレーズの動きを覚えておき、次のフレーズの冒頭で
                    //   違う音から再利用する（＝モチーフの反復・変奏。作曲の基本技法）
                    motifQueue = (Math.random() < 0.3) ? [...currentMotif] : [];
                    currentMotif = [];
                }
            }
        }

        // ピッチの確定
        let targetMidi = predictedMidi;
        if (!isHumanOrigin && !isRestStep) {
            targetMidi = availableMidis.reduce((prev, curr) => Math.abs(curr - predictedMidi) < Math.abs(prev - predictedMidi) ? curr : prev);
            // ★ ジャンルごとの音域に収める（アニソンは明るく高め、クラシックは中音域中心、ジャズは広め）
            const [octMin, octMax] = genreParams.octaveRange;
            while (targetMidi < octMin) targetMidi += 12;
            while (targetMidi > octMax) targetMidi -= 12;
        }

        if (!isRestStep) {
            lastMidi = targetMidi;
            contextMidiHistory.push(lastMidi);
        }
        // ★ 休符のときは lastMidi をそのまま維持する（＝メロディが「間」の後も
        //   休符前の高さから自然に続く。西洋音楽の慣習に合わせている）

        // 🌟 確定した「秒数」の分だけ全体のタイムラインを進める（ミリ秒を掛け算して再生エンジンに渡す）
        timeAccumulator += currentStepDurationSec;
        const finalTimeOffsetMs = timeAccumulator * 1000; // 👈 再生エンジンが期待するミリ秒単位へここで安全変換

        // コード（伴奏）の追加 ★ ジャンルごとに和音を鳴らす頻度を変える
        // ★ 休符ステップでは和音も鳴らさない（完全な「間」にする）
        let playChord = isRestStep ? false : (isHumanOrigin ? true : (i % genreParams.chordEvery === 2 % genreParams.chordEvery));

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

        // メイン音符の追加 ★ 休符ステップでは音を出さない
        if (!isRestStep) {
            generatedNotes.push({
                note: THEORY.midiToNote(targetMidi).replace('#', 's'),
                velocity: finalVelocity,
                timeOffset: finalTimeOffsetMs // 👈 ユーザーの間隔と完全に一致したメロディタイミング
            });
        }
    }

    return generatedNotes;
}

// ★ 互換性のために残す（呼び出し元を壊さないため）。アルゴリズム生成には
//   セッションをまたぐ状態が無いので、実質的には何もしない。
export function resetAIHiddenState() {
    // no-op（ONNXの隠れ状態管理は廃止済み）
}
export async function predictNextNote(inputIds, context = {}) { return 60; }
export function fallbackGenerator(key, scale) { return []; }