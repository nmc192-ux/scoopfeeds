/**
 * PROVENANCE, AND THE ONE REFUSAL THIS CHANGE MUST NOT WEAKEN.
 *
 * Gate E introduced own material: footage the operator shot, which is
 * ScoopFeeds' own and has no third party to credit. The obvious implementation
 * — make `creditText` optional — would have silently disabled the credit
 * requirement for genuine third-party assets, which is the one refusal the
 * renderer may never lose. So credit became CONDITIONAL ON PROVENANCE instead,
 * and this file is the proof that the condition is a condition and not a
 * relaxation.
 *
 * The structure of the file is deliberate:
 *
 *   §1  the predicate itself, including every way of NOT being `owner`
 *   §2  the own lane works end to end
 *   §3  THE CRITICAL PROPERTY — a third-party asset with no credit is refused
 *       at all four sites, after the change
 *   §4  the four sites AGREE, walked as a table, so a site nobody remembered
 *       to update fails here rather than in production
 *   §5  drift: any future basis that owes a credit is covered automatically
 *
 * §3 and §4 are the tests to be suspicious of. They are written so that the
 * only way to make them pass with a weakened gate is to delete them.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { makeTestDb } from "../../testing/testDb.js";
import { createCandidate, getCandidate, transition } from "./incidentLedger.js";
import { beginClearing, applyClearance, assertRenderable } from "./incidentClearanceLedger.js";
import {
  assertClearance, ClearanceRefusedError,
  PROVENANCE, OWN_CLEARANCE_BASES, provenanceFor, requiresCredit,
} from "./incidentClearance.js";
import { CLEARANCE_BASES } from "./incidentStatus.js";
import { approveForRender, renderableCandidates, buildQueue, QueueError } from "./incidentQueue.js";
import { toRenderable } from "./incidentCutaways.js";
import { cutawayFrameFor } from "../videoAssembler.js";

function caught(fn, Type) {
  try { fn(); } catch (err) {
    if (Type) assert.ok(err instanceof Type, `expected ${Type.name}, got ${err?.name}: ${err?.message}`);
    return err;
  }
  assert.fail("expected a throw, got none");
}

let seq = 0;
function db0() {
  const t = makeTestDb({ prefix: "incident-prov-" });
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

/** Walk a candidate to `cleared` on a given lane. */
function clearOn(db, id, lane) {
  transition(db, id, "verifying", { checkName: "t" });
  transition(db, id, "verified", { checkName: "t" });
  beginClearing(db, id);
  if (lane === "owner") {
    return applyClearance(db, id, "owner", { declaration: "shot by me at the barrage on the 14th" });
  }
  if (lane === "grant") {
    return applyClearance(db, id, "grant", { grantReference: "https://bsky.app/msg/abc12345" });
  }
  return applyClearance(db, id, "fair_use", {
    sourceType: "eyewitness", excerptSecs: 2, commentaryLayer: true,
  });
}

/**
 * Strip the credit off an already-cleared row, by SQL.
 *
 * NOT REACHABLE THROUGH THE NORMAL PATH, and that is the point. `assertClearance`
 * refuses a third-party lane that produces no credit, so a credit-less grant row
 * can only arrive by a hand edit, a bad migration, or a future code path that
 * forgets. Every one of those is exactly the case the render-path backstop
 * exists for, so the test manufactures it directly rather than pretending it
 * cannot happen.
 */
function stripCredit(db, id) {
  db.prepare("UPDATE media_candidates SET credit_text = NULL WHERE id = ?").run(id);
  return getCandidate(db, id);
}

/** Set the tap by SQL, to test the sites downstream of it in isolation. */
function forceApprove(db, id) {
  db.prepare("UPDATE media_candidates SET render_approved = 1, render_approved_at = ? WHERE id = ?")
    .run(Date.now(), id);
  return getCandidate(db, id);
}

/** A quarantine root holding a real (tiny) file for a candidate id. */
function files(t, ids) {
  const dir = mkdtempSync(path.join(tmpdir(), "inc-prov-"));
  const root = path.join(dir, "q");
  mkdirSync(root, { recursive: true });
  for (const id of ids) writeFileSync(path.join(root, `${id}-treated.mp4`), "x".repeat(2000));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return root;
}

