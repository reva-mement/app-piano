import { renderKeys, setupScrollLogic } from './ui.js';
import { initAudio } from './core.js';
import { initEffects } from './fx.js';
import { setupInputListeners } from './events.js';

export function initPiano() {
    initAudio();
    renderKeys('piano-canvas');
    initEffects();
    setupInputListeners();
    setupScrollLogic();
    console.log("PianoWorks: Piano Initialized via Modular System.");
}