/* ============================================================
   簡易チュートリアル（Web版限定・モーダルスライド形式）
   ============================================================
   ・初回訪問時に自動で表示する
   ・設定画面の「もう一度見る」からもいつでも開ける
   ・対象：MIDI取込／GAME ON／背景設定／鍵盤の視界範囲の4つ
   ============================================================ */

import { isLocalApp } from './utils.js';

const TUTORIAL_SEEN_KEY = 'pw_seen_tutorial';

const SLIDES = [
    {
        icon: '🎵',
        title: 'MIDIを取り込もう',
        text: '画面右側の「IMPORT MIDI」から、お手持ちのMIDIファイルを読み込めます。\n読み込んだ曲はStudioモードで練習できるようになり、自動的にJukeboxにも登録されます。'
    },
    {
        icon: '🎮',
        title: 'GAME ONで練習しよう',
        text: 'Studioタグの「GAME ON」を押してから▶PLAYすると、リズムゲーム形式の練習が始まります。\n降ってくるブロックに合わせて鍵盤を弾いてみましょう。プレイ後はスコアが表示されます。'
    },
    {
        icon: '🖼️',
        title: '背景をカスタマイズしよう',
        text: '設定（右上の歯車）から、再生中の背景をURL（YouTube動画など）や好きな画像に変更できます。\n再生を始めると反映され、停止すると元の背景に戻ります。'
    },
    {
        icon: '🎹',
        title: '弾く音階を調整しよう',
        text: '設定（右上の歯車）の「演奏視界の広さ」から、ハイライトされる音域の広さを調整できます。\n練習したい範囲に合わせて、見やすい広さに変えてみてください。'
    },
    {
        icon: '🔁',
        title: 'このチュートリアルはいつでも見返せます',
        text: '設定（右上の歯車）を開くと、CANCELボタンの左側に「チュートリアル」ボタンがあります。\n操作を忘れてしまった時は、ここからいつでもこの説明をもう一度確認できます。'
    }
];

let currentSlideIndex = 0;

function renderSlide() {
    const slide = SLIDES[currentSlideIndex];
    const iconEl = document.getElementById('tutorial-slide-icon');
    const titleEl = document.getElementById('tutorial-slide-title');
    const textEl = document.getElementById('tutorial-slide-text');
    const prevBtn = document.getElementById('tutorial-prev-btn');
    const nextBtn = document.getElementById('tutorial-next-btn');
    const dotsContainer = document.getElementById('tutorial-dots');

    if (iconEl) iconEl.textContent = slide.icon;
    if (titleEl) titleEl.textContent = slide.title;
    if (textEl) textEl.innerHTML = slide.text.replace(/\n/g, '<br>');

    if (prevBtn) prevBtn.style.visibility = (currentSlideIndex === 0) ? 'hidden' : 'visible';
    if (nextBtn) nextBtn.textContent = (currentSlideIndex === SLIDES.length - 1) ? '閉じる' : '次へ';

    if (dotsContainer) {
        dotsContainer.innerHTML = SLIDES.map((_, i) =>
            `<span class="tutorial-dot${i === currentSlideIndex ? ' active' : ''}"></span>`
        ).join('');
    }
}

function openTutorial() {
    const overlay = document.getElementById('tutorial-modal-overlay');
    if (!overlay) return;
    currentSlideIndex = 0;
    renderSlide();
    overlay.style.display = 'flex';
}

function closeTutorial() {
    const overlay = document.getElementById('tutorial-modal-overlay');
    if (overlay) overlay.style.display = 'none';
    // ★ 一度でも開いたら「見た」扱いにする（自動表示は初回だけにするため）
    localStorage.setItem(TUTORIAL_SEEN_KEY, '1');
}

export function setupTutorial() {
    // ★ Web版限定機能。ローカル版では何もしない。
    if (isLocalApp()) return;

    const overlay = document.getElementById('tutorial-modal-overlay');
    const closeBtn = document.getElementById('tutorial-close-btn');
    const prevBtn = document.getElementById('tutorial-prev-btn');
    const nextBtn = document.getElementById('tutorial-next-btn');
    const reopenBtn = document.getElementById('tutorial-reopen-btn');

    if (!overlay) return;

    // ★ 「もう一度見る」ボタンは、Web版でのみ表示する
    if (reopenBtn) reopenBtn.style.display = 'flex';

    if (closeBtn) closeBtn.addEventListener('click', closeTutorial);
    if (reopenBtn) reopenBtn.addEventListener('click', openTutorial);

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentSlideIndex > 0) {
                currentSlideIndex--;
                renderSlide();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (currentSlideIndex < SLIDES.length - 1) {
                currentSlideIndex++;
                renderSlide();
            } else {
                closeTutorial();
            }
        });
    }

    // 背景クリックでは閉じない（誤操作防止。×か「閉じる」で明示的に閉じる）

    // ★ 初回訪問時のみ、自動で表示する
    if (!localStorage.getItem(TUTORIAL_SEEN_KEY)) {
        // ★ ローディング画面が終わるタイミングに合わせて表示する
        setTimeout(() => {
            openTutorial();
        }, 6500);
    }
}
