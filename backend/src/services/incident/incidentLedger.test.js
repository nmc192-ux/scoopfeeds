/**
 * The ledger's contract, against a real schema.
 *
 * These run on makeTestDb() rather than a hand-rolled stub, so the migration and
 * its triggers are the ones being exercised. A ledger tested against a stub
 * table would prove nothing about the append-only guarantee, which lives in the
 * database rather than in this module.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { makeTestDb } from "../../testing/testDb.js";
import {
  createCandidate, getCandidate, transition, setEmbedOnly, setAcquisition,
  candidateTrail, listCandidates, createCommission, LedgerError,
} from "./incidentLedger.js";
import { IllegalTransitionError } from "./incidentStatus.js";
import { IntakeRefusedError } from "./incidentIntake.js";

/** node:assert's throws() returns undefined; these tests inspect the error code. */
function caught(fn, Type) {
  try { fn(); } catch (err) {
    if (Type) assert.ok(err instanceof Type, `expected ${Type.name}, got ${err?.name}: ${err?.message}`);
    return err;
  }
  assert.fail("expected a throw, got none");
}

/** A DB with one article to hang candidates off. */
function fixture() {
  const t = makeTestDb({ prefix: "incident-ledger-" });
  const now = Date.now();
  t.db.prepare(`
    INSERT INTO articles (id, title, url, source_name, category, published_at, fetched_at)
    VALUES ('art-1', 'A thing happened', 'https://news.example/1', 'Example', 'world', ?, ?)
  `).run(now, now);
  return t;
}

const URL_A = "https://bsky.app/profile/alice.bsky.social/post/3kaaa";
const URL_B = "https://bsky.app/profile/bob.bsky.social/post/3kbbb";

const make = (db, url = URL_A, over = {}) =>
  createCandidate(db, { storyKind: "article", storyId: "art-1", postUrl: url, ...over });

// ─── Intake ─────────────────────────────────────────────────────────────────

test("a pasted URL becomes a candidate with its lane and poster recorded", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const { created, candidate } = make(t.db);

  assert.equal(created, true);
  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.platform, "bluesky");
  assert.equal(candidate.poster_handle, "alice.bsky.social");
  assert.equal(candidate.story_kind, "article");
  assert.equal(candidate.story_id, "art-1");
  assert.equal(candidate.acquisition, "none");
  assert.equal(candidate.embed_only, 0);
  assert.equal(candidate.kill_reason, null);
  assert.equal(candidate.clearance_basis, null);
});

test("intake itself is in the trail — a candidate's own existence has provenance", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const { candidate } = make(t.db);
  const trail = candidateTrail(t.db, candidate.id);

  assert.equal(trail.length, 1);
  assert.equal(trail[0].from_status, null);
  assert.equal(trail[0].to_status, "candidate");
  assert.equal(trail[0].check_name, "intake");
  assert.equal(trail[0].evidence.platform, "bluesky");
  assert.equal(trail[0].evidence.sourceUrl, URL_A, "the URL as pasted is kept, not just the canonical one");
});

test("the same post pasted twice is not an error and not a second row", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const first = make(t.db);
  const again = make(t.db, "https://bsky.app/profile/alice.bsky.social/post/3kaaa?x=1");

  assert.equal(again.created, false);
  assert.equal(again.candidate.id, first.candidate.id);
  assert.equal(t.db.prepare("SELECT COUNT(*) c FROM media_candidates").get().c, 1);
  assert.equal(candidateTrail(t.db, first.candidate.id).length, 1, "a duplicate paste writes no trail row");
});

test("an unparseable URL is refused before anything is written", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  assert.throws(() => make(t.db, "https://some-blog.example/post/1"), IntakeRefusedError);
  assert.equal(t.db.prepare("SELECT COUNT(*) c FROM media_candidates").get().c, 0);
  assert.equal(t.db.prepare("SELECT COUNT(*) c FROM media_candidate_events").get().c, 0);
});

