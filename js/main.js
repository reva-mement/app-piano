/* ==========================================
   PianoWorks: Main Controller
   ========================================== */
import { initPiano } from './instruments/piano.js';
import { updateMasterVolume, isLocalApp, showPaidFeatureTooltip } from './utils.js';
import { initStudioMode } from './modes/studio.js';
import { playnoteDB, getAndExportMIDI, saveAndRefresh, deleteAndRefresh, refreshArchiveUI } from './playnote-db.js';
import { setupScoreBoard, renderStudioScoreList, saveImportedMidiToScoring } from "./modes/studio/studio-scoring-ui.js";
import { setupJukeboxBoard } from "./modes/jukebox.js";

// ★ 追加：思考エンジンのインポート
import { initThoughtEngine } from './thought-engine.js';

// --- 状態管理 ---
let loadedMidiData = null;
window.loadedMidiData = loadedMidiData;
let videoPlayerElement = null;
window.isPlaying = false;
window.isGuideMode = false;
window.closeSelectModal = closeSelectModal;
window.playArchiveWithUI = async function(id, btn) {

    // ■ の場合は停止
    if (window.currentPlayback.isPlaying && window.currentPlayback.activeButton === btn) {
        window.stopPlayback();
        return;
    }

    // 他の曲が再生中なら停止
    if (window.currentPlayback.isPlaying) {
        window.stopPlayback();
    }

    // ▶ → ■
    btn.textContent = "■";
    window.currentPlayback.activeButton = btn;
    window.currentPlayback.isPlaying = true;

    const record = await playnoteDB.getRecording(id);
    if (!record || !record.events) return;

window.currentPlayback.timeouts = record.events.map(ev => {
    return setTimeout(() => {
        if (!window.currentPlayback.isPlaying) return;

        if (ev.type === 'off') {
            // ★ note-off は音を止める処理。これが無いと全ての音が鳴らしっぱなしで
            //   重なり続け、テンポ・リズムが崩れて聞こえる原因になっていた。
            if (window.stopNote) window.stopNote(ev.note);
        } else {
            // ★ AI の音量が小さい問題はここで解決
            window.playNote(ev.note, ev.velocity ?? 0.8, true);
        }

    }, ev.time * 1000);
});


    // ★ここがまだ秒のままだったので修正
    const lastTime = record.events[record.events.length - 1].time;
    const endTimer = setTimeout(() => {
        window.stopPlayback();
    }, lastTime * 1000 + 100); // ← ★ここを修正

    window.currentPlayback.timeouts.push(endTimer);
};


// 背景設定用の定数
const DEFAULT_BG_PATH = 'assets/copilot_image_1774523714927.jpeg';
const BG_STORAGE_KEY = 'pianoworks_custom_bg';
const BG_URL_STORAGE_KEY = 'pianoworks_custom_bg_url'; // ★ URL背景用の保存キー
const GAME_OVERLAY_OPACITY_KEY = 'pianoworks_game_overlay_opacity'; // ★ GAME ONオーバーレイの濃さ

// 設定一時保持用（OKを押すまでここを書き換える）
let tempConfig = {
    focusRange: "3", // オクターブ幅（マスク）
    pendingBgDataUrl: null, // 背景画像
    pendingBgUrl: undefined, // ★ URL背景（undefined=未変更, null=クリア, 文字列=新しいURL）
    pendingOverlayOpacity: undefined // ★ GAME ONオーバーレイの濃さ（undefined=未変更）
};

export function forceStopAll() {
    console.log("★Global Stop: All modes reset.");

    // Studioモード等の停止
    if (typeof window.forceStopStudioMIDI === 'function') window.forceStopStudioMIDI();
    
    if (window.videoPlayerElement) {
        window.videoPlayerElement.pause();
        window.videoPlayerElement.currentTime = 0;
    }

    // Sessionモードの停止（isPlaying の時だけ呼ぶようにしてループを防ぐ）
    // すでに session.js 側で false になっていれば、ここは実行されずループが止まります。
    import('./modes/session.js').then(m => {
        if (m.sessionState && m.sessionState.isPlaying === true) {
            m.stopSessionLogic();
        }
    });

    window.isPlaying = false;
}

document.addEventListener('DOMContentLoaded', async () => {
    // ★ スマートフォン等と判定された場合は、アプリ本体の初期化を一切行わない
    //   （index.html側の早期スクリプトで既にブロックモーダルは表示済み）
    if (window.__PIANOWORKS_MOBILE_BLOCK__) {
        console.log('📱 Mobile device detected. Skipping app initialization.');
        return;
    }

    handleLoader();

    try {
        await initPiano();
        setupVolumeControl();
        setupMidiLoader();
        setupModals();
        setupPianoWorksBoard();

        /* ★ 追加：Scoring モーダルのセットアップ */
        setupScoreBoard();
        // ★ Studio Archive の一覧描画はモーダルを開いたタイミング（setupScoreBoard内）で行うため、
        //   ページ読み込み時にはここでは呼び出さない

        /* ★ 追加：Jukebox モーダルのセットアップ */
        setupJukeboxBoard();

        initBackground();
        await initStudioMode(() => loadedMidiData);
        initRangeDisplay();
        initThoughtEngine();
        showFirstVisitHelpTip();

    } catch (e) {
        console.error("Initialization error:", e);
    }
});

