/* src/js/modes/studio/timer.js */

let playbackStartTime = 0;
let pausedTimeOffset = 0;

export const getInternalTime = () => {
    if (window.isPlaying) {
        return (performance.now() - playbackStartTime) / 1000;
    }
    return pausedTimeOffset;
};

export const setInternalStartTime = (offset = null) => {
    if (offset !== null) pausedTimeOffset = offset;
    playbackStartTime = performance.now() - (pausedTimeOffset * 1000);
};

export const setInternalPausedTime = () => {
    pausedTimeOffset = (performance.now() - playbackStartTime) / 1000;
};

export const resetPausedTimeOffset = () => {
    pausedTimeOffset = 0;
};