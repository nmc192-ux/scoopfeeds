import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { runMigrations } from "../db/migrate.js";
import { timedQuery } from "../db/queryTiming.js";
import { logger } from "../services/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DB directory. Defaults to backend/data/ for local dev, but can be
// overridden via SCOOP_PERSISTENT_DATA_DIR so the database survives
// Hostinger redeploys that wipe untracked files via `git clean -fd`.
// Point SCOOP_PERSISTENT_DATA_DIR at a path OUTSIDE the deploy directory
// (e.g. ~/.scoopfeeds-data) and the DB — including social_posts, articles,
// and all other tables — will persist across every deploy.
const dataDir = process.env.SCOOP_PERSISTENT_DATA_DIR
  ? path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR)
  : path.join(__dirname, "../../data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const DB_PATH = path.join(dataDir, "news.db");
let db;

export function getDbPath() {
  return DB_PATH;
}

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("cache_size = 10000");
    db.pragma("temp_store = MEMORY");
    db.pragma("busy_timeout = 5000");
    initializeSchema(db);
    runMigrations(db);
    logger.info("Database initialized", { path: DB_PATH });
  }
  return db;
}

export function getDbStatus() {
  const database = getDb();
  timedQuery("db:status", () => database.prepare("SELECT 1 AS ok").get(), { warnMs: 20 });
  return {
    ok: true,
    path: DB_PATH,
  };
}

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT,
      content     TEXT,
      url         TEXT UNIQUE NOT NULL,
      image_url   TEXT,
      source_name TEXT NOT NULL,
      category    TEXT NOT NULL,
      region      TEXT DEFAULT 'global',
      author      TEXT,
      published_at INTEGER NOT NULL,
      fetched_at  INTEGER NOT NULL,
      credibility INTEGER DEFAULT 8,
      is_featured INTEGER DEFAULT 0,
      view_count  INTEGER DEFAULT 0,
      tags        TEXT DEFAULT '[]',
      language    TEXT DEFAULT 'en',
      is_duplicate INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_articles_category   ON articles(category);
    CREATE INDEX IF NOT EXISTS idx_articles_published  ON articles(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_articles_featured   ON articles(is_featured);
    CREATE INDEX IF NOT EXISTS idx_articles_source     ON articles(source_name);

    CREATE TABLE IF NOT EXISTS videos (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      description  TEXT,
      url          TEXT UNIQUE NOT NULL,
      video_id     TEXT NOT NULL,
      thumbnail    TEXT,
      channel_name TEXT NOT NULL,
      channel_id   TEXT,
      category     TEXT NOT NULL,
      region       TEXT DEFAULT 'global',
      published_at INTEGER NOT NULL,
      fetched_at   INTEGER NOT NULL,
      view_count   INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_videos_category    ON videos(category);
    CREATE INDEX IF NOT EXISTS idx_videos_published   ON videos(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_videos_channel     ON videos(channel_name);

    CREATE TABLE IF NOT EXISTS ingestion_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      source_name TEXT NOT NULL,
      category    TEXT NOT NULL,
      status      TEXT NOT NULL,
      articles_fetched INTEGER DEFAULT 0,
      articles_new     INTEGER DEFAULT 0,
      error_msg   TEXT,
      duration_ms INTEGER,
      fetched_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_health (
      source_name TEXT PRIMARY KEY,
      last_success INTEGER,
      last_failure INTEGER,
      consecutive_failures INTEGER DEFAULT 0,
      total_fetches INTEGER DEFAULT 0,
      total_articles INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS analytics (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type  TEXT NOT NULL,
      article_id  TEXT,
      category    TEXT,
      ip_hash     TEXT,
      user_agent_hash TEXT,
      metadata    TEXT DEFAULT '{}',
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      method          TEXT NOT NULL,
      path            TEXT NOT NULL,
      request_id      TEXT NOT NULL,
      actor_type      TEXT NOT NULL,
      ip_hash         TEXT,
      user_agent_hash TEXT,
      created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_request ON admin_audit_logs(request_id);

    CREATE TABLE IF NOT EXISTS background_job_runs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      queue         TEXT NOT NULL,
      job_name      TEXT NOT NULL,
      job_id        TEXT,
      status        TEXT NOT NULL,
      attempts      INTEGER DEFAULT 0,
      started_at    INTEGER,
      finished_at   INTEGER,
      duration_ms   INTEGER,
      error_message TEXT,
      error_stack   TEXT,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_background_job_runs_created ON background_job_runs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_background_job_runs_queue ON background_job_runs(queue, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_background_job_runs_job_id ON background_job_runs(job_id);

    CREATE TABLE IF NOT EXISTS api_slow_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      method        TEXT NOT NULL,
      path          TEXT NOT NULL,
      status        INTEGER NOT NULL,
      duration_ms   INTEGER NOT NULL,
      request_id    TEXT NOT NULL,
      process_role  TEXT,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_api_slow_logs_created ON api_slow_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_api_slow_logs_request ON api_slow_logs(request_id);

    CREATE TABLE IF NOT EXISTS job_idempotency_keys (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      scope           TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'active',
      created_at      INTEGER NOT NULL,
      expires_at      INTEGER,
      metadata        TEXT DEFAULT '{}',
      UNIQUE(scope, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_job_idempotency_scope_status
      ON job_idempotency_keys(scope, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_job_idempotency_expires
      ON job_idempotency_keys(expires_at);

    CREATE TABLE IF NOT EXISTS subscribers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      email        TEXT NOT NULL UNIQUE,
      country_code TEXT,
      language     TEXT DEFAULT 'en',
      topics       TEXT DEFAULT '[]',
      token        TEXT NOT NULL,
      verified_at  INTEGER,
      unsubscribed_at INTEGER,
      created_at   INTEGER NOT NULL,
      last_sent_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(email);
    CREATE INDEX IF NOT EXISTS idx_subscribers_token ON subscribers(token);

    -- ─── Push notification subscriptions ──────────────────────────────────
    -- One row per browser+device opt-in. The endpoint URL is unique per
    -- subscription (browsers re-issue if the user clears storage). p256dh
    -- and auth are the per-subscription crypto keys we need to encrypt
    -- payloads. Topics is a JSON array of category strings the user opted
    -- into; empty/null means "all breaking news only".
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint    TEXT NOT NULL UNIQUE,
      p256dh      TEXT NOT NULL,
      auth        TEXT NOT NULL,
      topics      TEXT DEFAULT '[]',
      country     TEXT,
      language    TEXT DEFAULT 'en',
      user_agent  TEXT,
      created_at  INTEGER NOT NULL,
      last_sent_at INTEGER,
      failure_count INTEGER DEFAULT 0,
      disabled_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_push_endpoint ON push_subscriptions(endpoint);
    CREATE INDEX IF NOT EXISTS idx_push_active ON push_subscriptions(disabled_at);

    -- Tracks which articles have already been broadcast as a push, so the
    -- breaking-news worker never pushes the same story twice (one row per
    -- article × topic — most rows will have topic = '*' for the global
    -- broadcast).
    CREATE TABLE IF NOT EXISTS pushed_articles (
      article_id TEXT NOT NULL,
      topic      TEXT NOT NULL DEFAULT '*',
      pushed_at  INTEGER NOT NULL,
      sent       INTEGER DEFAULT 0,
      failed     INTEGER DEFAULT 0,
      PRIMARY KEY (article_id, topic)
    );
    CREATE INDEX IF NOT EXISTS idx_pushed_recency ON pushed_articles(pushed_at);

    -- Audit log of every outbound social post. Unique on (article, platform)
    -- so the same article never posts twice to the same network. The
    -- platform_post_id + url come back from the platform's API and are
    -- handy for later metrics fetching + manual moderation.
    CREATE TABLE IF NOT EXISTS social_posts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id      TEXT NOT NULL,
      platform        TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'posted',
      platform_post_id TEXT,
      url             TEXT,
      caption         TEXT,
      error           TEXT,
      posted_at       INTEGER NOT NULL,
      UNIQUE(article_id, platform)
    );
    CREATE INDEX IF NOT EXISTS idx_social_recency ON social_posts(posted_at);
    CREATE INDEX IF NOT EXISTS idx_social_platform ON social_posts(platform, posted_at);

    -- ─── Tips (Stripe donations) ──────────────────────────────────────
    -- One row per completed Stripe Checkout payment. Populated by the
    -- /api/tips/webhook handler on checkout.session.completed events.
    CREATE TABLE IF NOT EXISTS tips (
      id              TEXT PRIMARY KEY,   -- Stripe checkout session id
      amount_cents    INTEGER NOT NULL,
      currency        TEXT NOT NULL DEFAULT 'usd',
      email           TEXT,               -- Stripe provides this on success
      message         TEXT,               -- optional note from donor (future)
      status          TEXT NOT NULL DEFAULT 'pending',  -- pending | completed | failed
      stripe_pi       TEXT,               -- payment_intent id
      created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tips_created ON tips(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tips_status  ON tips(status);

    -- ─── Metered paywall ─────────────────────────────────────────────
    -- Tracks article opens per device (identified by SHA-256(IP+UA) hash) or
    -- per authenticated user. Limit is METER_FREE_LIMIT env var (default 10/mo).
    -- Premium users (tier='premium') are excluded from the check entirely.
    CREATE TABLE IF NOT EXISTS meter_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      device_key TEXT NOT NULL,   -- SHA-256(IP+UA) for anon, user_id for auth
      article_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(device_key, article_id)  -- each article counts once per device
    );
    CREATE INDEX IF NOT EXISTS idx_meter_device ON meter_events(device_key, created_at DESC);

    -- ─── Magic-link Auth ─────────────────────────────────────────────
    -- users: one row per verified email. Stores cross-device preferences.
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,          -- UUID v4
      email        TEXT NOT NULL UNIQUE,
      created_at   INTEGER NOT NULL,
      last_login_at INTEGER,
      preferred_topics  TEXT DEFAULT '[]',    -- JSON array of category strings
      preferred_country TEXT,
      language     TEXT DEFAULT 'en',
      subscriber_token TEXT,                  -- FK to subscribers.token (nullable)
      tier         TEXT NOT NULL DEFAULT 'free'  -- free | premium
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    -- One-time magic-link tokens. Expire after 30 min; can only be used once.
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token      TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_email ON auth_tokens(email);

    -- Per-device sessions. Set as httpOnly cookie; expire after 30 days.
    CREATE TABLE IF NOT EXISTS user_sessions (
      id         TEXT PRIMARY KEY,            -- session token (random hex)
      user_id    TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);

    -- ─── Personalized feed — per-user reading signals ─────────────────
    -- One row per (user, article) upserted on first view; dwell_ms and
    -- saved are bumped as the user reads longer or saves the article.
    -- Used to compute category weights for feed re-ranking.
    CREATE TABLE IF NOT EXISTS user_article_views (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     TEXT NOT NULL REFERENCES users(id),
      article_id  TEXT NOT NULL,
      category    TEXT NOT NULL,
      dwell_ms    INTEGER DEFAULT 0,
      saved       INTEGER DEFAULT 0,
      created_at  INTEGER NOT NULL,
      UNIQUE(user_id, article_id)
    );
    CREATE INDEX IF NOT EXISTS idx_uav_user    ON user_article_views(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_uav_category ON user_article_views(user_id, category);

    -- ─── Short-form video pipeline ────────────────────────────────────
    -- video_jobs: one row per article × render request. Status lifecycle:
    --   queued → rendering → ready → review_approved | review_rejected
    -- Auto-publish fires only once status transitions to review_approved.
    CREATE TABLE IF NOT EXISTS video_jobs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id      TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'queued',  -- queued|rendering|ready|review_approved|review_rejected|published|failed
      output_path     TEXT,          -- absolute path to the MP4 on disk
      has_audio       INTEGER DEFAULT 0,
      duration_secs   INTEGER DEFAULT 0,
      platforms_posted TEXT DEFAULT '[]', -- JSON array of platforms already published to
      error           TEXT,
      thumbnail_b64   TEXT,          -- base64 PNG preview of slide 1 (from previewSlide())
      created_at      INTEGER NOT NULL,
      rendered_at     INTEGER,
      approved_at     INTEGER,
      published_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_video_jobs_article  ON video_jobs(article_id);
    CREATE INDEX IF NOT EXISTS idx_video_jobs_status   ON video_jobs(status, created_at DESC);

    -- Per-platform performance metrics fetched post-publish.
    CREATE TABLE IF NOT EXISTS video_metrics (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id      INTEGER NOT NULL REFERENCES video_jobs(id),
      platform    TEXT NOT NULL,
      platform_id TEXT,              -- native video ID on the platform
      views       INTEGER DEFAULT 0,
      likes       INTEGER DEFAULT 0,
      shares      INTEGER DEFAULT 0,
      click_throughs INTEGER DEFAULT 0,
      fetched_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_video_metrics_job ON video_metrics(job_id);

    -- ─── Live Events (the "Live" tab) ──────────────────────────────────
    -- One row per tracked global event. The full dossier (brief points +
    -- metrics) is stored as JSON blobs so the shape can evolve without
    -- migrations. Config lives in src/config/liveEvents.js; this table
    -- just caches the synthesized output so the frontend reads quickly.
    CREATE TABLE IF NOT EXISTS live_events (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      subtitle    TEXT,
      emoji       TEXT,
      status      TEXT DEFAULT 'active',
      region      TEXT,
      brief       TEXT DEFAULT '[]',    -- JSON: [{ ts, text, sources: [{name,url}] }, ...]
      metrics     TEXT DEFAULT '{}',    -- JSON: { casualties: {...}, economicLoss: {...}, ... }
      summary     TEXT,                 -- 1-2 sentence headline for the list view
      updated_at  INTEGER NOT NULL,
      ceasefire_at INTEGER              -- optional ISO timestamp as ms since epoch
    );

    -- ─── News Analysis — Story Clusters ───────────────────────────────
    -- Auto-detected trending story groups built from bigram clustering of
    -- recent article titles. Brief and perspectives are JSON blobs generated
    -- by Gemini 1.5 Flash every 2h. expires_at = created_at + 24h.
    CREATE TABLE IF NOT EXISTS story_clusters (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      summary      TEXT,
      category     TEXT NOT NULL,
      keywords     TEXT NOT NULL,          -- JSON array of keyword strings
      article_ids  TEXT DEFAULT '[]',      -- JSON array of article IDs used
      article_count INTEGER DEFAULT 0,
      brief        TEXT DEFAULT '[]',      -- JSON: [{ts, text, sources:[{name,url}]}]
      perspectives TEXT,                   -- JSON: [{sourceName, outlets[], angle, quote}]
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_clusters_category ON story_clusters(category);
    CREATE INDEX IF NOT EXISTS idx_clusters_updated  ON story_clusters(updated_at DESC);

    -- ─── News Analysis — Explained Pieces ─────────────────────────────
    -- Long-form Gemini-generated explainers for top-2 trending categories.
    -- content is HTML. facts/timeline/sources are JSON arrays.
    -- expires_at = created_at + 12h.
    CREATE TABLE IF NOT EXISTS explained_pieces (
      id           TEXT PRIMARY KEY,
      slug         TEXT NOT NULL UNIQUE,
      title        TEXT NOT NULL,
      category     TEXT NOT NULL,
      summary      TEXT,
      content      TEXT,                   -- HTML body (400-600 words)
      facts        TEXT DEFAULT '[]',      -- JSON: [{value, unit, label, source}]
      timeline     TEXT DEFAULT '[]',      -- JSON: [{date, event, source}]
      sources      TEXT DEFAULT '[]',      -- JSON: [{name, url}]
      image_url    TEXT,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_explained_updated ON explained_pieces(updated_at DESC);

    -- ─── News Analysis — Article Analysis Cache ────────────────────────
    -- On-demand per-article Gemini analysis. Cached 6h per article_id.
    -- Populated lazily when the user opens the article deep dive panel.
    CREATE TABLE IF NOT EXISTS article_analysis_cache (
      article_id   TEXT PRIMARY KEY,
      takeaways    TEXT DEFAULT '[]',      -- JSON: string[]
      tone         TEXT,                   -- neutral|critical|optimistic|alarming|analytical
      tone_reason  TEXT,
      related_ids  TEXT DEFAULT '[]',      -- JSON: string[]
      created_at   INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL        -- 6h TTL
    );
  `);

  // Lightweight migration: add `language` column on existing deployments.
  try {
    const cols = db.prepare("PRAGMA table_info(articles)").all();
    if (!cols.some((c) => c.name === "language")) {
      db.exec("ALTER TABLE articles ADD COLUMN language TEXT DEFAULT 'en'");
      logger.info("Migrated articles table: +language");
    }
    // Migration: add is_duplicate for same-story cross-source dedup.
    if (!cols.some((c) => c.name === "is_duplicate")) {
      db.exec("ALTER TABLE articles ADD COLUMN is_duplicate INTEGER DEFAULT 0");
      db.exec("CREATE INDEX IF NOT EXISTS idx_articles_dup ON articles(is_duplicate, published_at DESC)");
      logger.info("Migrated articles table: +is_duplicate");
    }
    // Migration: AI-generated Instagram caption summary.
    if (!cols.some((c) => c.name === "ig_summary")) {
      db.exec("ALTER TABLE articles ADD COLUMN ig_summary TEXT");
      logger.info("Migrated articles table: +ig_summary");
    }
  } catch (err) {
    logger.warn("Migration check failed", { error: err.message });
  }

  // Migration: add `tier` column to users (free | premium) for paywall gating.
  try {
    const cols = db.prepare("PRAGMA table_info(users)").all();
    if (cols.length && !cols.some((c) => c.name === "tier")) {
      db.exec("ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'");
      logger.info("Migrated users table: +tier");
    }
    if (cols.length && !cols.some((c) => c.name === "stripe_customer_id")) {
      db.exec("ALTER TABLE users ADD COLUMN stripe_customer_id TEXT");
      logger.info("Migrated users table: +stripe_customer_id");
    }
  } catch (err) {
    logger.warn("Migration check (users.tier) failed", { error: err.message });
  }

  // Migration: add referred_by_token + referral_count to subscribers.
  try {
    const cols = db.prepare("PRAGMA table_info(subscribers)").all();
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("referred_by_token")) {
      db.exec("ALTER TABLE subscribers ADD COLUMN referred_by_token TEXT");
      logger.info("Migrated subscribers table: +referred_by_token");
    }
    // Welcome-sequence tracking — added in Phase 4 to support day-1 + day-3
    // touchpoint emails after the day-0 confirmation.
    if (!names.has("welcome_d1_sent_at")) {
      db.exec("ALTER TABLE subscribers ADD COLUMN welcome_d1_sent_at INTEGER");
      logger.info("Migrated subscribers table: +welcome_d1_sent_at");
    }
    if (!names.has("welcome_d3_sent_at")) {
      db.exec("ALTER TABLE subscribers ADD COLUMN welcome_d3_sent_at INTEGER");
      logger.info("Migrated subscribers table: +welcome_d3_sent_at");
    }
  } catch (err) {
    logger.warn("Migration check (subscribers) failed", { error: err.message });
  }

  // FTS5 full-text search virtual table + sync triggers
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
        title, description, content, source_name,
        content='articles', content_rowid='rowid', tokenize='porter unicode61'
      );

      CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
        INSERT INTO articles_fts(rowid, title, description, content, source_name)
        VALUES (new.rowid, new.title, new.description, new.content, new.source_name);
      END;
      CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
        INSERT INTO articles_fts(articles_fts, rowid, title, description, content, source_name)
        VALUES('delete', old.rowid, old.title, old.description, old.content, old.source_name);
      END;
      CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
        INSERT INTO articles_fts(articles_fts, rowid, title, description, content, source_name)
        VALUES('delete', old.rowid, old.title, old.description, old.content, old.source_name);
        INSERT INTO articles_fts(rowid, title, description, content, source_name)
        VALUES (new.rowid, new.title, new.description, new.content, new.source_name);
      END;
    `);

    // Backfill if FTS is empty but articles exist
    const ftsCount = db.prepare("SELECT COUNT(*) as n FROM articles_fts").get().n;
    const artCount = db.prepare("SELECT COUNT(*) as n FROM articles").get().n;
    if (ftsCount === 0 && artCount > 0) {
      db.exec(`INSERT INTO articles_fts(rowid, title, description, content, source_name)
               SELECT rowid, title, description, content, source_name FROM articles`);
      logger.info("FTS5 backfilled", { count: artCount });
    }
  } catch (err) {
    logger.warn("FTS5 init failed, falling back to LIKE search", { error: err.message });
  }
}

function ftsAvailable(db) {
  try {
    db.prepare("SELECT 1 FROM articles_fts LIMIT 1").get();
    return true;
  } catch { return false; }
}

function escapeFts(q) {
  // Quote each token for safe FTS5 MATCH: "foo"* "bar"*
  return q.trim().split(/\s+/).filter(Boolean)
    .map(t => `"${t.replace(/"/g, '""')}"*`).join(" ");
}

// ─── Article Operations ────────────────────────────────────────────────────

export function upsertArticle(article) {
  return getDb().prepare(`
    INSERT OR IGNORE INTO articles
      (id, title, description, content, url, image_url, source_name,
       category, region, author, published_at, fetched_at, credibility, tags, language)
    VALUES
      (@id, @title, @description, @content, @url, @image_url, @source_name,
       @category, @region, @author, @published_at, @fetched_at, @credibility, @tags,
       COALESCE(@language, 'en'))
  `).run(article);
}

// ─── Same-story cross-source dedup ───────────────────────────────────────────
//
// When Reuters AND BBC AND AP all cover the same UN vote, three cards appear in
// the feed. This dedup layer keeps the highest-credibility version and marks
// the others as is_duplicate=1 so getArticles() filters them out.
//
// Algorithm:
//   1. Extract meaningful title tokens (length ≥ 4, not stopwords) for the
//      newly-ingested article.
//   2. Query the last 4h for articles from different sources.
//   3. Compare Jaccard similarity on token sets.
//   4. If similarity ≥ 0.55 AND at least 4 tokens in the intersection:
//        → mark the lower-credibility article as is_duplicate = 1.
//        → if equal credibility, mark the newer one (keep the first published).
//
// Called from rssFetcher.js after every successful upsertArticle().
// Never throws — failures are silently swallowed so ingestion is never blocked.

const _DEDUP_STOPWORDS = new Set([
  "about", "after", "again", "against", "could", "during", "first", "from",
  "have", "having", "here", "into", "more", "most", "over", "says", "such",
  "their", "there", "these", "they", "this", "through", "under", "until",
  "what", "when", "where", "which", "while", "with", "would", "your", "that",
  "will", "been", "were", "also", "just", "than", "them", "then", "some",
  "very", "only", "even", "many", "much", "must", "make", "made", "back",
  "before", "between", "other", "still", "those", "while", "against", "among",
  "because", "being", "both", "each", "every", "however", "same", "should",
  "says", "said", "says", "amid", "after", "over", "amid", "amid", "amid",
  "amid", "news", "report", "reports", "update", "updates", "latest", "live",
]);

function _titleTokens(title) {
  if (!title || typeof title !== "string") return new Set();
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !_DEDUP_STOPWORDS.has(t)),
  );
}

export function markDuplicateIfSimilar(article) {
  if (!article || !article.title || !article.id) return;

  const db = getDb();
  const newTokens = _titleTokens(article.title);
  if (newTokens.size < 3) return; // title too short to dedup reliably

  // Look at articles from a different source published within ±4 hours,
  // credibility ≥ 7, not already marked as a duplicate. Cap at 60 candidates
  // (ORDER BY credibility DESC so the best version rises to the top).
  const windowMs = 4 * 60 * 60 * 1000;
  const lo = (article.published_at || Date.now()) - windowMs;
  const hi = (article.published_at || Date.now()) + windowMs;

  const candidates = db.prepare(`
    SELECT id, title, credibility, source_name, published_at
    FROM   articles
    WHERE  id != ?
      AND  source_name != ?
      AND  published_at BETWEEN ? AND ?
      AND  is_duplicate = 0
    ORDER BY credibility DESC, published_at ASC
    LIMIT 60
  `).all(article.id, article.source_name || "", lo, hi);

  for (const cand of candidates) {
    const candTokens = _titleTokens(cand.title);
    if (candTokens.size < 3) continue;

    const intersection = [...newTokens].filter((t) => candTokens.has(t));
    if (intersection.length < 4) continue; // must share at least 4 meaningful words

    const union = new Set([...newTokens, ...candTokens]);
    const jaccard = intersection.length / union.size;
    if (jaccard < 0.55) continue;

    // They're the same story — decide which to keep.
    let keepId, dupId;
    if ((article.credibility || 0) > (cand.credibility || 0)) {
      keepId = article.id; dupId = cand.id;
    } else if ((cand.credibility || 0) > (article.credibility || 0)) {
      keepId = cand.id;    dupId = article.id;
    } else {
      // Equal credibility — keep the earlier-published one.
      keepId = (article.published_at || 0) <= (cand.published_at || 0) ? article.id : cand.id;
      dupId  = keepId === article.id ? cand.id : article.id;
    }

    db.prepare(`UPDATE articles SET is_duplicate = 1 WHERE id = ?`).run(dupId);
    logger.debug(`dedup: marked ${dupId} as duplicate of ${keepId} (jaccard=${jaccard.toFixed(2)})`);

    // If the newly-inserted article itself is the duplicate, no need to check more.
    if (dupId === article.id) return;
  }
}

export function getArticles({
  category,
  categories = null,   // array of categories to OR-match (new; beats `category`)
  regions = null,      // array of region values to OR-match (Local tab)
  limit = 50,
  offset = 0,
  search = null,
  minCredibility = 0,
  source = null,
}) {
  const db = getDb();
  const useFts = search && ftsAvailable(db);
  // is_duplicate = 0 filters out same-story cross-source near-duplicates so the
  // feed only shows one version of each story (the highest-credibility source).
  let query = useFts
    ? `SELECT articles.* FROM articles JOIN articles_fts ON articles.rowid = articles_fts.rowid
       WHERE articles_fts MATCH ? AND credibility >= ? AND articles.is_duplicate = 0`
    : `SELECT * FROM articles WHERE credibility >= ? AND is_duplicate = 0`;
  const params = useFts ? [escapeFts(search), minCredibility] : [minCredibility];

  // Multi-category OR (new tab model). Fallback to single-category for back-compat.
  if (Array.isArray(categories) && categories.length > 0) {
    query += ` AND category IN (${categories.map(() => "?").join(",")})`;
    params.push(...categories);
  } else if (category && category !== "top") {
    query += ` AND category = ?`;
    params.push(category);
  }

  // Region filter (used for the Local tab — resolved from user's country).
  if (Array.isArray(regions) && regions.length > 0) {
    query += ` AND region IN (${regions.map(() => "?").join(",")})`;
    params.push(...regions);
  }

  if (source) { query += ` AND source_name = ?`; params.push(source); }
  if (search && !useFts) { query += ` AND (title LIKE ? OR description LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }

  // For the mixed "top" feed (no category filter), bucket into 3-hour windows then
  // prioritise by editorial weight so politics/international rise above sports/cars.
  // Single-category views use plain recency (all articles share the same priority).
  const hasCategoryFilter =
    (Array.isArray(categories) && categories.length > 0) ||
    (category && category !== "top");
  const isMixedFeed = !hasCategoryFilter;
  query += isMixedFeed
    ? ` ORDER BY (published_at / 10800000) DESC,
        CASE category
          WHEN 'top'          THEN 1
          WHEN 'politics'     THEN 2
          WHEN 'pakistan'     THEN 3
          WHEN 'international'THEN 4
          WHEN 'science'      THEN 5
          WHEN 'medicine'     THEN 5
          WHEN 'public-health'THEN 5
          WHEN 'health'       THEN 6
          WHEN 'environment'  THEN 7
          WHEN 'self-help'    THEN 8
          WHEN 'sports'       THEN 9
          WHEN 'cars'         THEN 10
          ELSE 6
        END ASC,
        credibility DESC, published_at DESC LIMIT ? OFFSET ?`
    : ` ORDER BY published_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  return db.prepare(query).all(...params);
}

export function getFeaturedArticles(limit = 7) {
  return getDb().prepare(`
    SELECT * FROM articles WHERE credibility >= 8 AND is_duplicate = 0
    ORDER BY
      (published_at / 10800000) DESC,
      CASE category
        WHEN 'top'          THEN 1
        WHEN 'politics'     THEN 2
        WHEN 'pakistan'     THEN 3
        WHEN 'international'THEN 4
        WHEN 'science'      THEN 5
        WHEN 'medicine'     THEN 5
        WHEN 'public-health'THEN 5
        WHEN 'health'       THEN 6
        WHEN 'environment'  THEN 7
        WHEN 'self-help'    THEN 8
        WHEN 'sports'       THEN 9
        WHEN 'cars'         THEN 10
        ELSE 6
      END ASC,
      credibility DESC, published_at DESC
    LIMIT ?
  `).all(limit);
}

export function getArticleById(id)    { return getDb().prepare("SELECT * FROM articles WHERE id = ?").get(id); }
export function incrementViewCount(id){ getDb().prepare("UPDATE articles SET view_count = view_count + 1 WHERE id = ?").run(id); }

// Lowercase + strip diacritics + drop non-alphanumerics, returning a Set of
// meaningful tokens. NFD-normalise so "Atlético" (e + ◌́) decomposes and the
// combining mark gets stripped — without this, "Atlético" and "Atletico"
// tokenise to disjoint sets and never match across sources.
function _coverageTokens(title) {
  if (!title || typeof title !== "string") return new Set();
  return new Set(
    title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !STOPWORDS.has(t)),
  );
}

// Cross-source coverage — other sources covering the same story, used by the
// article SSR page to build a "Also covered by" block. This is what turns our
// page from "scraped rewrite" into aggregation with genuine editorial value.
//
// Approach (vs. the previous "any-of-N tokens LIKE-match" version, which
// surfaced unrelated stories whenever they shared a single common word like
// "trial" or "court"):
//   1. Tokenise the parent title (length ≥ 4, non-stopword, accent-folded),
//      keep top 8.
//   2. SQL-fetch a broad candidate pool — different source, last 3 days,
//      ANY token match — then SCORE in JS.
//   3. Score = number of meaningful token overlaps with parent. Require at
//      least 2 overlaps AND a Jaccard ≥ 0.13 to qualify as "same story".
//   4. Sort by score desc, then recency desc, return top `limit`.
//
// The Jaccard floor is much looser than the de-dup threshold (0.55) since
// "covered by" is a meaningful-overlap signal, not an exact-duplicate one.
// 0.13 lets a 2-token overlap pass when titles are long (e.g. "Trump" +
// "astronauts" between two ~10-token headlines).
export function listAlternateCoverage(article, limit = 4) {
  if (!article || !article.title) return [];

  const parentTokens = _coverageTokens(article.title);
  if (parentTokens.size < 2) return [];

  // Build SQL LIKE search terms. Include both the diacritic-folded token
  // ("atletico") AND the raw lowercased form from the title ("atlético")
  // so the SQL pre-filter catches both. Without the raw form, "Atlético"
  // candidates never make it past the SQL stage to be scored.
  const rawLowerTitle = (article.title || "").toLowerCase();
  const tokens = [...parentTokens].slice(0, 8);
  const searchTerms = new Set();
  for (const t of tokens) searchTerms.add(t);
  for (const word of rawLowerTitle.replace(/[^a-z0-9À-ɏ\s]/g, " ").split(/\s+/)) {
    if (word.length >= 4 && !STOPWORDS.has(word)) searchTerms.add(word);
  }
  const searchTermsArr = [...searchTerms].slice(0, 16);

  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const likes = searchTermsArr.map(() => `LOWER(title) LIKE ?`).join(" OR ");
  const params = [
    article.id,
    article.source_name || "",
    cutoff,
    ...searchTermsArr.map((t) => `%${t}%`),
  ];

  // Cast a wide net — score & filter in JS where we have the candidate
  // titles. Cap at 80 to keep the worst case bounded.
  const candidates = getDb().prepare(`
    SELECT id, title, url, source_name, published_at, category, image_url
    FROM articles
    WHERE id != ? AND source_name != ? AND published_at > ?
      AND (${likes})
      AND is_duplicate = 0
    ORDER BY published_at DESC
    LIMIT 80
  `).all(...params);

  const scored = [];
  for (const c of candidates) {
    const candTokens = _coverageTokens(c.title);
    if (candTokens.size < 2) continue;

    let intersection = 0;
    for (const t of parentTokens) if (candTokens.has(t)) intersection++;
    if (intersection < 2) continue;

    const union = new Set([...parentTokens, ...candTokens]).size;
    const jaccard = union > 0 ? intersection / union : 0;
    if (jaccard < 0.13) continue;

    scored.push({ ...c, _score: intersection, _jaccard: jaccard });
  }

  scored.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    if (b._jaccard !== a._jaccard) return b._jaccard - a._jaccard;
    return (b.published_at || 0) - (a.published_at || 0);
  });

  // Strip internal scoring fields before returning.
  return scored.slice(0, limit).map(({ _score, _jaccard, ...rest }) => rest);
}

// Related stories — same category, different URL, sorted by recency. Used on
// the article SSR page to increase internal linking + pages-per-session.
export function listRelatedStories(article, limit = 5) {
  if (!article) return [];
  return getDb().prepare(`
    SELECT id, title, source_name, published_at, category, image_url
    FROM articles
    WHERE id != ? AND category = ? AND published_at > ?
    ORDER BY published_at DESC
    LIMIT ?
  `).all(
    article.id,
    article.category,
    Date.now() - 3 * 24 * 60 * 60 * 1000,
    limit,
  );
}

const STOPWORDS = new Set([
  "about", "after", "again", "against", "could", "during", "first", "from",
  "have", "having", "here", "into", "more", "most", "over", "says", "such",
  "their", "there", "these", "they", "this", "through", "under", "until",
  "what", "when", "where", "which", "while", "with", "would", "your", "that",
  "will", "been", "were", "also", "just", "than", "them", "then", "some",
  "very", "only", "even", "many", "much", "must", "make", "made", "back",
  "before", "between", "other", "still", "those", "while", "against", "among",
  "because", "being", "both", "each", "every", "however", "same", "should",
]);

export function getTopicCounts() {
  return getDb().prepare(`SELECT category, COUNT(*) as count FROM articles GROUP BY category ORDER BY count DESC`).all();
}

export function getArticleCount() { return getDb().prepare("SELECT COUNT(*) as count FROM articles").get(); }

export function pruneOldArticles(daysToKeep = 7) {
  const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
  const a = getDb().prepare("DELETE FROM articles WHERE fetched_at < ?").run(cutoff);
  const v = getDb().prepare("DELETE FROM videos WHERE fetched_at < ?").run(cutoff);
  // event_articles has no FK to articles, so pruning articles would otherwise leave
  // its links dangling — which accumulated to 91% of the graph and blocked Phase 4c
  // (see migration 011). Self-healing sweep: drop any link whose article is now gone.
  getDb().prepare("DELETE FROM event_articles WHERE article_id NOT IN (SELECT id FROM articles)").run();
  return a.changes + v.changes;
}

// ─── Video Operations ──────────────────────────────────────────────────────

export function upsertVideo(video) {
  return getDb().prepare(`
    INSERT OR IGNORE INTO videos
      (id, title, description, url, video_id, thumbnail, channel_name, channel_id,
       category, region, published_at, fetched_at)
    VALUES
      (@id, @title, @description, @url, @video_id, @thumbnail, @channel_name, @channel_id,
       @category, @region, @published_at, @fetched_at)
  `).run(video);
}

export function getVideos({ category, limit = 20, offset = 0 } = {}) {
  const db = getDb();
  let query = `SELECT * FROM videos WHERE 1=1`;
  const params = [];
  if (category && category !== "top") { query += ` AND category = ?`; params.push(category); }
  query += ` ORDER BY published_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  return db.prepare(query).all(...params);
}

export function getVideosByCategories(categories, limit = 12) {
  const db = getDb();
  if (!categories || categories.length === 0) {
    return db.prepare(`SELECT * FROM videos ORDER BY published_at DESC LIMIT ?`).all(limit);
  }
  const ph = categories.map(() => "?").join(",");
  return db.prepare(`SELECT * FROM videos WHERE category IN (${ph}) ORDER BY published_at DESC LIMIT ?`).all(...categories, limit);
}

export function getVideoCount() { return getDb().prepare("SELECT COUNT(*) as count FROM videos").get(); }

// ─── Ingestion Logs ────────────────────────────────────────────────────────

export function logIngestionEvent(data) {
  getDb().prepare(`
    INSERT INTO ingestion_logs
      (source_name, category, status, articles_fetched, articles_new, error_msg, duration_ms, fetched_at)
    VALUES
      (@source_name, @category, @status, @articles_fetched, @articles_new, @error_msg, @duration_ms, @fetched_at)
  `).run(data);
}

export function updateSourceHealth(sourceName, success, count = 0) {
  const db = getDb();
  const now = Date.now();
  if (success) {
    db.prepare(`
      INSERT INTO source_health (source_name, last_success, consecutive_failures, total_fetches, total_articles)
      VALUES (?, ?, 0, 1, ?)
      ON CONFLICT(source_name) DO UPDATE SET
        last_success = excluded.last_success,
        consecutive_failures = 0,
        total_fetches = total_fetches + 1,
        total_articles = total_articles + ?
    `).run(sourceName, now, count, count);
  } else {
    db.prepare(`
      INSERT INTO source_health (source_name, last_failure, consecutive_failures, total_fetches)
      VALUES (?, ?, 1, 1)
      ON CONFLICT(source_name) DO UPDATE SET
        last_failure = excluded.last_failure,
        consecutive_failures = consecutive_failures + 1,
        total_fetches = total_fetches + 1
    `).run(sourceName, now);
  }
}

export function getSourceHealth() {
  return getDb().prepare("SELECT * FROM source_health ORDER BY total_articles DESC").all();
}

// ─── Analytics ────────────────────────────────────────────────────────────

export function trackEvent(eventType, data = {}) {
  getDb().prepare(`
    INSERT INTO analytics (event_type, article_id, category, ip_hash, user_agent_hash, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(eventType, data.articleId||null, data.category||null, data.ipHash||null, data.uaHash||null, JSON.stringify(data.metadata||{}), Date.now());
}

export function insertAdminAuditLog({
  method,
  path,
  requestId,
  actorType,
  ipHash = null,
  userAgentHash = null,
  createdAt = Date.now(),
}) {
  getDb().prepare(`
    INSERT INTO admin_audit_logs
      (method, path, request_id, actor_type, ip_hash, user_agent_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(method, path, requestId, actorType, ipHash, userAgentHash, createdAt);
}

export function insertBackgroundJobRun({
  queue,
  jobName,
  jobId = null,
  status = "running",
  attempts = 0,
  startedAt = null,
  finishedAt = null,
  durationMs = null,
  errorMessage = null,
  errorStack = null,
  createdAt = Date.now(),
}) {
  const result = getDb().prepare(`
    INSERT INTO background_job_runs
      (queue, job_name, job_id, status, attempts, started_at, finished_at, duration_ms, error_message, error_stack, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    queue,
    jobName,
    jobId,
    status,
    attempts,
    startedAt,
    finishedAt,
    durationMs,
    errorMessage,
    errorStack,
    createdAt,
  );
  return result.lastInsertRowid;
}

export function updateBackgroundJobRun(id, {
  status,
  attempts,
  startedAt,
  finishedAt,
  durationMs,
  errorMessage = null,
  errorStack = null,
}) {
  getDb().prepare(`
    UPDATE background_job_runs
    SET status = ?,
        attempts = ?,
        started_at = ?,
        finished_at = ?,
        duration_ms = ?,
        error_message = ?,
        error_stack = ?
    WHERE id = ?
  `).run(status, attempts, startedAt, finishedAt, durationMs, errorMessage, errorStack, id);
}

export function insertApiSlowLog({
  method,
  path,
  status,
  durationMs,
  requestId,
  processRole = null,
  createdAt = Date.now(),
}) {
  const result = getDb().prepare(`
    INSERT INTO api_slow_logs
      (method, path, status, duration_ms, request_id, process_role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(method, path, status, durationMs, requestId, processRole, createdAt);
  return result.lastInsertRowid;
}

export function listRecentFailedBackgroundJobs(limit = 10) {
  return getDb().prepare(`
    SELECT queue, job_name, job_id, status, attempts, started_at, finished_at, duration_ms, error_message, created_at
    FROM background_job_runs
    WHERE status = 'failed'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

export function listRecentSlowApis(limit = 20) {
  return getDb().prepare(`
    SELECT method, path, status, duration_ms, request_id, process_role, created_at
    FROM api_slow_logs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

export function getAnalyticsSummary() {
  const db = getDb();
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return {
    totalArticles:    db.prepare("SELECT COUNT(*) as n FROM articles").get().n,
    totalVideos:      db.prepare("SELECT COUNT(*) as n FROM videos").get().n,
    articlesToday:    db.prepare("SELECT COUNT(*) as n FROM articles WHERE fetched_at > ?").get(oneDayAgo).n,
    topCategories:    db.prepare("SELECT category, COUNT(*) as n FROM articles GROUP BY category ORDER BY n DESC LIMIT 5").all(),
    recentIngestions: db.prepare("SELECT * FROM ingestion_logs ORDER BY fetched_at DESC LIMIT 20").all(),
    sourceHealth:     getSourceHealth(),
  };
}

// ─── Live Events (dossier cache) ──────────────────────────────────────────
// Articles related to an event are looked up via keyword OR-match. We rank
// preferred sources (e.g. Al Jazeera for Middle East) higher so the
// synthesizer has trustworthy material to work with.
export function findArticlesForEvent({ keywords = [], preferredSources = [], limit = 30 } = {}) {
  if (keywords.length === 0) return [];
  const db = getDb();
  const likeClauses = keywords.map(() => `(LOWER(title) LIKE ? OR LOWER(description) LIKE ?)`).join(" OR ");
  const params = keywords.flatMap((k) => [`%${k.toLowerCase()}%`, `%${k.toLowerCase()}%`]);
  // 7-day lookback window — older context rarely helps a live brief.
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const rows = db.prepare(`
    SELECT id, title, description, url, source_name, published_at, category
    FROM articles
    WHERE published_at > ? AND (${likeClauses})
    ORDER BY published_at DESC
    LIMIT ?
  `).all(cutoff, ...params, Math.min(limit * 3, 200));

  // Boost preferred sources, then trim.
  const prefSet = new Set(preferredSources.map((s) => s.toLowerCase()));
  rows.sort((a, b) => {
    const aPref = prefSet.has((a.source_name || "").toLowerCase()) ? 1 : 0;
    const bPref = prefSet.has((b.source_name || "").toLowerCase()) ? 1 : 0;
    if (aPref !== bPref) return bPref - aPref;
    return b.published_at - a.published_at;
  });
  return rows.slice(0, limit);
}

export function upsertLiveEvent(evt) {
  const db = getDb();
  db.prepare(`
    INSERT INTO live_events (id, title, subtitle, emoji, status, region, brief, metrics, summary, updated_at, ceasefire_at)
    VALUES (@id, @title, @subtitle, @emoji, @status, @region, @brief, @metrics, @summary, @updated_at, @ceasefire_at)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      subtitle = excluded.subtitle,
      emoji = excluded.emoji,
      status = excluded.status,
      region = excluded.region,
      brief = excluded.brief,
      metrics = excluded.metrics,
      summary = excluded.summary,
      updated_at = excluded.updated_at,
      ceasefire_at = excluded.ceasefire_at
  `).run({
    id: evt.id,
    title: evt.title,
    subtitle: evt.subtitle || null,
    emoji: evt.emoji || null,
    status: evt.status || "active",
    region: evt.region || null,
    brief: JSON.stringify(evt.brief || []),
    metrics: JSON.stringify(evt.metrics || {}),
    summary: evt.summary || null,
    updated_at: evt.updated_at || Date.now(),
    ceasefire_at: evt.ceasefire_at || null,
  });
}

function hydrateEvent(row) {
  if (!row) return null;
  let brief = [];
  let metrics = {};
  try { brief = JSON.parse(row.brief || "[]"); } catch {}
  try { metrics = JSON.parse(row.metrics || "{}"); } catch {}
  return { ...row, brief, metrics };
}

export function listLiveEvents() {
  const rows = getDb().prepare(`
    SELECT id, title, subtitle, emoji, status, region, summary, updated_at, ceasefire_at
    FROM live_events ORDER BY updated_at DESC
  `).all();
  return rows;
}

export function getLiveEvent(id) {
  const row = getDb().prepare(`SELECT * FROM live_events WHERE id = ?`).get(id);
  return hydrateEvent(row);
}

// ─── Push Subscriptions ──────────────────────────────────────────────────

export function upsertPushSubscription({ endpoint, p256dh, auth, topics, country, language, userAgent, userId = null }) {
  const now = Date.now();
  const topicsJson = JSON.stringify(Array.isArray(topics) ? topics : []);
  // user_id is preserved on subsequent upserts unless a new userId is provided
  // (don't unset a known association by accident).
  getDb().prepare(`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, topics, country, language, user_agent, created_at, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      topics = excluded.topics,
      country = excluded.country,
      language = excluded.language,
      user_agent = excluded.user_agent,
      disabled_at = NULL,
      failure_count = 0,
      user_id = COALESCE(excluded.user_id, push_subscriptions.user_id)
  `).run(endpoint, p256dh, auth, topicsJson, country || null, language || "en", (userAgent || "").slice(0, 200), now, userId);
}

// Active push subscriptions for a set of user_ids — used by the watchlist
// push dispatcher (Phase 4c). Empty input → empty output (no broadcast leak).
export function listSubscriptionsForUsers(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];
  const placeholders = userIds.map(() => "?").join(",");
  return getDb().prepare(`
    SELECT id, endpoint, p256dh, auth, topics, country, language, user_id
    FROM push_subscriptions
    WHERE disabled_at IS NULL AND user_id IN (${placeholders})
  `).all(...userIds);
}

export function deletePushSubscription(endpoint) {
  return getDb().prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(endpoint).changes;
}

export function listActivePushSubscriptions({ topic } = {}) {
  const rows = getDb().prepare(`
    SELECT id, endpoint, p256dh, auth, topics, country, language
    FROM push_subscriptions
    WHERE disabled_at IS NULL
  `).all();
  if (!topic) return rows;
  return rows.filter((r) => {
    try { const t = JSON.parse(r.topics || "[]"); return !t.length || t.includes(topic); }
    catch { return true; }
  });
}

export function markPushSent(endpoint, success) {
  const now = Date.now();
  if (success) {
    getDb().prepare(`UPDATE push_subscriptions SET last_sent_at = ?, failure_count = 0 WHERE endpoint = ?`).run(now, endpoint);
  } else {
    getDb().prepare(`UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE endpoint = ?`).run(endpoint);
  }
}

export function disablePushSubscription(endpoint) {
  getDb().prepare(`UPDATE push_subscriptions SET disabled_at = ? WHERE endpoint = ?`).run(Date.now(), endpoint);
}

export function pushSubscriptionStats() {
  return getDb().prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN disabled_at IS NULL THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN disabled_at IS NOT NULL THEN 1 ELSE 0 END) AS disabled
    FROM push_subscriptions
  `).get();
}

// ─── Push dedupe ─────────────────────────────────────────────────────────

export function hasArticleBeenPushed(articleId, topic = "*") {
  return Boolean(
    getDb().prepare(`SELECT 1 FROM pushed_articles WHERE article_id = ? AND topic = ?`).get(articleId, topic),
  );
}

export function recordArticlePush(articleId, topic, { sent = 0, failed = 0 } = {}) {
  getDb().prepare(`
    INSERT INTO pushed_articles (article_id, topic, pushed_at, sent, failed)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(article_id, topic) DO UPDATE SET
      pushed_at = excluded.pushed_at,
      sent = excluded.sent,
      failed = excluded.failed
  `).run(articleId, topic, Date.now(), sent, failed);
}

// ─── Social posting helpers ──────────────────────────────────────────────

export function hasArticleBeenPosted(articleId, platform) {
  return Boolean(
    getDb().prepare(`SELECT 1 FROM social_posts WHERE article_id = ? AND platform = ?`).get(articleId, platform),
  );
}

export function recordSocialPost({ articleId, platform, status = "posted", platformPostId = null, url = null, caption = null, error = null }) {
  getDb().prepare(`
    INSERT INTO social_posts (article_id, platform, status, platform_post_id, url, caption, error, posted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(article_id, platform) DO UPDATE SET
      status = excluded.status,
      platform_post_id = excluded.platform_post_id,
      url = excluded.url,
      caption = excluded.caption,
      error = excluded.error,
      posted_at = excluded.posted_at
  `).run(articleId, platform, status, platformPostId, url, caption, error, Date.now());
}

export function lastPostAt(platform) {
  const row = getDb().prepare(`SELECT MAX(posted_at) AS at FROM social_posts WHERE platform = ? AND status = 'posted'`).get(platform);
  return row?.at || 0;
}

export function findFreshUnpostedArticles({ platform, minCredibility = 7, withinMs = 12 * 60 * 60 * 1000, limit = 10 } = {}) {
  const cutoff = Date.now() - withinMs;
  // Also filter is_duplicate = 0 so we never auto-post a near-duplicate story
  // to social — only the highest-credibility version of each story gets posted.
  return getDb().prepare(`
    SELECT a.id, a.title, a.description, a.content, a.category, a.source_name, a.published_at, a.credibility, a.url, a.image_url, a.ig_summary, a.tags
    FROM articles a
    LEFT JOIN social_posts s ON s.article_id = a.id AND s.platform = ? AND s.status IN ('posted', 'failed')
    WHERE s.article_id IS NULL
      AND a.published_at > ?
      AND a.credibility >= ?
      AND a.is_duplicate = 0
    ORDER BY a.credibility DESC, a.published_at DESC
    LIMIT ?
  `).all(platform, cutoff, minCredibility, limit);
}

// Returns the last N Instagram posts with their associated article data.
// Used by the /ig link-in-bio page to show a feed of recently-posted stories.
export function getRecentIgPosts(limit = 12) {
  return getDb().prepare(`
    SELECT
      a.id, a.title, a.description, a.ig_summary, a.category,
      a.image_url, a.source_name, a.published_at, a.url AS article_source_url,
      sp.url AS post_url, sp.posted_at
    FROM social_posts sp
    JOIN articles a ON a.id = sp.article_id
    WHERE sp.platform = 'instagram' AND sp.status = 'posted'
    ORDER BY sp.posted_at DESC
    LIMIT ?
  `).all(limit);
}

export function socialPostStats({ withinMs = 24 * 60 * 60 * 1000 } = {}) {
  const cutoff = Date.now() - withinMs;
  return getDb().prepare(`
    SELECT platform, status, COUNT(*) AS n
    FROM social_posts
    WHERE posted_at > ?
    GROUP BY platform, status
    ORDER BY platform
  `).all(cutoff);
}

// ─── Referral helpers ────────────────────────────────────────────────────────

// How many verified, non-unsubscribed subscribers did token refer?
// ─── Welcome sequence helpers ──────────────────────────────────────────────
// Find verified subscribers who are due for a stage of the welcome sequence
// (day-1 expectations email, day-3 topic-prefs nudge). Filters out unsubscribed
// users and those who already received the email at this stage.
export function findWelcomeRecipients(stage, { ageMin, ageMax = Infinity, limit = 50 } = {}) {
  if (!["d1", "d3"].includes(stage)) throw new Error(`unknown welcome stage: ${stage}`);
  const col = stage === "d1" ? "welcome_d1_sent_at" : "welcome_d3_sent_at";
  const cutoffMin = Date.now() - ageMin;
  const cutoffMax = Number.isFinite(ageMax) ? Date.now() - ageMax : 0;
  return getDb().prepare(`
    SELECT id, email, token, language, topics
    FROM subscribers
    WHERE verified_at IS NOT NULL
      AND unsubscribed_at IS NULL
      AND verified_at <= ?
      AND verified_at >= ?
      AND ${col} IS NULL
    ORDER BY verified_at ASC
    LIMIT ?
  `).all(cutoffMin, cutoffMax, limit);
}

// Mark a welcome-stage email as sent (idempotent — safe to call multiple times).
export function markWelcomeSent(subscriberId, stage) {
  if (!["d1", "d3"].includes(stage)) throw new Error(`unknown welcome stage: ${stage}`);
  const col = stage === "d1" ? "welcome_d1_sent_at" : "welcome_d3_sent_at";
  getDb().prepare(`UPDATE subscribers SET ${col} = ? WHERE id = ?`).run(Date.now(), subscriberId);
}

export function getReferralCount(referrerToken) {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS n FROM subscribers
    WHERE referred_by_token = ?
      AND verified_at IS NOT NULL
      AND unsubscribed_at IS NULL
  `).get(referrerToken);
  return row?.n || 0;
}

// Top 20 referrers — used for leaderboard in weekly digest.
export function getReferralLeaderboard(limit = 20) {
  return getDb().prepare(`
    SELECT referred_by_token AS token, COUNT(*) AS referrals
    FROM subscribers
    WHERE referred_by_token IS NOT NULL
      AND verified_at IS NOT NULL
      AND unsubscribed_at IS NULL
    GROUP BY referred_by_token
    ORDER BY referrals DESC
    LIMIT ?
  `).all(limit);
}

// ─── Tip helpers ────────────────────────────────────────────────────────────

export function createTipRecord({ id, amountCents, currency = "usd", email = null }) {
  getDb().prepare(`
    INSERT OR IGNORE INTO tips (id, amount_cents, currency, email, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(id, amountCents, currency, email, Date.now());
}

export function completeTip(sessionId, { stripePaymentIntent, email } = {}) {
  getDb().prepare(`
    UPDATE tips SET status = 'completed', stripe_pi = ?, email = COALESCE(?, email)
    WHERE id = ?
  `).run(stripePaymentIntent || null, email || null, sessionId);
}

export function getTipStats() {
  const db = getDb();
  return db.prepare(`
    SELECT
      COUNT(*) AS total_count,
      COALESCE(SUM(amount_cents), 0) AS total_cents,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN amount_cents ELSE 0 END), 0) AS completed_cents,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count
    FROM tips
  `).get();
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export function createAuthToken(token, email, expiresAt) {
  getDb().prepare(`
    INSERT OR REPLACE INTO auth_tokens (token, email, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(token, email.toLowerCase(), Date.now(), expiresAt);
}

export function consumeAuthToken(token) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM auth_tokens WHERE token = ? AND used_at IS NULL`).get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) return null;
  db.prepare(`UPDATE auth_tokens SET used_at = ? WHERE token = ?`).run(Date.now(), token);
  return row; // { token, email, created_at, expires_at }
}

// Find or create a user by email. Returns the user row.
//
// Ko-fi premium back-fill: when a new user signs in for the first time, we
// check whether there's a completed Ko-fi subscription tip row for this email.
// If one exists they pre-paid before creating an account — upgrade them to
// premium immediately so they get the ad-free experience without any friction.
export function upsertUser({ id, email, language, preferredTopics, preferredCountry, subscriberToken }) {
  const db = getDb();
  const normalEmail = email.toLowerCase();
  const existing = db.prepare(`SELECT * FROM users WHERE email = ?`).get(normalEmail);
  if (existing) {
    db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(Date.now(), existing.id);
    return existing;
  }

  // Check for a pre-existing Ko-fi subscription payment (the webhook may have
  // arrived before the user created their account).
  const kofiSub = db.prepare(`
    SELECT id FROM tips
    WHERE email = ? AND status = 'completed' AND id LIKE 'kofi_%'
    LIMIT 1
  `).get(normalEmail);
  const initialTier = kofiSub ? "premium" : "free";

  db.prepare(`
    INSERT INTO users (id, email, created_at, last_login_at, preferred_topics, preferred_country, language, subscriber_token, tier)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    normalEmail,
    Date.now(),
    Date.now(),
    JSON.stringify(Array.isArray(preferredTopics) ? preferredTopics : []),
    preferredCountry || null,
    language || "en",
    subscriberToken || null,
    initialTier,
  );
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
}

export function getUserById(userId) {
  return getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
}

export function createUserSession(sessionId, userId, expiresAt) {
  getDb().prepare(`
    INSERT INTO user_sessions (id, user_id, created_at, expires_at, last_seen)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, userId, Date.now(), expiresAt, Date.now());
}

export function getUserBySession(sessionId) {
  const db = getDb();
  const session = db.prepare(`
    SELECT * FROM user_sessions WHERE id = ? AND expires_at > ?
  `).get(sessionId, Date.now());
  if (!session) return null;
  db.prepare(`UPDATE user_sessions SET last_seen = ? WHERE id = ?`).run(Date.now(), sessionId);
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(session.user_id);
}

export function deleteUserSession(sessionId) {
  getDb().prepare(`DELETE FROM user_sessions WHERE id = ?`).run(sessionId);
}

export function updateUserPrefs(userId, { preferredTopics, language, preferredCountry }) {
  const db = getDb();
  if (preferredTopics !== undefined) {
    db.prepare(`UPDATE users SET preferred_topics = ? WHERE id = ?`)
      .run(JSON.stringify(Array.isArray(preferredTopics) ? preferredTopics : []), userId);
  }
  if (language !== undefined) {
    db.prepare(`UPDATE users SET language = ? WHERE id = ?`).run(language, userId);
  }
  if (preferredCountry !== undefined) {
    db.prepare(`UPDATE users SET preferred_country = ? WHERE id = ?`).run(preferredCountry || null, userId);
  }
}

// ─── Saved articles (cross-device, server-side) ───────────────────────────
// Separate from localStorage saves — synced to server when user is logged in.
export function ensureSavedArticlesTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS saved_articles (
      user_id     TEXT NOT NULL,
      article_id  TEXT NOT NULL,
      saved_at    INTEGER NOT NULL,
      PRIMARY KEY (user_id, article_id)
    );
    CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_articles(user_id, saved_at DESC);
  `);
}

export function saveArticleForUser(userId, articleId) {
  ensureSavedArticlesTable();
  getDb().prepare(`
    INSERT OR IGNORE INTO saved_articles (user_id, article_id, saved_at)
    VALUES (?, ?, ?)
  `).run(userId, articleId, Date.now());
}

export function unsaveArticleForUser(userId, articleId) {
  ensureSavedArticlesTable();
  getDb().prepare(`DELETE FROM saved_articles WHERE user_id = ? AND article_id = ?`).run(userId, articleId);
}

export function getSavedArticlesForUser(userId, limit = 50) {
  ensureSavedArticlesTable();
  return getDb().prepare(`
    SELECT a.* FROM articles a
    JOIN saved_articles s ON s.article_id = a.id
    WHERE s.user_id = ?
    ORDER BY s.saved_at DESC
    LIMIT ?
  `).all(userId, limit);
}

// ─── Personalized feed helpers ──────────────────────────────────────────────

// Record or update a per-user article view. Called from the track endpoint
// when a session cookie is present. On conflict (same user + article) we keep
// the longest dwell_ms seen and OR-merge the saved flag.
export function recordUserView(userId, articleId, category, dwellMs = 0, saved = false) {
  getDb().prepare(`
    INSERT INTO user_article_views (user_id, article_id, category, dwell_ms, saved, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, article_id) DO UPDATE SET
      dwell_ms   = MAX(dwell_ms, excluded.dwell_ms),
      saved      = saved OR excluded.saved
  `).run(userId, articleId, category, dwellMs | 0, saved ? 1 : 0, Date.now());
}

// Compute per-category interest scores for a user based on the last 30 days
// of reading history. Score formula (per article):
//   view = 1, dwell ≥ 30s = +1, dwell ≥ 90s = +1, saved = +3
// Returns a plain object { category: rawScore }. Empty object when the user
// has no history (new users fall back to the default editorial ranking).
export function getUserCategoryWeights(userId) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const rows = getDb().prepare(`
    SELECT
      category,
      COUNT(*)                                                      AS views,
      SUM(CASE WHEN dwell_ms >= 30000 THEN 1 ELSE 0 END)           AS long_reads,
      SUM(CASE WHEN dwell_ms >= 90000 THEN 1 ELSE 0 END)           AS deep_reads,
      SUM(saved)                                                    AS saves
    FROM user_article_views
    WHERE user_id = ? AND created_at > ?
    GROUP BY category
  `).all(userId, cutoff);

  const weights = {};
  for (const r of rows) {
    weights[r.category] = (r.views || 0) + (r.long_reads || 0)
                        + (r.deep_reads || 0) * 2 + (r.saves || 0) * 3;
  }
  return weights;
}

// ─── Metered paywall helpers ─────────────────────────────────────────────────

const METER_FREE_LIMIT = parseInt(process.env.METER_FREE_LIMIT || "10", 10);
const METER_WINDOW_MS  = 30 * 24 * 60 * 60 * 1000; // 30-day rolling window

/**
 * Check the meter for a device/user and optionally record this open.
 * Returns { allowed: bool, count: number, limit: number, isPremium: bool }.
 *
 * If `record` is true and the device is under limit, inserts a meter_event row.
 * The device_key should be SHA-256(IP+salt) for anon users, or user_id for auth.
 * Premium users are always allowed (tier === 'premium').
 */
export function checkMeter(deviceKey, articleId, { record = false, userId = null } = {}) {
  const db = getDb();

  // Signed-in users get unlimited reading — this matches the soft wall promise
  // ("Sign in for unlimited reading — it's free"). Premium additionally hides
  // ads via the isPremium flag.
  if (userId) {
    const user = db.prepare(`SELECT tier FROM users WHERE id = ?`).get(userId);
    if (user) {
      return {
        allowed:   true,
        count:     0,
        limit:     METER_FREE_LIMIT,
        isPremium: user.tier === "premium",
        signedIn:  true,
      };
    }
  }

  const windowStart = Date.now() - METER_WINDOW_MS;
  const count = db.prepare(`
    SELECT COUNT(DISTINCT article_id) AS n
    FROM meter_events
    WHERE device_key = ? AND created_at > ?
  `).get(deviceKey, windowStart).n;

  // Has this specific article already been opened? (doesn't count against limit again)
  const alreadyOpened = Boolean(
    db.prepare(`SELECT 1 FROM meter_events WHERE device_key = ? AND article_id = ?`)
      .get(deviceKey, articleId)
  );

  const allowed = alreadyOpened || count < METER_FREE_LIMIT;

  if (record && allowed && !alreadyOpened) {
    try {
      db.prepare(`
        INSERT OR IGNORE INTO meter_events (device_key, article_id, created_at)
        VALUES (?, ?, ?)
      `).run(deviceKey, articleId, Date.now());
    } catch { /* ignore unique violation */ }
  }

  return { allowed, count: Math.min(count + (alreadyOpened ? 0 : 1), METER_FREE_LIMIT), limit: METER_FREE_LIMIT, isPremium: false };
}

export function getMeterCount(deviceKey) {
  const windowStart = Date.now() - METER_WINDOW_MS;
  return getDb().prepare(`
    SELECT COUNT(DISTINCT article_id) AS n
    FROM meter_events WHERE device_key = ? AND created_at > ?
  `).get(deviceKey, windowStart).n;
}

export function upgradeTier(userId, tier = "premium") {
  getDb().prepare(`UPDATE users SET tier = ? WHERE id = ?`).run(tier, userId);
}

export function setStripeCustomer(userId, stripeCustomerId) {
  getDb().prepare(`UPDATE users SET stripe_customer_id = ? WHERE id = ?`).run(stripeCustomerId, userId);
}

export function getUserByStripeCustomer(stripeCustomerId) {
  return getDb().prepare(`SELECT * FROM users WHERE stripe_customer_id = ?`).get(stripeCustomerId) || null;
}

export function getUserByEmail(email) {
  if (!email) return null;
  return getDb().prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase().trim()) || null;
}

// Record a completed Ko-fi payment (donation or subscription tick).
// Uses the Ko-fi transaction ID as the row primary key so it's idempotent
// — Ko-fi may retry the webhook if our server doesn't return 200 quickly.
export function recordKofiPayment({ kofiTransactionId, amountCents, currency = "usd", email = null, message = null, type = "donation" }) {
  getDb().prepare(`
    INSERT OR IGNORE INTO tips
      (id, amount_cents, currency, email, message, status, stripe_pi, created_at)
    VALUES (?, ?, ?, ?, ?, 'completed', NULL, ?)
  `).run(
    `kofi_${kofiTransactionId}`,
    amountCents,
    currency.toLowerCase(),
    email || null,
    message || null,
    Date.now()
  );
}

// ─── Video job queue helpers ─────────────────────────────────────────────────

export function enqueueVideoJob(articleId) {
  // Idempotent — don't re-enqueue if already queued/rendering.
  const existing = getDb().prepare(`
    SELECT id FROM video_jobs
    WHERE article_id = ? AND status IN ('queued','rendering','ready','review_approved')
    LIMIT 1
  `).get(articleId);
  if (existing) return existing.id;

  const r = getDb().prepare(`
    INSERT INTO video_jobs (article_id, status, created_at)
    VALUES (?, 'queued', ?)
  `).run(articleId, Date.now());
  return r.lastInsertRowid;
}

export function setVideoJobRendering(jobId) {
  getDb().prepare(`UPDATE video_jobs SET status = 'rendering' WHERE id = ?`).run(jobId);
}

export function setVideoJobReady(jobId, { outputPath, hasAudio, durationSecs, thumbnailB64 = null } = {}) {
  getDb().prepare(`
    UPDATE video_jobs SET
      status = 'ready',
      output_path = ?,
      has_audio = ?,
      duration_secs = ?,
      thumbnail_b64 = ?,
      rendered_at = ?
    WHERE id = ?
  `).run(outputPath, hasAudio ? 1 : 0, durationSecs || 0, thumbnailB64, Date.now(), jobId);
}

export function setVideoJobFailed(jobId, error) {
  getDb().prepare(`
    UPDATE video_jobs SET status = 'failed', error = ?, rendered_at = ? WHERE id = ?
  `).run(String(error).slice(0, 500), Date.now(), jobId);
}

export function approveVideoJob(jobId) {
  getDb().prepare(`
    UPDATE video_jobs SET status = 'review_approved', approved_at = ? WHERE id = ?
  `).run(Date.now(), jobId);
}

export function rejectVideoJob(jobId) {
  getDb().prepare(`UPDATE video_jobs SET status = 'review_rejected' WHERE id = ?`).run(jobId);
}

export function markVideoJobPublished(jobId, platforms = []) {
  getDb().prepare(`
    UPDATE video_jobs SET status = 'published', platforms_posted = ?, published_at = ? WHERE id = ?
  `).run(JSON.stringify(platforms), Date.now(), jobId);
}

export function listVideoJobs({ status = null, limit = 50, offset = 0 } = {}) {
  if (status) {
    return getDb().prepare(`
      SELECT j.*, a.title AS article_title, a.category, a.source_name, a.image_url
      FROM video_jobs j LEFT JOIN articles a ON a.id = j.article_id
      WHERE j.status = ?
      ORDER BY j.created_at DESC LIMIT ? OFFSET ?
    `).all(status, limit, offset);
  }
  return getDb().prepare(`
    SELECT j.*, a.title AS article_title, a.category, a.source_name, a.image_url
    FROM video_jobs j LEFT JOIN articles a ON a.id = j.article_id
    ORDER BY j.created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
}

export function getVideoJobById(id) {
  return getDb().prepare(`SELECT * FROM video_jobs WHERE id = ?`).get(id);
}

export function getVideoJobsReadyToPublish() {
  return getDb().prepare(`
    SELECT j.*, a.title AS article_title, a.category, a.source_name, a.image_url, a.description
    FROM video_jobs j LEFT JOIN articles a ON a.id = j.article_id
    WHERE j.status = 'review_approved' AND j.output_path IS NOT NULL
    ORDER BY j.approved_at ASC
  `).all();
}

// Articles that haven't been rendered yet and are fresh+credible enough to
// warrant a video. Called by the nightly cron batch.
export function findArticlesForVideoQueue({ minCredibility = 7, withinMs = 24 * 60 * 60 * 1000, limit = 5 } = {}) {
  const cutoff = Date.now() - withinMs;
  return getDb().prepare(`
    SELECT a.id, a.title, a.description, a.content, a.category, a.source_name,
           a.image_url, a.published_at, a.credibility
    FROM articles a
    LEFT JOIN video_jobs j ON j.article_id = a.id
    WHERE j.article_id IS NULL
      AND a.published_at > ?
      AND a.credibility >= ?
    ORDER BY a.credibility DESC, a.published_at DESC
    LIMIT ?
  `).all(cutoff, minCredibility, limit);
}

// Pick fresh, high-credibility articles that haven't been pushed yet, ordered
// by recency. Used by the breaking-news worker.
export function findFreshUnpushedArticles({ minCredibility = 8, withinMs = 30 * 60 * 1000, limit = 5 } = {}) {
  const cutoff = Date.now() - withinMs;
  return getDb().prepare(`
    SELECT a.id, a.title, a.description, a.category, a.source_name, a.published_at, a.credibility, a.url
    FROM articles a
    LEFT JOIN pushed_articles p ON p.article_id = a.id AND p.topic = '*'
    WHERE p.article_id IS NULL
      AND a.published_at > ?
      AND a.credibility >= ?
    ORDER BY a.credibility DESC, a.published_at DESC
    LIMIT ?
  `).all(cutoff, minCredibility, limit);
}

// ─── Analysis helpers ─────────────────────────────────────────────────────

function tryParseJson(val, fallback) {
  try { return JSON.parse(val || "null") ?? fallback; } catch { return fallback; }
}

// ─── Story Clusters ───────────────────────────────────────────────────────

export function upsertStoryCluster(cluster) {
  getDb().prepare(`
    INSERT INTO story_clusters
      (id, title, summary, category, keywords, article_ids, article_count,
       brief, perspectives, created_at, updated_at, expires_at)
    VALUES
      (@id, @title, @summary, @category, @keywords, @article_ids, @article_count,
       @brief, @perspectives, @created_at, @updated_at, @expires_at)
    ON CONFLICT(id) DO UPDATE SET
      title         = excluded.title,
      summary       = excluded.summary,
      keywords      = excluded.keywords,
      article_ids   = excluded.article_ids,
      article_count = excluded.article_count,
      brief         = excluded.brief,
      perspectives  = excluded.perspectives,
      updated_at    = excluded.updated_at,
      expires_at    = excluded.expires_at
  `).run({
    id:            cluster.id,
    title:         cluster.title,
    summary:       cluster.summary || null,
    category:      cluster.category,
    keywords:      JSON.stringify(cluster.keywords || []),
    article_ids:   JSON.stringify(cluster.article_ids || []),
    article_count: cluster.article_count || 0,
    brief:         JSON.stringify(cluster.brief || []),
    perspectives:  cluster.perspectives ? JSON.stringify(cluster.perspectives) : null,
    created_at:    cluster.created_at || Date.now(),
    updated_at:    cluster.updated_at || Date.now(),
    expires_at:    cluster.expires_at || (Date.now() + 24 * 60 * 60 * 1000),
  });
}

function hydrateCluster(row) {
  if (!row) return null;
  return {
    ...row,
    keywords:     tryParseJson(row.keywords, []),
    article_ids:  tryParseJson(row.article_ids, []),
    brief:        tryParseJson(row.brief, []),
    perspectives: tryParseJson(row.perspectives, null),
  };
}

export function listStoryClusters({ limit = 10 } = {}) {
  return getDb().prepare(
    `SELECT * FROM story_clusters WHERE expires_at > ? ORDER BY updated_at DESC LIMIT ?`
  ).all(Date.now(), limit).map(hydrateCluster);
}

export function getStoryCluster(id) {
  return hydrateCluster(getDb().prepare(
    `SELECT * FROM story_clusters WHERE id = ?`
  ).get(id));
}

// ─── Explained Pieces ─────────────────────────────────────────────────────

export function upsertExplainedPiece(piece) {
  getDb().prepare(`
    INSERT INTO explained_pieces
      (id, slug, title, category, summary, content, facts, timeline, sources,
       image_url, created_at, updated_at, expires_at)
    VALUES
      (@id, @slug, @title, @category, @summary, @content, @facts, @timeline, @sources,
       @image_url, @created_at, @updated_at, @expires_at)
    ON CONFLICT(id) DO UPDATE SET
      title      = excluded.title,
      summary    = excluded.summary,
      content    = excluded.content,
      facts      = excluded.facts,
      timeline   = excluded.timeline,
      sources    = excluded.sources,
      image_url  = excluded.image_url,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
  `).run({
    id:         piece.id,
    slug:       piece.slug,
    title:      piece.title,
    category:   piece.category,
    summary:    piece.summary || null,
    content:    piece.content || null,
    facts:      JSON.stringify(piece.facts || []),
    timeline:   JSON.stringify(piece.timeline || []),
    sources:    JSON.stringify(piece.sources || []),
    image_url:  piece.image_url || null,
    created_at: piece.created_at || Date.now(),
    updated_at: piece.updated_at || Date.now(),
    expires_at: piece.expires_at || (Date.now() + 12 * 60 * 60 * 1000),
  });
}

function hydrateExplained(row) {
  if (!row) return null;
  return {
    ...row,
    facts:    tryParseJson(row.facts, []),
    timeline: tryParseJson(row.timeline, []),
    sources:  tryParseJson(row.sources, []),
  };
}

export function listExplainedPieces({ limit = 10 } = {}) {
  return getDb().prepare(
    `SELECT id, slug, title, category, summary, image_url, updated_at
     FROM explained_pieces WHERE expires_at > ? ORDER BY updated_at DESC LIMIT ?`
  ).all(Date.now(), limit).map(hydrateExplained);
}

export function getExplainedBySlug(slug) {
  return hydrateExplained(getDb().prepare(
    `SELECT * FROM explained_pieces WHERE slug = ?`
  ).get(slug));
}

// ─── Article Analysis Cache ───────────────────────────────────────────────

export function getArticleAnalysisCache(articleId) {
  const row = getDb().prepare(
    `SELECT * FROM article_analysis_cache WHERE article_id = ? AND expires_at > ?`
  ).get(articleId, Date.now());
  if (!row) return null;
  return {
    ...row,
    takeaways:   tryParseJson(row.takeaways, []),
    related_ids: tryParseJson(row.related_ids, []),
  };
}

export function upsertArticleAnalysisCache(data) {
  const now = Date.now();
  getDb().prepare(`
    INSERT INTO article_analysis_cache
      (article_id, takeaways, tone, tone_reason, related_ids, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(article_id) DO UPDATE SET
      takeaways   = excluded.takeaways,
      tone        = excluded.tone,
      tone_reason = excluded.tone_reason,
      related_ids = excluded.related_ids,
      created_at  = excluded.created_at,
      expires_at  = excluded.expires_at
  `).run(
    data.article_id,
    JSON.stringify(data.takeaways || []),
    data.tone || "neutral",
    data.tone_reason || null,
    JSON.stringify(data.related_ids || []),
    now,
    now + 6 * 60 * 60 * 1000,
  );
}

// ─── X-Posting Queue (Phase B Sprint 2.x.1) ────────────────────────────────
//
// Articles → x_post_queue entries via xPostGenerator.generateXPostsForArticle.
// Dedup happens at the queue layer (article rejoining x_post_queue blocks
// re-queueing). Cascade-delete on article TTL prune keeps queue bounded.

export function findArticlesPendingXQueue({
  minCredibility = 7,
  withinMs       = 12 * 60 * 60 * 1000,
  limit          = 10,
} = {}) {
  const cutoff = Date.now() - withinMs;
  return getDb().prepare(`
    SELECT a.id, a.title, a.description, a.category, a.credibility, a.published_at, a.image_url
    FROM articles a
    LEFT JOIN x_post_queue q ON q.article_id = a.id
    WHERE q.article_id IS NULL
      AND a.published_at > ?
      AND a.credibility >= ?
      AND a.is_duplicate = 0
    ORDER BY a.credibility DESC, a.published_at DESC
    LIMIT ?
  `).all(cutoff, minCredibility, limit);
}

// posts: array of { post_text, post_type, thread_group_id?, thread_position?, thread_total? }
// All posts for one article (or one thread) insert atomically.
export function enqueueXPosts(articleId, posts) {
  if (!articleId || !Array.isArray(posts) || posts.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO x_post_queue
      (article_id, post_text, post_type, thread_group_id, thread_position, thread_total, status, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `);
  const insertAll = db.transaction((aid, ps, now) => {
    for (const p of ps) {
      stmt.run(
        aid,
        p.post_text,
        p.post_type,
        p.thread_group_id || null,
        p.thread_position || null,
        p.thread_total || null,
        now,
      );
    }
    return ps.length;
  });
  return insertAll(articleId, posts, Date.now());
}

export function countPendingXPosts() {
  return getDb().prepare(`SELECT COUNT(*) AS n FROM x_post_queue WHERE status = 'pending'`).get().n;
}

export function listPendingXPosts({ limit = 50 } = {}) {
  return getDb().prepare(`
    SELECT q.id, q.article_id, q.post_text, q.post_type, q.thread_group_id, q.thread_position, q.thread_total, q.generated_at,
           a.title AS article_title, a.category AS article_category
    FROM x_post_queue q
    LEFT JOIN articles a ON a.id = q.article_id
    WHERE q.status = 'pending'
    ORDER BY q.generated_at ASC, q.thread_position ASC
    LIMIT ?
  `).all(limit);
}

// Sprint 2.x.2 — digest delivery DAOs.

// listPostsForDigest applies the digest gate (status='pending' AND
// sent_in_digest_at IS NULL — belt-and-suspenders per Migration 004 design)
// AND a curation cap: top `articleLimit` distinct articles by recency,
// returning ALL pending rows for those articles so threads stay whole.
//
// Article-level cap (not row-level) is the right primitive because threads
// must deliver as a complete unit; a row-level cap could split a 4-part
// thread across digests. CTE selects top N article_ids by MAX(generated_at);
// outer returns all matching rows. Pre-curation listPendingXPosts row-limit
// shape is preserved via the separate DAO above (consumed by /scoop-ops
// admin views).
//
// Sprint 2.x.2b — added article-level cap after analytics showed 1,600
// pending articles (all credibility 9–10; credibility lever inert). Recency
// is the only viable discriminator.
export function listPostsForDigest({ articleLimit = 15 } = {}) {
  return getDb().prepare(`
    WITH top_articles AS (
      SELECT article_id, MAX(generated_at) AS latest
      FROM x_post_queue
      WHERE status = 'pending' AND sent_in_digest_at IS NULL
      GROUP BY article_id
      ORDER BY latest DESC
      LIMIT ?
    )
    SELECT q.id, q.article_id, q.post_text, q.post_type, q.thread_group_id, q.thread_position, q.thread_total, q.generated_at,
           a.title AS article_title, a.category AS article_category, a.url AS article_url
    FROM x_post_queue q
    JOIN top_articles ta ON ta.article_id = q.article_id
    LEFT JOIN articles a ON a.id = q.article_id
    WHERE q.status = 'pending' AND q.sent_in_digest_at IS NULL
    ORDER BY ta.latest DESC, q.thread_position ASC
  `).all(articleLimit);
}

// markDigestSent advances status pending → sent_in_digest and stamps
// sent_in_digest_at. The WHERE status='pending' guard is defensive against
// concurrent state changes (e.g. a manual /send-now and the 09:00 cron
// racing).
export function markDigestSent(ids, timestamp) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const ph = ids.map(() => "?").join(",");
  return getDb().prepare(`
    UPDATE x_post_queue
    SET status = 'sent_in_digest', sent_in_digest_at = ?
    WHERE id IN (${ph}) AND status = 'pending'
  `).run(timestamp, ...ids).changes;
}

// rejectStalePending advances pending → rejected for rows generated before
// cutoffMs. Used by the daily 02:00 UTC stale-sweep cron (Sprint 2.x.2b) to
// keep the queue bounded. The 02:00 timing places it BEFORE the 03:00
// article prune (so cascade-deletes from pruned articles don't races
// against the sweep) and BEFORE the 09:00 X-digest (so the digest always
// sees a swept queue).
export function rejectStalePending(cutoffMs) {
  return getDb().prepare(`
    UPDATE x_post_queue
    SET status = 'rejected'
    WHERE status = 'pending' AND generated_at < ?
  `).run(cutoffMs).changes;
}
