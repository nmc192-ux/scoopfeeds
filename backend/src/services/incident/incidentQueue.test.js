/**
 * The queue and the render tap.
 *
 * The tap is the thing to scrutinise. A boolean column that only the queue
 * checks is decoration — the assertions here are that the RENDER PATH refuses
 * without it, that it cannot be set on anything not already cleared and
 * credited, and that its default is off, so a candidate nobody looked at is
 * indistinguishable from one that was refused.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { makeTestDb } from "../../testing/testDb.js";
import { createCandidate, getCandidate, candidateTrail, transition } from "./incidentLedger.js";
import { beginClearing, applyClearance, assertRenderable } from "./incidentClearanceLedger.js";
import { ClearanceRefusedError } from "./incidentClearance.js";
import {
  BUCKETS, bucketFor, buildQueue, pendingRulings,
  approveForRender, withdrawRenderApproval, renderableCandidates, QueueError,
} from "./incidentQueue.js";
import { runVerification, recordHumanVerdict } from "./incidentVerifyRunner.js";
import { VERDICTS } from "./incidentChecks.js";

function caught(fn, Type) {
  try { fn(); } catch (err) {
    if (Type) assert.ok(err instanceof Type, `expected ${Type.name}, got ${err?.name}: ${err?.message}`);
    return err;
  }
  assert.fail("expected a throw, got none");
}

let seq = 0;
function db0() {
  const t = makeTestDb({ prefix: "incident-queue-" });
  const n = Date.now();
  t.db.prepare(`INSERT INTO articles (id,title,url,source_name,category,published_at,fetched_at)
                VALUES ('art-1','Bridge reopens','https://n.example/1','E','world',?,?)`).run(n, n);
  return t;
}
const mk = (db, over = {}) => createCandidate(db, {
  storyKind: "article", storyId: "art-1",
  postUrl: `https://bsky.app/profile/p${++seq}.bsky.social/post/3k${seq}`,
  posterDisplay: `Poster ${seq}`, ...over,
}).candidate;

/** Walk a candidate all the way to `cleared`. */
function toCleared(db, id) {
  transition(db, id, "verifying", { checkName: "t" });
  transition(db, id, "verified", { checkName: "t" });
  beginClearing(db, id);
  return applyClearance(db, id, "owner", { declaration: "shot by me at the scene on the 14th" });
}

// ─── The tap is a real gate ────────────────────────────────────────────────

test("the tap defaults to OFF — an asset nobody looked at cannot render", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const row = toCleared(t.db, mk(t.db).id);
  assert.equal(row.render_approved, 0);
  assert.equal(caught(() => assertRenderable(row), ClearanceRefusedError).code, "not-approved");
});

test("the RENDER PATH refuses without the tap, not just the queue", (t0) => {
  // If only the queue checked this, any render path that skipped the queue
  // would draw untapped assets. assertRenderable is what the renderer calls.
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  toCleared(t.db, c.id);
  assert.throws(() => assertRenderable(getCandidate(t.db, c.id)), ClearanceRefusedError);
  approveForRender(t.db, c.id);
  assert.equal(assertRenderable(getCandidate(t.db, c.id)), true);
});

test("the tap cannot be given to anything not cleared", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  assert.equal(caught(() => approveForRender(t.db, c.id), QueueError).code, "not-cleared");

  transition(t.db, c.id, "verifying", { checkName: "t" });
  assert.equal(caught(() => approveForRender(t.db, c.id), QueueError).code, "not-cleared");
  transition(t.db, c.id, "verified", { checkName: "t" });
  assert.equal(caught(() => approveForRender(t.db, c.id), QueueError).code, "not-cleared");
  assert.equal(getCandidate(t.db, c.id).render_approved, 0);
});

test("the tap cannot be given to a cleared row with no credit", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  toCleared(t.db, c.id);
  t.db.prepare("UPDATE media_candidates SET credit_text = NULL WHERE id = ?").run(c.id);
  assert.equal(caught(() => approveForRender(t.db, c.id), QueueError).code, "no-credit");
});

test("the tap is recorded — who, when, and what they were approving", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  toCleared(t.db, c.id);
  const row = approveForRender(t.db, c.id, { actor: "drj", note: "looks right" });

  assert.equal(row.render_approved, 1);
  assert.equal(row.render_approved_by, "drj");
  assert.ok(row.render_approved_at > 0);

  const last = candidateTrail(t.db, c.id).at(-1);
  assert.equal(last.check_name, "render:approved");
  assert.equal(last.actor, "drj");
  assert.equal(last.evidence.creditText, "ScoopFeeds");
  assert.equal(last.evidence.note, "looks right");
});