/** Give a cleared row the file columns toRenderable needs. */
function withFile(db, id) {
  db.prepare("UPDATE media_candidates SET local_path = ?, treated_path = ? WHERE id = ?")
    .run(`${id}.mp4`, `${id}-treated.mp4`, id);
  return getCandidate(db, id);
}

// ─── §1 The predicate ───────────────────────────────────────────────────────

test("provenance is an allowlist of exactly one basis", () => {
  assert.deepEqual([...OWN_CLEARANCE_BASES], ["owner"]);
  assert.equal(provenanceFor("owner"), PROVENANCE.OWN);
  assert.equal(requiresCredit("owner"), false);
});

test("everything that is not literally \"owner\" is third-party and owes a credit", () => {
  // Default-deny, walked over the ways a basis can fail to be `owner`: absent,
  // empty, wrong case, whitespace-padded, a real other lane, a plausible new
  // lane, and a non-string. A fail-OPEN default here would mean an unrecognised
  // basis rendering borrowed footage with no attribution, which is the failure
  // this whole engine is built to make impossible.
  for (const basis of [
    null, undefined, "", " ", "Owner", "OWNER", "owner ", " owner",
    "grant", "fair_use", "licence", "handout", "public-domain", 0, 1, {}, [],
  ]) {
    assert.equal(provenanceFor(basis), PROVENANCE.THIRD_PARTY, `provenanceFor(${JSON.stringify(basis)})`);
    assert.equal(requiresCredit(basis), true, `requiresCredit(${JSON.stringify(basis)})`);
  }
});

test("the predicate is not vacuous — it says NO to something", () => {
  // A `requiresCredit` that returned true for everything would pass every
  // refusal test in §3 while making the own lane impossible; one that returned
  // false for everything would pass §2 while disabling the gate entirely.
  // Assert both directions exist.
  assert.equal(requiresCredit("owner"), false);
  assert.equal(requiresCredit("grant"), true);
});

// ─── §2 The own lane ────────────────────────────────────────────────────────

test("owner clearance produces NO credit text, and says so in the row", () => {
  const out = assertClearance(
    { status: "clearing", poster_display: "DrJ" }, "owner",
    { declaration: "shot by me at the barrage on the 14th" }
  );
  assert.equal(out.clearanceBasis, "owner");
  assert.equal(out.creditText, null, "our own footage has no third party to credit");
  assert.equal(out.detail.provenance, PROVENANCE.OWN);
  assert.match(out.detail.creditPolicy, /no on-screen source credit/);
});

test("a poster_display on the row does NOT leak into an owner credit", () => {
  // The row carries a display name from intake. `creditTextFor` would happily
  // compose one out of it; the owner lane must not call it. If it did, our own
  // footage would render crediting whoever the intake record happened to name.
  const out = assertClearance(
    { status: "clearing", poster_display: "Sarah Voss", platform: "bluesky" }, "owner",
    { declaration: "shot by me on the 14th" }
  );
  assert.equal(out.creditText, null);
});

test("an own asset renders: cleared, tapped, uncredited, framed", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  const root = files(t0, [c.id]);

  clearOn(t.db, c.id, "owner");
  assert.equal(getCandidate(t.db, c.id).credit_text, null);

  // The tap accepts it — this is the site that used to refuse a null credit.
  approveForRender(t.db, c.id, { actor: "drj" });
  const row = withFile(t.db, c.id);

  assert.equal(assertRenderable(row), true);
  assert.ok(renderableCandidates(t.db).some((r) => r.id === c.id),
    "the render query must return own material");

  const a = toRenderable(row, { root, orientation: "vertical" });
  assert.equal(a.credit, null, "no credit chip is composited for own material");
  assert.equal(a.creditRequired, false);
  assert.equal(a.provenanceOfRights, PROVENANCE.OWN);
  // NO MASTHEAD SUPPRESSION (DrJ, Gate E). A null frame is full-bleed, which is
  // what covers the masthead; own material is framed so the chrome stays.
  assert.deepEqual(a.frame, cutawayFrameFor("vertical"),
    "own material renders with normal chrome — the masthead is not suppressed");
});

