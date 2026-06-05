/**
 * registry.js — the evidence-module registry.
 *
 * The single list the runner iterates. Adding a sub-criterion (B.6.2b/c/d) =
 * write a module under ./modules/ and append it here. Nothing else changes.
 *
 * B.6.2a registers ONLY the two own-DB modules (zero external fetch). The
 * deferred modules (site-scraping, structured-data lookup, link-ratio) land in
 * later sub-sprints.
 */

import bylines_2_1_c from "./modules/bylines_2_1_c.js";
import sustainedCoverage_2_3_c from "./modules/sustainedCoverage_2_3_c.js";
// B.6.2b-2b — site-structure presence detectors (needsDiscovery; share the
// runner's per-source discovery pre-pass).
import leadership_2_1_a from "./modules/leadership_2_1_a.js";
import standards_2_1_b from "./modules/standards_2_1_b.js";
import aiDisclosure_2_2_e from "./modules/aiDisclosure_2_2_e.js";
import funding_2_4_b from "./modules/funding_2_4_b.js";
import correctionsPresence from "./modules/correctionsPresence.js";
// B.6.2b-4 — byline page cross-check. MUST be ordered AFTER bylines_2_1_c: it
// reads the cached "2.1.c" row and resolves it in place when it's RSS-gap pending.
import bylineCrossCheck_2_1_c from "./modules/bylineCrossCheck_2_1_c.js";
// B.6.2c-2 — ownership via Wikidata structured lookup (needsDiscovery false).
import ownership_2_4_a from "./modules/ownership_2_4_a.js";
// B.6.2d — primary-document link ratio (samples article pages; needsDiscovery false).
import primaryLinks_2_2_b from "./modules/primaryLinks_2_2_b.js";
// B.6.3b — LLM judgment-on-presence. Each reads a deterministic feeder row and
// applies the honest-confidence harness. MUST be ordered AFTER their feeders:
// 2.1.d reads "corrections-presence"; 2.4.b-judgment upgrades "2.4.b" in place.
import functioningCorrections_2_1_d from "./modules/functioningCorrections_2_1_d.js";
import fundingMixJudgment_2_4_b from "./modules/fundingMixJudgment_2_4_b.js";

export const EVIDENCE_MODULES = Object.freeze([
  bylines_2_1_c,            // 2.1.c — ET  (own-DB; may leave pending on RSS gap)
  sustainedCoverage_2_3_c,  // 2.3.c — DE  (own-DB)
  leadership_2_1_a,         // 2.1.a — ET  (scrape: leadership page)
  standards_2_1_b,          // 2.1.b — ET  (scrape: standards/ethics page)
  aiDisclosure_2_2_e,       // 2.2.e — MT  (scrape: AI-disclosure page)
  funding_2_4_b,            // 2.4.b — Ind (scrape: funding page — presence)
  correctionsPresence,      // corrections-presence — feeds 2.1.d/2.5.b/2.5.e
  bylineCrossCheck_2_1_c,   // resolves "2.1.c" pending via article-page fetches (after bylines_2_1_c)
  ownership_2_4_a,          // 2.4.a — Ind (Wikidata ownership / owner-convergence)
  primaryLinks_2_2_b,       // 2.2.b — MT  (primary-document link ratio; samples article pages)
  functioningCorrections_2_1_d, // 2.1.d — ET  (LLM judgment; reads corrections-presence feeder)
  fundingMixJudgment_2_4_b,     // 2.4.b — Ind (LLM judgment; UPGRADES "2.4.b" in place, after funding_2_4_b)
]);

export function getModule(id) {
  return EVIDENCE_MODULES.find((m) => m.id === id) ?? null;
}
