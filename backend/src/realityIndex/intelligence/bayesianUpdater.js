/**
 * bayesianUpdater — Phase 3 leftover (per plan §3): tags news events that
 * moved markets ≥N% with the article that most plausibly caused the move.
 *
 * Reads recent `market_move` rows from event_timeline, finds articles in
 * the same event published within ±30 min before the move, and writes a
 * sibling `market_attribution` timeline entry linking the article to the
 * market move. The UI surfaces these as "Article X likely moved YES from
 * 0.55 → 0.70 (+15pp) within Zh."
 *
 * Idempotent: skips moves that already have a sibling attribution entry.
 * Bounded per cycle. Pure SQLite, no LLM.
 */

import { getDb } from "../../models/database.js";
import { logger } from "../../services/logger.js";

const LOOKBACK_MS         = parseInt(process.env.BAYES_LOOKBACK_MS || String(6 * 60 * 60 * 1000), 10);
const ARTICLE_WINDOW_MS   = parseInt(process.env.BAYES_ARTICLE_WINDOW_MS || String(30 * 60 * 1000), 10);
const MAX_PER_CYCLE       = parseInt(process.env.BAYES_MAX_PER_CYCLE || "50", 10);

export function runBayesianUpdater() {
  const db = getDb();
  const since = Date.now() - LOOKBACK_MS;

  const moves = db.prepare(`
    SELECT id, event_id, ts, ref_id, headline, body
    FROM event_timeline
    WHERE kind = 'market_move' AND ts >= ?
      AND NOT EXISTS (
        SELECT 1 FROM event_timeline a
        WHERE a.kind = 'market_attribution' AND a.event_id = event_timeline.event_id
          AND a.body LIKE '%"market_move_id":' || event_timeline.id || '%'
      )
    ORDER BY ts DESC
    LIMIT ?
  `).all(since, MAX_PER_CYCLE);

  if (!moves.length) return { scanned: 0, attributed: 0 };

  const insert = db.prepare(`
    INSERT INTO event_timeline (event_id, ts, kind, ref_id, headline, body, importance)
    VALUES (?, ?, 'market_attribution', ?, ?, ?, ?)
  `);

  let attributed = 0;
  for (const mv of moves) {
    // Find candidate articles in this event published just before the move.
    const candidates = db.prepare(`
      SELECT a.id, a.title, a.published_at, a.source_name
      FROM event_articles ea
      JOIN articles a ON a.id = ea.article_id
      WHERE ea.event_id = ?
        AND a.published_at <= ?
        AND a.published_at >= ?
      ORDER BY a.published_at DESC
      LIMIT 5
    `).all(mv.event_id, mv.ts, mv.ts - ARTICLE_WINDOW_MS);

    if (!candidates.length) continue;
    // Pick the freshest article (closest in time to the move). When a single
    // event has multiple articles in the window we'd ideally rank by source
    // credibility too — left for v2.
    const top = candidates[0];
    const minutesBefore = Math.max(0, Math.round((mv.ts - top.published_at) / 60_000));

    const headline = `Likely cause: "${(top.title || "").slice(0, 100)}"`;
    const body = JSON.stringify({
      market_move_id: mv.id,
      market_id:      mv.ref_id || null,
      article_id:     top.id,
      article_source: top.source_name,
      published_minutes_before: minutesBefore,
      candidate_count: candidates.length,
    });

    insert.run(
      mv.event_id, mv.ts + 1,        // +1ms so it sorts right after the move
      top.id,                         // ref_id = article id (so the UI can link)
      headline,
      body,
      Math.min(1, 0.5 + (mv.importance ?? 0.5) * 0.3),
    );
    attributed++;
  }

  if (attributed) logger.info(`🔗 bayesianUpdater: ${moves.length} moves scanned, ${attributed} attributed to a triggering article`);
  return { scanned: moves.length, attributed };
}
