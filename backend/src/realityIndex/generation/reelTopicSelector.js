/**
 * reelTopicSelector — RI-aware ranker for the reels/Shorts pipeline.
 *
 * Wraps the existing findArticlesForVideoQueue() candidate pool and re-ranks
 * by Reality Index signals so we publish reels about stories that are
 * actually moving — not just whatever happens to be high-credibility.
 *
 * Score components (additive, capped):
 *   base       — article.credibility / 10                    (0..1.0)
 *   bound      — +0.30 if article belongs to a tracked active event
 *   freshAnom  — +0.40 if event has an unack anomaly in last 6h
 *                       (odds_shift weighted highest)
 *   truthGap   — +0.25 × min(1, |truth_gap|)
 *   composite  — +0.10 × |reality_score - 0.5| × 2           (extreme = high)
 *
 * Usage from scheduler.runVideoGenCycle:
 *   if (REEL_USE_RI_SELECTOR) toRender = pickTopReelCandidates({ limit })
 *   else toRender = findArticlesForVideoQueue({ ... })
 *
 * Falls back to the underlying selector when no RI snapshots exist yet.
 */

import { getDb } from "../../models/database.js";
import { findArticlesForVideoQueue } from "../../models/database.js";
import { logger } from "../../services/logger.js";

const POOL_MULT = 4;                    // pull 4× the requested limit, then re-rank
const ANOM_WINDOW_MS = 6 * 60 * 60 * 1000;
const ANOM_WEIGHTS = { odds_shift: 1.0, truth_gap_spike: 0.8, viral_no_react: 0.6, sentiment_flip: 0.5 };

function eventForArticle(db, articleId) {
  return db.prepare(`
    SELECT e.id, e.slug, e.severity, e.status,
      (SELECT r.reality_score FROM reality_index_snapshots r
       WHERE r.scope='event' AND r.scope_id=e.id ORDER BY ts DESC LIMIT 1) AS reality_score,
      (SELECT r.truth_gap     FROM reality_index_snapshots r
       WHERE r.scope='event' AND r.scope_id=e.id ORDER BY ts DESC LIMIT 1) AS truth_gap,
      (SELECT r.confidence    FROM reality_index_snapshots r
       WHERE r.scope='event' AND r.scope_id=e.id ORDER BY ts DESC LIMIT 1) AS confidence
    FROM event_articles ea
    JOIN events e ON e.id = ea.event_id
    WHERE ea.article_id = ? AND e.status = 'active'
    ORDER BY e.last_activity_at DESC LIMIT 1
  `).get(String(articleId));
}

function freshAnomalyForEvent(db, eventId, sinceMs) {
  return db.prepare(`
    SELECT type, severity FROM anomaly_alerts
    WHERE event_id = ? AND detected_at >= ?
    ORDER BY detected_at DESC LIMIT 1
  `).get(eventId, sinceMs);
}

function scoreCandidate(article, ev, anom) {
  const cred = (article.credibility ?? 5) / 10;
  let score = Math.max(0, Math.min(1, cred));
  const reasons = [];

  if (ev) {
    score += 0.30;
    reasons.push("event-bound");

    if (Number.isFinite(ev.truth_gap)) {
      const tg = Math.min(1, Math.abs(ev.truth_gap)) * 0.25;
      if (tg > 0) { score += tg; reasons.push(`truth-gap+${tg.toFixed(2)}`); }
    }
    if (Number.isFinite(ev.reality_score)) {
      // Boost extremes (events priced very-likely or very-unlikely make
      // for more compelling 30-second video framing than 50-50 toss-ups).
      const extreme = Math.abs(ev.reality_score - 0.5) * 2;
      const compBonus = extreme * 0.10;
      if (compBonus > 0) { score += compBonus; reasons.push(`composite-extreme+${compBonus.toFixed(2)}`); }
    }
  }

  if (anom) {
    const w = ANOM_WEIGHTS[anom.type] ?? 0.5;
    const bonus = 0.40 * w;
    score += bonus;
    reasons.push(`anomaly:${anom.type}+${bonus.toFixed(2)}`);
  }

  return { score: Math.min(2.0, score), reasons };
}

/**
 * Returns up to `limit` articles ranked by reel-score. Same row shape as
 * findArticlesForVideoQueue so the cron caller is interchangeable.
 *
 * Each row gets `_reel_score` and `_reel_reasons` attached for telemetry —
 * the renderer ignores extra fields.
 */
export function pickTopReelCandidates({ limit = 3, minCredibility = 7, withinMs = 24 * 60 * 60 * 1000 } = {}) {
  const pool = findArticlesForVideoQueue({ minCredibility, withinMs, limit: limit * POOL_MULT });
  if (!pool.length) return [];

  const db = getDb();
  const since = Date.now() - ANOM_WINDOW_MS;

  const scored = pool.map(a => {
    const ev   = eventForArticle(db, a.id);
    const anom = ev ? freshAnomalyForEvent(db, ev.id, since) : null;
    const { score, reasons } = scoreCandidate(a, ev, anom);
    return { ...a, _reel_score: score, _reel_reasons: reasons };
  });

  scored.sort((x, y) => y._reel_score - x._reel_score);
  const picked = scored.slice(0, limit);

  if (picked.length) {
    const top = picked[0];
    logger.info(
      `🎬 reelTopicSelector: pool=${pool.length} → picked ${picked.length} ` +
      `(top score=${top._reel_score.toFixed(2)} via ${top._reel_reasons.join("+") || "base"})`
    );
  }

  return picked;
}
