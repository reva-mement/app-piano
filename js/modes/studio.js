import { isNoteInView, highlightGuideKey, showModal, THEORY } from '../utils.js';
import { forceStopAll } from '../main.js';
import { updatePlayButtonUI, updateStudioSongDisplay, formatTime, updateGuideButtonUI } from './studio/player-ui.js';
import { getInternalTime, setInternalStartTime, setInternalPausedTime, resetPausedTimeOffset } from './studio/timer.js';
import { StudioGameEngine } from './studio/game-engine.js';
import { formatNoteName } from '../instruments/piano/core.js';
import { addRecordingToArchive } from '../playnote-db.js';
import { playnoteDB } from '../playnote-db.js';
import { setOriginalSongData } from './studio/studio-scoring-ui.js';


// --- 状態管理 ---
let midiPlayer = null;
let isMidiLoaded = false;
let pendingGuideNotes = new Set();
let recordedEvents = [];
let startTime = 0;
let isRecording = false;
let lastLoadedFileName = "";
let isStudioRecording = false;
let studioEvents = [];
let studioStartTime = 0;
let blockResults = [];
let dbPlaybackTimers = []; // ★ scoringDB再生（score-studio-btn）でスケジュールしたタイマーのID一覧
let dbNoteSchedule = [];   // ★ { noteName, velocity, onTime, offTime } の一覧（一時停止・再開で再利用）
let dbPlaybackEpoch = 0;        // ★ 現在の再生区間が「経過0ms」だった実時刻（performance.now()基準）
let dbPlaybackElapsedAtPause = 0; // ★ 一時停止した時点での再生経過時間(ms)

// --- モード初期化 ---
export async function initStudioMode(loadedMidiDataGetter) {
    if (midiPlayer || window.midiPlayerInstance) return;
    try {
        const Lib = await import('../../midiplayer.js');
        const DefaultExport = Lib.default;
        const PlayerConstructor = DefaultExport?.Player || DefaultExport || Lib.Player;
        if (PlayerConstructor) {
            midiPlayer = new PlayerConstructor((event) => {
                handleMidiEvent(event);
            });
            midiPlayer.on('endOfFile', () => { 
                handleStopMIDI(); 
            });

            setupStudioUI(loadedMidiDataGetter);
            window.midiPlayerInstance = midiPlayer;
            window.forceStopStudioMIDI = handleStopMIDI;

            // ============================================================
            // 🎹 Studio モード：ガイド音（MIDI noteOn）イベント
            // ※ ここでは絶対に handleKeyPress を呼ばない
            // ※ resolveGuideNote も呼ばない（誤判定の原因）
            // ============================================================
            window.addEventListener('studio-note-played', (e) => {
                const normalized = formatNoteName(e.detail.note);

                // ★ Studio 録音（ユーザー演奏ではなくガイド音も記録する仕様なら残す）
                if (isStudioRecording) {
                    studioEvents.push({
                        type: "noteOn",
                        note: normalized,
                        time: performance.now() - studioStartTime
                    });
                }
            });

            console.log("🎹 Studio Mode: Initialized (Guide Only).");
        }
    } catch (e) {
        console.error("❌ Studio Setup Error:", e.message);
    }
}

/* ============================================================
   🎹 Studio モード：ユーザー入力専用のキー処理
   （ガイド音とは完全に分離）
============================================================ */

window.handleUserKeyPress = function(noteName) {
    if (!window.isGuideMode) return;
    if (!window.gameEngine || !window.gameEngine.isRunning) return;

    // ★ ユーザー入力だけ StudioGameEngine の判定ルートへ
    if (typeof window.gameEngine.handleKeyPress === 'function') {
        window.gameEngine.handleKeyPress(noteName);
    }
};

function handleMidiEvent(event) {
    const eventName = event.name || event.messageType; 
    let noteName = event.noteName;
    if (!noteName) return;

    // 1. 音名の変換
    const flatToSharp = { 'db': 'cs', 'eb': 'ds', 'gb': 'fs', 'ab': 'gs', 'bb': 'as' };
    let convertedNote = noteName.toLowerCase().replace('#', 's');
    for (let flat in flatToSharp) {
        if (convertedNote.startsWith(flat)) {
            convertedNote = convertedNote.replace(flat, flatToSharp[flat]);
            break;
        }
    }
    const formattedNote = convertedNote.charAt(0).toUpperCase() + convertedNote.slice(1);

    // ★ NoteOn 時の処理（削除 → 生成）
    if ((eventName === 'Note on' || eventName === 'NoteOn') && event.velocity > 0) {

        // 1. 既存ブロックの削除
        if (window.gameEngine && typeof window.gameEngine.removeBlock === 'function') {
            window.gameEngine.removeBlock(formattedNote);
        }

        // 2. ガイドモード中なら新しいブロックを生成（★範囲チェック追加）
        if (window.isGuideMode && window.gameEngine && window.gameEngine.isRunning) {

            // ★★★ ここだけが修正ポイント ★★★
            const inView = isNoteInView(formattedNote);
            console.log(`[Studio Debug] note=${formattedNote} isGuideMode=${window.isGuideMode} engineRunning=${window.gameEngine.isRunning} isNoteInView=${inView}`);

            if (inView) {
                window.gameEngine.addFallingBlock(formattedNote);
            }
        } else {
            console.log(`[Studio Debug] block skipped: note=${formattedNote} isGuideMode=${window.isGuideMode} gameEngine=${!!window.gameEngine} isRunning=${window.gameEngine ? window.gameEngine.isRunning : 'N/A'}`);
        }

        // 3. Studio 録音
        if (isStudioRecording) {
            studioEvents.push({
                type: "guide",
                note: formattedNote,
                time: performance.now() - studioStartTime
            });
        }
    }

    // ここから下は元のロジックそのまま
    if (document.body.classList.contains('performance-mode')) return;
    
    const guideActive = !!window.isGuideMode; 
    const inView = isNoteInView(formattedNote);

    if ((eventName === 'Note on' || eventName === 'NoteOn') && event.velocity > 0) {
        if (guideActive && inView) {
            if (typeof setInternalPausedTime === 'function') setInternalPausedTime(); 
            pendingGuideNotes.clear(); 
            pendingGuideNotes.add(formattedNote);
            updatePlayButtonUI('paused');
        } else {
            if (window.playNote) window.playNote(formattedNote, 0.7, true); 
        }
    } else if (eventName === 'Note off' || eventName === 'NoteOff' || (event.velocity === 0)) {
        if (window.stopNote) window.stopNote(formattedNote, true);
    }
}