test("a stray credit on an own row is ignored, not burned onto the picture", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  const root = files(t0, [c.id]);
  clearOn(t.db, c.id, "owner");
  // A value left over from before this lane existed, or a hand edit.
  t.db.prepare("UPDATE media_candidates SET credit_text = ? WHERE id = ?").run("ScoopFeeds", c.id);
  approveForRender(t.db, c.id, { actor: "drj" });

  const a = toRenderable(withFile(t.db, c.id), { root, orientation: "vertical" });
  assert.equal(a.credit, null,
    "own material passes no credit to the assembler even when the row carries one");
});

test("the queue tells the operator which kind of row they are tapping", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const own = mk(t.db); clearOn(t.db, own.id, "owner");
  const third = mk(t.db); clearOn(t.db, third.id, "grant");

  const rows = buildQueue(t.db).buckets.awaiting_render_tap;
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId[own.id].provenance, PROVENANCE.OWN);
  assert.equal(byId[own.id].creditRequired, false);
  assert.equal(byId[own.id].creditText, null);
  assert.equal(byId[third.id].provenance, PROVENANCE.THIRD_PARTY);
  assert.equal(byId[third.id].creditRequired, true);
  assert.ok(byId[third.id].creditText, "a third-party row still shows its credit");
});

// ─── §3 THE CRITICAL PROPERTY ───────────────────────────────────────────────
//
// DrJ, Gate E: "a test asserts that a third-party asset with no creditText is
// still refused after this change". Four sites, four assertions, one row.

test("a GRANT asset with no credit is still refused by assertRenderable", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  clearOn(t.db, c.id, "grant");
  approveForRender(t.db, c.id, { actor: "drj" });     // legitimately tapped, WITH a credit
  const row = stripCredit(t.db, c.id);                // then the credit goes missing

  const err = caught(() => assertRenderable(row), ClearanceRefusedError);
  assert.equal(err.code, "no-credit");
  assert.match(err.message, /grant/, "the refusal names the basis it refused");
});

test("a GRANT asset with no credit is still refused by the render tap", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  clearOn(t.db, c.id, "grant");
  stripCredit(t.db, c.id);

  const err = caught(() => approveForRender(t.db, c.id, { actor: "drj" }), QueueError);
  assert.equal(err.code, "no-credit");
  assert.equal(getCandidate(t.db, c.id).render_approved, 0, "and nothing was written");
});

test("a GRANT asset with no credit is still excluded from renderableCandidates", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  clearOn(t.db, c.id, "grant");
  forceApprove(t.db, c.id);                            // tap forced past, as a bypass would
  assert.ok(renderableCandidates(t.db).some((r) => r.id === c.id), "control: it is returned WITH a credit");

  stripCredit(t.db, c.id);
  assert.equal(renderableCandidates(t.db).some((r) => r.id === c.id), false,
    "the query must not return an uncredited third-party asset");
});

test("a GRANT asset with no credit is still refused by toRenderable", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  const root = files(t0, [c.id]);
  clearOn(t.db, c.id, "grant");
  forceApprove(t.db, c.id);
  withFile(t.db, c.id);
  // Control first: with the credit present it renders. Without this, the
  // refusal below could be caused by anything (a missing file, an unset tap)
  // and the test would still be green.
  assert.ok(toRenderable(getCandidate(t.db, c.id), { root }).credit);

  stripCredit(t.db, c.id);
  const err = caught(() => toRenderable(getCandidate(t.db, c.id), { root }), ClearanceRefusedError);
  assert.equal(err.code, "no-credit");
});

test("a FAIR_USE asset with no credit is still refused everywhere", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  const root = files(t0, [c.id]);
  clearOn(t.db, c.id, "fair_use");
  forceApprove(t.db, c.id);
  withFile(t.db, c.id);
  stripCredit(t.db, c.id);

  const row = getCandidate(t.db, c.id);
  assert.equal(caught(() => assertRenderable(row), ClearanceRefusedError).code, "no-credit");
  assert.equal(caught(() => approveForRender(t.db, c.id), QueueError).code, "no-credit");
  assert.equal(renderableCandidates(t.db).some((r) => r.id === c.id), false);
  assert.equal(caught(() => toRenderable(row, { root }), ClearanceRefusedError).code, "no-credit");
});

