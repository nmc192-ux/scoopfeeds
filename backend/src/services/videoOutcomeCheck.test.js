/**
 * videoOutcomeCheck.test.js — the switch that watches video_posts, not the cycle.
 *
 * Two outages (2026-08-12, 2026-08-30) ran green on the cycle dead-man while
 * nothing published — cause upstream of the runner both times. This check's
 * verdict comes from rows in the window, so any upstream starvation (LLM
 * credits, selection drought, quota) surfaces as /fail with a reason.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { pingVideoOutcome } from "./videoAutopost.js";

const HOUR = 3600_000;

async function capture(fn) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      hits.push({ url: req.url, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(200); res.end("OK");
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.VIDEO_OUTCOME_PING_URL = `http://127.0.0.1:${server.address().port}/hc/outcome`;
  try {
    await fn(hits);
    await new Promise((r) => setTimeout(r, 150));   // fire-and-forget needs a beat
  } finally {
    delete process.env.VIDEO_OUTCOME_PING_URL;
    server.close();
  }
  return hits;
}

test("videos in the window ping bare success", async () => {
  const hits = await capture(async () => {
    const r = pingVideoOutcome({ _count: () => 3, _lastAt: () => Date.now() - HOUR });
    assert.equal(r.ok, true);
    assert.equal(r.windowH, 6, "the measured default");
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, "/hc/outcome", "success is the bare URL — no suffix");
});

test("ZERO in the window pings /fail with the forensic detail", async () => {
  // The whole point: the reason arrives WITH the page, so 2am-DrJ reads
  // "last publish 14.9h ago" instead of ssh-ing into a green dashboard.
  const now = Date.now();
  const hits = await capture(async () => {
    const r = pingVideoOutcome({
      produced: 0, tried: 4, skipped: null,
      _count: () => 0, _lastAt: () => now - 14.9 * HOUR, _now: () => now,
    });
    assert.equal(r.ok, false);
    assert.match(r.detail, /no video published in 6h/);
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, "/hc/outcome/fail");
  assert.match(hits[0].body, /last publish 14\.9h ago/);
  assert.match(hits[0].body, /tried=4/);
});

test("the cap-check blind spot: a skipped cycle still tells the truth", async () => {
  // The 2026-08-30 shape exactly: cycle short-circuits at the daily cap,
  // pings the CYCLE check success — and this check still reports the drought.
  const now = Date.now();
  const hits = await capture(async () => {
    pingVideoOutcome({
      produced: 0, tried: 0, skipped: "daily-cap",
      _count: () => 0, _lastAt: () => now - 9 * HOUR, _now: () => now,
    });
  });
  assert.equal(hits[0].url, "/hc/outcome/fail");
  assert.match(hits[0].body, /skipped=daily-cap/);
});

test("a never-published database says so rather than inventing a timestamp", async () => {
  const hits = await capture(async () => {
    pingVideoOutcome({ _count: () => 0, _lastAt: () => 0 });
  });
  assert.match(hits[0].body, /last publish never/);
});

test("VIDEO_OUTCOME_WINDOW_HOURS moves the window", async () => {
  process.env.VIDEO_OUTCOME_WINDOW_HOURS = "12";
  try {
    let asked = null;
    const now = Date.now();
    pingVideoOutcome({ _count: (since) => { asked = since; return 1; }, _now: () => now });
    assert.equal(now - asked, 12 * HOUR);
  } finally { delete process.env.VIDEO_OUTCOME_WINDOW_HOURS; }
});

test("a throwing count costs the ping, never the cycle", async () => {
  const r = pingVideoOutcome({ _count: () => { throw new Error("db locked"); } });
  assert.deepEqual(r, { ok: false, error: true });
});

test("an unset URL is a silent no-op — the pause posture", async () => {
  // Deliberate pause = VIDEO_AUTOPOST_ENABLED unset = the cycle never reaches
  // this call. But even called with no URL configured, nothing must happen.
  delete process.env.VIDEO_OUTCOME_PING_URL;
  const r = pingVideoOutcome({ _count: () => 0, _lastAt: () => 0 });
  assert.equal(r.ok, false, "the verdict is still computed; only the ping is absent");
});