/* ============================================================
   🎹 Studio モード：スコア計算モジュール
   handlePlayProgress() より前に貼ってください
============================================================ */

const BASE_SCORE = 100;

const RANGE_MULTIPLIER = {
  "0.5": 1.0,
  "1.0": 1.2,
  "2.0": 1.5,
  "4.0": 2.0
};

// d(px) の誤差から精度ペナルティを算出
function calcAccuracyPenalty(d) {
  const penalty = 1 - Math.pow(d / 45, 2);
  return Math.max(0, penalty);
}

// 1ブロックのスコア
function calcBlockScore(d, rangeWidth) {
  const accuracy = calcAccuracyPenalty(d);
  const rangeMul = RANGE_MULTIPLIER[String(rangeWidth)] ?? 1.0;
  return BASE_SCORE * accuracy * rangeMul;
}

// Studio モード全体のスコア集計
function calcTotalScore(blockResults, rangeWidth) {
  let total = 0;
  const history = [];

  blockResults.forEach(block => {
    const { d, octave, accuracyPercent, seq } = block;

    const score = calcBlockScore(d, rangeWidth);
    total += score;

    history.push({
      octave,
      accuracy: accuracyPercent,
      seq
    });
  });

  return {
    totalScore: Math.round(total),
    maxScore: Math.max(...blockResults.map(b => calcBlockScore(b.d, rangeWidth))),
    history
  };
}

window.calcTotalScore = calcTotalScore;

// ============================================================
// Studio モード：スコア集計 → コンソール出力
// ============================================================
window.outputStudioScoreToConsole = function () {
    const rangeWidth = window.currentRangeWidth || 1.0; // UI で選んだ幅（なければ1.0）
    const blockResults = window.blockResults || [];

    if (blockResults.length === 0) {
        console.log("No blocks hit.");
        return;
    }

    const result = calcTotalScore(blockResults, rangeWidth);

    console.log("===== Studio Mode Score =====");
    console.log("Total Blocks Spawned:", window.totalSpawnedBlocks || 0);
    console.log("Hit Count:", blockResults.length);
    console.log("Max Block Score:", result.maxScore);
    console.log("Total Score:", result.totalScore);
    console.log("History:", result.history);
    console.log("=============================");
}

