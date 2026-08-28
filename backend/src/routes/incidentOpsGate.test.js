/**
 * THE DARK GATE ON /scoop-ops/incident, driven over real HTTP.
 *
 * WHY IT EXISTS. The deploy question — "what must be OFF for the engine to ship
 * inert?" — had an uncomfortable answer: selection and rendering were inert BY
 * CONSTRUCTION (nothing calls the selector), `VIDEO_INCIDENT_MEDIA_ENABLED` had
 * no consumer anywhere, and this router was mounted unconditionally. So the flag
 * was decorative and clearing — one of the two decisions that authorise footage
 * onto a channel — was available to anyone holding the admin token.
 *
 * THE THREE PROPERTIES, and each one is a way the gate could be wrong:
 *
 *   writes refuse      — otherwise the gate does nothing
 *   reads still answer — otherwise the deploy check cannot tell "dormant" from
 *                        "not deployed", which is the whole reason this is a 503
 *                        and not an unmounted router
 *   revoke survives    — otherwise turning the engine off after publication also
 *                        turns off the only way to withdraw what it published
 *
 * A test that only asserted the first would pass a gate that 503'd everything,
 * including the withdrawal path. That gate would be worse than none.
 *
 * Real express, real router, real HTTP. The flag is flipped between requests
 * because `incidentMediaEnabled()` reads process.env at call time.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import http from "http";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "incident-gate-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = DATA_DIR;

const express = (await import("express")).default;
const { default: incidentOpsRouter } = await import("./incident-ops.js");

const app = express();
app.use("/scoop-ops/incident", incidentOpsRouter);
const server = http.createServer(app);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/scoop-ops/incident`;

test.after(() => server.close());

const FLAG = "VIDEO_INCIDENT_MEDIA_ENABLED";
const setFlag = (v) => { if (v === undefined) delete process.env[FLAG]; else process.env[FLAG] = v; };

async function call(method, p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* some routes may not return JSON */ }
  return { status: res.status, body: json };
}

/** Every mutating route on the router, by the shape a caller would use. */
const WRITES = [
  ["POST", "/candidates", { storyKind: "article", storyId: "a", postUrl: "https://bsky.app/profile/a.bsky.social/post/3kaaaaaa" }],
  ["POST", "/commissions", { topic: "t", outputKind: "short" }],
  ["POST", "/candidates/abc/embed-only", { embedOnly: true }],
  ["POST", "/candidates/abc/acquisition", { acquisition: "held" }],
  ["POST", "/candidates/abc/verify", {}],
  ["POST", "/candidates/abc/human-verdict", { check: "prior_appearance", verdict: "pass" }],
  ["POST", "/candidates/abc/begin-clearing", {}],
  ["POST", "/candidates/abc/grant-draft", {}],
  ["POST", "/candidates/abc/grant-reply", { outcome: "granted" }],
  ["POST", "/candidates/abc/clear", { lane: "owner" }],
  ["POST", "/candidates/abc/uncleared", {}],
  ["POST", "/candidates/abc/approve-render", {}],
  ["POST", "/candidates/abc/withdraw-render", {}],
];

const READS = ["/clearance-rules", "/queue", "/renderable", "/candidates", "/takedowns"];

// ─── Flag off: writes refuse ────────────────────────────────────────────────

test("with the flag off, every mutating route refuses with a named 503", async () => {
  setFlag(undefined);
  for (const [method, p, body] of WRITES) {
    const { status, body: out } = await call(method, p, body);
    assert.equal(status, 503, `${method} ${p} returned ${status}`);
    assert.equal(out.code, "incident_engine_disabled", `${method} ${p}`);
    assert.match(out.error, /VIDEO_INCIDENT_MEDIA_ENABLED/,
      "the refusal must name the flag — an operator should not have to diagnose it");
  }
});

test("only the literal string \"1\" opens the gate", async () => {
  for (const v of [undefined, "", "0", "true", "yes", "TRUE", " 1", "1 "]) {
    setFlag(v);
    const { status } = await call("POST", "/candidates/abc/begin-clearing", {});
    assert.equal(status, 503, `flag ${JSON.stringify(v)} must not open the gate`);
  }
});

// ─── Flag off: reads still answer ───────────────────────────────────────────

test("with the flag off, reads still answer — dormant must be distinguishable from absent", async () => {
  setFlag(undefined);
  for (const p of READS) {
    const { status } = await call("GET", p);
    assert.notEqual(status, 503, `GET ${p} was gated; the deploy check depends on it answering`);
    assert.notEqual(status, 404, `GET ${p} 404'd; that is indistinguishable from "not deployed"`);
  }
});

test("the dormancy check itself works with the flag off", async () => {
  // This is the exact request docs/ops says to run after a deploy.
  setFlag(undefined);
  const { status, body } = await call("GET", "/clearance-rules");
  assert.equal(status, 200);
  assert.deepEqual([...body.lanes].sort(), ["fair_use", "grant", "owner"]);
  assert.equal(typeof body.excerptMaxSecs, "number");
});

// ─── Flag off: withdrawal is never gated ────────────────────────────────────

test("revoke and takedown-actioned are NOT gated — disabling the engine must not disable withdrawal", async () => {
  // Turning the flag off after something is published is a likely response to
  // trouble. If that also switched off the withdrawal path, the act of reacting
  // to a problem would remove the remedy for it.
  setFlag(undefined);
  for (const p of ["/candidates/abc/revoke", "/candidates/abc/takedown-actioned"]) {
    const { status, body } = await call("POST", p, { reason: "operator", note: "a note long enough to be real" });
    assert.notEqual(status, 503, `${p} must never be gated`);
    assert.notEqual(body?.code, "incident_engine_disabled", `${p} must never be gated`);
  }
});

test("the exemption is anchored — it does not open neighbouring paths", async () => {
  // A substring match would let these through. The exemption is the one hole in
  // the gate, so it gets to be exactly two paths and no more.
  setFlag(undefined);
  for (const p of [
    "/candidates/abc/revoke-everything",
    "/candidates/abc/takedown-actioned-later",
    "/candidates/abc/revokex",
    "/revoke",
  ]) {
    const { status } = await call("POST", p, {});
    assert.notEqual(status, 200, `${p} must not be treated as the revoke route`);
  }
  // And the two real ones still are.
  for (const p of ["/candidates/abc/revoke", "/candidates/abc/revoke/"]) {
    const { body } = await call("POST", p, { reason: "operator", note: "a note long enough to be real" });
    assert.notEqual(body?.code, "incident_engine_disabled", `${p} is the real revoke route`);
  }
});

// ─── Flag on: the gate is out of the way ────────────────────────────────────

test("with the flag on, writes are no longer refused BY THE GATE", async () => {
  // They may still fail for their own reasons — no such candidate, bad payload.
  // What must not appear is the gate's own code. Without this the whole file
  // would pass against a gate that refused everything unconditionally.
  setFlag("1");
  let sawSomethingElse = false;
  for (const [method, p, body] of WRITES) {
    const { body: out } = await call(method, p, body);
    assert.notEqual(out?.code, "incident_engine_disabled", `${method} ${p} was still gated with the flag on`);
    if (out?.code || out?.error) sawSomethingElse = true;
  }
  assert.ok(sawSomethingElse,
    "the routes must actually have been reached and answered for themselves");
  setFlag(undefined);
});
