/**
 * #292 — batched snapshot writes must store exactly what per-event autocommit
 * stored, row for row, with the same write-on-change decisions. The failure
 * this guards is silent: a batch that drops or duplicates a row looks like a
 * quiet day in the time-series.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

// getDb() resolves its data directory at MODULE LOAD, so set it before importing.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoop-snapshot-batch-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = dir;

const { getDb } = await import("../../models/database.js");
const { logger } = await import("../../services/logger.js");
const { makeTestDb } = await import("../../testing/testDb.js");
const { runMediaSentimentForActiveEvents } = await import("../intelligence/mediaSentimentScorer.js");
const { runRealityIndexCycle } = await import("../intelligence/realityIndex.js");
const { sentimentWriteStmtsFor } = await import("./sentimentDao.js");
const { realityIndexWriteStmtsFor } = await import("./realityIndexDao.js");
const { snapshotWriteBatch, runInSnapshotBatches, SNAPSHOT_WRITE_BATCH_DEFAULT } = await import("./snapshotBatch.js");
const { drainSnapshotWriteStats } = await import("./writeOnChange.js");

const db = getDb();
const T0 = 1_800_000_000_000;

const WORDS = ["crisis", "deal", "war", "growth", "attack", "peace", "collapse", "record", "fears", "hope"];
let artN = 0;
function seedEvents(n, prefix = "ev") {
  const ins = db.prepare(`
    INSERT INTO events (id, slug, title, summary, category, status, severity,
      started_at, last_activity_at, meta, created_at, updated_at)
    VALUES (?, ?, ?, 'S', 'world', 'active', 0.5, ?, ?, NULL, ?, ?)`);
  const art = db.prepare("INSERT INTO articles (id, title, url, source_name, category, published_at, fetched_at) VALUES (?,?,?,?,?,?,?)");
  const link = db.prepare("INSERT INTO event_articles (event_id, article_id, added_at) VALUES (?,?,?)");
  db.transaction(() => {
    for (let i = 0; i < n; i++) {
      const id = `${prefix}-${String(i).padStart(4, "0")}`;
      ins.run(id, id, `Title ${id}`, T0, T0, T0, T0);
      const k = i % 4; // some events have no articles at all
      for (let j = 0; j < k; j++) {
        const aid = `a${++artN}`;
        art.run(aid, `${WORDS[(i + j) % WORDS.length]} ${WORDS[(i * 3 + j) % WORDS.length]} ${aid}`,
          `https://x.test/${aid}`, `Outlet ${j}`, "world", T0 - j * 3_600_000, T0);
        link.run(id, aid, T0);
      }
    }
  })();
}

function withEnv(key, value, fn) {
  const prior = process.env[key];
  if (value == null) delete process.env[key]; else process.env[key] = String(value);
  try { return fn(); } finally { if (prior == null) delete process.env[key]; else process.env[key] = prior; }
}

/** Run media + RI twice (second pass exercises the "unchanged" gate), capturing logs. */
function runCycles(batch) {
  db.exec("DELETE FROM sentiment_snapshots; DELETE FROM reality_index_snapshots;");
  drainSnapshotWriteStats();
  const lines = [];
  const realNow = Date.now;
  const realInfo = logger.info.bind(logger);
  logger.info = (msg, ...rest) => { lines.push(String(msg)); return realInfo(msg, ...rest); };
  try {
    return withEnv("SNAPSHOT_WRITE_BATCH", batch, () => {
      const out = [];
      for (const t of [T0, T0 + 60_000]) {
        Date.now = () => t;
        out.push(runMediaSentimentForActiveEvents(), runRealityIndexCycle());
      }
      return {
        out,
        lines,
        sentiment: db.prepare("SELECT * FROM sentiment_snapshots ORDER BY scope, scope_id, source, ts").all(),
        ri: db.prepare("SELECT * FROM reality_index_snapshots ORDER BY scope, scope_id, ts").all(),
      };
    });
  } finally {
    Date.now = realNow;
    logger.info = realInfo;
  }
}

seedEvents(9);

