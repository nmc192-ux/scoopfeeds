/**
 * eventActorExtractor — uses LLM to identify key people, orgs, and countries
 * from the top articles of each active event.
 *
 * Output lands in event_actors (upsert by event_id + actor_name).
 *
 * Cost rails (2026-07-15 incident, gate a): this extractor was the single
 * biggest burner of the $25.77/day — its selection re-picked every event
 * whose LLM response failed to parse, every hour, forever (event_actors
 * stayed at 0 rows while output tokens burned). Every call is now gated by
 * an attempts ledger (actor_extraction_attempts, migration 016):
 *   - retry cap: an event gets at most MAX_ATTEMPTS LLM calls; spacing
 *     between attempts grows (6h, 24h), then the event is left alone until
 *     its ARTICLES change;
 *   - content hash: the hash of the article ids last sent is stored; an
 *     event whose top articles are unchanged is never re-paid — success or
 *     failure alike;
 *   - per-cycle LIMIT dropped 100 → 25 (hourly cadence catches up fine).
 */

import crypto from "crypto";
import { getDb } from "../../models/database.js";
import { callJson } from "../llmQueue.js";
import { logger } from "../../services/logger.js";

const REFRESH_AFTER_MS = 6 * 60 * 60 * 1000; // re-extract if event updated in last 6h
const MAX_ACTORS = 8;
const MAX_ATTEMPTS = 3;                       // LLM calls per content-hash, lifetime
const ATTEMPT_SPACING_MS = [0, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000]; // before attempt 1, 2, 3
const PER_CYCLE_LIMIT = Number.parseInt(process.env.ACTOR_EXTRACT_PER_CYCLE || "25", 10);

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

function contentHash(articles) {
  return crypto.createHash("sha256")
    .update(articles.map(a => a.id).join("|"))
    .digest("hex");
}

/**
 * Ledger decision for one event. Returns { proceed, hash } — proceed=false
 * means "do not pay for this event this cycle".
 */
function shouldAttempt(db, eventId, articles, now) {
  const hash = contentHash(articles);
  const led = db.prepare(`SELECT attempts, last_attempt_at, last_content_hash, succeeded_at FROM actor_extraction_attempts WHERE event_id = ?`).get(eventId);

  if (!led) return { proceed: true, hash };

  // Articles changed since the last attempt: fresh content, fresh budget.
  if (led.last_content_hash !== hash) return { proceed: true, hash, reset: true };

  // Same content, already succeeded: never re-pay.
  if (led.succeeded_at) return { proceed: false, hash };

  // Same content, still failing: honor the retry cap and spacing.
  if (led.attempts >= MAX_ATTEMPTS) return { proceed: false, hash };
  const wait = ATTEMPT_SPACING_MS[Math.min(led.attempts, ATTEMPT_SPACING_MS.length - 1)];
  if (now - led.last_attempt_at < wait) return { proceed: false, hash };
  return { proceed: true, hash };
}

function recordAttempt(db, eventId, hash, now, { succeeded }) {
  db.prepare(`
    INSERT INTO actor_extraction_attempts (event_id, attempts, last_attempt_at, last_content_hash, succeeded_at)
    VALUES (?, 1, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      attempts          = CASE WHEN excluded.last_content_hash != actor_extraction_attempts.last_content_hash THEN 1 ELSE actor_extraction_attempts.attempts + 1 END,
      last_attempt_at   = excluded.last_attempt_at,
      last_content_hash = excluded.last_content_hash,
      succeeded_at      = excluded.succeeded_at
  `).run(eventId, now, hash, succeeded ? now : null);
}

