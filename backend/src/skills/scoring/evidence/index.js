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
