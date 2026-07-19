/**
 * videoEditorialPolicy.test.js — Decision D1 editorial boundary.
 *
 * Run: `node --test src/services/videoEditorialPolicy.test.js` (the repo has no
 * npm test script; tests use the built-in node:test runner).
 *
 * D1 (docs/content/video_channel_tracker.md §0): Pakistani domestic politics is
 * out of scope for the public VIDEO channels. This test pins the two halves of
 * that rule:
 *   - the BLOCK set: party names, provincial assemblies, ECP, "deputy commissioner";
 *   - the ALLOW set (the false-positive traps that a naive keyword filter breaks):
 *     "Pakistan floods", "Pakistan India ceasefire", "European Commissioner",
 *     "NFL commissioner".
 *
 * Mechanism note — the ALLOW traps pass by two DIFFERENT routes, and the tests
 * are written to exercise the real route for each:
 *   - "Pakistan floods" / "Pakistan India ceasefire" survive the TERM scan: there
 *     is deliberately no bare "pakistan" term, so a non-global category still
 *     falls through to default-allow. These use a neutral category on purpose.
 *   - "European Commissioner" / "NFL commissioner" survive ONLY via the
 *     global-category short-circuit. The term list contains "commissioner "
 *     (trailing space), which WOULD match "european commissioner announces...";
 *     the world/sports category is what saves them. Testing them with a global
 *     category is therefore testing the actual guard, not a contrivance.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isVideoEligible, filterVideoEligible } from "./videoEditorialPolicy.js";

// ─── BLOCKED — PK domestic politics ─────────────────────────────────────────
// Neutral category ("politics" is in neither the global nor the PK-domestic
// category list) so each case is decided by the HEADLINE term scan, which is
// what we're pinning here.

const BLOCKED = [
  // Party names
  { title: "PTI announces nationwide protest march",        category: "politics", note: "party: PTI" },
  { title: "PML-N and PPP form coalition after polls",      category: "politics", note: "party: PML-N / PPP" },
  { title: "Tehreek-e-Insaf challenges result in court",    category: "politics", note: "party: full name" },
  // Provincial assemblies
  { title: "Punjab Assembly passes new local-government bill", category: "politics", note: "provincial assembly" },
  { title: "Provincial assembly session adjourned in uproar", category: "politics", note: "generic provincial assembly" },
  // ECP
  { title: "ECP announces schedule for local bodies election", category: "politics", note: "ECP" },
  // Deputy commissioner
  { title: "Deputy Commissioner orders inquiry into land grab", category: "politics", note: "deputy commissioner" },
];

for (const c of BLOCKED) {
  test(`D1 blocks: ${c.note} — "${c.title}"`, () => {
    const v = isVideoEligible(c);
    assert.equal(v.allowed, false, `expected BLOCKED but got allowed: ${JSON.stringify(v)}`);
    assert.match(v.rule, /^d1:/, `expected a d1:* rule, got "${v.rule}"`);
  });
}

// ─── ALLOWED via term scan — "Pakistan" alone must not trigger ───────────────
// Neutral category ("news" is in neither list) so these are proven to pass the
// TERM scan, not merely short-circuited by a global category.

const ALLOWED_BY_TERM_SCAN = [
  { title: "Pakistan floods displace millions across Sindh", category: "news", note: "Pakistan floods" },
  { title: "Pakistan and India agree ceasefire along LoC",   category: "news", note: "Pakistan India ceasefire" },
];

for (const c of ALLOWED_BY_TERM_SCAN) {
  test(`D1 allows (term scan): ${c.note} — "${c.title}"`, () => {
    const v = isVideoEligible(c);
    assert.equal(v.allowed, true, `expected ALLOWED but got blocked: ${JSON.stringify(v)}`);
    assert.equal(v.rule, "default-allow", `expected default-allow, got "${v.rule}"`);
  });
}

// ─── ALLOWED via global-category short-circuit ──────────────────────────────
// "commissioner " (with trailing space) is a PK-domestic term, so these would
// be blocked by the term scan under a neutral category. The global category is
// the actual guard that keeps them in scope.

const ALLOWED_BY_GLOBAL_CATEGORY = [
  { title: "European Commissioner unveils new climate package", category: "world",  note: "European Commissioner" },
  { title: "NFL commissioner suspends star quarterback",        category: "sports", note: "NFL commissioner" },
];

for (const c of ALLOWED_BY_GLOBAL_CATEGORY) {
  test(`D1 allows (global category): ${c.note} — "${c.title}"`, () => {
    const v = isVideoEligible(c);
    assert.equal(v.allowed, true, `expected ALLOWED but got blocked: ${JSON.stringify(v)}`);
    assert.equal(v.rule, "global-category", `expected global-category, got "${v.rule}"`);
  });
}

// ─── Mechanism guard — document WHY the global category is required ──────────
// If the "commissioner" traps had a neutral category they WOULD be blocked by
// the term scan. This locks that behavior so a future edit that drops the
// global-category short-circuit fails loudly instead of silently over-blocking.

test("D1 mechanism: 'commissioner ' term would over-block without a global category", () => {
  const neutral = isVideoEligible({ title: "European Commissioner unveils new climate package", category: "politics" });
  assert.equal(neutral.allowed, false);
  assert.equal(neutral.rule, "d1:term");
});

// ─── filterVideoEligible — batch behavior over a mixed candidate list ────────

test("filterVideoEligible keeps only the in-scope candidates", () => {
  const batch = [
    { id: 1, title: "PTI announces nationwide protest march",          category: "politics" }, // blocked
    { id: 2, title: "Pakistan floods displace millions across Sindh",  category: "news" },     // allowed
    { id: 3, title: "ECP announces schedule for local bodies election", category: "politics" }, // blocked
    { id: 4, title: "NFL commissioner suspends star quarterback",      category: "sports" },   // allowed
    { id: 5, title: "Pakistan and India agree ceasefire along LoC",    category: "news" },     // allowed
  ];
  const kept = filterVideoEligible(batch);
  assert.deepEqual(kept.map(a => a.id), [2, 4, 5]);
});
