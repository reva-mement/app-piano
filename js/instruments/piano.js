/* --- src/js/instruments/piano.js (重複排除・完全版) --- */

// 1. 各ファイルから必要なものだけを「一度だけ」インポートする
import { handleNoteEvent, initSession } from '../modes/session.js'; 
import { loadMusicModel } from '../ai-engine.js'; 

import { WHITE_KEY_WIDTH_VW, PIANO_KEYS, KEY_LAYOUT } from './piano/config.js';
import { setupReverb } from './piano/fx.js';
/* --- src/js/instruments/piano.js のインポート部分（9行目付近） --- */
import { 
    formatNoteName, // ★ここに追加してエラーを解消します
    preloadSounds as corePreload, 
    playNote as corePlay, 
    stopNote as coreStop, 
    stopAllSoundsOnly as coreStopAll 
} from './piano/core.js';

/* --- src/js/instruments/piano.js の初期化部分（丸ごと差し替え用） --- */

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
window.audioContext = audioCtx;

// 初期化前の安全策
window.playNote = (raw) => console.warn("Piano not yet initialized:", raw);

window.pianoGain = audioCtx.createGain();
window.pianoGain.gain.setValueAtTime(0.5, audioCtx.currentTime);

// ========================================================
// ★ 周波数スキャナー（AnalyserNode）の構築と割り込み接続
// ========================================================
// 1. リアルタイムアナライザーを作成
const pianoAnalyser = audioCtx.createAnalyser();
pianoAnalyser.fftSize = 64; // コンソールで見やすくするため、周波数の箱を32個に絞ります

// 2. 音の流れのルートを変更する
// [変更前] pianoGain -> スピーカー
// [変更後] pianoGain -> アナライザー（スキャナー） -> スピーカー
window.pianoGain.connect(pianoAnalyser);
pianoAnalyser.connect(audioCtx.destination);

// 3. 他のファイル（core.jsなど）からいつでも数値を覗き込めるようにグローバル化
window.pianoAnalyser = pianoAnalyser;
// ========================================================

let keyAssignments = new Map();

/**
 * 鍵盤を視覚的に光らせる（AI演奏時や外部からの呼び出し用）
 */
function visualizeKey(note, duration = 300, isAi = false) { // 👈 isAiフラグを追加
    const el = document.querySelector(`.key[data-note="${note}"]`);
    if (!el) return;

    if (el.dataset.timeoutId) {
        clearTimeout(parseInt(el.dataset.timeoutId));
    }

    // 🌟 修正：AIなら from-ai、人間なら from-user を付与
    el.classList.add('active');
    if (isAi) {
        el.classList.add('from-ai');
        el.classList.remove('from-user');
    } else {
        el.classList.add('from-user'); // 👈 これでCSSの黄色が適用されます
        el.classList.remove('from-ai');
    }

    const timeoutId = setTimeout(() => {
        el.classList.remove('active', 'from-user', 'from-ai');
        el.dataset.timeoutId = "";
    }, duration);

    el.dataset.timeoutId = timeoutId.toString();
}

// 他のファイルから呼び出せるようにグローバルに露出
window.visualizeKey = visualizeKey;

function playNote(note, velocity = 0.7, isAuto = false) {
    const rawNote = note; 
    
    // ★ Studio 用イベント：ガイド音（自動再生）のときだけ飛ばす
    if (isAuto) {
        const event = new CustomEvent('studio-note-played', { detail: { note: rawNote } });
        window.dispatchEvent(event);
    }

    note = formatNoteName(note);
    if (!note) return;

    // ★ 自動再生でも visualizeKey を呼ぶ（元の仕様）
    visualizeKey(rawNote, 300, isAuto);

    // ★ 手弾きのときだけ noteOn イベント処理
    if (!isAuto) {
        handleNoteEvent(rawNote, velocity);
    }

    // 音を鳴らす
    corePlay(rawNote, velocity, isAuto, audioCtx, window.pianoGain);
}

function stopNote(note) {
    if (!window.audioContext) return; 
    coreStop(note, window.audioContext);
    handleNoteEvent(note, 0, 'off');
}

