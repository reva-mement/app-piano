/* ============================================================
   Scoring モーダルの開閉処理
   ============================================================ */
import { THEORY } from '../../utils.js';

export function setupScoreBoard() {
    const scoreOverlay = document.getElementById('pw-score-board');
    const openScoreBtn = document.getElementById('pw-open-score'); // 選択モーダルのボタン
    const closeScoreBtn = document.getElementById('pw-score-close');
    const closeScoreX = document.getElementById('pw-score-close-x');

    if (!scoreOverlay) {
        console.error("Scoring modal not found: #pw-score-board");
        return;
    }

    // --- 開く ---
if (openScoreBtn) {
openScoreBtn.addEventListener('click', async () => {
    closeSelectModal();
    scoreOverlay.style.display = 'flex';

    // ★ モーダルを開くたびにスコア一覧を再描画（＝Sparklineも再アニメ）
    await renderStudioScoreList();

    console.log("Score Mode: Opened");
});


}


    // --- 閉じる（CANCEL） ---
    if (closeScoreBtn) {
        closeScoreBtn.addEventListener('click', () => {
            scoreOverlay.style.display = 'none';
        });
    }

    // --- 閉じる（×） ---
    if (closeScoreX) {
        closeScoreX.addEventListener('click', () => {
            scoreOverlay.style.display = 'none';
        });
    }

    // --- 背景クリックで閉じる ---
    scoreOverlay.addEventListener('click', (e) => {
        if (e.target === scoreOverlay) {
            scoreOverlay.style.display = 'none';
        }
    });
}

// studio-scoring.js
export let originalSongData = [];

export function setOriginalSongData(data) {
    originalSongData = data;
}

function animateSparkline(canvas, history) {
    const ctx = canvas.getContext("2d");

    let t = 0;
    const duration = 600;
    const start = performance.now();

    function frame(now) {
        t = Math.min(1, (now - start) / duration);

        // ★★★ これが絶対に必要 ★★★
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // ★ drawSparkline 内で canvas.width/height を再設定しないようにする
        drawSparkline(canvas, history, t);

        if (t < 1) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
}

function lerp(a, b, t) {   // ★ ここに追加
    return a + (b - a) * t;
}

function drawSparkline(canvas, history, t) {
    const ctx = canvas.getContext("2d");

    const w = canvas.width;
    const h = canvas.height;

    const labelWidth = 14;
    const graphWidth = w - labelWidth;

    const topPad = 4;
    const bottomPad = 4;
    const usableHeight = h - topPad - bottomPad;

    ctx.clearRect(0, 0, w, h);

    drawSparklineGrid(ctx, w, h, labelWidth, bottomPad, usableHeight);
    drawSparklineLine(ctx, history, t, labelWidth, graphWidth, h, bottomPad, usableHeight);
}


function drawSparklineGrid(ctx, w, h, labelWidth, bottomPad, usableHeight) {
    const gridValues = [0, 20, 40, 60, 80, 100];

    ctx.strokeStyle = "#dddddd";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);

    gridValues.forEach(v => {
        const y = h - bottomPad - (v / 100) * usableHeight;
        ctx.beginPath();
        ctx.moveTo(labelWidth, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    });

    ctx.setLineDash([]);

    // ★ ラベルをもっと左に寄せる（2px → 0px）
    ctx.fillStyle = "#cccccc";
    ctx.font = "10px sans-serif";
    ctx.textBaseline = "middle";

    gridValues.forEach(v => {
        const y = h - bottomPad - (v / 100) * usableHeight;
        ctx.fillText(`${v}%`, 0, y); // ← ここを 0 に
    });
}


function drawSparklineLine(ctx, history, t, labelWidth, graphWidth, h, bottomPad, usableHeight) {
    const values = history.map(h => h.accuracy);

    const stepX = 16; // ★ 横方向は固定幅。history に依存しない。

    ctx.strokeStyle = "#b87333";
    ctx.lineWidth = 2;
    ctx.beginPath();

    values.forEach((v, i) => {
        const x = labelWidth + i * stepX; // ★ 横方向は固定

        // ★ 縦方向だけアニメーション
        const animatedValue = v * t;

        const y = h - bottomPad - (animatedValue / 100) * usableHeight;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });

    ctx.stroke();
}

function handleSparkHover(e, canvas, history) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;

  const index = Math.round((x / canvas.width) * (history.length - 1));
  const point = history[index];
  if (!point) return;

  const tooltip = document.getElementById("score-tooltip");
  tooltip.classList.remove("hidden");

  tooltip.style.left = `${e.pageX + 10}px`;
  tooltip.style.top = `${e.pageY + 10}px`;

  document.getElementById("tt-octave").textContent = point.octave;
  document.getElementById("tt-accuracy").textContent = point.accuracy;
  document.getElementById("tt-seq").textContent = point.seq;

  const sessionId = Number(canvas.dataset.id);
  document.getElementById("tt-delete-btn").onclick = () => deleteSession(sessionId);
}

