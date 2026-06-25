/* ==========================================
   PianoWorks: Main Controller
   ========================================== */
import { initPiano } from './instruments/piano.js';
import { updateMasterVolume } from './utils.js';
import { setupPerformSession } from './modes/perform.js';
import { initStudioMode } from './modes/studio.js';
import { playnoteDB, getAndExportMIDI, saveAndRefresh, deleteAndRefresh, refreshArchiveUI } from './playnote-db.js';
import { setupScoreBoard, renderStudioScoreList, saveImportedMidiToScoring } from "./modes/studio/studio-scoring-ui.js";

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

// 設定一時保持用（OKを押すまでここを書き換える）
let tempConfig = {
    focusRange: "3", // オクターブ幅（マスク）
    pendingBgDataUrl: null // 背景画像
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

        initBackground();
        await initStudioMode(() => loadedMidiData);
        setupPerformSession();
        initRangeDisplay();
        initThoughtEngine();

    } catch (e) {
        console.error("Initialization error:", e);
    }
});

/* --- 機能別モジュール --- */

function handleLoader() {
    const loader = document.getElementById('piano-loader-container');
    if (!loader) return;
    setTimeout(() => {
        loader.classList.add('loader-hidden');
        loader.style.opacity = '0';
        loader.style.pointerEvents = 'none';
        setTimeout(() => { loader.style.display = 'none'; }, 2000);
    }, 8000);
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
                        await saveImportedMidiToScoring({
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

    return songData;
};

// 4. モーダル管理（背景設定の紐付けもここで行う）
function setupModals() {
    const overlays = {
        settings: document.getElementById('settings-modal-overlay'),
    };

    document.addEventListener('click', (e) => {
        // 設定を開く
        if (e.target.closest('#settings-trigger')) {
            const currentChecked = document.querySelector('input[name="focus-range"]:checked');
            tempConfig.focusRange = currentChecked ? currentChecked.value : "3";
            tempConfig.pendingBgDataUrl = null; 
            overlays.settings.style.display = 'flex';
        }

        // ヘルプを開く（★ 中身は仮のトースト。内容は後で差し替えてください）
        if (e.target.closest('#help-trigger')) {
            if (typeof window.showToast === 'function') {
                window.showToast("ヘルプ機能は現在準備中です。");
            }
        }
        
        // ×ボタンで閉じる（破棄）
        if (e.target.closest('#settings-close-btn')) discardSettings();

        // 背景クリック
        if (Object.values(overlays).includes(e.target)) {
            if (e.target === overlays.settings) discardSettings();
        }
    });

    

    // 背景変更ボタンのセットアップ
    setupBackgroundSettings();
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
}

function setupBackgroundSettings() {
    const bgInput = document.getElementById('bg-upload-input');
    const bgUploadBtn = document.getElementById('bg-upload-btn');
    const bgResetBtn = document.getElementById('bg-reset-btn');

    if (bgUploadBtn && bgInput) {
        bgUploadBtn.onclick = () => bgInput.click();
        bgInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                tempConfig.pendingBgDataUrl = event.target.result; 
            };
            reader.readAsDataURL(file);
        };
    }

    if (bgResetBtn) {
        bgResetBtn.onclick = () => {
            tempConfig.pendingBgDataUrl = DEFAULT_BG_PATH;
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
    });
}

/**
 * キャンセル：一時的な変更（ラジオボタン・背景予約）を破棄
 */
function discardSettings() {
    const radioToRestore = document.querySelector(`input[name="focus-range"][value="${tempConfig.focusRange}"]`);
    if (radioToRestore) radioToRestore.checked = true;
    
    tempConfig.pendingBgDataUrl = null;
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

// HTMLの onclick から呼べるように登録
window.exportArchiveToMIDI = exportArchiveToMIDI;