test("a row with an UNRECOGNISED basis and no credit is refused, not exempted", (t0) => {
  // The failure mode the allowlist exists for: a basis that is neither `owner`
  // nor a known third-party lane must fall on the refusing side.
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  const root = files(t0, [c.id]);
  clearOn(t.db, c.id, "grant");
  forceApprove(t.db, c.id);
  withFile(t.db, c.id);
  stripCredit(t.db, c.id);
  t.db.prepare("UPDATE media_candidates SET clearance_basis = 'licence' WHERE id = ?").run(c.id);

  const row = getCandidate(t.db, c.id);
  assert.equal(caught(() => assertRenderable(row), ClearanceRefusedError).code, "no-credit");
  assert.equal(caught(() => approveForRender(t.db, c.id), QueueError).code, "no-credit");
  assert.equal(renderableCandidates(t.db).some((r) => r.id === c.id), false);
  assert.equal(caught(() => toRenderable(row, { root }), ClearanceRefusedError).code, "no-credit");
});

test("a row with a NULL basis and no credit is refused, not exempted", (t0) => {
  // `NULL IN ('owner')` is NULL in SQL, not true. This is the assertion that
  // the query's three-valued logic falls the safe way.
  const t = db0(); t0.after(() => t.cleanup());
  const c = mk(t.db);
  clearOn(t.db, c.id, "grant");
  forceApprove(t.db, c.id);
  stripCredit(t.db, c.id);
  t.db.prepare("UPDATE media_candidates SET clearance_basis = NULL WHERE id = ?").run(c.id);

  assert.equal(getCandidate(t.db, c.id).clearance_basis, null);
  assert.equal(renderableCandidates(t.db).some((r) => r.id === c.id), false,
    "a NULL basis must not slip through the IN clause");
});

// ─── §4 The four sites agree ────────────────────────────────────────────────

test("all four credit sites give the same answer for every basis × credit combination", (t0) => {
  // THE SITE NOBODY UPDATED. The change touched four places that each held their
  // own copy of "credit_text is non-empty". If one had been missed, the missed
  // one would disagree with the other three for some row — this walks every
  // combination and asserts unanimity, so the disagreement fails here rather
  // than as an uncredited frame on a channel.
  const t = db0(); t0.after(() => t.cleanup());

  for (const basis of CLEARANCE_BASES) {
    for (const hasCredit of [true, false]) {
      const c = mk(t.db);
      const root = files(t0, [c.id]);
      clearOn(t.db, c.id, basis);
      forceApprove(t.db, c.id);
      withFile(t.db, c.id);
      if (!hasCredit) stripCredit(t.db, c.id);
      else t.db.prepare("UPDATE media_candidates SET credit_text = 'Sarah Voss / BLUESKY' WHERE id = ?").run(c.id);

      const row = getCandidate(t.db, c.id);
      const verdicts = {
        assertRenderable: (() => { try { assertRenderable(row); return true; } catch { return false; } })(),
        approveForRender: (() => { try { approveForRender(t.db, c.id); return true; } catch { return false; } })(),
        renderableCandidates: renderableCandidates(t.db, { limit: 200 }).some((r) => r.id === c.id),
        toRenderable: (() => { try { toRenderable(row, { root }); return true; } catch { return false; } })(),
      };

      // The expected answer, derived from the predicate rather than restated:
      // renderable iff the basis does not owe a credit, or one is present.
      const expected = !requiresCredit(basis) || hasCredit;
      for (const [site, got] of Object.entries(verdicts)) {
        assert.equal(got, expected,
          `${site} said ${got} for basis="${basis}" credit=${hasCredit}; expected ${expected}`);
      }
    }
  }
});

// ─── §5 Drift ───────────────────────────────────────────────────────────────

test("every clearance basis resolves to a provenance — none falls through unclassified", () => {
  for (const basis of CLEARANCE_BASES) {
    assert.ok(Object.values(PROVENANCE).includes(provenanceFor(basis)), `basis "${basis}"`);
  }
});

test("exactly one basis is exempt from the credit requirement", () => {
  // If a future lane is added and quietly made exempt, this count changes and
  // the change has to be argued for rather than merged.
  const exempt = CLEARANCE_BASES.filter((b) => !requiresCredit(b));
  assert.deepEqual(exempt, ["owner"],
    "widening the exemption is the one change this file exists to make loud");
});