test("SNAPSHOT_WRITE_BATCH: default 200, 0 allowed, junk falls back to the default", () => {
  withEnv("SNAPSHOT_WRITE_BATCH", null, () => assert.equal(snapshotWriteBatch(), SNAPSHOT_WRITE_BATCH_DEFAULT));
  assert.equal(SNAPSHOT_WRITE_BATCH_DEFAULT, 200);
  withEnv("SNAPSHOT_WRITE_BATCH", "0", () => assert.equal(snapshotWriteBatch(), 0));
  withEnv("SNAPSHOT_WRITE_BATCH", "7", () => assert.equal(snapshotWriteBatch(), 7));
  withEnv("SNAPSHOT_WRITE_BATCH", "-3", () => assert.equal(snapshotWriteBatch(), 200));
  withEnv("SNAPSHOT_WRITE_BATCH", "lots", () => assert.equal(snapshotWriteBatch(), 200));
  withEnv("SNAPSHOT_WRITE_BATCH", "", () => assert.equal(snapshotWriteBatch(), 200));
});

test("batched (=2, several chunks) and per-event (=0) store identical rows and counters", () => {
  const a = runCycles(0);
  const b = runCycles(2);
  assert.ok(a.sentiment.length >= 9, "every active event gets a media snapshot");
  assert.ok(a.ri.length > 0);
  assert.deepEqual(b.sentiment, a.sentiment, "sentiment_snapshots row-for-row identical");
  assert.deepEqual(b.ri, a.ri, "reality_index_snapshots row-for-row identical");
  assert.deepEqual(b.out, a.out, "cycle return shapes and counts identical");

  const gate = (r) => r.lines.filter((l) => l.startsWith("📉"));
  assert.ok(gate(a).length > 0, "write-on-change stats were logged");
  assert.deepEqual(gate(b), gate(a), "write-on-change decisions identical");

  const batchLines = (r) => r.lines.filter((l) => l.startsWith("🧮 snapshot-batch"))
    .map((l) => JSON.parse(l.slice("🧮 snapshot-batch ".length)));
  const bl = batchLines(b);
  assert.equal(bl.length, 4, "one 🧮 line per cycle per run");
  assert.deepEqual(bl.map((x) => x.cycle), ["media-sentiment", "reality-index", "media-sentiment", "reality-index"]);
  for (const x of bl) { assert.equal(x.events, 9); assert.equal(x.chunks, 5); assert.equal(x.batchSize, 2); assert.ok(Number.isFinite(x.ms)); }
  for (const x of batchLines(a)) { assert.equal(x.chunks, 0); assert.equal(x.batchSize, 0); }
});

test("one event that throws inside a chunk does not stop the rest of that chunk or later chunks", () => {
  // RAISE(ABORT) fails just that statement, like a real per-event error.
  db.exec(`
    CREATE TRIGGER t_bad_senti BEFORE INSERT ON sentiment_snapshots WHEN NEW.scope_id = 'ev-0003'
    BEGIN SELECT RAISE(ABORT, 'boom'); END;
    CREATE TRIGGER t_bad_ri BEFORE INSERT ON reality_index_snapshots WHEN NEW.scope_id = 'ev-0003'
    BEGIN SELECT RAISE(ABORT, 'boom'); END;`);
  try {
    const r = runCycles(2);
    const ids = new Set(r.sentiment.map((x) => x.scope_id));
    assert.equal(ids.has("ev-0003"), false);
    for (let i = 0; i < 9; i++) if (i !== 3) assert.ok(ids.has(`ev-000${i}`), `ev-000${i} written`);
    // ev-0002 shares ev-0003's chunk; ev-0008 is in a later chunk.
    assert.equal(r.out[0].scored, 8);
    const riIds = new Set(r.ri.map((x) => x.scope_id));
    assert.equal(riIds.has("ev-0003"), false);
    for (const id of ["ev-0002", "ev-0008"]) assert.ok(riIds.has(id), `${id} RI row written`);
  } finally {
    db.exec("DROP TRIGGER t_bad_senti; DROP TRIGGER t_bad_ri;");
  }
});