test("a candidate cannot be attached to a story that does not exist", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const err = caught(
    () => createCandidate(t.db, { storyKind: "article", storyId: "nope", postUrl: URL_A }),
    LedgerError
  );
  assert.equal(err.code, "no-such-story");
  assert.equal(t.db.prepare("SELECT COUNT(*) c FROM media_candidates").get().c, 0);
});

test("story_kind must be one this ledger knows how to check", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const err = caught(
    () => createCandidate(t.db, { storyKind: "vibes", storyId: "art-1", postUrl: URL_A }),
    LedgerError
  );
  assert.equal(err.code, "bad-story-kind");
});

test("the operator's media type wins over the URL's guess; a bad one is refused", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const { candidate } = make(t.db, URL_A, { mediaType: "photo" });
  assert.equal(candidate.media_type, "photo");
  assert.throws(() => make(t.db, URL_B, { mediaType: "gif" }), LedgerError);
});

test("claimed date and location are stored as claims, and absent is null not zero", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const ts = Date.UTC(2026, 7, 20);
  const withClaim = make(t.db, URL_A, { claimedAt: ts, claimedLocation: "Lahore" }).candidate;
  assert.equal(withClaim.claimed_at, ts);
  assert.equal(withClaim.claimed_location, "Lahore");

  const without = make(t.db, URL_B).candidate;
  assert.equal(without.claimed_at, null);
  assert.equal(without.claimed_location, null);
});

// ─── The machine, through the database ──────────────────────────────────────

test("the happy path walks the full machine and leaves a complete trail", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const { candidate } = make(t.db);
  const id = candidate.id;

  transition(t.db, id, "verifying", { checkName: "queue" });
  transition(t.db, id, "verified", { checkName: "corroboration", evidence: { independentPosts: 2 } });
  transition(t.db, id, "clearing", { checkName: "grant-drafted" });
  transition(t.db, id, "cleared", { checkName: "grant-received", clearanceBasis: "grant", actor: "operator" });
  const final = transition(t.db, id, "constructed", { checkName: "render", constructedVideoId: "vid-77" });

  assert.equal(final.status, "constructed");
  assert.equal(final.clearance_basis, "grant");
  assert.equal(final.constructed_video_id, "vid-77");

  const trail = candidateTrail(t.db, id);
  assert.deepEqual(
    trail.map((r) => r.to_status),
    ["candidate", "verifying", "verified", "clearing", "cleared", "constructed"]
  );
  assert.deepEqual(trail.map((r) => r.check_name),
    ["intake", "queue", "corroboration", "grant-drafted", "grant-received", "render"]);
  assert.equal(trail[2].evidence.independentPosts, 2);
});

test("the clearance basis survives construction — the reason is not erased by the use", (t0) => {
  // The first version of transition() wrote assertTransition's detail straight
  // through, and assertTransition returns nulls for every field the TARGET state
  // does not establish. So arriving at `constructed` blanked clearance_basis:
  // the record of why an asset was usable disappeared at the exact moment it got
  // used, which is when it matters most.
  const t = fixture(); t0.after(() => t.cleanup());
  const { candidate } = make(t.db);
  const id = candidate.id;
  transition(t.db, id, "verifying", { checkName: "queue" });
  transition(t.db, id, "verified", { checkName: "corroboration" });
  transition(t.db, id, "clearing", { checkName: "grant-drafted" });
  transition(t.db, id, "cleared", { checkName: "grant-received", clearanceBasis: "owner" });
  assert.equal(getCandidate(t.db, id).clearance_basis, "owner");

  transition(t.db, id, "constructed", { checkName: "render", constructedVideoId: "vid-1" });
  const row = getCandidate(t.db, id);
  assert.equal(row.clearance_basis, "owner", "the basis must persist past construction");
  assert.equal(row.constructed_video_id, "vid-1");
});

test("a kill reason likewise persists — a terminal row keeps its own explanation", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const { candidate } = make(t.db);
  transition(t.db, candidate.id, "verifying", { checkName: "queue" });
  transition(t.db, candidate.id, "killed", { checkName: "vision", killReason: "context_mismatch" });
  assert.equal(getCandidate(t.db, candidate.id).kill_reason, "context_mismatch");
});

