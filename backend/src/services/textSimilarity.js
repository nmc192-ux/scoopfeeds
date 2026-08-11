/**
 * textSimilarity.js — ONE near-duplicate measure, shared.
 *
 * This is `tooSimilar`, recovered verbatim from videoSourceBundle (01638c7) and
 * lifted out of videoSelection.js unchanged. It has one job: answer "is this
 * text a restatement of that text?" — first for candidate selection ("is this
 * the same story I already published?"), now also for the script arc ("does the
 * opening caption just say the headline again?").
 *
 * IT LIVES HERE BECAUSE OF AN IMPORT CONSTRAINT, not a taxonomy preference.
 * videoSpecSchema.js is documented and tested as pure — no I/O, no model calls,
 * no DB — and videoSelection.js reaches transitively into eventsDao and the
 * database layer. Importing the selector to borrow one pure function would have
 * dragged the whole DAL into a validator whose test suite exists precisely
 * because it needs none of it.
 *
 * The alternative was a second copy, and that is the one thing not to do here.
 * Three judges asking the same question on three separately-computed quantities
 * is what produced the create-merge-split treadmill on the event graph (174
 * slugs for one story). videoSelection re-exports these so its own callers and
 * tests are untouched.
 */

/** Lowercase, strip punctuation, collapse whitespace. */
export const normText = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Content words: >4 characters, which is a crude but effective stop-word
 * filter — it drops "the/and/that/with/from" and keeps the nouns and verbs that
 * carry the claim.
 */
export const contentWordSet = (s) =>
  new Set(normText(s).split(" ").filter((w) => w.length > 4));

/**
 * True when `candidate` overlaps ANY of `seenWordSets` by >= 60% of the smaller
 * set. Unchanged from the original, including its edge case:
 *
 *   AN EMPTY CANDIDATE RETURNS TRUE.
 *
 * For selection that is the safe direction — a title with no content words is
 * not a story worth publishing, so "too similar" correctly refuses it. For the
 * arc checks it is the WRONG direction: a short, punchy caption like "So who
 * pays now?" has no word over four characters and would be rejected as a
 * restatement of a headline it shares nothing with. Callers that cannot
 * tolerate that must use `canJudgeSimilarity` first — see restatesAny.
 */
export function tooSimilar(candidate, seenWordSets) {
  const words = contentWordSet(candidate);
  if (words.size === 0) return true;
  for (const seen of seenWordSets) {
    let overlap = 0;
    for (const w of words) if (seen.has(w)) overlap++;
    if (overlap >= Math.min(words.size, seen.size) * 0.6) return true;
  }
  return false;
}

/** Does this text carry enough content words for the measure to mean anything? */
export function canJudgeSimilarity(text) {
  return contentWordSet(text).size > 0;
}

/**
 * The arc-safe form: "is `candidate` a restatement of any of `references`?"
 *
 * Differs from `tooSimilar` in exactly two ways, both required by the fact that
 * this one REJECTS A VIDEO rather than skipping a candidate:
 *
 *   - No content words in the candidate, or no reference with any, means the
 *     measure cannot judge — returns `{ restates: false }` rather than the
 *     original's "true". Refusing a good short caption for having no long words
 *     would be an unexplainable rejection.
 *   - It reports WHICH reference matched, by label, so the correction note sent
 *     into the regeneration retry can say "you restated the headline" instead of
 *     "something was too similar to something".
 *
 * @param {string} candidate
 * @param {Array<{label: string, text: string}>} references
 * @returns {{restates: boolean, matched: string|null}}
 */
export function restatesAny(candidate, references) {
  if (!canJudgeSimilarity(candidate)) return { restates: false, matched: null };
  for (const ref of references) {
    if (!ref || !canJudgeSimilarity(ref.text)) continue;
    if (tooSimilar(candidate, [contentWordSet(ref.text)])) {
      return { restates: true, matched: ref.label };
    }
  }
  return { restates: false, matched: null };
}
