/* --- src/js/instruments/piano/core.js (音質・高速演奏最適化版) --- */

// 設定（config.js）から必要なデータを読み込みます
import { FLAT_TO_SHARP, PIANO_KEYS } from './config.js';

// 音源のデータを保存しておく場所
export const audioBufferCache = {};

// 現在鳴っている音を管理するリスト
export const activeSources = new Map();

// --- ★追加：発音密度（手数の多さ）を測定するためのタイムスタンプバッファ ---
let globalNoteTimestamps = [];

/**
 * 音名をプログラムで扱える形式（例：Bb4 -> As4）に変換します
 */
export function formatNoteName(note) {
    if (typeof note !== 'string') return note;
    let n = note.trim();
    
    // フラットをシャープに変換
    for (let flat in FLAT_TO_SHARP) {
        if (n.startsWith(flat)) {
            n = FLAT_TO_SHARP[flat] + n.slice(flat.length);
            break;
        }
    }
    // 不要な記号や空白を除去して正規化
    return n.replace('#', 's').replace('S', 's').replace(/\s+/g, '');
}

/**
 * 88鍵すべての音源ファイルを読み込みます
 */
export async function preloadSounds(audioCtx) {
    console.log("Piano Core: 88鍵の音源プリロードを開始します...");
    
    const loadPromises = PIANO_KEYS.map(key => {
        const id = key.n; // 音名（例：C4）
        return fetch(`./assets/sounds/${id}.mp3`)
            .then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.arrayBuffer();
            })
            .then(buf => audioCtx.decodeAudioData(buf))
            .then(decoded => { 
                audioBufferCache[id] = decoded; 
            })
            .catch(err => console.error(`Failed to load ${id}:`, err));
    });

    await Promise.allSettled(loadPromises);
    console.log(`Piano Core: プリロード完了。準備できた音数: ${Object.keys(audioBufferCache).length}`);
}

export function playNote(rawNote, velocity = 0.7, isAuto = false, audioCtx, pianoGain) {
    const note = formatNoteName(rawNote);
    if (!note || !audioBufferCache[note]) return;


    // --- 【0. 自動ペダル(StudioPedal)のフック】 ---
    if (window.StudioPedal && typeof window.StudioPedal.onNoteOn === 'function') {
        window.StudioPedal.onNoteOn();
    }

    // --- 【コンテキストの強制統一】 ---
    if (window.audioContext) {
        audioCtx = window.audioContext;
    } else if (window.pianoCtx) {
        audioCtx = window.pianoCtx;
    }

    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;

    // --- 【1 & 2. 記録・解決ロジック】 ---
    if (!isAuto) {
        if (typeof window.recordStudioEvent === 'function') {
            window.recordStudioEvent('noteOn', note, Math.round(velocity * 127)); 
        }
        if (typeof window.resolveGuideNote === 'function') {
            window.resolveGuideNote(note);
        }
    }

    // --- 【3. UI表示】 ---
    const keyEl = document.querySelector(`.key[data-note="${note}"]`);
    if (keyEl) keyEl.classList.add('active');

    // --- 【4. 連打時のノイズ対策】 ---
    if (activeSources.has(note)) {
        const old = activeSources.get(note);
        try {
            old.gainNode.gain.setValueAtTime(old.gainNode.gain.value, now);
            old.gainNode.gain.setTargetAtTime(0, now, 0.005);
            old.source.stop(now + 0.01);
        } catch(e) {}
        activeSources.delete(note);
    }

    // --- 【5. 新しい音の生成と音量計算】 ---
    const source = audioCtx.createBufferSource();
    const gainNode = audioCtx.createGain();
    
    // --- 【音色フィルターの設定】 ---
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass'; 
    const baseFreq = 1000; 
    const freqRange = 19000; 
    filter.frequency.setValueAtTime(baseFreq + (velocity * freqRange), now);

    const masterVol = (pianoGain && pianoGain.gain) ? pianoGain.gain.value : 0.5;
    const finalVol = Math.max(masterVol * velocity, 0.4);

    // --- 【6. アタックの設定】 ---
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(finalVol, now + 0.005); 
    
    source.buffer = audioBufferCache[note];
    
    // --- 【7. 接続】 ---
    source.connect(filter).connect(gainNode);
    
    if (window.pianoGain) {
        gainNode.connect(window.pianoGain);
    } else if (pianoGain) {
        gainNode.connect(pianoGain);
    } else {
        gainNode.connect(audioCtx.destination);
    }
    
    source.start(now);
    activeSources.set(note, { source, gainNode });

    setTimeout(() => {
        if (window.pianoAnalyser) {
            const bufferLength = window.pianoAnalyser.frequencyBinCount; // 16
            const dataArray = new Uint8Array(bufferLength);
            
            // 発音直後のリアルタイムな周波数データを取得
            window.pianoAnalyser.getByteFrequencyData(dataArray);
            
            // piano.jsで動いていた「1番の部屋」の数値をダイレクトに取得（生データで0〜255）
            const togeValue = dataArray[1]; 

            // 0番〜15番の全エリアの音量合計
            const totalVolume = dataArray.reduce((a, b) => a + b, 0);

            // あなたが求めていた「打鍵ごとの綺麗な1行ログ」に一本化して出力します
            console.log(
                `🎹 音名: ${note.padEnd(4, ' ')} | 💥 強さ: ${velocity.toFixed(2)} | ✨ 高音域のトゲ度: ${String(togeValue).padStart(3, ' ')} / 255 (総音量: ${totalVolume})`
            );
        }
    }, 5); // アタックのピークを捉えるため5ms後に実行
    // ========================================================
}

