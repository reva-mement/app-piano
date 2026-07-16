import { isNoteInView, highlightGuideKey, showModal, THEORY, isLocalApp, showLocalOnlyToast } from '../utils.js';
// forceStopAll は main.js からの循環依存を避けるため window 経由で呼ぶ
import { updatePlayButtonUI, updateStudioSongDisplay, formatTime, updateGuideButtonUI } from './studio/player-ui.js';
import { getInternalTime, setInternalStartTime, setInternalPausedTime, resetPausedTimeOffset } from './studio/timer.js';
import { StudioGameEngine } from './studio/game-engine.js';
import { formatNoteName } from '../instruments/piano/core.js';
import { addRecordingToArchive } from '../playnote-db.js';
import { playnoteDB } from '../playnote-db.js';
import { setOriginalSongData } from './studio/studio-scoring-ui.js';
import { setCharacterImage, setBubbleText, triggerSeasonalThought } from '../thought-engine.js';


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

// ★★★ 修正：以前は自動再生(ガイド)音だけを"noteOn"のみ(消音イベントなし)で記録しており、
//   ユーザー自身の実演奏が一切記録されず、再生すると音が鳴りっぱなしになる不完全な
//   仕様だった。ここからは core.js の playNote/stopNote（ユーザー・自動再生どちらも
//   必ず通る場所）を基準に、Session と同じ 'on'/'off' 形式で両方を正しく記録する。
window.isStudioRecording = false;
// ★★★ 修正：core.js の playNote/stopNote から呼ばれる window.recordStudioEvent は
//   以前から呼び出しコードだけ存在し、実装（定義）がどこにも無いダングリングフックだった。
//   ここで実装し、Session と同じ 'on'/'off' 形式で studioEvents に記録する。
//   引数は core.js 側の呼び出しに合わせ (type, note, velocityByte) の順。
//   type は 'noteOn' / 'noteOff'（core.js側の命名）を受け取り、'on'/'off' に変換する。
window.recordStudioEvent = function(type, note, velocityByte) {
    if (!window.isStudioRecording) return;
    const isOff = (type === 'noteOff');
    studioEvents.push({
        note,
        velocity: isOff ? 0 : (typeof velocityByte === 'number' ? velocityByte / 127 : 0.7),
        // ★★★ 修正：以前は performance.now() ベース（ミリ秒）のまま記録していたが、
        //   再生側（main.js の playArchiveWithUI）は Session の記録形式（秒）を前提に
        //   ev.time * 1000 でミリ秒に変換している。単位が合っておらず、実際には
        //   「500ms後」のつもりが「500,000ms(約8分)後」に再生される指定になり、
        //   ユーザーの打鍵が実質再生されないのと同じ状態になっていた。
        //   ここで秒単位に変換して揃える。
        time: (performance.now() - studioStartTime) / 1000,
        type: isOff ? 'off' : 'on'
    });
};
let blockResults = [];
let dbPlaybackTimers = []; // ★ scoringDB再生（score-studio-btn）でスケジュールしたタイマーのID一覧
let dbNoteSchedule = [];   // ★ { noteName, velocity, onTime, offTime } の一覧（一時停止・再開で再利用）
let dbPlaybackEpoch = 0;        // ★ 現在の再生区間が「経過0ms」だった実時刻（performance.now()基準）
let dbPlaybackElapsedAtPause = 0; // ★ 一時停止した時点での再生経過時間(ms)

// --- ★ ブロック先読みシステム用の状態 ---
// ブロックは本来「実線120px〜30pxの中央(75px)」で音のタイミングと一致すべきだが、
// 従来は音が鳴った"その瞬間"にy=-30から生成していたため、必ず遅れて見えていた。
// 曲全体のノートイベントを事前に把握しておき、「75pxラインに到達すべき時刻」から
// 逆算して、音が鳴るより前もってブロックを出すようにする。
let flatNoteEvents = [];          // tick順に並べた全Note onイベント
let lookaheadPointer = 0;         // flatNoteEvents の走査位置
let spawnedViaLookahead = new Set(); // 先読みで既に出した `${tick}_${noteName}` の記録
let lookaheadTimerId = null;

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
                // ★ Studio GAME中に曲が最後まで自然に終わった場合も、
                //   ESC→はい と同じ後始末（スコア保存・フェード復帰）を行う
                const isStudioSessionActive = window.isStudioMode === true && !!window.gameEngine;
                if (isStudioSessionActive) {
                    finishStudioGameSession();
                } else {
                    handleStopMIDI();
                }
            });

            // ★ テンポチェンジが多い曲（例：Satie）でも正確にtickを計算するためのパッチ
            // 標準の getCurrentTick は「最後に設定されたBPM」で全区間を計算するため、
            // テンポが変わると音が詰まったり一気に流れたりするバグが発生する。
            // ここで「テンポ変化を区間ごとに積算する」版に差し替える。
            const _origSetTempo = midiPlayer.setTempo.bind(midiPlayer);
            midiPlayer._tempoSegments = []; // [{bpm, startMs, startTick}]

            midiPlayer.setTempo = function(bpm) {
                _origSetTempo(bpm);
                // ★ ブロックの落下スピードをBPMに連動させる
                if (window.gameEngine && typeof window.gameEngine.setBpm === 'function') {
                    window.gameEngine.setBpm(bpm);
                }
                const nowMs = new Date().getTime();
                if (this.startTime && this._tempoSegments.length > 0) {
                    // 前の区間の終点tickを記録して新区間を開始
                    const prevSeg = this._tempoSegments[this._tempoSegments.length - 1];
                    const elapsedMs = nowMs - prevSeg.startMs;
                    const prevTicksDone = Math.round(elapsedMs / 1000 * (this.division * (prevSeg.bpm / 60)));
                    this._tempoSegments.push({
                        bpm,
                        startMs: nowMs,
                        startTick: prevSeg.startTick + prevTicksDone
                    });
                }
                return this;
            };

            const _origPlay = midiPlayer.play.bind(midiPlayer);
            midiPlayer.play = function() {
                this._tempoSegments = [{
                    bpm: this.tempo || 120,
                    startMs: new Date().getTime(),
                    startTick: this.startTick || 0
                }];
                return _origPlay();
            };

            midiPlayer.getCurrentTick = function() {
                if (!this.startTime) return this.startTick || 0;
                if (!this._tempoSegments || this._tempoSegments.length === 0) {
                    // フォールバック：元の計算
                    return Math.round((new Date().getTime() - this.startTime) / 1000 * (this.division * (this.tempo / 60))) + (this.startTick || 0);
                }
                const seg = this._tempoSegments[this._tempoSegments.length - 1];
                const elapsedMs = new Date().getTime() - seg.startMs;
                return Math.round(elapsedMs / 1000 * (this.division * (seg.bpm / 60))) + seg.startTick;
            };

            setupStudioUI(loadedMidiDataGetter);
            window.midiPlayerInstance = midiPlayer;
            window.forceStopStudioMIDI = handleStopMIDI;

            // ★★★ 修正：以前ここにあった 'studio-note-played' リスナー（自動再生音のみ、
            //   "noteOn" のみで消音イベントなし）は削除。録音は core.js の
            //   playNote/stopNote 経由で window.recordStudioEvent() が
            //   ユーザー・自動再生どちらの音も 'on'/'off' セットで正しく記録する。

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

