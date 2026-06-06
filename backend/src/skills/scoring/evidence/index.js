/**
 * evidence/ — the evidence-gathering layer of the scoring skill (B.6.2).
 *
 * Public entry point for the framework. Kept separate from the skill's
 * top-level index.js (which exports the rubric + combination + sources DAO);
 * consumers of the evidence layer import from here.
 *
 * See ./README.md for the evidence-module contract (the precedent for every
 * future sub-criterion: B.6.2b site-scraping, B.6.2c structured-data lookup,
 * B.6.2d link-ratio).
 */

export { EVIDENCE_STATUS, DEFAULT_SAMPLE_SIZE, assertEvidenceShape, round2 } from "./contract.js";
export { getEvidence, listEvidenceForSource, upsertEvidence, isStale } from "./evidenceCache.js";
export { EVIDENCE_MODULES, getModule } from "./registry.js";
export { gatherForSource, gatherForAllSources } from "./runner.js";
// B.6.2b site-scraping layer (discovery + confirmation primitives + the
// presence-detector factory the structure modules are built from).
export { discoverSite, CONVENTION_PATHS } from "./pageDiscovery.js";
export { confirmPage } from "./confirmPage.js";
export { makePresenceDetector } from "./presenceDetector.js";
export { detectByline } from "./bylineDetect.js";
export { resolveOrgByDomain } from "./wikidataClient.js";
// B.6.2d link-ratio layer (the 2.2.b primary-document classification crux).
export { isPrimaryHost, extractBodyExternalLinks, classifyLinks } from "./primaryLinkClassify.js";
// B.6.3a LLM-judgment substrate: the honest-confidence harness (inter-run
// agreement + grounding + language factor) + the gitignored-prompt loader.
export { evaluateWithConfidence } from "./llm/judgmentHarness.js";
export { loadPrompt } from "./llm/promptLoader.js";
export { groundedRubricInstruction, parseJudgment, GROUNDED_RUBRIC_SCHEMA } from "./llm/groundedSchema.js";
export { pageText } from "./llm/pageText.js";
// B.6.3c — shared article-body pre-pass (infra; ctx.articleBodies built by the runner).
export { fetchArticleBodies } from "./llm/articleBodyPrepass.js";
// B.6.3c-1 — article-text judgment factory + cross-article aggregator.
export { makeArticleTextJudgment } from "./llm/articleTextJudgment.js";
export { aggregateAcrossArticles } from "./llm/aggregateAcrossArticles.js";