window.stopNote = stopNote;
window.stopAllSoundsOnly = () => coreStopAll(audioCtx);

// --- UIロジック ---
export function updateIndividualMapping() {
    const viewport = document.getElementById('piano-viewport');
    const canvas = document.getElementById('piano-canvas');
    if (!viewport || !canvas) return;

    const keys = Array.from(canvas.querySelectorAll('.key'));
    const viewportCenter = viewport.scrollLeft + (viewport.clientWidth / 2);

    let closestKeyIdx = 0;
    let minDistance = Infinity;
    keys.forEach((key, idx) => {
        const keyCenter = key.offsetLeft + (key.offsetWidth / 2);
        const distance = Math.abs(keyCenter - viewportCenter);
        if (distance < minDistance) {
            minDistance = distance;
            closestKeyIdx = idx;
        }
    });

    const rangeRadio = document.querySelector('input[name="focus-range"]:checked');
    const octaveRange = rangeRadio ? parseFloat(rangeRadio.value) : 3.0;
    
    const totalKeysCount = Math.round(octaveRange * 12);
    const half = Math.floor(totalKeysCount / 2);

    const startIdx = Math.max(0, closestKeyIdx - half);
    const endIdx = Math.min(keys.length - 1, startIdx + totalKeysCount - 1);
    const targetKeys = keys.slice(startIdx, endIdx + 1);

    keyAssignments.clear();

    keys.forEach((keyEl, idx) => {
        const label = keyEl.querySelector('.key-label');
        const relativeIdx = idx - startIdx;
        const isAssigned = (idx >= startIdx && idx <= endIdx && relativeIdx < KEY_LAYOUT.length);

        if (isAssigned) {
            const char = KEY_LAYOUT[relativeIdx];
            const note = keyEl.dataset.note;
            keyAssignments.set(char, note);
            if (label) label.innerText = char;
            keyEl.classList.add('key-assigned');
            keyEl.classList.remove('is-veiled');
        } else {
            if (label) label.innerText = '';
            keyEl.classList.remove('key-assigned');
            keyEl.classList.add('is-veiled');
        }
    });
}

// ★ main.js（設定変更）や session.js から呼び出せるようにグローバル公開
//   （これが無いと、focus-range 変更後の key-assigned 再計算が一切走らない）
window.updateIndividualMapping = updateIndividualMapping;

export function initPiano() {
    initSession();

    const viewport = document.getElementById('piano-viewport');
    const canvas = document.getElementById('piano-canvas');
    const minimapFrame = document.getElementById('minimap-viewport-frame');
    const uiLayer = document.getElementById('ui-layer');
    const pianoView = document.getElementById('view-piano');

    if (!canvas || !viewport) return;

    canvas.innerHTML = PIANO_KEYS.map(k => `
        <div class="key ${k.t}" data-note="${k.n}">
            <div class="key-label"></div>
        </div>`).join('');

    canvas.style.width = `${PIANO_KEYS.filter(k => k.t === 'white').length * WHITE_KEY_WIDTH_VW}vw`;

    let scrollVelocity = 0;
    const SCROLL_SPEED_BASE = 10;
    function handleContinuousScroll() {
        if (scrollVelocity !== 0) viewport.scrollLeft += scrollVelocity;
        requestAnimationFrame(handleContinuousScroll);
    }
    requestAnimationFrame(handleContinuousScroll);

    if (!window.isPianoEventsBound) {
window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return; 
    if (e.key === 'Escape' && pianoView && pianoView.classList.contains('is-live')) {
        pianoView.classList.remove('is-live');
        uiLayer.style.display = 'block';
        return;
    }
    const key = e.key.toUpperCase();
    if (key === 'ARROWRIGHT' || key === 'ARROWLEFT') {
        scrollVelocity = (key === 'ARROWRIGHT' ? 1 : -1) * SCROLL_SPEED_BASE * (e.ctrlKey ? 3 : 1);
        e.preventDefault();
        return;
    }
    if (e.repeat) return;
    const note = keyAssignments.get(key);
    if (note) {
        window.playNote(note);

        // ★ Studio モード中なら、ユーザー入力を Studio 判定へ
        if (window.isStudioMode && typeof window.handleUserKeyPress === 'function') {
            window.handleUserKeyPress(note);
        }

        if (window.isGuideMode && typeof window.resolveGuideNote === 'function') {
            window.resolveGuideNote(note);
        }
    }
});


        window.addEventListener('keyup', (e) => {
            const key = e.key.toUpperCase();
            if (key === 'ARROWRIGHT' || key === 'ARROWLEFT') {
                scrollVelocity = 0;
                return;
            }
            const note = keyAssignments.get(key);
            if (note) stopNote(note);
        });
        window.isPianoEventsBound = true;
    }

canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; 
    const keyEl = e.target.closest('.key');
    if (keyEl) {
        window.isMouseDown = true;
        const note = keyEl.dataset.note;
        window.playNote(note); 

        // ★ Studio モード中なら、マウス入力も Studio 判定へ
        if (window.isStudioMode && typeof window.handleUserKeyPress === 'function') {
            window.handleUserKeyPress(note);
        }

        if (window.isGuideMode && typeof window.resolveGuideNote === 'function') {
            window.resolveGuideNote(note);
        }
    }
});


    canvas.addEventListener('mouseover', (e) => {
        if (window.isMouseDown && e.buttons === 1) { 
            const keyEl = e.target.closest('.key');
            if (keyEl) {
                window.playNote(keyEl.dataset.note);
            }
        }
    });

    canvas.addEventListener('mouseup', () => {
        window.isMouseDown = false;
    });

    canvas.addEventListener('mouseout', (e) => {
        const keyEl = e.target.closest('.key');
        if (keyEl) {
            stopNote(keyEl.dataset.note);
        }
    });

    const sync = () => {
        if (minimapFrame) {
            minimapFrame.style.left = (viewport.scrollLeft / viewport.scrollWidth * 100) + "%";
            minimapFrame.style.width = (viewport.clientWidth / viewport.scrollWidth * 100) + "%";
        }
        updateIndividualMapping();
    };
    viewport.addEventListener('scroll', sync);
    // ★ 表示範囲(オクターブ)変更時に直接呼べるよう、外から触れるようにしておく
    window.syncPianoMinimap = sync;
    sync(); // 初期表示時にも一度反映させる

    corePreload(audioCtx).then(() => {
        setupReverb(audioCtx, window.pianoGain).catch(err => console.warn(err));
        
        setTimeout(() => {
            const totalWidth = viewport.scrollWidth;
            if (totalWidth === 0) return;
            
            const c4Offset = (totalWidth / PIANO_KEYS.filter(k => k.t === 'white').length) * 23;
            viewport.scrollLeft = c4Offset - (viewport.clientWidth * 0.22);
            sync();
            
            window.playNote = (note, velocity, isAuto = false) => {
                playNote(note, velocity, isAuto);
            };

            const startAI = () => {
                if (typeof loadMusicModel === 'function') loadMusicModel();
            };

            if (window.ort) {
                startAI();
            } else {
                let attempts = 0;
                const checkOrt = setInterval(() => {
                    attempts++;
                    if (window.ort) {
                        clearInterval(checkOrt);
                        startAI();
                    } else if (attempts >= 100) {
                        clearInterval(checkOrt);
                        const script = document.createElement('script');
                        script.src = "ort.min.js";
                        script.onload = startAI;
                        document.head.appendChild(script);
                    }
                }, 100);
            }
        }, 500);
    });
}

function releaseAllKeys() {
    document.querySelectorAll('.key.active').forEach(key => {
        key.classList.remove('active');
        stopNote(key.dataset.note);
    });
}
window.addEventListener('mouseup', releaseAllKeys);

window.isNoteMapped = (note) => {
    const keyEl = document.querySelector(`.key[data-note="${note}"]`);
    return keyEl ? keyEl.classList.contains('key-assigned') : false;
};