test("an illegal transition changes nothing — not the row, not the trail", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const { candidate } = make(t.db);
  transition(t.db, candidate.id, "verifying", { checkName: "queue" });
  transition(t.db, candidate.id, "verified", { checkName: "corroboration" });

  assert.throws(
    () => transition(t.db, candidate.id, "constructed", { checkName: "sneak", constructedVideoId: "vid-1" }),
    IllegalTransitionError
  );

  assert.equal(getCandidate(t.db, candidate.id).status, "verified");
  assert.equal(getCandidate(t.db, candidate.id).constructed_video_id, null);
  assert.equal(candidateTrail(t.db, candidate.id).length, 3, "the refused move must leave no audit row");
});

test("a kill without a reason rolls back entirely", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const { candidate } = make(t.db);
  transition(t.db, candidate.id, "verifying", { checkName: "queue" });

  assert.throws(() => transition(t.db, candidate.id, "killed", { checkName: "prior-appearance" }), IllegalTransitionError);
  assert.equal(getCandidate(t.db, candidate.id).status, "verifying");
  assert.equal(candidateTrail(t.db, candidate.id).length, 2);

  const killed = transition(t.db, candidate.id, "killed", { checkName: "prior-appearance", killReason: "stale" });
  assert.equal(killed.status, "killed");
  assert.equal(killed.kill_reason, "stale");
});

test("a killed candidate is done — every onward move is refused", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const { candidate } = make(t.db);
  transition(t.db, candidate.id, "verifying", { checkName: "queue" });
  transition(t.db, candidate.id, "killed", { checkName: "op", killReason: "operator" });

  for (const to of ["verifying", "verified", "clearing", "cleared", "constructed"]) {
    assert.throws(
      () => transition(t.db, candidate.id, to, { checkName: "retry", clearanceBasis: "owner", constructedVideoId: "v" }),
      IllegalTransitionError, `killed → ${to} must be refused`
    );
  }
  assert.equal(getCandidate(t.db, candidate.id).status, "killed");
});

test("a transition with no check name is refused — an unattributed change is not a record", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const { candidate } = make(t.db);
  const err = caught(() => transition(t.db, candidate.id, "verifying", {}), LedgerError);
  assert.equal(err.code, "no-check-name");
  assert.equal(candidateTrail(t.db, candidate.id).length, 1);
});

test("transitioning a candidate that does not exist is an error, not a silent no-op", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const err = caught(() => transition(t.db, "ghost", "verifying", { checkName: "q" }), LedgerError);
  assert.equal(err.code, "no-such-candidate");
});

// ─── The append-only guarantee lives in the database ────────────────────────

test("an audit row cannot be updated, even by direct SQL", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const { candidate } = make(t.db);
  assert.throws(
    () => t.db.prepare("UPDATE media_candidate_events SET to_status = 'verified' WHERE candidate_id = ?").run(candidate.id),
    /append-only/
  );
  assert.equal(candidateTrail(t.db, candidate.id)[0].to_status, "candidate");
});

test("an audit row cannot be deleted, even by direct SQL", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const { candidate } = make(t.db);
  transition(t.db, candidate.id, "verifying", { checkName: "queue" });
  assert.throws(
    () => t.db.prepare("DELETE FROM media_candidate_events WHERE candidate_id = ?").run(candidate.id),
    /append-only/
  );
  assert.equal(candidateTrail(t.db, candidate.id).length, 2);
});

test("the append-only guard is not vacuous — inserting still works", (t0) => {
  // If the triggers were written so broadly that nothing could be written at
  // all, the two tests above would pass for the wrong reason.
  const t = fixture(); t0.after(() => t.cleanup());
  const { candidate } = make(t.db);
  transition(t.db, candidate.id, "verifying", { checkName: "queue" });
  transition(t.db, candidate.id, "verified", { checkName: "corroboration" });
  assert.equal(candidateTrail(t.db, candidate.id).length, 3);
});

// ─── Lanes that are not the machine ─────────────────────────────────────────

