/**
 * calibration_v1.js — the 15-source v1.0 calibration ground-truth, used as
 * test fixtures for the combination validation harness (B.6.1).
 *
 * Source: docs/audits/phase_a_source_audit_phase2_calibration.md §2 (the
 * per-source tables) + §1.2 (weights/floor). Each row is the published
 * component vector (ET, MT, DE, Ind, HA) and the documented combined score.
 * The service must reproduce `combined` within ±5 (scoring spec §8.1 gate).
 *
 * These are TEST FIXTURES transcribed verbatim from the committed audit doc —
 * not a second source of truth. coherence.test.js binds the rubric weights to
 * that same doc so the two stay in sync.
 */

export const TOLERANCE = 5;

export const CALIBRATION_V1_SOURCES = Object.freeze([
  // §2.1 Government posture (5)
  { n: 1,  name: "BBC News",          posture: "Government",       c: { ET: 87, MT: 82, DE: 88, Ind: 82, HA: 80 }, combined: 84 },
  { n: 2,  name: "NPR News",          posture: "Government",       c: { ET: 84, MT: 80, DE: 82, Ind: 78, HA: 76 }, combined: 80 },
  { n: 3,  name: "France 24",         posture: "Government",       c: { ET: 78, MT: 73, DE: 78, Ind: 72, HA: 73 }, combined: 75 },
  { n: 4,  name: "DW English",        posture: "Government",       c: { ET: 80, MT: 75, DE: 80, Ind: 75, HA: 74 }, combined: 77 },
  { n: 5,  name: "NASA News",         posture: "Government",       c: { ET: 78, MT: 88, DE: 92, Ind: 80, HA: 87 }, combined: 84 },

  // §2.2 Corporate-owned high-tier (2)
  { n: 6,  name: "The Atlantic",      posture: "Corporate-owned",  c: { ET: 86, MT: 83, DE: 85, Ind: 82, HA: 82 }, combined: 84 },
  { n: 10, name: "Bloomberg Markets", posture: "Corporate-owned",  c: { ET: 90, MT: 88, DE: 92, Ind: 78, HA: 85 }, combined: 86 },

  // §2.3 Corporate-owned mid-tier (2)
  { n: 7,  name: "Politico",          posture: "Corporate-owned",  c: { ET: 80, MT: 74, DE: 84, Ind: 76, HA: 76 }, combined: 78 },
  { n: 11, name: "CNBC",              posture: "Corporate-owned",  c: { ET: 75, MT: 72, DE: 80, Ind: 72, HA: 72 }, combined: 74 },

  // §2.4 Corporate-owned specialty / lower-tier (2)
  { n: 8,  name: "CoinDesk",          posture: "Corporate-owned",  c: { ET: 70, MT: 65, DE: 78, Ind: 55, HA: 65 }, combined: 66 },
  { n: 9,  name: "Psychology Today",  posture: "Corporate-owned",  c: { ET: 60, MT: 50, DE: 70, Ind: 65, HA: 55 }, combined: 60 },

  // §2.5 Aggregator (1)
  { n: 12, name: "Hacker News",       posture: "Aggregator",       c: { ET: 35, MT: 40, DE: 65, Ind: 55, HA: 50 }, combined: 48 },

  // §2.6 Pakistani Corporate-owned (home-region validation subset, 3)
  { n: 13, name: "Dawn News",         posture: "Corporate-owned",  c: { ET: 80, MT: 75, DE: 85, Ind: 80, HA: 78 }, combined: 80 },
  { n: 14, name: "Geo News",          posture: "Corporate-owned",  c: { ET: 60, MT: 60, DE: 72, Ind: 65, HA: 65 }, combined: 64 },
  { n: 15, name: "The News International", posture: "Corporate-owned", c: { ET: 72, MT: 68, DE: 72, Ind: 68, HA: 68 }, combined: 70 },
]);
