/**
 * storyAffinity — THE story-similarity judgment (Sprint 2, Wave 2).
 *
 * Before this module, three judges asked three different questions:
 *   qualifies()  compared a cluster's full entity set vs an event's CORE
 *                (hub filter OFF — MAX_CATSPAN default was 999 here);
 *   tryMerge()   compared core vs core (hubs also in);
 *   eventBreaker compared full set vs full set (hub filter ON at cat_span 5).
 * Accept-at-0.05 and split-at-0.06 on DIFFERENT quantities meant one pair
 * could be simultaneously matchable, mergeable, and splittable — the
 * create-then-merge-then-split treadmill that minted 174 slugs for one
 * story (2026-07-16 GROUND + 🧭 replay evidence).
 *
 * The contract now:
 *   - ONE measure: idf-weighted overlap of the TOPK rarest entity keys,
 *     built IDENTICALLY for both sides (symmetric set-vs-set), hub filter
 *     ON everywhere (cat_span ≤ MAX_CATSPAN, single default).
 *   - ORDERED bands with hysteresis (T_DISJOINT < T_MATCH):
 *       AFFINE    (ent ≥ T_MATCH)    — promoter may attach; merge may fire
 *       AMBIGUOUS (in between)       — every judge HOLDS current state
 *       FOREIGN   (ent < T_DISJOINT) — breaker may split; merge forbidden
 *     Because the bands are ordered on one measure, no pair can be accepted
 *     by one judge and dismembered by another. The armistice is structural.
 *   - Coherence is an explicit per-EVENT contract, not a measure asymmetry:
 *     an ESTABLISHED event whose hub-filtered core is degenerate is flagged
 *     incoherent — it cannot attract new clusters and is breaker-priority.
 *     NEWBORN events are exempt (R1): a 1-2 cluster young event has a
 *     legitimately thin core; strangling it would rebuild under-merge churn
 *     through the anti-blob door.
 *
 * Thresholds are calibrated on the 2026-07-16 COW against labeled pairs
 * (see _s2_affinity_calibrate.mjs and the Wave-2 ship gate table).
 */

import { logger } from "../../services/logger.js";

// ── Constants (single source; env-overridable) ────────────────────────────
// (EVENT_UNIFIED_AFFINITY retired 2026-07-20 — this is the only measure now; the promoter
//  and breaker legacy paths that the flag gated have been deleted.)

// Calibrated on the 2026-07-16 COW labeled-pair table (ship gate, R3).
export const T_MATCH    = Number.parseFloat(process.env.AFFINITY_T_MATCH    || "0.23");
export const T_DISJOINT = Number.parseFloat(process.env.AFFINITY_T_DISJOINT || "0.19");

// ONE default everywhere (the promoter/breaker previously disagreed: 999 vs 5).
export const MAX_CATSPAN = parseInt(process.env.EVENT_ENTITY_MAX_CATSPAN || "3", 10);
export const TOPK        = parseInt(process.env.EVENT_ENTITY_TOPK || "40", 10);
export const CORE_FRAC   = Number.parseFloat(process.env.EVENT_ENTITY_CORE_FRAC || "0.3");

// Coherence contract (R1: size/age-aware).
export const MIN_CORE_KEYS     = parseInt(process.env.AFFINITY_MIN_CORE_KEYS || "2", 10);
export const MIN_CORE_IDF      = Number.parseFloat(process.env.AFFINITY_MIN_CORE_IDF || "4");
export const NEWBORN_MAX_MEMBERS = parseInt(process.env.AFFINITY_NEWBORN_MAX_MEMBERS || "8", 10);
export const NEWBORN_MAX_AGE_MS  = Number.parseInt(process.env.AFFINITY_NEWBORN_MAX_AGE_MS || String(24 * 60 * 60 * 1000), 10);

export const BANDS = { AFFINE: "AFFINE", AMBIGUOUS: "AMBIGUOUS", FOREIGN: "FOREIGN" };

