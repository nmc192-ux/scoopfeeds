/**
 * ttsPronunciations.js — how Kokoro should SAY a word it gets wrong.
 *
 * ─── TO ADD A NAME, ADD ONE LINE TO THE LIST BELOW ───────────────────────────
 *
 *   { word: "Xi", say: "Shee" },
 *
 *   word  exactly as it is written in a caption (case matters: "Xi" is the
 *         name; "XI" as in "Pope Pius XI" is left alone). Matched as a whole
 *         word, so "Xi" never touches "Xinhua". Dots and other symbols are fine.
 *   say   a respelling Kokoro reads correctly. Check it before adding it:
 *         Kokoro's /dev/phonemize endpoint shows what a spelling will sound like.
 *
 * ONLY THE AUDIO CHANGES. The caption on screen keeps the original spelling —
 * videoVoice sends the respelled text to Kokoro, then maps Kokoro's timings
 * back onto the caption's OWN words, so the burned captions still say "Xi" and
 * "E.ON". Kokoro only: ElevenLabs and the longform films never read this list.
 *
 * Editing the list re-voices only the captions it affects: the respelled text
 * is part of the Kokoro cache key for those captions, and no other.
 *
 * Checked against Kokoro v0.9.0, voice bm_george, 2026-09-27:
 *   "Xi"   → /zaɪ/ (wrong)          "Shee"  → /ʃiː/  (right)
 *   "E.ON" → /iː əʊ ɛn/ (spelled)   "ee-on" → /ˈiːɒn/ (right)
 */
export const PRONUNCIATIONS = [
  { word: "Xi",   say: "Shee" },
  { word: "E.ON", say: "ee-on" },
];

// ─────────────────────────────────────────────────────────────────────────────

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One regex per entry, whole-word: not preceded or followed by a letter,
 * digit, or a dot joined to one (so "E.ON" does not match inside "E.ON.X",
 * but does match "E.ON," and "E.ON." at the end of a sentence).
 */
//
// `word` MUST BE ONE WORD (no spaces): the timing mapper matches caption words
// one at a time, so a two-word entry could not be mapped back and is skipped
// rather than half-applied. `say` may be several words.
function compile(list) {
  return list
    .filter((p) => p && typeof p.word === "string" && p.word.trim() && !/\s/.test(p.word.trim())
      && typeof p.say === "string" && p.say.trim())
    .map((p) => ({ ...p, re: new RegExp(`(?<![\\p{L}\\p{N}.])${escape(p.word.trim())}(?![\\p{L}\\p{N}]|\\.[\\p{L}\\p{N}])`, "gu") }));
}
const COMPILED = compile(PRONUNCIATIONS);

/** The text Kokoro should read. Unchanged when nothing on the list appears. */
export function applyPronunciations(text, list = COMPILED) {
  let out = String(text ?? "");
  for (const p of list) out = out.replace(p.re, p.say.trim());
  return out;
}

export const _internals = { compile };
