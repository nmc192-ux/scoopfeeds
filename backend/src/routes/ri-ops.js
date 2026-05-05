/**
 * /scoop-ops/ri-ops — Reality Index operator diagnostics.
 *
 * Routes are protected by the global /scoop-ops/* admin auth boundary
 * (adminAuth + adminAuditLogger) mounted in backend/server.js. Bearer
 * token auth via Authorization header; ADMIN_BEARER_TOKEN env var.
 *
 *   GET /scoop-ops/ri-ops/provider    — live LLM/embed provider + RPM
 *   GET /scoop-ops/ri-ops/dashboard   — single JSON snapshot of the entire
 *                                       Reality Index pipeline: scheduler
 *                                       cycles, table counts, recent
 *                                       activity, top events, top movers.
 *                                       One curl, zero grep.
 *
 * The dashboard endpoint is read-only and uses only existing DAL queries —
 * safe to hit on prod. Designed for a thin HTML page (the consumer is
 * /scoop-ops/reality-index in the SPA, but this endpoint is also useful
 * as a raw probe).
 */

import { Router } from "express";
import { getDb } from "../models/database.js";
import { getQueueStatus } from "../realityIndex/llmQueue.js";
import { getSchedulerStatus } from "../services/scheduler.js";
import {
  listBriefs, getBriefById, setBriefStatus,
  getBriefApprovalRates, getOverallApprovalRate,
} from "../realityIndex/dal/briefsDao.js";
import { runAnalystBriefCycle } from "../realityIndex/generation/analystBriefGenerator.js";
import { createMarket as createSyntheticMarket, getMarket as getSyntheticMarket } from "../realityIndex/dal/syntheticMarketsDao.js";
import { resolveMarket as resolveSyntheticMarket } from "../realityIndex/syntheticMarkets/resolver.js";
import { runQuestionExtractor } from "../realityIndex/syntheticMarkets/questionExtractor.js";
import { runOutcomeResolverCycle } from "../realityIndex/syntheticMarkets/outcomeResolver.js";
import { createApiKey, listApiKeys, revokeApiKey } from "../realityIndex/dal/apiKeysDao.js";
import { logger } from "../services/logger.js";

const router = Router();

// Admin auth is enforced upstream by the global mount at server.js:206
// (app.use("/scoop-ops", adminAuth, adminAuditLogger)). Routes here MUST
// be mounted only under /scoop-ops to inherit this protection.

router.get("/provider", (_req, res) => {
  const s = getQueueStatus();
  res.json({
    ok:      true,
    summary: `LLM=${s.provider} (${s.genModel}) · Embed=${s.embedProvider} (${s.embedModel}) · Premium=${s.premiumProvider} (${s.premiumModel})`,
    ...s,
  });
});

