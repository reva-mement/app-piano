/* src/js/utils.js */

// ==========================================
// 1. 汎用ユーティリティ (UI/System)
// ==========================================

// ボリューム更新のブリッジ
export function updateMasterVolume(volume) {
    if (window.pianoGain && window.audioContext) {
        window.pianoGain.gain.setTargetAtTime(volume, window.audioContext.currentTime, 0.01);
    }
}

/* src/js/utils.js */

/* src/js/utils.js */
export function isNoteInView(noteName) {
    const keyEl = document.querySelector(`.key[data-note="${noteName}"]`);
    // piano.jsが「ここは担当範囲だ」と判断して付けたクラスだけを信じる
    return keyEl ? keyEl.classList.contains('key-assigned') : false;
}

// YouTube等のURLからIDを抽出
export function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length == 11) ? match[2] : null;
}

// ガイド用のハイライト
export function highlightGuideKey(noteName) {
    const keyElement = document.querySelector(`.key[data-note="${noteName}"]`);
    if (keyElement) {
        keyElement.style.setProperty('background-color', 'gold', 'important');
        keyElement.style.setProperty('box-shadow', '0 0 30px 10px gold', 'important');
    }
}

// モーダルを表示する共通関数
export function showModal(contentHtml, onConfirm) {
    const overlay = document.getElementById('common-modal-overlay');
    const container = document.getElementById('modal-dynamic-content');
    const closeBtn = document.getElementById('modal-close-btn');

    if (!overlay || !container) return;

    container.innerHTML = contentHtml;
    overlay.style.display = 'flex';

    const confirmBtn = container.querySelector('.modal-confirm-btn');
    if (confirmBtn) {
        confirmBtn.onclick = () => {
            const input = container.querySelector('input');
            onConfirm(input ? input.value : null);
            closeModal();
        };
    }

    closeBtn.onclick = closeModal;
    overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
}

function closeModal() {
    const overlay = document.getElementById('common-modal-overlay');
    if (overlay) overlay.style.display = 'none';
}

// ==========================================
// 1.5 Web版 / ローカル版 判定
// ==========================================

/**
 * ローカル(Tauri)アプリ版かどうかを判定する。
 * Tauriランタイムは起動時に window.__TAURI__ を自動的に注入するため、
 * これが存在すればローカル(有料)版、存在しなければWebブラウザ(体験)版とみなす。
 * ★ main.js / playnote-db.js の外部リンクオープン処理と同じ判定方式に統一している。
 * ★ あくまでクライアントサイドの機能差別化用の判定であり、堅牢なライセンス認証ではない点に注意。
 */
export function isLocalApp() {
    return !!(typeof window !== 'undefined' && window.__TAURI__);
}

/**
 * Web(体験)版で有料限定機能が使われようとした際の共通案内。
 * showToast (playnote-db.js側でwindowに公開) があればそれを使い、無ければalertにフォールバックする。
 */
export function showLocalOnlyToast(featureLabel) {
    const message = `${featureLabel}は、ローカル版（有料）限定の機能です。\n\nローカル版をご購入いただくと、フル機能でご利用いただけます。`;
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast(message);
    } else if (typeof window !== 'undefined') {
        window.alert(message);
    }
}

/**
 * ★ Web(体験)版限定：有料版限定機能のボタンを押した時に、
 *   ボタンのすぐ下に「有償版限定機能となります」＋LevaCraft(BOOTH)へのリンクを
 *   表示するツールチップ。外側クリックで閉じる。
 */
const PAID_FEATURE_LINK = "https://levacraft.booth.pm/?_gl=1*1haa0h6*_ga*MTEzOTAzOTI4My4xNzg0MDI5ODg4*_ga_RWT2QKJLDC*czE3ODQyMTE1NTQkbzMkZzEkdDE3ODQyMTE1NzEkajQzJGwwJGgw";

