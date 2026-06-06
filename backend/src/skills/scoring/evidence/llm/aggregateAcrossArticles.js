/**
 * aggregateAcrossArticles.js — DETERMINISTIC cross-article aggregator (B.6.3c).
 *
 * The article-text judgments run the (unchanged) per-body harness once per ok body,
 * then aggregate those per-article verdicts into ONE source-level Evidence. This file
 * is pure + deterministic (no LLM, no fetch, no clock) so the aggregation honesty is
 * unit-testable in isolation.
 *
 * Honesty rules baked in:
 *   - Only results that COMMITTED a bucket count (pending-llm / no-commit dropped;
 *     ok:false bodies never reach here — the pre-pass filters them).
 *   - N === 0 committed → pending-llm (couldn't-commit across the sample), NEVER
 *     levels[0] (absence-of-commit ≠ observed-worst — the #106 discipline at the
 *     source level).
 *   - TIE on the modal bucket → resolve to the LOWER bucket (conservative — never
 *     round a source UP on a coin-flip).
 *   - Source verdict stays LOCUS-GROUNDED: it carries only the harness-verified
 *     grounded quotes from the modal-bucket articles (capped), each tagged with its
 *     article URL. No surviving quote → ungroundedAtSource → founderFlag.
 */

import { EVIDENCE_STATUS, round2 } from "../contract.js";

const BASIS = "llm-multi-article-aggregate";
const QUOTE_CAP = 3; // a handful of grounded quotes is enough provenance for the source verdict

/**
 * aggregateAcrossArticles(perArticleResults, { levels }) → Evidence-shaped
 *   { status, value, confidence, evidenceUrl }   (caller adds gatheredAt)
 *
 * perArticleResults: Evidence objects from evaluateWithConfidence (one per ok body).
 * levels: the criterion's graduated scale (low→high); levels[0] is the lowest.
 */
export function aggregateAcrossArticles(perArticleResults, { levels } = {}) {
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new Error("aggregateAcrossArticles: { levels } (the graduated buckets, low→high) is required");
  }
  const all = Array.isArray(perArticleResults) ? perArticleResults : [];
  const articlesSeen = all.length;

  // Keep only committed, in-rubric evidenced verdicts.
  const committed = all.filter(
    (r) => r && r.status === EVIDENCE_STATUS.EVIDENCED && r.value && levels.includes(r.value.bucket),
  );
  const N = committed.length;

  // No article committed a bucket → unresolved at the source (NOT the lowest bucket).
  if (N === 0) {
    return {
      status: EVIDENCE_STATUS.PENDING_LLM,
      confidence: 0,
      evidenceUrl: null,
      value: { reason: "no-committed-articles", articlesSeen, sampleCommitted: 0, founderFlag: true, basis: BASIS },
    };
  }

  // Modal bucket with conservative-LOWER tie-break.
  const counts = {};
  for (const r of committed) counts[r.value.bucket] = (counts[r.value.bucket] || 0) + 1;
  const maxCount = Math.max(...Object.values(counts));
  const tied = Object.keys(counts).filter((b) => counts[b] === maxCount);
  let modalBucket = tied[0];
  for (const b of tied) if (levels.indexOf(b) < levels.indexOf(modalBucket)) modalBucket = b;

  const modalShare = round2(maxCount / N);
  const meanConfidence = round2(committed.reduce((s, r) => s + (r.confidence || 0), 0) / N);
  const confidence = round2(meanConfidence * modalShare);

  // Locus grounding at the source: verified quotes from the modal-bucket articles only.
  const modalArticles = committed.filter((r) => r.value.bucket === modalBucket);
  const quotes = [];
  for (const r of modalArticles) {
    for (const q of r.value.groundingQuotes || []) {
      quotes.push({ quote: q, article: r.evidenceUrl || null });
      if (quotes.length >= QUOTE_CAP) break;
    }
    if (quotes.length >= QUOTE_CAP) break;
  }
  const ungroundedAtSource = quotes.length === 0;
  const founderFlag = confidence < 0.5 || ungroundedAtSource; // mirrors the harness threshold

  return {
    status: EVIDENCE_STATUS.EVIDENCED,
    confidence,
    evidenceUrl: quotes[0]?.article ?? modalArticles[0]?.evidenceUrl ?? null,
    value: {
      bucket: modalBucket,
      modalShare,
      meanConfidence,
      quotes,
      ungroundedAtSource,
      founderFlag,
      articlesSeen,
      sampleCommitted: N,
      basis: BASIS,
    },
  };
}
