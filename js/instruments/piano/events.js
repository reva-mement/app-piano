/* --- src/js/instruments/piano/events.js --- */
import { playNote, stopNote } from './core.js';

export function setupInputListeners(keyAssignments) {
    const canvas = document.getElementById('piano-canvas');
    
    // キーボード入力
    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        const note = keyAssignments.get(e.key.toUpperCase());
        if (note) playNote(note);
    });

    window.addEventListener('keyup', (e) => {
        const note = keyAssignments.get(e.key.toUpperCase());
        if (note) stopNote(note);
    });

    // マウス入力
    canvas.addEventListener('mousedown', (e) => {
        const keyEl = e.target.closest('.key');
        if (keyEl) {
            window.isMouseDown = true;
            playNote(keyEl.dataset.note);
        }
    });

    canvas.addEventListener('mouseover', (e) => {
        if (window.isMouseDown) {
            const keyEl = e.target.closest('.key');
            if (keyEl) playNote(keyEl.dataset.note);
        }
    });

    canvas.addEventListener('mouseout', (e) => {
        const keyEl = e.target.closest('.key');
        if (keyEl) stopNote(keyEl.dataset.note);
    });

    window.addEventListener('mouseup', () => {
        window.isMouseDown = false;
        // releaseAllKeys のロジックをここに移植
    });
}