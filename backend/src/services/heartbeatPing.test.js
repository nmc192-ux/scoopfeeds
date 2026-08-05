/**
 * heartbeatPing.test.js — the switch, and the line between incident and bad day.
 *
 * Two properties matter here and they pull against each other. The ping must be
 * incapable of affecting the cycle it reports on (telemetry that can break
 * publishing is worse than no telemetry). And `uniformFailure` must fire on the
 * 17-hour-401 shape while staying silent on a quiet news night — a check that
 * cries wolf gets muted, which puts us back where we started.
 */

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { pingHeartbeat, pingStart, pingSuccess, pingFail, uniformFailure, HEARTBEAT_PING_URLS } from "./heartbeatPing.js";

// ─── The ping ───────────────────────────────────────────────────────────────

/** A local server that records what it was pinged with. */
async function capture(fn) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      hits.push({ url: req.url, method: req.method, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(200); res.end("OK");
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.TEST_PING_URL = `http://127.0.0.1:${server.address().port}/hc/abc`;
  try {
    await fn(hits);
    // The ping is fire-and-forget, so give the request a moment to land.
    await new Promise((r) => setTimeout(r, 150));
  } finally {
    delete process.env.TEST_PING_URL;
    server.close();
  }
  return hits;
}

test("start / success / fail hit the endpoints the monitor expects", async () => {
  const hits = await capture(async () => {
    pingStart("TEST_PING_URL");
    await new Promise((r) => setTimeout(r, 60));
    pingSuccess("TEST_PING_URL");
    await new Promise((r) => setTimeout(r, 60));
    pingFail("TEST_PING_URL", "everything died at upload");
  });
  assert.deepEqual(hits.map((h) => h.url), ["/hc/abc/start", "/hc/abc", "/hc/abc/fail"]);
});

test("a /fail carries its reason in the body, not only to the worker log", async () => {
  // The entire point of the exercise: the reason has to reach whoever reads the
  // alert. Healthchecks keeps the ping body on the check.
  const hits = await capture(async () => {
    pingFail("TEST_PING_URL", "video cycle: 8/8 attempts failed at \"upload\" — 401");
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].method, "POST");
  assert.match(hits[0].body, /8\/8 attempts failed at "upload"/);
});

test("a trailing slash on the configured URL does not produce a double slash", async () => {
  const hits = await capture(async (h) => {
    process.env.TEST_PING_URL = `${process.env.TEST_PING_URL}///`;
    pingStart("TEST_PING_URL");
    return h;
  });
  assert.deepEqual(hits.map((h) => h.url), ["/hc/abc/start"]);
});

test("an UNSET switch is a complete no-op and never throws", () => {
  delete process.env.DEFINITELY_UNSET_PING_URL;
  assert.doesNotThrow(() => pingStart("DEFINITELY_UNSET_PING_URL"));
  assert.doesNotThrow(() => pingFail("DEFINITELY_UNSET_PING_URL", "x"));
});

test("an unreachable endpoint cannot throw or reject into the cycle", async () => {
  // Telemetry that can break publishing is worse than no telemetry. The
  // rejection is swallowed at the call site, so this must neither throw
  // synchronously nor surface as an unhandled rejection.
  process.env.TEST_DEAD_PING_URL = "http://127.0.0.1:1/hc/dead";
  let unhandled = null;
  const onUnhandled = (err) => { unhandled = err; };
  process.on("unhandledRejection", onUnhandled);
  try {
    assert.doesNotThrow(() => pingStart("TEST_DEAD_PING_URL"));
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(unhandled, null, "a dead endpoint must not surface as an unhandled rejection");
  } finally {
    process.removeListener("unhandledRejection", onUnhandled);
    delete process.env.TEST_DEAD_PING_URL;
  }
});

test("the three cycles have three INDEPENDENT check vars", () => {
  // One shared check would go red for the wrong subsystem and, worse, a healthy
  // cycle would keep resetting a check the broken one needed to leave red.
  const vars = Object.values(HEARTBEAT_PING_URLS);
  assert.equal(new Set(vars).size, 3);
  assert.deepEqual(vars.sort(), [
    "INGESTION_HEARTBEAT_PING_URL", "SOCIAL_HEARTBEAT_PING_URL", "VIDEO_HEARTBEAT_PING_URL",
  ]);
});

// ─── Incident vs bad news day ───────────────────────────────────────────────

const at = (stage, reason = "r") => ({ stage, reason });

test("every attempt failing at the SAME stage is an incident", () => {
  const r = uniformFailure([at("upload"), at("upload"), at("upload"), at("upload")]);
  assert.equal(r.uniform, true);
  assert.equal(r.stage, "upload");
  assert.equal(r.count, 4);
});

test("attempts failing at DIFFERENT stages is a bad news day, not an incident", () => {
  // Selection doing its job: each candidate rejected for its own reason.
  const r = uniformFailure([at("spec"), at("sport"), at("publisher-24h"), at("spec")]);
  assert.equal(r.uniform, false);
});

test("uniformity below the floor is not an incident — n=1 proves nothing", () => {
  // A single article failing at upload is the most ordinary line in the log.
  assert.equal(uniformFailure([at("upload")]).uniform, false);
  assert.equal(uniformFailure([at("upload"), at("upload")]).uniform, false);
  assert.equal(uniformFailure([at("upload"), at("upload"), at("upload")]).uniform, true);
});

test("the floor is tunable for cycles with fewer attempts than the video loop", () => {
  // Social runs ~6 platforms, not 8 articles, so it needs a lower bar.
  assert.equal(uniformFailure([at("post_failed"), at("post_failed")], { minAttempts: 2 }).uniform, true);
});

test("an empty or absent attempt list is never an incident", () => {
  // A cycle gated out before trying anything is healthy — it declined, which is
  // what the gates are for.
  assert.equal(uniformFailure([]).uniform, false);
  assert.equal(uniformFailure(null).uniform, false);
  assert.equal(uniformFailure(undefined).uniform, false);
});

test("attempts with no stage recorded do not count as uniform", () => {
  assert.equal(uniformFailure([at(undefined), at(undefined), at(undefined)]).uniform, false);
});

test("the reported reason is an exemplar — the stage is what must match", () => {
  // Reasons carry per-article detail even when the cause is identical, so the
  // stage is the invariant and the first reason is reported for context.
  const r = uniformFailure([
    at("upload", "401 on video A"), at("upload", "401 on video B"), at("upload", "401 on video C"),
  ]);
  assert.equal(r.uniform, true);
  assert.equal(r.reason, "401 on video A");
});
