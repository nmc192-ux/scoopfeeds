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

export const EVIDENCE_MODULES = Object.freeze([
  bylines_2_1_c,          // 2.1.c — ET  (own-DB)
  sustainedCoverage_2_3_c, // 2.3.c — DE  (own-DB)
]);

export function getModule(id) {
  return EVIDENCE_MODULES.find((m) => m.id === id) ?? null;
}
