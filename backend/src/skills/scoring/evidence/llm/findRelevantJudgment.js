/**
 * findRelevantJudgment.js — makeFindRelevantJudgment(config) factory (B.6.3c-2).
 *
 * The find-relevant variant of makeArticleTextJudgment: same shared pre-pass + per-body
 * harness + aggregateAcrossArticles, PLUS a relevance gate. A gated prompt returns the
 * reserved sentinel "not-applicable" for a body that is not the relevant TYPE (e.g. a
 * non-data-journalism piece for 2.2.c). parseJudgment flags those runs (notApplicable),
 * and the harness surfaces reason "not-applicable" for a sentinel-dominant body.
 *
 * ★ The honesty the gate buys (couldn't-observe ≠ observed-absence, at the source). ★
 *   committed (≥1 article judged a real bucket)        → aggregateAcrossArticles (UNCHANGED) → evidenced
 *   no ok bodies at all (fetch failed for the source)  → pending-llm "no-article-bodies" (NOT no-relevant)
 *   committed=0, not-applicable DOMINATES the sample    → UNAVAILABLE "no-relevant-article-in-sample"
 *                                                         (had bodies, none were the relevant type —
 *                                                          a coverage gap, NOT levels[0], NOT a fetch failure)
 *   committed=0, genuine splits/parse-fails dominate    → pending-llm "no-committed-articles"
 *
 * "no-relevant-article-in-sample" uses the EXISTING `unavailable` status (its documented
 * semantic: data we'd need isn't present) + a distinct value.reason — NO new status, NO
 * DB migration. aggregateAcrossArticles is reused UNCHANGED (it already keeps committed-only).
 *
 * Language UNFED (input.language=undefined). founderFlag set-not-consumed. levels[0] only
 * from a positive locus quote (enforced in the gitignored prompt). Evidence-only.
 */

import { EVIDENCE_STATUS } from "../contract.js";
import { evaluateWithConfidence } from "./judgmentHarness.js";
import { aggregateAcrossArticles } from "./aggregateAcrossArticles.js";

const DEFAULT_TTL_DAYS = 120;
const BASIS = "llm-multi-article-aggregate";

export function makeFindRelevantJudgment(config) {
  const { id, component, levels, ttlDays = DEFAULT_TTL_DAYS, buildInput } = config;
  if (!id || !component || !Array.isArray(levels) || levels.length === 0) {
    throw new Error("makeFindRelevantJudgment: { id, component, levels[] } required");
  }

  function abstain(status, reason, sampled, extra, now) {
    return {
      status,
      value: { reason, articlesSeen: sampled.length, sampleCommitted: 0, basis: BASIS, ...extra },
      confidence: 0,
      evidenceUrl: null,
      gatheredAt: now,
    };
  }

  async function gather(source, ctx) {
    const now = ctx.now;
    const sampled = ctx.articleBodies || [];
    const bodies = sampled.filter((b) => b && b.ok && b.text);

    // Couldn't observe any body (fetch failed for the source) → pending-llm, NOT no-relevant.
    if (bodies.length === 0) {
      return abstain(EVIDENCE_STATUS.PENDING_LLM, "no-article-bodies", sampled, { founderFlag: true }, now);
    }

    // Per-article judgment via the UNCHANGED harness (standard 3 runs); buildInput lets a
    // gated criterion inject extra context (e.g. owner names for 2.2.d) — default is the
    // plain body input identical to makeArticleTextJudgment.
    const results = [];
    for (const b of bodies) {
      const input = buildInput
        ? buildInput(b, source, ctx)
        : { text: b.text, language: undefined, evidenceUrl: b.finalUrl, truncated: b.truncated };
      results.push(await evaluateWithConfidence({ subCriterion: id, rubric: { levels }, input, ctx }));
    }

    // ≥1 article committed a real bucket → aggregate over the relevant ones (aggregator
    // keeps committed-only, so non-applicable / split articles are dropped automatically).
    const committed = results.filter((r) => r.status === EVIDENCE_STATUS.EVIDENCED && levels.includes(r.value?.bucket));
    if (committed.length > 0) {
      return { ...aggregateAcrossArticles(results, { levels }), gatheredAt: now };
    }

    // committed=0 → was the sample irrelevant, or just unresolved?
    const notApplicableCount = results.filter(
      (r) => r.status === EVIDENCE_STATUS.PENDING_LLM && r.value?.reason === "not-applicable",
    ).length;

    if (notApplicableCount > results.length / 2) {
      // Had bodies, a strict majority not the relevant type → abstain (coverage gap).
      return abstain(EVIDENCE_STATUS.UNAVAILABLE, "no-relevant-article-in-sample", sampled, { notApplicableCount, founderFlag: false }, now);
    }
    // Genuine indecision dominates (relevant-looking pieces we couldn't resolve) → pending.
    return abstain(EVIDENCE_STATUS.PENDING_LLM, "no-committed-articles", sampled, { notApplicableCount, founderFlag: true }, now);
  }

  return { id, component, ttlDays, needsArticleBodies: true, gather };
}
