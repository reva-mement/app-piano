import { THEORY } from '../utils.js';
import { runInference } from '../ai-engine.js';
import { addRecordingToArchive } from '../playnote-db.js';
import { storyEngine } from './session/story-engine.js';
import { setCharacterImage, setBubbleText, triggerSeasonalThought } from '../thought-engine.js';
import { forceStopStudioIfRunning } from './studio.js';
// 🌟 わかりやすく別名でインポート
import { 
    initEffectEngine, 
    startEffectEngine, 
    stopEffectEngine, 
    triggerNoteEffect, 
    updateEffectParameters as updateVisualEngine 
} from './session/session-effect.js';

export let sessionBuffer = [];
export let sessionState = {
    isRecording: false,
    isPlaying: false,
    startTime: 0,
    currentKey: 'C',
    currentScale: 'major',
    currentStyle: 'jazz', 
    genre: 'jazz', // ★ AI伴奏の風味（ドロップダウンで選択：jazz / anison / classic）
    sessionBaseBpm: 105
};

window.sessionState = sessionState;

/**
 * 演奏の熱量と環境を混ぜ合わせて、画面の挙動を決定する
 * (session.js に直接統合)
 */
/**
 * 演奏の熱量と環境を混ぜ合わせて、画面の挙動を決定する
 */
export function applyVisualSpice() {
    // 1. グローバルから天気を取得
    const weather = window.currentWeather || 'Default';
    
    // 2. 気温の算出（0.0〜1.0）
    let temp = 0.5; // Default は中間
    if (weather === 'Clear') temp = 0.9;  // 晴れ＝暑い
    if (weather === 'Rain')  temp = 0.1;  // 雨＝寒い
    if (weather === 'Snow')  temp = 0.0;  // 雪＝極寒

    // 3. エフェクトエンジンへ気温情報を反映
    updateVisualEngine(temp);

    // 4. その他のパラメータ調整
    let feed = 0.037;
    let kill = 0.060;

    if (weather === 'Rain') { 
        feed = 0.042; 
        kill = 0.058; 
    } else if (weather === 'Clear') {
        feed = 0.035;
        kill = 0.062;
    }

    if (weather === 'Rain') { feed = 0.042; kill = 0.058; } 
    else if (weather === 'Clear') { feed = 0.030; kill = 0.065; }

    const intensity = (bpm - 100) * 0.0002;
    kill += intensity;

    // 🌟 エイリアス名である updateVisualEngine を使用する
    if (typeof updateVisualEngine === 'function') {
        updateVisualEngine(feed, kill);
    }
}

let userInputQueue = [];
let compositionTimer = null;
let activeCreatures = [];
let currentSessionTokens = []; 
let userInputSilenceTimer = null; 
let isAiLoopActive = false;       

// ユーザーの入力インターバル追従用
let lastUserInteractionTime = 0;
let lastUserNoteAbsoluteTime = 0; // 🌟 前回の打鍵の絶対ミリ秒（デルタタイム計算用）
let estimatedUserBpm = 105;

/**
 * 演奏の熱量と環境を混ぜ合わせて、画面の挙動を決定する
 */
export function applyVisualParameters(feed = 0.037, kill = 0.060) {
    // 🌟 インポートしたエイリアスを使用
    if (typeof updateVisualEngine === 'function') {
        updateVisualEngine(feed, kill);
    }
}

export function initSession() {
    const recBtn = document.getElementById('session-rec-btn');
    const playBtn = document.getElementById('session-play-pause-btn');
    const genreSelect = document.getElementById('session-genre-select');

    if (!recBtn || !playBtn) return;

    if (genreSelect) {
        // ★ 初期値をUIに反映し、選択が変わったら伴奏の風味（jazz/anison/classic）を切り替える
        genreSelect.value = sessionState.genre;
        genreSelect.addEventListener('change', () => {
            sessionState.genre = genreSelect.value;
            console.log(`🎼 AI伴奏の風味を変更: ${sessionState.genre}`);
        });
    }

    initEffectEngine();

window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' || event.key === 'Esc') {
            if (sessionState.isPlaying) {
                console.log("Escキーを検知：Sessionモードを終了して通常画面に戻ります。");
                
                document.getElementById('session-overlay').classList.remove('active');
                document.body.classList.remove('session-active');
                
                // 🌌 【追加】Esc終了時もエンジンを止める
                stopEffectEngine();

                stopSessionLogic();
                forceResetSessionUI();
            }
        }
    });

