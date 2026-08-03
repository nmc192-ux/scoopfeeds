import test from "node:test";
import assert from "node:assert/strict";
import { CATEGORY_TAGS, tagsForCategory } from "./categoryTags.js";

// The token contract, asserted over the WHOLE map rather than a sample: a
// future edit that adds a bucket gets checked automatically.
const TOKEN_RE = /^#[a-z0-9]+$/;

test("every bucket in the map satisfies the token contract", () => {
  for (const [key, tags] of Object.entries(CATEGORY_TAGS)) {
    assert.ok(Array.isArray(tags), `${key}: not an array`);
    assert.ok(tags.length >= 3 && tags.length <= 5, `${key}: length ${tags.length} outside 3-5`);
    assert.equal(new Set(tags).size, tags.length, `${key}: duplicate tags`);
    for (const t of tags) {
      assert.match(t, TOKEN_RE, `${key}: "${t}" is not lowercase/#-prefixed/punctuation-free`);
      assert.ok(!/\s/.test(t), `${key}: "${t}" contains whitespace`);
      assert.ok(!/[.,!?;:]$/.test(t), `${key}: "${t}" has trailing punctuation`);
    }
  }
});

test("a `default` bucket exists", () => {
  assert.ok(Array.isArray(CATEGORY_TAGS.default));
});

test("a known category returns its own bucket", () => {
  assert.deepEqual(tagsForCategory("business"), ["#markets", "#business", "#finance", "#economy", "#stocks"]);
  assert.deepEqual(tagsForCategory("sports"), ["#sports", "#sportsnews", "#sport", "#sportsupdate"]);
  // Collapsed source categories share one bucket.
  assert.deepEqual(tagsForCategory("agentic-ai"), tagsForCategory("tech"));
  assert.deepEqual(tagsForCategory("computer-science"), tagsForCategory("tech"));
  assert.deepEqual(tagsForCategory("medicine"), tagsForCategory("health"));
  assert.deepEqual(tagsForCategory("politics"), tagsForCategory("international"));
});

test("unknown, null, undefined and empty input fall back to default", () => {
  const def = CATEGORY_TAGS.default.slice();
  for (const input of [undefined, null, "", "   ", "not-a-real-category", "WORLD", "geopolitics"]) {
    assert.deepEqual(tagsForCategory(input), def, `input ${JSON.stringify(input)}`);
  }
});

test("feed labels are NOT topic tags — they resolve to default", () => {
  const def = CATEGORY_TAGS.default.slice();
  for (const label of ["top", "publications", "local"]) {
    assert.deepEqual(tagsForCategory(label), def, label);
  }
});

test("input is normalised for case and surrounding whitespace", () => {
  assert.deepEqual(tagsForCategory("  Business  "), tagsForCategory("business"));
  assert.deepEqual(tagsForCategory("TECH"), tagsForCategory("tech"));
});

test("every category observed in prod resolves to a valid 3-5 tag array", () => {
  // The measured vocabulary, verbatim — articles.category plus the two
  // machine-event buckets that only appear on events.
  const OBSERVED = [
    "business", "international", "pakistan", "top", "tech", "sports",
    "computer-science", "politics", "publications", "local", "ai", "cars",
    "science", "agentic-ai", "health", "environment", "self-help", "medicine",
    "weather", "geo",
  ];
  for (const c of OBSERVED) {
    const tags = tagsForCategory(c);
    assert.ok(Array.isArray(tags), `${c}: not an array`);
    assert.ok(tags.length >= 3 && tags.length <= 5, `${c}: length ${tags.length} outside 3-5`);
    for (const t of tags) assert.match(t, TOKEN_RE, `${c}: bad token ${t}`);
  }
});

test("never throws on hostile input", () => {
  const hostile = [
    0, 1, NaN, true, false, [], {}, () => {}, Symbol("x"),
    { toString() { throw new Error("boom"); } },
    // Prototype keys must not resolve to Object.prototype members.
    "constructor", "__proto__", "hasOwnProperty", "toString",
  ];
  for (const input of hostile) {
    let out;
    assert.doesNotThrow(() => { out = tagsForCategory(input); }, `threw on ${String(input?.toString ? "value" : input)}`);
    assert.ok(Array.isArray(out));
    assert.ok(out.length >= 3 && out.length <= 5);
    for (const t of out) assert.match(t, TOKEN_RE);
  }
});

test("never returns more than 5, and the returned array is a safe copy", () => {
  for (const key of Object.keys(CATEGORY_TAGS)) {
    assert.ok(tagsForCategory(key).length <= 5, key);
  }
  // Mutating the result must not corrupt the shared map for later callers.
  const first = tagsForCategory("business");
  first.push("#injected");
  first[0] = "#clobbered";
  assert.deepEqual(tagsForCategory("business"), ["#markets", "#business", "#finance", "#economy", "#stocks"]);
});