// ── Context: idf / cat_span maps + set builders (one query shape for all) ──
export function buildAffinityCtx(db) {
  const idfMap = new Map(), catSpanMap = new Map();
  for (const r of db.prepare("SELECT key, idf, cat_span FROM entity_idf").all()) {
    idfMap.set(r.key, r.idf); catSpanMap.set(r.key, r.cat_span);
  }
  const nw = db.prepare("SELECT n_window FROM entity_idf LIMIT 1").get()?.n_window;
  const fallbackIdf = (idfMap.size && nw) ? Math.log(nw) : 1;

  /** TOPK rarest hub-filtered entity keys for a set of article ids. */
  const entitySet = (ids) => {
    if (!ids?.length) return new Set();
    const keys = new Set();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const ph = chunk.map(() => "?").join(",");
      for (const r of db.prepare(`SELECT DISTINCT COALESCE(qid, surface_norm) k FROM article_entities WHERE article_id IN (${ph})`).all(...chunk)) {
        if ((catSpanMap.get(r.k) ?? 1) > MAX_CATSPAN) continue;
        keys.add(r.k);
      }
    }
    if (keys.size <= TOPK) return keys;
    return new Set([...keys].sort((a, b) => (idfMap.get(b) ?? 0) - (idfMap.get(a) ?? 0)).slice(0, TOPK));
  };

  /** Hub-filtered CORE (keys in ≥ CORE_FRAC of members) — coherence contract only. */
  const coreSet = (ids) => {
    if (!ids?.length) return new Set();
    const n = ids.length, count = new Map();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const ph = chunk.map(() => "?").join(",");
      for (const r of db.prepare(`SELECT DISTINCT article_id, COALESCE(qid, surface_norm) k FROM article_entities WHERE article_id IN (${ph})`).all(...chunk)) {
        if ((catSpanMap.get(r.k) ?? 1) > MAX_CATSPAN) continue;
        count.set(r.k, (count.get(r.k) || 0) + 1);
      }
    }
    let core = [...count.entries()].filter(([, c]) => c / n >= CORE_FRAC).map(([k]) => k);
    if (core.length > TOPK) core = core.sort((a, b) => (idfMap.get(b) ?? 0) - (idfMap.get(a) ?? 0)).slice(0, TOPK);
    return new Set(core);
  };

  // CONTAINMENT (intersection idf-mass / smaller side's mass), not union-
  // Jaccard: calibration on the 2026-07-16 COW showed union-Jaccard punishes
  // the newborn-vs-established size asymmetry (R1's exact case scored 0.058,
  // EQUAL to the worst foreign pair); containment separates them 0.248 vs
  // 0.180 at cat_span<=3. See _s2_affinity_calibrate.mjs + the ship gate table.
  const weightedOverlap = (A, B) => {
    if (!A?.size || !B?.size) return 0;
    let inter = 0, mA = 0, mB = 0;
    const w = (k) => idfMap.get(k) ?? fallbackIdf;
    for (const k of A) { mA += w(k); if (B.has(k)) inter += w(k); }
    for (const k of B) mB += w(k);
    const denom = Math.min(mA, mB);
    return denom ? inter / denom : 0;
  };

  return { idfMap, catSpanMap, fallbackIdf, entitySet, coreSet, weightedOverlap };
}

// ── The judgment ───────────────────────────────────────────────────────────
/**
 * ent-overlap + band for two pre-built entity sets. Pure — callers build
 * sets once per cluster/event per cycle and reuse.
 */
export function affinity(ctx, setA, setB) {
  const ent = ctx.weightedOverlap(setA, setB);
  const band = ent >= T_MATCH ? BANDS.AFFINE : ent < T_DISJOINT ? BANDS.FOREIGN : BANDS.AMBIGUOUS;
  return { ent, band };
}

/**
 * Coherence contract (R1). Established + degenerate core → incoherent:
 * may not ATTRACT (qualifies treats as non-target), is breaker-priority.
 * Newborns (few members or young) are exempt.
 */
export function isIncoherent(ctx, { memberIds, core, startedAt, now = Date.now() }) {
  if ((memberIds?.length ?? 0) <= NEWBORN_MAX_MEMBERS) return false;
  if (startedAt && now - startedAt <= NEWBORN_MAX_AGE_MS) return false;
  const c = core ?? ctx.coreSet(memberIds);
  if (c.size < MIN_CORE_KEYS) return true;
  let mass = 0;
  for (const k of c) mass += ctx.idfMap.get(k) ?? ctx.fallbackIdf;
  return mass < MIN_CORE_IDF;
}

// ── R2: the live instrument — every decision logs band + scores ───────────
export function logDecision(kind, payload) {
  logger.info(`🧭 ${kind} ${JSON.stringify(payload)}`);
}
