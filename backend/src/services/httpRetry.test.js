/**
 * Ten cross-posts have been lost to the message "fetch failed" — Threads 6,
 * Instagram 3, Bluesky 1 — plus three Facebook uploads to a timeout. All were
 * recorded as permanent failures, and none could be diagnosed, because Node
 * puts the real reason in `err.cause` and every client discarded it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeFetchFailure, isTransientNetworkError, withNetworkRetry } from "./httpRetry.js";

const fetchFailed = (code) => {
  const inner = new Error("read ECONNRESET"); inner.code = code;
  const outer = new Error("fetch failed"); outer.cause = inner;
  return outer;
};

test("the real reason is dug out of the cause chain", () => {
  // This is the whole point: "fetch failed" is what we logged for weeks.
  const d = describeFetchFailure(fetchFailed("ECONNRESET"));
  assert.match(d, /fetch failed/);
  assert.match(d, /ECONNRESET/);
});

test("a timeout names itself even with no cause", () => {
  const e = new Error("The operation was aborted due to timeout");
  e.name = "TimeoutError";
  assert.match(describeFetchFailure(e), /TimeoutError/);
});

test("network faults are transient; server answers are not", () => {
  for (const code of ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_SOCKET"]) {
    assert.ok(isTransientNetworkError(fetchFailed(code)), code);
  }
  // A 4xx is a DECISION. Repeating a request the API already rejected wastes
  // quota and, on a publish endpoint, risks a duplicate post.
  const http400 = new Error("threads /x → 400 Authentication Error");
  http400.statusCode = 400;
  assert.equal(isTransientNetworkError(http400), false);
  const http413 = new Error("facebook /videos → 413"); http413.status = 413;
  assert.equal(isTransientNetworkError(http413), false);
  assert.equal(isTransientNetworkError(new Error("threads container 123 → ERROR (UNKNOWN)")), false);
});

test("a TLS failure is not retried — repeating it cannot help", () => {
  const inner = new Error("unable to verify the first certificate");
  inner.code = "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
  const outer = new Error("fetch failed"); outer.cause = inner;
  assert.equal(isTransientNetworkError(outer), false);
});

test("a blip is survived", async () => {
  let n = 0;
  const r = await withNetworkRetry(async () => {
    if (++n < 3) throw fetchFailed("ECONNRESET");
    return "ok";
  }, { attempts: 3, baseDelayMs: 1, label: "test" });
  assert.equal(r, "ok");
  assert.equal(n, 3, "should have taken all three attempts");
});

test("a permanent fault fails with its reason, not with 'fetch failed'", async () => {
  await assert.rejects(
    () => withNetworkRetry(async () => { throw fetchFailed("ENOTFOUND"); },
                           { attempts: 2, baseDelayMs: 1, label: "threads /publish" }),
    (e) => {
      assert.match(e.message, /threads \/publish/);
      assert.match(e.message, /ENOTFOUND/);
      assert.match(e.message, /after 2 attempts/);
      assert.equal(e.transient, true);
      return true;
    });
});

test("a rejected request is not repeated even once", async () => {
  let n = 0;
  await assert.rejects(() => withNetworkRetry(async () => {
    n++; const e = new Error("400 Bad Request"); e.statusCode = 400; throw e;
  }, { attempts: 3, baseDelayMs: 1 }));
  assert.equal(n, 1, "a 400 must not be retried — duplicate-post risk");
});

test("a server answer is never retried, even when it mentions the network", () => {
  // The guard that matters: an HTTP error whose TEXT looks transient. Meta
  // returns messages like "network error" with a 500, and Bluesky's own
  // wrapper attaches statusCode to errors whose message we do not control.
  // Without the statusCode check these would be replayed against a publish
  // endpoint — which is the duplicate-post risk, not a saved video.
  const e = new Error("500 upstream network error"); e.statusCode = 500;
  assert.equal(isTransientNetworkError(e), false);
  const f = new Error("fetch failed downstream"); f.status = 502;
  assert.equal(isTransientNetworkError(f), false);
});

// ─── deadlines ──────────────────────────────────────────────────────────────

import { withDeadline, fetchTimeout, FETCH_TIMEOUT_MS } from "./httpRetry.js";

test("a channel that overruns is abandoned so the next one still runs", async () => {
  // The failure this exists for: a video published, Facebook posted, Instagram
  // went `pending` on a fetch with NO timeout, and Threads / Bluesky / TikTok /
  // X were never attempted at all. The worker was not deadlocked — it moved on
  // and left that chain parked forever.
  const forever = new Promise(() => {});
  await assert.rejects(
    () => withDeadline(forever, 40, "instagram-reel"),
    (e) => {
      assert.match(e.message, /instagram-reel/);
      assert.match(e.message, /remaining channels still run/);
      return true;
    });
});

test("a channel inside its budget is untouched", async () => {
  assert.equal(await withDeadline(Promise.resolve("posted"), 5000, "x"), "posted");
});

test("a channel's own error passes through, not the deadline's", async () => {
  // The deadline must not mask a real failure with a timeout message.
  await assert.rejects(
    () => withDeadline(Promise.reject(new Error("400 Authentication Error")), 5000, "threads"),
    /400 Authentication Error/);
});

test("every outbound call gets a signal by default", () => {
  // Node's fetch has NO timeout. Four of six social clients called it without
  // one, which is how a stalled connection parked an entire cross-post chain.
  const s = fetchTimeout();
  assert.ok(s instanceof AbortSignal);
  assert.equal(s.aborted, false);
  assert.ok(FETCH_TIMEOUT_MS >= 1000, "a sub-second default would fail real uploads");
});

// ─── the budget must fit the lock ───────────────────────────────────────────

import { channelBudget } from "./videoAutopost.js";

test("a channel gets a share of what is LEFT, not a fixed five minutes", () => {
  // #74 gave every channel 5 minutes and it never fired once. The channel
  // budget starts when the CHANNEL starts; the BullMQ lock starts when the JOB
  // starts, and the render burns 4-5 minutes of it first. The lock always won,
  // and BullMQ abandons a lost-lock job silently — no rejection, no catch.
  const lockMs = 600_000, jobStartedAt = 0;
  // 4 minutes into a 10-minute lock, 6 channels still to run.
  const b = channelBudget({ jobStartedAt, channelsRemaining: 6, now: 240_000, lockMs });
  assert.ok(b > 0, "there is still time, so the budget must be positive");
  assert.ok(b * 6 <= lockMs - 240_000, "six channels must fit in the time that remains");
});

test("no time left means zero, not a budget it cannot honour", () => {
  // Starting work that cannot finish is how a channel ends up `pending`
  // forever. Zero is the honest answer.
  assert.equal(channelBudget({ jobStartedAt: 0, channelsRemaining: 3, now: 599_000, lockMs: 600_000 }), 0);
  assert.equal(channelBudget({ jobStartedAt: 0, channelsRemaining: 3, now: 900_000, lockMs: 600_000 }), 0);
});

test("the per-channel ceiling still applies when there is plenty of time", () => {
  // A long lock must not hand one channel twenty minutes.
  const b = channelBudget({ jobStartedAt: 0, channelsRemaining: 1, now: 0, lockMs: 60 * 60_000 });
  assert.ok(b <= 300_000, "the configured ceiling must still cap it");
});

test("the last channel does not get the whole remainder to itself", () => {
  // Divided by channels REMAINING, so the early ones cannot starve the late
  // ones — the failure that left Bluesky, TikTok and X never attempted.
  const early = channelBudget({ jobStartedAt: 0, channelsRemaining: 6, now: 60_000, lockMs: 600_000 });
  const late  = channelBudget({ jobStartedAt: 0, channelsRemaining: 1, now: 60_000, lockMs: 600_000 });
  assert.ok(early < late, "an early channel must reserve time for the ones behind it");
});

// ─── one channel's timeout is not every channel's ───────────────────────────

test("a channel that times out does not take the ones behind it", async () => {
  // #85 gave each cross-post a budget so a stall could not starve the rest. It
  // fired and made things worse: withDeadline REJECTS, the six calls shared one
  // try/catch, and the rejection skipped every channel after it.
  //
  // Observed on the 18:51Z render — Facebook and its Reel posted, the budget
  // fired 15 minutes later, "threw past its own guard" was logged, and Threads,
  // Bluesky, TikTok and X were never attempted.
  const ran = [];
  const chain = async () => {
    // Mirrors the shape of the real loop: each channel guarded on its own.
    for (const [label, fn] of [
      ["facebook", async () => { ran.push("facebook"); return { status: "posted" }; }],
      ["bluesky",  async () => { ran.push("bluesky"); await new Promise(() => {}); }],   // hangs
      ["x",        async () => { ran.push("x"); return { status: "posted" }; }],
    ]) {
      try { await withDeadline(fn(), 30, label); } catch { /* per channel, by design */ }
    }
  };
  await chain();
  assert.deepEqual(ran, ["facebook", "bluesky", "x"],
    "x must still run after bluesky exhausts its budget");
});

test("the shared catch would have swallowed the rest — proving the shape matters", async () => {
  // The same three channels inside ONE try/catch: the failure mode being fixed.
  const ran = [];
  try {
    for (const [label, fn] of [
      ["facebook", async () => { ran.push("facebook"); }],
      ["bluesky",  async () => { ran.push("bluesky"); await new Promise(() => {}); }],
      ["x",        async () => { ran.push("x"); }],
    ]) {
      await withDeadline(fn(), 30, label);
    }
  } catch { /* one catch for all — the bug */ }
  assert.deepEqual(ran, ["facebook", "bluesky"], "x never ran — this is what shipped");
});
