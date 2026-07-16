/**
 * js/playnote-db.js
 * PianoWorks 演奏データ管理 (IndexedDB)
 */

import { convertEventsToMidi } from './modes/session.js';
import { isLocalApp, showLocalOnlyToast } from './utils.js';

// ★ Session Archive のソート状態（Studio Archiveと同じ▲▼方式）
let currentSortKey = null; // 'title' | 'date' | null
let currentSortDir = 'asc'; // 'asc' | 'desc'

const DB_NAME = 'PianoWorksDB';
const DB_VERSION = 2; // ★ jukeboxストア追加のためバージョンを上げる
const STORE_NAME = 'recordings';
const JUKEBOX_STORE = 'jukebox';

export const playnoteDB = {
    db: null,

    // データベースの初期化
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 既存の recordings ストア
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                }

                // ★★★ Studio モード用スコアストアを追加 ★★★
                if (!db.objectStoreNames.contains("studioScores")) {
                    const store = db.createObjectStore("studioScores", {
                        keyPath: "id",
                        autoIncrement: true
                    });
                    store.createIndex("date", "latestDate", { unique: false });
                }

                // ★★★ Jukebox用ストアを追加（取り込んだMIDIファイル一覧） ★★★
                if (!db.objectStoreNames.contains(JUKEBOX_STORE)) {
                    db.createObjectStore(JUKEBOX_STORE, {
                        keyPath: "id",
                        autoIncrement: true
                    });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log("IndexedDB Initialized.");
                resolve(this.db);
            };

            request.onerror = (event) => reject("DB Open Error: " + event.target.error);
        });
    },

    // ★ ここから追加 ----------------------------

    // 録音データの保存
    async saveRecording(entry) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([STORE_NAME], 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.add(entry);

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    // 全録音データの取得
    async getAllRecordings() {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([STORE_NAME], 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    // ★ ここまで追加 ----------------------------

    // データの削除
    async deleteRecording(id) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.target.error);
        });
    },

    async getRecording(id) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(Number(id));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.target.error);
        });
    },

    // --- Studio スコア保存 ---
    async saveStudioScore(scoreRecord) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(["studioScores"], "readwrite");
            const store = tx.objectStore("studioScores");
            const req = store.add(scoreRecord);

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    // --- Studio スコア全取得 ---
    async getAllStudioScores() {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(["studioScores"], "readonly");
            const store = tx.objectStore("studioScores");
            const req = store.getAll();

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    // --- Studio スコア更新（同一曲レコードへの上書き保存） ---
    async updateStudioScore(scoreRecord) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(["studioScores"], "readwrite");
            const store = tx.objectStore("studioScores");
            const req = store.put(scoreRecord); // ★ put = 既存IDがあれば上書き、無ければ追加

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    // --- Studio スコア削除 ---
    async deleteStudioScore(id) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(["studioScores"], "readwrite");
            const store = tx.objectStore("studioScores");
            const req = store.delete(id);

            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },

    // --- Jukebox：MIDIファイルの保存 ---
    // entry = { title, durationMs, midiData(ArrayBuffer), createdAt }
    async saveJukeboxEntry(entry) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([JUKEBOX_STORE], "readwrite");
            const store = tx.objectStore(JUKEBOX_STORE);
            const req = store.add(entry);

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    // --- Jukebox：全件取得 ---
    async getAllJukeboxEntries() {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([JUKEBOX_STORE], "readonly");
            const store = tx.objectStore(JUKEBOX_STORE);
            const req = store.getAll();

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    // --- Jukebox：1件取得 ---
    async getJukeboxEntry(id) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([JUKEBOX_STORE], "readonly");
            const store = tx.objectStore(JUKEBOX_STORE);
            const req = store.get(Number(id));

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    // --- Jukebox：削除 ---
    async deleteJukeboxEntry(id) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([JUKEBOX_STORE], "readwrite");
            const store = tx.objectStore(JUKEBOX_STORE);
            const req = store.delete(Number(id));

            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }
};

/* ==========================================================
   main.js 等の UI 側から呼び出すための高機能版（ロジック集約）
   ========================================================== */

/**
 * 削除して最新リストを返す
 */
export async function deleteAndRefresh(id) {
    await playnoteDB.deleteRecording(id);
    return await playnoteDB.getAllRecordings();
}

/**
 * 日付等を整形して保存し、最新リストを返す
 */
export async function saveAndRefresh(title, mode, events) {
    const now = new Date();

    // 日付（UI 表示用）
    const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;

    // ★ Session モード専用の命名規則：Session_YYYYMMDD_HHMM
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');

    // title が未指定の場合のみ自動生成
    let autoTitle = `Session_${y}${m}${d}_${hh}${mm}`;

    const entry = {
        title: title || autoTitle,
        mode: mode || 'Session',
        date: dateStr,
        events: events || [],
        timestamp: Date.now()
    };

    await playnoteDB.saveRecording(entry);
    return await playnoteDB.getAllRecordings();
}