/**
 * ★ 初回ログイン時のみ、右上のはてなボタンを指す吹き出しを表示する。
 * 「操作方法はこちらから確認できます」と表示し、3回点滅してから消える。
 * localStorage に記録を残すので、2回目以降は表示されない。
 */
function showFirstVisitHelpTip() {
    const STORAGE_KEY = 'pw_seen_help_tip';
    if (localStorage.getItem(STORAGE_KEY)) return;

    const helpBtn = document.getElementById('help-trigger');
    if (!helpBtn) return;

    const tip = document.createElement('div');
    tip.id = 'first-visit-help-tip';
    tip.textContent = '操作方法はこちらから確認できます';
    (document.getElementById('app-scale-wrapper') || document.body).appendChild(tip);

    const FLASH_ON_MS = 600;
    const FLASH_OFF_MS = 400;
    const TOTAL_BLINKS = 3;
    let blinkCount = 0;

    tip.style.transition = 'opacity 0.3s ease';

    function blink() {
        tip.style.opacity = '1';
        setTimeout(() => {
            blinkCount++;
            if (blinkCount < TOTAL_BLINKS) {
                tip.style.opacity = '0';
                setTimeout(blink, FLASH_OFF_MS);
            } else {
                // 3回点滅し終えたら、最後はフェードアウトして完全に消す
                setTimeout(() => {
                    tip.style.transition = 'opacity 1.6s ease';
                    tip.style.opacity = '0';
                    setTimeout(() => tip.remove(), 700);
                }, FLASH_OFF_MS);
            }
        }, FLASH_ON_MS);
    }

    // ★★★ 修正：起動時のローディング画面(#piano-loader-container)が
    //   4秒間表示 + 2秒かけてフェードアウト＝計6秒間、画面全体(z-index:10001)を
    //   覆っているため、それより前に開始すると誰にも見えないまま消えてしまっていた。
    //   ローディングが完全に終わるタイミングまで待ってから開始する。
    setTimeout(blink, 6300);

    localStorage.setItem(STORAGE_KEY, '1');
}

/* --- 機能別モジュール --- */

function handleLoader() {
    const loader = document.getElementById('piano-loader-container');
    if (!loader) return;
    setTimeout(() => {
        loader.classList.add('loader-hidden');
        loader.style.opacity = '0';
        loader.style.pointerEvents = 'none';
        setTimeout(() => { loader.style.display = 'none'; }, 2000);
    }, 4000);
}

function setupVolumeControl() {
    const vSlider = document.getElementById('master-volume');
    const vInput = document.getElementById('volume-input');
    if (!vSlider || !vInput) return;

    const apply = (val) => {
        updateMasterVolume(val);
        // main.js の初期化フローで global に設定した参照を使用
        if (window.videoPlayerElement) window.videoPlayerElement.volume = val;
    };

    // スライダー操作は「動かしている最中」に即時反映してほしいので input のまま
    vSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        vInput.value = Math.round(val * 100);
        apply(val);
    });

    // 入力が確定した時（Enterキー、またはフォーカスが外れた時）にだけ実行する共通関数
    const commitInput = () => {
        let val = Math.min(100, Math.max(0, parseInt(vInput.value) || 0));
        vInput.value = val; // 入力欄をバリデーション後の値に補正
        vSlider.value = val / 100; // スライダーの位置を更新
        apply(val / 100); // ここで初めて音量を確定
    };

    // 【重要】古い 'input' イベントリスナーは削除し、'change' だけにする
    vInput.addEventListener('change', commitInput);

    // Enterキーでも確定（blurさせてchangeイベントを走らせる）
    vInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            vInput.blur(); 
        }
    });
}