function hideTooltip() {
  document.getElementById("score-tooltip").classList.add("hidden");
}

window.playStudioArchive = async function(id) {
    const record = await getStudioScoreLocal(id);
    if (!record || !record.notes) return;

    // ★ extractNotesFromMidi() 形式（{pitch, velocity, time, duration}）にも対応
    record.notes.forEach(ev => {
        const noteName = ev.note || (typeof ev.pitch === 'number' ? THEORY.midiToNote(ev.pitch) : ev.note);
        if (!noteName) return;

        setTimeout(() => {
            if (ev.type === "noteOff") {
                window.stopNote(noteName);
                return;
            }
            window.playNote(noteName, 0.8, true);
        }, ev.time);

        if (typeof ev.duration === 'number' && ev.duration > 0) {
            setTimeout(() => window.stopNote(noteName), ev.time + ev.duration);
        }
    });
};

window.currentPlayback = {
    timeouts: [],
    isPlaying: false,
    activeButton: null
};

window.stopPlayback = function() {
    window.currentPlayback.timeouts.forEach(t => clearTimeout(t));
    window.currentPlayback.timeouts = [];
    window.currentPlayback.isPlaying = false;

    if (window.currentPlayback.activeButton) {
        window.currentPlayback.activeButton.textContent = "▶";
        window.currentPlayback.activeButton = null;
    }
};

function setupCanvasResolution(canvas) {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;     // 内部バッファ幅
    canvas.height = rect.height;   // 内部バッファ高さ
}

function formatAccuracy(score) {
    // 100 → 100.0%
    // 99 → 99.8% など
    return (score.toFixed(1)) + "%";
}

async function getStudioScoreLocal(id) {
    const all = await window.playnoteDB.getAllStudioScores();
    // ★ id は UUID文字列／IndexedDB自動採番(数値) の2種類が混在しているため、
    //   data-id 属性から取得した文字列と比較する際は緩い等価(==)で型差を許容する
    return all.find(r => r.id == id) || null;
}