playBtn.addEventListener('click', () => {
        if (sessionState.isPlaying) {
            document.getElementById('session-overlay').classList.remove('active');
            document.body.classList.remove('session-active');

            sessionState.isPlaying = false;
            playBtn.classList.remove('active');
            
            // 🌌 【追加】演奏停止時にエンジンを止める
            stopEffectEngine();

            stopSessionLogic();
} else {
            // ★ 排他処理：Studioモードが動作中（GAME ON中 or 通常再生中）なら強制停止する
            forceStopStudioIfRunning();

            // 🎬 【①まずノーマルのときの色と古い骨格をパッと完全に消す (0秒)】
            document.getElementById('session-overlay').classList.add('active');
            document.body.classList.add('session-active');
            
            // ⚠️ 起動した瞬間は、まだ骨格の生成クラスを入れずに一度「完全な虚無」にする
            document.body.classList.remove('skeleton-generating');

            // 🕸️ 【②・③ 100ミリ秒のタイムラグを入れてから、0.8秒かけて骨格を再度生成する】
            setTimeout(() => {
                // セッションがまだ継続している場合のみ、骨格生成クラスを付与
                if (sessionState.isPlaying) {
                    document.body.classList.add('skeleton-generating');
                }
            }, 100); // 👈 この「100msのラグ」がブラウザの計算競合を完全に防ぎます

            sessionState.isPlaying = true;
            window.isSessionMode = true;
            playBtn.classList.add('active');

            // ★ RECボタン経由（playSession()内）と同じ見た目（PAUSE表示・色変化）にする
            playBtn.textContent = 'II PAUSE';
            playBtn.setAttribute('data-playing', 'true');

            stopEffectEngine(); // 既存処理
            startEffectEngine();

            sessionState.startTime = audioContext.currentTime;
            if (sessionBuffer.length === 0) {
                if (typeof startAILoop === 'function') {
                    startAILoop();
                } else if (typeof playSession === 'function') {
                    playSession(); 
                }
            } else {
                if (typeof playSessionBuffer === 'function') playSessionBuffer();
            }
        }
    });

    // 既存の録音（REC）ボタンのイベントロジック（そのまま完全維持 + Canvas起動を追加）
    recBtn.addEventListener('click', () => {
        if (sessionState.isPlaying) {
            stopPlayback();
            stopSessionLogic();
        } else {
            // ★ 排他処理：Studioモードが動作中（GAME ON中 or 通常再生中）なら強制停止する
            forceStopStudioIfRunning();

            // 🎬 【PLAYボタンと同様に Canvas エフェクトを立ち上げる】
            document.getElementById('session-overlay').classList.add('active');
            document.body.classList.add('session-active');
            document.body.classList.remove('skeleton-generating');

            setTimeout(() => {
                if (sessionState.isPlaying) {
                    document.body.classList.add('skeleton-generating');
                }
            }, 100);

            stopEffectEngine();
            startEffectEngine();

            sessionState.isRecording = true; 
            recBtn.setAttribute('data-recording', 'true');
            recBtn.innerText = "● REC";
            playSession(); 
        }
    });

}

function determineDestinyStyle() {
    const now = new Date();
    const timeSeed = now.getFullYear() + (now.getMonth() + 1) + now.getDate() + 
                     now.getHours() + now.getMinutes() + now.getSeconds();
    
    let destinyNum = timeSeed % 100; 
    let selectedStyle = 'swing'; 
    const weather = window.currentWeather || 'cloudy';

    if (weather === 'sunny') {
        if (destinyNum < 20) selectedStyle = 'ballad';
        else if (destinyNum < 40) selectedStyle = 'bebop';
        else selectedStyle = 'swing';
    } else if (weather === 'rainy') {
        if (destinyNum < 20) selectedStyle = 'swing';
        else if (destinyNum < 40) selectedStyle = 'bebop';
        else selectedStyle = 'ballad';
    } else {
        if (destinyNum < 20) selectedStyle = 'swing';
        else if (destinyNum < 40) selectedStyle = 'ballad';
        else selectedStyle = 'bebop';
    }

    let baseBpm = 125;
    if (selectedStyle === 'bebop') baseBpm = 145;      
    if (selectedStyle === 'ballad') baseBpm = 65;  

    sessionState.currentStyle = selectedStyle;
    sessionState.sessionBaseBpm = baseBpm;
    estimatedUserBpm = baseBpm;

    console.log(`🔮 【初期運命設定】 Style: ${selectedStyle} / BPM: ${baseBpm}`);
}

