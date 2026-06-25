export class StudioGameEngine {
    constructor(parentContainer) {
        console.log("DEBUG: StudioGameEngine constructor called with:", parentContainer);
        
        if (!parentContainer) {
            console.error("CRITICAL ERROR: parentContainer is null!");
            return;
        }

        this.container = parentContainer;
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'sg-canvas-element';
        this.container.appendChild(this.canvas);

        // ★ ESC中断ガイド文言（左上・Sessionモードと同じ表現）
        this.escHint = document.createElement('div');
        this.escHint.id = 'sg-esc-hint';
        this.escHint.innerText = 'ESC押すと中断することができます';
        this.container.appendChild(this.escHint);

        this.ctx = this.canvas.getContext('2d');
        this.isRunning = false;

        this.blocks = [];
        this.particles = [];
        this.activeKeys = new Set();

        this.boundResize = this.resize.bind(this);
        window.addEventListener('resize', this.boundResize);

        this.cancelled = false;        // ★ 完全中断（ESC→はい）フラグ
        this.awaitingDecision = false; // ★ ESCダイアログ表示中の「待機」フラグ（カウントダウン凍結用）
        this.wasRunningWhenPaused = false;

        this.resize();
    }

        // -------------------------
    // ★ カウントダウン（⑤→⓪）
    // -------------------------
    async showCountdown() {
        const numbers = ["⑤", "④", "③", "②", "①", "⓪"];

        for (let num of numbers) {
            // ★ 中断（ESC→はい）されていたら即座にカウントダウンを切り上げる
            if (this.cancelled) return;

            // ★ ESCダイアログ表示中（まだ「はい/いいえ」未選択）はここで待機する。
            //   これが無いと、ESC→いいえ で「カウントダウンを再開」ではなく
            //   「カウントダウンを飛び越えていきなりゲーム開始」になってしまう。
            while (this.awaitingDecision) {
                await new Promise(res => setTimeout(res, 100));
            }
            if (this.cancelled) return;

            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            this.ctx.save();
            this.ctx.fillStyle = "rgba(255,255,255,0.9)";
            this.ctx.font = "120px sans-serif";
            this.ctx.textAlign = "center";
            this.ctx.textBaseline = "middle";
            this.ctx.fillText(num, this.canvas.width / 2, this.canvas.height / 2);
            this.ctx.restore();

            await new Promise(res => setTimeout(res, 1000));
        }

        if (this.cancelled) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // -------------------------
    // パーティクル生成
    // -------------------------
    createParticles(x, y, color) {
        const starCount = 6 + Math.floor(Math.random() * 4); // 6〜10個
        const blockWidth = 40; // ブロックの描画幅と合わせる

        for (let i = 0; i < starCount; i++) {
            this.particles.push({
                x: x - blockWidth / 2 + Math.random() * blockWidth, // ★ 横方向ランダム
                y,
                size: 4 + Math.random() * 3,
                maxSize: 10 + Math.random() * 6,
                life: 30 + Math.random() * 10,
                blinkSpeed: 0.2 + Math.random() * 0.3,
                color: `hsl(${Math.random() * 360}, 90%, 70%)`, // ランダム色
                angle: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 0.1
            });
        }
    }

        // -------------------------
    // ガイド音のハイライト（今は軽めの実装）
    // -------------------------
    highlightGuideNote(noteName) {
        const normalized = noteName.replace('#', 's');

        // 必要なら activeKeys を使って描画に反映する余地を残す
        this.activeKeys.add(normalized);
        setTimeout(() => {
            this.activeKeys.delete(normalized);
        }, 100);
    }



    // -------------------------
    // キー入力 → 最古ブロック削除
    // -------------------------
handleKeyPress(noteName) {
    console.log("[DEBUG] handleKeyPress noteName:", noteName);
    const normalized = noteName.replace('#', 's');

    const hitIndex = this.blocks.findIndex(b => b.noteName === normalized);

    if (hitIndex !== -1) {
        const block = this.blocks[hitIndex];

        // ブロックの現在位置を計算
        const keyEl = document.querySelector(`[data-note="${block.noteName}"]`);
        const viewport = document.getElementById('piano-viewport');
        const viewportRect = viewport.getBoundingClientRect();
        const rect = keyEl.getBoundingClientRect();

        const renderX = (rect.left - viewportRect.left) + (rect.width / 2);
        const renderY = block.y;

        // ★★★ ここでスコア判定を記録 ★★★
        if (window.blockResults) {
            const keyY = rect.top - this.canvas.getBoundingClientRect().top;
            //const d = Math.abs(keyY - renderY);  // 誤差(px)
const d = 0;

window.blockResults.push({
    note: block.noteName,
    d,
    octave: block.noteName.replace(/\d+/, ''),
    accuracyPercent: 100,
    seq: window.blockResults.length + 1
});

        }

        // ★ 押した瞬間に爆発
        this.createParticles(renderX, renderY, block.color);

        // ★ ブロック削除
        this.blocks.splice(hitIndex, 1);
    }

    // キーのハイライト処理
    this.activeKeys.add(normalized);
    setTimeout(() => {
        this.activeKeys.delete(normalized);
    }, 100);
}



    // -------------------------
    // 最古ブロック削除（パーティクル発生）
    // -------------------------
    removeOldestBlock() {
        if (this.blocks.length === 0) return;

        const removed = this.blocks.shift();
        console.log(`✨ [Engine] 最古ブロック削除: ${removed.noteName}`);

        const keyEl = document.querySelector(`[data-note="${removed.noteName}"]`);
        if (keyEl) {
            const rect = keyEl.getBoundingClientRect();
            const viewport = document.getElementById('piano-viewport');
            const viewportRect = viewport.getBoundingClientRect();

            const x = (rect.left - viewportRect.left) + rect.width / 2;
            const y = rect.top - this.canvas.getBoundingClientRect().top;

            this.createParticles(x, y, removed.color);
        }
    }

    // -------------------------
    // ブロック生成
    // -------------------------
addFallingBlock(noteName) {
    if (!window.totalSpawnedBlocks) window.totalSpawnedBlocks = 0;
    window.totalSpawnedBlocks++;

    const isBlackKey = noteName.includes('s');

    const color = isBlackKey
        ? `hsl(${260 + Math.random() * 20}, 70%, 60%)`
        : `hsl(${40 + Math.random() * 20}, 80%, 65%)`;

this.blocks.push({
    noteName,
    y: -30,
    speed: 5.0,
    color
});
}


    // -------------------------
    // Canvas リサイズ
    // -------------------------
    resize() {
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
    }

// -------------------------
// エンジン開始（カウントダウン付き）
// -------------------------
async start() {
    window.blockResults = [];   // ← ★これが必要
    window.totalSpawnedBlocks = 0;

    this.isRunning = false;
    this.cancelled = false;
    this.awaitingDecision = false;

    // ★ ESCガイド文言：毎回アニメーションを最初から再生し直す
    if (this.escHint) {
        this.escHint.classList.remove('sg-esc-hint-flash');
        void this.escHint.offsetWidth; // 強制リフローでアニメーションを再起動
        this.escHint.classList.add('sg-esc-hint-flash');
    }

    await this.showCountdown();

    // ★ カウントダウン中に ESC→はい 等で中断された場合は開始しない
    if (this.cancelled) return;

    this.isRunning = true;
    this.render();
}


// -------------------------
// 一時停止（ESCダイアログ表示時）
// -------------------------
pause() {
    // ★ カウントダウン中だったか、もう本編が始まっていたかを記録しておく
    //   （いいえ選択時、どちらに戻すべきかの判断に使う）
    this.wasRunningWhenPaused = this.isRunning;

    this.isRunning = false;

    // ★ カウントダウン中であれば、ループを終了させず「凍結」させる。
    //   （これが無いと、ESCで「はい」を押してもカウントダウンが裏で
    //    最後まで進み、後からゲームが勝手に始まってしまう。
    //    また「いいえ」を選んだ際にカウントダウンを正しく再開できない）
    this.awaitingDecision = true;

    if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
    }

    // ガイドラインのハイライト解除
    document.querySelectorAll('.guide-active')
        .forEach(el => el.classList.remove('guide-active'));
}

// -------------------------
// ESC→いいえ：中断キャンセル（再開）
// -------------------------
resumeAfterPause() {
    // ★ カウントダウン中に凍結していた場合、ここで解除すると
    //   showCountdown() の待機ループが自然に続きを再開する
    this.awaitingDecision = false;
}

// -------------------------
// ESC→はい：完全中止
// -------------------------
cancelCountdown() {
    this.cancelled = true;
    this.awaitingDecision = false; // 凍結中の待機ループを抜けさせる
}

async stop() {
    this.isRunning = false;
    window.removeEventListener('resize', this.boundResize);

    if (this.canvas.parentNode) {
        this.canvas.parentNode.removeChild(this.canvas);
    }
    if (this.escHint && this.escHint.parentNode) {
        this.escHint.parentNode.removeChild(this.escHint);
    }

    console.log("Studio Mode Finished. Calculating score...");

    // ★★★ スコア集計（保存は studio.js の ESC ハンドラ側で行う）★★★
    const rangeWidth = window.currentRangeWidth || 1.0;
    const results = window.blockResults || [];

    if (results.length > 0) {
        const result = calcTotalScore(results, rangeWidth);
        console.log("Studio score calculated:", result);
    } else {
        console.log("No blocks hit → score not calculated");
    }

    // ★ コンソール出力（任意）
    outputStudioScoreToConsole();

    // 次回のためにリセット
    window.blockResults = [];
    window.totalSpawnedBlocks = 0;
    window.isStudioMode = false;
}


// -------------------------
// メイン描画ループ
// -------------------------
render() {
    if (!this.isRunning) return;

    const pianoCanvas = document.getElementById('piano-canvas');

    // ★ ESC ダイアログ中などで piano-canvas が一時的に消える対策
    if (!pianoCanvas) {
        this.animationFrameId = requestAnimationFrame(() => this.render());
        return;
    }

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // --- ガイド線 ---
    let pianoTopY = pianoCanvas
        ? pianoCanvas.getBoundingClientRect().top - this.canvas.getBoundingClientRect().top
        : this.canvas.height;

    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    this.ctx.lineWidth = 1;
    [30, 120].forEach(offset => {
        this.ctx.beginPath();
        this.ctx.moveTo(0, pianoTopY - offset);
        this.ctx.lineTo(this.canvas.width, pianoTopY - offset);
        this.ctx.stroke();
    });
    this.ctx.restore();

this.ctx.save();
this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'; // 既存より濃い
this.ctx.lineWidth = 1;
this.ctx.setLineDash([8, 6]);
this.ctx.beginPath();
this.ctx.moveTo(0, pianoTopY - 75);
this.ctx.lineTo(this.canvas.width, pianoTopY - 75);
this.ctx.stroke();
this.ctx.restore();

    const viewport = document.getElementById('piano-viewport');
    if (!viewport) return;
    const viewportRect = viewport.getBoundingClientRect();

    const notesToLightUp = new Set();
    const startFadeY = pianoTopY - 120;
    const endFadeY = pianoTopY - 30;

    // --- ブロック更新 ---
    this.blocks = this.blocks.filter(block => {
        block.y += block.speed;

        const keyEl = document.querySelector(`[data-note="${block.noteName}"]`);
        if (keyEl) {
            const rect = keyEl.getBoundingClientRect();
            const renderX = (rect.left - viewportRect.left) + (rect.width / 2) - 20;

            let opacity = 1.0;
            if (block.y > startFadeY && block.y < endFadeY) {
                opacity = 1 - (block.y - startFadeY) / (endFadeY - startFadeY);
            } else if (block.y >= endFadeY) {
                opacity = 0;
            }

            // --- ブロック描画 ---
            this.ctx.save();
            this.ctx.globalAlpha = opacity;
            this.ctx.fillStyle = block.color;
            this.ctx.fillRect(renderX, block.y, 40, 10);
            this.ctx.restore();

            // --- ハイライト対象 ---
            if (block.y > -30 && block.y < pianoTopY) {
                notesToLightUp.add(block.noteName);
            }

        }

        // ★ 爆発後に削除
        return block.y < endFadeY;
    });

    // --- 鍵盤ハイライト ---
    if (pianoCanvas) {
        pianoCanvas.querySelectorAll('.key').forEach(keyEl => {
            const note = keyEl.dataset.note;
            if (notesToLightUp.has(note)) {
                keyEl.classList.add('guide-active');
            } else {
                keyEl.classList.remove('guide-active');
            }
        });
    }

// --- 星パーティクル描画 ---
this.particles = this.particles.filter(p => {
    p.size += 0.2;           // 少しずつ拡大
    p.angle += p.rotationSpeed; // ゆっくり回転
    p.life--;

    // ★ 瞬き（sin波で明滅）
    const blink = (Math.sin(p.life * p.blinkSpeed) + 1) / 2; // 0〜1
    const alpha = (p.life / 40) * blink;

    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = p.color;

    // ★ 星型を描く
    this.ctx.beginPath();
    const spikes = 5;
    const outer = p.size;
    const inner = p.size / 2;
    let rot = p.angle;
    let cx = p.x;
    let cy = p.y;

    this.ctx.moveTo(cx, cy - outer);
    for (let i = 0; i < spikes; i++) {
        this.ctx.lineTo(
            cx + Math.cos(rot) * outer,
            cy + Math.sin(rot) * outer
        );
        rot += Math.PI / spikes;

        this.ctx.lineTo(
            cx + Math.cos(rot) * inner,
            cy + Math.sin(rot) * inner
        );
        rot += Math.PI / spikes;
    }
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.restore();

    return p.life > 0;
});
     this.animationFrameId = requestAnimationFrame(() => this.render());
}

}

// -------------------------
// シングルトン生成
// -------------------------
let instance = null;
export function getStudioGameEngine(parentContainer) {
    if (!instance) {
        instance = new StudioGameEngine(parentContainer);
        window.gameEngine = instance;
    }
    return instance;
}