router.get("/dashboard", (_req, res) => {
  try {
    const db   = getDb();
    const now  = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    // Table counts — at-a-glance pipeline health.
    const counts = {
      articles_total:         db.prepare("SELECT COUNT(*) AS n FROM articles").get().n,
      articles_24h:           db.prepare("SELECT COUNT(*) AS n FROM articles WHERE published_at >= ?").get(dayAgo).n,
      story_clusters:         db.prepare("SELECT COUNT(*) AS n FROM story_clusters").get().n,
      events_active:          db.prepare("SELECT COUNT(*) AS n FROM events WHERE status='active'").get().n,
      events_dormant:         db.prepare("SELECT COUNT(*) AS n FROM events WHERE status='dormant'").get().n,
      markets_active:         db.prepare("SELECT COUNT(*) AS n FROM prediction_markets WHERE active=1").get().n,
      cluster_market_links:   db.prepare("SELECT COUNT(*) AS n FROM cluster_market_links").get().n,
      event_market_links:     db.prepare("SELECT COUNT(*) AS n FROM event_market_links").get().n,
      ri_snapshots_24h:       db.prepare("SELECT COUNT(*) AS n FROM reality_index_snapshots WHERE ts >= ?").get(dayAgo).n,
      sentiment_snapshots_24h: db.prepare("SELECT COUNT(*) AS n FROM sentiment_snapshots WHERE ts >= ?").get(dayAgo).n,
      anomalies_24h:          db.prepare("SELECT COUNT(*) AS n FROM anomaly_alerts WHERE detected_at >= ?").get(dayAgo).n,
      anomalies_unack:        db.prepare("SELECT COUNT(*) AS n FROM anomaly_alerts WHERE acknowledged=0").get().n,
      embeddings_total:       safeCount(db, "SELECT COUNT(*) AS n FROM embedding_meta"),
      watchlists:             db.prepare("SELECT COUNT(*) AS n FROM user_watchlists").get().n,
      pushed_anomalies_24h:   db.prepare("SELECT COUNT(*) AS n FROM pushed_anomalies WHERE pushed_at >= ?").get(dayAgo).n,
    };

    // Top 5 events by activity (most recent + most articles).
    const topEvents = db.prepare(`
      SELECT e.slug, e.title, e.category, e.severity, e.last_activity_at,
        (SELECT COUNT(*) FROM event_articles ea WHERE ea.event_id = e.id) AS articles,
        (SELECT COUNT(*) FROM event_market_links eml WHERE eml.event_id = e.id) AS markets,
        (SELECT r.reality_score FROM reality_index_snapshots r
          WHERE r.scope='event' AND r.scope_id = e.id ORDER BY r.ts DESC LIMIT 1) AS reality_score,
        (SELECT r.truth_gap FROM reality_index_snapshots r
          WHERE r.scope='event' AND r.scope_id = e.id ORDER BY r.ts DESC LIMIT 1) AS truth_gap
      FROM events e
      WHERE e.status='active'
      ORDER BY e.last_activity_at DESC
      LIMIT 5
    `).all();

    // Top 5 markets by 24h volume.
    const topMarkets = db.prepare(`
      SELECT id, source, question, yes_price, volume_24h, liquidity, end_date
      FROM prediction_markets
      WHERE active=1 AND yes_price IS NOT NULL
      ORDER BY volume_24h DESC
      LIMIT 5
    `).all();

    // 5 most-recent anomalies — what's actually firing.
    const recentAnomalies = db.prepare(`
      SELECT a.id, a.type, a.severity, a.detected_at, a.payload,
             e.slug AS event_slug, e.title AS event_title
      FROM anomaly_alerts a
      LEFT JOIN events e ON e.id = a.event_id
      ORDER BY a.detected_at DESC
      LIMIT 5
    `).all().map(a => ({ ...a, payload: safeJson(a.payload) }));

    res.json({
      ok:        true,
      now,
      counts,
      provider:  getQueueStatus(),
      scheduler: getSchedulerStatus(),
      topEvents,
      topMarkets,
      recentAnomalies,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Brief review queue ────────────────────────────────────────────────────
//
// All brief-mutation routes are admin-gated. v1 invariant: drafts can only
// move to 'published' via this manual approval — no auto-promotion path
// exists in the generator (plan §5J).

router.get("/briefs", (req, res) => {
  const status = req.query.status ?? "draft";
  const items  = listBriefs({ status, limit: 50 }).map(b => {
    let evidence = [];
    try { evidence = JSON.parse(b.evidence_json || "[]"); } catch {}
    return { ...b, evidence };
  });
  res.json({ items, status });
});

router.post("/briefs/:id/approve", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b  = getBriefById(id);
  if (!b) return res.status(404).json({ ok: false, error: "Brief not found" });
  if (b.status === "published") return res.json({ ok: true, alreadyPublished: true });
  const note = req.body?.note || req.query.note || null;
  setBriefStatus(id, "published", { reviewer_note: note });
  res.json({ ok: true, status: "published" });
});

router.post("/briefs/:id/reject", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b  = getBriefById(id);
  if (!b) return res.status(404).json({ ok: false, error: "Brief not found" });
  const note = req.body?.note || req.query.note || null;
  setBriefStatus(id, "rejected", { reviewer_note: note });
  res.json({ ok: true, status: "rejected" });
});

// On-demand generation for a one-off run (also fires on cron).
router.post("/briefs/run", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit ?? req.body?.limit ?? "2", 10);
    const out = await runAnalystBriefCycle({ limit });
    res.json({ ok: true, ...out });
  } catch (err) {
    logger.error(`brief generation failed: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Per-category approval rate over the last N days. Foundation for the
// Phase 7 self-improvement loop (plan §5J #5): once a category clears the
// 100-decided / ≥0.7-rate bar we'll consider auto-publication for high
// confidence drafts in that bucket. Today this endpoint is purely
// observational — used by /scoop-ops/reality-index to show calibration.
router.get("/briefs/approval-rates", (req, res) => {
  try {
    const days = Math.max(1, Math.min(parseInt(req.query.days ?? "90", 10), 365));
    const overall    = getOverallApprovalRate({ daysBack: days });
    const byCategory = getBriefApprovalRates({ daysBack: days });
    res.json({ ok: true, days_back: days, overall, by_category: byCategory });
  } catch (err) {
    logger.error(`brief approval rates failed: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Synthetic markets (Phase 6) admin ─────────────────────────────────────
//
// Editor creates markets manually (LLM-driven question extraction is Phase 6.5).
// Resolution flips a market to outcome={yes|no|cancel}; payout logic for share
// holders is computed lazily by the leaderboard worker (Phase 6.5).

router.post("/synthetic/create", (req, res) => {
  try {
    const { question, description, cluster_id, event_id, end_date, initial_liquidity } = req.body || {};
    if (!question) return res.status(400).json({ ok: false, error: "question required" });
    const m = createSyntheticMarket({
      question, description, cluster_id, event_id,
      generated_by: "editor",
      end_date: end_date ? Number(end_date) : null,
      initial_liquidity: Number(initial_liquidity) || 100,
    });
    res.json({ ok: true, market: m });
  } catch (err) {
    logger.error(`synthetic create failed: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/synthetic/:id/resolve", (req, res) => {
  try {
    const { outcome } = req.body || {};
    const out = resolveSyntheticMarket({ market_id: req.params.id, outcome });
    res.json({ ok: true, ...out });
  } catch (err) {
    logger.error(`synthetic resolve failed: ${err.message}`);
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/synthetic/extract", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit ?? req.body?.limit ?? "2", 10);
    const out = await runQuestionExtractor({ limit });
    res.json({ ok: true, ...out });
  } catch (err) {
    logger.error(`question extractor failed: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/synthetic/propose-outcomes", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit ?? req.body?.limit ?? "3", 10);
    const out = await runOutcomeResolverCycle({ limit });
    res.json({ ok: true, ...out });
  } catch (err) {
    logger.error(`outcome resolver trigger failed: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Editor view: list synthetic markets with their proposed-outcome metadata
// merged in. Powers /scoop-ops/synthetic admin page.
router.get("/synthetic/queue", (_req, res) => {
  try {
    const rows = getDb().prepare(`
      SELECT id, question, description, event_id, end_date, yes_price,
             total_volume, resolved, outcome, created_at, meta
      FROM synthetic_markets
      ORDER BY resolved ASC, end_date ASC NULLS LAST
      LIMIT 100
    `).all();
    const items = rows.map(r => {
      let meta = null;
      try { meta = r.meta ? JSON.parse(r.meta) : null; } catch { /* ignore */ }
      return {
        ...r, meta,
        proposed_outcome:    meta?.proposed_outcome    ?? null,
        proposed_confidence: meta?.proposed_confidence ?? null,
        proposed_reasoning:  meta?.proposed_reasoning  ?? null,
        proposed_sources:    meta?.proposed_sources    ?? null,
        proposed_at:         meta?.proposed_at         ?? null,
      };
    });
    res.json({ items });
  } catch (err) {
    logger.error(`synthetic queue failed: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Public API key management (Phase 7) ──────────────────────────────────
router.get("/api-keys", (_req, res) => {
  res.json({ items: listApiKeys() });
});

router.post("/api-keys/create", (req, res) => {
  const { owner, tier } = req.body || {};
  if (!owner) return res.status(400).json({ ok: false, error: "owner required" });
  if (tier && !["free", "pro", "enterprise"].includes(tier)) {
    return res.status(400).json({ ok: false, error: "tier must be free|pro|enterprise" });
  }
  const out = createApiKey({ owner, tier: tier || "free" });
  res.json({ ok: true, ...out });
});

router.post("/api-keys/:key/revoke", (req, res) => {
  const removed = revokeApiKey(req.params.key);
  res.json({ ok: true, removed });
});

function safeCount(db, sql) {
  try { return db.prepare(sql).get().n; } catch { return null; }
}
function safeJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

export default router;
