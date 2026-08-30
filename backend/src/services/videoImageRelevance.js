/**
 * videoImageRelevance.js — the replacement for a gate that was measurably wrong.
 *
 * ─── Why the old one is deleted rather than tuned ───────────────────────────
 *
 * videoFootage.js decided relevance by TOKEN OVERLAP: a candidate passed if it
 * shared ANY non-stopword token of four characters or more with the query. That
 * is a disjunction, and a disjunction over a large archive finds a coincidence
 * almost every time. Live evidence from prod, 2026-08-30 — one of three cached
 * hits was:
 *
 *     query      "A polar bear on ice"
 *     matched    "168th Refueling Wing performs Polar Bear Charge
 *                 on Eielson Air Force Base"           (DVIDS)
 *
 * A military refuelling exercise NAMED "Polar Bear Charge". Both "polar" and
 * "bear" are present, so the gate was satisfied; the picture is of aircraft.
 * DrJ: "token overlap is not relevance, it's coincidence with extra steps."
 *
 * THAT CASE IS THE ACCEPTANCE TEST, on the record. Any relevance model that
 * would have passed it has failed, and there is a test below named for it.
 *
 * ─── What replaces it ───────────────────────────────────────────────────────
 *
 * CONJUNCTIVE coverage. Every content token of the query must be present in the
 * candidate, not merely one of them. "polar bear ice" against "…Polar Bear
 * Charge on Eielson Air Force Base" fails on `ice`, which is precisely the word
 * that carried the meaning.
 *
 * This is deliberately CONSERVATIVE and will reject true matches — "Vladimir
 * Putin" against "Trump, Putin meet for Alaska 2025 Summit" fails on
 * `vladimir`. That is the correct trade here and not a defect to tune away: a
 * miss falls through to the next tier and ultimately to a card, which is always
 * a correct video, while a false accept puts the wrong picture on screen
 * unattended twelve times a day. Named subjects have an exact path (QID → P18)
 * that needs no text matching at all; this gate exists for the tier where the
 * words are all we have.
 *
 * It is a GUARD, not a classifier — the same posture as editorialSensitivity.
 */

const STOP = new Set((
  "a an the of to in on for and or but with from into over under after before at as by is are was were be been "
  + "this that these those it its his her their they we you i not no more most about across against during "
  + "new news photo photos image images picture pictures view shows showing during near"
).split(" "));

/** Content tokens: lowercase, punctuation-stripped, stopwords and stubs removed. */
export function contentTokens(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Does this candidate actually depict the query?
 *
 * CONJUNCTIVE: every query token must appear. See the header for why the
 * disjunctive version is deleted rather than adjusted.
 */
export function candidateMatches(query, candidateText) {
  const q = contentTokens(query);
  if (!q.length) return false;
  const c = new Set(contentTokens(candidateText));
  return q.every((t) => c.has(t));
}

/**
 * PROPER-NOUN SHAPE. A capitalised run inside a sentence, an all-caps token, or
 * a digit-led designation ("168th") — the marks of a specific named thing.
 *
 * Used to keep named subjects away from stock. Judged on the RAW string,
 * because case is the entire signal and normalising destroys it.
 */
export function looksNamed(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  if (/\b[A-Z]{2,}\b/.test(s)) return true;                 // NASA, UNRWA
  if (/\b\d+(st|nd|rd|th)\b/i.test(s)) return true;          // 168th
  // A capitalised word that is not merely the first word of the phrase.
  const words = s.split(/\s+/);
  return words.slice(1).some((w) => /^[A-Z][a-z]{2,}/.test(w))
      || (words.length === 1 && /^[A-Z][a-z]{2,}/.test(words[0]) && /^[A-Z]/.test(s));
}

/**
 * Is this a query stock may answer?
 *
 * DrJ's ruling: stock is for beats where any plausible image is correct by
 * construction — "winter landscape", "gas pipeline". A named subject has a
 * right answer, so a plausible wrong one is the failure mode we refuse. A
 * stock "school gate" for the Qalandiya Training Centre is the worked example.
 */
export function isAbstractQuery(text) {
  if (!String(text || "").trim()) return false;
  if (looksNamed(text)) return false;
  return contentTokens(text).length > 0;
}

/**
 * Pick the first candidate that passes, or null.
 *
 * Candidates are judged on their own descriptive text — title, alt or description —
 * whichever the provider gives. Order is the provider's; this never re-ranks,
 * because a ranking function over candidates is a scorer, and a scorer is the
 * thing that produced the polar bear.
 */
export function firstRelevant(query, candidates = [], textOf = (c) => c?.title || c?.alt || c?.description || "") {
  for (const c of candidates) {
    if (candidateMatches(query, textOf(c))) return c;
  }
  return null;
}
