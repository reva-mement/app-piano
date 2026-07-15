/* ============================================================
   Scoring モーダルの開閉処理
   ============================================================ */
import { THEORY } from '../../utils.js';

// ★★★ Studio Archive 一覧のソート状態 ★★★
// null のときは「登録順（古い順）」がデフォルト。
// ヘッダーの▲▼を押すと currentSortKey/currentSortDir が更新され、再描画されるたびに反映される。
let currentSortKey = null; // 'title' | 'accuracy' | 'date' | 'graph' | null
let currentSortDir = 'asc'; // 'asc' | 'desc'

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

    // ★★★ ツールチップ内の削除ボタンを押せるようにする対応 ★★★
    // 星のホバー判定範囲は狭いため、カーソルを星からツールチップ（削除ボタン）へ
    // 移動する間に判定範囲を外れてしまい、ボタンを押す前にツールチップが
    // 消えてしまっていた。ツールチップ自身にカーソルが乗っている間は
    // 消さないようにし、ツールチップからも完全にカーソルが離れたときだけ消す。
    const tooltipEl = document.getElementById("score-tooltip");
    if (tooltipEl) {
        tooltipEl.addEventListener('mouseenter', cancelHideTooltip);
        tooltipEl.addEventListener('mouseleave', () => scheduleHideTooltip(0));
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
    // ★ h.accuracy はここでは「1ブロックごとの得点」（0/60/70/80/90/100、judgeBlockScore()由来）。
    //   一覧の Accuracy 列に出す rec.hitAccuracy（レコード単位の正答率%）とは別物なので注意。
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

// ★ ホバーで星（点）の上に日付・スコア・accuracy・演奏範囲を表示する。
//   「x座標をindexに丸めてからY方向±2pxだけ判定する」方式だと、
//   実際のマウス操作の精度ではほぼ当たらず表示されなかったため、
//   カーソル位置と各星の実座標との距離を直接計算する方式に変更した。
//   一番近い星が、星の見た目の大きさ（半径4px程度）+多少の遊びの範囲内に
//   入っていれば表示する（見た目の星に対して自然に反応するようにするため）。
//
// ★★★ 自己修復処理を削除 ★★★
// 以前は「描画時とホバー時でcanvasの解像度が食い違っていたら、その場で
// 測り直して再描画する」処理を入れていたが、これはマウスを動かすたびに
// 毎回canvasをリサイズ＆再描画してしまい、逆に「グラフの幅がずれて見える」
// 不具合の原因になっていた。
// そもそもの原因は scoring.css が index.html に読み込まれておらず、
// レイアウトが正しく確定していなかったことだったため、そちらを修正済みの
// 今は、この自己修復処理自体が不要（かつ有害）になったため削除した。
function handleSparkHover(e, canvas, playHistory) {
  const rect = canvas.getBoundingClientRect();

  const x = e.clientX - rect.left; // ★ CSSピクセル基準
  const y = e.clientY - rect.top;  // ★ CSSピクセル基準

  const MAX_SLOTS = 10; // ★ drawSparklineGraph() と同じ固定10分割
  // ★ drawSparklineGraph() 側と同じ余白・パディング基準（CSSピクセル換算）
  const sidePadCss = 8;
  const topPadCss = 4;
  const bottomPadCss = 4;
  const usableWidthCss = rect.width - sidePadCss * 2;
  const usableHeightCss = rect.height - topPadCss - bottomPadCss;
  const stepXCss = usableWidthCss / (MAX_SLOTS - 1);

  // ★ 実際にプレイ済みの星（インデックスが playHistory の範囲内のもの）だけを対象に、
  //   カーソルとの距離が一番近いものを探す
  const HIT_RADIUS = 8; // ★ 星の見た目（半径4px）+ 少し余裕を持たせた当たり判定（CSSピクセル）
  let nearestIndex = -1;
  let nearestDist = Infinity;

  playHistory.forEach((point, i) => {
      const starX = sidePadCss + i * stepXCss;
      const starY = rect.height - bottomPadCss - (point.hitAccuracy / 100) * usableHeightCss;
      const dist = Math.hypot(x - starX, y - starY);
      if (dist < nearestDist) {
          nearestDist = dist;
          nearestIndex = i;
      }
  });

  if (nearestIndex === -1 || nearestDist > HIT_RADIUS) { scheduleHideTooltip(); return; }

  const point = playHistory[nearestIndex];

  const tooltip = document.getElementById("score-tooltip");
  if (!tooltip) {
      console.error("[Tooltip] #score-tooltip 要素が見つかりません。index.html を確認してください。");
      return;
  }

  cancelHideTooltip(); // ★ 星の判定範囲内に戻ってきたので、隠す予約があればキャンセル
  tooltip.classList.remove("hidden");

  // ★★★ 位置固定の対応（UX改善） ★★★
  // 以前は mousemove のたびに毎回ツールチップの位置を更新していたため、
  // カーソルを削除ボタンへ動かそうとする途中で位置がズレ続けて気持ち悪かった。
  // 「同じ星」の判定範囲内にいる間は、最初に表示されたときの位置のまま固定し、
  // 別の星に切り替わったとき（または一度隠れて再表示されたとき）だけ
  // 新しい位置に置き直すようにする。
  const starKey = `${canvas.dataset.id}:${nearestIndex}`;
  if (lockedStarKey !== starKey) {
      tooltip.style.left = `${e.pageX + 10}px`;
      tooltip.style.top = `${e.pageY + 10}px`;
      lockedStarKey = starKey;
  }

  const dateStr = new Date(point.date).toLocaleString([], {
      year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  // ★ 要素が見つからない場合でも例外で処理全体が止まらないよう、
  //   安全にテキストを設定するヘルパーを使う
  //   （index.html側の対応するIDが無い/古いままだと、ここが原因で
  //    それ以降の行が実行されず、見た目上「何も起きない」ように見えることがあった）
  function setTooltipText(id, value) {
      const el = document.getElementById(id);
      if (!el) {
          console.warn(`[Tooltip] #${id} が見つかりません（index.html未反映の可能性）`);
          return;
      }
      el.textContent = value;
  }

  setTooltipText("tt-date", dateStr);
  setTooltipText("tt-score", point.totalScore ?? "—");
  setTooltipText("tt-accuracy", point.hitAccuracy.toFixed(1));
  // ★ 演奏範囲（オクターブ幅）。旧データ（rangeWidthを保存していないプレイ）は "—" 表示
  setTooltipText("tt-range", (typeof point.rangeWidth === "number") ? `${point.rangeWidth} オクターブ` : "—");

  // ★ レコードのidは UUID文字列 / IndexedDB自動採番の数値 が混在するため、
  //   Number() で無条件に変換せず、元の文字列のまま保持する
  const recordId = canvas.dataset.id;
  // ★ このプレイを一意に識別するキーとして date（プレイ完了時刻）を使う
  //   （playHistory内でインデックスが変わっても確実に同じプレイを指せるように）
  const playDate = point.date;

  const delBtn = document.getElementById("tt-delete-btn");
  if (delBtn) delBtn.onclick = () => deletePlayFromHistory(recordId, playDate);
}

// ★★★ ツールチップの削除ボタン：該当プレイ1件だけを削除する ★★★
// 以前は deleteSession() という未定義の関数を呼んでいたため、
// ボタンを押しても ReferenceError が発生するだけで何も起きなかった。
// ここでは「曲（レコード）ごと削除」ではなく、「その星＝1プレイ分だけ」を
// playHistory から取り除く。削除後は一覧を再描画するので、
// 残ったポイントは自然に詰めて表示され直す。
async function deletePlayFromHistory(recordId, playDate) {
    const scores = await window.playnoteDB.getAllStudioScores();
    const rec = scores.find(s => s.id == recordId); // ★ id型の混在に対応するため緩い等価比較
    if (!rec || !rec.playHistory) return;

    rec.playHistory = rec.playHistory.filter(p => p.date !== playDate);

    // ★ 一覧のAccuracy列などに出す「レコード単位の最新値」も、
    //   削除後に残っている一番新しいプレイに合わせて更新する
    if (rec.playHistory.length > 0) {
        const latest = rec.playHistory[rec.playHistory.length - 1];
        rec.hitAccuracy = latest.hitAccuracy;
        rec.totalScore = latest.totalScore;
    } else {
        rec.hitAccuracy = 0;
        rec.totalScore = 0;
    }

    await window.playnoteDB.updateStudioScore(rec);

    hideTooltip();
    await renderStudioScoreList(); // ★ 再描画（＝グラフも再アニメして詰め直される）
}

// ★★★ ツールチップを「即座に」ではなく「少し待ってから」隠す仕組み ★★★
// 星のホバー範囲を外れた瞬間に即座に隠すと、カーソルをツールチップ
// （削除ボタン）へ移動する途中でツールチップが消えてしまう。
// 少し（150ms）待ってから隠すことで、その間にツールチップへカーソルが
// たどり着けば cancelHideTooltip() で隠す予約がキャンセルされ、
// 表示され続ける仕組みになっている。
let tooltipHideTimer = null;
let lockedStarKey = null; // ★ 現在ツールチップを固定表示している星の識別子（canvasId:index）

function scheduleHideTooltip(delay = 150) {
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = setTimeout(() => {
        hideTooltip();
    }, delay);
}

function cancelHideTooltip() {
    clearTimeout(tooltipHideTimer);
}

function hideTooltip() {
  document.getElementById("score-tooltip").classList.add("hidden");
  lockedStarKey = null; // ★ 完全に隠れたら位置ロックを解除し、次回は新しい位置に表示できるようにする
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
    // ★ 旧データ（hitAccuracyフィールドが無い記録）は "—" 表示にする
    if (typeof score !== "number" || Number.isNaN(score)) return "—";
    return (score.toFixed(1)) + "%";
}

// ★★★ ソート用：レコードから、指定したキーの比較用の値を取り出す ★★★
function getSortValue(rec, key) {
    switch (key) {
        case 'title':
            return (rec.title || '').toLowerCase();
        case 'accuracy':
            return (typeof rec.hitAccuracy === 'number') ? rec.hitAccuracy : -1;
        case 'date':
            return rec.latestDate ?? 0;
        default:
            return rec.createdAt ?? rec.latestDate ?? 0;
    }
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

    // ★★★ ソート ★★★
    // currentSortKey が null のときは従来通り「登録順（古い順）」。
    // ヘッダーの▲▼が押されていれば、そのキー・方向でソートする。
    if (currentSortKey) {
        scores.sort((a, b) => {
            const va = getSortValue(a, currentSortKey);
            const vb = getSortValue(b, currentSortKey);
            const cmp = (typeof va === 'string')
                ? va.localeCompare(vb)
                : (va - vb);
            return currentSortDir === 'asc' ? cmp : -cmp;
        });
    } else {
        // ★ 登録順（古い順）。以前は「直近プレイ日時(latestDate)の新しい順」でソートしており、
        //   新しく追加した曲やプレイし直した曲が毎回 No.1（先頭）に来てしまっていた。
        //   「新しく追加した曲は一番下に来てほしい」という要望に合わせ、
        //   登録日時(createdAt)の古い順（＝新しい曲が自然と一番下になる）に変更する。
        //   createdAt が無い古いレコードは latestDate で代用する。
        scores.sort((a, b) => (a.createdAt ?? a.latestDate ?? 0) - (b.createdAt ?? b.latestDate ?? 0));
    }

    // ★ ヘッダーの▲▼マークアップを生成するヘルパー
    //   （現在選択中のキー・方向は少し明るく表示して分かるようにする）
    function sortArrows(key) {
        const ascActive = (currentSortKey === key && currentSortDir === 'asc');
        const descActive = (currentSortKey === key && currentSortDir === 'desc');
        return `
            <span class="sort-arrows">
                <span class="sort-arrow${ascActive ? ' active' : ''}" data-sort-key="${key}" data-sort-dir="asc" title="昇順">▲</span
                ><span class="sort-arrow${descActive ? ' active' : ''}" data-sort-key="${key}" data-sort-dir="desc" title="降順">▼</span>
            </span>`;
    }

    // HTML 生成
    let html = `
        <table class="score-table">
            <thead>
                <tr>
                    <th>No.</th>
                    <th>TITLE${sortArrows('title')}</th>
                    <th>Accuracy${sortArrows('accuracy')}</th>
                    <th>DATE${sortArrows('date')}</th>
                    <th>GRAPH</th>
                    <th>DEL</th>
                </tr>
            </thead>
            <tbody>
    `;

    // ★ rec.hitAccuracy = レコード単位の正答率(%)。下記 <td> で表示している。
    //   history[].accuracy（1ブロックごとの得点、スパークライン用）とは別物なので注意。
    scores.forEach((rec, index) => {
        // ★ DBには拡張子付きのファイル名がそのまま入っているので、表示時だけ .mid/.midi を隠す
        const safeTitle = (rec.title || "No Title").replace(/\.midi?$/i, '').replace(/'/g, "\\'");
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
<td>
    <div class="score-title-text">${safeTitle}</div>
    <button class="score-studio-btn" data-id="${rec.id}">▶GAME ON</button>
</td>

                <td>${formatAccuracy(rec.hitAccuracy)}</td>
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


    // ============================================================
    // ★ ソート矢印（▲▼）のイベント
    // ============================================================
    document.querySelectorAll(".sort-arrow").forEach(arrow => {
        arrow.addEventListener("click", () => {
            currentSortKey = arrow.dataset.sortKey;
            currentSortDir = arrow.dataset.sortDir;
            renderStudioScoreList();
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
        if (!rec) return;

        // ★ グラフは「1プレイの中のブロックごとの得点(history)」ではなく、
        //   「プレイ単位の正答率(playHistory)」のうち直近10件を描画する。
        //
        // ★★★ 互換性対応 ★★★
        // playHistory は今回新設したフィールドなので、それより前に保存された
        // 既存レコードには存在しない。ここで弾いてしまうとグラフが一切
        // 表示されなくなるため、その場合はレコード単位の hitAccuracy から
        // 1点だけのグラフを合成して表示する（正しい履歴ではなく暫定表示）。
        let fullPlayHistory = rec.playHistory;
        if (!fullPlayHistory || fullPlayHistory.length === 0) {
            if (typeof rec.hitAccuracy === "number") {
                fullPlayHistory = [{ date: rec.latestDate || Date.now(), hitAccuracy: rec.hitAccuracy }];
            } else {
                fullPlayHistory = [];
            }
        }
        if (fullPlayHistory.length === 0) return; // 本当に描画データが無い場合のみスキップ

        // ★★★ 重要 ★★★
        // playHistory自体は最大10000件まで保存されているが、グラフに表示するのは
        // 常に「末尾（＝最新）10件」だけ。1件削除すると、この末尾10件の切り出しが
        // 自動的にずれて、これまで11番目に隠れていた古い記録が右側に現れる。
        const playHistory = fullPlayHistory.slice(-10);

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
        animateSparklineGraph(graphCanvas, playHistory);

        // hover（graph のみ）
        graphCanvas.onmousemove = e => handleSparkHover(e, graphCanvas, playHistory);
        // ★ canvasから離れても即座に隠さず、猶予を持たせる
        //   （ツールチップへカーソルを移動中に消えてしまうのを防ぐため）
        graphCanvas.onmouseleave = () => scheduleHideTooltip();
    });
}

// ============================================================
// Studio モード：MIDI 読み込み時に保存するための関数
// ============================================================

// ★★★ 「別の曲として保存」を選んだ際の重複タイトル回避 ★★★
// 同じタイトルのレコードが既に存在する場合、" (1)", " (2)"...と
// 番号を付けて一意なタイトルにする（archive内でタイトルが衝突しないように）。
//
// ★ 重要：番号は拡張子の"前"に挿入する（例: "song (1).mid"）。
//   以前は末尾にそのまま追加していたため "song.mid (1)" のような形になり、
//   表示時に ".mid" 拡張子を隠すための正規表現（文字列の末尾に .mid がある前提）が
//   効かなくなって拡張子が表示されたままになってしまっていた。
function generateUniqueTitle(baseTitle, existingScores) {
    const existingTitles = new Set(existingScores.map(s => s.title));
    if (!existingTitles.has(baseTitle)) return baseTitle;

    // 拡張子部分（最後の "." 以降）と、それ以外の部分に分離する
    const dotIndex = baseTitle.lastIndexOf('.');
    const namePart = dotIndex > 0 ? baseTitle.slice(0, dotIndex) : baseTitle;
    const extPart = dotIndex > 0 ? baseTitle.slice(dotIndex) : '';

    let n = 1;
    let candidate;
    do {
        candidate = `${namePart} (${n})${extPart}`;
        n++;
    } while (existingTitles.has(candidate));

    return candidate;
}

// ★★★ 重要（二重保存バグの修正）★★★
// これまでこの関数は保存するだけで何も返していなかったため、
// 呼び出し元（main.js）が window.activeScoringRecord を
// このレコードに紐付けられなかった。その結果、プレイ終了時の
// finishStudioGameSession() が「既存レコードが見つからない」と判断し、
// 同じ曲についてもう1件、別レコードとして保存してしまっていた
// （＝アーカイブに同じ曲が2つ並ぶ不具合の直接の原因）。
// これを防ぐため、保存/更新した後の完全なレコードを return するようにする。
export async function saveImportedMidiToScoring({ title, notes }) {

    // 既存の scoringDB（studioScores）から「同じ曲（同じファイル名）」を探す
    const existingScores = await window.playnoteDB.getAllStudioScores();
    const duplicate = existingScores.find(s => s.title === title);
    let savedRecord = null;

    if (duplicate) {
        // ★ 同じ曲が既に登録されている → どうするかユーザーに選んでもらう
        const decision = await window.showDuplicateConfirm(title);

        if (decision === 'overwrite') {
            // ★ 上書き保存：曲の中身（notes）だけを更新する。
            //   id・作成日はもちろん、maxScore/hitAccuracy/playHistory/history
            //   といったスコア関連のフィールドには一切触れず、そのまま維持する
            //   （...duplicate を先頭に展開しているので、明示的に書き換えている
            //    title/notes/latestDate 以外は元の値がそのまま残る）。
            //   スコア/グラフの更新は、この後メイン画面のStudioでGAME ONし、
            //   曲を終えたタイミング（finishStudioGameSession）で別途行われる。
            savedRecord = {
                ...duplicate,
                title,
                notes,
                latestDate: Date.now()
            };
            await window.playnoteDB.updateStudioScore(savedRecord);
            console.log("💾 既存の scoringDB レコードを上書き保存しました（notesのみ更新、スコアは維持）:", notes.length, "notes");
        } else {
            // ★ 別の曲として保存：タイトルが衝突しないよう "(1)" 等を自動で付与する
            const uniqueTitle = generateUniqueTitle(title, existingScores);
            savedRecord = {
                id: crypto.randomUUID(),
                title: uniqueTitle,
                notes,
                createdAt: Date.now(),
                latestDate: Date.now(),
                maxScore: 0,
                hitAccuracy: 0,
                playHistory: [],
                history: []
            };
            await window.playnoteDB.saveStudioScore(savedRecord);
            console.log("💾 新しい曲として scoringDB に保存しました:", uniqueTitle, notes.length, "notes");
        }
    } else {
        // 重複なし → そのまま新規保存
        savedRecord = {
            id: crypto.randomUUID(),
            title,
            notes,
            createdAt: Date.now(),
            latestDate: Date.now(),
            maxScore: 0,
            hitAccuracy: 0,
            playHistory: [],
            history: []
        };
        await window.playnoteDB.saveStudioScore(savedRecord);
    }

    // 保存したら即 UI 更新
    await renderStudioScoreList();

    return savedRecord; // ★ 呼び出し元で window.activeScoringRecord に紐付けるために返す
}

function drawSparklineLabels(canvas) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    const dpr = window.devicePixelRatio || 1;
    const gridValues = [0,20,40,60,80,100];
    const normalFontSize = 10 * dpr;
    const smallFontSize = 8 * dpr; // ★ "100%" だけこちらを使う

    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = "#ccc";
    ctx.textBaseline = "middle";

    gridValues.forEach(v => {
        const topPad = 4 * dpr;
        const bottomPad = 4 * dpr;
        const usableHeight = h - topPad - bottomPad;

        const y = h - bottomPad - (v/100) * usableHeight;

        // ★ "100%" は他の表記（"0%"〜"80%"）より桁数が多く、
        //   22px幅のラベル欄に収まりきらず見切れていたため、
        //   この表記だけ小さいフォントサイズで描画して収める
        ctx.font = (v === 100) ? `${smallFontSize}px sans-serif` : `${normalFontSize}px sans-serif`;

        ctx.fillText(`${v}%`, 0, y);
    });
}

// ★ グラフのポイントを星形で描画するためのヘルパー
function drawStar(ctx, cx, cy, outerRadius, innerRadius, points = 5) {
    ctx.beginPath();
    const step = Math.PI / points;
    let rot = -Math.PI / 2; // 真上から開始
    ctx.moveTo(cx + Math.cos(rot) * outerRadius, cy + Math.sin(rot) * outerRadius);
    for (let i = 0; i < points; i++) {
        rot += step;
        ctx.lineTo(cx + Math.cos(rot) * innerRadius, cy + Math.sin(rot) * innerRadius);
        rot += step;
        ctx.lineTo(cx + Math.cos(rot) * outerRadius, cy + Math.sin(rot) * outerRadius);
    }
    ctx.closePath();
}

function animateSparklineGraph(canvas, playHistory) {
    let t = 0;
    function frame() {
        t += 0.02;
        if (t > 1) t = 1;

        drawSparklineGraph(canvas, playHistory, t);

        if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}


// ★★★ アーカイブのグラフ：直近10プレイ分を描画 ★★★
// playHistory は最大10件（1プレイ=1点、先頭が一番古い＝グラフ左端、
// 末尾が最新＝グラフ右端）。グラフ全体を「10分割」した固定の目盛りに
// プロットするので、1回目のプレイは常に左から1分割目、2回目は2分割目…
// という位置に来る。
//
// ★ 10回に満たない曲への対応 ★
// まだプレイしていない区画は「0%」として扱い、常に10区画ぶんの折れ線を
// 描画する（未プレイの右側だけ空白にする、ということはしない）。
// こうすることで、1回プレイするごとに、左からその区画だけが
// 0%のラインから実際のスコアまで持ち上がって見える。
function drawSparklineGraph(canvas, playHistory, t) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    const dpr = window.devicePixelRatio || 1;
    const topPad = 4 * dpr;
    const bottomPad = 4 * dpr;
    const usableHeight = h - topPad - bottomPad;

    // ★ 左右に約8pxの余白を確保する（無いと1分割目/10分割目のポイントが
    //   canvasの端でちょうど見切れてしまうため）
    const sidePad = 8 * dpr;
    const usableWidth = w - sidePad * 2;

    const MAX_SLOTS = 10;
    // ★ playHistory[i] が無い（＝まだそのプレイ回に到達していない）区画は 0% 扱いにする
    const values = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
        values.push(playHistory[i] ? playHistory[i].hitAccuracy : 0);
    }
    const stepX = usableWidth / (MAX_SLOTS - 1); // ★ 常に10分割固定（データ件数に依存しない）

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
    // ★ 常に10点（未プレイ分は0%）を結ぶので、プレイ回数によらず必ず線が引ける
    ctx.strokeStyle = "#b87333";
    ctx.lineWidth = 2;
    ctx.beginPath();

    values.forEach((v, i) => {
        const x = sidePad + i * stepX; // ★ i=0→1分割目(左端), i=1→2分割目… の固定位置
        const animatedValue = v * t;
        const y = h - bottomPad - (animatedValue/100)*usableHeight;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });

    ctx.stroke();

    // ★ 実際にプレイした点にだけ星マーカーを打つ（未プレイの0%区画には打たない）
    //   大きさは外径4px・内径2px（dpr換算）
    const outerRadius = 4 * dpr;
    const innerRadius = 2 * dpr;
    ctx.fillStyle = "#ffdd55";
    ctx.strokeStyle = "#b87333";
    ctx.lineWidth = 1;

    values.forEach((v, i) => {
        if (i >= playHistory.length) return; // 未プレイ区画はスキップ
        const x = sidePad + i * stepX;
        const animatedValue = v * t;
        const y = h - bottomPad - (animatedValue/100)*usableHeight;

        const isLatest = (i === playHistory.length - 1); // ★ 一番新しいプレイの星だけ特別演出

        ctx.save();

        if (isLatest) {
            // ★ Studio Archiveを開いたとき（＝このグラフが描画される時）に、
            //   最新レコードの星だけ 0→40度 回転しながら光る
            const rotationDeg = 40 * t;
            ctx.translate(x, y);
            ctx.rotate(rotationDeg * Math.PI / 180);
            ctx.translate(-x, -y);

            // ★ より明るく：発光色を白寄りにし、二重にshadowを重ねてハロー効果を強める
            ctx.shadowColor = "#ffffff";
            ctx.shadowBlur = 18 * dpr * t;
        }

        drawStar(ctx, x, y, outerRadius, innerRadius);
        ctx.fill();
        ctx.stroke();

        if (isLatest) {
            // ★ 内側にもう一度小さめの光を重ねて、中心がより明るく見えるようにする
            ctx.shadowBlur = 26 * dpr * t;
            ctx.shadowColor = "#fffbe0";
            ctx.fill();
        }

        ctx.restore();
    });
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