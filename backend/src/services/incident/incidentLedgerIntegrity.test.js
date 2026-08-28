/**
 * BOTH HALVES OF THE LEDGER CARRY THE SAME RULE.
 *
 * 032 made the audit trail append-only by trigger and left the table it
 * describes deletable, so erasing a candidate's history never required defeating
 * the trigger: delete the candidate, and the trail is left pointing at nothing —
 * permanently, because the orphans cannot be deleted either. 037 closes it.
 *
 * THE CENTRAL TEST IN THIS FILE IS `the orphan scenario is now impossible`. It is
 * a direct reconstruction of the probe that found the hole, asserting the
 * opposite outcome. If 037's trigger is ever dropped — by a migration, by a
 * "let me just clean up these test rows" script, by anything — that test goes red
 * with the orphan count in the failure message.
 *
 * THE CONTROLS MATTER AS MUCH AS THE REFUSALS. A trigger that froze the whole
 * table would pass every refusal assertion here and break the entire engine,
 * because a candidate row is mutable BY DESIGN — status, credit, the render tap
 * and the file columns all change as it moves through the machine, and the trail
 * is what records each change. So this file asserts, in the same breath, that
 * UPDATE still works and that the state machine can still drive a candidate from
 * intake to construction. Refusal without those controls would be a test that
 * cannot tell "delete is blocked" from "the table is bricked".
 */

import test from "node:test";
import assert from "node:assert/strict";
import { makeTestDb } from "../../testing/testDb.js";
import { createCandidate, getCandidate, candidateTrail, transition } from "./incidentLedger.js";
import { beginClearing, applyClearance } from "./incidentClearanceLedger.js";
import { approveForRender } from "./incidentQueue.js";
import { TRANSITIONS, KILL_REASONS, REVOCATION_REASONS } from "./incidentStatus.js";

function caught(fn) {
  try { fn(); } catch (err) { return err; }
  assert.fail("expected a throw, got none");
}

let seq = 0;
function db0() {
  const t = makeTestDb({ prefix: "incident-integrity-" });
  const n = Date.now();
  t.db.prepare(`INSERT INTO articles (id,title,url,source_name,category,published_at,fetched_at)
                VALUES ('art-1','Bridge reopens','https://n.example/1','E','world',?,?)`).run(n, n);
  return t;
}

const mk = (db) => createCandidate(db, {
  storyKind: "article", storyId: "art-1",
  postUrl: `https://bsky.app/profile/p${++seq}.bsky.social/post/3ki${seq}`,
  posterDisplay: `Poster ${seq}`,
}).candidate;

/** The walk that produced the eight-row trail in the probe. */
function fullWalk(db, id) {
  transition(db, id, "verifying", { checkName: "t" });
  transition(db, id, "verified", { checkName: "t" });
  beginClearing(db, id);
  applyClearance(db, id, "grant", { grantReference: "https://bsky.app/profile/x/post/3kabcdef" });
  approveForRender(db, id, { actor: "drj" });
  transition(db, id, "constructed", { checkName: "render", constructedVideoId: "vid-1" });
}

// ─── The hole, closed ───────────────────────────────────────────────────────

test("the orphan scenario is now impossible", (t0) => {
  // A LITERAL RECONSTRUCTION of the probe that found this. Before 037 the delete
  // SUCCEEDED and left 8 undeletable rows pointing at an id with no row.
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  fullWalk(t.db, c.id);

  const before = candidateTrail(t.db, c.id).length;
  assert.ok(before >= 6, `the walk must produce a real trail to orphan (got ${before} rows)`);

  const err = caught(() => t.db.prepare("DELETE FROM media_candidates WHERE id = ?").run(c.id));
  assert.match(err.message, /may not be deleted/);

  const orphans = t.db.prepare(
    "SELECT COUNT(*) c FROM media_candidate_events e WHERE NOT EXISTS (SELECT 1 FROM media_candidates m WHERE m.id = e.candidate_id)"
  ).get().c;
  assert.equal(orphans, 0, `${orphans} orphan trail row(s) exist — the delete got through`);
  assert.equal(candidateTrail(t.db, c.id).length, before, "and the trail is untouched");
  assert.ok(getCandidate(t.db, c.id), "and the candidate row is still there");
});

test("the refusal names what to do instead", (t0) => {
  // The operator reading this error needs to know the action exists, not just
  // that theirs was refused.
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  const err = caught(() => t.db.prepare("DELETE FROM media_candidates WHERE id = ?").run(c.id));
  assert.match(err.message, /orphan/i);
  assert.match(err.message, /status/i);
  for (const route of ["killed", "uncleared", "revoked"]) assert.match(err.message, new RegExp(route));
});

test("both halves of the ledger refuse a delete", (t0) => {
  // The symmetry itself, asserted in one place. This is the property 032 was
  // reaching for and only half achieved.
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  fullWalk(t.db, c.id);

  const trailErr = caught(() => t.db.prepare("DELETE FROM media_candidate_events WHERE candidate_id = ?").run(c.id));
  const rowErr = caught(() => t.db.prepare("DELETE FROM media_candidates WHERE id = ?").run(c.id));
  assert.match(trailErr.message, /may not be deleted/);
  assert.match(rowErr.message, /may not be deleted/);
});

