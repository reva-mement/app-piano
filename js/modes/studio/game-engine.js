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

        // ★ 落下スピードをBPMに連動させるための基準値。
        //   120bpmを基準(倍率1.0)として、テンポが速い曲ほどブロックも速く落ちるようにする。
        this.bpm = 120;
        this.baseSpeed = 3.5;

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
    // 判定ライン（上の実線・下の実線・鍵盤を除いた高さの半分）を計算
    // render() のガイド線描画と同じ基準（pianoTopY）を使う
    // -------------------------
    getJudgeLines() {
        const pianoCanvas = document.getElementById('piano-canvas');
        const pianoTopY = pianoCanvas
            ? pianoCanvas.getBoundingClientRect().top - this.canvas.getBoundingClientRect().top
            : this.canvas.height;

        return {
            pianoTopY,
            topLineY: pianoTopY - 120,   // 上の実線
            bottomLineY: pianoTopY - 30, // 下の実線
            halfY: pianoTopY / 2         // 鍵盤を除いた高さの半分
        };
    }

    // -------------------------
    // ブロックのY座標 → 得点を判定
    // 戻り値: { hittable: boolean, score: number }
    //   hittable=false のときは「そもそも消せない」（上半分）
    // -------------------------
    judgeBlockScore(blockY) {
        const { topLineY, bottomLineY, halfY } = this.getJudgeLines();

        // ★ 鍵盤を除いた高さの半分より上のブロックは、そもそも消せない
        if (blockY < halfY) {
            return { hittable: false, score: 0 };
        }

        // ★ 半分より下だが、上の実線〜下の実線の枠の外 → 消せるが0点
        if (blockY < topLineY || blockY > bottomLineY) {
            return { hittable: true, score: 0 };
        }

        // ★ 上の実線〜下の実線を9分割し、中心（5番目）からの距離で採点
        //   中心=100点、1段階外れるごとに-10点（90/80/70/60点）
        const zoneHeight = bottomLineY - topLineY;   // 90px想定
        const sectionHeight = zoneHeight / 9;
        const relativeY = blockY - topLineY;
        let sectionIndex = Math.floor(relativeY / sectionHeight);
        sectionIndex = Math.min(8, Math.max(0, sectionIndex)); // 0〜8にクランプ

        const centerIndex = 4; // 9分割の中心（0始まりで4番目）
        const distanceFromCenter = Math.abs(sectionIndex - centerIndex);
        const score = 100 - distanceFromCenter * 10; // 100/90/80/70/60

        return { hittable: true, score };
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
        const judge = this.judgeBlockScore(block.y);

        // ★ 上半分にあるブロックは、鍵盤を叩いても消えない（何も起きない）
        if (!judge.hittable) {
            this.activeKeys.add(normalized);
            setTimeout(() => {
                this.activeKeys.delete(normalized);
            }, 100);
            return;
        }

        // ブロックの現在位置を計算
        const keyEl = (block.keyEl && document.body.contains(block.keyEl))
            ? block.keyEl
            : document.querySelector(`.key[data-note="${block.noteName}"]`);
        const viewport = document.getElementById('piano-viewport');
        const viewportRect = viewport.getBoundingClientRect();
        const rect = keyEl.getBoundingClientRect();

        const renderX = (rect.left - viewportRect.left) + (rect.width / 2);
        const renderY = block.y;

        // ★★★ ここでスコア判定を記録 ★★★
        if (window.blockResults) {
            window.blockResults.push({
                note: block.noteName,
                score: judge.score,                 // ★ 9分割判定によるスコア（0/60/70/80/90/100）
                octave: block.noteName.replace(/\d+/, ''),
                accuracyPercent: judge.score,        // 既存の表示フィールドと互換をとる
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

    // ★ 曲のBPMをセットする。落下スピードはaddFallingBlock側で毎回この値を参照する。
    setBpm(bpm) {
        if (typeof bpm === 'number' && bpm > 0) {
            this.bpm = bpm;
        }
    }

    // -------------------------
    // 同音の既存ブロック削除（新しいブロックを積む前のクリーンアップ用）
    // -------------------------
    // ★★★ 修正：以前は同じ音のブロックを「全部」消していたため、
    //   1回の打鍵で同じ音の列がまとめて消えてしまっていた。
    //   同じ音のうち「最新（配列の末尾＝一番あとに追加された＝まだ画面上部にある）」の
    //   1個だけを消すようにする。
    removeBlock(noteName) {
        const normalized = noteName.replace('#', 's');
        for (let i = this.blocks.length - 1; i >= 0; i--) {
            if (this.blocks[i].noteName === normalized) {
                this.blocks.splice(i, 1);
                break; // 1個だけ消したら終了
            }
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

    // ★★★ 修正：連打の実測間隔から速度を逆算する方式を撤回。
    //   MIDIプレイヤー側で「溜まったイベントを一気にまとめて処理する」ようになったため、
    //   本来は離れた瞬間に鳴るはずの同じ音同士が、実際の処理タイミングとしては
    //   ごく短い間隔で処理されてしまうケースがあり、それを「連打」と誤認して
    //   異常に速い（ほぼ一瞬で落ちきる）速度を計算してしまっていた。
    //   シンプルにBPM比例の速度だけに戻す。
    const speed = this.baseSpeed * (this.bpm / 120);

this.blocks.push({
    noteName,
    y: -30,
    speed,
    color,
    // ★★★ 修正：毎フレーム document.querySelector し直していたのをやめ、
    //   生成時に1回だけ鍵盤要素を取得してブロック自身に保持させる。
    //   一瞬でも要素が見つからないフレームがあると、その回は描画自体が
    //   スキップされ「ブロックが途中で消える」ように見えていた可能性がある。
    keyEl: document.querySelector(`.key[data-note="${noteName}"]`)
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

    // ★★★ 修正：以前はここで .guide-active を即座に全解除していたが、
    //   それだと ESC を押した「一時停止の瞬間」に鍵盤の色が消えてしまっていた。
    //   本来は「はい」で中断が確定したタイミング（studio.js の
    //   handleStopMIDI 側）でのみ解除したいので、ここでは何もしない。
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

    // --- ★ ユーザーが実際に押した鍵盤（.from-user）だけから、上に向かって伸びる
    //      懐中電灯のような自然な光のエフェクト（AI/自動再生の音では発生しない） ---
    const heldKeys = document.querySelectorAll('.key.active.from-user');
    heldKeys.forEach(keyEl => {
        const rect = keyEl.getBoundingClientRect();
        const beamX = (rect.left - viewportRect.left) + (rect.width / 2);
        const beamWidth = rect.width; // ★ 鍵盤の幅とそろえる
        const beamTop = 0;
        const beamBottom = pianoTopY;

        this.ctx.save();
        this.ctx.filter = 'blur(6px)'; // ★ 輪郭をぼかして自然光らしい柔らかさに

        // 懐中電灯のビームのような縦グラデーション（鍵盤側が明るく、上にいくほど自然に消える）
        const gradient = this.ctx.createLinearGradient(0, beamBottom, 0, beamTop);
        gradient.addColorStop(0, 'rgba(255, 248, 220, 0.5)');
        gradient.addColorStop(0.35, 'rgba(255, 240, 190, 0.16)');
        gradient.addColorStop(1, 'rgba(255, 240, 190, 0)');
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(beamX - beamWidth / 2, beamTop, beamWidth, beamBottom - beamTop);

        // 光源（鍵盤側）にふわっとした光だまりを重ねる
        const glow = this.ctx.createRadialGradient(beamX, beamBottom, 0, beamX, beamBottom, beamWidth);
        glow.addColorStop(0, 'rgba(255, 250, 230, 0.55)');
        glow.addColorStop(1, 'rgba(255, 250, 230, 0)');
        this.ctx.fillStyle = glow;
        this.ctx.fillRect(beamX - beamWidth, beamBottom - beamWidth, beamWidth * 2, beamWidth * 2);

        this.ctx.restore();
    });


    // --- ブロック更新 ---
    this.blocks = this.blocks.filter(block => {
        block.y += block.speed;

        // ★ 生成時にキャッシュした要素を使う。DOMから外れていた場合だけ再取得する。
        if (!block.keyEl || !document.body.contains(block.keyEl)) {
            const refreshed = document.querySelector(`.key[data-note="${block.noteName}"]`);
            if (refreshed) {
                console.warn(`[GameEngine] note=${block.noteName} の鍵盤要素がDOMから外れていたため再取得しました。`);
            } else {
                console.warn(`[GameEngine] note=${block.noteName} の鍵盤要素がDOM上に見つかりません（描画スキップ）。y=${block.y.toFixed(1)}`);
            }
            block.keyEl = refreshed;
        }
        const keyEl = block.keyEl;
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
