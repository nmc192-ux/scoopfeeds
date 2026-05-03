/**
 * /scoop-ops/ri-ops — Reality Index operator diagnostics.
 *
 * Routes (all gated by ADMIN_KEY in prod via the `?key=` query param,
 * matching the existing /scoop-ops/* convention):
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
import { listBriefs, getBriefById, setBriefStatus } from "../realityIndex/dal/briefsDao.js";
import { runAnalystBriefCycle } from "../realityIndex/generation/analystBriefGenerator.js";
import { logger } from "../services/logger.js";

const router = Router();
const ADMIN_KEY = process.env.ADMIN_KEY || "";

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return next();           // dev mode: open
  if (req.query.key === ADMIN_KEY) return next();
  return res.status(404).json({ ok: false, error: "not found" });
}

router.get("/provider", requireAdmin, (_req, res) => {
  const s = getQueueStatus();
  res.json({
    ok:      true,
    summary: `LLM=${s.provider} (${s.genModel}) · Embed=${s.embedProvider} (${s.embedModel}) · Premium=${s.premiumProvider} (${s.premiumModel})`,
    ...s,
  });
});

router.get("/dashboard", requireAdmin, (_req, res) => {
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

router.get("/briefs", requireAdmin, (req, res) => {
  const status = req.query.status ?? "draft";
  const items  = listBriefs({ status, limit: 50 }).map(b => {
    let evidence = [];
    try { evidence = JSON.parse(b.evidence_json || "[]"); } catch {}
    return { ...b, evidence };
  });
  res.json({ items, status });
});

router.post("/briefs/:id/approve", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b  = getBriefById(id);
  if (!b) return res.status(404).json({ ok: false, error: "Brief not found" });
  if (b.status === "published") return res.json({ ok: true, alreadyPublished: true });
  const note = req.body?.note || req.query.note || null;
  setBriefStatus(id, "published", { reviewer_note: note });
  res.json({ ok: true, status: "published" });
});

router.post("/briefs/:id/reject", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b  = getBriefById(id);
  if (!b) return res.status(404).json({ ok: false, error: "Brief not found" });
  const note = req.body?.note || req.query.note || null;
  setBriefStatus(id, "rejected", { reviewer_note: note });
  res.json({ ok: true, status: "rejected" });
});

// On-demand generation for a one-off run (also fires on cron).
router.post("/briefs/run", requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit ?? req.body?.limit ?? "2", 10);
    const out = await runAnalystBriefCycle({ limit });
    res.json({ ok: true, ...out });
  } catch (err) {
    logger.error(`brief generation failed: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function safeCount(db, sql) {
  try { return db.prepare(sql).get().n; } catch { return null; }
}
function safeJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

export default router;
