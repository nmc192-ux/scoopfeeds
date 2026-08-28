/**
 * Revocation and takedown.
 *
 * The property under test is the one the permission request promises: a poster
 * who changes their mind can stop us using their footage — before publication,
 * and after it. The second half is the one that was missing, and the one whose
 * absence made the Gate B message a promise the system could not keep.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { makeTestDb } from "../../testing/testDb.js";
import { createCandidate, getCandidate, candidateTrail, transition } from "./incidentLedger.js";
import { beginClearing, applyClearance, assertRenderable } from "./incidentClearanceLedger.js";
import { ClearanceRefusedError } from "./incidentClearance.js";
import { approveForRender } from "./incidentQueue.js";
import {
  revokeClearance, pendingTakedowns, recordTakedownActioned, RevocationError,
} from "./incidentRevocation.js";
import { REVOCATION_REASONS, KILL_REASONS, IllegalTransitionError } from "./incidentStatus.js";
import { toRenderable } from "./incidentCutaways.js";

function caught(fn, Type) {
  try { fn(); } catch (err) {
    if (Type) assert.ok(err instanceof Type, `expected ${Type.name}, got ${err?.name}: ${err?.message}`);
    return err;
  }
  assert.fail("expected a throw, got none");
}

let seq = 0;
function fixture({ publish = false } = {}) {
  const t = makeTestDb({ prefix: "incident-revoke-" });
  const n = Date.now();
  t.db.prepare(`INSERT INTO articles (id,title,url,source_name,category,published_at,fetched_at)
                VALUES ('art-1','Bridge reopens','https://n.example/1','E','world',?,?)`).run(n, n);
  const { candidate } = createCandidate(t.db, {
    storyKind: "article", storyId: "art-1",
    postUrl: `https://bsky.app/profile/p${++seq}.bsky.social/post/3k${seq}`,
    posterDisplay: "Alice R",
  });
  const id = candidate.id;
  transition(t.db, id, "verifying", { checkName: "t" });
  transition(t.db, id, "verified", { checkName: "t" });
  beginClearing(t.db, id);
  applyClearance(t.db, id, "grant", { grantReference: "DM 2026-08-28: yes, with credit" });
  approveForRender(t.db, id);
  if (publish) transition(t.db, id, "constructed", { checkName: "render", constructedVideoId: "vid-77" });
  return { ...t, id };
}

const NOTE = "Alice DM'd on 29 Aug asking us not to use it after all";

// ─── Before publication — the promise the request actually makes ───────────

test("a cleared candidate can be revoked, and stops being renderable", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  assert.equal(assertRenderable(getCandidate(t.db, t.id)), true);

  const { candidate, requiresTakedown, videoId } = revokeClearance(t.db, t.id, "grantor_withdrew", { note: NOTE });
  assert.equal(candidate.status, "revoked");
  assert.equal(candidate.revocation_reason, "grantor_withdrew");
  assert.ok(candidate.revoked_at > 0);
  assert.equal(requiresTakedown, false, "nothing was published, so there is nothing to pull");
  assert.equal(videoId, null);

  const err = caught(() => assertRenderable(getCandidate(t.db, t.id)), ClearanceRefusedError);
  assert.equal(err.code, "revoked");
  assert.match(err.message, /may never render again/i);
});

test("the render path refuses a revoked asset by name, not as a generic not-cleared", (t0) => {
  // The two mean different things and the operator needs to be told which.
  const t = fixture(); t0.after(() => t.cleanup());
  revokeClearance(t.db, t.id, "grantor_withdrew", { note: NOTE });
  const err = caught(() => toRenderable(getCandidate(t.db, t.id)), ClearanceRefusedError);
  assert.equal(err.code, "revoked");
  assert.match(err.message, /rights were withdrawn/i);
});

test("revocation is terminal — a withdrawn grant cannot be un-withdrawn", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  revokeClearance(t.db, t.id, "grantor_withdrew", { note: NOTE });
  for (const to of ["cleared", "constructed", "clearing", "verified"]) {
    assert.throws(() => transition(t.db, t.id, to, { checkName: "undo", clearanceBasis: "grant", constructedVideoId: "v" }),
      IllegalTransitionError, `revoked → ${to} must be refused`);
  }
});

// ─── After publication — the takedown path ─────────────────────────────────

test("a published candidate can be revoked and flags the video for takedown", (t0) => {
  const t = fixture({ publish: true }); t0.after(() => t.cleanup());
  const { candidate, requiresTakedown, videoId } = revokeClearance(t.db, t.id, "takedown_request", {
    note: "formal request received 30 Aug via email",
  });

  assert.equal(candidate.status, "revoked");
  assert.equal(candidate.takedown_required, 1);
  assert.equal(candidate.takedown_actioned_at, null);
  assert.equal(requiresTakedown, true);
  assert.equal(videoId, "vid-77");
  // The published video id survives the revocation — it is what has to be pulled.
  assert.equal(candidate.constructed_video_id, "vid-77");
});

test("a pre-publication revocation flags NO takedown — there is nothing on a channel", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  revokeClearance(t.db, t.id, "grantor_withdrew", { note: NOTE });
  assert.equal(getCandidate(t.db, t.id).takedown_required, 0);
  assert.deepEqual(pendingTakedowns(t.db), []);
});

test("an outstanding takedown cannot be quietly forgotten", (t0) => {
  const t = fixture({ publish: true }); t0.after(() => t.cleanup());
  revokeClearance(t.db, t.id, "takedown_request", { note: "formal request received 30 Aug" });

  const pending = pendingTakedowns(t.db);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, t.id);
  assert.equal(pending[0].constructed_video_id, "vid-77");
  assert.equal(pending[0].credit_text, "Alice R / BLUESKY");
});

test("only recording the actual takedown clears the bucket", (t0) => {
  const t = fixture({ publish: true }); t0.after(() => t.cleanup());
  revokeClearance(t.db, t.id, "grantor_withdrew", { note: NOTE });
  assert.equal(pendingTakedowns(t.db).length, 1);

  const row = recordTakedownActioned(t.db, t.id, { note: "set to private on YouTube 30 Aug 11:20" });
  assert.ok(row.takedown_actioned_at > 0);
  assert.deepEqual(pendingTakedowns(t.db), [], "the bucket clears only when the video is actually gone");

  const last = candidateTrail(t.db, t.id).at(-1);
  assert.equal(last.check_name, "takedown:actioned");
  assert.equal(last.evidence.videoId, "vid-77");
  assert.ok(Number.isFinite(last.evidence.secondsOutstanding));
});

test("recording a takedown twice, or where none is required, is refused", (t0) => {
  const t = fixture({ publish: true }); t0.after(() => t.cleanup());
  revokeClearance(t.db, t.id, "grantor_withdrew", { note: NOTE });
  recordTakedownActioned(t.db, t.id, { note: "pulled" });
  assert.equal(caught(() => recordTakedownActioned(t.db, t.id), RevocationError).code, "already-actioned");

  const u = fixture(); t0.after(() => u.cleanup());
  revokeClearance(u.db, u.id, "grantor_withdrew", { note: NOTE });
  assert.equal(caught(() => recordTakedownActioned(u.db, u.id), RevocationError).code, "no-takedown-required");
});

// ─── Revocation is not a kill ──────────────────────────────────────────────

test("revocation reasons and kill reasons are separate vocabularies", () => {
  // Recording a withdrawn grant as a kill would put a finding about someone's
  // honesty in a row whose truth is that they changed their mind.
  for (const r of REVOCATION_REASONS) {
    if (r === "operator") continue;   // the one word both legitimately share
    assert.equal(KILL_REASONS.includes(r), false, `"${r}" is in both vocabularies`);
  }
  assert.ok(REVOCATION_REASONS.includes("grantor_withdrew"));
});

test("a revoked row keeps its clearance basis and credit — it WAS cleared, and that is history", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  revokeClearance(t.db, t.id, "grantor_withdrew", { note: NOTE });
  const row = getCandidate(t.db, t.id);
  assert.equal(row.clearance_basis, "grant");
  assert.equal(row.credit_text, "Alice R / BLUESKY");
  assert.equal(row.kill_reason, null, "a revocation must not be recorded as a kill");
});

// ─── Refusals ───────────────────────────────────────────────────────────────

test("a revocation needs a reason from the list and a note with substance", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  assert.equal(caught(() => revokeClearance(t.db, t.id, "because", { note: NOTE }), RevocationError).code, "bad-reason");
  assert.equal(caught(() => revokeClearance(t.db, t.id, "grantor_withdrew"), RevocationError).code, "no-note");
  assert.equal(caught(() => revokeClearance(t.db, t.id, "grantor_withdrew", { note: "  nope " }), RevocationError).code, "no-note");
  assert.equal(getCandidate(t.db, t.id).status, "cleared", "a refused revocation changes nothing");
});

test("a candidate that was never cleared cannot be revoked", (t0) => {
  const t = makeTestDb({ prefix: "incident-revoke-raw-" }); t0.after(() => t.cleanup());
  const n = Date.now();
  t.db.prepare(`INSERT INTO articles (id,title,url,source_name,category,published_at,fetched_at)
                VALUES ('a','t','https://n.example/z','E','world',?,?)`).run(n, n);
  const { candidate } = createCandidate(t.db, {
    storyKind: "article", storyId: "a", postUrl: "https://bsky.app/profile/z.bsky.social/post/3kz",
  });
  assert.throws(() => revokeClearance(t.db, candidate.id, "grantor_withdrew", { note: NOTE }), IllegalTransitionError);
});

test("revoking a candidate that does not exist is an error", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  assert.equal(caught(() => revokeClearance(t.db, "ghost", "grantor_withdrew", { note: NOTE }), RevocationError).code, "no-such-candidate");
});

test("the revocation is in the trail, with the note and where it came from", (t0) => {
  const t = fixture({ publish: true }); t0.after(() => t.cleanup());
  revokeClearance(t.db, t.id, "rights_dispute", { note: "a stringer claims they shot it, not Alice" });
  const last = candidateTrail(t.db, t.id).at(-1);
  assert.equal(last.check_name, "revocation:post-publish");
  assert.equal(last.from_status, "constructed");
  assert.equal(last.to_status, "revoked");
  assert.match(last.evidence.note, /stringer/);
  assert.equal(last.evidence.takedownRequired, true);
});
