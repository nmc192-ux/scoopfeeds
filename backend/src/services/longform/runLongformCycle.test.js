/**
 * runLongformCycle.test.js — the loop's ordering contract (#80).
 *
 * Orchestration only, so every dependency is injected and nothing here needs
 * Redis or a network. What is under test is the ORDER, because that is the
 * design:
 *
 *   1. the cheap refusals happen BEFORE any production
 *   2. the claim happens BEFORE any work, so a crash cannot double-publish
 *   3. nothing reaches a publisher except through publishIfPassed
 *   4. the job NEVER throws — a BullMQ retry means re-rendering, and possibly
 *      re-publishing, a film
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeTestDb } from "../../testing/testDb.js";
import { runLongformCycle, longformCycleJob } from "./runLongformCycle.js";
import { qcVerdict } from "./longformQcGate.js";
import { claimEvent } from "./longformCycle.js";

const NOW = 1_790_000_000_000;

const withEnv = (v, fn) => {
  const prev = process.env.LONGFORM_AUTOPOST_ENABLED;
  if (v === undefined) delete process.env.LONGFORM_AUTOPOST_ENABLED;
  else process.env.LONGFORM_AUTOPOST_ENABLED = v;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.LONGFORM_AUTOPOST_ENABLED;
    else process.env.LONGFORM_AUTOPOST_ENABLED = prev;
  }
};

const TOPIC = { id: "e1", slug: "strait", title: "The strait", demand: { phrase: "strait", breadth: 20 } };

const passing = () => qcVerdict({
  loudness: { measured: true, value: -14 }, sideChannel: { measured: true, value: -38 },
  flatFactor: { measured: true, value: 0 }, medianShot: { measured: true, value: 5 },
  shortsUnder2s: { measured: true, value: 0.12 }, filmSeconds: { measured: true, value: 500 },
  srt: { measured: true, value: { cues: 70, lastCueSecs: 490 } },
  shorts: [1, 2, 3].map((i) => ({ measured: true, name: `s${i}`, seconds: 55, width: 1080, height: 1920 })),
});
const failing = () => qcVerdict({ ...{}, loudness: { measured: true, value: -3 } });

/** A producer that records whether it ran, and whether publish was called. */
const producer = (verdict, spy) => async () => {
  spy.produced = true;
  return {
    slug: "strait", verdict,
    youtubeId: "yt1", privacyStatus: "private", publishAt: NOW + 86400000, shorts: [],
    publish: async () => { spy.published = true; },
  };
};

const deps = (over = {}) => {
  const spy = { produced: false, published: false };
  const { db } = makeTestDb();
  return {
    spy, db,
    args: {
      db, now: NOW,
      selectTopics: async () => ({ selected: [TOPIC] }),
      produce: producer(passing(), spy),
      ...over,
    },
  };
};

// ── The cheap refusals come first ───────────────────────────────────────────

test("contention refuses BEFORE anything is produced", async () => {
  await withEnv("1", async () => {
    const { spy, args } = deps({ shortsCycleActive: () => true });
    const r = await runLongformCycle(args);
    assert.equal(r.skipped, "contention");
    assert.equal(spy.produced, false, "an hour of ffmpeg must not start behind the shorts loop");
  });
});

test("a quota shortfall refuses BEFORE production, not after", async () => {
  await withEnv("1", async () => {
    const { spy, args } = deps({ quotaSnapshot: () => ({ used: 19000, ceiling: 20000 }) });
    const r = await runLongformCycle(args);
    assert.equal(r.skipped, "quota");
    assert.equal(spy.produced, false, "discovering this after the render is the wrong order");
  });
});

test("the kill switch stops the job before any dependency is touched", async () => {
  await withEnv(undefined, async () => {
    let touched = false;
    const r = await longformCycleJob({ db: null, selectTopics: () => { touched = true; }, produce: () => {} });
    assert.equal(r.skipped, "disabled");
    assert.equal(touched, false);
  });
});

// ── The claim ───────────────────────────────────────────────────────────────

test("THE CLAIM HAPPENS BEFORE PRODUCTION — a crash cannot double-publish", async () => {
  await withEnv("1", async () => {
    const { db } = makeTestDb();
    let rowAtProduceTime = null;
    await runLongformCycle({
      db, now: NOW,
      selectTopics: async () => ({ selected: [TOPIC] }),
      produce: async () => {
        rowAtProduceTime = db.prepare("SELECT status FROM longform_posts WHERE event_id='e1'").get();
        throw new Error("render died");
      },
    });
    assert.equal(rowAtProduceTime?.status, "pending",
      "the row must already exist while production runs, or a crash leaves no record");
  });
});

test("an event already claimed by another run is skipped, not filmed again", async () => {
  await withEnv("1", async () => {
    const { spy, args } = deps();
    claimEvent(args.db, { eventId: "e1", slug: "other", now: NOW });
    const r = await runLongformCycle(args);
    assert.equal(r.skipped, "already-claimed");
    assert.equal(spy.produced, false);
  });
});