// ★ ノート名変換（handleMidiEventと先読みシステムで共用）
function formatMidiNoteName(rawNoteName) {
    const flatToSharp = { 'db': 'cs', 'eb': 'ds', 'gb': 'fs', 'ab': 'gs', 'bb': 'as' };
    let convertedNote = rawNoteName.toLowerCase().replace('#', 's');
    for (let flat in flatToSharp) {
        if (convertedNote.startsWith(flat)) {
            convertedNote = convertedNote.replace(flat, flatToSharp[flat]);
            break;
        }
    }
    return convertedNote.charAt(0).toUpperCase() + convertedNote.slice(1);
}

// -------------------------
// ★ ブロック先読みシステム
// -------------------------

// 曲読込み完了時に一度だけ、全トラック分のNote onイベントをtick順に並べておく
function buildFlatNoteEvents() {
    flatNoteEvents = [];
    lookaheadPointer = 0;
    spawnedViaLookahead.clear();
    if (!midiPlayer || !midiPlayer.events) return;

    midiPlayer.events.forEach(trackEvents => {
        (trackEvents || []).forEach(e => {
            const name = e.name || e.messageType;
            if ((name === 'Note on' || name === 'NoteOn') && e.velocity > 0 && e.channel !== 10) {
                flatNoteEvents.push(e);
            }
        });
    });
    flatNoteEvents.sort((a, b) => a.tick - b.tick);
}

// 「ブロックがy=-30から生成されて、75pxライン(判定の中心)に到達するまで」に
// 実時間で何ミリ秒かかるかを、現在のBPM由来の速度から逆算する
function getLookaheadMs() {
    if (!window.gameEngine) return 0;
    const pianoCanvas = document.getElementById('piano-canvas');
    const gameCanvas = document.getElementById('sg-canvas-element');
    if (!pianoCanvas || !gameCanvas) return 0;

    const pianoTopY = pianoCanvas.getBoundingClientRect().top - gameCanvas.getBoundingClientRect().top;
    const travelDistance = (pianoTopY - 75) - (-30); // 生成位置(-30) → 75pxラインまでの距離
    const speed = window.gameEngine.baseSpeed * (window.gameEngine.bpm / 120); // 1フレームあたりの移動量(px)
    if (speed <= 0 || travelDistance <= 0) return 0;

    const framesNeeded = travelDistance / speed;
    return framesNeeded * (1000 / 60); // 60fps想定で実時間(ms)に変換
}

// 先読み範囲内に入った音を、実際に鳴るより前もってブロック化する
function lookaheadScanTick() {
    if (!midiPlayer || !window.gameEngine || !window.gameEngine.isRunning || !window.isGuideMode) return;

    const currentTick = typeof midiPlayer.getCurrentTick === 'function' ? midiPlayer.getCurrentTick() : (midiPlayer.tick || 0);
    const bpm = midiPlayer.tempo || 120;
    const ticksPerMs = (midiPlayer.division * (bpm / 60)) / 1000;
    const lookaheadTicks = getLookaheadMs() * ticksPerMs;

    while (lookaheadPointer < flatNoteEvents.length) {
        const ev = flatNoteEvents[lookaheadPointer];

        // まだ先読み範囲に入っていなければ、ここで走査を止める（次回のtickで再度確認）
        if (ev.tick > currentTick + lookaheadTicks) break;

        // 過去に行き過ぎたイベント（発音時刻をとうに過ぎたもの）は先読み対象外にしてスキップ
        if (ev.tick >= currentTick - ticksPerMs * 200) {
            const formatted = formatMidiNoteName(ev.noteName);
            const key = `${ev.tick}_${formatted}`;
            if (!spawnedViaLookahead.has(key) && isNoteInView(formatted)) {
                window.gameEngine.addFallingBlock(formatted);
                spawnedViaLookahead.add(key);
            }
        }
        lookaheadPointer++;
    }
}

function startLookaheadScanner() {
    stopLookaheadScanner();
    lookaheadTimerId = setInterval(lookaheadScanTick, 20);
}

function stopLookaheadScanner() {
    if (lookaheadTimerId) {
        clearInterval(lookaheadTimerId);
        lookaheadTimerId = null;
    }
}