/**
 * 消音処理（発音密度追従型）
 */
export function stopNote(rawNote, audioCtx, isAuto = false) { 
    const note = formatNoteName(rawNote);
    if (!note) return;

    // --- 【1. 記録ロジック】 ---
    if (!isAuto && typeof window.recordStudioEvent === 'function') {
        window.recordStudioEvent('noteOff', note);
    }
    
    // --- 【2. UI表示の解除】 ---
    const keyEl = document.querySelector(`.key[data-note="${note}"]`);
    if (keyEl) keyEl.classList.remove('active');
    
    // --- ★【3. 音の停止処理：密度追従ダイナミック・リリース】 ---
    if (activeSources.has(note)) {
        const { source, gainNode } = activeSources.get(note);
        const now = audioCtx.currentTime;
        
        gainNode.gain.cancelScheduledValues(now);
        
        // 直近500msの打鍵数からリリース時間を動的に算出
        // 手数が少ない（バラード等）＝ 最大 0.12秒（120ms）かけて豊かに余韻を引く
        // 手数が多い（超高速ファストジャズ）＝ 最短の下限を0.025秒から【0.06秒(60ms)】へ変更し、波形の絶壁ノイズ（プツ音）を完全に防ぐ
        const noteCount = globalNoteTimestamps.length;
        let releaseTime = 0.12 - (Math.min(noteCount, 15) * 0.0063); 
        releaseTime = Math.max(0.06, releaseTime); // ★極端に短い打鍵時のプツプツ音を防ぐための安全弁

        // 指数関数的な滑らかな減衰でリバーブに音を流し込む
        // 3番目の引数（Time Constant）の分母を「3」から「2.5」に微調整し、より滑らかな傾斜を作ります
        gainNode.gain.setTargetAtTime(0, now, releaseTime / 2.5); 
        
        try { 
            // リリースタイムが完全に収束する時間（releaseTimeの約4倍）の後にソースを完全に物理停止
            source.stop(now + (releaseTime * 4)); 
        } catch(e) {
            // すでに停止している場合は無視
        }
        
        // 管理リストから削除
        setTimeout(() => {
            if (activeSources.get(note)?.source === source) {
                activeSources.delete(note);
            }
        }, (releaseTime * 4) * 1000);
    }
}

/**
 * 【Studioモード用】
 * 鍵盤の見た目（.activeクラス）を維持したまま、鳴っている音だけを強制的に消去します。
 */
export function stopAllSoundsOnly(audioCtx) {
    console.log("Piano Core: Stopping all sounds while keeping key states.");
    
    activeSources.forEach((value, note) => {
        const { source, gainNode } = value;
        const now = audioCtx.currentTime;

        try {
            gainNode.gain.cancelScheduledValues(now);
            // 一瞬でのぶつ切りを防ぎつつ、0.04秒のなだらかなカーブで美しくリバーブへ残響を逃がす
            gainNode.gain.setTargetAtTime(0, now, 0.01);
            source.stop(now + 0.05);
        } catch (e) {
            // すでに止まっている場合は無視
        }
    });

    activeSources.clear();
}