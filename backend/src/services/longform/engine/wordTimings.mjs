// Word-level narration timings — the pure half.
//
// WHY THIS EXISTS. Card elements land at a FRACTION of a beat's spoken
// duration: build.mjs fires the payoff at ~30% of the take, clamped. That is
// already tied to speech (a beat is one narration line) but it is not tied to a
// WORD, so "the thing that predicted heart attacks" and its on-screen answer
// drift apart by whatever the sentence's rhythm happens to be.
//
// ElevenLabs will return a character-level alignment beside the audio if asked
// (`/with-timestamps`). This module turns that into words, and resolves an
// authored anchor phrase to a time. It is deliberately SEPARATE from narrate.mjs
// and build.mjs and free of I/O, because it is the part that can be tested
// without an API key — the two callers are thin.
//
// NOTHING HERE IS REQUIRED. A film that declares no anchors, or whose takes
// predate this feature, keeps the proportional timing exactly as before.

/** Characters that are part of a word for matching purposes. */
const strip = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * ElevenLabs character alignment → word timings.
 *
 * The API returns three parallel arrays: the characters it spoke, and a start
 * and end second for each. Words are runs between whitespace; a word's start is
 * its first character's start and its end is its last character's end.
 *
 * @param {{characters: string[], character_start_times_seconds: number[],
 *          character_end_times_seconds: number[]}} alignment
 * @returns {{word: string, start: number, end: number}[]}
 */
export function wordsFromAlignment(alignment) {
  const chars = alignment?.characters;
  const starts = alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;
  if (!Array.isArray(chars) || !Array.isArray(starts) || !Array.isArray(ends)) return [];
  // THE THREE ARRAYS MUST AGREE. A truncated timing array would otherwise
  // produce words whose start is undefined, and undefined sorts and compares
  // silently — the anchor would resolve to NaN and the reveal to frame zero.
  if (chars.length !== starts.length || chars.length !== ends.length) {
    throw new Error(
      `wordsFromAlignment: alignment arrays disagree (${chars.length} chars, ` +
      `${starts.length} starts, ${ends.length} ends) — refusing to guess`);
  }

  const words = [];
  let cur = null;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (/\s/.test(c)) { if (cur) { words.push(cur); cur = null; } continue; }
    if (!cur) cur = { word: c, start: starts[i], end: ends[i] };
    else { cur.word += c; cur.end = ends[i]; }
  }
  if (cur) words.push(cur);
  return words;
}

/**
 * Where in the take does `phrase` begin?
 *
 * Matching ignores case and punctuation, so an anchor may be written the way
 * the script writes it ("that needle went in") without tracking whether the
 * comma survived normalisation. Returns the start second of the phrase's FIRST
 * word, or null when the phrase does not occur.
 *
 * A phrase occurring more than once resolves to the first occurrence, which is
 * the reading that matches how someone writing the anchor thinks about it.
 *
 * @returns {number|null}
 */
export function findAnchor(words, phrase) {
  const needle = String(phrase || "").split(/\s+/).map(strip).filter(Boolean);
  if (!needle.length || !words?.length) return null;
  const hay = words.map((w) => strip(w.word));
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let hit = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) { hit = false; break; }
    }
    if (hit) return words[i].start;
  }
  return null;
}

/**
 * Resolve a card's `revealOn` anchor into a legal reveal time.
 *
 * The clamp is the SAME window build.mjs already enforces, and it is not
 * negotiable: a reveal before the entrance finishes cuts the entrance off, and
 * one too close to the end leaves no room for the payoff to play. An anchor
 * outside the window is pulled to its edge rather than rejected — the author's
 * intent ("land on this word") is still served as closely as the format allows,
 * and the alternative is refusing to build a film over a word near an edge.
 *
 * @param {number} anchorAt   seconds into the take, from findAnchor
 * @param {number} takeDur    the take's duration in seconds
 * @param {number} enterSecs  ENTER_SECS
 * @param {number} payoffSecs PAYOFF_SECS
 */
export function clampReveal(anchorAt, takeDur, enterSecs, payoffSecs) {
  const lo = enterSecs + 0.30;
  const hi = Math.max(lo, takeDur - payoffSecs - 0.9);
  return Math.min(Math.max(anchorAt, lo), hi);
}
