/**
 * anomalyDetector — scans recent reality_index_snapshots and prediction
 * market history for the four anomaly types and writes anomaly_alerts:
 *
 *   odds_shift       — market YES moved >= ANOMALY_ODDS_SHIFT_PP in the window
 *   viral_no_react   — social volume >= 3x baseline but |market delta| < 2pp
 *   sentiment_flip   — per-source polarity flipped sign with intensity > 0.3
 *   truth_gap_spike  — |truth_gap| jumped >= ANOMALY_TG_SPIKE in the window
 *
 * De-dupe is handled inside realityIndexDao.recordAnomaly (within 1h, same
 * target+type, no duplicate).
 */

import { getDb } from "../../models/database.js";
import { recordAnomaly } from "../dal/realityIndexDao.js";
import { previousPolarity } from "../dal/sentimentDao.js";
import { logger } from "../../services/logger.js";

const WINDOW_MS         = 60 * 60 * 1000;                                 // 1h
const ODDS_SHIFT_PP     = parseFloat(process.env.ANOMALY_ODDS_SHIFT_PP || "10") / 100;
const TG_SPIKE          = parseFloat(process.env.ANOMALY_TG_SPIKE     || "0.30");
const VIRAL_RATIO       = parseFloat(process.env.ANOMALY_VIRAL_RATIO  || "3.0");
const SENT_FLIP_MIN     = parseFloat(process.env.ANOMALY_SENT_FLIP_MIN|| "0.30");

// ─── Detector A: odds_shift ────────────────────────────────────────────────
function detectOddsShift(now) {
  const db = getDb();
  // For each market with a snapshot in the window, compare yes_price now vs
  // earliest in window.
  const rows = db.prepare(`
    SELECT s.market_id,
           (SELECT yes_price FROM prediction_market_snapshots
            WHERE market_id = s.market_id AND ts >= ?
            ORDER BY ts ASC LIMIT 1) AS first_yes,
           (SELECT yes_price FROM prediction_market_snapshots
            WHERE market_id = s.market_id
            ORDER BY ts DESC LIMIT 1) AS last_yes,
           m.question, m.yes_price
    FROM (SELECT DISTINCT market_id FROM prediction_market_snapshots WHERE ts >= ?) s
    JOIN prediction_markets m ON m.id = s.market_id
    WHERE m.active = 1
  `).all(now - WINDOW_MS, now - WINDOW_MS);

  let alerted = 0;
  for (const r of rows) {
    if (r.first_yes == null || r.last_yes == null) continue;
    const delta = r.last_yes - r.first_yes;
    if (Math.abs(delta) < ODDS_SHIFT_PP) continue;
    const severity = Math.min(1, Math.abs(delta) / 0.5);  // 50pp move → severity 1.0
    // Find any event linked to this market.
    const ev = db.prepare(`
      SELECT event_id FROM event_market_links
      WHERE market_id = ? ORDER BY rank LIMIT 1
    `).get(r.market_id);
    const out = recordAnomaly({
      event_id:  ev?.event_id ?? null,
      market_id: r.market_id,
      type:      "odds_shift",
      severity,
      payload: {
        question:  r.question,
        from:      Number(r.first_yes.toFixed(3)),
        to:        Number(r.last_yes.toFixed(3)),
        delta_pp:  Number((delta * 100).toFixed(1)),
        window_ms: WINDOW_MS,
      },
    });
    if (out.inserted) alerted++;
  }
  return alerted;
}

