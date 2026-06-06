/**
 * runner.js — runs registered evidence modules for a source (or all sources)
 * and upserts results into scoring_evidence_cache, TTL-aware.
 *
 * For each module: if a fresh cached row exists (younger than the module's
 * ttlDays) and `force` is not set, skip the gather and reuse the cache;
 * otherwise run gather(), validate the shape, and upsert.
 *
 * Resilience (rssFetcher precedent): a single module throwing never halts the
 * batch — it is recorded as `blocked` evidence and the run proceeds.
 *
 * ★ EVIDENCE-ONLY INVARIANT ★ — this runner writes ONLY to
 * scoring_evidence_cache. It never touches sources.quality_score. B.6.2
 * produces evidence; the headline score waits for B.6.3 (all components).
 *
 * NOT wired to a cron here — that's B.6.4 (runtime). This module exposes
 * invocable functions; the weekly schedule attaches to them later.
 */

import { getDb } from "../../../models/database.js";
import { RUBRIC } from "../rubric.js";
import { EVIDENCE_MODULES } from "./registry.js";
import { getEvidence, upsertEvidence, isStale } from "./evidenceCache.js";
import { assertEvidenceShape, EVIDENCE_STATUS, DEFAULT_SAMPLE_SIZE } from "./contract.js";
import { discoverSite } from "./pageDiscovery.js";
import { fetchArticleBodies } from "./llm/articleBodyPrepass.js";

/**
 * gatherForSource — run the registered modules for one source.
 *
 * @param {{id:number, name:string}} source
 * @param {object} [opts]
 * @param {Array}  [opts.modules]            default: all registered modules
 * @param {object} [opts.db]                 default: shared getDb()
 * @param {number} [opts.now]                default: Date.now()
 * @param {number} [opts.sampleSize]         default: 20 (spec §3.1)
 * @param {string} [opts.methodologyVersion] default: RUBRIC.methodology_version
 * @param {boolean}[opts.force]              re-gather even if cache is fresh
 * @returns {Promise<Array<{id,status,fromCache,confidence}>>}
 */
export async function gatherForSource(source, {
  modules = EVIDENCE_MODULES,
  db = getDb(),
  now = Date.now(),
  sampleSize = DEFAULT_SAMPLE_SIZE,
  methodologyVersion = RUBRIC.methodology_version,
  force = false,
  structureBudget = 7,        // per-source homepage+convention budget for scrape detectors (leaves ≤5 for B.6.2b-4 byline)
  maxConventionAttempts = 3,  // convention-path guesses per scrape detector
  transport,                  // optional fetch transport (tests inject; prod uses default axios)
  timeoutMs,                  // optional per-fetch timeout override
} = {}) {
  const ctx = { db, now, sampleSize, methodologyVersion, maxConventionAttempts, transport, timeoutMs };
  const results = [];

  // ── Discovery pre-pass (B.6.2b-2b) ──────────────────────────────────────────
  // Scrape-presence detectors (needsDiscovery) share ONE homepage discovery per
  // source. Run it once iff ≥1 scrape detector is stale (else skip entirely →
  // zero fetches, the politeness win). Own-DB modules ignore ctx.discovery.
  const scrapeModules = modules.filter((m) => m.needsDiscovery);
  const anyScrapeStale = scrapeModules.some((m) => force || isStale(getEvidence(source.id, m.id, db), m.ttlDays, now));
  ctx.discovery = null;
  if (scrapeModules.length > 0 && anyScrapeStale) {
    // discoverSite → openSite uses ctx; cap the structure budget here so a
    // later byline pass keeps its share of the shared per-source budget.
    ctx.discovery = await discoverSite(source, { ...ctx, maxFetchesPerSource: structureBudget });
  }

  // ── Article-body pre-pass (B.6.3c) ──────────────────────────────────────────
  // Article-text judgments (needsArticleBodies) share ONE ≤5-body fetch per source.
  // Run it once iff ≥1 such judgment is stale (else skip → zero body fetches).
  // Modules READ ctx.articleBodies; they never fetch bodies themselves. SCOPE: this
  // pre-pass is B.6.3c-only — byline/primaryLinks keep their own sampling for now.
  const bodyModules = modules.filter((m) => m.needsArticleBodies);
  const anyBodyStale = bodyModules.some((m) => force || isStale(getEvidence(source.id, m.id, db), m.ttlDays, now));
  ctx.articleBodies = null;
  if (bodyModules.length > 0 && anyBodyStale) {
    ctx.articleBodies = await fetchArticleBodies(source, ctx, { limit: 5 });
  }

  for (const mod of modules) {
    const cached = getEvidence(source.id, mod.id, db);
    if (!force && !isStale(cached, mod.ttlDays, now)) {
      results.push({ id: mod.id, status: cached.status, confidence: cached.confidence, fromCache: true });
      continue;
    }

    let ev;
    try {
      ev = await mod.gather(source, ctx);
      // A module may return null/undefined as a NO-OP sentinel (it did nothing
      // this run, or it resolved another sub_criterion's row directly — e.g. the
      // 2.1.c byline cross-check upserts "2.1.c" itself). Don't record/upsert.
      if (ev == null) {
        results.push({ id: mod.id, status: "noop", confidence: null, fromCache: false, noop: true });
        continue;
      }
      assertEvidenceShape(ev, mod.id);
    } catch (err) {
      // Failure isolation: record as blocked, keep the batch moving.
      ev = {
        status: EVIDENCE_STATUS.BLOCKED,
        value: { error: String(err && err.message ? err.message : err) },
        confidence: 0,
        evidenceUrl: null,
        gatheredAt: now,
      };
    }

    upsertEvidence(source.id, mod.id, ev, methodologyVersion, db);
    results.push({ id: mod.id, status: ev.status, confidence: ev.confidence, fromCache: false });
  }

  return results;
}

/**
 * gatherForAllSources — run modules across many sources, sequentially.
 * (Sequential keeps own-DB load trivial; B.6.2b's fetching modules will add
 * bounded concurrency at that layer per the rssFetcher batch precedent.)
 */
export async function gatherForAllSources(sources, opts = {}) {
  const out = [];
  for (const source of sources) {
    const results = await gatherForSource(source, opts);
    out.push({ source_id: source.id, name: source.name, results });
  }
  return out;
}
