// Shared editorial-sensitivity test. ONE source of truth, imported by every
// caller that needs it — the same "one measure, ordered bands" discipline the
// event-graph judges follow. Two differently-worded tragedy regexes drifting
// apart is how you end up with a caption that suppresses its engagement
// question while the card beside it still carries a photo.
//
// TWO TIERS, ORDERED (DrJ, 2026-08-30). The tier is chosen by WHO VETTED THE
// PICTURE against this specific story, because that is what changes the cost of
// being wrong:
//
//   isExplicitHarmHeadline — NARROW. For the publisher's own photograph. A
//     newsroom picture editor chose that image for that story, so we are
//     inheriting an editorial judgement rather than making one. Against that,
//     a keyword firing on "crash" in a market story is more likely wrong than
//     right, and it costs the beat its only real picture.
//
//   isSensitiveHeadline — BROAD. For stock, archive and any generated or
//     third-party imagery. Nobody vetted those against this story, so the
//     over-broad guard stays exactly as aggressive as it has always been.
//
// The narrow set is a STRICT SUBSET of the broad one (pinned by a test), so the
// tiers can never invert: anything that suppresses a publisher photo also
// suppresses stock.
//
// Consumers today:
//   - socialComposer      — broad; suppresses FB/IG engagement CTAs.
//   - cardRenderer        — broad; suppresses the photo background entirely.
//   - videoStockLibrary   — broad; suppresses stock cutaways whole-video.
//   - incidentChecks      — broad; whole-story gate on incident material.
//   - videoAutopost       — BOTH: narrow for the article's own photo, broad for
//                           archive footage.
//
// Deliberately keyword-based and deliberately over-broad. These are guards, not
// classifiers: a false positive costs one typographic card (on-brand, never
// wrong), while a false negative puts a photo beside a massacre. The asymmetry
// is the whole design, and it is why the narrow tier is still a keyword list
// rather than something cleverer.

/**
 * EXPLICIT HARM TO PEOPLE. No metaphorical reading in ordinary headline English.
 *
 * INFLECTIONS ARE THE POINT, not tidiness. The original single list carried
 * `killed` but not `kills`, `death` but not `deaths` or `dead` — gaps that went
 * unnoticed because a polysemous word usually caught the headline anyway
 * ("Plane crash kills 200" matched on `crash`, never on `kills`). Splitting the
 * tiers removes that accidental backstop from the narrow tier, so the gaps had
 * to be closed in the same change or the split would have introduced silent
 * false negatives on exactly the graphic stories this exists for.
 */
export const EXPLICIT_HARM_KEYWORDS =
  /\b(die[sd]?|dead|deaths?|kill(s|ed|ing|ings)?|murder(s|ed)?|massacres?|fatalities|funerals?|mourn(s|ed|ing)?|stabb(ed|ing)|drown(s|ed|ing)?|shootings?)\b/i;

/**
 * METAPHOR-PRONE. Real tragedy words that ordinary news also uses figuratively:
 * a market crash, a cyber attack, a PR disaster, a fatal flaw, a Greek tragedy.
 *
 * Broad tier only. A genuinely graphic story almost always ALSO carries an
 * explicit-harm word ("crash kills 200"), which is why dropping these from the
 * narrow tier loses very little once the inflections above are closed.
 */
export const AMBIGUOUS_HARM_KEYWORDS =
  /\b(crash(es|ed)?|attacks?|disasters?|traged(y|ies)|terror|fatal(ly)?)\b/i;

/**
 * The broad guard — UNCHANGED IN INTENT, and a strict superset of what it
 * matched before: every keyword from the original list is still here, across
 * the two sets, plus the closed inflections. It therefore suppresses slightly
 * MORE than it used to (`500 deaths`, `six dead`, `crash kills 200` now match
 * where they previously slipped through), which is the safe direction for
 * every existing consumer.
 */
export const TRAGEDY_KEYWORDS = new RegExp(
  `${EXPLICIT_HARM_KEYWORDS.source}|${AMBIGUOUS_HARM_KEYWORDS.source}`, "i");

/**
 * True when a headline should not carry THIRD-PARTY imagery — stock, archive,
 * generated, or anything else nobody checked against this story.
 *
 * Takes the headline only — not the body. The body of almost any hard-news
 * story mentions death somewhere; the headline is what sits beside the image.
 */
export function isSensitiveHeadline(title) {
  const s = String(title || "").trim();
  if (!s) return true;   // no headline to judge — take the safe path
  return TRAGEDY_KEYWORDS.test(s);
}

/**
 * True when a headline should not carry EVEN THE PUBLISHER'S OWN photograph.
 *
 * The narrower bar. A missing headline still takes the safe path: no headline
 * to judge is exactly when we should not be guessing.
 *
 * KNOWN GAP, stated rather than papered over: this is a keyword list, so a
 * graphic story phrased without any of these words ("Bodies recovered after
 * ferry sinks") passes both tiers. Closing that needs new concepts (bodies,
 * victims, casualties), which is a widening decision rather than an inflection
 * fix, and belongs in its own change with its own false-positive measurement.
 */
export function isExplicitHarmHeadline(title) {
  const s = String(title || "").trim();
  if (!s) return true;
  return EXPLICIT_HARM_KEYWORDS.test(s);
}