function setupMidiLoader() {
    const midiInput = document.getElementById('midi-upload');
    if (!midiInput) return;

    midiInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        window.currentMidiFileName = file.name;

        const reader = new FileReader();
        reader.onload = async (ev) => { 
            loadedMidiData = ev.target.result;
            window.loadedMidiTitle = file.name.replace(/\.[^/.]+$/, "");

            // ★ 新しいMIDIを読み込む際、前の曲の残留データをすべてリセットする
            window.blockResults = [];
            window.totalSpawnedBlocks = 0;
            window.activeScoringRecord = null;
            // Studio側のisMidiLoaded・dbNoteScheduleをリセット（グローバル経由）
            if (typeof window.resetStudioMidiState === 'function') {
                window.resetStudioMidiState();
            }

            if (window.midiPlayerInstance) {
                console.log("⚡ Parsing MIDI (sync)...");

                // ★ MIDI ロード（同期パース）
                window.midiPlayerInstance.loadArrayBuffer(loadedMidiData);

                // ★ ノート抽出（あなたのパーサー専用）
                const songData = extractNotesFromMidi(window.midiPlayerInstance);

                if (songData.length > 0) {
                    // スコアリング用に保存
                    if (typeof setOriginalSongData === 'function') {
                        setOriginalSongData(songData);
                    }

                    // ★★★ studioScores（scoringDB）にも保存 ★★★
                    try {
                        // ★★★ 二重保存バグの修正 ★★★
                        // ここで保存したレコードを window.activeScoringRecord に
                        // 紐付けておかないと、後で finishStudioGameSession() が
                        // 「このMIDIに対応する既存レコードが無い」と誤認し、
                        // 同じ曲についてもう1件、別レコードとして保存してしまう
                        // （＝アーカイブに同じ曲が2つ並ぶ不具合）。
                        // 直前で window.activeScoringRecord = null にリセットしているが、
                        // ここで保存結果を代入し直すことで、この後プレイした結果が
                        // 正しく「同じレコードへの更新」として保存されるようになる。
                        window.activeScoringRecord = await saveImportedMidiToScoring({
                            title: window.currentMidiFileName,
                            notes: songData
                        });

                        console.log("💾 MIDI データを scoringDB に保存しました:", songData.length, "notes");

                        // ★ scoringDBモーダルが開いている場合、即座に一覧に反映する
                        //   （これが無いと「保存はされているのに表示が更新されない」ように見える）
                        if (typeof renderStudioScoreList === 'function') {
                            await renderStudioScoreList();
                        }
                    } catch (err) {
                        console.error("❌ MIDI データの DB 保存に失敗しました:", err);
                    }
                } else {
                    console.warn("⚠ ノートイベントが見つかりませんでした");
                }

                if (typeof window.refreshStudioTimeDisplay === 'function') {
                    window.refreshStudioTimeDisplay();
                }
            }

            if (typeof window.updateStudioSongDisplay === 'function') {
                window.updateStudioSongDisplay(file.name);
            }
        };

        reader.readAsArrayBuffer(file);
    });
}

window.extractNotesFromMidi = function(player) {
    const division = player.division;

    // ============================================================
    // ★★★ 修正：全トラックをマージして処理する ★★★
    // ------------------------------------------------------------
    // 従来は player.tracks[0] の1トラックだけを読んでいた。
    // 多くのピアノMIDIは「メロディ」「伴奏／コード」が別トラックに
    // 分かれているため、tracks[0] だけだと
    //   ・常に単音しか拾えない（コードが別トラックにある）
    //   ・曲の冒頭が無音（その区間に音があるのが別トラックだけ）
    // という不具合が発生していた。全トラックの events をマージしてから
    // ノート抽出・テンポ変換を行う。
    // ============================================================
    const allEvents = [];
    (player.tracks || []).forEach(track => {
        if (track && Array.isArray(track.events)) {
            allEvents.push(...track.events);
        }
    });

    // ============================================================
    // ★ テンポ変化（Set Tempo）に対応した tick → ms 変換
    // ------------------------------------------------------------
    // 従来は player.tempo（曲を一度パースし終えた時点で最後に検出された
    // テンポ）だけを使い、曲全体を単一テンポで ms に変換していた。
    // 曲中にテンポ変化があると、冒頭のテンポと「最後に検出されたテンポ」が
    // 異なるため、冒頭の音の time が実際よりも大きく（または小さく）ズレて
    // しまい、scoringDB 経由の Studio モードで「音もブロックも何十秒も
    // 出てこない」という不具合の原因になっていた。
    // ここでは Set Tempo イベントごとに区間を分け、区間ごとに正しい
    // ms/tick で積算する。
    // ============================================================
    const tempoEvents = allEvents
        .filter(ev => ev.name === 'Set Tempo' && typeof ev.tick === 'number' && ev.data)
        .map(ev => ({ tick: ev.tick, bpm: ev.data }))
        .sort((a, b) => a.tick - b.tick);

    if (tempoEvents.length === 0 || tempoEvents[0].tick > 0) {
        tempoEvents.unshift({ tick: 0, bpm: player.tempo || 120 });
    }

    // 各テンポ区間の「区間開始tick」「区間開始ms」「その区間のms/tick」を事前計算
    const segments = [];
    tempoEvents.forEach(({ tick, bpm }) => {
        const msPerTick = (60 / bpm / division) * 1000;
        const prev = segments[segments.length - 1];
        const startMs = prev ? prev.startMs + (tick - prev.startTick) * prev.msPerTick : 0;
        segments.push({ startTick: tick, startMs, msPerTick });
    });

    function tickToMs(targetTick) {
        // 対象 tick が含まれる区間を後ろから探す
        for (let i = segments.length - 1; i >= 0; i--) {
            if (segments[i].startTick <= targetTick) {
                const seg = segments[i];
                return seg.startMs + (targetTick - seg.startTick) * seg.msPerTick;
            }
        }
        return 0;
    }

    // ★ トラックごとに activeNotes を分けて管理する
    //   （複数トラックで同じ音高が同時に鳴っても、Note off の対応関係が
    //    トラック間で混ざらないようにするため）
    let songData = [];

    (player.tracks || []).forEach(track => {
        if (!track || !Array.isArray(track.events)) return;
        const activeNotes = {};

        for (const ev of track.events) {
            if (ev.name === "Note on" && ev.velocity > 0) {
                activeNotes[ev.noteNumber] = {
                    startTick: ev.tick,
                    velocity: ev.velocity
                };
            }

            if (ev.name === "Note off" ||
                (ev.name === "Note on" && ev.velocity === 0)) {

                const info = activeNotes[ev.noteNumber];
                if (info) {
                    const startMs = tickToMs(info.startTick);
                    const endMs = tickToMs(ev.tick);

                    songData.push({
                        pitch: ev.noteNumber,
                        velocity: info.velocity,
                        time: startMs,
                        duration: Math.max(0, endMs - startMs)
                    });

                    delete activeNotes[ev.noteNumber];
                }
            }
        }
    });

    // ★ 複数トラックをマージしたので、時間順に並べ直す
    songData.sort((a, b) => a.time - b.time);

    // ★ 正確な曲の長さ（ms）を計算してグローバルに保持する
    //   （getSongTime()はテンポチェンジが多い曲で変動するため使わない）
    //   ★ 修正：「開始時刻が一番遅い音」の終了時刻ではなく、
    //   「全ノートの終了時刻の中で最大のもの」を使う（Jukebox側の計算式と統一）。
    //   開始は早くても、より長く伸びて後まで鳴っている音がある場合、
    //   前者の方式だと曲の長さを短く見積もってしまうため。
    if (songData.length > 0) {
        window.currentSongDurationMs = Math.max(
            ...songData.map(n => (n.time || 0) + (n.duration || 0))
        );
    } else {
        window.currentSongDurationMs = 0;
    }

    return songData;
};