// ─── Detector B: truth_gap_spike ───────────────────────────────────────────
function detectTruthGapSpike(now) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT scope_id,
           (SELECT truth_gap FROM reality_index_snapshots
            WHERE scope='event' AND scope_id = r.scope_id AND ts >= ?
            ORDER BY ts ASC LIMIT 1) AS first_tg,
           (SELECT truth_gap FROM reality_index_snapshots
            WHERE scope='event' AND scope_id = r.scope_id
            ORDER BY ts DESC LIMIT 1) AS last_tg,
           (SELECT title FROM events WHERE id = r.scope_id) AS title
    FROM (
      SELECT DISTINCT scope_id FROM reality_index_snapshots
      WHERE scope='event' AND ts >= ?
    ) r
  `).all(now - WINDOW_MS, now - WINDOW_MS);

  let alerted = 0;
  for (const r of rows) {
    if (r.first_tg == null || r.last_tg == null) continue;
    const jump = Math.abs(r.last_tg - r.first_tg);
    if (jump < TG_SPIKE) continue;
    const severity = Math.min(1, jump / 1.0);
    const out = recordAnomaly({
      event_id:  r.scope_id,
      type:      "truth_gap_spike",
      severity,
      payload: {
        title:    r.title,
        from:     Number(r.first_tg.toFixed(3)),
        to:       Number(r.last_tg.toFixed(3)),
        jump:     Number(jump.toFixed(3)),
      },
    });
    if (out.inserted) alerted++;
  }
  return alerted;
}

// ─── Detector C: viral_no_react ────────────────────────────────────────────
function detectViralNoReact(now) {
  const db = getDb();
  // Event has a recent social volume spike but its top market hasn't moved.
  const events = db.prepare(`
    SELECT id, title FROM events WHERE status='active'
  `).all();

  let alerted = 0;
  for (const e of events) {
    // Sum recent social volumes vs prior baseline.
    const recent = db.prepare(`
      SELECT SUM(volume) AS v FROM sentiment_snapshots
      WHERE scope='event' AND scope_id=? AND ts >= ?
        AND source IN ('bluesky','reddit','mastodon','hn')
    `).get(e.id, now - WINDOW_MS).v ?? 0;

    const baseline = db.prepare(`
      SELECT AVG(v) AS b FROM (
        SELECT SUM(volume) AS v FROM sentiment_snapshots
        WHERE scope='event' AND scope_id=? AND ts < ? AND ts >= ?
          AND source IN ('bluesky','reddit','mastodon','hn')
        GROUP BY ts/3600000
      )
    `).get(e.id, now - WINDOW_MS, now - 24 * 60 * 60 * 1000).b ?? 0;

    if (baseline < 5 || recent < baseline * VIRAL_RATIO) continue;

    // Check market hasn't reacted (top market |delta| < 2pp).
    const market = db.prepare(`
      SELECT pm.id, pm.question,
        (SELECT yes_price FROM prediction_market_snapshots
         WHERE market_id = pm.id AND ts >= ? ORDER BY ts ASC LIMIT 1)  AS first_yes,
        pm.yes_price AS last_yes
      FROM event_market_links eml
      JOIN prediction_markets pm ON pm.id = eml.market_id
      WHERE eml.event_id = ? AND pm.active = 1
      ORDER BY eml.rank LIMIT 1
    `).get(now - WINDOW_MS, e.id);

    if (!market || market.first_yes == null || market.last_yes == null) continue;
    const moved = Math.abs(market.last_yes - market.first_yes);
    if (moved >= 0.02) continue;

    const severity = Math.min(1, recent / Math.max(1, baseline) / 10);
    const out = recordAnomaly({
      event_id:  e.id,
      market_id: market.id,
      type:      "viral_no_react",
      severity,
      payload: {
        title:           e.title,
        recent_volume:   recent,
        baseline_volume: Math.round(baseline),
        ratio:           Number((recent / Math.max(1, baseline)).toFixed(2)),
        market_question: market.question,
        market_delta_pp: Number((moved * 100).toFixed(2)),
      },
    });
    if (out.inserted) alerted++;
  }
  return alerted;
}

// ─── Detector D: sentiment_flip ────────────────────────────────────────────
function detectSentimentFlip(now) {
  const db   = getDb();
  // For each (event, source) with a fresh snapshot, compare to previous.
  const fresh = db.prepare(`
    SELECT scope_id, source, polarity, intensity, ts
    FROM sentiment_snapshots
    WHERE scope='event' AND ts >= ?
      AND source IN ('media','bluesky','reddit','mastodon','hn')
      AND polarity IS NOT NULL
  `).all(now - WINDOW_MS);

  let alerted = 0;
  for (const f of fresh) {
    const prev = previousPolarity("event", f.scope_id, f.source, f.ts);
    if (!prev || prev.polarity == null) continue;
    const flipped = (prev.polarity > 0 && f.polarity < 0) || (prev.polarity < 0 && f.polarity > 0);
    if (!flipped) continue;
    if (Math.abs(prev.polarity) < SENT_FLIP_MIN || Math.abs(f.polarity) < SENT_FLIP_MIN) continue;
    if ((f.intensity ?? 0) < 0.3) continue;
    const severity = Math.min(1, (Math.abs(prev.polarity) + Math.abs(f.polarity)) / 2);
    const ev = db.prepare("SELECT title FROM events WHERE id = ?").get(f.scope_id);
    const out = recordAnomaly({
      event_id: f.scope_id,
      type:     "sentiment_flip",
      severity,
      payload: {
        title:    ev?.title,
        source:   f.source,
        from:     Number(prev.polarity.toFixed(3)),
        to:       Number(f.polarity.toFixed(3)),
      },
    });
    if (out.inserted) alerted++;
  }
  return alerted;
}

// ─── Composed cycle ────────────────────────────────────────────────────────
export function runAnomalyDetector() {
  const now = Date.now();
  const out = {
    odds_shift:      0,
    truth_gap_spike: 0,
    viral_no_react:  0,
    sentiment_flip:  0,
  };
  try { out.odds_shift      = detectOddsShift(now);      } catch (e) { logger.warn(`odds_shift: ${e.message}`); }
  try { out.truth_gap_spike = detectTruthGapSpike(now);  } catch (e) { logger.warn(`truth_gap_spike: ${e.message}`); }
  try { out.viral_no_react  = detectViralNoReact(now);   } catch (e) { logger.warn(`viral_no_react: ${e.message}`); }
  try { out.sentiment_flip  = detectSentimentFlip(now);  } catch (e) { logger.warn(`sentiment_flip: ${e.message}`); }
  const total = Object.values(out).reduce((s, n) => s + n, 0);
  if (total) logger.info(`🚨 anomaly detector: ${total} new alerts ${JSON.stringify(out)}`);
  return out;
}