function handleMidiEvent(event) {
    const eventName = event.name || event.messageType; 
    let noteName = event.noteName;
    if (!noteName) return;

    // ★ チャンネル10（MIDIパーカッション専用）はピアノ音源として再生しない
    //   ドラム/シンバル等のノートがピアノで鳴り、極端に短い異音になるのを防ぐ
    if (event.channel === 10) return;

    // 1. 音名の変換
    const formattedNote = formatMidiNoteName(noteName);

    // ★★★ 修正：
    //   「一時停止中かどうか(isGamePaused)」と「この音がユーザーの担当か(guideActive && inView)」
    //   は本来まったく別の軸。以前はこれを isRunning ひとつに混ぜてしまっていたため、
    //   一時停止中に isGuideMode 側の分岐が自動再生(else)に流れてしまい、

    //   「一時停止中なのに伴奏の音だけ鳴ってしまう」ケースがあり得た。
    //   → 一時停止中は「ブロック生成」「ユーザー待ち」「自動再生」を全部まとめて止め、
    //     一時停止中でなければ、これまで通り guideActive && inView で振り分ける。
    const isGamePaused = !!window.gameEngine && !window.gameEngine.isRunning;
    const guideActive = !!window.isGuideMode;
    const inView = isNoteInView(formattedNote);
    const isGuideNote = !isGamePaused && guideActive && inView;

    // ★ NoteOn 時の処理（削除 → 生成）
    if ((eventName === 'Note on' || eventName === 'NoteOn') && event.velocity > 0) {

        // ★★★ 修正：以前は新しいブロックを追加する直前に、同じ音の
        //   既存ブロック（＝まだユーザーが押していないもの）を毎回消していた。
        //   そのため同音連打の場面で、後から来た音が前の未解決ブロックを
        //   問答無用で上書きしてしまい、連打の最後の1個しか押すチャンスが
        //   無い状態になっていた（それが「勝手に消える」ように見えていた）。
        //   同じ音のブロックが複数同時に積み重なること自体は問題ないので
        //   （1回の打鍵で1個だけ消える、という対応は別途済み）、
        //   ここでの削除はやめ、単純に追加するだけにする。
        // ★ さらに、先読みシステム（lookaheadScanTick）で既にこのイベント分の
        //   ブロックを出し終えている場合は、ここでは重複して出さない。
        if (!isGamePaused && guideActive && inView) {
            const lookaheadKey = `${event.tick}_${formattedNote}`;
            if (!spawnedViaLookahead.has(lookaheadKey)) {
                window.gameEngine.addFallingBlock(formattedNote);
            }
        }

        // ★★★ 修正：以前ここにあった "guide" タイプの録音は削除。
        //   自動再生される音は core.js の playNote 経由で window.recordStudioEvent()
        //   が実際の発音として正しく('on'/'off'セットで)記録するため、ここでの
        //   二重記録は不要（かつ形式が違い再生時に音が鳴りっぱなしになる原因だった）。
    }

    // ここから下は元のロジックそのまま
    if (document.body.classList.contains('performance-mode')) return;

    if ((eventName === 'Note on' || eventName === 'NoteOn') && event.velocity > 0) {
        if (isGamePaused) {
            // ★ 一時停止中は、ユーザー待ちにも自動再生にもせず、何もしない
        } else if (isGuideNote) {
            // ★★★ 修正：midiPlayer.pause() は曲全体（伴奏トラックも含む）を
            //   止めてしまい、範囲外の音まで自動再生されなくなる副作用があったため撤回。
            //   代わりに pendingGuideNotes を毎回クリアせず蓄積するようにし、
            //   複数のガイド音を同時に「待機中」として保持できるようにする。
            //   （曲自体は止めず、ユーザーが弾くべき音の判定だけを個別に持ち越す）
            if (typeof setInternalPausedTime === 'function') setInternalPausedTime(); 
            pendingGuideNotes.add(formattedNote);
            updatePlayButtonUI('paused');
        } else {
            // ★★★ 修正：以前は自動再生の音量を固定値0.7にしていたため、
            //   MIDIファイル本来の強弱（velocity）が完全に無視されていた。
            //   ライブラリ側の event.velocity は 0〜100 のスケールで来るため、
            //   playNote が期待する 0〜1 の割合に変換して渡す。
            const autoVelocity = (typeof event.velocity === 'number' ? event.velocity : 70) / 100;
            if (window.playNote) window.playNote(formattedNote, autoVelocity, true); 
        }
    } else if (eventName === 'Note off' || eventName === 'NoteOff' || (event.velocity === 0)) {
        if (window.stopNote) window.stopNote(formattedNote, true);
    }
}


/* ============================================================
   🎹 Studio モード：スコア計算モジュール
   handlePlayProgress() より前に貼ってください
============================================================ */

const RANGE_MULTIPLIER = {
  "0.5": 1.0,
  "1.0": 1.2,
  "2.0": 1.5,
  "4.0": 2.0
};

// 1ブロックのスコア
// ★ 精度（0/60/70/80/90/100）は game-engine.js の judgeBlockScore() で
//   判定ライン（上の実線〜下の実線を9分割）に基づいて既に決定済み。
//   ここではその値にレンジ幅の倍率をかけるだけ。
function calcBlockScore(baseScore, rangeWidth) {
  const rangeMul = RANGE_MULTIPLIER[String(rangeWidth)] ?? 1.0;
  return baseScore * rangeMul;
}

