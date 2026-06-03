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

export const EVIDENCE_MODULES = Object.freeze([
  bylines_2_1_c,          // 2.1.c — ET  (own-DB)
  sustainedCoverage_2_3_c, // 2.3.c — DE  (own-DB)
  leadership_2_1_a,        // 2.1.a — ET  (scrape: leadership page)
  standards_2_1_b,         // 2.1.b — ET  (scrape: standards/ethics page)
  aiDisclosure_2_2_e,      // 2.2.e — MT  (scrape: AI-disclosure page)
  funding_2_4_b,           // 2.4.b — Ind (scrape: funding page)
  correctionsPresence,     // corrections-presence — feeds 2.1.d/2.5.b/2.5.e
]);

export function getModule(id) {
  return EVIDENCE_MODULES.find((m) => m.id === id) ?? null;
}