export function showPaidFeatureTooltip(anchorEl) {
    if (!anchorEl) return;

    // ★ 既に表示中のツールチップがあれば消す
    const existing = document.getElementById('paid-feature-tooltip');
    if (existing) existing.remove();

    const tooltip = document.createElement('div');
    tooltip.id = 'paid-feature-tooltip';
    tooltip.className = 'paid-feature-tooltip';
    tooltip.innerHTML = `
        <div class="paid-feature-tooltip-close" title="閉じる">×</div>
        <div class="paid-feature-tooltip-text">有償版限定機能となります</div>
        <a href="${PAID_FEATURE_LINK}" target="_blank" rel="noopener noreferrer" class="paid-feature-tooltip-link">LevaCraft（BOOTH）はこちら</a>
    `;
    (document.getElementById('app-scale-wrapper') || document.body).appendChild(tooltip);

    // ★ ラッパー(#app-scale-wrapper)にtransform: scale(...)がかかっているため、
    //   実画面座標(getBoundingClientRect)をそのままstyle.left/topに使うと
    //   縮小・拡大時にズレる。ラッパー基準・スケール前の座標系に変換してから使う。
    const wrapper = document.getElementById('app-scale-wrapper');
    const wrapperRect = wrapper ? wrapper.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth };
    const scale = wrapper ? (wrapperRect.width / (window.APP_DESIGN_WIDTH || wrapperRect.width)) : 1;

    const rect = anchorEl.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect(); // 実画面サイズ（スケール後）
    const margin = 8;

    // ★ 実画面座標での計算（画面端からのはみ出し判定は「本物の画面」基準で行う）
    let topScreen = rect.bottom + margin;
    if (topScreen + tooltipRect.height > window.innerHeight) {
        topScreen = rect.top - tooltipRect.height - margin;
        if (topScreen < margin) topScreen = margin;
    }

    let leftScreen = rect.left;
    if (leftScreen + tooltipRect.width > window.innerWidth - margin) {
        leftScreen = window.innerWidth - tooltipRect.width - margin;
    }
    if (leftScreen < margin) leftScreen = margin;

    // ★ 実画面座標 → ラッパー基準・スケール前の座標系に変換してから適用する
    const top = (topScreen - wrapperRect.top) / scale;
    const left = (leftScreen - wrapperRect.left) / scale;

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;

    // ★ 「固定」表示：自動では閉じない。×ボタンでのみ閉じる。
    const closeBtn = tooltip.querySelector('.paid-feature-tooltip-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            tooltip.remove();
        });
    }
}

// ==========================================
// 2. 音楽理論モジュール (THEORY)
// ==========================================

export const THEORY = {
    notes: ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'],
    scales: { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] },
    
    noteToMidi(n) {
        const m = n.match(/^([A-G]s?)(\d)$/);
        return m ? (parseInt(m[2]) + 1) * 12 + this.notes.indexOf(m[1]) : 60;
    },
    
    midiToNote(m) {
        return `${this.notes[m % 12]}${Math.floor(m / 12) - 1}`;
    },

    getAvailableMidis(rootKey, scaleType) {
        const rootIndex = this.notes.indexOf(rootKey);
        const intervals = this.scales[scaleType];
        const midis = [];
        for (let oct = 0; oct <= 8; oct++) {
            intervals.forEach(interval => {
                const midi = (oct + 1) * 12 + rootIndex + interval;
                if (midi >= 21 && midi <= 108) midis.push(midi);
            });
        }
        return midis;
    }
};

// ==========================================
// 3. 音楽の記憶 (MotifManager)
// ==========================================

export class MotifManager {
    constructor() {
        this.intervals = []; 
        this.isLocked = false;
    }
    record(notes) {
        if (this.isLocked || notes.length < 3) return;
        const lastNotes = notes.slice(-8); 
        this.intervals = [];
        for (let i = 1; i < lastNotes.length; i++) {
            this.intervals.push(THEORY.noteToMidi(lastNotes[i].note) - THEORY.noteToMidi(lastNotes[i-1].note));
        }
        if (this.intervals.length >= 7) this.isLocked = true; 
    }
    getMotif(startMidi) {
        if (this.intervals.length === 0) return [];
        let current = startMidi;
        return this.intervals.map(inter => {
            current += inter;
            return THEORY.midiToNote(current);
        });
    }
}