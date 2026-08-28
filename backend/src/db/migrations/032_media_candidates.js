/**
 * 032 — the incident media ledger: media_candidates + its audit trail.
 *
 * WHY THIS TABLE IS THE PRODUCT, NOT A CACHE. 031's stock_asset_usage is derived
 * state: lose it and rotation gets worse for a week. This is the opposite. If a
 * use of somebody's incident footage is ever challenged, these rows ARE the
 * answer — what was claimed, what was checked, what the check found, who decided,
 * and when. A lost row is a lost defence, so nothing here is reconstructible and
 * nothing here may be quietly rewritten.
 *
 * NO FOREIGN KEY, following video_posts, longform_posts and 031. story_id points
 * at an articles row, an events row or an incident_commissions row depending on
 * story_kind, which no single FK can express. Existence is checked at intake
 * (incidentLedger.createCandidate) rather than by the engine, so the error names
 * the problem instead of surfacing as SQLITE_CONSTRAINT.
 *
 * WHY COMMISSIONS GET THEIR OWN TABLE INSTEAD OF AN events ROW. A commissioned
 * topic is a story stub, and the obvious implementation is to promote it into
 * `events`. That would manufacture an article-less event — the exact shape that
 * has already caused two production failures by consuming selection windows
 * (CLAUDE.md, "Machine events"). Every query that picks the freshest N events
 * would have to learn about a second kind of article-less row. So commissions
 * live here, off the event graph, and the graph stays a graph of real coverage.
 *
 * THE AUDIT TABLE IS APPEND-ONLY, ENFORCED BY TRIGGER. An audit trail that the
 * application layer merely promises not to edit is a promise, not a record. The
 * two triggers below make UPDATE and DELETE raise, so tampering is a hard error
 * rather than a silent rewrite — including tampering by our own future code with
 * a well-meant "fix the status of that old row" migration. Pruning this table is
 * therefore a deliberate act that must drop a trigger first, which is the point:
 * at the volumes this engine implies (tens of candidates a day) the rows are
 * cheap, and the decision to discard evidence should be conscious.
 */

export const id = "032_media_candidates";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_candidates (
      id                TEXT PRIMARY KEY,

      -- What story this belongs to. story_kind decides which table story_id
      -- refers to; see the header for why there is no FK.
      story_kind        TEXT NOT NULL,          -- article | event | commission
      story_id          TEXT NOT NULL,

      -- Where it came from. platform is a NAMED lane, never "unknown": a
      -- candidate whose lane cannot be named is refused at intake rather than
      -- stored as a mystery row (brief §3, "any acquisition that can't name its
      -- lane doesn't happen").
      platform          TEXT NOT NULL,
      post_url          TEXT NOT NULL UNIQUE,   -- canonicalised; UNIQUE is the dedupe
      poster_handle     TEXT,
      poster_display    TEXT,

      -- AS CLAIMED. These are the poster's assertions, recorded so that Phase 2
      -- has something to contradict. They are never evidence of anything, and
      -- the column names say so.
      claimed_at        INTEGER,
      claimed_location  TEXT,

      media_type        TEXT NOT NULL,          -- video | photo | unknown
      intake_source     TEXT NOT NULL,          -- manual | auto | commissioned

      -- Do we hold a file, and how did we come to hold it? Distinct from
      -- clearance: holding a file says nothing about the right to use it.
      acquisition       TEXT NOT NULL DEFAULT 'none',   -- none | requested | supplied | held

      -- The status machine. kill_reason is set only in 'killed',
      -- clearance_basis only in 'cleared', constructed_video_id only in
      -- 'constructed' — all three enforced in incidentStatus.js, which is the
      -- single place that decides what a legal transition is.
      status            TEXT NOT NULL,
      kill_reason       TEXT,
      clearance_basis   TEXT,                   -- grant | fair_use | owner
      constructed_video_id TEXT,

      -- Lane 1. Usable by the site and cards, never by the renderer. Separate
      -- from status because it is orthogonal: a candidate can be embed_only at
      -- any point in the machine, including after it is killed for render use.
      embed_only        INTEGER NOT NULL DEFAULT 0,

      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );

    -- The queue's own question: what is waiting for me, oldest first.
    CREATE INDEX IF NOT EXISTS idx_media_candidates_status
      ON media_candidates(status, created_at);
    -- "What have we already got for this story" — the intake dedupe check and
    -- the per-story view in the queue.
    CREATE INDEX IF NOT EXISTS idx_media_candidates_story
      ON media_candidates(story_kind, story_id, created_at DESC);

    -- One row per transition. This is the trail described in brief §2 Phase 1:
    -- when, by what check, with what evidence.
    CREATE TABLE IF NOT EXISTS media_candidate_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id  TEXT NOT NULL,
      ts            INTEGER NOT NULL,
      from_status   TEXT,                       -- NULL on the creating row
      to_status     TEXT NOT NULL,
      check_name    TEXT NOT NULL,              -- which check decided this
      actor         TEXT NOT NULL,              -- system | operator
      evidence      TEXT                        -- JSON, optional
    );
    CREATE INDEX IF NOT EXISTS idx_media_candidate_events_cand
      ON media_candidate_events(candidate_id, ts);

    -- Append-only, enforced. See the header: a trail the code merely promises
    -- not to edit is not a record. RAISE(ABORT) rolls back the whole enclosing
    -- transaction, so a transition that tried to rewrite history fails as a unit
    -- rather than half-applying.
    CREATE TRIGGER IF NOT EXISTS media_candidate_events_no_update
      BEFORE UPDATE ON media_candidate_events
      BEGIN
        SELECT RAISE(ABORT, 'media_candidate_events is append-only: an audit row may not be updated');
      END;
    CREATE TRIGGER IF NOT EXISTS media_candidate_events_no_delete
      BEFORE DELETE ON media_candidate_events
      BEGIN
        SELECT RAISE(ABORT, 'media_candidate_events is append-only: an audit row may not be deleted');
      END;

    -- Commissioned topics (brief §2 Phase 1, intake source c). Deliberately off
    -- the event graph — see the header.
    CREATE TABLE IF NOT EXISTS incident_commissions (
      id          TEXT PRIMARY KEY,
      topic       TEXT NOT NULL,
      output_kind TEXT NOT NULL,                -- short | longform
      notes       TEXT,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_incident_commissions_created
      ON incident_commissions(created_at DESC);
  `);
}
