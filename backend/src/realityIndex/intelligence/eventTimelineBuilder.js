/**
 * eventTimelineBuilder — populates event_timeline for each active event.
 *
 * Entry kinds produced:
 *   article      — article published that belongs to this event
 *   market_move  — YES price changed >= PRICE_MOVE_THRESHOLD in one snapshot step
 *
 * Run after eventPromoter so event_articles and event_market_links are fresh.
 * Idempotent: entries are INSERT OR IGNORE keyed on (event_id, kind, ref_id).
 */

import { getDb } from "../../models/database.js";
import { logger } from "../../services/logger.js";

const PRICE_MOVE_THRESHOLD = 0.05; // 5% YES-price shift qualifies as a market move
const ARTICLE_IMPORTANCE_BASE = 0.5;

function articleImportance(article) {
  // Boost for source credibility score, decay older articles slightly.
  const cred = article.credibility_score ?? 0.5;
  return Math.min(0.9, ARTICLE_IMPORTANCE_BASE + cred * 0.4);
}

function insertTimelineEntry(db, entry) {
  db.prepare(`
    INSERT OR IGNORE INTO event_timeline
      (event_id, ts, kind, ref_id, headline, body, source_name, importance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.event_id,
    entry.ts,
    entry.kind,
    entry.ref_id,
    entry.headline ?? null,
    entry.body ?? null,
    entry.source_name ?? null,
    entry.importance ?? 0.5
  );
}

function buildArticleEntries(db, event) {
  const articles = db.prepare(`
    SELECT a.id, a.title, a.published_at, a.source_name,
           a.credibility AS credibility_score, a.description AS summary
    FROM event_articles ea
    JOIN articles a ON a.id = ea.article_id
    WHERE ea.event_id = ?
    ORDER BY a.published_at DESC
    LIMIT 100
  `).all(event.id);

  let added = 0;
  for (const art of articles) {
    insertTimelineEntry(db, {
      event_id:    event.id,
      ts:          art.published_at,
      kind:        "article",
      ref_id:      String(art.id),
      headline:    art.title,
      body:        art.summary ?? null,
      source_name: art.source_name ?? null,
      importance:  articleImportance(art),
    });
    added++;
  }
  return added;
}

function buildMarketMoveEntries(db, event) {
  const markets = db.prepare(`
    SELECT eml.market_id, pm.question
    FROM event_market_links eml
    JOIN prediction_markets pm ON pm.id = eml.market_id
    WHERE eml.event_id = ?
    ORDER BY eml.rank
  `).all(event.id);

  let added = 0;
  for (const market of markets) {
    // Fetch last 48 snapshots (hot-tier: 15-min intervals = 12h window)
    const snaps = db.prepare(`
      SELECT ts, yes_price, volume_24h
      FROM prediction_market_snapshots
      WHERE market_id = ?
      ORDER BY ts DESC
      LIMIT 48
    `).all(market.market_id);

    // Walk pairs oldest→newest and flag large moves
    for (let i = snaps.length - 1; i > 0; i--) {
      const older = snaps[i];
      const newer = snaps[i - 1];
      if (older.yes_price == null || newer.yes_price == null) continue;

      const delta = newer.yes_price - older.yes_price;
      if (Math.abs(delta) < PRICE_MOVE_THRESHOLD) continue;

      const direction = delta > 0 ? "UP" : "DOWN";
      const pct = (Math.abs(delta) * 100).toFixed(1);

      insertTimelineEntry(db, {
        event_id:    event.id,
        ts:          newer.ts,
        kind:        "market_move",
        ref_id:      market.market_id,
        headline:    `Market ${direction} ${pct}%: ${market.question}`,
        body:        `YES price moved from ${(older.yes_price * 100).toFixed(1)}% to ${(newer.yes_price * 100).toFixed(1)}%`,
        source_name: "Polymarket",
        importance:  Math.min(0.95, 0.5 + Math.abs(delta)),
      });
      added++;
    }
  }
  return added;
}

export async function runEventTimelineBuilder() {
  const db = getDb();

  const events = db.prepare(`
    SELECT id, title FROM events WHERE status = 'active' ORDER BY last_activity_at DESC LIMIT 500
  `).all();

  let totalArticles = 0;
  let totalMoves = 0;

  for (const event of events) {
    try {
      totalArticles += buildArticleEntries(db, event);
      totalMoves    += buildMarketMoveEntries(db, event);
    } catch (err) {
      logger.warn(`eventTimelineBuilder: event ${event.id} failed — ${err.message}`);
    }
  }

  const stats = { events: events.length, article_entries: totalArticles, market_move_entries: totalMoves };
  logger.info(`📅 eventTimelineBuilder done — ${JSON.stringify(stats)}`);
  return stats;
}
