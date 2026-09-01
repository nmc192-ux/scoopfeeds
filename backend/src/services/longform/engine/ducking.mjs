// Sidechain ducking presets — shared by both bed producers.
//
// In a module of their own because music.mjs calls loadStoryboard() at import
// time and therefore cannot be imported outside a project directory. These are
// tuning constants with a real argument behind them; they should be readable
// and testable without a film on disk.

/**
 * `bed` — the procedural score. A synth pad sitting politely underneath,
 * ducked gently because it was never loud enough to fight the voice.
 *
 * `track` — a real music track that is supposed to be PRESENT: heard as music,
 * not as atmosphere. That inverts the balance. The bed runs hotter between
 * lines, so it has to duck harder and sooner when a line starts, or the voice
 * loses the top of every sentence — the first consonant is exactly where a
 * slow attack does its damage. The longer release is what lets the track swell
 * back up in the gaps rather than pumping on every syllable, which is the
 * artefact that makes heavy ducking sound cheap.
 */
export const DUCK = Object.freeze({
  bed:   Object.freeze({ threshold: 0.12, ratio: 2.5, attack: 20, release: 380, makeup: 1 }),
  track: Object.freeze({ threshold: 0.05, ratio: 9,   attack: 8,  release: 550, makeup: 1 }),
});
