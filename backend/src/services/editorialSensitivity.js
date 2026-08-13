// Shared editorial-sensitivity test. ONE regex, imported by every caller that
// needs it — the same "one measure, ordered bands" discipline the event-graph
// judges follow. Two differently-worded tragedy regexes drifting apart is how
// you end up with a caption that suppresses its engagement question while the
// card beside it still carries a photo.
//
// Consumers today:
//   - socialComposer  — suppresses FB/IG engagement CTAs ("What do you think?"
//     under a death toll reads as crass).
//   - cardRenderer    — suppresses the photo background entirely, so a
//     sensitive headline always renders on the typographic card.
//
// Deliberately keyword-based and deliberately over-broad. This is a guard, not
// a classifier: a false positive costs one typographic card (which is on-brand
// and never wrong), while a false negative puts a stock-or-publisher photo
// beside a massacre. The asymmetry is the whole design.

export const TRAGEDY_KEYWORDS =
  /\b(dies?|killed|death|murdered|fatal|tragedy|massacre|crash|attack|shooting|terror|disaster|funeral|mourns?|stabbed|drowned)\b/i;

/**
 * True when a headline should not carry a photographic background.
 *
 * Takes the headline only — not the body. The body of almost any hard-news
 * story mentions death somewhere; the headline is what sits beside the image.
 */
export function isSensitiveHeadline(title) {
  const s = String(title || "").trim();
  if (!s) return true;   // no headline to judge — take the safe path
  return TRAGEDY_KEYWORDS.test(s);
}