// 4. モーダル管理（背景設定の紐付けもここで行う）
function setupModals() {
    const overlays = {
        settings: document.getElementById('settings-modal-overlay'),
        help: document.getElementById('help-modal-overlay'),
    };

    document.addEventListener('click', (e) => {
        // 設定を開く
        if (e.target.closest('#settings-trigger')) {
            const currentChecked = document.querySelector('input[name="focus-range"]:checked');
            tempConfig.focusRange = currentChecked ? currentChecked.value : "3";
            tempConfig.pendingBgDataUrl = null; 
            tempConfig.pendingBgUrl = undefined; // ★ 開くたびにリセット
            tempConfig.pendingOverlayOpacity = undefined; // ★ 開くたびにリセット
            const urlInput = document.getElementById('bg-url-input');
            const statusEl = document.getElementById('bg-url-status');
            if (urlInput) urlInput.value = localStorage.getItem(BG_URL_STORAGE_KEY) || '';
            if (statusEl) statusEl.textContent = '';
            const opacitySlider = document.getElementById('game-overlay-opacity-slider');
            const opacityValueEl = document.getElementById('game-overlay-opacity-value');
            if (opacitySlider) {
                opacitySlider.value = window.gameOverlayOpacity ?? 0.95;
                if (opacityValueEl) opacityValueEl.textContent = parseFloat(opacitySlider.value).toFixed(2);
            }
            overlays.settings.style.display = 'flex';
        }

        // ヘルプを開く
        if (e.target.closest('#help-trigger')) {
            overlays.help.style.display = 'flex';
        }

        // ヘルプを閉じる（×ボタン・CANCELボタン共通）
        if (e.target.closest('#help-close-btn') || e.target.closest('#help-cancel-btn')) {
            overlays.help.style.display = 'none';
        }
        
        // ×ボタンで閉じる（破棄）
        if (e.target.closest('#settings-close-btn')) discardSettings();

        // 背景クリック
        if (Object.values(overlays).includes(e.target)) {
            if (e.target === overlays.settings) discardSettings();
            if (e.target === overlays.help) overlays.help.style.display = 'none';
        }
    });

    

    // 背景変更ボタンのセットアップ
    setupBackgroundSettings();

    // ★ MIDI検索ボタンのセットアップ
    setupMidiSearch();
}

/**
 * ★ 検索窓に入力したテキスト + "MIDI" で、Web検索を開く
 */
