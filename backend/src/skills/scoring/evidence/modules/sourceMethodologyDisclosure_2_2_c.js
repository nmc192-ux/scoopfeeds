/**
 * 2.2.c — Methodology disclosure on data journalism (Methodology transparency / MT), B.6.3c-2a.
 *
 * The FIRST find-relevant judgment: only data-journalism pieces (polls / surveys /
 * quantitative analysis) are in scope. The gitignored prompt's GATE returns the reserved
 * "not-applicable" sentinel for any other article; makeFindRelevantJudgment then:
 *   - aggregates over the data pieces that committed a bucket, OR
 *   - abstains to UNAVAILABLE "no-relevant-article-in-sample" when the sample has no data
 *     journalism (couldn't-observe ≠ observed-absence — never levels[0]).
 *
 * Article-body judgment (needsArticleBodies → shared pre-pass). Language unfed.
 */
import { makeFindRelevantJudgment } from "../llm/findRelevantJudgment.js";

// requiresCapableModel (B.6.4a / #109): the relevance gate only abstains correctly on
// a gate-validated model; the runner guards this module against running on a too-small
// one. Additive flag — the factory/gate logic is unchanged.
export default {
  ...makeFindRelevantJudgment({
    id: "2.2.c",
    component: "MT",
    levels: ["no disclosure", "partial", "most elements", "full (method+N+MoE+limits)"],
  }),
  requiresCapableModel: true,
};
