/* --- js/modes/studioState.js --- */

// 内部変数（このファイルの外からは直接見えません）
let playbackStartTime = 0;
let pausedTimeOffset = 0;
let isPlaying = false;

// 【重要】export const StudioState とすることで、他のファイルから import できるようになります
export const StudioState = {
    // 現在の経過秒数を取得
    getCurrentTime: () => {
        if (isPlaying) {
            return (performance.now() - playbackStartTime) / 1000;
        }
        return pausedTimeOffset;
    },

    // 再生開始（引数に秒数を渡せばその位置から、なければ今の位置から開始）
    setStartTime: (offset = null) => {
        if (offset !== null) pausedTimeOffset = offset;
        playbackStartTime = performance.now() - (pausedTimeOffset * 1000);
        isPlaying = true;
    },

    // 一時停止（その瞬間の秒数を保存）
    setPausedTime: () => {
        pausedTimeOffset = (performance.now() - playbackStartTime) / 1000;
        isPlaying = false;
    },

    // 完全停止（リセット）
    reset: () => {
        playbackStartTime = 0;
        pausedTimeOffset = 0;
        isPlaying = false;
    },

    // 外部から今の状態を覗くためのプロパティ（ゲッター）
    get isPlaying() { return isPlaying; },
    get pausedTimeOffset() { return pausedTimeOffset; }
};