function setupMidiSearch() {
    const input = document.getElementById('midi-search-input');
    const btn = document.getElementById('midi-search-btn');
    if (!input || !btn) return;

    const doSearch = () => {
        const query = input.value.trim();
        if (!query) return;
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query + ' MIDI')}`;
        if (window.__TAURI__) {
            window.__TAURI__.core.invoke('plugin:opener|open_url', { url: searchUrl })
                .catch(err => console.error('MIDI検索の起動に失敗:', err));
        } else {
            window.open(searchUrl, '_blank');
        }
    };

    btn.addEventListener('click', doSearch);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSearch();
    });
}

// 5. ショートカット
window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Escape') forceStopAll();
});

/* --- 背景・マスク（設定）制御ロジック --- */

function initBackground() {
    const videoBgLayer = document.getElementById('video-background');
    const savedBg = localStorage.getItem(BG_STORAGE_KEY);
    if (savedBg && videoBgLayer) {
        videoBgLayer.style.backgroundImage = `url(${savedBg})`;
    }

    // ★★★ 修正：以前はここで即座に applyBackgroundUrl() して表示していたため、
    //   アプリ起動時・リロード時にもカスタム背景がずっと表示されたままになり、
    //   「ESC中断・曲完了・リロードしてもdefaultに戻らない」原因になっていた。
    //   ここでは保存されているURLを覚えておくだけにして、実際の表示は
    //   GAME ON開始時（studio.js側）に切り替える。
    const savedBgUrl = localStorage.getItem(BG_URL_STORAGE_KEY);
    if (savedBgUrl) {
        window.hasCustomBgUrl = true;
        window.customBgUrlValue = savedBgUrl;
    } else {
        window.hasCustomBgUrl = false;
        window.customBgUrlValue = null;
    }

    // ★ GAME ONオーバーレイの濃さを復元（未設定なら0.95がデフォルト）
    const savedOpacity = localStorage.getItem(GAME_OVERLAY_OPACITY_KEY);
    window.gameOverlayOpacity = savedOpacity !== null ? parseFloat(savedOpacity) : 0.95;
}

// ★ カスタム背景表示中、PLAY/STOPボタンを元の位置から抜き出して
//   画面左上に固定表示するための保管場所（表示解除時に元へ戻すために使う）
let _floatingControlsOriginalParent = null;
let _floatingControlsOriginalNextSibling = null;

function moveTransportControlsToFloatingCorner() {
    const playBtn = document.getElementById('studio-play-btn');
    const stopBtn = document.getElementById('studio-stop-btn');
    if (!playBtn || !stopBtn) return;
    // ★ 既に移動済みなら何もしない
    if (document.getElementById('floating-transport-controls')) return;

    // 元の位置（親要素・直後の兄弟要素）を覚えておく
    _floatingControlsOriginalParent = playBtn.parentElement;
    _floatingControlsOriginalNextSibling = playBtn.nextSibling;

    const floatingBox = document.createElement('div');
    floatingBox.id = 'floating-transport-controls';
    floatingBox.appendChild(playBtn);
    floatingBox.appendChild(stopBtn);

    (document.getElementById('app-scale-wrapper') || document.body).appendChild(floatingBox);
}

function restoreTransportControlsFromFloatingCorner() {
    const floatingBox = document.getElementById('floating-transport-controls');
    if (!floatingBox) return;

    const playBtn = document.getElementById('studio-play-btn');
    const stopBtn = document.getElementById('studio-stop-btn');

    if (_floatingControlsOriginalParent) {
        // ★ 元あった場所（同じ兄弟要素の直前）に戻す
        if (playBtn) _floatingControlsOriginalParent.insertBefore(playBtn, _floatingControlsOriginalNextSibling);
        if (stopBtn) _floatingControlsOriginalParent.insertBefore(stopBtn, _floatingControlsOriginalNextSibling);
    }
    floatingBox.remove();
}

/**
 * ★ 背景をURL表示（iframe）に切り替える。
 *   画像レイヤー(#video-background)を隠し、代わりにiframeでURLを表示する。
 *   ボタンやピアノなどのUI要素は #ui-layer 側（このレイヤーより手前）に
 *   独自の質感を保ったまま乗っているだけなので、見た目はそのまま残る。
 */
/**
 * ★ 背景を実際にURL表示（iframe）に切り替える【表示専用・設定の保存はしない】。
 *   GAME ON開始時に studio.js から呼ばれる。
 */
function showCustomBackground(url) {
    const videoBgLayer = document.getElementById('video-background');
    const iframe = document.getElementById('video-background-iframe');
    if (!iframe || !url) return;

    if (videoBgLayer) videoBgLayer.style.display = 'none';
    iframe.src = url;
    iframe.style.display = 'block';

    // ★ #ui-layer ごと透過するため、PLAY/STOPボタンだけは
    //   外に出して画面左上に残す（機能はそのまま使える）
    moveTransportControlsToFloatingCorner();
}
window.showCustomBackground = showCustomBackground; // ★ studio.js から呼べるように公開

/**
 * ★ 背景を通常の画像表示に戻す【表示専用・設定の削除はしない】。
 *   GAME ON終了時（ESC中断・曲完了）に studio.js から呼ばれる。
 *   アプリ起動時・リロード時も、この状態（default表示）から始まる。
 */
function showDefaultBackground() {
    const videoBgLayer = document.getElementById('video-background');
    const iframe = document.getElementById('video-background-iframe');
    if (iframe) {
        iframe.style.display = 'none';
        iframe.src = 'about:blank';
    }
    if (videoBgLayer) videoBgLayer.style.display = 'block';

    // ★ 左上に出しておいたPLAY/STOPボタンを元の位置へ戻す
    restoreTransportControlsFromFloatingCorner();
}
window.showDefaultBackground = showDefaultBackground; // ★ studio.js から呼べるように公開

/**
 * ★ 通常のYouTube視聴URL（埋め込み不可）を、埋め込み専用URL（youtube.com/embed/…）に変換する。
 *   背景として自然に流れるよう、自動再生・ミュート・ループ・コントロール非表示も付与する。
 *   YouTube以外のURLはそのまま返す。
 */
function normalizeVideoUrl(url) {
    let videoId = null;

    const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    const embedMatch = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);

    if (watchMatch) videoId = watchMatch[1];
    else if (shortMatch) videoId = shortMatch[1];
    else if (embedMatch) videoId = embedMatch[1];

    if (!videoId) return url; // YouTubeのURLではない

    return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&loop=1&playlist=${videoId}&controls=0`;
}

