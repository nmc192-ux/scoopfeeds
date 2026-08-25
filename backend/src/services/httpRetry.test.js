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
