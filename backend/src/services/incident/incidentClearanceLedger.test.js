/**
 * Clearance through the ledger, against the real schema.
 *
 * The property worth defending: a `cleared` row can never exist without the
 * credit that made it clearable, because both are written in one transaction.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { makeTestDb } from "../../testing/testDb.js";
import { createCandidate, getCandidate, candidateTrail, setEmbedOnly, transition } from "./incidentLedger.js";
import {
  beginClearing, recordGrantRequest, recordGrantReply, applyClearance,
  markUncleared, assertRenderable, GRANT_OUTCOMES, ClearanceLedgerError,
} from "./incidentClearanceLedger.js";
import { ClearanceRefusedError } from "./incidentClearance.js";
import { IllegalTransitionError } from "./incidentStatus.js";
import { approveForRender } from "./incidentQueue.js";

function caught(fn, Type) {
  try { fn(); } catch (err) {
    if (Type) assert.ok(err instanceof Type, `expected ${Type.name}, got ${err?.name}: ${err?.message}`);
    return err;
  }
  assert.fail("expected a throw, got none");
}

/** A candidate already walked to `verified`. */
function fixture({ toClearing = true } = {}) {
  const t = makeTestDb({ prefix: "incident-clearance-" });
  const n = Date.now();
  t.db.prepare(`
    INSERT INTO articles (id, title, url, source_name, category, published_at, fetched_at)
    VALUES ('art-1', 'Bridge reopens', 'https://n.example/1', 'Example', 'world', ?, ?)
  `).run(n, n);
  const { candidate } = createCandidate(t.db, {
    storyKind: "article", storyId: "art-1",
    postUrl: "https://bsky.app/profile/alice.bsky.social/post/3kaaa",
    posterDisplay: "Alice R",
  });
  transition(t.db, candidate.id, "verifying", { checkName: "t" });
  transition(t.db, candidate.id, "verified", { checkName: "t" });
  if (toClearing) beginClearing(t.db, candidate.id);
  return { ...t, id: candidate.id };
}

// ─── Ordering ───────────────────────────────────────────────────────────────

test("clearing is a state a candidate sits in, and reaching it is recorded", (t0) => {
  const t = fixture({ toClearing: false }); t0.after(() => t.cleanup());
  const row = beginClearing(t.db, t.id, { note: "asked Alice" });
  assert.equal(row.status, "clearing");
  assert.equal(candidateTrail(t.db, t.id).at(-1).check_name, "clearance:begin");
});

test("a verified candidate cannot be cleared without passing through clearing", (t0) => {
  const t = fixture({ toClearing: false }); t0.after(() => t.cleanup());
  assert.throws(
    () => applyClearance(t.db, t.id, "owner", { declaration: "shot by me at the scene" }),
    ClearanceRefusedError
  );
  assert.equal(getCandidate(t.db, t.id).status, "verified");
});

test("an unverified candidate cannot begin clearing at all", (t0) => {
  const t = makeTestDb({ prefix: "incident-clearance-raw-" }); t0.after(() => t.cleanup());
  const n = Date.now();
  t.db.prepare(`INSERT INTO articles (id,title,url,source_name,category,published_at,fetched_at)
                VALUES ('a','t','https://n.example/2','E','world',?,?)`).run(n, n);
  const { candidate } = createCandidate(t.db, {
    storyKind: "article", storyId: "a", postUrl: "https://bsky.app/profile/x.bsky.social/post/3k",
  });
  assert.throws(() => beginClearing(t.db, candidate.id), IllegalTransitionError);
});

// ─── Lane 0 ─────────────────────────────────────────────────────────────────

test("owner clearance writes the basis and the declaration, and NO credit", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const row = applyClearance(t.db, t.id, "owner", { declaration: "shot by me at the barrage on the 14th" });

  assert.equal(row.status, "cleared");
  assert.equal(row.clearance_basis, "owner");
  assert.equal(row.credit_text, null, "own material has no third party to credit (Gate E)");
  const detail = JSON.parse(row.clearance_detail);
  assert.equal(detail.declaration, "shot by me at the barrage on the 14th");
  assert.equal(detail.provenance, "own");
});

test("a refused clearance leaves the row and the trail untouched", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const before = candidateTrail(t.db, t.id).length;
  assert.throws(() => applyClearance(t.db, t.id, "owner", { declaration: "mine" }), ClearanceRefusedError);

  const row = getCandidate(t.db, t.id);
  assert.equal(row.status, "clearing");
  assert.equal(row.credit_text, null);
  assert.equal(row.clearance_basis, null);
  assert.equal(candidateTrail(t.db, t.id).length, before);
});

// ─── Lane 2 ─────────────────────────────────────────────────────────────────

test("the request records the terms offered BEFORE any reply exists", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const { draft } = recordGrantRequest(t.db, t.id, { operatorName: "Nauman", storyTitle: "the bridge" });

  const row = candidateTrail(t.db, t.id).at(-1);
  assert.equal(row.check_name, "clearance:grant-requested");
  assert.equal(row.evidence.creditText, "Alice R / BLUESKY");
  assert.equal(row.evidence.termsOffered.payment, "none offered");
  assert.ok(row.evidence.bodySent.includes(draft.creditText), "the message actually sent is stored");
  // Requesting does not clear anything.
  assert.equal(getCandidate(t.db, t.id).status, "clearing");
});

