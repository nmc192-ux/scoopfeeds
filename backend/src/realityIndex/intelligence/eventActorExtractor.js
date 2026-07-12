/**
 * eventActorExtractor — uses LLM to identify key people, orgs, and countries
 * from the top articles of each active event.
 *
 * Output lands in event_actors (upsert by event_id + actor_name).
 * Only runs on events that have no actors yet OR have had new articles in the
 * last REFRESH_AFTER_MS window.
 *
 * Prompt sends the 5 most-recent article titles + summaries and asks for JSON.
 */

import { getDb } from "../../models/database.js";
import { callJson } from "../llmQueue.js";
import { logger } from "../../services/logger.js";

const REFRESH_AFTER_MS = 6 * 60 * 60 * 1000; // re-extract if event updated in last 6h
const MAX_ACTORS = 8;

const SYSTEM_PROMPT = `You are a news analyst. Extract the key actors from the provided news summaries.
Return a JSON object with a single key "actors" containing an array of objects, each with:
  - "name": full name of the person, organization, or country (string)
  - "type": one of "person", "org", or "country" (string)
  - "role": one-sentence description of their role in this story (string)
  - "mentions": estimated mention count (integer, 1..10)
Return at most ${MAX_ACTORS} actors. Order by importance (most central first).
Return ONLY valid JSON, no markdown, no extra text.`;

function buildPrompt(event, articles) {
  const snippets = articles
    .map((a, i) => `[${i + 1}] ${a.title}\n${a.summary ?? ""}`)
    .join("\n\n");
  return `Event: "${event.title}" (category: ${event.category})\n\nTop articles:\n${snippets}`;
}

async function extractActors(db, event) {
  const articles = db.prepare(`
    SELECT a.title, a.description AS summary
    FROM event_articles ea
    JOIN articles a ON a.id = ea.article_id
    WHERE ea.event_id = ?
    ORDER BY ea.added_at DESC
    LIMIT 5
  `).all(event.id);

  if (!articles.length) return 0;

  const prompt = buildPrompt(event, articles);
  let parsed;
  try {
    parsed = await callJson(`${SYSTEM_PROMPT}\n\n${prompt}`, { tier: "standard", maxOutputTokens: 512 });
  } catch (err) {
    logger.warn(`eventActorExtractor: LLM failed for event ${event.id} — ${err.message}`);
    return 0;
  }

  const actors = Array.isArray(parsed?.actors) ? parsed.actors : [];
  if (!actors.length) return 0;

  const upsert = db.prepare(`
    INSERT INTO event_actors (event_id, actor_name, actor_type, role, mentions)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(event_id, actor_name) DO UPDATE SET
      actor_type = excluded.actor_type,
      role       = excluded.role,
      mentions   = excluded.mentions
  `);

  const run = db.transaction(() => {
    for (const actor of actors.slice(0, MAX_ACTORS)) {
      if (!actor?.name) continue;
      upsert.run(
        event.id,
        String(actor.name).slice(0, 200),
        ["person", "org", "country"].includes(actor.type) ? actor.type : "person",
        actor.role ? String(actor.role).slice(0, 500) : null,
        Number.isInteger(actor.mentions) ? actor.mentions : 1
      );
    }
  });
  run();

  return actors.length;
}

export async function runEventActorExtractor() {
  const db = getDb();
  const cutoff = Date.now() - REFRESH_AFTER_MS;

  // Events with no actors yet, OR recently active events needing a refresh.
  const events = db.prepare(`
    SELECT e.id, e.title, e.category
    FROM events e
    WHERE e.status = 'active'
      AND (
        (SELECT COUNT(*) FROM event_actors ea WHERE ea.event_id = e.id) = 0
        OR e.last_activity_at >= ?
      )
    ORDER BY e.last_activity_at DESC
    LIMIT 100
  `).all(cutoff);

  let total = 0;
  for (const event of events) {
    try {
      const n = await extractActors(db, event);
      total += n;
    } catch (err) {
      logger.warn(`eventActorExtractor: event ${event.id} outer error — ${err.message}`);
    }
  }

  const stats = { events_processed: events.length, actors_upserted: total };
  logger.info(`🎭 eventActorExtractor done — ${JSON.stringify(stats)}`);
  return stats;
}