test("a production failure is recorded and leaves the topic selectable once", async () => {
  await withEnv("1", async () => {
    const { db } = makeTestDb();
    const r = await runLongformCycle({
      db, now: NOW,
      selectTopics: async () => ({ selected: [TOPIC] }),
      produce: async () => { throw new Error("ffmpeg died"); },
    });
    assert.equal(r.skipped, "produce-failed");
    const row = db.prepare("SELECT status, attempts, stage FROM longform_posts WHERE event_id='e1'").get();
    assert.equal(row.status, "retry", "one failure leaves it selectable");
    assert.equal(row.attempts, 1);
    assert.equal(row.stage, "produce");
  });
});

// ── The one door ────────────────────────────────────────────────────────────

test("A QC FAILURE REACHES NO PUBLISHER, and is recorded with its reason", async () => {
  await withEnv("1", async () => {
    const spy = { produced: false, published: false };
    const { db } = makeTestDb();
    const r = await runLongformCycle({
      db, now: NOW,
      selectTopics: async () => ({ selected: [TOPIC] }),
      produce: producer(failing(), spy),
    });
    assert.equal(r.skipped, "qc-reject");
    assert.equal(spy.published, false, "the one door must stay shut");
    const row = db.prepare("SELECT status, stage, error FROM longform_posts WHERE event_id='e1'").get();
    assert.equal(row.stage, "qc");
    assert.match(row.error, /qc-reject/, "the verdict is kept, so the rejection is diagnosable");
  });
});

test("a producer that returns NO verdict is refused — a missing check is never 'proceed'", async () => {
  await withEnv("1", async () => {
    let published = false;
    const { db } = makeTestDb();
    const r = await runLongformCycle({
      db, now: NOW,
      selectTopics: async () => ({ selected: [TOPIC] }),
      produce: async () => ({ slug: "strait", publish: async () => { published = true; } }),
    });
    assert.equal(r.skipped, "no-verdict");
    assert.equal(published, false);
  });
});

test("a passing film publishes once and is recorded as published", async () => {
  await withEnv("1", async () => {
    const { spy, args } = deps();
    const r = await runLongformCycle(args);
    assert.equal(r.published, true);
    assert.equal(spy.published, true);
    const row = args.db.prepare("SELECT status, youtube_id, privacy_status FROM longform_posts WHERE event_id='e1'").get();
    assert.equal(row.status, "published");
    assert.equal(row.youtube_id, "yt1");
    assert.equal(row.privacy_status, "private", "films go up private with a publishAt");
  });
});

// ── Never throw into the queue ──────────────────────────────────────────────

test("THE JOB NEVER THROWS — a BullMQ retry would re-render and maybe re-publish", async () => {
  await withEnv("1", async () => {
    const r = await longformCycleJob({
      db: makeTestDb().db, now: NOW,
      selectTopics: async () => { throw new Error("selection exploded"); },
      produce: async () => ({}),
    });
    assert.ok(r.skipped, "it must return a result, not throw");
  });
  await withEnv("1", async () => {
    const r = await longformCycleJob({});   // missing every dependency
    assert.equal(r.skipped, "misconfigured");
  });
});

test("no qualifying topic is a normal outcome, not an error", async () => {
  await withEnv("1", async () => {
    const { args } = deps({ selectTopics: async () => ({ selected: [] }) });
    assert.equal((await runLongformCycle(args)).skipped, "no-topic");
  });
});

// ── The publisher's ids are the only handle on a scheduled upload ───────────

test("THE VIDEO ID COMES FROM THE PUBLISHER, not from the producer's placeholder", async () => {
  // The producer cannot know the id — it does not exist until the upload
  // returns. Recording its placeholder stored NULL and lost the only handle
  // on a private, scheduled upload that does not appear in the public listing.
  await withEnv("1", async () => {
    const { db } = makeTestDb();
    await runLongformCycle({
      db, now: NOW,
      selectTopics: async () => ({ selected: [TOPIC] }),
      produce: async () => ({
        slug: "strait", verdict: passing(),
        youtubeId: null,                       // as the real producer sets it
        privacyStatus: "private", publishAt: NOW + 86400000, shorts: [],
        publish: async () => ({ youtubeId: "REAL_ID", privacyStatus: "private",
                                publishAt: NOW + 86400000, shorts: [{ id: "s1" }] }),
      }),
    });
    const row = db.prepare("SELECT youtube_id, privacy_status, shorts_json FROM longform_posts WHERE event_id='e1'").get();
    assert.equal(row.youtube_id, "REAL_ID", "the id the publisher returned must be stored");
    assert.equal(JSON.parse(row.shorts_json)[0].id, "s1");
  });
});

test("a publisher returning no id still records PUBLISHED — it IS published", async () => {
  // Claiming otherwise would let the next cycle film the same story again.
  await withEnv("1", async () => {
    const { db } = makeTestDb();
    const r = await runLongformCycle({
      db, now: NOW,
      selectTopics: async () => ({ selected: [TOPIC] }),
      produce: async () => ({
        slug: "strait", verdict: passing(), publishAt: NOW + 1, privacyStatus: "private",
        publish: async () => undefined,        // a publisher that reports nothing
      }),
    });
    assert.equal(r.published, true);
    const row = db.prepare("SELECT status FROM longform_posts WHERE event_id='e1'").get();
    assert.equal(row.status, "published", "an unidentifiable film is still published");
  });
});