test("a granted reply clears, and carries the terms the poster was actually shown", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  recordGrantRequest(t.db, t.id, { operatorName: "Nauman" });
  const row = recordGrantReply(t.db, t.id, "granted", {
    grantReference: "DM reply 2026-08-28: yes, use it with credit",
    fileSuppliedByPoster: true,
  });

  assert.equal(row.status, "cleared");
  assert.equal(row.clearance_basis, "grant");
  assert.equal(row.credit_text, "Alice R / BLUESKY");
  const detail = JSON.parse(row.clearance_detail);
  assert.equal(detail.fileSuppliedByPoster, true);
  assert.equal(detail.termsOffered.payment, "none offered",
    "the cleared row recovers what was offered, so it says what the poster agreed to");
});

test("a refusal or a silence goes to uncleared, not to cleared", (t0) => {
  for (const outcome of ["refused", "no_reply"]) {
    const t = fixture();
    try {
      recordGrantRequest(t.db, t.id, { operatorName: "Nauman" });
      const row = recordGrantReply(t.db, t.id, outcome, { replyText: "no thanks" });
      assert.equal(row.status, "uncleared", outcome);
      assert.equal(row.clearance_basis, null);
      assert.equal(row.credit_text, null);
    } finally { t.cleanup(); }
  }
});

test("an uncleared candidate can still be embedded — embedding is not republishing", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  markUncleared(t.db, t.id, { reason: "no reply after a week" });
  const row = setEmbedOnly(t.db, t.id, true);
  assert.equal(row.status, "uncleared");
  assert.equal(row.embed_only, 1);
});

test("only recognised grant outcomes are accepted", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  assert.deepEqual([...GRANT_OUTCOMES], ["granted", "refused", "no_reply"]);
  assert.equal(caught(() => recordGrantReply(t.db, t.id, "maybe"), ClearanceLedgerError).code, "bad-outcome");
  assert.equal(getCandidate(t.db, t.id).status, "clearing");
});

test("a granted reply with no reference is refused — a recorded yes needs something behind it", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  recordGrantRequest(t.db, t.id, { operatorName: "Nauman" });
  assert.throws(() => recordGrantReply(t.db, t.id, "granted", { grantReference: "" }), ClearanceRefusedError);
  assert.equal(getCandidate(t.db, t.id).status, "clearing");
});

// ─── Lane 3 ─────────────────────────────────────────────────────────────────

test("a fair-use clearance records its limits on the row", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const row = applyClearance(t.db, t.id, "fair_use", {
    sourceType: "eyewitness", excerptSecs: 2.5, commentaryLayer: true,
  });
  assert.equal(row.clearance_basis, "fair_use");
  assert.equal(row.source_type, "eyewitness");
  const detail = JSON.parse(row.clearance_detail);
  assert.equal(detail.excerptSecs, 2.5);
  assert.equal(detail.excerptMaxSecs, 3);
});

test("a blocked source type never reaches the database", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  for (const sourceType of ["broadcaster", "sports", "music"]) {
    assert.throws(
      () => applyClearance(t.db, t.id, "fair_use", { sourceType, excerptSecs: 2, commentaryLayer: true }),
      ClearanceRefusedError, sourceType
    );
  }
  assert.equal(getCandidate(t.db, t.id).status, "clearing");
  assert.equal(getCandidate(t.db, t.id).source_type, null);
});

// ─── The renderer's precondition ───────────────────────────────────────────

test("assertRenderable refuses anything not cleared", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  assert.equal(caught(() => assertRenderable(getCandidate(t.db, t.id)), ClearanceRefusedError).code, "not-cleared");
  assert.equal(caught(() => assertRenderable(null), ClearanceRefusedError).code, "no-candidate");

  applyClearance(t.db, t.id, "owner", { declaration: "shot by me at the barrage" });
  // Cleared is not enough on its own — the Phase 4 render tap is also required.
  assert.equal(caught(() => assertRenderable(getCandidate(t.db, t.id)), ClearanceRefusedError).code, "not-approved");
  approveForRender(t.db, t.id);
  assert.equal(assertRenderable(getCandidate(t.db, t.id)), true);
});

test("assertRenderable refuses a cleared row that somehow lost its credit", (t0) => {
  // Defence in depth: the transaction makes this unreachable through this
  // module, so the guard is for whatever bypasses it later.
  // ON A THIRD-PARTY LANE, which is the only lane that owes a credit at all.
  // It used to use the owner lane, which since Gate E is the one basis for
  // which a null credit is correct — running it there now would assert a
  // refusal that must not happen.
  const t = fixture(); t0.after(() => t.cleanup());
  applyClearance(t.db, t.id, "fair_use", { sourceType: "eyewitness", excerptSecs: 2, commentaryLayer: true });
  approveForRender(t.db, t.id);
  t.db.prepare("UPDATE media_candidates SET credit_text = NULL WHERE id = ?").run(t.id);
  const err = caught(() => assertRenderable(getCandidate(t.db, t.id)), ClearanceRefusedError);
  assert.equal(err.code, "no-credit");
  assert.match(err.message, /clearance and credit are one decision/i);
});

test("a cleared row always has both a basis and a credit — they are written together", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  applyClearance(t.db, t.id, "fair_use", { sourceType: "official", excerptSecs: 1.8, commentaryLayer: true });
  const row = getCandidate(t.db, t.id);
  assert.ok(row.clearance_basis);
  assert.ok(row.credit_text);
  assert.ok(row.clearance_detail);
});

test("clearing is terminal-for-clearance: a cleared candidate cannot be re-cleared", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  applyClearance(t.db, t.id, "owner", { declaration: "shot by me at the barrage" });
  assert.throws(
    () => applyClearance(t.db, t.id, "fair_use", { sourceType: "eyewitness", excerptSecs: 2, commentaryLayer: true }),
    ClearanceRefusedError
  );
});