test("embed-only is orthogonal to status and still leaves a trail row", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const { candidate } = make(t.db);
  const on = setEmbedOnly(t.db, candidate.id, true);
  assert.equal(on.embed_only, 1);
  assert.equal(on.status, "candidate", "setting the lane must not move the machine");

  const trail = candidateTrail(t.db, candidate.id);
  assert.equal(trail.at(-1).check_name, "embed-only:on");
  assert.equal(trail.at(-1).from_status, trail.at(-1).to_status, "no edge was traversed");
});

test("a candidate killed for render use can still be embed-only", (t0) => {
  // Embedding is the platform serving its own post; republishing pixels is not.
  const t = fixture(); t0.after(() => t.cleanup());
  const { candidate } = make(t.db);
  transition(t.db, candidate.id, "verifying", { checkName: "queue" });
  transition(t.db, candidate.id, "killed", { checkName: "sensitivity", killReason: "sensitive_story" });

  const row = setEmbedOnly(t.db, candidate.id, true);
  assert.equal(row.embed_only, 1);
  assert.equal(row.status, "killed");
});

test("acquisition is recorded, validated, and is never a rights statement", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const { candidate } = make(t.db);
  assert.throws(() => setAcquisition(t.db, candidate.id, "cleared"), LedgerError);
  assert.throws(() => setAcquisition(t.db, candidate.id, "licensed"), LedgerError);

  const held = setAcquisition(t.db, candidate.id, "held");
  assert.equal(held.acquisition, "held");
  // Holding the file moved nothing in the machine. This is the property that
  // stops "we have the file" from reading as "we may use the file".
  assert.equal(held.status, "candidate");
  assert.equal(held.clearance_basis, null);
});

// ─── Commissions ────────────────────────────────────────────────────────────

test("a commission is a story stub that does NOT enter the event graph", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const before = t.db.prepare("SELECT COUNT(*) c FROM events").get().c;
  const commission = createCommission(t.db, { topic: "Flooding in the district", outputKind: "short" });

  assert.ok(commission.id);
  assert.equal(commission.output_kind, "short");
  assert.equal(
    t.db.prepare("SELECT COUNT(*) c FROM events").get().c, before,
    "a commission must not create an article-less event — that shape has caused two production failures"
  );
});

test("a commissioned candidate runs the same machine as any other", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const commission = createCommission(t.db, { topic: "Flooding", outputKind: "short" });
  const { candidate } = createCandidate(t.db, {
    storyKind: "commission", storyId: commission.id, postUrl: URL_A, intakeSource: "commissioned",
  });

  assert.equal(candidate.status, "candidate", "commissioning changes where candidates come from, not which gates they pass");
  assert.equal(candidate.intake_source, "commissioned");
  assert.throws(
    () => transition(t.db, candidate.id, "cleared", { checkName: "shortcut", clearanceBasis: "owner" }),
    IllegalTransitionError,
    "owner media still has to pass verification"
  );
});

test("a commission needs a topic and a known output kind", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  assert.throws(() => createCommission(t.db, { topic: "  " }), LedgerError);
  assert.throws(() => createCommission(t.db, { topic: "x", outputKind: "podcast" }), LedgerError);
});

// ─── Listing ────────────────────────────────────────────────────────────────

test("the queue lists by status and by story, and rejects a status it does not know", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const a = make(t.db, URL_A).candidate;
  make(t.db, URL_B);
  transition(t.db, a.id, "verifying", { checkName: "queue" });

  assert.equal(listCandidates(t.db).length, 2);
  assert.equal(listCandidates(t.db, { status: "verifying" }).length, 1);
  assert.equal(listCandidates(t.db, { status: "candidate" }).length, 1);
  assert.equal(listCandidates(t.db, { storyKind: "article", storyId: "art-1" }).length, 2);
  assert.equal(listCandidates(t.db, { storyId: "other" }).length, 0);
  assert.throws(() => listCandidates(t.db, { status: "banana" }), LedgerError);
});

test("the list limit is clamped rather than trusted", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  make(t.db);
  assert.equal(listCandidates(t.db, { limit: 0 }).length, 1);
  assert.equal(listCandidates(t.db, { limit: -5 }).length, 1);
  assert.equal(listCandidates(t.db, { limit: 99999 }).length, 1);
});