test("an approval can be withdrawn — publishing is a decision, not a finding", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  toCleared(t.db, c.id);
  approveForRender(t.db, c.id);

  const row = withdrawRenderApproval(t.db, c.id, { reason: "changed my mind" });
  assert.equal(row.render_approved, 0);
  assert.equal(row.status, "cleared", "withdrawing is not a kill — the finding has not changed");
  assert.throws(() => assertRenderable(getCandidate(t.db, c.id)), ClearanceRefusedError);
  assert.equal(candidateTrail(t.db, c.id).at(-1).check_name, "render:withdrawn");
});

test("an approval cannot be withdrawn after the asset is already in a video", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  toCleared(t.db, c.id);
  approveForRender(t.db, c.id);
  transition(t.db, c.id, "constructed", { checkName: "render", constructedVideoId: "vid-1" });

  const err = caught(() => withdrawRenderApproval(t.db, c.id), QueueError);
  assert.equal(err.code, "already-constructed");
  assert.match(err.message, /Unlist the video/i, "the message should say what would actually help");
});

// ─── renderableCandidates asks all three conditions at once ────────────────

test("renderableCandidates requires cleared AND tapped AND credited, together", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());

  const cleared = mk(t.db); toCleared(t.db, cleared.id);                    // no tap
  const tapped = mk(t.db); toCleared(t.db, tapped.id); approveForRender(t.db, tapped.id);
  const verified = mk(t.db);
  transition(t.db, verified.id, "verifying", { checkName: "t" });
  transition(t.db, verified.id, "verified", { checkName: "t" });

  const ids = renderableCandidates(t.db).map((r) => r.id);
  assert.deepEqual(ids, [tapped.id]);

  // And a tapped row that later loses its credit drops out, rather than the
  // query trusting the flag alone.
  t.db.prepare("UPDATE media_candidates SET credit_text = '  ' WHERE id = ?").run(tapped.id);
  assert.deepEqual(renderableCandidates(t.db).map((r) => r.id), []);
});

test("renderableCandidates can be scoped to one story", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db); toCleared(t.db, c.id); approveForRender(t.db, c.id);
  assert.equal(renderableCandidates(t.db, { storyKind: "article", storyId: "art-1" }).length, 1);
  assert.equal(renderableCandidates(t.db, { storyId: "other" }).length, 0);
});

// ─── Buckets ────────────────────────────────────────────────────────────────

test("every working status lands in exactly one bucket, and history lands in none", () => {
  assert.equal(bucketFor({ status: "candidate" }), "new");
  assert.equal(bucketFor({ status: "verifying" }), "awaiting_ruling");
  assert.equal(bucketFor({ status: "verified" }), "awaiting_clearance");
  assert.equal(bucketFor({ status: "clearing" }), "awaiting_grant_reply");
  assert.equal(bucketFor({ status: "cleared", render_approved: 0 }), "awaiting_render_tap");

  // Done or dead: not work, so not in the queue.
  assert.equal(bucketFor({ status: "cleared", render_approved: 1 }), null);
  assert.equal(bucketFor({ status: "killed" }), null);
  assert.equal(bucketFor({ status: "uncleared" }), null);
  assert.equal(bucketFor({ status: "constructed" }), null);
});

test("every bucket a row can land in is a declared bucket", () => {
  for (const status of ["candidate", "verifying", "verified", "clearing", "cleared"]) {
    const b = bucketFor({ status, render_approved: 0 });
    assert.ok(BUCKETS.includes(b), `${status} produced "${b}", which is not in BUCKETS`);
  }
});

test("the queue puts the one-tap-away item first, ahead of a pile of new ones", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  for (let i = 0; i < 5; i++) mk(t.db);
  const ready = mk(t.db); toCleared(t.db, ready.id);

  const q = buildQueue(t.db);
  assert.equal(BUCKETS[0], "awaiting_render_tap");
  assert.equal(q.counts.awaiting_render_tap, 1);
  assert.equal(q.counts.new, 5);
  assert.equal(q.buckets.awaiting_render_tap[0].id, ready.id);
});

