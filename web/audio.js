// One shared player per page, backed by po32.wasm's synth.
import { loadSynth } from './po32.js';
import { createPlayer } from './player.js';

export const player = createPlayer(await loadSynth(await (await fetch('po32.wasm')).arrayBuffer()));

// Leaving the page stops playback, so a page restored by the back button comes back silent.
addEventListener('pagehide', () => player.close());

export const PLAY_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 2v10l8-5z" fill="currentColor"/></svg>';
export const STOP_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="3" y="3" width="8" height="8" fill="currentColor"/></svg>';