// Studio モード全体のスコア集計
function calcTotalScore(blockResults, rangeWidth) {
  let total = 0;
  const history = [];

  blockResults.forEach(block => {
    const { score, octave, accuracyPercent, seq } = block;

    const blockScore = calcBlockScore(score, rangeWidth);
    total += blockScore;

    history.push({
      octave,
      accuracy: accuracyPercent,
      seq
    });
  });

  return {
    totalScore: Math.round(total),
    maxScore: Math.max(...blockResults.map(b => calcBlockScore(b.score, rangeWidth))),
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

    // ★ Studioモード開始：黒板の絵をsinging.pngへ（チョークで描くワイプ演出付き）
    setCharacterImage('singing.png');
    setBubbleText('〜♪');

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
        // ★ GAME ON中であることを示す汎用クラス（カスタム背景の有無に関わらず常に付与）
        //   CSS側で「GAME ON中だけ見た目を変えたい」場合の判定に使う
        document.body.classList.add('studio-game-active');

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
    z-index: 0 !important;
    pointer-events: none !important;
    display: block !important;
    visibility: visible !important;
    opacity: 0 !important;
    background-color: rgba(0, 0, 0, ${window.gameOverlayOpacity ?? 0.95}) !important;
    isolation: isolate !important;
    transition: opacity 1.5s ease-in !important;
`;
        // ★ 強制リフローしてから不透明度を上げることで、
        //   即時表示ではなくease-inでゆっくり暗転させる
        void container.offsetHeight;
        container.style.setProperty('opacity', '1', 'important');


        if (!window.gameEngine) {
            window.gameEngine = new StudioGameEngine(container);
        }
        if (window.gameEngine && typeof window.gameEngine.setBpm === "function") {
            window.gameEngine.setBpm(midiPlayer.tempo || 120);
        }

        // ★ このプレイで使うエンジンの参照を確保しておく
        //   （カウントダウン中にESC→はいで停止された場合、window.gameEngine は
        //    null に置き換えられるため、後で「自分が待っていたエンジンのままか」を
        //    判定できるようにする）
        const engine = window.gameEngine;

        // ★ 先読みシステムをリセットして開始（曲の途中から始める場合にも対応）
        lookaheadPointer = 0;
        spawnedViaLookahead.clear();
        startLookaheadScanner();

        // ★ カスタム背景URLが有効なら、Sessionモードと同じように
        //   鍵盤を半透明化・他のUIオブジェクトを透明化して没入感を出す。
        //   実際の背景表示(iframe)への切り替えも、GAME ON開始のこの瞬間に行う
        //   （常時表示だと、ESC中断・曲完了・リロード後もdefaultに戻らなかったため）。
        if (window.hasCustomBgUrl && window.customBgUrlValue) {
            document.body.classList.add('game-bg-active');
            if (typeof window.showCustomBackground === 'function') {
                window.showCustomBackground(window.customBgUrlValue);
            }
        }

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
        // ★★★ 重要（二重保存バグの修正）★★★
        // 以前はここで window.activeScoringRecord = null; を無条件に実行していたが、
        // これは main.js 側の MIDI 読込処理で既に正しく
        // window.activeScoringRecord = await saveImportedMidiToScoring(...) が
        // セットされた「直後」に呼ばれるため、ここで null に戻してしまうと
        // 曲を再生し終えた時点で「既存レコードが見つからない」と誤認し、
        // 同じ曲についてもう1件、別レコードとして保存されてしまっていた
        // （＝アーカイブに同じ曲が2つ並ぶ不具合。読込時保存と再生終了時保存の
        //   間に再生時間ぶんのタイムラグがあるのはこのため）。
        // window.activeScoringRecord のリセットは main.js 側の読込処理に一本化し、
        // ここでは何もしない。

        midiPlayer.stop();
        midiPlayer.loadArrayBuffer(loadedMidiData);
        buildFlatNoteEvents(); // ★ 先読みシステム用に、曲全体のイベントリストを構築し直す

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
        // ★ GAME ON中であることを示す汎用クラス（カスタム背景の有無に関わらず常に付与）
        document.body.classList.add('studio-game-active');

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
            z-index: 0 !important;
            pointer-events: none !important;
            display: block !important;
            visibility: visible !important;
            opacity: 0 !important;
            background-color: rgba(0, 0, 0, ${window.gameOverlayOpacity ?? 0.95}) !important;
            isolation: isolate !important;
            transition: opacity 1.5s ease-in !important;
        `;
        // ★ 強制リフローしてから不透明度を上げることで、
        //   即時表示ではなくease-inでゆっくり暗転させる
        void container.offsetHeight;
        container.style.setProperty('opacity', '1', 'important');

        // エンジン生成
        if (!window.gameEngine) {
            window.gameEngine = new StudioGameEngine(container);
        }
        if (window.gameEngine && typeof window.gameEngine.setBpm === "function") {
            window.gameEngine.setBpm(midiPlayer.tempo || 120);
        }

        const engine = window.gameEngine;

        // ★ 先読みシステムをリセットして開始（曲の途中から始める場合にも対応）
        lookaheadPointer = 0;
        spawnedViaLookahead.clear();
        startLookaheadScanner();

        // ★ カスタム背景URLが有効なら、Sessionモードと同じように
        //   鍵盤を半透明化・他のUIオブジェクトを透明化して没入感を出す。
        //   実際の背景表示(iframe)への切り替えも、GAME ON開始のこの瞬間に行う
        //   （常時表示だと、ESC中断・曲完了・リロード後もdefaultに戻らなかったため）。
        if (window.hasCustomBgUrl && window.customBgUrlValue) {
            document.body.classList.add('game-bg-active');
            if (typeof window.showCustomBackground === 'function') {
                window.showCustomBackground(window.customBgUrlValue);
            }
        }

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

/**
 * ★ 排他処理用：Studioモードが「動いている」状態
 *   （GAME ON中、または通常のMIDI再生中。MIDIが読み込まれているだけの状態は含まない）
 *   であれば強制停止する。Sessionモード側の開始ボタンから呼ばれる。
 *   曲を最後まで終えた時のようなスコア保存・フェード演出は行わず、
 *   モード切り替えのための「即時・無言の停止」として扱う。
 */
export function forceStopStudioIfRunning() {
    const gameRunning = window.isStudioMode === true && !!window.gameEngine;
    const playbackRunning = window.isPlaying === true;
    if (!gameRunning && !playbackRunning) return false; // 動いていなければ何もしない

    console.log("⛔ Studioモードが動作中のため、Session開始に伴い強制停止します。");

    if (gameRunning && typeof window.gameEngine.stop === 'function') {
        window.gameEngine.stop();
    }
    window.isStudioMode = false;
    window.gameEngine = null;
    window.studioGuideMode = null;
    window.isGuideMode = false;
    if (typeof updateGuideButtonUI === 'function') {
        updateGuideButtonUI(null);
    }

    handleStopMIDI();

    const canvasContainer = document.getElementById('sg-canvas-container');
    if (canvasContainer) canvasContainer.style.display = 'none';

    return true;
}

export function handleStopMIDI() {
    stopLookaheadScanner(); // ★ 先読みスキャナーも停止
    document.body.classList.remove('game-bg-active'); // ★ 透過演出も解除
    document.body.classList.remove('studio-game-active'); // ★ GAME ON汎用フラグも解除
    // ★ ESC中断・曲完了どちらもここを通るので、背景表示もここでdefaultに戻す
    //   （URLの設定自体は消さないので、次回のGAME ON開始時にはまた使われる）
    if (typeof window.showDefaultBackground === 'function') {
        window.showDefaultBackground();
    }
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
    // ★★★ 修正：ガイドの光り(.guide-active)がクリアされておらず、
    //   ESC→はい で強制停止した際に鍵盤の色が消えないまま残る不具合があったため追加。
    document.querySelectorAll('.key.guide-active').forEach(k => k.classList.remove('guide-active'));

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

// ★★★ Studioモード：ゲーム画面からメイン画面への「フェード復帰」 ★★★
// 黒いオーバーレイ（#sg-canvas-container）を即座に消すのではなく、
// 指定時間（デフォルト5秒）かけてゆっくり透明にし、
// 背後のメイン画面がじわじわ見えてくるようにする。
function fadeOutStudioCanvas(durationMs = 5000, onComplete = null) {
    const container = document.getElementById('sg-canvas-container');
    if (!container) {
        if (typeof onComplete === 'function') onComplete();
        return;
    }

    container.style.transition = `opacity ${durationMs}ms ease-in-out`;
    // 直前のスタイル変更を確実に反映させてから opacity を変える（transitionが効かない対策）
    void container.offsetHeight;
    container.style.opacity = '0';

    setTimeout(() => {
        container.style.display = 'none';
        // 次回表示時のために元に戻しておく
        container.style.transition = '';
        container.style.opacity = '1';

        // ★ スコアポップアップ（.sg-score-popup）も、ここまで container の子要素として
        //   一緒にフェードアウトしてきているので、消えきったタイミングで後片付けする
        //   （次回セッションで重複表示されないように、ここで確実に除去する）
        const popup = container.querySelector('.sg-score-popup');
        if (popup) popup.remove();

        // ★ 完全に明るさが戻ったタイミングで呼び出し元に通知する
        //   （キャラクターのスコア発表を、暗転が明るくなりきってから行うため）
        if (typeof onComplete === 'function') onComplete();
    }, durationMs);
}

// ★★★ Studio GAMEセッションの終了処理（共通化） ★★★
// 以前は ESC→はい の中だけで実行していたが、曲が最後まで自然に
// 終わった場合（endOfFile）にも同じ後片付け（スコア保存・エンジン停止・
// メイン画面へのフェード復帰）が行われるよう共通関数に切り出した。
// ★ DBに登録された曲名から「.mid」「.midi」拡張子を取り除いて表示用にする
//   （DB上のtitleフィールド自体は元のファイル名のまま。表示時だけ拡張子を隠す）
function stripMidiExtension(title) {
    if (!title) return title;
    return title.replace(/\.midi?$/i, '');
}

// ★★★ ESC/曲終了時：スコアが左上から飛び出す演出 ★★★
// ポップイン・アニメーションが終わり、少し表示を保持してから resolve する。
// フェードアウトはこの Promise が解決してから開始するので、
// 「スコアが飛び出している間はフェードアウトしない」が実現できる。
//
// ★ ポップアップはここでは削除しない。#sg-canvas-container の子要素のまま残し、
//   直後に呼ばれる fadeOutStudioCanvas() の opacity 遷移に一緒に乗せることで、
//   「メイン画面へのフェードイン/アウトと同じように」スコアも一緒に消えるようにしている。
//   実際の要素の除去は fadeOutStudioCanvas() 側（フェードが完了したタイミング）で行う。
//
// ★ title を渡すと、SCORE の上部に曲タイトルを表示する。
//   Studio Archiveの「▶GAME ON」から入った場合・メイン画面StudioタグからGAME ONした場合の
//   どちらでも、finishStudioGameSession() 側で解決した同じタイトルが渡ってくる想定。
function showScorePopup(score, title, holdMs = 500, isHighScore = false) {
    return new Promise((resolve) => {
        const container = document.getElementById('sg-canvas-container');
        if (!container) { resolve(); return; }

        const displayTitle = stripMidiExtension(title);

        // ★ ハイスコア演出用：スコアの数字を1桁ずつspanで分割する。
        //   各桁に少しずつtransition-delayをずらしておくことで、
        //   後でまとめてクラスを付与するだけで「左の桁から」明るくなる。
        const scoreDigitsHtml = String(score)
            .split('')
            .map((ch, i) => `<span class="sg-score-digit" style="transition-delay:${(i * 0.06).toFixed(2)}s">${ch}</span>`)
            .join('');

        const popup = document.createElement('div');
        popup.className = 'sg-score-popup';
        // ★ 暗幕(#sg-canvas-container)より確実に手前に出るよう強制指定
        popup.style.setProperty('z-index', '50000', 'important');
        popup.innerHTML = `
            ${displayTitle ? `<div class="sg-score-popup-title">${displayTitle}</div>` : ''}
            <div class="sg-score-popup-label">SCORE</div>
            ${isHighScore ? `<div class="sg-score-popup-highscore">High Score!</div>` : ''}
            <div class="sg-score-popup-value">${scoreDigitsHtml}</div>
            <div class="sg-score-underline">
                <span class="sg-score-hane"></span>
            </div>
        `;
        container.appendChild(popup);

        // ★ ハイスコア時：他の文字が現れ終わった0.7秒後に、
        //   数字を左の桁から順になめらかに明るい色へ変化させる
        if (isHighScore) {
            setTimeout(() => {
                popup.querySelectorAll('.sg-score-digit').forEach(el => {
                    el.classList.add('sg-digit-bright');
                });
            }, 700);
        }

        // 下線が引かれ、右端から「はね」が跳ね上がる演出が
        // 終わるのを待ってから resolve する
        const hane = popup.querySelector('.sg-score-hane');
        let resolved = false;
        const finish = () => {
            if (resolved) return;
            resolved = true;
            resolve(); // ★ popup.remove() はしない（container と一緒にフェードさせるため）
        };
        hane.addEventListener('animationend', () => {
            setTimeout(finish, holdMs);
        }, { once: true });

        // ★★★ 安全策 ★★★
        // .sg-score-hane に対応するCSSアニメーションが無い/読み込めていない場合、
        // animationend が永遠に発火せず、画面が暗転したまま固まってしまう。
        // CSSの有無に関わらず必ず先に進めるよう、一定時間後に強制的に resolve する。
        setTimeout(finish, 2000 + holdMs);
    });
}

async function finishStudioGameSession() {
    // ★ Studio/GAME ON再生終了後、季節にちなんだセリフを一度だけ表示する
    triggerSeasonalThought();

    // カウントダウン中に呼ばれた場合の凍結解除
    if (window.gameEngine && typeof window.gameEngine.cancelCountdown === 'function') {
        window.gameEngine.cancelCountdown();
    }

    // STOPボタン（■）と同じ後始末
    handleStopMIDI();

    // scoringDB再生フローの残タイマーを破棄
    dbPlaybackTimers.forEach(id => clearTimeout(id));
    dbPlaybackTimers = [];

    // スコア集計と保存
    const rangeWidth = window.currentRangeWidth || 1.0;
    const blockResults = window.blockResults || [];
    let scoreToShow = 0; // ★ ポップアップに表示するスコア
    let isHighScore = false; // ★ 今回のプレイが自己ベスト更新かどうか
    let resultLine = ''; // ★ キャラクターに発表させるスコア・正答率の文言

    // ★★★ Scoreポップアップに表示する曲タイトル（両入口共通）★★★
    // ・Studio Archiveの「▶GAME ON」から入った場合 → window.activeScoringRecord.title
    // ・メイン画面StudioタグからGAME ONした場合    → 同じく window.activeScoringRecord.title
    //   （MIDI読込時に saveImportedMidiToScoring() の戻り値で紐付け済み）
    // どちらの入口でも window.activeScoringRecord に、DBに登録された名称がそのまま入っている。
    const songTitleForDisplay =
        (window.activeScoringRecord && window.activeScoringRecord.title) ||
        window.currentMidiFileName ||
        window.loadedMidiTitle ||
        "";

    // ★★★ hitAccuracy（レコード単位の正答率）★★★
    // 正答＝上の実線〜下の実線の間で消せたブロック（score > 0 のもの）
    // 誤答＝それ以外（枠の外で消した／消さずに残った・見逃した分すべて）
    // 分母は「画面内に出現したブロック数（totalSpawnedBlocks）」全体。
    //
    // ★ 紛らわしい点への注意 ★
    // これは Studio Archive 一覧に1レコードにつき1つ表示する「正答率(%)」。
    // 下の calcTotalScore() が返す history[].accuracy（＝1ブロックごとの
    // 得点 0/60/70/80/90/100、スパークライン用）とは別物なので注意。
    // 混同を避けるため、こちらは必ず hitAccuracy という名前で扱うこと。
    const totalSpawned = window.totalSpawnedBlocks || 0;
    const correctCount = blockResults.filter(b => b.score > 0).length;
    const hitAccuracy = totalSpawned > 0 ? (correctCount / totalSpawned) * 100 : 0;

    // ★★★ 修正：以前はこのスコア集計・保存処理の中で例外（IndexedDBの
    //   InvalidStateError等）が発生すると、関数がそこで止まってしまい、
    //   下にある「GAME ON状態のリセット」「window.gameEngine = null」等の
    //   後始末に一切到達できなくなっていた。これが「ESC→はいを選んでも
    //   GAME ONが解除されない」不具合の原因。
    //   スコア集計・保存に失敗しても、後始末は必ず実行されるよう
    //   try-catchで囲む。
    try {
        if (blockResults.length > 0) {
            const result = calcTotalScore(blockResults, rangeWidth);
            scoreToShow = result.totalScore;

            // ★★★ 重要（同じ曲が毎回増えていく不具合の多重防御）★★★
            // 本来は window.activeScoringRecord が正しくセットされているはずだが、
            // 何らかの理由でリンクが外れていた場合に備え、タイトルが完全一致する
            // 既存レコードをここでも探す。saveImportedMidiToScoring() 側の重複判定と
            // 同じ「title の完全一致」を基準にすることで、同じ曲であれば必ず
            // 同じレコードを更新対象にできる（＝グラフのポイントが増えていく）。
            let targetRecord = window.activeScoringRecord;
            if (!targetRecord) {
                const lookupTitle = window.currentMidiFileName || window.loadedMidiTitle;
                if (lookupTitle) {
                    try {
                        const allScores = await playnoteDB.getAllStudioScores();
                        targetRecord = allScores.find(s => s.title === lookupTitle) || null;
                        if (targetRecord) {
                            console.warn("[Studio] activeScoringRecord が未設定でしたが、タイトル一致で既存レコードを発見して更新します:", lookupTitle);
                        }
                    } catch (dbErr) {
                        // ★ DB接続が閉じかけている等で失敗しても、新規レコードとして扱って続行する
                        console.warn("[Studio] getAllStudioScores に失敗したため、新規レコードとして扱います:", dbErr);
                        targetRecord = null;
                    }
                }
            }

            // ★ 自己ベスト更新かどうかをここで判定（targetRecordを更新する前に行う）
            // ★★★ 修正：以前は targetRecord.maxScore（1ブロックあたりの満点=100点固定）
            //   と比較していたため、数ブロック弾いただけで合計スコアがすぐ100を超え、
            //   実質ずっとHigh Score判定になってしまっていた。
            //   同じ曲の過去の全プレイ（playHistory）の中の実際の最高合計スコアと
            //   比較し、本当に自己ベストを更新した時だけHigh Scoreとする。
            const pastPlayScores = (targetRecord && Array.isArray(targetRecord.playHistory))
                ? targetRecord.playHistory.map(p => p.totalScore || 0)
                : [];
            const bestPastScore = pastPlayScores.length > 0 ? Math.max(...pastPlayScores) : 0;
            isHighScore = !targetRecord || pastPlayScores.length === 0 || result.totalScore > bestPastScore;

            // ★ 過去5回（今回含む）のスコアが上昇傾向かどうかを判定
            //   直近のペアのうち6割以上で増加していれば「上昇傾向」とみなす
            const recentScores = [...pastPlayScores.slice(-4), result.totalScore];
            let isTrendingUp = false;
            if (recentScores.length >= 3) {
                let increases = 0;
                for (let i = 1; i < recentScores.length; i++) {
                    if (recentScores[i] > recentScores[i - 1]) increases++;
                }
                isTrendingUp = increases >= Math.ceil((recentScores.length - 1) * 0.6);
            }

            // ★ GAME ON終了時のスコア・正答率報告文を組み立てる。
            //   実際にキャラクターへ反映するのは、暗転が完全に明るく戻った後
            //   （fadeOutStudioCanvas完了後）に行う。
            resultLine = `スコアは${result.totalScore}、正答率${hitAccuracy.toFixed(1)}%でした。`;
            if (isHighScore) {
                resultLine += ' 自己ベスト更新です、すごいですね！';
            } else if (isTrendingUp) {
                resultLine += ' 最近スコアが伸びていますね、その調子です！';
            }

            // ★★★ playHistory（アーカイブのグラフ用：「プレイ単位」の全記録）★★★
            // これは1プレイ = 1点。history（1プレイの中のブロックごとの得点）とは全く別物。
            // 配列の先頭が一番古いプレイ、末尾が最新のプレイ。
            // ★ 以前は「直近10回」だけを保持していたが、削除した際に
            //   11回目以前の記録が右から出てくるようにするため、
            //   ここでは最大10000回ぶんまで保持するようにする
            //  （グラフの表示自体は studio-scoring-ui.js 側で常に「末尾10件」を切り出して描画する）。
            const MAX_PLAY_HISTORY = 10000;
            const prevPlayHistory = (targetRecord && targetRecord.playHistory) || [];
            const playHistory = [...prevPlayHistory, {
                date: Date.now(),
                hitAccuracy,
                totalScore: result.totalScore, // ★ ホバー時のツールチップ表示用
                rangeWidth                     // ★ ホバー時のツールチップ表示用（演奏範囲・オクターブ幅）
            }].slice(-MAX_PLAY_HISTORY);

            if (targetRecord) {
                const prev = targetRecord;
                await playnoteDB.updateStudioScore({
                    ...prev,
                    latestDate: Date.now(),
                    totalScore: result.totalScore,
                    maxScore: Math.max(prev.maxScore || 0, result.maxScore),
                    hitAccuracy, // ★ レコード単位の正答率（%）。history[].accuracy とは別物
                    playHistory, // ★ アーカイブのグラフ用：直近10プレイ分
                    history: result.history
                });
                console.log("Studio score updated (existing record):", result, "hitAccuracy:", hitAccuracy);
            } else {
                // ★ ここに来るのは「同じタイトルの既存レコードが本当に存在しない」
                //   （＝正真正銘、初めてプレイする曲）場合のみ。
                //   title は saveImportedMidiToScoring() 側と基準を合わせるため
                //   window.currentMidiFileName を優先する（拡張子なし版の
                //   loadedMidiTitle だと文字列が食い違い、次回また新規扱いに
                //   なってしまうため）。
                await playnoteDB.saveStudioScore({
                    id: crypto.randomUUID(),
                    createdAt: Date.now(),
                    title: window.currentMidiFileName || window.loadedMidiTitle || "Studio_" + Date.now(),
                    latestDate: Date.now(),
                    totalScore: result.totalScore,
                    maxScore: result.maxScore,
                    hitAccuracy, // ★ レコード単位の正答率（%）。history[].accuracy とは別物
                    playHistory, // ★ アーカイブのグラフ用：直近10プレイ分（この時点では1件のみ）
                    history: result.history
                });
                console.log("Studio score saved (new record):", result, "hitAccuracy:", hitAccuracy);
            }
        } else {
            console.log("No blocks hit → score not saved");
        }
    } catch (scoreErr) {
        console.error("[Studio] スコア集計・保存中にエラーが発生しましたが、後始末は続行します:", scoreErr);
    }

    window.activeScoringRecord = null;

    // エンジン完全停止（内部 stop はスコア計算＋リセット）
    if (window.gameEngine && typeof window.gameEngine.stop === 'function') {
        await window.gameEngine.stop();
    }

    // ★★★ 修正：以前はこの window.gameEngine = null が、スコアポップアップの
    //   演出（await showScorePopup、1〜2秒程度）が終わった後に実行されていた。
    //   stop() 済み（canvasは既にDOMから削除済み）だが window.gameEngine 自体は
    //   まだ残っている「隙間」の間に、素早く次のGAME ONを開始すると
    //   `if (!window.gameEngine)` の判定に引っかからず、壊れた古いインスタンスが
    //   そのまま再利用されてしまい、カウントダウンがおかしくなる不具合の原因だった。
    //   stop() の直後、演出より前に null化して、次の開始が必ず新しいインスタンスを
    //   作れるようにする。
    window.gameEngine = null;

    // ★★★ 修正：GAME ONボタンの状態（studioGuideMode）がリセットされておらず、
    //   ESC→はい で中断してもボタンが「GAME ON」のままになる不具合があったため追加。
    //   STOPボタン等と同じ「解除された状態」に戻す。
    window.studioGuideMode = null;
    window.isGuideMode = false;
    if (typeof updateGuideButtonUI === 'function') {
        updateGuideButtonUI(null);
    }

    // ★ スコアが左上から飛び出す演出 → 表示が終わってから初めてフェードアウトを開始する
    await showScorePopup(scoreToShow, songTitleForDisplay, 500, isHighScore);
    fadeOutStudioCanvas(5000, () => {
        // ★ 暗転が完全に明るく戻ったタイミングで、smiling.pngとともにスコアを発表する
        //   （1ブロックも弾かなかった場合はresultLineが空のまま＝発表しない、元の挙動を踏襲）
        if (resultLine) {
            setCharacterImage('smiling.png');
            setBubbleText(resultLine);
        }
    });

    // フラグ類リセット
    window.isPlaying = false;
    window.isStudioMode = false;

    // スコア一覧更新
    if (typeof renderStudioScoreList === 'function') {
        await renderStudioScoreList();
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

    // ★ Web(体験)版：Studio録音はローカル(有料)版限定のため、視覚的にロック表示する
    //   （CSSファイルは別途受領予定のため、ここではインラインスタイルで対応）
    if (recBtn && !isLocalApp()) {
        recBtn.style.opacity = '0.5';
        recBtn.style.cursor = 'not-allowed';
        recBtn.title = 'Studioの録音・保存機能はローカル版（有料）限定の機能です';
    }

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
            // ★ Web(体験)版：Studioの録音・保存機能はローカル(有料)版限定
            if (!isLocalApp()) {
                showLocalOnlyToast("Studioの録音・保存機能");
                return;
            }

            isStudioRecording = true;
            window.isStudioRecording = true; // ★ core.js 側から参照するために同期
            studioEvents = [];
            studioStartTime = performance.now();

            recBtn.classList.add('active');
            recBtn.textContent = "● REC";

            console.log("🎙 Studio Recording Started");
        }

        // --- 録音停止 ---
        else {
            isStudioRecording = false;
            window.isStudioRecording = false; // ★ core.js 側から参照するために同期

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

        // ★ getSongTime()はテンポチェンジが多い曲で変動するため、
        //   extractNotesFromMidi()で計算した正確な値を使う
        let total = window.currentSongDurationMs ? window.currentSongDurationMs / 1000 : 0;
        if (total <= 0) {
            total = midiPlayer.getSongTime ? midiPlayer.getSongTime() : 0;
            if (total > 10000) total /= 1000;
        }

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
            // ★ シーク後にテンポセグメントをリセット（パッチ済みgetCurrentTickが正しく動くよう）
            if (midiPlayer._tempoSegments && midiPlayer._tempoSegments.length > 0) {
                const lastSeg = midiPlayer._tempoSegments[midiPlayer._tempoSegments.length - 1];
                midiPlayer._tempoSegments = [{
                    bpm: lastSeg.bpm,
                    startMs: midiPlayer.startTime,
                    startTick: targetTick
                }];
            }
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
} // ★ setupStudioUI の閉じ括弧


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
    // ★★★ 修正：以前は window.isStudioMode の時にここで return してしまい、
    //   ブロックを消すだけで pendingGuideNotes のクリア・MIDI再生の再開に
    //   一切到達していなかった。handleMidiEvent側の一時停止(pendingGuideNotes.add)は
    //   Session/Studio共通の同じ仕組みを使っているため、Studioモードだけ解除処理を
    //   スキップすると、最初のガイド音を弾いた時点でMIDI再生が止まったまま二度と
    //   再開されず、以降のブロック・自動再生の音がすべて鳴らなくなる不具合の原因になっていた。

    // ★★★ 修正：ここで無条件に removeBlock を呼んでいたのを削除。
    //   ブロックの削除は handleUserKeyPress → gameEngine.handleKeyPress 側で
    //   スコア判定付きで既に正しく行われているため、ここでも呼ぶと二重処理になり、
    //   かつ「押した音と同じ名前の、無関係な別のブロック」まで巻き添えで
    //   消えてしまう不具合の原因になっていた。

    // 1. 既存のガイド判定ロジック（Session / Studio 共通）
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
        // ★ ここが "0:00" 固定文字列になっていたため、formatTime(0) を通さず
        //   総時間側だけゼロ埋め（00:00）、経過時間側は "0:00" のまま、という
        //   表記ゆれが発生していた。formatTime(0) に統一して常に "00:00" にする。
        timeDisplay.textContent = `${formatTime(0)} / ${formatTime(total)}`;
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

    // 簡易コンファーム UI を生成（★ Archive/設定画面と同じ木目デザインに統一）
    const confirmBox = document.createElement('div');
    confirmBox.id = "studio-confirm-box";
    confirmBox.style.cssText = `
        position: fixed;
        top: 0; left: 0;
        width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.55);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 200300;
    `;
    confirmBox.innerHTML = `
        <div class="pw-select-container" style="width: 360px; min-height: 0;">
            <div class="settings-header">
                <span class="settings-title">CONFIRM</span>
            </div>
            <div class="pw-select-body" style="flex-grow: 0; padding: 20px 0;">
                <p style="margin: 0 0 20px; text-align: center; color: #e0d0b0; font-size: 15px;">本当に中断しますか？</p>
                <div style="display: flex; gap: 12px;">
                    <button id="studio-confirm-no" class="btn-stamp-base pw-select-btn" style="font-size: 14px; padding: 10px 0;">いいえ</button>
                    <button id="studio-confirm-yes" class="btn-stamp-base pw-select-btn" style="font-size: 14px; padding: 10px 0;">はい</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(confirmBox);

    // ② 「はい」＝ 停止（■）と完全に同じ挙動にする
    document.getElementById("studio-confirm-yes").onclick = async () => {
        console.log("[Studio] ESC → YES (stop)");

        // ★★★ 修正：以前は finishStudioGameSession() の完了(スコア集計・
        //   スコアポップアップ表示等、数秒かかる処理)を待ってからモーダルを
        //   閉じていたため、「はい」を押してもしばらく確認モーダルが
        //   画面に残ったままになっていた。先にモーダルだけ即座に消す。
        confirmBox.remove();

        // ★★★ 重要 ★★★
        // スコア集計・保存、エンジン停止、メイン画面へのフェード復帰は
        // 曲が自然に終わった場合（endOfFile）と共通の処理なので、
        // finishStudioGameSession() に統一している。
        await finishStudioGameSession();
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