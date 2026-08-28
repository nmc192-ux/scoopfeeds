/**
 * Clearance, with the attention on the refusals and on one property that is
 * easy to state and easy to lose: no treatment of any kind is an input to this
 * module. Grading something does not make it usable, and there is a test that
 * fails if any function starts accepting a treatment argument.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  LANES, EXCERPT_MAX_SECS, EXCERPT_MAX_TOTAL_SECS,
  FAIR_USE_BLOCKED_SOURCE_TYPES, SOURCE_TYPES,
  assertClearance, creditTextFor, fairUseBudgetRemaining, ClearanceRefusedError,
} from "./incidentClearance.js";
import { CUTAWAY_MAX_SECS, MAX_CUTAWAYS } from "../videoStockLibrary.js";
import { CLEARANCE_BASES } from "./incidentStatus.js";

function caught(fn, Type) {
  try { fn(); } catch (err) {
    if (Type) assert.ok(err instanceof Type, `expected ${Type.name}, got ${err?.name}: ${err?.message}`);
    return err;
  }
  assert.fail("expected a throw, got none");
}

const CAND = {
  id: "c1", status: "clearing", platform: "bluesky",
  poster_handle: "alice.bsky.social", poster_display: "Alice R", source_type: "eyewitness",
};

// ─── The caps are inherited, not invented ──────────────────────────────────

test("the excerpt cap IS the cutaway cap — one number, not a copy that can drift", () => {
  assert.equal(EXCERPT_MAX_SECS, CUTAWAY_MAX_SECS);
  assert.equal(EXCERPT_MAX_TOTAL_SECS, CUTAWAY_MAX_SECS * MAX_CUTAWAYS);
  // Stated concretely so a change to the cutaway band is visible here too.
  assert.equal(EXCERPT_MAX_SECS, 3);
  assert.equal(EXCERPT_MAX_TOTAL_SECS, 6);
});

test("the lanes are exactly the machine's clearance bases — no fourth lane", () => {
  assert.deepEqual([...LANES], [...CLEARANCE_BASES]);
  assert.deepEqual([...LANES], ["grant", "fair_use", "owner"]);
});

// ─── Ordering ───────────────────────────────────────────────────────────────

test("clearance is refused from any status but `clearing`", () => {
  for (const status of ["candidate", "verifying", "verified", "killed", "cleared", "uncleared", "constructed"]) {
    const err = caught(
      () => assertClearance({ ...CAND, status }, "owner", { declaration: "shot by me at the barrage" }),
      ClearanceRefusedError
    );
    assert.equal(err.code, "wrong-status", status);
  }
});

test("an unknown lane is refused", () => {
  assert.equal(caught(() => assertClearance(CAND, "vibes", {}), ClearanceRefusedError).code, "bad-lane");
  assert.equal(caught(() => assertClearance(CAND, null, {}), ClearanceRefusedError).code, "bad-lane");
});

// ─── Lane 0 — owner ────────────────────────────────────────────────────────

test("owner clearance needs a real declaration, not a shrug", () => {
  for (const declaration of [undefined, "", "   ", "mine", "yes"]) {
    assert.equal(
      caught(() => assertClearance(CAND, "owner", { declaration }), ClearanceRefusedError).code,
      "no-declaration", JSON.stringify(declaration)
    );
  }
  const out = assertClearance(CAND, "owner", { declaration: "shot by me at the barrage on the 14th" });
  assert.equal(out.clearanceBasis, "owner");
  assert.equal(out.detail.declaration, "shot by me at the barrage on the 14th");
});

test("owner media carries our own name rather than a null credit", () => {
  const out = assertClearance(CAND, "owner", { declaration: "district press release, authorised" });
  assert.equal(out.creditText, "ScoopFeeds");
});

// ─── Lane 2 — grant ────────────────────────────────────────────────────────

test("a grant needs a reference to the actual reply, not a boolean", () => {
  for (const ref of [undefined, "", "yes", true, "ok"]) {
    assert.equal(
      caught(() => assertClearance(CAND, "grant", { grantReference: ref }), ClearanceRefusedError).code,
      "no-grant-reference", JSON.stringify(ref)
    );
  }
  const out = assertClearance(CAND, "grant", { grantReference: "DM screenshot 2026-08-28, saved as grant-c1.png" });
  assert.equal(out.clearanceBasis, "grant");
  assert.equal(out.detail.grantedBy, "alice.bsky.social");
});

test("a grant with no possible credit is refused — an anonymous credit is not a credit", () => {
  const anonymous = { ...CAND, poster_handle: null, poster_display: null };
  const err = caught(
    () => assertClearance(anonymous, "grant", { grantReference: "they said yes in a DM on the 28th" }),
    ClearanceRefusedError
  );
  assert.equal(err.code, "no-credit");
});

test("the terms offered travel with the grant, so old rows say what was actually asked", () => {
  const terms = { credit: "Alice R / BLUESKY", payment: "none offered" };
  const out = assertClearance(CAND, "grant", {
    grantReference: "reply: yes, with credit please", termsOffered: terms, fileSuppliedByPoster: true,
  });
  assert.deepEqual(out.detail.termsOffered, terms);
  assert.equal(out.detail.fileSuppliedByPoster, true);
});

// ─── Lane 3 — fair use ─────────────────────────────────────────────────────

const fairUse = (over = {}) => assertClearance(CAND, "fair_use", {
  sourceType: "eyewitness", excerptSecs: 2.5, commentaryLayer: true, ...over,
});

test("a compliant fair-use excerpt clears and records its limits", () => {
  const out = fairUse();
  assert.equal(out.clearanceBasis, "fair_use");
  assert.equal(out.detail.excerptSecs, 2.5);
  assert.equal(out.detail.excerptMaxSecs, EXCERPT_MAX_SECS);
  assert.equal(out.creditText, "Alice R / BLUESKY");
  assert.match(out.detail.posture, /not a licence/i, "the row says in plain words what this lane is");
});

test("broadcaster, sports and music can NEVER clear under fair use", () => {
  assert.deepEqual([...FAIR_USE_BLOCKED_SOURCE_TYPES], ["broadcaster", "sports", "music"]);
  for (const sourceType of FAIR_USE_BLOCKED_SOURCE_TYPES) {
    const err = caught(() => fairUse({ sourceType }), ClearanceRefusedError);
    assert.equal(err.code, "blocked-source-type", sourceType);
    assert.match(err.message, /Lane 2|Lane 0/, "the refusal should point at the lanes that remain open");
  }
});

test("an unknown source type cannot clear — it cannot be shown NOT to be blocked", () => {
  assert.equal(caught(() => fairUse({ sourceType: "unknown" }), ClearanceRefusedError).code, "unknown-source-type");
  // And the default, when nothing is stated anywhere, is unknown rather than fine.
  const bare = { ...CAND, source_type: null };
  assert.equal(
    caught(() => assertClearance(bare, "fair_use", { excerptSecs: 2, commentaryLayer: true }), ClearanceRefusedError).code,
    "unknown-source-type"
  );
});

test("an unmeasured excerpt is not a limited one", () => {
  for (const secs of [undefined, null, "", "two", NaN, 0, -1]) {
    assert.equal(
      caught(() => fairUse({ excerptSecs: secs }), ClearanceRefusedError).code,
      "no-excerpt-length", JSON.stringify(secs)
    );
  }
});

test("the excerpt cap is enforced, and the refusal says it cannot be raised here", () => {
  assert.equal(fairUse({ excerptSecs: EXCERPT_MAX_SECS }).detail.excerptSecs, EXCERPT_MAX_SECS);
  const err = caught(() => fairUse({ excerptSecs: EXCERPT_MAX_SECS + 0.1 }), ClearanceRefusedError);
  assert.equal(err.code, "excerpt-too-long");
  assert.match(err.message, /cutaway/i);
  assert.equal(caught(() => fairUse({ excerptSecs: 30 }), ClearanceRefusedError).code, "excerpt-too-long");
});

test("the commentary layer must be asserted true, and nothing truthy will do", () => {
  for (const v of [undefined, false, null, "yes", 1, {}]) {
    assert.equal(
      caught(() => fairUse({ commentaryLayer: v }), ClearanceRefusedError).code,
      "no-commentary-layer", JSON.stringify(v)
    );
  }
});

test("fair use with no possible credit is refused", () => {
  const anonymous = { ...CAND, poster_handle: null, poster_display: null };
  const err = caught(
    () => assertClearance(anonymous, "fair_use", { sourceType: "eyewitness", excerptSecs: 2, commentaryLayer: true }),
    ClearanceRefusedError
  );
  assert.equal(err.code, "no-credit");
});

test("the per-video budget is the total across ALL excerpts, not per excerpt", () => {
  assert.equal(fairUseBudgetRemaining(0), 6);
  assert.equal(fairUseBudgetRemaining(3), 3);
  assert.equal(fairUseBudgetRemaining(6), 0);
  assert.equal(fairUseBudgetRemaining(99), 0, "the budget never goes negative");
});

// ─── Treatment is never a basis ────────────────────────────────────────────

test("no treatment of any kind is accepted as, or influences, a clearance", () => {
  // The banned reasoning, asserted as behaviour: passing every treatment word we
  // can think of changes nothing about what clears and what does not.
  const treatments = {
    graded: true, treated: true, duotone: true, cropped: true, kenBurns: true,
    grain: true, houseePalette: true, treatment: "house grade", styled: true,
  };
  // A blocked source type stays blocked no matter how it is treated.
  assert.equal(
    caught(() => assertClearance(CAND, "fair_use", {
      sourceType: "broadcaster", excerptSecs: 2, commentaryLayer: true, ...treatments,
    }), ClearanceRefusedError).code,
    "blocked-source-type"
  );
  // An over-long excerpt stays over-long.
  assert.equal(
    caught(() => assertClearance(CAND, "fair_use", {
      sourceType: "eyewitness", excerptSecs: 10, commentaryLayer: true, ...treatments,
    }), ClearanceRefusedError).code,
    "excerpt-too-long"
  );
  // And a compliant one clears identically with and without them.
  const withT = assertClearance(CAND, "fair_use", { sourceType: "eyewitness", excerptSecs: 2, commentaryLayer: true, ...treatments });
  const withoutT = fairUse({ excerptSecs: 2 });
  assert.deepEqual(
    { ...withT.detail, recordedAt: 0 }, { ...withoutT.detail, recordedAt: 0 },
    "a treatment changed the recorded clearance — treatment must never affect rights"
  );
});

// ─── Credit composition ────────────────────────────────────────────────────

test("credit is poster first, platform second — the licence asks for the creator", () => {
  assert.equal(creditTextFor({ poster_display: "Alice R", platform: "bluesky" }), "Alice R / BLUESKY");
  assert.equal(creditTextFor({ poster_handle: "alice", platform: "x" }), "alice / X");
  assert.equal(creditTextFor({ poster_display: "Alice R", poster_handle: "alice" }), "Alice R",
    "a display name wins over a handle");
});

test("credit is null when there is nothing truthful to say — never a placeholder", () => {
  assert.equal(creditTextFor({}), null);
  assert.equal(creditTextFor({ platform: "x" }), null);
  assert.equal(creditTextFor({ poster_handle: "   ", platform: "x" }), null);
});

test("SOURCE_TYPES covers every blocked type, so the blocklist cannot name a phantom", () => {
  for (const t of FAIR_USE_BLOCKED_SOURCE_TYPES) {
    assert.ok(SOURCE_TYPES.includes(t), `${t} is blocked but is not a known source type`);
  }
});
