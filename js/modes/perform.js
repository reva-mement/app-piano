import { extractVideoId, showModal } from '../utils.js';
import { forceStopAll } from '../main.js';

// ★ ブラウザ環境（Tauriが存在しない）でもエラーで止まらないよう、安全に取得する
const WebviewWindow = window.__TAURI__?.webviewWindow?.WebviewWindow;

let videoWindow = null;
let pianoOverlayWindow = null;

/**
 * Performモードのインジケーターにテキストをセットし、一定速度で流す
 */
export function updatePerformVideoDisplay(text) {
    const display = document.getElementById('video-filename-display');
    if (!display) return;

    display.innerHTML = '';
    const span = document.createElement('span');
    span.className = 'scroll-text';
    span.textContent = text || "No Video Loaded";
    display.appendChild(span);

    // 1. 枠と文字の幅を取得
    const containerWidth = display.offsetWidth;
    const textWidth = span.offsetWidth || (span.textContent.length * 10);

    // 2. 移動全距離を計算（右端外から左端外まで）
    const totalDistance = containerWidth + textWidth;

    // 3. スピード設定 (Studioモードと同じ30px/s)
    const pixelsPerSecond = 30; 
    const duration = totalDistance / pixelsPerSecond;

    // 4. アニメーション再始動
    span.style.animation = 'none';
    span.offsetHeight; // リフロー強制
    span.style.setProperty('--container-width', `${containerWidth}px`);
    span.style.animation = `scroll-text ${duration}s linear infinite`;
}

// グローバル窓口として公開
window.updatePerformVideoDisplay = updatePerformVideoDisplay;

/**
 * モード初期化とUIイベント設定
 */
export function setupPerformSession() {
    const playBtn = document.getElementById('video-play-btn');
    const importBtn = document.getElementById('video-import-btn');
    const display = document.getElementById('video-filename-display');

    // PLAYボタンの処理
    if (playBtn) {
        playBtn.onclick = (e) => {
            e.stopPropagation();
            
            // 再生開始前に他のモード（Studio/Session）をすべて停止
            forceStopAll(); 

            // 表示要素から現在設定されているテキスト（URL）を取得
            const currentUrl = display.querySelector('.scroll-text') ? 
                               display.querySelector('.scroll-text').textContent : 
                               display.textContent;

            handlePerformStart(currentUrl); 
        };
    }

    // IMPORTボタンの処理
    if (importBtn) {
        importBtn.onclick = (e) => {
            e.stopPropagation();
            forceStopAll();

            const html = `
                <div class="import-modal-inner">
                    <div class="modal-title-stamp">IMPORT YOUTUBE VIDEO</div>
                    <div class="modal-input-wrapper">
                        <input type="text" class="modal-text-input" placeholder="https://www.youtube.com/...">
                    </div>
                    <div class="modal-confirm-btn">IMPORT</div>
                </div>
            `;

            showModal(html, (url) => {
                if (url) {
                    const videoId = extractVideoId(url);
                    if (videoId && display) {
                        // 文字を流す関数を呼び出す
                        updatePerformVideoDisplay(url);
                        console.log("URL updated and scrolling started.");
                    } else {
                        alert("有効なURLではありません。");
                    }
                }
            });
        };
    }
}

/**
 * ウィンドウ生成と再生制御
 */
async function handlePerformStart(url) {
    // 未設定または初期文字列の場合は警告
    if (!url || url === "No Video Loaded" || url.trim() === "") {
        const alertHtml = `
            <div style="text-align: center; padding: 10px;">
                <p style="margin-bottom: 20px; font-weight: bold; color: #e0d0b0;">
                    先に動画URLをインポートしてください。
                </p>
                <button class="modal-confirm-btn" 
                        style="padding: 8px 24px; cursor: pointer; background: linear-gradient(to bottom, #5d4037, #3d2b1f); color: white; border: 1px solid #2a1b15; border-radius: 2px;">
                    OK
                </button>
            </div>
        `;
        
        showModal(alertHtml, () => {
            console.log("Alert closed");
        });
        return;
    }

    const btn = document.getElementById('video-play-btn');
    const videoId = extractVideoId(url);

    // すでにウィンドウが開いている場合は「停止」処理
    if (videoWindow) {
        await videoWindow.close();
        if (pianoOverlayWindow) await pianoOverlayWindow.close();
        videoWindow = null;
        pianoOverlayWindow = null;
        btn.textContent = "▶ PLAY";
        forceStopAll();
        return;
    }

    if (!WebviewWindow) return;

    // メイン動画ウィンドウ生成
    videoWindow = new WebviewWindow('video-player', {
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: 'PianoWorks - Performing',
        fullscreen: true,
        alwaysOnTop: true,
    });

    // ピアノオーバーレイウィンドウ生成
    pianoOverlayWindow = new WebviewWindow('piano-overlay', {
        url: 'keyboard-overlay.html',
        width: 1300,
        height: 350,
        x: 0,
        y: 450,
        transparent: true,
        decorations: false,
        alwaysOnTop: true,
    });

    // オーバーレイを最前面にフォーカス
    setTimeout(async () => {
        if (pianoOverlayWindow) {
            await pianoOverlayWindow.setAlwaysOnTop(true);
            await pianoOverlayWindow.setFocus();
        }
    }, 500);

    // 窓を閉じた時の後処理
    videoWindow.once('tauri://close-requested', async () => {
        if (pianoOverlayWindow) await pianoOverlayWindow.close();
        videoWindow = null;
        pianoOverlayWindow = null;
        btn.textContent = "▶ PLAY";
        forceStopAll();
    });

    btn.textContent = "Ⅱ PAUSE";
}