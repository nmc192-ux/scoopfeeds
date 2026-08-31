// Characters that RENDER AS A DIFFERENT CHARACTER in the project fonts.
//
// THE FAILURE THIS EXISTS FOR. The xylitol film's caveat card was authored as
// ["TERTILES", "≠", "QUARTILES"] and rendered "TERTILES = QUARTILES" — the
// exact opposite of the claim, on the one frame whose entire purpose is to say
// the comparison groups are NOT interchangeable, in a health video under a
// named clinician's byline. Nothing caught it: the card validated, satori
// rendered it without complaint, and the storyboard still says "≠".
//
// It is not a missing glyph. Anton's cmap maps U+2260 to a real glyph index
// (933, distinct from "="'s 656) — so a coverage check passes. That glyph's
// OUTLINE is simply an equals sign: same 12 path commands, same 637 advance.
// The font is wrong, and no amount of checking the font's own claims finds it.
//
// So the check compares OUTLINES. Two characters that draw the same path are
// indistinguishable on screen whatever the font says they are. The pairs below
// were computed from the shipped fonts, not guessed — confusables.test.mjs
// recomputes them and fails if the set changes, so a font update cannot quietly
// introduce a new one.
//
// Anton's full confusable set is four pairs. Only one of them LIES:
//
//   ≠ → =    MEANING-CHANGING. Negation silently becomes assertion.
//   – → -    cosmetic. An en dash reads as a hyphen. Nobody is misled.
//   ″ → "    cosmetic.
//   ′ → '    cosmetic.
//
// Only the meaning-changing ones are refused. Rejecting en dashes would be
// pedantry that authors would route around, and a rule people route around
// stops protecting anything.

/** Every confusable pair in the project fonts, as authored → what is drawn. */
export const CONFUSABLE = Object.freeze({
  "≠": "=",    // ≠ NOT EQUAL TO
  "–": "-",    // – EN DASH
  "″": '"',    // ″ DOUBLE PRIME
  "′": "'",    // ′ PRIME
});

/**
 * The subset a card may not contain, because the drawn character means
 * something DIFFERENT from the authored one rather than merely looking plainer.
 */
export const FORBIDDEN = Object.freeze({
  "≠": {
    renders: "=",
    why: 'a "not equal" that draws as "equal" states the opposite of the claim',
    instead: 'write the words — "ARE NOT", "IS NOT" — which also read better in a caption',
  },
});

/**
 * Find forbidden characters in a set of on-screen strings.
 * @returns {{char: string, renders: string, why: string, instead: string, inText: string}[]}
 */
export function confusablesIn(strings) {
  const hits = [];
  for (const s of strings) {
    if (typeof s !== "string") continue;
    for (const [ch, info] of Object.entries(FORBIDDEN)) {
      if (s.includes(ch)) hits.push({ char: ch, ...info, inText: s });
    }
  }
  return hits;
}