function setupBackgroundSettings() {
    const urlInput = document.getElementById('bg-url-input');
    const customizeBtn = document.getElementById('bg-customize-btn');
    const defaultBtn = document.getElementById('bg-default-btn');
    const statusEl = document.getElementById('bg-url-status');

    if (!customizeBtn || !urlInput) return;

    customizeBtn.onclick = () => {
        const raw = urlInput.value.trim();
        if (!raw) {
            if (statusEl) statusEl.textContent = 'URLを入力してください';
            return;
        }
        // プロトコル省略時は https:// を補う
        const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        try {
            new URL(url); // 簡易バリデーション（不正なURLなら例外）
        } catch (e) {
            if (statusEl) statusEl.textContent = 'URLの形式が正しくありません';
            return;
        }

        tempConfig.pendingBgUrl = normalizeVideoUrl(url);
        if (statusEl) statusEl.textContent = `準備できました → APPLY OKで反映されます`;
    };

    // ★ Default：URL背景を解除し、元の背景に戻す（APPLY OKまでは確定しない）
    if (defaultBtn) {
        defaultBtn.onclick = () => {
            urlInput.value = '';
            tempConfig.pendingBgUrl = null; // null = クリアする、の意味
            if (statusEl) statusEl.textContent = `元の背景に戻す準備ができました → APPLY OKで反映されます`;
        };
    }

    // ★ GAME ONオーバーレイの濃さスライダー
    const opacitySlider = document.getElementById('game-overlay-opacity-slider');
    const opacityValueEl = document.getElementById('game-overlay-opacity-value');
    if (opacitySlider) {
        opacitySlider.value = window.gameOverlayOpacity ?? 0.95;
        if (opacityValueEl) opacityValueEl.textContent = parseFloat(opacitySlider.value).toFixed(2);

        opacitySlider.oninput = () => {
            const v = parseFloat(opacitySlider.value);
            if (opacityValueEl) opacityValueEl.textContent = v.toFixed(2);
            tempConfig.pendingOverlayOpacity = v;
        };
    }
}

/**
 * 重要：マスク（オクターブ表示幅）を更新する
 */
function applyPianoRange(octave) {
    const mask = document.getElementById('range-mask');
    if (!mask) return;
    
    const val = parseFloat(octave);
    const whiteKeyWidthVw = 5; 
    const visibleWidthVw = val * 7 * whiteKeyWidthVw;

    // マスクの物理的な幅を更新
    mask.style.width = `${visibleWidthVw}vw`;

    if (window.pianoConfig) {
        window.pianoConfig.VISIBLE_OCTAVE = val;
    }

    // マッピング更新のためのトリガー
    requestAnimationFrame(() => {
        const viewport = document.getElementById('piano-viewport');
        if (viewport) {
            viewport.scrollLeft += 1;
            viewport.scrollLeft -= 1;
        }
        if (typeof window.updateIndividualMapping === 'function') {
            window.updateIndividualMapping();
        }
        // ★ ミニマップの可視範囲枠を直接更新（scrollイベント発火に頼らない）
        if (typeof window.syncPianoMinimap === 'function') {
            window.syncPianoMinimap();
        }
    });
}

/**
 * キャンセル：一時的な変更（ラジオボタン・背景予約）を破棄
 */
function discardSettings() {
    const radioToRestore = document.querySelector(`input[name="focus-range"][value="${tempConfig.focusRange}"]`);
    if (radioToRestore) radioToRestore.checked = true;
    
    tempConfig.pendingBgDataUrl = null;
    tempConfig.pendingBgUrl = undefined; // ★ URL背景の変更も破棄
    tempConfig.pendingOverlayOpacity = undefined; // ★ オーバーレイ濃さの変更も破棄
    const urlInput = document.getElementById('bg-url-input');
    const statusEl = document.getElementById('bg-url-status');
    if (urlInput) urlInput.value = '';
    if (statusEl) statusEl.textContent = '';
    document.getElementById('settings-modal-overlay').style.display = 'none';
}

