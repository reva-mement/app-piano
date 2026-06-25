/* src/js/modes/studio/player-ui.js */

/**
 * 再生ボタンの表示を更新する
 */
export function updatePlayButtonUI(state) {
    const playBtn = document.querySelector('#tag-studio .play-stamp');
    if (!playBtn) return;
    if (state === 'playing') {
        playBtn.textContent = "Ⅱ PAUSE";
        playBtn.classList.remove('paused');
    } else {
        playBtn.textContent = "▶ PLAY";
        playBtn.classList.toggle('paused', state === 'paused');
    }
}

/**
 * 曲名のスクロール表示を更新する
 */
export function updateStudioSongDisplay(fileName) {
    const display = document.getElementById('studio-song-display');
    if (!display) return;
    display.innerHTML = '';
    const span = document.createElement('span');
    span.className = 'scroll-text';
    span.textContent = fileName || "No Title";
    display.appendChild(span);
    const containerWidth = display.offsetWidth;
    const textWidth = span.offsetWidth || (span.textContent.length * 10);
    const totalDistance = containerWidth + textWidth;
    const pixelsPerSecond = 30; 
    const duration = totalDistance / pixelsPerSecond;
    span.style.animation = 'none';
    span.offsetHeight; 
    span.style.setProperty('--container-width', `${containerWidth}px`);
    span.style.animation = `scroll-text ${duration}s linear infinite`;
}

/**
 * 秒数を 00:00 形式に変換
 */
export const formatTime = (s) => {
    const ts = Math.max(0, Math.floor(s || 0));
    const min = Math.floor(ts / 60).toString().padStart(2, '0');
    const sec = (ts % 60).toString().padStart(2, '0');
    return `${min}:${sec}`;
};

/**
 * ガイドボタンの状態（OFF / GUIDE / PP）に合わせて表示を更新する
 */
export function updateGuideButtonUI(mode) {
    const guideBtn = document.querySelector('#tag-studio .guide-stamp');
    if (!guideBtn) return;
    if (mode === 'guide') {
        guideBtn.textContent = "GAME ON";
        guideBtn.classList.add('active');
        guideBtn.style.backgroundColor = "var(--accent-color)";
    } else if (mode === 'pp') {
        guideBtn.textContent = "P-PIANIST";
        guideBtn.classList.add('active');
        guideBtn.style.backgroundColor = "#ff00ff"; // 目立つ色
    } else {
        guideBtn.textContent = "GAME OFF";
        guideBtn.classList.remove('active');
        guideBtn.style.backgroundColor = "";
    }
}