/**
 * 指定IDからMIDIを生成してエクスポートを実行する
 */
export async function getAndExportMIDI(id) {
    // 1. IndexedDBから録音データを取得
    const record = await playnoteDB.getRecording(id);
    if (!record || !record.events) {
        throw new Error("録音データまたは演奏ログが見つかりません");
    }

    // 2. session.jsからインポートした関数でMIDIバイナリ(Uint8Array)を生成
    const midiData = convertEventsToMidi(record.events);
    if (!midiData) {
        throw new Error("MIDIデータの生成に失敗しました");
    }

    // 3. ブラウザのダウンロード機能を使って保存させる
    const blob = new Blob([midiData], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    // タイトルがあれば使い、なければ日付などのデフォルト名にする
    const fileName = record.title ? `${record.title}.mid` : `PianoWorks_Rec_${id}.mid`;
    
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a); // 一時的に画面に追加
    a.click();                   // プログラムからクリックを実行
    
    // 後片付け
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return fileName;
}

/**
 * ★ URL共有機能
 * 演奏イベントをMIDIバイト列 → gzip圧縮 → base64url化してURLに埋め込む。
 * サーバーを一切使わず、リンクを開いた側のブラウザだけで再生できる。
 *
 * 【重要】PLAYER_BASE_URL は再生用ページ（別途お渡しした index.html）を
 * GitHub Pages 等にデプロイした後の実際のURLに書き換えてください。
 */
const SHARE_PLAYER_BASE_URL = "https://reva-mement.github.io/pianoworks-player/";