// APPLY OK
const okBtn = document.getElementById('settings-ok-btn');
const cancelBtn = document.getElementById('settings-cancel-btn');

if (okBtn) {
    okBtn.addEventListener('click', () => {
        // 1. オクターブ幅（マスク）を確定・反映
        const selectedRadio = document.querySelector('input[name="focus-range"]:checked');
        if (selectedRadio) {
            applyPianoRange(selectedRadio.value);
        }

        // 2. 背景変更を確定・保存
        if (tempConfig.pendingBgDataUrl !== null) {
            const videoBgLayer = document.getElementById('video-background');
            if (tempConfig.pendingBgDataUrl === DEFAULT_BG_PATH) {
                videoBgLayer.style.backgroundImage = `url(${DEFAULT_BG_PATH})`;
                localStorage.removeItem(BG_STORAGE_KEY);
            } else {
                videoBgLayer.style.backgroundImage = `url(${tempConfig.pendingBgDataUrl})`;
                localStorage.setItem(BG_STORAGE_KEY, tempConfig.pendingBgDataUrl);
            }
            tempConfig.pendingBgDataUrl = null;
        }

        // 3. ★ URL背景を確定・保存
        if (tempConfig.pendingBgUrl !== undefined) {
            if (tempConfig.pendingBgUrl === null) {
                // ★ Default：設定をクリアするだけ（表示は既にdefaultのまま）
                localStorage.removeItem(BG_URL_STORAGE_KEY);
                window.hasCustomBgUrl = false;
                window.customBgUrlValue = null;
            } else {
                // ★ Customize：設定を保存するだけ。実際の表示切り替えはGAME ON開始時に行う
                localStorage.setItem(BG_URL_STORAGE_KEY, tempConfig.pendingBgUrl);
                window.hasCustomBgUrl = true;
                window.customBgUrlValue = tempConfig.pendingBgUrl;
            }
            tempConfig.pendingBgUrl = undefined;
        }

        // 4. ★ GAME ONオーバーレイの濃さを確定・保存
        if (tempConfig.pendingOverlayOpacity !== undefined) {
            window.gameOverlayOpacity = tempConfig.pendingOverlayOpacity;
            localStorage.setItem(GAME_OVERLAY_OPACITY_KEY, String(tempConfig.pendingOverlayOpacity));
            tempConfig.pendingOverlayOpacity = undefined;
        }
        
        document.getElementById('settings-modal-overlay').style.display = 'none';
        console.log("Settings applied.");
    });
}

if (cancelBtn) cancelBtn.addEventListener('click', discardSettings);

function initRangeDisplay() {
    const currentChecked = document.querySelector('input[name="focus-range"]:checked');
    if (currentChecked) {
        applyPianoRange(currentChecked.value);
    }
}

/* --- PianoWorks 看板制御（プレイリスト / スコア選択モーダル対応版） --- */
function setupPianoWorksBoard() {
    console.log("DEBUG: playlist-icon-btn =", document.getElementById('playlist-icon-btn'));
console.log("DEBUG: pw-board =", document.getElementById('pw-board'));
console.log("DEBUG: pw-close =", document.getElementById('pw-close'));
console.log("DEBUG: pw-close-x =", document.getElementById('pw-close-x'));

console.log("DEBUG: pw-select-mode =", document.getElementById('pw-select-mode'));
console.log("DEBUG: pw-open-playlist =", document.getElementById('pw-open-playlist'));
console.log("DEBUG: pw-open-score =", document.getElementById('pw-open-score'));
console.log("DEBUG: pw-select-close =", document.getElementById('pw-select-close'));
console.log("DEBUG: pw-select-close-x =", document.getElementById('pw-select-close-x'));

    const trigger = document.getElementById('playlist-icon-btn'); 

    // 既存のプレイリスト看板
    const board = document.getElementById('pw-board');            

    // ★ 新しい選択モーダル
    const selectModal = document.getElementById('pw-select-mode');
    const selectClose = document.getElementById('pw-select-close');
    const selectCloseX = document.getElementById('pw-select-close-x');

    const openPlaylistBtn = document.getElementById('pw-open-playlist');
    const openScoreBtn = document.getElementById('pw-open-score');

    if (!trigger) return;

    /* ---------------------------------------------------------
       1. 本アイコンを押したら「選択モーダル」を開く
    --------------------------------------------------------- */
    trigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectModal.style.display = 'flex';
        console.log("Select Mode: Opened");
    });

    /* ---------------------------------------------------------
       2. 選択モーダルを閉じる処理
    --------------------------------------------------------- */
    const closeSelectModal = (e) => {
        if (e) e.stopPropagation();
        selectModal.style.display = 'none';
    };

    if (selectClose) selectClose.addEventListener('click', closeSelectModal);
    if (selectCloseX) selectCloseX.addEventListener('click', closeSelectModal);

    // 背景クリックで閉じる
    selectModal.addEventListener('click', (e) => {
        if (e.target === selectModal) closeSelectModal();
    });

    /* ---------------------------------------------------------
       3. 「プレイリストを開く」 → 既存の pw-board を開く
    --------------------------------------------------------- */
    openPlaylistBtn.addEventListener('click', async () => {
        closeSelectModal();
        board.style.display = 'flex';

        // ★ モーダルを開くたびに最新の録音一覧を描画する（ページ読み込み時には行わない）
        if (typeof refreshArchiveUI === 'function') {
            await refreshArchiveUI();
        }

        console.log("Playlist Board: Opened");
    });

    /* ---------------------------------------------------------
       5. 既存のプレイリスト看板の閉じる処理（そのまま維持）
    --------------------------------------------------------- */
    const closeBtn = document.getElementById('pw-close');         
    const closeX = document.getElementById('pw-close-x'); 

    const closeBoard = (e) => {
        if (e) e.stopPropagation();

        // ★ 再生停止（既存の安全処理）
        if (window.stopPlayback) window.stopPlayback();          
        if (window.handleStopMIDI) window.handleStopMIDI();      
        if (window.stopSessionPlayback) window.stopSessionPlayback();

        board.style.display = 'none';
    };

    if (closeBtn) closeBtn.addEventListener('click', closeBoard);
    if (closeX) closeX.addEventListener('click', closeBoard);

    // 背景クリックで閉じる
    board.addEventListener('click', (e) => {
        if (e.target === board) closeBoard();
    });
}

