/**
 * trackerRank — frontend ranking helpers for Tracker cards (Sprint 1.5.2).
 *
 * Q1 (Sprint 1.5 investigation): when an event has N trackers of different
 * template types, the highest-confidence tracker wins the Layer 1 card
 * headline; ties break by most-recent last_updated_at. The read API
 * (/api/ri/events/:slug/trackers) returns all trackers unranked — ranking
 * is frontend logic, lives here.
 *
 * Confidence vocabularies differ per template (conflict: provisional/
 * disputed/confirmed; outbreak: suspected/probable/confirmed; sports:
 * scheduled/live/final; etc.). For cross-template comparison we map every
 * vocabulary's tiers onto a single 0–3 strength ordinal:
 *   3 = strong/verified   (confirmed, official-finding, certified-official,
 *                          final, replicated-or-consensus)
 *   2 = medium            (revised, investigating, partial-count, live,
 *                          peer-reviewed, probable, studio-reported, disputed)
 *   1 = weak/early        (provisional, preliminary, preliminary-reading,
 *                          projected, estimated, suspected, scheduled, preprint)
 *   0 = no metrics / unknown confidence (the empty-state common case)
 */

const CONFIDENCE_STRENGTH = Object.freeze({
  // 3 — strong / verified
  confirmed: 3,
  "official-finding": 3,
  "certified-official": 3,
  final: 3,
  "replicated-or-consensus": 3,
  // 2 — medium
  revised: 2,
  investigating: 2,
  "partial-count": 2,
  live: 2,
  "peer-reviewed": 2,
  probable: 2,
  "studio-reported": 2,
  disputed: 2,
  // 1 — weak / early
  provisional: 1,
  preliminary: 1,
  "preliminary-reading": 1,
  projected: 1,
  estimated: 1,
  suspected: 1,
  scheduled: 1,
  preprint: 1,
});

export function confidenceStrength(confidence) {
  if (!confidence) return 0;
  return CONFIDENCE_STRENGTH[confidence] ?? 0;
}

/**
 * trackerStrength — the strongest confidence across a tracker's metrics.
 * Empty-metrics trackers (the common production case) return 0.
 */
export function trackerStrength(tracker) {
  const metrics = tracker?.metrics ?? {};
  let max = 0;
  for (const block of Object.values(metrics)) {
    const s = confidenceStrength(block?.confidence);
    if (s > max) max = s;
  }
  return max;
}

/**
 * pickHeadlineTracker — Q1 selection. Returns the tracker whose headline
 * should represent a multi-tracker event on a Layer 1 card: highest
 * strength, tie-broken by most-recent last_updated_at. Returns null for an
 * empty array.
 */
export function pickHeadlineTracker(trackers) {
  if (!Array.isArray(trackers) || trackers.length === 0) return null;
  return [...trackers].sort((a, b) => {
    const sa = trackerStrength(a);
    const sb = trackerStrength(b);
    if (sb !== sa) return sb - sa;                       // stronger first
    return (b.last_updated_at ?? 0) - (a.last_updated_at ?? 0); // then recency
  })[0];
}