function base64UrlEncode(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function buildShareUrl(record) {
    const midiData = convertEventsToMidi(record.events);
    if (!midiData) return null;

    let bytes = midiData;
    let gzipped = false;

    // ブラウザがgzip圧縮に対応していれば圧縮してURLを短くする（対応していなくても動作はする）
    if (window.CompressionStream) {
        try {
            const cs = new CompressionStream('gzip');
            const stream = new Blob([midiData]).stream().pipeThrough(cs);
            bytes = new Uint8Array(await new Response(stream).arrayBuffer());
            gzipped = true;
        } catch (e) {
            console.warn("gzip圧縮に失敗、無圧縮で続行します", e);
        }
    }

    const url = new URL(SHARE_PLAYER_BASE_URL);
    url.searchParams.set('d', base64UrlEncode(bytes));
    url.searchParams.set('t', encodeURIComponent(record.title || 'PianoWorks Session'));
    url.searchParams.set('z', gzipped ? '1' : '0');
    return url.toString();
}

/**
 * X (Twitter) への共有機能
 * ★ MIDIファイルのダウンロードは行わない。演奏を再生できるURLリンクのみをツイートに含める。
 *   （MIDIをローカルに保存したい場合は、アーカイブの📥ボタンを使ってください）
 */
window.shareToX = async function(id, title, mode) {
    // ★ Web(体験)版：SNS共有機能はローカル(有料)版限定
    if (!isLocalApp()) {
        showLocalOnlyToast("演奏の共有(𝕏)機能");
        return;
    }

    try {
        console.log(`Starting share process for ID: ${id}`); // デバッグ用

        // 1. IndexedDBからデータを取得
        const record = await playnoteDB.getRecording(id);
        if (!record || !record.events) {
            console.error("録音データが見つかりません");
            return;
        }

        // 2. ★ URLで共有できるリンクを生成（再生ページが未デプロイの場合はnullになる）
        const shareUrl = await buildShareUrl(record);

        // 3. 𝕏共有画面の展開
        // ★ 同じ演奏を複数回共有すると文言が完全に同一になり、Xの「重複ツイート」判定で
        //   投稿できなくなることがあるため、共有した日時を末尾に添えて毎回わずかに変える
        const sharedAt = new Date().toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const saveMessage = shareUrl
            ? `\nこちらのリンクで演奏を再生できます👇\n${shareUrl}\n`
            : `\n`;
        const text = `PianoWorksで「${title}」を奏でました。\n演奏モード: ${mode}\n${saveMessage}\n(共有日時: ${sharedAt})`;
        const hashtags = "PianoWorks,ピアノ";
        const xIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&hashtags=${encodeURIComponent(hashtags)}`;

        if (window.__TAURI__) {
            window.__TAURI__.core.invoke("plugin:opener|open_url", { url: xIntentUrl })
                .catch(err => console.error("𝕏起動失敗:", err));
        } else {
            window.open(xIntentUrl, '_blank');
        }
    } catch (err) {
        console.error("共有プロセス中にエラー:", err);
    }
};

/**
 * DBから全データを取得し、アーカイブテーブルのHTMLを生成して画面を更新する
 */
export async function refreshArchiveUI() {
    const container = document.getElementById('playnote-list-container');
    if (!container) return;

    const data = await playnoteDB.getAllRecordings();

    // ★★★ ソート ★★★
    // currentSortKey が null のときは従来通り「登録順（古い順、timestamp昇順）」。
    // ヘッダーの▲▼が押されていれば、そのキー・方向でソートする。
    let sortedData;
    if (currentSortKey) {
        sortedData = [...data].sort((a, b) => {
            let va, vb;
            if (currentSortKey === 'title') {
                va = (a.title || '');
                vb = (b.title || '');
            } else { // 'date'
                va = a.timestamp ?? 0;
                vb = b.timestamp ?? 0;
            }
            const cmp = (typeof va === 'string') ? va.localeCompare(vb) : (va - vb);
            return currentSortDir === 'asc' ? cmp : -cmp;
        });
    } else {
        // 🔄 【修正】降順(b - a)から、昇順(a - b)に変更。新しいものが一番下に並ぶようになります。
        sortedData = [...data].sort((a, b) => a.timestamp - b.timestamp);
    }

    // ★ ヘッダーの▲▼マークアップを生成するヘルパー（Studio Archiveと同じデザイン）
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
        <table class="archive-table" id="pw-board-table">
            <thead>
                <tr>
                    <th>No.</th>
                    <th style="text-align: left; padding-left: 15px;">TITLE${sortArrows('title')}</th>
                    <th>MODE</th>
                    <th>DATE${sortArrows('date')}</th>
                    <th>DEMO</th>
                    <th>DOWNLOAD</th>
                    <th>SHARE</th>
                    <th>DEL</th>
                </tr>
            </thead>
            <tbody>
    `;

sortedData.forEach((rec, index) => {
    const safeTitle = (rec.title || 'No Title').replace(/'/g, "\\'");
    const safeMode = (rec.mode || 'Session');
    // ★ title属性(ツールチップ)用。HTML属性なのでダブルクォートをエスケープする
    const htmlSafeTitle = (rec.title || 'No Title').replace(/"/g, '&quot;');

    // ★ Web(体験)版：SHARE(𝕏)ボタンはローカル(有料)版限定のため、視覚的にロック表示する
    const shareBtnHtml = isLocalApp()
        ? `<button class="table-btn-sns" onclick="window.shareToX(${rec.id}, '${safeTitle}', '${safeMode}')">𝕏</button>`
        : `<button class="table-btn-sns" style="opacity:0.5;cursor:not-allowed;" title="ローカル版（有料）限定の機能です" onclick="window.shareToX(${rec.id}, '${safeTitle}', '${safeMode}')">𝕏</button>`;

    html += `
        <tr>
            <td>${index + 1}</td>
            <td style="text-align: left; padding-left: 15px;" title="${htmlSafeTitle}">${rec.title || 'No Title'}</td>
            <td>${rec.mode || '-'}</td>
            <td>${rec.date || '-'}</td>
            <td><button class="table-btn-play" onclick="playArchiveWithUI(${rec.id}, this)">▶</button></td>
            <td><button class="table-btn-down" onclick="window.exportArchiveToMIDI(${rec.id})">📥</button></td>
            <td>${shareBtnHtml}</td>
            <td><button class="table-btn-del" data-id="${rec.id}">🗑️</button></td>
        </tr>`;
});


    html += '</tbody></table>';
    container.innerHTML = html;

    // ============================================================
    // ★ ソート矢印（▲▼）のイベント（Studio Archiveと同じ方式）
    // ============================================================
    container.querySelectorAll(".sort-arrow").forEach(arrow => {
        arrow.addEventListener("click", () => {
            currentSortKey = arrow.dataset.sortKey;
            currentSortDir = arrow.dataset.sortDir;
            refreshArchiveUI();
        });
    });

    // ============================================================
    // ★ 削除ボタンのイベント（修正版：UUID文字列を安全に扱う）
    // ============================================================
    // rec.id を onclick="deleteArchive(${rec.id})" のように直接埋め込むと、
    // id が UUID文字列（ハイフン区切り）の場合に
    // "deleteArchive(abc-123-de)" という無効な式として解釈され、
    // クリック時に "Invalid or unexpected token" で必ず失敗してしまう。
    // → data-id 属性（常に文字列）で安全に受け渡し、実レコードの
    //   元の型（数値 or 文字列）の id で削除する。
    container.querySelectorAll(".table-btn-del").forEach(btn => {
        btn.addEventListener("click", async () => {
            const idAttr = btn.dataset.id;
            if (!confirm("この録音を削除しますか？")) return;

            const all = await playnoteDB.getAllRecordings();
            const rec = all.find(r => String(r.id) === String(idAttr));
            const realId = rec ? rec.id : idAttr;

            await deleteAndRefresh(realId);
            await refreshArchiveUI();
        });
    });
}

window.exportArchiveToMIDI = async (id) => {
    try {
        // --- 実行の瞬間にSEを鳴らす ---
        playNotificationSound();

        const fileName = await getAndExportMIDI(id);
        
        // 自作モーダルで通知を表示
        window.showToast(`MIDIファイルを保存しました！\n\n[ ${fileName} ]\n\nダウンロードフォルダを確認してください。`);

    } catch (err) {
        console.error("Export Error:", err);
        window.showToast("書き出しに失敗しました:\n" + err.message);
    }
};

function playNotificationSound() {
    try {
        const ctx = window.audioContext;
        if (!ctx) return;
        
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        // サウンドデザイン: 柔らかな高音のサイン波
        osc.type = 'sine'; 
        osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 (ラ)
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15); // 音程を下げる
        
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
        console.warn("SE play failed", e);
    }
}

window.deleteArchive = async (id) => {
    if (!confirm("この録音を削除しますか？")) return;
    await deleteAndRefresh(id);
    await refreshArchiveUI();
};

// 2. ページ読み込み時の自動初期化
// ★ Session Archive のUI描画は、DBの初期化だけ済ませておき、
//   実際にユーザーがアーカイブを開いたタイミングで行う（openPlaylistBtn 側で呼ぶ）
window.addEventListener('DOMContentLoaded', async () => {
    try {
        await playnoteDB.init();
    } catch (err) {
        console.error("DB Initialization Error:", err);
    }
});

export async function addRecordingToArchive(title, mode, events) {
    try {
        await saveAndRefresh(title, mode, events);
        await refreshArchiveUI();
        console.log(`--- [DB] Added and UI Refreshed: ${title} ---`);
    } catch (err) {
        console.error("録音データの保存に失敗しました:", err);
    }
}

/**
 * カスタム通知モーダルを表示する
 */
window.showToast = (message) => {
    const modal = document.getElementById('toast-modal');
    const msgEl = document.getElementById('toast-message');
    if (!modal || !msgEl) return;

    msgEl.innerText = message;
    modal.style.display = 'flex'; 
};

/**
 * カスタム通知モーダルを閉じる
 */
window.closeToast = () => {
    // --- モーダルを閉じる ---
    const modal = document.getElementById('toast-modal');
    if (modal) modal.style.display = 'none';
};

/**
 * MIDI重複確認モーダルを表示する。
 * 「上書き保存をする」→ resolve('overwrite')
 * 「新しい曲として登録する」→ resolve('new')
 * を返す Promise。ボタン以外（背景クリックなど）では閉じない。
 */
window.showDuplicateConfirm = (title) => {
    return new Promise((resolve) => {
        const modal = document.getElementById('duplicate-confirm-modal');
        const msgEl = document.getElementById('duplicate-confirm-message');
        const overwriteBtn = document.getElementById('duplicate-confirm-overwrite');
        const newBtn = document.getElementById('duplicate-confirm-new');
        if (!modal || !overwriteBtn || !newBtn) {
            resolve('new'); // フェイルセーフ：モーダルが無ければ新規登録扱い
            return;
        }

        if (msgEl) {
            msgEl.innerText = `「${title}」と同じ曲がStudio Archiveに登録されているようです。処理を選んでください。`;
        }

        const cleanup = (result) => {
            modal.style.display = 'none';
            overwriteBtn.removeEventListener('click', onOverwrite);
            newBtn.removeEventListener('click', onNew);
            resolve(result);
        };
        const onOverwrite = () => cleanup('overwrite');
        const onNew = () => cleanup('new');

        overwriteBtn.addEventListener('click', onOverwrite);
        newBtn.addEventListener('click', onNew);

        modal.style.display = 'flex';
    });
};

document.getElementById('pw-board').addEventListener('click', (e) => {
    if (e.target.id === 'pw-close' || e.target.id === 'pw-close-x') {

        // ★ 再生停止を追加（これだけで OK）
        if (window.stopPlayback) window.stopPlayback();
        if (window.handleStopMIDI) window.handleStopMIDI();
        if (window.stopSessionPlayback) window.stopSessionPlayback();

        // 既存の閉じる処理
        document.getElementById('pw-board').style.display = 'none';
    }
});

export default playnoteDB;
window.playnoteDB = playnoteDB;