// ============================================================
// Studio スコア一覧を描画する（2枚canvas版）
// ============================================================
export async function renderStudioScoreList() {
    const listEl = document.getElementById("studio-score-list");
    if (!listEl) {
        console.error("studio-score-list が見つかりません");
        return;
    }

    // IndexedDB から取得
    let scores = await window.playnoteDB.getAllStudioScores();

    // 日付降順（新しい順）
    scores.sort((a, b) => b.latestDate - a.latestDate);

    // HTML 生成
    let html = `
        <table class="score-table">
            <thead>
                <tr>
                    <th>No.</th>
                    <th style="text-align:left; padding-left:10px;">TITLE</th>
                    <th>Max Accuracy</th>
                    <th>DATE</th>
                    <th>GRAPH</th>
                    <th>DEL</th>
                </tr>
            </thead>
            <tbody>
    `;

    scores.forEach((rec, index) => {
        const safeTitle = (rec.title || "No Title").replace(/'/g, "\\'");
        const dateStr = new Date(rec.latestDate).toLocaleString([], {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        html += `
            <tr>
                <td>${index + 1}</td>
<td style="text-align:left; padding-left:10px;">
    <div class="score-title-text">${safeTitle}</div>
    <button class="score-studio-btn" data-id="${rec.id}">▶GAME ON</button>
</td>

                <td>${formatAccuracy(rec.maxScore)}</td>
                <td>${dateStr}</td>
                <td>
                    <div class="spark-wrapper">
                        <canvas class="spark-label" data-id="${rec.id}"></canvas>
                        <canvas class="spark-graph" data-id="${rec.id}"></canvas>
                    </div>
                </td>
                <td>
                    <button class="table-btn-del" data-id="${rec.id}">🗑️</button>
                </td>
            </tr>
        `;
    });

    html += "</tbody></table>";
    listEl.innerHTML = html;

    // ============================================================
    // ★ 削除ボタンのイベント（修正版：UUID文字列を安全に扱う）
    // ============================================================
    document.querySelectorAll(".table-btn-del").forEach(btn => {
        btn.addEventListener("click", async () => {
            const idAttr = btn.dataset.id; // ★ data属性なので必ず文字列で渡ってくる
            if (!confirm("このスコアを削除しますか？")) return;

            // ★★★ 重要 ★★★
            // studioScores の id は UUID文字列(MIDI読込時)と
            // IndexedDB自動採番の数値(過去のプレイ結果保存時)が混在している。
            // IndexedDB の store.delete() はキーの型が厳密に一致しないと
            // 何も削除せず黙って失敗するため、まず実レコードを取得して
            // 保存時そのままの型(数値 or 文字列)の id で削除する。
            const rec = await getStudioScoreLocal(idAttr);
            const realId = rec ? rec.id : idAttr;

            await window.playnoteDB.deleteStudioScore(realId);
            await renderStudioScoreList();
        });
    });

    // ============================================================
    // ★ GAME ON ボタンのイベント（修正版）
    // ============================================================
document.querySelectorAll(".score-studio-btn").forEach(btn => {
    btn.addEventListener("click", async () => {

        const id = btn.dataset.id; // ★ UUID は文字列のまま使う
        console.log("GAME ON clicked", id);

        const rec = await getStudioScoreLocal(id);

        if (!rec) {
            console.error("Score not found for id:", id);
            return;
        }

        // ★ ESC→はい でこのレコードに上書き保存するため、対象を保持
        window.activeScoringRecord = rec;

        // ★★★ 重要 ★★★
        // このモーダル（z-index: 9999）を閉じないまま GAME ON すると、
        // 落下ブロックの描画レイヤー（z-index: 1）がモーダルの裏に隠れてしまい、
        // カウントダウンが半透明の背景を通してぼんやり見えるだけで、
        // ブロックや鍵盤はモーダル本体に完全に隠れてしまう。
        const scoreOverlay = document.getElementById('pw-score-board');
        if (scoreOverlay) scoreOverlay.style.display = 'none';

        window.isGuideMode = true;
        window.isStudioMode = true;

        await handlePlayProgress(null, rec.notes);
    });
});


    // Sparkline 描画
    drawStudioSparklines(scores);
}


// ============================================================
// Sparkline 描画（2枚canvas版）
// ============================================================
function drawStudioSparklines(scores) {
    document.querySelectorAll(".spark-wrapper").forEach(wrapper => {
        const labelCanvas = wrapper.querySelector(".spark-label");
        const graphCanvas = wrapper.querySelector(".spark-graph");

        // ★★★ 重要 ★★★
        // id は UUID文字列(MIDI読込時)と IndexedDB自動採番の数値
        // (過去のプレイ結果保存時)が混在している。
        // Number(id) で無条件に数値化すると、UUID文字列は NaN になり
        // 絶対に一致しなくなる（＝グラフが描画されない）ため、
        // 元の文字列のまま緩い等価(==)で比較する。
        const id = labelCanvas.dataset.id;
        const rec = scores.find(s => s.id == id);
        if (!rec || !rec.history) return;

        // ★ ここが重要：wrapper ではなく canvas 自身の CSS サイズを使う
        const dpr = window.devicePixelRatio || 1;

        // labelCanvas の内部解像度を CSS サイズから決定
        {
            const rect = labelCanvas.getBoundingClientRect();
            labelCanvas.width = rect.width * dpr;
            labelCanvas.height = rect.height * dpr;
        }

        // graphCanvas の内部解像度を CSS サイズから決定
        {
            const rect = graphCanvas.getBoundingClientRect();
            graphCanvas.width = rect.width * dpr;
            graphCanvas.height = rect.height * dpr;
        }

        // 描画
        drawSparklineLabels(labelCanvas);
        animateSparklineGraph(graphCanvas, rec.history);

        // hover（graph のみ）
        graphCanvas.onmousemove = e => handleSparkHover(e, graphCanvas, rec.history);
        graphCanvas.onmouseleave = hideTooltip;
    });
}

// ============================================================
// Studio モード：MIDI 読み込み時に保存するための関数
// ============================================================
export async function saveImportedMidiToScoring({ title, notes }) {

    // 既存の scoringDB（studioScores）から「同じ曲（同じファイル名）」を探す
    const existingScores = await window.playnoteDB.getAllStudioScores();
    const duplicate = existingScores.find(s => s.title === title);

    if (duplicate) {
        // ★ 同じ曲が既に登録されている → どうするかユーザーに選んでもらう
        const decision = await window.showDuplicateConfirm(title);

        if (decision === 'overwrite') {
            // 既存レコードを上書き保存（id・作成日・履歴・最高得点は維持し、楽譜本体だけ更新）
            await window.playnoteDB.updateStudioScore({
                ...duplicate,
                title,
                notes,
                latestDate: Date.now()
            });
            console.log("💾 既存の scoringDB レコードを上書き保存しました:", notes.length, "notes");
        } else {
            // 新しい曲として登録
            await window.playnoteDB.saveStudioScore({
                id: crypto.randomUUID(),
                title,
                notes,
                createdAt: Date.now(),
                latestDate: Date.now(),
                maxScore: 0,
                history: []
            });
            console.log("💾 新しい曲として scoringDB に保存しました:", notes.length, "notes");
        }
    } else {
        // 重複なし → そのまま新規保存
        await window.playnoteDB.saveStudioScore({
            id: crypto.randomUUID(),
            title,
            notes,
            createdAt: Date.now(),
            latestDate: Date.now(),
            maxScore: 0,
            history: []
        });
    }

    // 保存したら即 UI 更新
    await renderStudioScoreList();
}

function drawSparklineLabels(canvas) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    const dpr = window.devicePixelRatio || 1;
    const gridValues = [0,20,40,60,80,100];

    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = "#ccc";
    ctx.font = `${10 * dpr}px sans-serif`;
    ctx.textBaseline = "middle";

    gridValues.forEach(v => {
const topPad = 4 * dpr;
const bottomPad = 4 * dpr;
const usableHeight = h - topPad - bottomPad;

const y = h - bottomPad - (v/100) * usableHeight;

        ctx.fillText(`${v}%`, 0, y);
    });
}

function animateSparklineGraph(canvas, history) {
    let t = 0;
    function frame() {
        t += 0.02;
        if (t > 1) t = 1;

        drawSparklineGraph(canvas, history, t);

        if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}


function drawSparklineGraph(canvas, history, t) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    const dpr = window.devicePixelRatio || 1;
    const topPad = 4 * dpr;
    const bottomPad = 4 * dpr;
    const usableHeight = h - topPad - bottomPad;

    const values = history.map(h => h.accuracy);

    // ★ 右に突き抜けない stepX
    const stepX = w / (values.length - 1);

    ctx.clearRect(0,0,w,h);

    // グリッド線
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.setLineDash([2,2]);

    [0,20,40,60,80,100].forEach(v => {
        const y = h - bottomPad - (v/100)*usableHeight;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    });

    ctx.setLineDash([]);

    // 折れ線（縦方向だけアニメ）
    ctx.strokeStyle = "#b87333";
    ctx.lineWidth = 2;
    ctx.beginPath();

    values.forEach((v, i) => {
        const x = i * stepX;
        const animatedValue = v * t;
        const y = h - bottomPad - (animatedValue/100)*usableHeight;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });

    ctx.stroke();
}



// ============================================================
// Studio スコア削除 UI
// ============================================================
window.deleteStudioScoreUI = async function (id) {
    if (!confirm("この Studio スコアを削除しますか？")) return;

    await window.playnoteDB.deleteStudioScore(id);
    await renderStudioScoreList();
};

export function showScoreDetail(id) {
    alert("showScoreDetail がまだ実装されていません。ID: " + id);
}

window.setupScoreBoard = setupScoreBoard;
window.renderStudioScoreList = renderStudioScoreList;
window.deleteStudioScoreUI = deleteStudioScoreUI;
window.showScoreDetail = showScoreDetail;
window.setupScoreBoard = setupScoreBoard;
window.renderStudioScoreList = renderStudioScoreList;