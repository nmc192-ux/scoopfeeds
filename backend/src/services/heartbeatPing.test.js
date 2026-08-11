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
import { logger } from "./logger.js";

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

// ─── The outcome is observable ──────────────────────────────────────────────
//
// Until 2026-08-11 a delivered ping and a refused one logged identically —
// nothing at all — and an evening went into proving from the outside that a
// healthy switch was healthy. These tests pin the three properties that fix
// costs nothing to keep: the outcome is reported, the URL never is, and the
// reporting cannot reach the cycle.

/** Capture what the logger was asked to write, at every level. */
async function captureLogs(fn) {
  const seen = [];
  const levels = ["debug", "info", "warn", "error"];
  const saved = {};
  for (const lvl of levels) {
    saved[lvl] = logger[lvl];
    logger[lvl] = (msg) => { seen.push({ level: lvl, msg: String(msg) }); };
  }
  // AWAIT, not `return fn(...)`. A bare return hands back the promise and the
  // `finally` restores the logger before the ping has settled — which silently
  // captures nothing and makes every assertion below vacuous.
  try { return await fn(seen); }
  finally { for (const lvl of levels) logger[lvl] = saved[lvl]; }
}

test("a DELIVERED ping is reported at debug, with its status", async () => {
  const seen = [];
  await capture(async () => {
    await captureLogs(async (log) => {
      pingStart("TEST_PING_URL");
      await new Promise((r) => setTimeout(r, 250));
      seen.push(...log);
    });
  });
  const line = seen.find((l) => l.level === "debug" && l.msg.includes("TEST_PING_URL"));
  assert.ok(line, `expected a debug line; got ${JSON.stringify(seen)}`);
  assert.match(line.msg, /start/);
  assert.match(line.msg, /200/);
});

test("a REFUSED ping is reported at warn, with the error code", async () => {
  process.env.TEST_DEAD_PING_URL = "http://127.0.0.1:1/hc/dead-token";
  try {
    const seen = await captureLogs(async (log) => {
      pingSuccess("TEST_DEAD_PING_URL");
      await new Promise((r) => setTimeout(r, 500));
      return log;
    });
    const line = seen.find((l) => l.level === "warn" && l.msg.includes("TEST_DEAD_PING_URL"));
    assert.ok(line, `expected a warn line; got ${JSON.stringify(seen)}`);
    assert.match(line.msg, /NOT DELIVERED/);
    assert.match(line.msg, /ECONNREFUSED|ECONNABORTED|EADDRNOTAVAIL/);
  } finally { delete process.env.TEST_DEAD_PING_URL; }
});

test("THE PING URL IS NEVER LOGGED — it is a bearer token", async () => {
  // Anyone holding the URL can send fake pings and hold a check green through
  // an outage. A log line is the wrong place for a credential, and once one is
  // in a log file it is in every log sink downstream.
  const seen = [];
  await capture(async () => {
    const url = process.env.TEST_PING_URL;      // http://127.0.0.1:PORT/hc/abc
    await captureLogs(async (log) => {
      pingStart("TEST_PING_URL");
      await new Promise((r) => setTimeout(r, 250));
      seen.push(...log.map((l) => ({ ...l, url })));
    });
  });
  assert.ok(seen.length > 0, "nothing was logged, so the assertion below would be vacuous");
  for (const l of seen) {
    assert.ok(!l.msg.includes(l.url), `the full URL leaked: ${l.msg}`);
    assert.ok(!l.msg.includes("/hc/abc"), `the token path leaked: ${l.msg}`);
  }
});

test("the failure path is reported without the URL either", async () => {
  process.env.TEST_DEAD_PING_URL = "http://127.0.0.1:1/hc/secret-uuid";
  try {
    const seen = await captureLogs(async (log) => {
      pingFail("TEST_DEAD_PING_URL", "a reason");
      await new Promise((r) => setTimeout(r, 500));
      return log;
    });
    for (const l of seen) {
      assert.ok(!l.msg.includes("secret-uuid"), `the token leaked on the failure path: ${l.msg}`);
      assert.ok(!l.msg.includes("127.0.0.1:1"), `the host leaked on the failure path: ${l.msg}`);
    }
  } finally { delete process.env.TEST_DEAD_PING_URL; }
});

test("a logger that throws still cannot reach the cycle", async () => {
  // The reporting must be as incapable of breaking a cycle as the silence was.
  // `then(ok, err)` returns a NEW promise, so a throw in either handler becomes
  // an unhandled rejection unless it is caught — which is what the trailing
  // .catch is for.
  const saved = logger.debug;
  let unhandled = null;
  const onUnhandled = (err) => { unhandled = err; };
  process.on("unhandledRejection", onUnhandled);
  logger.debug = () => { throw new Error("log transport died"); };
  try {
    await capture(async () => {
      assert.doesNotThrow(() => pingStart("TEST_PING_URL"));
      await new Promise((r) => setTimeout(r, 300));
    });
    assert.equal(unhandled, null, "a throwing logger must not surface as an unhandled rejection");
  } finally {
    logger.debug = saved;
    process.removeListener("unhandledRejection", onUnhandled);
  }
});

test("the once-per-process unset warning is unchanged", async () => {
  delete process.env.NEVER_SET_PING_URL;
  const seen = await captureLogs(async (log) => {
    pingStart("NEVER_SET_PING_URL");
    pingSuccess("NEVER_SET_PING_URL");
    pingFail("NEVER_SET_PING_URL", "x");
    return log;
  });
  const unsetLines = seen.filter((l) => l.msg.includes("NEVER_SET_PING_URL"));
  assert.equal(unsetLines.length, 1, "the unset notice is once per var per process, not per ping");
  assert.equal(unsetLines[0].level, "info");
  assert.match(unsetLines[0].msg, /NO external dead-man switch/);
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