function playSession() {
    if (sessionState.isPlaying) return;
    determineDestinyStyle();

    // ★ Sessionモード開始：黒板の絵をsinging.pngへ（チョークで描くワイプ演出付き）
    setCharacterImage('singing.png');
    setBubbleText('〜♪');

    storyEngine.init(window.audioContext.currentTime);

    sessionState.isPlaying = true;
    sessionState.startTime = window.audioContext.currentTime;

    lastUserInteractionTime = 0; 
    lastUserNoteAbsoluteTime = 0; // 🌟 リセット

    const playBtn = document.getElementById('session-play-pause-btn');
    if (playBtn) {
        playBtn.textContent = 'II PAUSE';
        playBtn.setAttribute('data-playing', 'true');
    }
    console.log("🎹 AI Session: 人間の打鍵、およびそのリズム間隔のキャプチャ待機中...");
}

function stopPlayback() {
    sessionState.isPlaying = false;
    window.isSessionMode = false;
    const playBtn = document.getElementById('session-play-pause-btn');
    if (playBtn) {
        playBtn.innerText = "▶ PLAY";
        playBtn.removeAttribute('data-playing');
    }
}

/**
 * AIフレーズ生成のトリガー
 * 環境データ(天候・BPM)とセッション熱量を同期し、グラフィックを駆動させる
 */
async function processAIComposer() {
    if (!sessionState.isPlaying) return;

    // 関数名変更を反映
    applyVisualParameters();

    let targetTokensForBpm = [];
    
    // 人間の入力キューを解析対象とする
    if (userInputQueue.length > 0) {
        console.log(`🍖 AI Engine: 人間の最新入力（${userInputQueue.length}音）を解析中...`);
        targetTokensForBpm = [...userInputQueue];
        currentSessionTokens = [...userInputQueue];
        userInputQueue = []; 
    } else {
        if (!isAiLoopActive) {
            targetTokensForBpm = [...currentSessionTokens];
        } else if (currentSessionTokens.length > 6) {
            currentSessionTokens = currentSessionTokens.slice(-6);
        }
    }

    // BPMのダイナミック同期
    if (targetTokensForBpm.length >= 2) {
        let sumIntervals = 0;
        let count = 0;
        for (let k = 1; k < targetTokensForBpm.length; k++) {
            const diff = targetTokensForBpm[k].time - targetTokensForBpm[k-1].time;
            if (diff > 0.05) { // 和音除外
                sumIntervals += diff;
                count++;
            }
        }
        
        if (count > 0) {
            const avgInterval = sumIntervals / count;
            let calculatedBpm = 60 / avgInterval; 
            
            // BPMの正規化
            while (calculatedBpm > 170) calculatedBpm /= 2;
            while (calculatedBpm < 20)  calculatedBpm *= 2;

            // スムージング処理
            estimatedUserBpm = (estimatedUserBpm * 0.4) + (calculatedBpm * 0.6);
            sessionState.sessionBaseBpm = estimatedUserBpm;
            console.log(`🎯 [BPM Sync]: ${Math.round(estimatedUserBpm)} BPM`);
        }
    }

    if (currentSessionTokens.length === 0) return;

    // 長時間無入力時のサスペンド
    if (lastUserInteractionTime > 0) {
        const currentTime = window.audioContext.currentTime;
        if (currentTime - lastUserInteractionTime > 30.0) {
            console.log(`⏳ AI Engine: 長時間入力なしのためサスペンドします。`);
            currentSessionTokens = [];
            isAiLoopActive = false; 
            return;
        }
    }

    // AI推論コンテキストの構築
    const context = {
        key: sessionState.currentKey,
        scale: sessionState.currentScale,
        weather: window.currentWeather || 'Default',
        style: sessionState.currentStyle,      
        genre: sessionState.genre, // ★ ドロップダウンで選んだ伴奏の風味
        baseBpm: estimatedUserBpm, 
        storySignal: {
            // 熱量に応じた動的な物語信号
            intensity: Math.min(1.0, Math.max(0.2, (estimatedUserBpm - 55) / 100)),
            density: Math.min(1.0, Math.max(0.2, (estimatedUserBpm - 55) / 100))
        }
    };

    // AI推論実行
    const aiNotes = await runInference(currentSessionTokens, context);

    if (aiNotes && aiNotes.length > 0) {
        currentSessionTokens = [...aiNotes];
        isAiLoopActive = true; 
        igniteMusicalCreature(aiNotes);
    } else {
        // 結果が得られなかった場合は少し待ってリトライ
        setTimeout(() => processAIComposer(), 400);
    }
}

