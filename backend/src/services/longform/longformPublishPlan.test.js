/**
 * longformPublishPlan.test.js — the disclosure is derived, not authored (#78).
 *
 * The load-bearing property: a plan built here ALWAYS satisfies #79's
 * disclosure gate, because both read the same ground truth. The gate then
 * verifies something true by construction rather than being the only defence.
 *
 * That matters because the gate, pointed at real data, found a shipped film
 * declaring isAigc:true while its own LICENSES.md said "None." — a disclosure
 * authored separately from provenance and drifted.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildPublishPlan, buildTikTokPlan, deriveDisclosure, buildSchedule, SLOT_HOUR_UTC } from "./longformPublishPlan.js";
import { disclosureFailures, AIGC_STAMP } from "./longformQcGate.js";

const WITH_AI = `# Licences\n\n${AIGC_STAMP}\n\n- scene A\n`;
const NO_AI = "# Licences\n\n## AI-generated imagery\n**None.**\n\n- Pexels clip A\n";
const SHORTS = [1, 2, 3, 4, 5].map((i) => ({ file: `0${i}_clip.mp4`, title: `Short ${i}`, hook: `Hook ${i}` }));
const base = (over = {}) => ({
  slug: "strait", title: "What happens if the strait closes",
  description: "A film about a chokepoint.", tags: ["ebola"],
  shorts: SHORTS, startFrom: Date.UTC(2026, 7, 26, 9, 0, 0), ...over,
});

// ── The property that matters ───────────────────────────────────────────────

test("A GENERATED PLAN ALWAYS PASSES THE DISCLOSURE GATE — both directions", () => {
  for (const [label, lic, scenes] of [
    ["no AI", NO_AI, []],
    ["with AI", WITH_AI, ["chokepoint-queue", "deal-tears"]],
  ]) {
    const plan = buildPublishPlan(base({ licensesText: lic, generatedScenes: scenes }));
    const tiktok = buildTikTokPlan({ licensesText: lic, generatedScenes: scenes, shorts: SHORTS });
    const fails = disclosureFailures({ licensesText: lic, publishJson: plan, tiktokJson: tiktok });
    assert.deepEqual(fails, [], `${label}: a derived plan must satisfy the gate — got ${fails.join("; ")}`);
  }
});

test("the description can never contradict the provenance", () => {
  const noAi = buildPublishPlan(base({ licensesText: NO_AI }));
  assert.match(noAi.youtube.description, /No AI-generated imagery is used/);
  assert.equal(noAi.syntheticContent, false, "false, not undefined — publish-all prints from this");

  const withAi = buildPublishPlan(base({ licensesText: WITH_AI, generatedScenes: ["a", "b"] }));
  assert.match(withAi.youtube.description, /Contains 2 AI-generated stylized scenes \(a, b\)/);
  assert.doesNotMatch(withAi.youtube.description, /No AI-generated imagery/);
  assert.match(withAi.syntheticContent, /2 AI-generated stylized scenes/);
});

test("an author's description claiming the opposite cannot survive", () => {
  // The author writes something wrong; the derived line is appended and the
  // gate reads the provenance, so the plan still cannot ship a false claim.
  const plan = buildPublishPlan(base({
    licensesText: WITH_AI, generatedScenes: ["a"],
    description: "No AI-generated imagery was used anywhere.",
  }));
  const fails = disclosureFailures({ licensesText: WITH_AI, publishJson: plan, tiktokJson: null });
  assert.ok(fails.length > 0, "the gate must still catch an author's contradictory sentence");
  assert.match(fails.join("\n"), /a false public statement/);
});

test("absent provenance REFUSES rather than guessing a disclosure", () => {
  assert.throws(() => deriveDisclosure(null),
    /cannot be derived from absent provenance, and must never be guessed/);
});

// ── Scheduling ──────────────────────────────────────────────────────────────

test("the film lands first; Shorts follow one per day, so each has a destination", () => {
  const s = buildSchedule(Date.UTC(2026, 7, 26, 9, 0, 0), 5);
  assert.equal(s.filmAt, "2026-08-26T19:00:00.000Z", "next 19:00 UTC = 3pm US Eastern");
  assert.equal(s.shortAts.length, 5);
  assert.equal(s.shortAts[0], "2026-08-27T19:00:00.000Z", "the first Short is the day AFTER the film");
  const days = s.shortAts.map((t) => new Date(t).getUTCDate());
  assert.deepEqual(days, [27, 28, 29, 30, 31], "one per day — five shots at the feed, not five competing");
  assert.ok(new Date(s.filmAt) < new Date(s.shortAts[0]), "no Short may precede its destination");
});

test("a slot less than an hour away rolls to the next day", () => {
  // A slot minutes from now leaves no room to notice a mistake before it is
  // public — and everything goes up private until the slot.
  const s = buildSchedule(Date.UTC(2026, 7, 26, 18, 30, 0), 3);
  assert.equal(s.filmAt, "2026-08-27T19:00:00.000Z");
  const ok = buildSchedule(Date.UTC(2026, 7, 26, 17, 0, 0), 3);
  assert.equal(ok.filmAt, "2026-08-26T19:00:00.000Z", "two hours is enough");
});

test("Facebook does not publish into the same minute as YouTube", () => {
  const s = buildSchedule(Date.UTC(2026, 7, 26, 9, 0, 0), 5);
  assert.notEqual(s.facebookAt, s.filmAt);
  assert.ok(new Date(s.facebookAt) > new Date(s.filmAt));
});

// ── Shape publish-all.mjs validates ─────────────────────────────────────────

test("every field publish-all.mjs preflights is present", () => {
  const p = buildPublishPlan(base({ licensesText: NO_AI }));
  for (const [k, v] of [["film", p.film], ["thumb", p.thumb],
                        ["youtube.title", p.youtube?.title],
                        ["youtube.publishAt", p.youtube?.publishAt],
                        ["shorts", p.shorts?.length],
                        ["facebook.publishAt", p.facebook?.publishAt],
                        ["facebook.reel.publishAt", p.facebook?.reel?.publishAt]]) {
    assert.ok(v, `publish-all.mjs preflights "${k}" — it must be generated`);
  }
  assert.equal(p.youtube.categoryId, "25", "News & Politics");
  assert.ok(p.youtube.title.length <= 100);
  assert.equal(p.shorts.length, 5);
  assert.ok(p.shorts.every((s) => s.file && s.publishAt));
});

test("a film with no Shorts is refused — the Shorts are the distribution", () => {
  assert.throws(() => buildPublishPlan(base({ licensesText: NO_AI, shorts: [] })),
    /a film ships with Shorts/);
});
