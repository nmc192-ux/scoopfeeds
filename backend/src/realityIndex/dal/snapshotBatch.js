/**
 * snapshotBatch — run a per-event snapshot loop in chunks, each chunk inside one
 * SQLite transaction (#292, Source step 2 readiness).
 *
 * WHY. `runMediaSentimentForActiveEvents` and `runRealityIndexCycle` loop over
 * EVERY active event and write one snapshot each. Without a wrapping transaction
 * every write is its own implicit commit, so the cycle's cost grows one commit
 * per active event — and active events grow with sources. One transaction per
 * chunk turns N commits into ceil(N / batch).
 *
 * WHAT IT MUST NOT CHANGE. The write-on-change gate (writeOnChange.js) decides
 * per row exactly as before: reads inside a transaction see that transaction's
 * own earlier writes, so a chunk behaves like the same writes made one by one.
 *
 * THE TRADE. A chunk holds SQLite's write lock (BEGIN IMMEDIATE) from its start to its
 * commit. Other processes wait on busy_timeout rather than fail. A smaller
 * batch shortens that hold; 0 restores today's per-event autocommit exactly.
 *
 *   SNAPSHOT_WRITE_BATCH   code default 200; 0 = per-event autocommit (escape hatch)
 *                          read at call time, so a restart is not needed to test it.
 */

import { logger } from "../../services/logger.js";

export const SNAPSHOT_WRITE_BATCH_DEFAULT = 200;

/** Read at call time. Unset, empty, negative or non-numeric → the default. */
export function snapshotWriteBatch() {
  const raw = process.env.SNAPSHOT_WRITE_BATCH;
  if (raw == null || String(raw).trim() === "") return SNAPSHOT_WRITE_BATCH_DEFAULT;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 0) return SNAPSHOT_WRITE_BATCH_DEFAULT;
  return n;
}

/**
 * Call `fn(item)` for every item, in chunks of SNAPSHOT_WRITE_BATCH, each chunk in
 * one `db.transaction`. `fn` must do its own per-item try/catch (the callers keep
 * their existing per-event catch and log line), so one bad event skips only
 * itself. Synchronous, like the callers.
 *
 * If a chunk's transaction itself fails (BEGIN IMMEDIATE timing out, COMMIT, or an error SQLite answers
 * by rolling the transaction back), the chunk is logged and re-run per item in
 * autocommit. The upserts are idempotent at the same ts, so the re-run stores the
 * same rows; the caller's counters and the write-on-change counters include that
 * chunk twice, and the warning says so. Rare by construction: the callers catch
 * every per-event error, so only a transaction-level failure reaches here.
 *
 * Emits: 🧮 snapshot-batch {cycle, events, chunks, batchSize, ms}
 * Returns the same object.
 */
export function runInSnapshotBatches(db, items, fn, { cycle = "unknown" } = {}) {
  const batchSize = snapshotWriteBatch();
  const t0 = performance.now();
  let chunks = 0;

  if (batchSize === 0) {
    for (const item of items) fn(item);
  } else {
    for (let i = 0; i < items.length; i += batchSize) {
      const chunk = items.slice(i, i + batchSize);
      chunks++;
      try {
        // IMMEDIATE, not deferred: the callers read before they write, and in WAL
        // a deferred transaction whose snapshot goes stale (another process
        // commits after our first read) fails EVERY later write with
        // SQLITE_BUSY_SNAPSHOT — busy_timeout cannot help, the per-event catch
        // swallows each one, and the empty transaction commits cleanly: the
        // chunk is lost silently. BEGIN IMMEDIATE takes the write lock first
        // (waiting on busy_timeout), so other writers wait for us instead.
        db.transaction(() => { for (const item of chunk) fn(item); }).immediate();
      } catch (err) {
        logger.warn(
          `🧮 snapshot-batch ${cycle}: chunk ${chunks} (${chunk.length} events) failed as a ` +
          `transaction (${err.message}); re-running it per event — this cycle's counts ` +
          `(and the write-on-change counts) include that chunk twice`
        );
        for (const item of chunk) fn(item);
      }
    }
  }

  const out = {
    cycle,
    events: items.length,
    chunks,
    batchSize,
    ms: Math.round(performance.now() - t0),
  };
  logger.info(`🧮 snapshot-batch ${JSON.stringify(out)}`);
  return out;
}