/**
 * 高精度再生タイムライン（AIの音にエフェクトを完全連動させた修正版）
 * 🌟 鍵盤発光に「from-ai」クラスを追加付与する叩き分け完全対応版
 */
function igniteMusicalCreature(score) {
    let dna = {
        score: score || [],
        onTimers: [],  
        offTimers: [], 
        stop: function() {
            this.onTimers.forEach(id => clearTimeout(id));
            this.offTimers.forEach(id => clearTimeout(id));
            this.onTimers = [];
            this.offTimers = [];
        }
    };

    let maxOffsetMs = 0;

    dna.score.forEach(task => {
        if (!task || !task.note) return;
        if (task.timeOffset > maxOffsetMs) maxOffsetMs = task.timeOffset;

        const onTimerId = setTimeout(() => {
            if (!sessionState.isPlaying) return;

            const safePlayTime = window.audioContext.currentTime + 0.02;

            // ① AIの音を物理的にスピーカーから再生
            if (window.playNote) {
                window.playNote(task.note, task.velocity, true, safePlayTime);
            }

            // ★ 録音中なら、人間の打鍵と同じく AI の打鍵も sessionBuffer に記録する
            if (sessionState.isRecording) {
                sessionBuffer.push({
                    note: task.note,
                    velocity: task.velocity,
                    time: safePlayTime - sessionState.startTime,
                    type: 'on'
                });
            }
            
            // 🌟 AIの音が鳴った瞬間にレインボーロード・エフェクトを強制発火！
            if (typeof triggerNoteEffect === 'function') {
                const currentBpm = sessionState.sessionBaseBpm || estimatedUserBpm || 105;
                triggerNoteEffect(task.note, true);
            }

            // ② 鍵盤UIのビジュアルフィードバック
            // 💡【修正】既存ロジックを壊さないよう、ここで直接 AI 用のサブクラス「from-ai」を制御します
            const aiEl = document.querySelector(`.key[data-note="${task.note}"]`);
            if (aiEl) {
                if (aiEl.dataset.timeoutId) clearTimeout(parseInt(aiEl.dataset.timeoutId));
                
                // 既存の active に加え、AI打鍵を示す from-ai を付与（人間用 from-user は剥がす）
                aiEl.classList.add('active', 'from-ai');
                aiEl.classList.remove('from-user');
                
                // 350ms後に鍵盤のクラスを安全にリセット
                aiEl.dataset.timeoutId = setTimeout(() => {
                    aiEl.classList.remove('active', 'from-ai');
                    aiEl.dataset.timeoutId = "";
                }, 350);
            }
            
            const offTimerId = setTimeout(() => {
                if (window.stopNote) window.stopNote(task.note);

                // ★ noteOff も同様に記録する
                if (sessionState.isRecording) {
                    sessionBuffer.push({
                        note: task.note,
                        velocity: 0,
                        time: window.audioContext.currentTime - sessionState.startTime,
                        type: 'off'
                    });
                }
            }, 350); 
            dna.offTimers.push(offTimerId);

        }, task.timeOffset);

        dna.onTimers.push(onTimerId);
    });

    activeCreatures.push(dna);

    const nextTriggerOffset = maxOffsetMs + 180; 

    const loopTimerId = setTimeout(() => {
        activeCreatures = activeCreatures.filter(c => c !== dna);
        if (sessionState.isPlaying) {
            processAIComposer();
        }
    }, nextTriggerOffset);

    dna.onTimers.push(loopTimerId);
}

