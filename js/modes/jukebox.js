/* ============================================================
   Jukebox：取り込んだMIDIファイルを一覧表示・再生・削除する機能
   ============================================================
   ・Archive選択モーダル（#pw-select-mode）の一番下に追加された
     「Jukebox」ボタンから開く
   ・IndexedDBの専用ストア(jukebox)にMIDIファイルの実体(ArrayBuffer)と
     曲名・長さを保存する
   ・再生はStudioの通常再生経路（handlePlayProgress、GAME ONではない
     ただの再生）を再利用する
   ============================================================ */

// ★ ソート状態（Session/Studio Archiveと同じ方式）
let currentSortKey = null; // 'title' | 'duration' | null
let currentSortDir = 'asc'; // 'asc' | 'desc'

// mm:ss 形式に整形する
function formatDuration(ms) {
    // ★ 修正：Math.round だと、Studioタグ側の表示（formatTime、Math.floor基準）と
    //   境界値で1秒ズレることがあったため、同じ Math.floor に統一する。
    const totalSec = Math.max(0, Math.floor((ms || 0) / 1000));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, '0')}`;
}

// ★ MIDIインポート（長さ計算）専用の、メイン再生とは別のPlayerインスタンス。
//   メインのwindow.midiPlayerInstanceを使い回すと、インポート時に
//   「今まさに再生中／読み込み中の曲」の状態を壊してしまうため分離している。
let parserPlayer = null;
async function getParserPlayer() {
    if (parserPlayer) return parserPlayer;
    const Lib = await import('../../midiplayer.js');
    const DefaultExport = Lib.default;
    const PlayerConstructor = DefaultExport?.Player || DefaultExport || Lib.Player;
    if (!PlayerConstructor) {
        throw new Error('Jukebox: MIDIパーサー(Player)の読み込みに失敗しました');
    }
    parserPlayer = new PlayerConstructor(() => {}); // 再生イベントは使わないので空コールバック
    return parserPlayer;
}

// ★ 一覧の再描画
export async function renderJukeboxList() {
    const container = document.getElementById('jukebox-list-container');
    if (!container) return;

    const entries = await window.playnoteDB.getAllJukeboxEntries();

    // ★★★ ソート ★★★
    // currentSortKey が null のときは従来通り「取り込んだ順（古い順）」。
    // ヘッダーの▲▼が押されていれば、そのキー・方向でソートする。
    let sorted;
    if (currentSortKey) {
        sorted = [...entries].sort((a, b) => {
            let va, vb;
            if (currentSortKey === 'title') {
                va = (a.title || '');
                vb = (b.title || '');
            } else { // 'duration'
                va = a.durationMs ?? 0;
                vb = b.durationMs ?? 0;
            }
            const cmp = (typeof va === 'string') ? va.localeCompare(vb) : (va - vb);
            return currentSortDir === 'asc' ? cmp : -cmp;
        });
    } else {
        sorted = [...entries].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    }

    if (sorted.length === 0) {
        container.innerHTML = `<div class="settings-placeholder">まだ曲がありません。「IMPORT MIDI」から曲を取り込んでください。</div>`;
        return;
    }

    // ★ ヘッダーの▲▼マークアップを生成するヘルパー（Session/Studio Archiveと同じデザイン）
    function sortArrows(key) {
        const ascActive = (currentSortKey === key && currentSortDir === 'asc');
        const descActive = (currentSortKey === key && currentSortDir === 'desc');
        return `
            <span class="sort-arrows">
                <span class="sort-arrow${ascActive ? ' active' : ''}" data-sort-key="${key}" data-sort-dir="asc" title="昇順">▲</span
                ><span class="sort-arrow${descActive ? ' active' : ''}" data-sort-key="${key}" data-sort-dir="desc" title="降順">▼</span>
            </span>`;
    }

    let html = `
        <table class="archive-table" id="jukebox-table">
            <thead>
                <tr>
                    <th>No.</th>
                    <th style="text-align: left; padding-left: 15px;">Title${sortArrows('title')}</th>
                    <th>Duration${sortArrows('duration')}</th>
                    <th>Play</th>
                    <th>DEL</th>
                </tr>
            </thead>
            <tbody>
    `;

    sorted.forEach((entry, index) => {
        const displayTitle = entry.title || 'No Title';
        const htmlSafeTitle = displayTitle.replace(/"/g, '&quot;');
        html += `
            <tr>
                <td>${index + 1}</td>
                <td style="text-align: left; padding-left: 15px;" title="${htmlSafeTitle}">${displayTitle}</td>
                <td>${formatDuration(entry.durationMs)}</td>
                <td><button class="table-btn-play jukebox-play-btn" data-id="${entry.id}">▶</button></td>
                <td><button class="table-btn-del jukebox-del-btn" data-id="${entry.id}">🗑️</button></td>
            </tr>`;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;

    // ★ ソート矢印（▲▼）のイベント
    container.querySelectorAll(".sort-arrow").forEach(arrow => {
        arrow.addEventListener("click", () => {
            currentSortKey = arrow.dataset.sortKey;
            currentSortDir = arrow.dataset.sortDir;
            renderJukeboxList();
        });
    });

    container.querySelectorAll('.jukebox-play-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            const entry = await window.playnoteDB.getJukeboxEntry(id);
            if (!entry) return;
            await playJukeboxEntry(entry);
        });
    });

    container.querySelectorAll('.jukebox-del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            await window.playnoteDB.deleteJukeboxEntry(id);
            await renderJukeboxList();
        });
    });
}

// ★ Jukebox再生前のカウントダウン（GAME ONと同じ見た目・タイミングだが、
//   5からではなく3から）。GAME ONのカウントダウンはCanvas上に描画しているが、
//   Jukeboxは専用のCanvasを持たないため、簡易的なDOMオーバーレイで表現する。
function showJukeboxCountdown() {
    return new Promise((resolve) => {
        const numbers = ["③", "②", "①", "⓪"];
        let idx = 0;

        let el = document.getElementById('jukebox-countdown');
        if (!el) {
            el = document.createElement('div');
            el.id = 'jukebox-countdown';
            (document.getElementById('app-scale-wrapper') || document.body).appendChild(el);
        }
        el.style.cssText = `
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 120px;
            font-family: sans-serif;
            color: rgba(255, 255, 255, 0.9);
            text-shadow: 0 0 20px rgba(0, 0, 0, 0.8);
            background: rgba(0, 0, 0, 0.35);
            z-index: 60000;
            pointer-events: none;
        `;

        const step = () => {
            if (idx >= numbers.length) {
                el.remove();
                resolve();
                return;
            }
            el.textContent = numbers[idx];
            idx++;
            setTimeout(step, 1000);
        };
        step();
    });
}

// ★ 一覧の「▶」：モーダルを閉じて、Studioの通常再生（GAME ONではない）として流す
async function playJukeboxEntry(entry) {
    const jukeboxOverlay = document.getElementById('pw-jukebox-board');
    if (jukeboxOverlay) jukeboxOverlay.style.display = 'none';

    // ★ GAME ONと同じ雰囲気のカウントダウンを、3から表示する
    await showJukeboxCountdown();

    // ★ GAME ONではなく、ただの再生として扱う
    window.studioGuideMode = null;
    window.isGuideMode = false;
    window.currentMidiFileName = entry.title;
    window.loadedMidiTitle = entry.title;

    // ★★★ 重要 ★★★
    // studio.js側の時間表示は「テンポチェンジが多い曲だと再生中に値が
    // 変動する」バグを避けるため、window.currentSongDurationMs（あらかじめ
    // 正確に計算された曲の長さ）を優先して使う作りになっている。
    // ここをセットし忘れると、常に不安定な方の計算式にフォールバックして
    // しまい、再生中に表示時間がころころ変わって見えていた。
    // インポート時に既に正確な値(entry.durationMs)を計算済みなので、それを使う。
    window.currentSongDurationMs = entry.durationMs || 0;

    // ★ Studioタグの曲名表示窓（スクロール表示）にもタイトルを反映する
    if (typeof window.updateStudioSongDisplay === 'function') {
        window.updateStudioSongDisplay(entry.title);
    }

    if (typeof window.handlePlayProgress === 'function') {
        // ArrayBufferはコピーを渡す（元データは保持しておく）
        await window.handlePlayProgress(null, entry.midiData.slice(0));
    }
}

// ★ MIDIファイルを取り込み、長さを計算してDBに保存する
async function importMidiFile(file) {
    const buffer = await file.arrayBuffer();

    const player = await getParserPlayer();
    player.loadArrayBuffer(buffer.slice(0)); // パース用にコピーを渡す

    const notes = (typeof window.extractNotesFromMidi === 'function')
        ? window.extractNotesFromMidi(player)
        : [];

    // ★ 計算ロジックの完全一本化：ここで自前にMath.maxを計算し直すのではなく、
    //   extractNotesFromMidi()が副作用として設定する window.currentSongDurationMs
    //   （main.js側の通常アップロード経路と全く同じ計算式・同じ関数）を
    //   そのまま使う。extractNotesFromMidiは同期関数なので、直後に読めば
    //   他の処理と競合する心配はない。
    const durationMs = window.currentSongDurationMs || 0;

    const title = file.name.replace(/\.[^/.]+$/, "");

    await window.playnoteDB.saveJukeboxEntry({
        title,
        durationMs,
        midiData: buffer,
        createdAt: Date.now()
    });

    await renderJukeboxList();
}

// ★ モーダルの開閉・インポートボタンのセットアップ
export function setupJukeboxBoard() {
    const jukeboxOverlay = document.getElementById('pw-jukebox-board');
    const openJukeboxBtn = document.getElementById('pw-open-jukebox');
    const closeJukeboxBtn = document.getElementById('pw-jukebox-close');
    const closeJukeboxX = document.getElementById('pw-jukebox-close-x');
    const importInput = document.getElementById('jukebox-midi-upload');
    const importBtn = document.getElementById('jukebox-import-btn');

    if (!jukeboxOverlay) {
        console.error("Jukebox modal not found: #pw-jukebox-board");
        return;
    }

    if (openJukeboxBtn) {
        openJukeboxBtn.addEventListener('click', async () => {
            // ★ main.js側でwindow公開されているArchive選択モーダルの閉じる関数を利用
            if (typeof window.closeSelectModal === 'function') {
                window.closeSelectModal();
            } else {
                const selectModal = document.getElementById('pw-select-mode');
                if (selectModal) selectModal.style.display = 'none';
            }
            jukeboxOverlay.style.display = 'flex';
            await renderJukeboxList();
        });
    }

    if (closeJukeboxBtn) {
        closeJukeboxBtn.addEventListener('click', () => {
            jukeboxOverlay.style.display = 'none';
        });
    }
    if (closeJukeboxX) {
        closeJukeboxX.addEventListener('click', () => {
            jukeboxOverlay.style.display = 'none';
        });
    }

    // 背景クリックで閉じる
    jukeboxOverlay.addEventListener('click', (e) => {
        if (e.target === jukeboxOverlay) jukeboxOverlay.style.display = 'none';
    });

    if (importBtn && importInput) {
        importBtn.addEventListener('click', () => importInput.click());
    }
    if (importInput) {
        importInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                await importMidiFile(file);
            } catch (err) {
                console.error("Jukebox: MIDIインポートに失敗しました:", err);
                if (typeof window.showToast === 'function') {
                    window.showToast('MIDIファイルの取り込みに失敗しました。');
                }
            }
            // ★ 同じファイルを連続で選び直せるようリセット
            importInput.value = '';
        });
    }
}