async function extractActors(db, event, now) {
  const articles = db.prepare(`
    SELECT a.id, a.title, a.description AS summary
    FROM event_articles ea
    JOIN articles a ON a.id = ea.article_id
    WHERE ea.event_id = ?
    ORDER BY ea.added_at DESC
    LIMIT 5
  `).all(event.id);

  if (!articles.length) {
    // Ledger article-less events too (live verify 2026-07-16: wire-generated
    // NOAA events have no linked articles, were never ledgered, and being
    // perpetually most-recent they re-occupied candidate slots every cycle —
    // starving real events out of the LIMIT). Three probes with growing
    // spacing, then the SQL pre-filter stops selecting them; new activity
    // re-qualifies them via last_activity_at > last_attempt_at.
    recordAttempt(db, event.id, "no-articles", now, { succeeded: false });
    return { called: false, actors: 0 };
  }

  const gate = shouldAttempt(db, event.id, articles, now);
  if (!gate.proceed) return { called: false, actors: 0 };

  const prompt = buildPrompt(event, articles);
  let parsed;
  try {
    parsed = await callJson(`${SYSTEM_PROMPT}\n\n${prompt}`, { tier: "standard", maxOutputTokens: 512, task: "actors" });
  } catch (err) {
    logger.warn(`eventActorExtractor: LLM failed for event ${event.id} — ${err.message}`);
    recordAttempt(db, event.id, gate.hash, now, { succeeded: false, reset: gate.reset });
    return { called: true, actors: 0 };
  }

  const actors = Array.isArray(parsed?.actors) ? parsed.actors : [];
  if (!actors.length) {
    // The call was paid but yielded nothing usable — ledger it so the same
    // content is retried at most MAX_ATTEMPTS times with growing spacing.
    recordAttempt(db, event.id, gate.hash, now, { succeeded: false, reset: gate.reset });
    return { called: true, actors: 0 };
  }

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

  recordAttempt(db, event.id, gate.hash, now, { succeeded: true, reset: gate.reset });
  return { called: true, actors: actors.length };
}

export async function runEventActorExtractor() {
  const db = getDb();
  const now = Date.now();
  const cutoff = now - REFRESH_AFTER_MS;

  // Events with no actors yet, OR recently active events needing a refresh —
  // MINUS anything the attempts ledger has already settled. The ledger must
  // be consulted IN the selection (not just in the loop): live verify
  // 2026-07-16 showed exhausted/junk events occupying every candidate slot
  // by recency, starving real events out of the LIMIT forever. Eligible =
  // never attempted, OR a capped retry now due, OR new activity since the
  // last attempt (article set may have changed — the in-loop content hash
  // stays as the precise, no-spend guard for that case).
  const events = db.prepare(`
    SELECT e.id, e.title, e.category
    FROM events e
    LEFT JOIN actor_extraction_attempts att ON att.event_id = e.id
    WHERE e.status = 'active'
      AND (
        (SELECT COUNT(*) FROM event_actors ea WHERE ea.event_id = e.id) = 0
        OR e.last_activity_at >= ?
      )
      AND (
        att.event_id IS NULL
        OR e.last_activity_at > att.last_attempt_at
        OR (
          att.succeeded_at IS NULL
          AND att.attempts < ?
          AND att.last_attempt_at <= ? - (CASE WHEN att.attempts <= 1 THEN 21600000 ELSE 86400000 END)
        )
      )
    ORDER BY EXISTS (SELECT 1 FROM event_articles eax WHERE eax.event_id = e.id) DESC,
             e.last_activity_at DESC
    LIMIT ?
  `).all(cutoff, MAX_ATTEMPTS, now, PER_CYCLE_LIMIT);
  // Ordering note (gate-a live verify, 2026-07-16): events WITH articles fill the
  // slots first. Article-less junk (raw NOAA wire events, promoter-churn shells)
  // mints new ids faster than any per-cycle budget — llm_daily_calls showed ZERO
  // actor calls across two days because every slot went to free-ledgering junk.
  // Junk now only occupies leftover slots; it costs nothing until it gains articles.

  let total = 0;
  let llmCalls = 0;
  let skipped = 0;
  for (const event of events) {
    try {
      const r = await extractActors(db, event, now);
      total += r.actors;
      if (r.called) llmCalls += 1; else skipped += 1;
    } catch (err) {
      logger.warn(`eventActorExtractor: event ${event.id} outer error — ${err.message}`);
    }
  }

  const stats = { candidates: events.length, llm_calls: llmCalls, skipped_by_ledger: skipped, actors_upserted: total };
  logger.info(`🎭 eventActorExtractor done — ${JSON.stringify(stats)}`);
  return stats;
}