// Studio モード用：再生ボタン処理（カウントダウン → 曲再生）
window.handlePlayProgress = async function(btn, loadedMidiData) {
    console.log("▶️ handlePlayProgress called!", loadedMidiData);

    // ★ ここが「notes 再生モード」
    if (Array.isArray(loadedMidiData)) {
        // ★★★ 二重再生防止 ★★★
        // 「実際にプレイ中（isRunning）」の場合のみブロックする。
        // window.gameEngine は一度生成されると ESC→はい(stop) を経由しない限り
        // null に戻らないため、単に「存在するか」で判定すると、過去に1回でも
        // プレイした後は二度と再生できなくなってしまう（実際に発生した不具合）。
        if (window.gameEngine && window.gameEngine.isRunning) {
            console.warn("[Studio] 既にプレイ中のため、今回のクリックは無視します。");
            return;
        }

        console.log("Studio mode: playing notes from DB");
        window.isStudioMode = true;

        // ★ ブロック判定(isNoteInView)の基準となる key-assigned 範囲を同期
        if (typeof window.updateIndividualMapping === 'function') {
            window.updateIndividualMapping();
        }

        // Canvas 準備
        let container = document.getElementById('sg-canvas-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'sg-canvas-container';
            document.body.appendChild(container);
        }

container.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    z-index: 1 !important;
    pointer-events: none !important;
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
    background-color: rgba(0, 0, 0, 0.8) !important;
    isolation: isolate !important;
`;


        if (!window.gameEngine) {
            window.gameEngine = new StudioGameEngine(container);
        }

        // ★ このプレイで使うエンジンの参照を確保しておく
        //   （カウントダウン中にESC→はいで停止された場合、window.gameEngine は
        //    null に置き換えられるため、後で「自分が待っていたエンジンのままか」を
        //    判定できるようにする）
        const engine = window.gameEngine;

        // ★ カウントダウン
        await engine.start();

        // ★★★ 重要 ★★★
        // カウントダウン中に ESC→はい（中断・停止）が選ばれていた場合、
        // window.gameEngine は stop() 処理で null に置き換えられている。
        // この場合は「中断したのにカウントダウン後に曲が始まってしまう」
        // 不具合を防ぐため、ここで再生をスケジュールせず終了する。
        // （ESC→いいえ で再開した場合は window.gameEngine は変わらないため、
        //  通常通り処理を継続する）
        if (window.gameEngine !== engine) {
            console.log("[Studio] カウントダウン中に中断されたため、再生をスケジュールしません。");
            return;
        }

        // ★★★ 重要 ★★★
        // 過去のテンポ計算バグで保存された古い notes データは、
        // 最初の音の time が（本来0msのはずなのに）十数〜数十秒先に
        // ズレている場合がある。MIDIの再読み込みをしなくても今すぐ
        // 動くよう、先頭の音が time=0 になるよう全体をシフトする。
        const minTime = loadedMidiData.length > 0
            ? Math.min(...loadedMidiData.map(ev => ev.time || 0))
            : 0;
        if (minTime > 0) {
            console.warn(`[Studio] notesの先頭オフセットを補正します（${minTime}ms → 0ms）。MIDIを再読み込みすると本来は解消されます。`);
        }

        // ★★★ 重要 ★★★
        // scoringDB の notes は extractNotesFromMidi() が生成したもので、
        // { pitch(数値), velocity, time, duration } という形であり、
        // { note(音名文字列), type } の形ではない。
        // そのため pitch(数値) を THEORY.midiToNote() で音名文字列に変換しておく。
        //
        // ★★★ 重要（鍵盤発光の仕様統一） ★★★
        // handleMidiEvent（メイン画面のGAME ONフロー）と同様に、
        // 「表示範囲内＝ユーザーが弾く対象の音」は自動再生しない。
        // ブロックだけを生成し、実際の音・鍵盤の発光（from-user）・
        // スコア判定はユーザー自身の打鍵（handleUserKeyPress）に委ねる。
        // 表示範囲外（伴奏側）の音だけ自動再生する。
        //
        // ★★★ 重要（一時停止・再開対応） ★★★
        // 以前は各ノートを setTimeout(fn, time) で一回ずつスケジュールしていたが、
        // これは ESC で「見た目（ブロック）」だけが止まり、裏で setTimeout が
        // そのまま動き続けて音だけ先に進んでしまう（再開時に曲が飛ぶ）原因になっていた。
        // dbNoteSchedule に「いつ・何を」の予定を保持しておき、一時停止時には
        // 経過時間を記録してタイマーを全破棄、再開時にはそこから残りだけを
        // 再スケジュールする（scheduleDbPlayback参照）。
        dbNoteSchedule = loadedMidiData.map((ev) => {
            const noteName = ev.note || (typeof ev.pitch === 'number' ? THEORY.midiToNote(ev.pitch) : null);
            const rawVel = ev.velocity ?? 80;
            const velocity = rawVel > 1 ? rawVel / 100 : rawVel;
            const onTime = (ev.time || 0) - minTime;
            const offTime = onTime + (ev.duration && ev.duration > 0 ? ev.duration : 300);
            return { noteName, velocity, onTime, offTime };
        }).filter(n => !!n.noteName);

        dbPlaybackElapsedAtPause = 0;
        scheduleDbPlayback(0);

        // ★ DEBUG: コールバック発火を待たずに、即座に分かる範囲チェックの要約
        const uniqueNotes = [...new Set(dbNoteSchedule.map(n => n.noteName))];
        const inViewNotes = uniqueNotes.filter(n => isNoteInView(n));
        console.log(`[Studio DB Debug] 総note数=${loadedMidiData.length} ユニーク音数=${uniqueNotes.length} うち現在表示範囲内=${inViewNotes.length}`, { uniqueNotes, inViewNotes });

        return;
    }
    console.log("▶️ handlePlayProgress called!");

    if (!midiPlayer && window.midiPlayerInstance) {
        midiPlayer = window.midiPlayerInstance;
    }

    const currentFileName = window.currentMidiFileName || "";
    // ★★★ 重要 ★★★
    // window.isGuideMode はscoringDB再生フロー（score-studio-btn）でも
    // true にセットされるグローバル共有フラグで、その後 false に戻されない。
    // そのため、scoringDB経由で1回プレイした後にメイン画面でGAME ONボタンを
    // 押さずにPLAYしても、フラグが残っていてGAME ON状態として再生されてしまう
    // 不具合があった。ここでは「実際にGAME ONボタンが押されているか」を表す
    // window.studioGuideMode（ボタン自身のトグル状態）を正とする。
    const isGuideOn = window.studioGuideMode === 'guide'; // GAME ON のとき true
    window.isGuideMode = isGuideOn; // ★ 以降の判定（isNoteInView等）との整合性を保つ

    // --- 1. 再生中なら停止処理 ---
    if (midiPlayer.isPlaying && midiPlayer.isPlaying()) {
        midiPlayer.pause();
        setInternalStartTime();
        updatePlayButtonUI('paused');
        window.isPlaying = false;

        if (window.gameEngine) {
            window.gameEngine.pause();
        }

        const container = document.getElementById('sg-canvas-container');
        if (container) container.style.display = 'none';

        return;
    }

// --- 2. 再生開始処理 ---
if (!isMidiLoaded || currentFileName !== lastLoadedFileName) {
    if (loadedMidiData) {
        // ★ 通常のファイル読込フローなので、DBスコア上書きの対象をリセット
        window.activeScoringRecord = null;

        midiPlayer.stop();
        midiPlayer.loadArrayBuffer(loadedMidiData);

        // ★ scoringDB への保存は MIDI 読込時（main.js 側）で既に完了しているため、
        //   ここでは再度保存しない（再生のたびに重複確認ダイアログが出てしまう不具合の原因だった）
        isMidiLoaded = true;
        lastLoadedFileName = currentFileName;
    } else {
        if (isGuideOn) {
            showModal(`<div style="text-align:center;padding:10px;"><p>MIDIデータを読み込んでください。</p></div>`);
        }
        return;
    }
}


    // --- 3. Studio モード（GAME ON）の場合 ---
    if (isGuideOn) {
        window.isStudioMode = true; // Studio モードフラグ ON

        console.log("Guide Mode is ON, starting StudioGameEngine");

        // ★ ブロック判定(isNoteInView)の基準となる key-assigned 範囲を、
        //    プレイ開始直前に必ず最新の状態へ同期する
        if (typeof window.updateIndividualMapping === 'function') {
            window.updateIndividualMapping();
        }

        // Canvas 準備
        let container = document.getElementById('sg-canvas-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'sg-canvas-container';
            document.body.appendChild(container);
        }

        container.style.cssText = `
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            z-index: 1 !important;
            pointer-events: none !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            background-color: rgba(0, 0, 0, 0.8) !important;
            isolation: isolate !important;
        `;

        // エンジン生成
        if (!window.gameEngine) {
            window.gameEngine = new StudioGameEngine(container);
        }

        const engine = window.gameEngine;

        // ★ カウントダウン＋render を待つ（ここでは MIDI を再生しない）
        await engine.start();

        // ★ カウントダウン中に ESC→はい で中断されていた場合は再生しない
        if (window.gameEngine !== engine) {
            console.log("[Studio] カウントダウン中に中断されたため、再生を開始しません。");
            return;
        }

        // ★ カウントダウンが終わった瞬間に MIDI 再生
        setInternalStartTime();
        midiPlayer.play();

        updatePlayButtonUI('playing');
        window.isPlaying = true;
        return;
    }

    // --- 4. ガイド OFF（通常再生） ---
    setInternalStartTime();
    midiPlayer.play();
    updatePlayButtonUI('playing');
    window.isPlaying = true;
}


// ============================================================
// ★ scoringDB再生フロー（score-studio-btn）の一時停止・再開対応
// ------------------------------------------------------------
// 実MIDIプレイヤーを使わない setTimeout ベースの再生は、単に
// pause() してもバックグラウンドのタイマーは止まらない。
// そのため「経過時間」を自前で管理し、一時停止時は全タイマーを
// 破棄、再開時は残りのノートだけを経過時間基準で再スケジュールする。
// ============================================================
function scheduleDbPlayback(elapsedMs) {
    dbPlaybackTimers.forEach(id => clearTimeout(id));
    dbPlaybackTimers = [];

    dbPlaybackEpoch = performance.now() - elapsedMs;

    dbNoteSchedule.forEach((note) => {
        // ★ ノートオン：すでに経過済みならスキップ（巻き戻し再生はしない）
        if (note.onTime >= elapsedMs) {
            const onTimerId = setTimeout(() => {
                if (!window.gameEngine || !window.gameEngine.isRunning) return;

                const isPlayableGuideNote = window.isGuideMode && isNoteInView(note.noteName);
                if (isPlayableGuideNote) {
                    // ★ ゲーム対象の音：ブロックだけ生成。音・発光はユーザーの打鍵に委ねる
                    window.gameEngine.addFallingBlock(note.noteName);
                } else {
                    // ★ 表示範囲外（伴奏）の音は自動再生する
                    window.playNote(note.noteName, note.velocity, true);
                }
            }, note.onTime - elapsedMs);
            dbPlaybackTimers.push(onTimerId);
        }

        // ★ ノートオフ：自動再生した伴奏音のみ対象
        if (note.offTime >= elapsedMs) {
            const offTimerId = setTimeout(() => {
                const isPlayableGuideNote = window.isGuideMode && isNoteInView(note.noteName);
                if (!isPlayableGuideNote) {
                    window.stopNote(note.noteName);
                }
            }, note.offTime - elapsedMs);
            dbPlaybackTimers.push(offTimerId);
        }
    });
}

function pauseDbPlayback() {
    if (dbNoteSchedule.length === 0) return;
    dbPlaybackElapsedAtPause = performance.now() - dbPlaybackEpoch;
    dbPlaybackTimers.forEach(id => clearTimeout(id));
    dbPlaybackTimers = [];
}

function resumeDbPlayback() {
    if (dbNoteSchedule.length === 0) return;
    scheduleDbPlayback(dbPlaybackElapsedAtPause);
}

export function handleStopMIDI() {
    if (midiPlayer) {
        midiPlayer.stop();

        // ★★★ 重要 ★★★
        // Player.stop() は startTick/startTime とトラックの読み取り位置
        // (eventIndex)はリセットするが、Player自身が保持する「現在tick」
        // (this.tick)はリセットしていない（ライブラリ側の抜け）。
        // この値が古い（曲の途中の大きな値の）まま残ると、次回再生時の
        // 内部計算の基準がズレ、「滞っていた分を5msごとに1音ずつ
        // 一気に吐き出す」＝早送りのように聞こえる不具合の原因になる。
        midiPlayer.tick = 0;
    }
    pendingGuideNotes.clear();
    window.isPlaying = false; 
    updatePlayButtonUI('stop'); 
    resetPausedTimeOffset(); 
    isRecording = false;
    document.querySelectorAll('.key.active').forEach(k => k.classList.remove('active'));

    // ★ scoringDB再生フローの状態も完全にリセットする
    dbPlaybackTimers.forEach(id => clearTimeout(id));
    dbPlaybackTimers = [];
    dbNoteSchedule = [];
    dbPlaybackElapsedAtPause = 0;

    // ★ scoringDB経由のプレイ後でも（isMidiLoadedがfalseのままでも）
    //   必ず時間表示を 0 にリセットする
    if (typeof window.resetStudioTimeDisplay === 'function') {
        window.resetStudioTimeDisplay();
    }
}

// --- UIセットアップ ---
function setupStudioUI(loadedMidiDataGetter) {
    const getEl = (sel) => document.querySelector(`#tag-studio ${sel}`);
    const seekSlider = document.getElementById('studio-seek-slider');
    const timeDisplay = document.getElementById('studio-time-display');
    const playBtn = getEl('.play-stamp');
    const stopBtn = getEl('.stop-stamp');
　　const guideBtn = document.getElementById('studio-guide-btn');

    const recBtn = document.getElementById('studio-rec-btn'); // ← getEl ではなく ID で取得

    if (window.studioGuideMode === undefined) {
    window.studioGuideMode = null;
　　}

    if (!seekSlider) return;
    let isDragging = false;

    const updateUI = (manualSec = null) => {
        // ★★★ 重要 ★★★
        // manualSec===0（明示的なリセット指示）の場合は、
        // isMidiLoaded（通常のMIDI読込フローでしか true にならない）に
        // 関係なく必ず表示を 0 にする。
        // これが無いと、scoringDB経由（score-studio-btn）でのプレイ後に
        // STOPボタンを押しても isMidiLoaded が false のままのため、
        // ここで即リターンしてしまい時間表示が 00:00 に戻らなかった。
        if (manualSec === 0) {
            if (timeDisplay) {
                const total = (midiPlayer && midiPlayer.getSongTime) ? (() => {
                    let t = midiPlayer.getSongTime();
                    return t > 10000 ? t / 1000 : t;
                })() : 0;
                timeDisplay.textContent = `${formatTime(0)} / ${formatTime(total)}`;
            }
            if (!isDragging) seekSlider.value = 0;
            return;
        }

        if (!midiPlayer || !isMidiLoaded) return;
        // ★ getSongTime()はテンポチェンジが多い曲で再生中に値が変動するため使わない。
        //   extractNotesFromMidi()で正確に計算した値（ms）をsecに変換して使う。
        let total = window.currentSongDurationMs ? window.currentSongDurationMs / 1000 : 0;
        if (total <= 0) {
            // フォールバック：古い曲や直接DBから再生する場合
            total = midiPlayer.getSongTime ? midiPlayer.getSongTime() : 0;
            if (total > 10000) total /= 1000;
        }
        if (total <= 0) return;

        let current = (manualSec !== null) ? manualSec : getInternalTime();
        if (current > total) {
            current = total;
            if (window.isPlaying) handleStopMIDI();
        }

        if (timeDisplay) {
            timeDisplay.textContent = `${formatTime(current)} / ${formatTime(total)}`;
        }

        if (!isDragging) {
            const progress = (current / total) * 100;
            seekSlider.value = isNaN(progress) ? 0 : progress;
        }
    };

    // ★ handleStopMIDI（module scope）や ESC→はい ハンドラからも
    //   同じリセット処理を呼べるようにグローバル公開
    window.resetStudioTimeDisplay = () => updateUI(0);

    // --- ガイドボタン ---
    if (guideBtn) {
        updateGuideButtonUI(window.studioGuideMode || null);
guideBtn.onclick = (e) => {
    e.stopPropagation();

    if (!window.studioGuideMode) {
        window.studioGuideMode = 'guide';
        window.isGuideMode = true;
        guideBtn.textContent = "GAME ON";
    } else {
        window.studioGuideMode = null;
        window.isGuideMode = false;
        guideBtn.textContent = "GAME OFF";
    }

    updateGuideButtonUI(window.studioGuideMode);
    pendingGuideNotes.clear();
};

    }

    // --- PLAY ---
    if (playBtn) {
        playBtn.onclick = (e) => {
            e.stopPropagation();
            handlePlayProgress(playBtn, loadedMidiDataGetter());
        };
    }

    // --- STOP ---
    if (stopBtn) {
        stopBtn.onclick = (e) => {
            e.stopPropagation();
            handleStopMIDI();
            updateUI(0);
        };
    }

// --- ★ REC ボタン（録音開始 / 停止） ---
if (recBtn) {
    recBtn.onclick = (e) => {
        e.stopPropagation();

        // --- 録音開始 ---
        if (!isStudioRecording) {
            isStudioRecording = true;
            studioEvents = [];
            studioStartTime = performance.now();

            recBtn.classList.add('active');
            recBtn.textContent = "● REC";

            console.log("🎙 Studio Recording Started");
        }

        // --- 録音停止 ---
        else {
            isStudioRecording = false;

            recBtn.classList.remove('active');
            recBtn.textContent = "● REC";

            // ★ Studio モード専用の命名規則：Studio_YYYYMMDD_HHMM
            const now = new Date();
            const y  = now.getFullYear();
            const m  = String(now.getMonth() + 1).padStart(2, '0');
            const d  = String(now.getDate()).padStart(2, '0');
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');

            const title = `Studio_${y}${m}${d}_${hh}${mm}`;

            addRecordingToArchive(title, "Studio", studioEvents);

            console.log("💾 Studio Recording Saved:", studioEvents.length, "events");
        }
    };
}


    // --- シーク機能 ---
    seekSlider.onmousedown = () => { isDragging = true; };
    seekSlider.ontouchstart = () => { isDragging = true; };

    seekSlider.oninput = (e) => {
        if (!midiPlayer || !isMidiLoaded) return;
        isDragging = true;
        pendingGuideNotes.clear();

        let total = midiPlayer.getSongTime() || 0;
        if (total > 10000) total /= 1000;

        const totalTicks = midiPlayer.totalTicks || (midiPlayer.getTotalTicks ? midiPlayer.getTotalTicks() : 0);
        const ratio = parseFloat(seekSlider.value) / 100;
        const targetSec = ratio * total;
        const targetTick = ratio * totalTicks;

        setInternalStartTime(targetSec);
        updateUI(targetSec);

        if (midiPlayer.jumpToTick) {
            midiPlayer.jumpToTick(targetTick);
        }

        midiPlayer.startTick = targetTick;
        midiPlayer.tick = targetTick;

        if (window.isPlaying) {
            midiPlayer.startTime = new Date().getTime();
        }
    };

    const handleEnd = () => {
        if (isDragging && window.isPlaying && midiPlayer) {
            if (typeof midiPlayer.isPlaying === 'function' && !midiPlayer.isPlaying()) {
                midiPlayer.play();
            }
        }
        isDragging = false;
        seekSlider.blur();
    };

    seekSlider.onmouseup = handleEnd;
    seekSlider.ontouchend = handleEnd;

    // ★ 既存のsyncLoopを停止させるフラグ
    if (window._studioSyncLoopStop) window._studioSyncLoopStop();
    let syncActive = true;
    window._studioSyncLoopStop = () => { syncActive = false; };

    const syncLoop = () => {
        if (!syncActive) return;
        if (!isDragging) updateUI();
        requestAnimationFrame(syncLoop);
    };
    requestAnimationFrame(syncLoop);



window.visualizeKey = (noteName, velocity, isActive) => {
    // 該当するすべての .key を取得
    const keys = document.querySelectorAll(`.key[data-note="${noteName}"]`);
    
    // 見つかったすべての鍵盤に対して操作を行う
    keys.forEach(keyEl => {
        if (isActive) {
            keyEl.classList.add('guide-active');
        } else {
            keyEl.classList.remove('guide-active');
        }
    });
};

window.resolveGuideNote = function(noteName) {
    // ★ Studio モードでは自動再生ロジックを無効化
    if (window.isStudioMode) {
        // ブロック消去だけはやりたいなら、ここで removeBlock だけ呼んでもOK
        if (window.gameEngine && window.gameEngine.removeBlock) {
            window.gameEngine.removeBlock(noteName);
        }
        return;
    }

    // 1. エンジンに消去命令を出す（Session 用）
    if (window.gameEngine && window.gameEngine.removeBlock) {
        window.gameEngine.removeBlock(noteName);
    }

    // 2. 既存のガイド判定ロジック（Session 用）
    if (pendingGuideNotes.size > 0) {
        if (window.studioGuideMode === 'guide' && pendingGuideNotes.has(noteName)) {
            pendingGuideNotes.delete(noteName);
        }

        if (pendingGuideNotes.size === 0 && window.isGuideMode && midiPlayer) {
            if (typeof midiPlayer.isPlaying === 'function' && !midiPlayer.isPlaying()) {
                setInternalStartTime();
                midiPlayer.play();
                window.isPlaying = true;
                if (typeof updatePlayButtonUI === 'function') {
                    updatePlayButtonUI('playing');
                }
            }
        }
    }
};


export function forceResetStudioUI() {

    const recBtn = document.querySelector('#tag-studio .record-stamp');
    if (recBtn) {
        recBtn.textContent = "● REC";
        recBtn.classList.remove('active');
        recBtn.removeAttribute('data-recording');
    }

    handleStopMIDI();
}

window.forceResetStudioUI = forceResetStudioUI;

window.updateStudioSongDisplay = updateStudioSongDisplay;

/**
 * 新しいMIDIファイルを読み込んだ際に、前の曲の残留データをリセットする。
 * main.js の setupMidiLoader から呼ばれる。
 */
export function resetStudioMidiState() {
    isMidiLoaded = false;
    lastLoadedFileName = "";
    dbNoteSchedule = [];
    blockResults = [];
    dbPlaybackTimers.forEach(id => clearTimeout(id));
    dbPlaybackTimers = [];
    dbPlaybackElapsedAtPause = 0;
    window.currentSongDurationMs = 0; // ★ 前の曲の長さをリセット
    resetPausedTimeOffset(); // ★ 前の曲の再生位置オフセットをリセット
    if (typeof window.resetStudioTimeDisplay === 'function') {
        window.resetStudioTimeDisplay(); // ★ 時間表示も 00:00 にリセット
    }
    console.log("🔄 Studio: 前の曲の残留データをリセットしました");
}
window.resetStudioMidiState = resetStudioMidiState;

export function resetSessionRecordingUI() {
    const recBtn = document.getElementById('session-rec-btn');
    if (recBtn) {
        recBtn.innerText = "● REC";
        recBtn.classList.remove('active');
    }
}

// --- 外部から時間を更新させるための関数 ---
window.refreshStudioTimeDisplay = function() {
    const timeDisplay = document.getElementById('studio-time-display');
    if (!midiPlayer || !timeDisplay) return;

    // midiplayer.js から曲の長さを取得（秒単位）
    let total = midiPlayer.getSongTime ? midiPlayer.getSongTime() : 0;
    
    // ライブラリによってミリ秒で返ってくる場合があるための調整
    if (total > 10000) total /= 1000;

    if (total > 0) {
        // 0秒 / 総秒数 という形式で表示
        timeDisplay.textContent = `0:00 / ${formatTime(total)}`;
    }
};

function createFallingBlock(noteNumber) {
    const layer = document.getElementById('sg-canvas-container');
    const block = document.createElement('div');
    block.className = 'falling-block';
    
    // 音階(noteNumber)に基づいて横位置を決定
    // 例えば、最低音から最高音までを画面幅にマッピング
    const leftPos = ((noteNumber - 21) / 88) * 100; 
    block.style.left = leftPos + '%';
    
    layer.appendChild(block);
    
    // アニメーション終了後に要素を削除
    block.addEventListener('animationend', () => {
        block.remove();
    });
}

window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    console.log("ESC pressed: Confirm interrupt...");

    // すでに確認ダイアログが出ていたら多重生成しない
    if (document.getElementById("studio-confirm-box")) return;

    // ★★★ 重要 ★★★
    // 以前は window.isStudioMode が true である「間」は常にESCで
    // 中断ダイアログが出てしまっていた（再生中でなくても発火）。
    // Studio画面・scoringDB画面どちらの再生フローでも、再生開始時に
    // window.gameEngine が生成され、停止（はい）で必ず null に戻る。
    // これを「実際に再生中（カウントダウン中・一時停止中も含む）」の
    // 判定として使い、再生していない時はESCで何もしないようにする。
    const isStudioSessionActive = window.isStudioMode === true && !!window.gameEngine;

    if (!isStudioSessionActive) {
        return;
    }

    // ① ESC 押下時：中断（Ⅱ）として一時停止する

    // 曲を一時停止
    if (window.midiPlayerInstance && typeof window.midiPlayerInstance.pause === 'function') {
        window.midiPlayerInstance.pause();
        if (typeof window.midiPlayerInstance.isPlaying === 'function') {
            console.log("[Studio Debug] pause() 実行後の isPlaying():", window.midiPlayerInstance.isPlaying());
        }
    }

    // ★ scoringDB再生フロー（setTimeoutベース）の一時停止
    //   （これが無いと、見た目だけ止まって裏で曲が進み続けてしまう）
    pauseDbPlayback();

    // ブロックを一時停止（ループ停止＋ガイド解除）
    if (window.gameEngine && typeof window.gameEngine.pause === 'function') {
        window.gameEngine.pause();
    }

    // 簡易コンファーム UI を生成
    const confirmBox = document.createElement('div');
    confirmBox.id = "studio-confirm-box";
    confirmBox.style.cssText = `
        position: fixed;
        top: 40%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #222;
        color: #fff;
        padding: 20px 30px;
        border-radius: 8px;
        z-index: 99999;
        text-align: center;
        font-size: 16px;
    `;
    confirmBox.innerHTML = `
        <p style="margin-bottom: 15px;">本当に中断しますか？</p>
        <button id="studio-confirm-yes" style="margin-right: 10px; padding: 6px 16px;">はい</button>
        <button id="studio-confirm-no" style="padding: 6px 16px;">いいえ</button>
    `;
    document.body.appendChild(confirmBox);

    // ② 「はい」＝ 停止（■）と完全に同じ挙動にする
    document.getElementById("studio-confirm-yes").onclick = async () => {
        console.log("[Studio] ESC → YES (stop)");

        // ★ カウントダウン中に凍結していた場合、完全中止させて
        //   待機ループを正しく抜けさせる
        if (window.gameEngine && typeof window.gameEngine.cancelCountdown === 'function') {
            window.gameEngine.cancelCountdown();
        }

        // ★★★ 重要 ★★★
        // 以前はここで MIDI 停止処理を個別に再実装していたが、
        // resetPausedTimeOffset() の呼び忘れにより時間表示が
        // 00:00 に戻らない不具合があった。
        // STOPボタン（■）と完全に同じ結果になるよう、
        // 同じ handleStopMIDI() を呼ぶように統一する。
        handleStopMIDI();

        // ★ scoringDB再生フローの残タイマーを破棄（生き残って後から鳴る/動くのを防ぐ）
        dbPlaybackTimers.forEach(id => clearTimeout(id));
        dbPlaybackTimers = [];

        // ★★★ スコア集計と保存 ★★★
        const rangeWidth = window.currentRangeWidth || 1.0;
        const blockResults = window.blockResults || [];

        if (blockResults.length > 0) {
            const result = calcTotalScore(blockResults, rangeWidth);

            if (window.activeScoringRecord) {
                // ★ scoringDB の「▶GAME ON」から始めたプレイ → 同じ曲レコードに上書き保存
                const prev = window.activeScoringRecord;
                await playnoteDB.updateStudioScore({
                    ...prev,
                    latestDate: Date.now(),
                    totalScore: result.totalScore,
                    maxScore: Math.max(prev.maxScore || 0, result.maxScore),
                    history: result.history
                });
                console.log("Studio score updated (existing record):", result);
            } else {
                // ★ 通常の MIDI 新規読込からのプレイ → 新規レコードとして保存
                await playnoteDB.saveStudioScore({
                    title: window.loadedMidiTitle || "Studio_" + Date.now(),
                    latestDate: Date.now(),
                    totalScore: result.totalScore,
                    maxScore: result.maxScore,
                    history: result.history
                });
                console.log("Studio score saved (new record):", result);
            }
        } else {
            console.log("No blocks hit → score not saved");
        }

        // ★ 採点対象の参照をクリア（次回の通常プレイに引き継がないようにする）
        window.activeScoringRecord = null;

        // エンジン完全停止（内部 stop はスコア計算＋リセット）
        if (window.gameEngine && typeof window.gameEngine.stop === 'function') {
            await window.gameEngine.stop();
        }

        // Canvas 非表示
        const container = document.getElementById('sg-canvas-container');
        if (container) container.style.display = 'none';

        // フラグ類リセット
        window.isPlaying = false;
        window.isStudioMode = false;
        window.gameEngine = null;

        // スコア一覧更新
        if (typeof renderStudioScoreList === 'function') {
            await renderStudioScoreList();
        }

        confirmBox.remove();
    };

    // ③ 「いいえ」＝ 中断キャンセル → 再開（▶）
    document.getElementById("studio-confirm-no").onclick = () => {
        console.log("[Studio] ESC → NO (resume)");

        const stillCountingDown = window.gameEngine && !window.gameEngine.wasRunningWhenPaused;

        if (stillCountingDown) {
            // ★★★ 重要 ★★★
            // ESCを押した時点でまだカウントダウン中だった場合は、
            // ここで曲やブロックを始めてしまわず、凍結を解除するだけにする。
            // カウントダウンの続き → 本編開始は、待機中だった
            // engine.start()（showCountdown）が自然に再開して行う。
            // これが無いと「カウントダウンが省略されていきなり曲が
            // 始まる」不具合になる。
            window.gameEngine.resumeAfterPause();
            confirmBox.remove();
            return;
        }

        // ★ ここからは「カウントダウンは既に終わっていて、本編再生中だった」場合
        if (window.gameEngine && typeof window.gameEngine.resumeAfterPause === 'function') {
            window.gameEngine.resumeAfterPause();
        }

        if (dbNoteSchedule.length > 0) {
            // ★ scoringDB再生フロー：経過時間ベースで残りのノートを再スケジュール
            resumeDbPlayback();
        } else if (window.midiPlayerInstance && typeof window.midiPlayerInstance.play === 'function') {
            // ★★★ 重要 ★★★
            // Player.play() は「既に再生中(isPlaying()===true)」だと
            // 例外を投げる実装になっている。何らかの理由で pause() が
            // 効かず実際には再生が止まっていなかった場合、ここで例外が
            // 発生し、以降の処理（ブロック再開・ダイアログを閉じる）が
            // 全く実行されなくなってしまっていた（実際に発生した不具合）。
            // 既に再生中ならそのまま、止まっていれば再生する、で必ず
            // 後続処理が実行されるようにする。
            const alreadyPlaying = typeof window.midiPlayerInstance.isPlaying === 'function'
                && window.midiPlayerInstance.isPlaying();

            if (alreadyPlaying) {
                console.warn("[Studio] 再開しようとしたが、既に再生中でした（pause()が効いていない可能性）。");
            } else {
                try {
                    window.midiPlayerInstance.play();
                } catch (err) {
                    console.error("[Studio] 曲の再開に失敗しました:", err);
                }
            }
        }

        // ブロック再開
        // pause() は isRunning=false + animationFrame cancel なので、
        // 再開には isRunning を true にして render() を再度呼ぶ必要がある
        if (window.gameEngine && typeof window.gameEngine.render === 'function') {
            window.gameEngine.isRunning = true;
            window.gameEngine.render();
        }

        window.isPlaying = true;
        if (typeof updatePlayButtonUI === 'function') updatePlayButtonUI('playing');

        confirmBox.remove();
    };
});

window.startStudioGameFromScore = async function(rec) {
    console.log("▶ startStudioGameFromScore", rec);

    // Studio モード ON
    window.isGuideMode = true;
    window.isStudioMode = true;

    // ★ rec.notes を handlePlayProgress に渡す
    await handlePlayProgress(null, rec.notes);
};

window.resetSessionRecordingUI = resetSessionRecordingUI;