test("a tapped candidate leaves the queue entirely", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db); toCleared(t.db, c.id);
  assert.equal(buildQueue(t.db).counts.awaiting_render_tap, 1);
  approveForRender(t.db, c.id);
  assert.equal(buildQueue(t.db).counts.awaiting_render_tap, 0);
  assert.equal(buildQueue(t.db).total, 0);
});

test("the per-bucket cap protects the important bucket from a flood of new rows", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  for (let i = 0; i < 12; i++) mk(t.db);
  const ready = mk(t.db); toCleared(t.db, ready.id);

  const q = buildQueue(t.db, { perBucket: 3 });
  assert.equal(q.counts.new, 3, "the cap is per bucket");
  assert.equal(q.counts.awaiting_render_tap, 1, "and the tappable item still survives it");
});

test("the cleared bucket carries the clearance detail, so the tap needs no second request", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  transition(t.db, c.id, "verifying", { checkName: "t" });
  transition(t.db, c.id, "verified", { checkName: "t" });
  beginClearing(t.db, c.id);
  applyClearance(t.db, c.id, "fair_use", { sourceType: "eyewitness", excerptSecs: 2.5, commentaryLayer: true });

  const item = buildQueue(t.db).buckets.awaiting_render_tap[0];
  assert.equal(item.clearanceBasis, "fair_use");
  assert.equal(item.clearanceDetail.excerptSecs, 2.5);
  assert.ok(item.creditText);
});

// ─── Pending rulings carry their evidence ──────────────────────────────────

test("a waiting row says WHY it is waiting, in the check's own words", async (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  await runVerification(t.db, c.id, {
    story: { title: "Bridge reopens after inspection" },
    posts: [
      { id: "p1", posterHandle: "a", hashes: ["ffffffffffffffff"] },
      { id: "p2", posterHandle: "b", hashes: ["0000000000000000"] },
    ],
    reverseSearch: async () => [],
    vision: async () => ({ agreement: "agrees" }),
  });

  const item = buildQueue(t.db).buckets.awaiting_ruling[0];
  assert.equal(item.id, c.id);
  const prior = item.pending.find((p) => p.check === "prior_appearance");
  assert.ok(prior, "prior_appearance should be listed as pending");
  assert.match(prior.note, /not evidence of absence/i,
    "the operator must see the reasoning, not just that something is unresolved");
});

test("a check already ruled on drops out of pending", async (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  const opts = {
    story: { title: "Bridge reopens after inspection" },
    posts: [{ id: "p1", posterHandle: "a", hashes: ["ffffffffffffffff"] }, { id: "p2", posterHandle: "b", hashes: ["0000000000000000"] }],
    reverseSearch: async () => [], vision: async () => ({ agreement: "agrees" }),
  };
  await runVerification(t.db, c.id, opts);
  assert.equal(pendingRulings(t.db, c.id).length, 1);

  recordHumanVerdict(t.db, c.id, "prior_appearance", VERDICTS.PASS, { note: "checked" });
  assert.equal(pendingRulings(t.db, c.id).length, 0);
});

test("a candidate whose verification never ran says exactly that", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  transition(t.db, c.id, "verifying", { checkName: "manual" });
  const pending = pendingRulings(t.db, c.id);
  assert.equal(pending.length, 4);
  for (const p of pending) assert.equal(p.reason, "not_run");
});

test("pendingRulings reads the trail rather than re-running paid checks", async (t0) => {
  // Opening the queue must not spend a reverse search per row.
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  let searches = 0;
  await runVerification(t.db, c.id, {
    story: { title: "Bridge reopens after inspection" },
    posts: [{ id: "p1", posterHandle: "a", hashes: ["ffffffffffffffff"] }, { id: "p2", posterHandle: "b", hashes: ["0000000000000000"] }],
    reverseSearch: async () => { searches++; return []; },
    vision: async () => ({ agreement: "agrees" }),
  });
  assert.equal(searches, 1);
  buildQueue(t.db); buildQueue(t.db); buildQueue(t.db);
  assert.equal(searches, 1, "building the queue must not call the reverse search again");
});

test("approving or withdrawing a candidate that does not exist is an error", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  assert.equal(caught(() => approveForRender(t.db, "ghost"), QueueError).code, "no-such-candidate");
  assert.equal(caught(() => withdrawRenderApproval(t.db, "ghost"), QueueError).code, "no-such-candidate");
});