test("a bulk delete cannot take the table out either", (t0) => {
  // `DELETE FROM media_candidates` with no WHERE is the shape a cleanup script
  // reaches for. Row-level triggers fire on the first row and ABORT rolls back
  // the whole statement, so nothing is lost.
  const t = db0(); t0.after(() => t.cleanup());
  const ids = [mk(t.db).id, mk(t.db).id, mk(t.db).id];

  const err = caught(() => t.db.prepare("DELETE FROM media_candidates").run());
  assert.match(err.message, /may not be deleted/);
  assert.equal(t.db.prepare("SELECT COUNT(*) c FROM media_candidates").get().c, ids.length,
    "an aborted bulk delete must leave every row");
});

// ─── The controls: the table is protected, not frozen ───────────────────────

test("UPDATE still works — the row is mutable by design", (t0) => {
  // WITHOUT THIS the refusals above are indistinguishable from a bricked table.
  // Every column touched here is one the machine writes in normal operation.
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);

  t.db.prepare("UPDATE media_candidates SET embed_only = 1, updated_at = ? WHERE id = ?").run(Date.now(), c.id);
  assert.equal(getCandidate(t.db, c.id).embed_only, 1);

  t.db.prepare("UPDATE media_candidates SET credit_text = ?, local_path = ? WHERE id = ?")
    .run("Sarah Voss / BLUESKY", `${c.id}.mp4`, c.id);
  const row = getCandidate(t.db, c.id);
  assert.equal(row.credit_text, "Sarah Voss / BLUESKY");
  assert.equal(row.local_path, `${c.id}.mp4`);
});

test("the whole machine still runs end to end with the trigger in place", (t0) => {
  // The broadest control available: intake → constructed, through the real
  // ledger functions. A trigger that interfered with anything but DELETE fails
  // here rather than in production.
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  fullWalk(t.db, c.id);

  const row = getCandidate(t.db, c.id);
  assert.equal(row.status, "constructed");
  assert.equal(row.clearance_basis, "grant");
  assert.equal(row.constructed_video_id, "vid-1");
  assert.equal(row.render_approved, 1);
});

test("a DELETE matching no rows is a silent no-op, not an error", (t0) => {
  // SQLite triggers are row-level. A cleanup script that deletes by an id which
  // does not exist should not blow up — it did nothing, which is fine.
  const t = db0(); t0.after(() => t.cleanup());
  mk(t.db);
  const info = t.db.prepare("DELETE FROM media_candidates WHERE id = 'no-such-candidate'").run();
  assert.equal(info.changes, 0);
});

// ─── Retiring is a status, and the machine can express it ───────────────────

test("every non-terminal state has a retirement route that is not a delete", (t0) => {
  // 037's error tells the operator to retire with a status. This asserts the
  // machine can actually honour that from wherever a candidate is sitting, so
  // the advice is not a suggestion to do something impossible.
  const t = db0(); t0.after(() => t.cleanup());

  // verifying → killed (operator)
  const a = mk(t.db);
  transition(t.db, a.id, "verifying", { checkName: "t" });
  transition(t.db, a.id, "killed", { checkName: "retire", killReason: "operator" });
  assert.equal(getCandidate(t.db, a.id).status, "killed");

  // verified → clearing → uncleared
  const b = mk(t.db);
  transition(t.db, b.id, "verifying", { checkName: "t" });
  transition(t.db, b.id, "verified", { checkName: "t" });
  beginClearing(t.db, b.id);
  transition(t.db, b.id, "uncleared", { checkName: "retire" });
  assert.equal(getCandidate(t.db, b.id).status, "uncleared");

  // cleared → revoked (operator)
  const c = mk(t.db);
  transition(t.db, c.id, "verifying", { checkName: "t" });
  transition(t.db, c.id, "verified", { checkName: "t" });
  beginClearing(t.db, c.id);
  applyClearance(t.db, c.id, "grant", { grantReference: "https://bsky.app/profile/x/post/3kabcdef" });
  transition(t.db, c.id, "revoked", { checkName: "retire", revocationReason: "operator" });
  assert.equal(getCandidate(t.db, c.id).status, "revoked");

  assert.ok(KILL_REASONS.includes("operator"));
  assert.ok(REVOCATION_REASONS.includes("operator"));
});

test("a fresh `candidate` row has no direct retirement edge — documented, not hidden", () => {
  // THE ROUGH EDGE 037's HEADER NAMES. A mis-pasted URL has to go
  // candidate → verifying → killed: two audit rows for one decision. Pinned here
  // so that if `candidate → killed` is ever added, this test is the reminder to
  // update the migration header and LEGAL_TRANSITION_COUNT with it.
  assert.deepEqual([...TRANSITIONS.candidate], ["verifying"],
    "if this changed, 037's header and the retirement advice need updating too");
  assert.equal(TRANSITIONS.candidate.includes("killed"), false);
});
