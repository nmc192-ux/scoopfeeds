/**
 * The checks, with most of the attention on what they refuse to conclude.
 *
 * The single most important assertion in this file is that
 * `checkPriorAppearance` has NO input, anywhere, that yields PASS. That is the
 * property the brief demands and the one that would silently evaporate if a
 * later change added an "if nothing was found, it's clean" branch.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  VERDICTS, CHECK_NAMES,
  checkSensitivity, checkPriorAppearance, checkCorroboration, checkContext,
  MIN_INDEPENDENT_SOURCES,
} from "./incidentChecks.js";

const HASH_A = "ffffffffffffffff";
const HASH_B = "0000000000000000";
const HASH_C = "0f0f0f0f0f0f0f0f";

// ─── Sensitivity ────────────────────────────────────────────────────────────

test("a flagged headline kills third-party media for the whole story", () => {
  for (const title of [
    "Six killed in factory fire",
    "Family mourns after crash",
    "Deadly attack on market",
  ]) {
    const r = checkSensitivity({ storyTitle: title });
    assert.equal(r.verdict, VERDICTS.KILL, title);
    assert.equal(r.reason, "sensitive_story");
  }
});

test("an absent headline is treated as sensitive — the safe path", () => {
  // editorialSensitivity returns true for an empty title by design.
  assert.equal(checkSensitivity({ storyTitle: "" }).verdict, VERDICTS.KILL);
  assert.equal(checkSensitivity({}).verdict, VERDICTS.KILL);
  assert.equal(checkSensitivity({ storyTitle: null }).verdict, VERDICTS.KILL);
});

test("an ordinary headline passes, so the gate is not simply always-kill", () => {
  const r = checkSensitivity({ storyTitle: "Council approves new bus route" });
  assert.equal(r.verdict, VERDICTS.PASS);
});

// ─── Prior appearance — the check that must never pass ─────────────────────

test("prior appearance NEVER returns pass, across every shape of input", async () => {
  const inputs = [
    { },
    { reverseSearch: null },
    { reverseSearch: async () => [] },                                   // the seductive one
    { reverseSearch: async () => [{ url: "https://a.example/1" }] },
    { reverseSearch: async () => [{ url: "https://a.example/1" }, { url: "https://b.example/2" }] },
    { reverseSearch: async () => { throw new Error("upstream 503"); } },
    { reverseSearch: async () => null },
    { reverseSearch: async () => "not an array" },
    { reverseSearch: async () => [], claimedAt: Date.now(), imageRef: "x" },
  ];
  for (const input of inputs) {
    const r = await checkPriorAppearance(input);
    assert.notEqual(
      r.verdict, VERDICTS.PASS,
      `prior appearance returned PASS for ${JSON.stringify(Object.keys(input))} — the cheap reverse-search route ` +
      "cannot date an appearance, so a pass here would be a gate that protects nothing"
    );
    assert.equal(r.verdict, VERDICTS.NEEDS_HUMAN);
  }
});

test("prior appearance distinguishes unmeasured, empty and failed — none is 'clean'", async () => {
  assert.equal((await checkPriorAppearance({})).reason, "prior_appearance_unmeasured");
  assert.equal((await checkPriorAppearance({ reverseSearch: async () => [] })).reason, "prior_appearance_no_pages");
  assert.equal(
    (await checkPriorAppearance({ reverseSearch: async () => [{ url: "u" }] })).reason,
    "prior_appearance_pages_found"
  );
  assert.equal(
    (await checkPriorAppearance({ reverseSearch: async () => { throw new Error("x"); } })).reason,
    "prior_appearance_search_failed"
  );
});

test("zero results says out loud that absence of results is not absence of appearance", async () => {
  const r = await checkPriorAppearance({ reverseSearch: async () => [] });
  assert.match(r.evidence.note, /not evidence of absence/i);
});

test("the pages found are handed to the human, capped, with the claimed date beside them", async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ url: `https://e.example/${i}` }));
  const claimedAt = Date.UTC(2026, 7, 20);
  const r = await checkPriorAppearance({ reverseSearch: async () => many, claimedAt });
  assert.equal(r.evidence.pageCount, 40);
  assert.equal(r.evidence.pages.length, 25, "the queue gets a bounded list");
  assert.equal(r.evidence.claimedAt, claimedAt);
});

// ─── Corroboration ─────────────────────────────────────────────────────────

test("two different posters with different files corroborate", () => {
  const r = checkCorroboration({ posts: [
    { id: "p1", posterHandle: "alice", hashes: [HASH_A] },
    { id: "p2", posterHandle: "bob", hashes: [HASH_B] },
  ]});
  assert.equal(r.verdict, VERDICTS.PASS);
  assert.equal(r.evidence.independentSources, 2);
});

test("the same file posted by two people is ONE source, not two", () => {
  // This is the check's reason to exist: a repost chain must not corroborate
  // itself. Same pixels, different handles.
  const r = checkCorroboration({ posts: [
    { id: "p1", posterHandle: "alice", hashes: [HASH_A] },
    { id: "p2", posterHandle: "bob", hashes: [HASH_A] },
  ]});
  assert.equal(r.verdict, VERDICTS.KILL);
  assert.equal(r.reason, "uncorroborated");
  assert.equal(r.evidence.distinctFiles, 1);
  assert.equal(r.evidence.independentSources, 1);
});

test("one person posting twice with different footage is still ONE source", () => {
  const r = checkCorroboration({ posts: [
    { id: "p1", posterHandle: "alice", hashes: [HASH_A] },
    { id: "p2", posterHandle: "Alice", hashes: [HASH_B] },
  ]});
  assert.equal(r.verdict, VERDICTS.KILL);
  assert.equal(r.evidence.independentSources, 1, "handle comparison is case-insensitive");
});

test("a declared repost or quote is not a second witness", () => {
  for (const field of ["isRepostOf", "isQuoteOf"]) {
    const r = checkCorroboration({ posts: [
      { id: "p1", posterHandle: "alice", hashes: [HASH_A] },
      { id: "p2", posterHandle: "bob", hashes: [HASH_B], [field]: "p1" },
    ]});
    assert.equal(r.verdict, VERDICTS.KILL, field);
    assert.equal(r.evidence.afterRepostFilter, 1);
  }
});

test("two witnesses on the SAME platform still corroborate — platform is not the axis", () => {
  const r = checkCorroboration({ posts: [
    { id: "p1", posterHandle: "alice", platform: "x", hashes: [HASH_A] },
    { id: "p2", posterHandle: "bob", platform: "x", hashes: [HASH_C] },
  ]});
  assert.equal(r.verdict, VERDICTS.PASS);
});

test("a source count that only clears the floor on unhashed media goes to a human", () => {
  // p2 was never hashed, so it MIGHT be a repost of p1 and we cannot tell. The
  // count says 2; the confidence does not.
  const r = checkCorroboration({ posts: [
    { id: "p1", posterHandle: "alice", hashes: [HASH_A] },
    { id: "p2", posterHandle: "bob", hashes: [] },
  ]});
  assert.equal(r.verdict, VERDICTS.NEEDS_HUMAN);
  assert.equal(r.reason, "corroboration_rests_on_unhashed_post");
  assert.deepEqual(r.evidence.unhashedPostIds, ["p2"]);
});

test("an unhashed post that is NOT load-bearing does not block", () => {
  const r = checkCorroboration({ posts: [
    { id: "p1", posterHandle: "alice", hashes: [HASH_A] },
    { id: "p2", posterHandle: "bob", hashes: [HASH_B] },
    { id: "p3", posterHandle: "carol", hashes: [] },
  ]});
  assert.equal(r.verdict, VERDICTS.PASS, "two hashed sources already clear the floor");
});

test("no posts at all is unmeasured, not uncorroborated", () => {
  const r = checkCorroboration({ posts: [] });
  assert.equal(r.verdict, VERDICTS.NEEDS_HUMAN);
  assert.equal(r.reason, "corroboration_no_posts");
});

test("the established-original route passes on human evidence and records it verbatim", () => {
  const r = checkCorroboration({
    posts: [{ id: "p1", posterHandle: "alice", hashes: [HASH_A] }],
    originalityEvidence: "replied to own thread from the scene, 3 min before first aggregator",
  });
  assert.equal(r.verdict, VERDICTS.PASS);
  assert.match(r.evidence.originalityEvidence, /own thread/);
});

test("the floor is two, and one is not two", () => {
  assert.equal(MIN_INDEPENDENT_SOURCES, 2);
  const r = checkCorroboration({ posts: [{ id: "p1", posterHandle: "alice", hashes: [HASH_A] }] });
  assert.equal(r.verdict, VERDICTS.KILL);
});

// ─── Context ───────────────────────────────────────────────────────────────

const STORY = { id: "s1", title: "Bridge collapses in Genoa", category: "world", source_name: "Example" };
const PK_STORY = { id: "s2", title: "Flooding in Lahore", category: "world", source_name: "Example" };

test("a contradiction is a kill regardless of the story", async () => {
  for (const story of [STORY, PK_STORY]) {
    const r = await checkContext({ story, vision: async () => ({ agreement: "contradicts", cues: ["arabic signage"] }) });
    assert.equal(r.verdict, VERDICTS.KILL);
    assert.equal(r.reason, "context_mismatch");
  }
});

test("agreement passes", async () => {
  const r = await checkContext({ story: STORY, vision: async () => ({ agreement: "agrees", reasoning: "italian signage" }) });
  assert.equal(r.verdict, VERDICTS.PASS);
  assert.equal(r.evidence.reasoning, "italian signage");
});

test("cannot-confirm is a KILL on a Pakistan-related story", async () => {
  const r = await checkContext({ story: PK_STORY, vision: async () => ({ agreement: "cannot_tell" }) });
  assert.equal(r.verdict, VERDICTS.KILL);
  assert.equal(r.reason, "cannot_confirm");
  assert.equal(r.evidence.strictBecause, "pakistan_related");
});

test("Pakistan is detected by Rule 0's own matcher, including via the claimed location", async () => {
  // The story says nothing about Pakistan; the CLAIM does. Rule 0's matcher is
  // deliberately over-broad and that is the behaviour being relied on.
  const r = await checkContext({
    story: STORY, claimedLocation: "Rawalpindi", vision: async () => ({ agreement: "cannot_tell" }),
  });
  assert.equal(r.verdict, VERDICTS.KILL);
  assert.equal(r.evidence.strictBecause, "pakistan_related");
});

test("cannot-confirm is a KILL on a politically live story", async () => {
  const r = await checkContext({ story: STORY, politicallyLive: true, vision: async () => ({ agreement: "cannot_tell" }) });
  assert.equal(r.verdict, VERDICTS.KILL);
  assert.equal(r.evidence.strictBecause, "politically_live");
});

test("cannot-confirm elsewhere is a human question, not a kill", async () => {
  const r = await checkContext({ story: STORY, vision: async () => ({ agreement: "cannot_tell" }) });
  assert.equal(r.verdict, VERDICTS.NEEDS_HUMAN);
  assert.equal(r.reason, "context_cannot_confirm");
});

test("no vision pass configured is cannot-confirm, never a pass", async () => {
  assert.equal((await checkContext({ story: STORY })).verdict, VERDICTS.NEEDS_HUMAN);
  assert.equal((await checkContext({ story: PK_STORY })).verdict, VERDICTS.KILL);
});

test("a vision pass that throws is cannot-confirm, never a pass", async () => {
  const vision = async () => { throw new Error("gemini 429"); };
  assert.equal((await checkContext({ story: STORY, vision })).reason, "context_vision_failed");
  assert.equal((await checkContext({ story: PK_STORY, vision })).verdict, VERDICTS.KILL);
});

test("an unrecognised vision answer is cannot-confirm, never agreement", async () => {
  // The failure this prevents: a model returning a shape we did not expect and
  // the code treating "not a contradiction" as "fine".
  for (const answer of [{}, null, { agreement: "maybe" }, { agreement: "" }, "yes", { agreement: "AGREES " }]) {
    const r = await checkContext({ story: STORY, vision: async () => answer });
    assert.notEqual(r.verdict, VERDICTS.PASS, `answer ${JSON.stringify(answer)} must not pass`);
  }
});

test("the check registry names exactly the four checks the brief specifies", () => {
  assert.deepEqual([...CHECK_NAMES], ["sensitivity", "prior_appearance", "corroboration", "context"]);
});
