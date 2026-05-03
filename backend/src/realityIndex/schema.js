/**
 * Reality Index — schema initializer.
 *
 * Self-contained: call initRealityIndex(db) once at startup after the main
 * database.js has booted. Idempotent (CREATE IF NOT EXISTS everywhere).
 *
 * Tables added in Phase 1:
 *   prediction_markets             — Polymarket / future Kalshi / Manifold / synthetic
 *   prediction_market_snapshots    — 3-tier (hot/warm/cold) time-series
 *   cluster_market_links           — story_cluster ↔ market (m-to-m)
 *   article_market_links           — article ↔ market (m-to-m)
 *   embeddings                     — sqlite-vec vector store (vec0 virtual table)
 *
 * Tables reserved (created now, populated in later phases):
 *   raw_signals                    — generic landing zone for non-market sources
 */

import * as sqliteVec from "sqlite-vec";
import { logger } from "../services/logger.js";

let initialized = false;
let vecAvailable = false;

export function isVecAvailable() {
  return vecAvailable;
}

export function initRealityIndex(db) {
  if (initialized) return;
  initialized = true;

  // ── 1. Load sqlite-vec extension. If it fails we still init the rest of
  //      the schema; the matcher will degrade gracefully to keyword match.
  try {
    sqliteVec.load(db);
    const row = db.prepare("SELECT vec_version() AS v").get();
    vecAvailable = true;
    logger.info(`🧮 sqlite-vec loaded (v${row?.v ?? "?"})`);
  } catch (err) {
    vecAvailable = false;
    logger.warn(`🧮 sqlite-vec NOT loaded — embedding search disabled: ${err.message}`);
  }

  // ── 2. Plain SQL tables. Indices included.
  db.exec(`
    -- Markets — Polymarket today; pluggable for Kalshi/Manifold/synthetic later.
    CREATE TABLE IF NOT EXISTS prediction_markets (
      id                TEXT PRIMARY KEY,                -- internal UUID v4
      source            TEXT NOT NULL,                   -- 'polymarket' | 'kalshi' | 'manifold' | 'synthetic'
      source_market_id  TEXT NOT NULL,                   -- upstream id (Polymarket condition_id, etc.)
      question          TEXT NOT NULL,
      description       TEXT,
      slug              TEXT,
      category          TEXT,
      tags              TEXT,                            -- JSON array
      end_date          INTEGER,                         -- ms since epoch, nullable
      resolved          INTEGER NOT NULL DEFAULT 0,
      outcome           TEXT,                            -- 'yes' | 'no' | NULL
      active            INTEGER NOT NULL DEFAULT 1,
      yes_price         REAL,                            -- latest cached
      no_price          REAL,
      volume_24h        REAL,
      liquidity         REAL,
      spread            REAL,
      url               TEXT,                            -- external link to upstream market
      icon_url          TEXT,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      raw_meta          TEXT,                            -- JSON blob of upstream payload
      UNIQUE(source, source_market_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pm_active        ON prediction_markets(active, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pm_source        ON prediction_markets(source);
    CREATE INDEX IF NOT EXISTS idx_pm_category      ON prediction_markets(category);
    CREATE INDEX IF NOT EXISTS idx_pm_volume        ON prediction_markets(active, volume_24h DESC);
    CREATE INDEX IF NOT EXISTS idx_pm_end           ON prediction_markets(active, end_date);

    -- Time-series. tier in {'hot','warm','cold'}; downsampled by jobs/snapshotDownsampler.js
    CREATE TABLE IF NOT EXISTS prediction_market_snapshots (
      market_id   TEXT NOT NULL,
      ts          INTEGER NOT NULL,                      -- ms since epoch
      tier        TEXT NOT NULL DEFAULT 'hot',
      yes_price   REAL,
      no_price    REAL,
      volume_24h  REAL,
      liquidity   REAL,
      spread      REAL,
      PRIMARY KEY (market_id, ts)
    );
    CREATE INDEX IF NOT EXISTS idx_pms_tier_ts      ON prediction_market_snapshots(tier, ts);
    CREATE INDEX IF NOT EXISTS idx_pms_market_ts    ON prediction_market_snapshots(market_id, ts DESC);

    -- Cluster ↔ Market many-to-many. weight is the LLM rerank score (0..1).
    CREATE TABLE IF NOT EXISTS cluster_market_links (
      cluster_id   TEXT NOT NULL,
      market_id    TEXT NOT NULL,
      weight       REAL NOT NULL,
      rank         INTEGER NOT NULL,                     -- 1, 2, 3 within the cluster
      matcher      TEXT NOT NULL,                        -- 'embedding+llm' | 'rule' | 'manual'
      reason       TEXT,                                 -- LLM rationale (optional)
      matched_at   INTEGER NOT NULL,
      PRIMARY KEY (cluster_id, market_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cml_cluster      ON cluster_market_links(cluster_id, rank);
    CREATE INDEX IF NOT EXISTS idx_cml_market       ON cluster_market_links(market_id);

    -- Article ↔ Market many-to-many. Optional fast path for "this article moved
    -- this market". Not required for v1 read APIs.
    CREATE TABLE IF NOT EXISTS article_market_links (
      article_id   TEXT NOT NULL,
      market_id    TEXT NOT NULL,
      relevance    REAL NOT NULL,
      matcher      TEXT NOT NULL,
      matched_at   INTEGER NOT NULL,
      PRIMARY KEY (article_id, market_id)
    );
    CREATE INDEX IF NOT EXISTS idx_aml_article      ON article_market_links(article_id);
    CREATE INDEX IF NOT EXISTS idx_aml_market       ON article_market_links(market_id);

    -- Generic landing zone for ingester payloads that don't have their own table.
    CREATE TABLE IF NOT EXISTS raw_signals (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      source       TEXT NOT NULL,                        -- 'gdelt' | 'usgs' | 'fred' | ...
      external_id  TEXT,
      payload      TEXT NOT NULL,                        -- JSON
      ts           INTEGER NOT NULL,
      processed    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_raw_unprocessed  ON raw_signals(source, processed, ts);
    CREATE INDEX IF NOT EXISTS idx_raw_external     ON raw_signals(source, external_id);
  `);

  // ── 3. Vector table (only when sqlite-vec is loaded).
  //
  // We embed at 768 dims (Gemini Embedding default). The vec0 virtual table
  // requires a fixed dimensionality — change here AND in embeddingService.js
  // if you ever bump the model.
  if (vecAvailable) {
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS embeddings USING vec0(
          rowid INTEGER PRIMARY KEY,
          embedding FLOAT[768]
        );
      `);
      // Sidecar table for metadata (vec0 only stores the vector + rowid).
      db.exec(`
        CREATE TABLE IF NOT EXISTS embedding_meta (
          rowid       INTEGER PRIMARY KEY,
          scope       TEXT NOT NULL,                     -- 'market' | 'cluster' | 'article'
          scope_id    TEXT NOT NULL,
          model       TEXT NOT NULL,
          dims        INTEGER NOT NULL,
          created_at  INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_em_scope_id ON embedding_meta(scope, scope_id);
        CREATE INDEX IF NOT EXISTS idx_em_scope          ON embedding_meta(scope);
      `);
    } catch (err) {
      logger.warn(`🧮 vec0 table init failed: ${err.message}`);
      vecAvailable = false;
    }
  }

  // ── Phase 2: Event Tracker tables ──────────────────────────────────────
  db.exec(`
    -- Events: promoted story clusters with their own identity + dossier
    CREATE TABLE IF NOT EXISTS events (
      id                TEXT PRIMARY KEY,
      slug              TEXT UNIQUE NOT NULL,
      cluster_id        TEXT,                        -- source cluster (nullable later for multi-cluster)
      title             TEXT NOT NULL,
      summary           TEXT,
      category          TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'active', -- active | dormant | resolved
      severity          REAL DEFAULT 0.5,            -- 0..1 composite signal strength
      geo_country_codes TEXT,                        -- JSON array of ISO-2 codes
      hero_image_url    TEXT,
      started_at        INTEGER NOT NULL,
      last_activity_at  INTEGER NOT NULL,
      resolved_at       INTEGER,
      meta              TEXT,                        -- JSON blob for future extension
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_status         ON events(status, last_activity_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_category       ON events(category, status);
    -- cluster_id is unique when set so eventTracker.upsert can ON CONFLICT(cluster_id).
    -- Partial index allows multiple NULLs for future multi-cluster events.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_events_cluster ON events(cluster_id) WHERE cluster_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_events_slug           ON events(slug);

    -- Chronological feed: articles, market moves, statements, etc.
    CREATE TABLE IF NOT EXISTS event_timeline (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id    TEXT NOT NULL,
      ts          INTEGER NOT NULL,
      kind        TEXT NOT NULL,                     -- article | market_move | sentiment_shift | statement
      ref_id      TEXT,                              -- article.id / market.id
      headline    TEXT,
      body        TEXT,
      source_name TEXT,
      importance  REAL NOT NULL DEFAULT 0.5,         -- 0..1
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_et_event_ts ON event_timeline(event_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_et_kind     ON event_timeline(event_id, kind, ts DESC);

    -- Event ↔ article many-to-many
    CREATE TABLE IF NOT EXISTS event_articles (
      event_id   TEXT NOT NULL,
      article_id TEXT NOT NULL,
      relevance  REAL NOT NULL DEFAULT 1.0,
      added_at   INTEGER NOT NULL,
      PRIMARY KEY (event_id, article_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ea_event   ON event_articles(event_id, added_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ea_article ON event_articles(article_id);

    -- Key actors extracted by LLM per event
    CREATE TABLE IF NOT EXISTS event_actors (
      event_id   TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      actor_type TEXT,                               -- person | org | country
      role       TEXT,
      mentions   INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (event_id, actor_name)
    );
    CREATE INDEX IF NOT EXISTS idx_actor_event ON event_actors(event_id, mentions DESC);

    -- Event ↔ prediction market many-to-many (derived from cluster_market_links)
    CREATE TABLE IF NOT EXISTS event_market_links (
      event_id   TEXT NOT NULL,
      market_id  TEXT NOT NULL,
      weight     REAL NOT NULL DEFAULT 1.0,
      rank       INTEGER NOT NULL DEFAULT 1,
      matched_at INTEGER NOT NULL,
      PRIMARY KEY (event_id, market_id)
    );
    CREATE INDEX IF NOT EXISTS idx_eml_event  ON event_market_links(event_id, rank);
    CREATE INDEX IF NOT EXISTS idx_eml_market ON event_market_links(market_id);
  `);

  // ── Phase 3: Sentiment + Reality Index composite + anomalies ────────────
  db.exec(`
    -- Per-source sentiment time-series. scope is the bucket the metric is
    -- attached to (event/cluster/article/topic); scope_id its identifier.
    -- source = 'media' | 'bluesky' | 'reddit' | 'mastodon' | 'hn' | 'wikipedia' | 'x' | 'threads'
    -- polarity in [-1, +1]; intensity in [0, 1]; volume = mention count.
    CREATE TABLE IF NOT EXISTS sentiment_snapshots (
      scope       TEXT NOT NULL,
      scope_id    TEXT NOT NULL,
      ts          INTEGER NOT NULL,
      source      TEXT NOT NULL,
      polarity    REAL,
      intensity   REAL,
      volume      INTEGER NOT NULL DEFAULT 0,
      raw_meta    TEXT,                          -- JSON, optional
      PRIMARY KEY (scope, scope_id, ts, source)
    );
    CREATE INDEX IF NOT EXISTS idx_sent_scope_ts ON sentiment_snapshots(scope, scope_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_sent_source   ON sentiment_snapshots(source, ts DESC);

    -- Composite Reality Index time-series. One row per scope per ts with
    -- the four components separated so the UI can show a breakdown.
    CREATE TABLE IF NOT EXISTS reality_index_snapshots (
      scope               TEXT NOT NULL,         -- 'event' | 'cluster'
      scope_id            TEXT NOT NULL,
      ts                  INTEGER NOT NULL,
      market_probability  REAL,                  -- 0..1 (weighted top-market avg)
      media_sentiment     REAL,                  -- -1..+1
      social_sentiment    REAL,                  -- -1..+1 (avg across enabled sources)
      economic_signal     REAL,                  -- -1..+1 (placeholder for Phase 5)
      truth_gap           REAL,                  -- signed: market_norm - media_norm
      reality_score       REAL,                  -- 0..1 composite
      confidence          REAL,                  -- 0..1
      components          TEXT,                  -- JSON: per-component detail
      PRIMARY KEY (scope, scope_id, ts)
    );
    CREATE INDEX IF NOT EXISTS idx_ris_scope_ts  ON reality_index_snapshots(scope, scope_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_ris_truth_gap ON reality_index_snapshots(scope, ts DESC, truth_gap);

    -- Anomaly alerts surfaced to the UI / push channel.
    -- type:
    --   odds_shift       — market YES moved >= threshold pp in the window
    --   viral_no_react   — social volume spiked but market did not move
    --   sentiment_flip   — per-source polarity flipped sign with high intensity
    --   truth_gap_spike  — |truth_gap| jumped >= threshold in the window
    CREATE TABLE IF NOT EXISTS anomaly_alerts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id      TEXT,
      cluster_id    TEXT,
      market_id     TEXT,
      type          TEXT NOT NULL,
      severity      REAL NOT NULL,               -- 0..1
      payload       TEXT NOT NULL,               -- JSON: details for the UI
      detected_at   INTEGER NOT NULL,
      acknowledged  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_anom_event   ON anomaly_alerts(event_id, detected_at DESC);
    CREATE INDEX IF NOT EXISTS idx_anom_unack   ON anomaly_alerts(acknowledged, detected_at DESC);
    CREATE INDEX IF NOT EXISTS idx_anom_type    ON anomaly_alerts(type, detected_at DESC);
  `);

  logger.info("🧠 Reality Index schema ready");
}
