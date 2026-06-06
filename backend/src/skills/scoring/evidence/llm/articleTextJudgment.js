/**
 * articleTextJudgment.js — makeArticleTextJudgment(config) factory (B.6.3c-1).
 *
 * ONE tested code path; the article-text sub-criteria (2.2.a, 2.1.e, 2.3.d, …) are
 * config objects that parameterize it — mirroring makePresenceDetector. Each returned
 * module honors the evidence contract and is flagged needsArticleBodies:true, so the
 * runner's shared article-body pre-pass fetches ≤5 bodies ONCE per source and injects
 * them on ctx.articleBodies. Modules READ ctx.articleBodies; they never fetch.
 *
 * Flow (ratified): per ok body, run the UNCHANGED harness (evaluateWithConfidence, at
 * the standard 3 runs — ctx.runs NOT overridden) → then aggregateAcrossArticles folds
 * the per-article verdicts into ONE source-level Evidence. Bodies are NEVER concatenated.
 *
 * Honesty:
 *   - no ok bodies (all fetch-missed / none sampled) → pending-llm "no-article-bodies"
 *     (couldn't-observe; NEVER levels[0]).
 *   - per-article split / disagreement → that article contributes pending-llm, dropped
 *     by the aggregator; all-pending → source pending-llm (aggregator).
 *   - levels[0] is reachable only when an article's prompt quoted a specific offending
 *     passage (the prompt enforces this) and that quote survives grounding verification.
 *   - language stays UNFED: input.language = undefined (carried item; B.6.5).
 * Evidence-only.
 */

import { EVIDENCE_STATUS } from "../contract.js";
import { evaluateWithConfidence } from "./judgmentHarness.js";
import { aggregateAcrossArticles } from "./aggregateAcrossArticles.js";

const DEFAULT_TTL_DAYS = 120; // matches the article-sample judgment primaryLinks_2_2_b

export function makeArticleTextJudgment(config) {
  const { id, component, levels, ttlDays = DEFAULT_TTL_DAYS } = config;
  if (!id || !component || !Array.isArray(levels) || levels.length === 0) {
    throw new Error("makeArticleTextJudgment: { id, component, levels[] } required");
  }

  async function gather(source, ctx) {
    const now = ctx.now;
    const sampled = ctx.articleBodies || [];
    const bodies = sampled.filter((b) => b && b.ok && b.text);

    // Couldn't observe any body → pending-llm, never the lowest bucket.
    if (bodies.length === 0) {
      return {
        status: EVIDENCE_STATUS.PENDING_LLM,
        value: { reason: "no-article-bodies", articlesSeen: sampled.length, sampleCommitted: 0, founderFlag: true, basis: "llm-multi-article-aggregate" },
        confidence: 0,
        evidenceUrl: null,
        gatheredAt: now,
      };
    }

    // Per-article judgment via the UNCHANGED harness (standard 3 runs).
    const results = [];
    for (const b of bodies) {
      const r = await evaluateWithConfidence({
        subCriterion: id,
        rubric: { levels },
        input: { text: b.text, language: undefined, evidenceUrl: b.finalUrl, truncated: b.truncated },
        ctx,
      });
      results.push(r);
    }

    const agg = aggregateAcrossArticles(results, { levels });
    return { ...agg, gatheredAt: now };
  }

  return { id, component, ttlDays, needsArticleBodies: true, gather };
}
