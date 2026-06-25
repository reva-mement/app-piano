/* --- src/js/instruments/piano/ui.js --- */
import { PIANO_KEYS, WHITE_KEY_WIDTH_VW } from './config.js';

/* --- src/js/instruments/piano/ui.js --- */

export function renderKeys(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    // 既存の .map 部分を以下のように「2層構造」へ書き換えます
    canvas.innerHTML = PIANO_KEYS.map(k => `
        <div class="key-container ${k.t}" data-note="${k.n}">
            <div class="key-visual-layer"></div>
            
            <div class="key ${k.t}" data-note="${k.n}">
                <div class="key-label">${k.n}</div>
            </div>
        </div>`).join('');

    const whiteKeysCount = PIANO_KEYS.filter(k => k.t === 'white').length;
    canvas.style.width = `${whiteKeysCount * WHITE_KEY_WIDTH_VW}vw`;
}

/* --- src/js/instruments/piano/ui.js --- */

export function updateIndividualMapping(keyAssignments) {
    const viewport = document.getElementById('piano-viewport');
    const canvas = document.getElementById('piano-canvas');
    if (!viewport || !canvas) return;

    const scrollLeft = viewport.scrollLeft;
    const viewportWidth = viewport.clientWidth;
    
    // 修正：.key-container を基準に取得するようにします
    const containers = Array.from(canvas.querySelectorAll('.key-container'));

    keyAssignments.clear();

    const visibleContainers = containers.filter(el => {
        return (el.offsetLeft + el.offsetWidth > scrollLeft) && (el.offsetLeft < scrollLeft + viewportWidth);
    });

    visibleContainers.forEach((el, index) => {
        // .key-container から note 属性を取得
        const note = el.dataset.note;
        if (index < 88) {
            keyAssignments.set(index, note);
        }
    });

    // 修正：ラベルの更新。親要素の階層が変わっても確実に data-note を持っている .key を探す
    document.querySelectorAll('.key-label').forEach(label => {
        const keyEl = label.closest('.key');
        if (keyEl) {
            label.innerText = keyEl.dataset.note;
        }
    });
}

export function setupScrollLogic(viewport, minimapFrame) {
    // 既存のスクロール処理
    const sync = () => {
        if (minimapFrame) {
            minimapFrame.style.left = (viewport.scrollLeft / viewport.scrollWidth * 100) + "%";
            minimapFrame.style.width = (viewport.clientWidth / viewport.scrollWidth * 100) + "%";
        }
    };
    viewport.addEventListener('scroll', sync);
}