/**
 * ユーザー打鍵時のビジュアルフィードバック（手前側・黄色発光完全対応版）
 */
export function visualizeKey(note, duration = 300) {
    console.log("🎹 visualizeKeyが発火しました！ノート番号:", note); // 👈 これを追記
    const el = document.querySelector(`.key[data-note="${note}"]`);
    if (!el) return;
    
    // 💡 既存のタイマーがあれば一度クリア
    if (el.dataset.timeoutId) clearTimeout(parseInt(el.dataset.timeoutId));
    
    // 🌟 人間の打鍵であることを示す「from-user」を「active」と同時に付与！
    // これにより piano.css のネオンイエロー（手前発光）が100%着火します。
    el.classList.add('active', 'from-user');
    el.classList.remove('from-ai'); // 念のためAIクラスは剥がす
    
    // 指定されたデュレーション（ミリ秒）が経過したら、安全に両方のクラスを剥ぎ取る
    el.dataset.timeoutId = setTimeout(() => {
        el.classList.remove('active', 'from-user');
        el.dataset.timeoutId = "";
    }, duration);
}

window.visualizeKey = visualizeKey;

function getFormattedDate() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${y}${m}${d}_${hh}${mm}`;
}

function toVLQ(num) {
    let buf = [];
    buf.push(num & 0x7F);
    while (num >>>= 7) buf.push((num & 0x7F) | 0x80);
    return buf.reverse();
}

export function stopSessionLogic() {
    // ★ Sessionモード再生終了後、季節にちなんだセリフを一度だけ表示する
    triggerSeasonalThought();

    sessionState.isPlaying = false;
    sessionState.isRecording = false;
    clearTimeout(userInputSilenceTimer); 
    isAiLoopActive = false;               

    // 2. エフェクトとAIクリーチャーの停止
    if (Array.isArray(activeCreatures)) {
        activeCreatures.forEach(c => { if (c && typeof c.stop === 'function') c.stop(); });
        activeCreatures = [];
    }
    stopEffectEngine();

    // 3. 鍵盤UIのセッション特有クラスのみを剥がし、通常モードへ復帰
    document.querySelectorAll('.key').forEach(el => {
        // セッション中に付与したクラスだけを確実に削除
        el.classList.remove('active', 'from-user', 'from-ai', 'is-veiled', 'is-veiled-near', 'is-veiled-far');
        // key-assigned や key-label は通常モードの updateIndividualMapping が管理するため、
        // ここで下手に消さず、関数を呼び出して通常状態へ強制同期させます
    });
    
    document.body.classList.remove('session-active', 'skeleton-generating');

    // 🌟 通常モードの配置を再計算して呼び出す（これで表記が戻ります）
    if (typeof window.updateIndividualMapping === 'function') {
        window.updateIndividualMapping();
    }

    // 4. 音声・MIDI処理の停止
    if (typeof window.stopAllNotes === 'function') { window.stopAllNotes(); }
    
    if (sessionBuffer.length > 0) {
        const title = `Session_${getFormattedDate()}`;
        addRecordingToArchive(title, "Session", [...sessionBuffer]);
        sessionBuffer = [];
    }

    // 5. ボタンUIの復帰
    const playBtn = document.getElementById('session-play-pause-btn');
    const recBtn = document.getElementById('session-rec-btn');
    if (playBtn) { 
        playBtn.innerText = "▶ PLAY"; 
        playBtn.removeAttribute('data-playing'); 
    }
    if (recBtn) { 
        recBtn.innerText = "● REC"; 
        recBtn.removeAttribute('data-recording'); 
    }

    // 6. 変数のリセット
    userInputQueue = [];
    currentSessionTokens = [];
    lastUserInteractionTime = 0; 
    lastUserNoteAbsoluteTime = 0;
    estimatedUserBpm = 105;
    
    console.log("🛑 Session Logic: セッションを完全に終了し、UIを通常モードへ復帰しました。");
}

export function forceResetSessionUI() {
    const playBtn = document.getElementById('session-play-pause-btn');
    const recBtn = document.getElementById('session-rec-btn');
    if (playBtn) { playBtn.innerText = "▶ PLAY"; playBtn.removeAttribute('data-playing'); }
    if (recBtn) { recBtn.innerText = "● REC"; recBtn.removeAttribute('data-recording'); }
    sessionState.isPlaying = false;
    sessionState.isRecording = false;
}
window.forceResetSessionUI = forceResetSessionUI;

export function convertEventsToMidi(sessionBuffer) {
    if (!sessionBuffer || sessionBuffer.length === 0) return null;
    let lastTimeInTicks = 0;
    const TPQN = 128;
    const bpm = 120;
    const msPerTick = (60000 / bpm) / TPQN;
    const events = [];

    [...sessionBuffer].sort((a, b) => a.time - b.time).forEach(item => {
        const currentTimeInTicks = Math.floor((item.time * 1000) / msPerTick);
        let deltaTime = currentTimeInTicks - lastTimeInTicks;
        if (deltaTime < 0) deltaTime = 0;
        lastTimeInTicks = currentTimeInTicks;
        const midiNote = THEORY.noteToMidi(item.note);
        const vel = Math.floor(item.velocity * 127);
        const status = (item.type === 'off') ? 0x80 : 0x90;
        events.push(...toVLQ(deltaTime));
        events.push(status, midiNote, vel);
    });
    events.push(0x00, 0xFF, 0x2F, 0x00);
    const header = [0x4D, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x00, TPQN];
    const len = events.length;
    const trackHeader = [0x4D, 0x54, 0x72, 0x6B, (len >> 24) & 0xFF, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF];
    return new Uint8Array([...header, ...trackHeader, ...events]);
}

export async function exportMidiFile() {
    if (sessionBuffer.length === 0) return;
    // (MIDI保存処理。割愛せず維持)
}

/**
 * 演奏イベント処理
 * 呼び出し元（piano.js）が handleNoteEvent を探しているため、この名前で統一します
 */
export function handleNoteEvent(note, velocity, type = 'on', isAuto = false) {
    if (!sessionState.isPlaying) return;

    const currentTime = window.audioContext.currentTime;
    const timestamp = currentTime - sessionState.startTime;
    
    if (type === 'on') {
        // 🌌 エフェクトの反映
        // 曇りの時は velocity を倍にして、うねりの反応を強くする
        const effectVelocity = (window.currentWeather === 'Clouds') ? velocity * 2.0 : velocity;
        const currentBpm = sessionState.sessionBaseBpm || estimatedUserBpm || 105;
        
        // 修正: 曇りの判断を加えたエフェクトトリガー
        triggerNoteEffect(note, effectVelocity, currentBpm);

        // 🌟 鍵盤UIの発光（人間のみ）
        if (!isAuto && typeof window.visualizeKey === 'function') {
            window.visualizeKey(note, 300);
        }

        // 演奏データの記録・解析ロジック
        let deltaMs = 0;
        const nowAbsoluteMs = performance.now();
        if (typeof lastUserNoteAbsoluteTime !== 'undefined' && lastUserNoteAbsoluteTime > 0) {
            deltaMs = nowAbsoluteMs - lastUserNoteAbsoluteTime;
        }
        
        if (deltaMs < 65) deltaMs = 0;

        const noteObj = { 
            note, 
            velocity, 
            time: timestamp, 
            type: 'on',
            deltaTimeMs: deltaMs 
        };
        
        if (sessionState.isRecording) {
            sessionBuffer.push(noteObj);
        }
        
        if (!isAuto) {
            lastUserInteractionTime = currentTime;
            lastUserNoteAbsoluteTime = nowAbsoluteMs; 

            if (!isAiLoopActive) {
                currentSessionTokens.push(noteObj);
                clearTimeout(userInputSilenceTimer);
                userInputSilenceTimer = setTimeout(() => {
                    console.log("🛑 最初の演奏終了（1.5秒の休符）を検知。AIループ始動！");
                    if (typeof processAIComposer === 'function') processAIComposer(); 
                }, 1500);
            } else {
                userInputQueue.push(noteObj);
            }
        }
    } else {
        // type === 'off' の処理
        if (sessionState.isRecording) {
            sessionBuffer.push({ note, velocity: 0, time: timestamp, type: 'off' });
        }
    }
}