test("a chunk whose transaction is rolled back is re-run per event, so no other row is lost", () => {
  // RAISE(ROLLBACK) kills the whole transaction — the transaction-level failure path.
  db.exec(`CREATE TRIGGER t_rb BEFORE INSERT ON sentiment_snapshots WHEN NEW.scope_id = 'ev-0003'
           BEGIN SELECT RAISE(ROLLBACK, 'rb'); END;`);
  try {
    const r = runCycles(2);
    const ids = new Set(r.sentiment.filter((x) => x.ts === T0).map((x) => x.scope_id));
    for (let i = 0; i < 9; i++) {
      if (i === 3) assert.equal(ids.has("ev-0003"), false);
      else assert.ok(ids.has(`ev-000${i}`), `ev-000${i} written despite the rollback in its chunk`);
    }
  } finally {
    db.exec("DROP TRIGGER t_rb;");
  }
});

test("statement cache: working statements per handle, never shared across handles", () => {
  const other = makeTestDb({ prefix: "scoop-snapshot-batch-2-" });
  try {
    const s1 = sentimentWriteStmtsFor(db);
    const s2 = sentimentWriteStmtsFor(other.db);
    assert.notEqual(s1.upsert, s2.upsert, "each handle prepares its own statements");
    assert.equal(sentimentWriteStmtsFor(db), s1, "cached per handle");
    s2.upsert.run("event", "x", 1, "media", 0.1, 0.2, 3, null);
    assert.equal(s2.prev.get("event", "x", "media").volume, 3);
    assert.equal(s1.prev.get("event", "x", "media"), undefined, "the other handle's write is not visible here");

    const r1 = realityIndexWriteStmtsFor(db);
    const r2 = realityIndexWriteStmtsFor(other.db);
    assert.notEqual(r1.prev, r2.prev);
    r2.upsert.run("event", "y", 1, null, null, null, null, null, 0.5, 0.4, null);
    assert.equal(r2.prev.get("event", "y").reality_score, 0.5);
    assert.equal(r1.prev.get("event", "y"), undefined);
  } finally {
    other.cleanup();
  }
});

test("runInSnapshotBatches handles an empty list and reports zero chunks", () => {
  const out = withEnv("SNAPSHOT_WRITE_BATCH", "5", () => runInSnapshotBatches(db, [], () => { throw new Error("never"); }, { cycle: "t" }));
  assert.deepEqual({ ...out, ms: 0 }, { cycle: "t", events: 0, chunks: 0, batchSize: 5, ms: 0 });
});

test("a chunk takes the write lock up front, so another process's commit cannot void its writes", async () => {
  // WAL hazard: a DEFERRED transaction that reads first and writes later fails
  // every write with SQLITE_BUSY_SNAPSHOT if another connection commits in
  // between — busy_timeout cannot help, each write is caught as a "bad event",
  // and the (now empty) transaction commits cleanly. The whole chunk is lost
  // silently. BEGIN IMMEDIATE makes the other writer wait instead.
  const { default: Database } = await import("better-sqlite3");
  const other = new Database(db.name);
  other.pragma("busy_timeout = 0"); // same thread: it must not block on our lock
  db.exec("CREATE TABLE IF NOT EXISTS t_lock (id TEXT PRIMARY KEY, v INTEGER); DELETE FROM t_lock;");
  const errors = [];
  let otherResult = null;
  try {
    withEnv("SNAPSHOT_WRITE_BATCH", "10", () => runInSnapshotBatches(db, [0, 1, 2, 3, 4], (i) => {
      try {
        db.prepare("SELECT COUNT(*) FROM t_lock").get();
        if (i === 0) {
          try { other.prepare("INSERT OR REPLACE INTO t_lock VALUES ('other', 1)").run(); otherResult = "committed"; }
          catch (err) { otherResult = err.code; }
        }
        db.prepare("INSERT OR REPLACE INTO t_lock VALUES (?, ?)").run(`k${i}`, i);
      } catch (err) { errors.push(err.code); }
    }, { cycle: "lock-test" }));
    assert.deepEqual(errors, [], "no write in the chunk failed");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM t_lock WHERE id LIKE 'k%'").get().n, 5);
    assert.equal(otherResult, "SQLITE_BUSY", "the other writer waits on the chunk's lock (busy_timeout in prod)");
  } finally {
    other.close();
    db.exec("DROP TABLE IF EXISTS t_lock;");
  }
});
