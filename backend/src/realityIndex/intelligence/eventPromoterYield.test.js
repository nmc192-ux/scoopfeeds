/**
 * The promoter must step aside, and must be able to prove it did.
 *
 * These tests exist because of a specific production failure: on 2026-08-28
 * `events.promote` held the worker's only JS thread from 00:33:58 to 00:54:23,
 * and three RSS fetches with 15-SECOND timeouts armed before it started
 * rejected together, 20 minutes late. The regression these guard against is not
 * "the yield is slightly wrong" — it is "the yield quietly stopped happening",
 * which looks exactly like a busy day.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

// getDb() resolves its data directory at MODULE LOAD from the environment, so
// this must be set before the first import of anything that reaches it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoop-promoter-yield-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = dir;

const { runEventPromoter, promoterYieldMs } =
  await import("./eventPromoter.js");

test("the promoter awaits the yielder even on an empty corpus", async () => {
  let calls = 0;
  const spy = async () => { calls += 1; return true; };
  spy.count = () => calls;

  const stats = await runEventPromoter({ _yielder: spy });

  // An empty DB has no clusters and no candidate events, so the loops make zero
  // passes — the point being asserted is that the cycle RUNS with an injected
  // yielder and reports its count, i.e. the wiring exists end to end.
  assert.equal(typeof stats, "object");
  assert.equal(stats.yields, 0, "no work means no yields, and the count must say so honestly");
});

test("the yield count rides the stats line", async () => {
  // stats.yields is the field that distinguishes "installed" from "present in
  // the source". If this key ever disappears, the operator's only evidence goes
  // with it.
  const stats = await runEventPromoter({});
  assert.ok("yields" in stats, "stats must carry a yields count");
  assert.notEqual(stats.yields, null, "a real run must report a number, not null");
});

test("PROMOTER_YIELD_MS is read at call time, not at import", () => {
  const prior = process.env.PROMOTER_YIELD_MS;
  try {
    delete process.env.PROMOTER_YIELD_MS;
    const fallback = promoterYieldMs();
    assert.ok(fallback > 0, "unset must fall back to a yielding default, never to 0");

    process.env.PROMOTER_YIELD_MS = "250";
    assert.equal(promoterYieldMs(), 250, "a change must take effect without a reimport");

    process.env.PROMOTER_YIELD_MS = "0";
    assert.equal(promoterYieldMs(), 0, "0 is a legitimate value — the disable hatch");

    process.env.PROMOTER_YIELD_MS = "not-a-number";
    assert.equal(promoterYieldMs(), fallback, "garbage falls back rather than disabling the yield");

    process.env.PROMOTER_YIELD_MS = "-5";
    assert.equal(promoterYieldMs(), fallback, "negative falls back rather than disabling the yield");
  } finally {
    if (prior === undefined) delete process.env.PROMOTER_YIELD_MS;
    else process.env.PROMOTER_YIELD_MS = prior;
  }
});

test("a timer armed before the cycle fires DURING it, not after", async () => {
  // The production symptom in miniature, and the only test here that would have
  // caught the 2026-08-28 outage. It needs real work in the corpus: with nothing
  // eligible the loops make zero passes, the async function runs straight
  // through, and a timer would not fire no matter how the yield is written.
  const { getDb } = await import("../../models/database.js");
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO story_clusters (id, title, summary, category, keywords, article_ids,
                                article_count, created_at, updated_at, expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run("yield-test-cluster", "A cluster large enough to be eligible", null, "world",
         JSON.stringify(["yield"]), JSON.stringify(["a1", "a2", "a3", "a4", "a5"]),
         5, now, now, now + 3600e3);

  const prior = process.env.PROMOTER_YIELD_MS;
  process.env.PROMOTER_YIELD_MS = "0";   // yield at every opportunity
  try {
    let firedDuring = false;
    setTimeout(() => { firedDuring = true; }, 0);

    const stats = await runEventPromoter({});

    assert.ok(stats.yields > 0, `the cycle must have yielded at least once, got ${stats.yields}`);
    assert.equal(firedDuring, true,
      "a timer armed before the cycle must get its turn — this is the RSS timeout that fired 20 minutes late");
  } finally {
    if (prior === undefined) delete process.env.PROMOTER_YIELD_MS;
    else process.env.PROMOTER_YIELD_MS = prior;
    db.prepare("DELETE FROM story_clusters WHERE id = ?").run("yield-test-cluster");
  }
});