// ★ 選択モーダルを閉じる関数（SCORING / PLAYLIST 共通）
function closeSelectModal() {
    const selectModal = document.getElementById('pw-select-mode');
    if (selectModal) {
        selectModal.style.display = 'none';
    }
}

// 最後にこの関数を実行して、クリック待ちの状態にする
setupPianoWorksBoard();

// ============================================================
// ★ 排他制御：通常再生中（Jukebox再生／Studioタグの通常再生。
//   GAME ONは対象外）に、Studioタグの再生・停止ボタン以外の
//   ボタン等が押されたら、自動的に再生を停止する。
// ============================================================
(function setupPlaybackExclusiveControl() {
    const ALLOWED_IDS = ['studio-play-btn', 'studio-stop-btn'];

    document.addEventListener('click', (e) => {
        // ★ 通常再生中でなければ何もしない
        if (!window.isPlaying) return;
        // ★ GAME ON中はこの制御の対象外（ESC確認ダイアログ側で別途制御されている）
        if (window.isGuideMode) return;

        // ★ 許可された操作（Studioタグの再生・停止ボタン自身）は無視する
        const allowedEl = ALLOWED_IDS
            .map(id => document.getElementById(id))
            .find(el => el && e.target.closest(`#${el.id}`));
        if (allowedEl) return;

        // ★ 実際に何らかの操作可能要素（ボタン等）が押された場合のみ対象にする
        //   （背景クリックや無関係な領域のクリックでは反応しない）
        const clickedControl = e.target.closest('button, .btn-stamp-base, a, input, select, label');
        if (!clickedControl) return;

        console.log('[排他制御] 再生中に他の操作が行われたため、再生を停止します');
        if (typeof window.forceStopStudioMIDI === 'function') {
            window.forceStopStudioMIDI();
        }
    }, true); // ★ captureフェーズで検知し、各ボタン自身のクリック処理より先に判定する
})();

// ============================================================
// ★ Web(体験)版限定：以下は有料版限定機能として無効化し、
//   押すと「有償版限定機能となります」ツールチップを表示する。
//   ・Sessionタグ内のボタン（PLAY・REC・ジャンル選択）
//   ・Studio Archiveボタン
//   ・Session Archiveボタン
//   ローカル(Tauri)版では isLocalApp() が true になるため、
//   このブロックは何もしない（通常通り動作する）。
// ============================================================
(function setupPaidFeatureLocks() {
    if (isLocalApp()) return; // ローカル版では何もしない

    const lockedIds = [
        'session-play-pause-btn',
        'session-rec-btn',
        'session-genre-select',
        'pw-open-score',
        'pw-open-playlist'
    ];

    lockedIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        // ★ 見た目でも「使えない」ことが分かるよう、うっすら薄くする
        // ★ title属性は付けない（ホバー時にブラウザ標準のツールチップが
        //   出てしまい、クリック時の専用ツールチップと二重に見えるため）
        el.style.opacity = '0.5';
        el.style.cursor = 'not-allowed';

        // ★ captureフェーズで最初に処理し、既存のクリック/changeハンドラを止める
        const blockEvent = (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            showPaidFeatureTooltip(el);
        };
        el.addEventListener('click', blockEvent, true);
        // ★ <select>はclickだけでなくchangeでも操作されてしまうため、両方止める
        if (el.tagName === 'SELECT') {
            el.addEventListener('change', blockEvent, true);
            el.addEventListener('mousedown', blockEvent, true);
        }
    });
})();

// HTMLの onclick から呼べるように登録
window.exportArchiveToMIDI = exportArchiveToMIDI;