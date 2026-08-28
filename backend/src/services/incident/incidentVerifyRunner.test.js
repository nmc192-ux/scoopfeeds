/**
 * The runner, and the guarantee that makes the human step safe.
 *
 * A human ruling is the only route to `verified` today, so the interesting
 * question is not "does a tap work" but "what can a tap NOT do". The override
 * tests below are the ones to read: if a person could turn a machine kill into a
 * pass, every automated gate in this engine would be advisory.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { makeTestDb } from "../../testing/testDb.js";
import { createCandidate, getCandidate, candidateTrail } from "./incidentLedger.js";
import { VERDICTS, CHECK_NAMES } from "./incidentChecks.js";
import {
  runVerification, recordHumanVerdict, readHumanVerdicts,
  applyHumanVerdicts, outcomeFor, HumanVerdictError, HUMAN_VERDICTS,
} from "./incidentVerifyRunner.js";

const HASH_A = "ffffffffffffffff";
const HASH_B = "0000000000000000";
const STORY = { id: "art-1", title: "Bridge reopens after inspection", category: "world", source_name: "Example" };
const POSTS = [
  { id: "p1", posterHandle: "alice", hashes: [HASH_A] },
  { id: "p2", posterHandle: "bob", hashes: [HASH_B] },
];

function fixture() {
  const t = makeTestDb({ prefix: "incident-runner-" });
  const n = Date.now();
  t.db.prepare(`
    INSERT INTO articles (id, title, url, source_name, category, published_at, fetched_at)
    VALUES ('art-1', ?, 'https://news.example/1', 'Example', 'world', ?, ?)
  `).run(STORY.title, n, n);
  const { candidate } = createCandidate(t.db, {
    storyKind: "article", storyId: "art-1",
    postUrl: "https://bsky.app/profile/alice.bsky.social/post/3kaaa",
  });
  return { ...t, candidate };
}

const opts = (over = {}) => ({
  story: STORY, posts: POSTS,
  reverseSearch: async () => [],
  vision: async () => ({ agreement: "agrees" }),
  ...over,
});

function caught(fn, Type) {
  try { fn(); } catch (err) {
    if (Type) assert.ok(err instanceof Type, `expected ${Type.name}, got ${err?.name}: ${err?.message}`);
    return err;
  }
  assert.fail("expected a throw, got none");
}

// ─── Running ────────────────────────────────────────────────────────────────

test("a clean machine run parks the candidate in verifying, not verified", async (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const out = await runVerification(t.db, t.candidate.id, opts());

  assert.equal(out.outcome, "needs_human");
  assert.deepEqual(out.summary.blockers, ["prior_appearance"]);
  assert.equal(getCandidate(t.db, t.candidate.id).status, "verifying");
});

test("the attempt itself is recorded, so the trail shows verification was run", async (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  await runVerification(t.db, t.candidate.id, opts());
  const trail = candidateTrail(t.db, t.candidate.id);
  assert.deepEqual(trail.map((r) => r.check_name), ["intake", "verification:start"]);
});

test("waiting writes no self-edge — the trail records events, not heartbeats", async (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  await runVerification(t.db, t.candidate.id, opts());
  const n = candidateTrail(t.db, t.candidate.id).length;
  await runVerification(t.db, t.candidate.id, opts());
  await runVerification(t.db, t.candidate.id, opts());
  assert.equal(candidateTrail(t.db, t.candidate.id).length, n, "re-running an unresolved check must not grow the trail");
});

test("a machine kill moves the candidate and records the reason and the evidence", async (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const out = await runVerification(t.db, t.candidate.id, opts({ vision: async () => ({ agreement: "contradicts" }) }));

  assert.equal(out.outcome, "killed");
  const row = getCandidate(t.db, t.candidate.id);
  assert.equal(row.status, "killed");
  assert.equal(row.kill_reason, "context_mismatch");

  const last = candidateTrail(t.db, t.candidate.id).at(-1);
  assert.equal(last.check_name, "verification:context");
  assert.equal(last.evidence.outcome, "killed");
  assert.ok(last.evidence.checks.find((c) => c.check === "context").verdict === VERDICTS.KILL);
});

test("a sensitive story kills with the sensitivity reason before any paid call", async (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  t.db.prepare("UPDATE articles SET title = ? WHERE id = 'art-1'").run("Four killed in bridge collapse");
  let called = false;
  const out = await runVerification(t.db, t.candidate.id, opts({
    story: { ...STORY, title: "Four killed in bridge collapse" },
    reverseSearch: async () => { called = true; return []; },
  }));
  assert.equal(out.outcome, "killed");
  assert.equal(getCandidate(t.db, t.candidate.id).kill_reason, "sensitive_story");
  assert.equal(called, false);
});

test("re-verifying a settled candidate is a harmless no-op, not an illegal transition", async (t0) => {
  // Found by the live exercise: an operator double-tapping verify on a killed
  // candidate would drive the machine at killed -> killed and surface an error
  // for what is a repeat of something already decided.
  const t = fixture(); t0.after(() => t.cleanup());
  await runVerification(t.db, t.candidate.id, opts({ vision: async () => ({ agreement: "contradicts" }) }));
  assert.equal(getCandidate(t.db, t.candidate.id).status, "killed");
  const before = candidateTrail(t.db, t.candidate.id).length;

  const again = await runVerification(t.db, t.candidate.id, opts());
  assert.equal(again.outcome, "killed");
  assert.equal(again.summary.settled, true);
  assert.equal(candidateTrail(t.db, t.candidate.id).length, before, "a no-op must not grow the trail");
});

test("a verified candidate is likewise not re-derived", async (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  await runVerification(t.db, t.candidate.id, opts());
  recordHumanVerdict(t.db, t.candidate.id, "prior_appearance", VERDICTS.PASS, { note: "ok" });
  await runVerification(t.db, t.candidate.id, opts());
  assert.equal(getCandidate(t.db, t.candidate.id).status, "verified");
  const before = candidateTrail(t.db, t.candidate.id).length;

  // Even with inputs that would now kill it — the decision is already recorded,
  // and contradicting it silently would be worse than restating it.
  const again = await runVerification(t.db, t.candidate.id, opts({ vision: async () => ({ agreement: "contradicts" }) }));
  assert.equal(again.outcome, "verified");
  assert.equal(getCandidate(t.db, t.candidate.id).status, "verified");
  assert.equal(candidateTrail(t.db, t.candidate.id).length, before);
});

// ─── The human step ─────────────────────────────────────────────────────────

test("a human PASS on prior appearance is the route to verified", async (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  await runVerification(t.db, t.candidate.id, opts());

  recordHumanVerdict(t.db, t.candidate.id, "prior_appearance", VERDICTS.PASS, {
    note: "checked 6 matching pages; all are aggregator reposts dated after the incident",
  });
  const out = await runVerification(t.db, t.candidate.id, opts());

  assert.equal(out.outcome, "verified");
  assert.equal(getCandidate(t.db, t.candidate.id).status, "verified");
  const last = candidateTrail(t.db, t.candidate.id).at(-1);
  assert.equal(last.check_name, "verification:all-checks");
});

test("the trail says a PERSON settled it, with their note, not that a machine confirmed it", async (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  await runVerification(t.db, t.candidate.id, opts());
  recordHumanVerdict(t.db, t.candidate.id, "prior_appearance", VERDICTS.PASS, { note: "no earlier appearance" });
  const out = await runVerification(t.db, t.candidate.id, opts());

  assert.equal(out.results.prior_appearance.reason, "human:pass");
  assert.equal(out.results.prior_appearance.evidence.humanNote, "no earlier appearance");
  assert.equal(out.results.prior_appearance.evidence.machineReason, "prior_appearance_no_pages",
    "the machine's own finding is preserved beside the human's ruling");
});

test("a human KILL on prior appearance is recorded as stale — the brief's test case (b)", async (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  await runVerification(t.db, t.candidate.id, opts({
    reverseSearch: async () => [{ url: "https://archive.example/2019/flood" }],
  }));
  recordHumanVerdict(t.db, t.candidate.id, "prior_appearance", VERDICTS.KILL, {
    note: "top hit is a 2019 archive page — this footage predates the claimed incident",
  });
  const out = await runVerification(t.db, t.candidate.id, opts({
    reverseSearch: async () => [{ url: "https://archive.example/2019/flood" }],
  }));

  assert.equal(out.outcome, "killed");
  const row = getCandidate(t.db, t.candidate.id);
  assert.equal(row.status, "killed");
  assert.equal(row.kill_reason, "stale");
});

test("rulings survive a fresh machine run — a decision is not discarded by re-checking", async (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  await runVerification(t.db, t.candidate.id, opts());
  recordHumanVerdict(t.db, t.candidate.id, "prior_appearance", VERDICTS.PASS, { note: "ok" });
  assert.deepEqual(Object.keys(readHumanVerdicts(t.db, t.candidate.id)), ["prior_appearance"]);
  const out = await runVerification(t.db, t.candidate.id, opts());
  assert.equal(out.outcome, "verified");
});

test("a later ruling wins and the earlier one stays visible in the trail", async (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  await runVerification(t.db, t.candidate.id, opts());
  recordHumanVerdict(t.db, t.candidate.id, "prior_appearance", VERDICTS.PASS, { note: "first look" });
  recordHumanVerdict(t.db, t.candidate.id, "prior_appearance", VERDICTS.KILL, { note: "second look, found the 2019 copy" });

  assert.equal(readHumanVerdicts(t.db, t.candidate.id).prior_appearance.verdict, VERDICTS.KILL);
  const rulings = candidateTrail(t.db, t.candidate.id).filter((r) => r.check_name === "human:prior_appearance");
  assert.equal(rulings.length, 2, "changing your mind is recorded, not overwritten");
  assert.equal(rulings[0].evidence.verdict, VERDICTS.PASS);
});

// ─── What a tap may NOT do ──────────────────────────────────────────────────

test("a human PASS CANNOT overturn a machine kill — every gate would otherwise be advisory", () => {
  const machineKills = {
    sensitivity: { verdict: VERDICTS.KILL, reason: "sensitive_story", evidence: {} },
    context: { verdict: VERDICTS.KILL, reason: "context_mismatch", evidence: {} },
    corroboration: { verdict: VERDICTS.KILL, reason: "uncorroborated", evidence: {} },
  };
  for (const [check, result] of Object.entries(machineKills)) {
    const err = caught(
      () => applyHumanVerdicts({ [check]: result }, { [check]: { verdict: VERDICTS.PASS } }),
      HumanVerdictError
    );
    assert.equal(err.code, "override-refused", check);
    assert.match(err.message, /fix the check/i, "the message should point at the durable fix");
  }
});

test("a human may always be STRICTER — a kill on a machine-passed check is honoured", () => {
  // A person may refuse for reasons no check models. Refusing is never the
  // dangerous direction, so it is never blocked.
  const out = applyHumanVerdicts(
    { context: { verdict: VERDICTS.PASS, reason: "ok", evidence: {} } },
    { context: { verdict: VERDICTS.KILL, note: "I recognise that street; it is not Genoa" } }
  );
  assert.equal(out.context.verdict, VERDICTS.KILL);
  assert.match(out.context.evidence.humanNote, /not Genoa/);
});

test("a human PASS agreeing with a machine PASS is a no-op, not an error and not a claim", () => {
  // The trap this replaces: the first draft threw here, so recording a stray
  // pass on an already-passing check left the candidate permanently
  // unverifiable — a 200 followed by a permanent 409.
  const machine = { context: { verdict: VERDICTS.PASS, reason: "visible cues agree", evidence: { a: 1 } } };
  const out = applyHumanVerdicts(machine, { context: { verdict: VERDICTS.PASS } });
  assert.equal(out.context.verdict, VERDICTS.PASS);
  assert.equal(out.context.reason, "visible cues agree",
    "the machine's own reason survives — the trail must not claim a person decided what they merely agreed with");
});

test("a stray pass on a passing check does not brick the candidate", async (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  await runVerification(t.db, t.candidate.id, opts());
  recordHumanVerdict(t.db, t.candidate.id, "corroboration", VERDICTS.PASS, { note: "looks fine to me" });
  recordHumanVerdict(t.db, t.candidate.id, "prior_appearance", VERDICTS.PASS, { note: "no earlier appearance" });

  const out = await runVerification(t.db, t.candidate.id, opts());
  assert.equal(out.outcome, "verified", "a redundant ruling must not block verification");
});

test("a pass cannot be recorded against an already-killed candidate", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  return runVerification(t.db, t.candidate.id, opts({ vision: async () => ({ agreement: "contradicts" }) }))
    .then(() => {
      const err = caught(
        () => recordHumanVerdict(t.db, t.candidate.id, "prior_appearance", VERDICTS.PASS, { note: "let it through" }),
        HumanVerdictError
      );
      assert.equal(err.code, "override-refused");
      assert.match(err.message, /terminal/i);
      assert.equal(getCandidate(t.db, t.candidate.id).status, "killed");
    });
});

test("a human kill is still honoured through the runner even though a pass is not", async (t0) => {
  // The asymmetry is deliberate: a person may always be MORE strict.
  const t = fixture(); t0.after(() => t.cleanup());
  await runVerification(t.db, t.candidate.id, opts());
  recordHumanVerdict(t.db, t.candidate.id, "prior_appearance", VERDICTS.KILL, { note: "found it on a 2021 blog" });
  const out = await runVerification(t.db, t.candidate.id, opts());
  assert.equal(out.outcome, "killed");
});

test("only real checks and real verdicts are accepted", () => {
  assert.equal(caught(() => applyHumanVerdicts({}, { nonsense: { verdict: VERDICTS.PASS } }), HumanVerdictError).code, "unknown-check");
  assert.equal(
    caught(() => applyHumanVerdicts(
      { context: { verdict: VERDICTS.NEEDS_HUMAN, reason: "x", evidence: {} } },
      { context: { verdict: "maybe" } }
    ), HumanVerdictError).code,
    "bad-verdict"
  );
  assert.deepEqual([...HUMAN_VERDICTS], [VERDICTS.PASS, VERDICTS.KILL],
    "needs_human is not something a human can hand down — that is what they are resolving");
});

test("recordHumanVerdict validates before it writes", (t0) => {
  const t = fixture(); t0.after(() => t.cleanup());
  const before = candidateTrail(t.db, t.candidate.id).length;
  assert.throws(() => recordHumanVerdict(t.db, t.candidate.id, "nope", VERDICTS.PASS), HumanVerdictError);
  assert.throws(() => recordHumanVerdict(t.db, t.candidate.id, "context", "maybe"), HumanVerdictError);
  assert.throws(() => recordHumanVerdict(t.db, "ghost", "context", VERDICTS.PASS), HumanVerdictError);
  assert.equal(candidateTrail(t.db, t.candidate.id).length, before);
});

// ─── outcomeFor ─────────────────────────────────────────────────────────────

test("outcomeFor is a conjunction and refuses an incomplete result set", () => {
  const all = (v) => Object.fromEntries(CHECK_NAMES.map((n) => [n, { verdict: v, reason: "r" }]));
  assert.equal(outcomeFor(all(VERDICTS.PASS)).outcome, "verified");
  assert.equal(outcomeFor(all(VERDICTS.NEEDS_HUMAN)).outcome, "needs_human");
  assert.equal(outcomeFor(all(VERDICTS.KILL)).outcome, "killed");

  // One abstention among passes is enough to withhold verification.
  const nearly = all(VERDICTS.PASS);
  nearly[CHECK_NAMES[1]] = { verdict: VERDICTS.NEEDS_HUMAN, reason: "r" };
  assert.equal(outcomeFor(nearly).outcome, "needs_human");

  const partial = all(VERDICTS.PASS);
  delete partial[CHECK_NAMES[0]];
  assert.throws(() => outcomeFor(partial), /cannot decide without a verdict/);
});
