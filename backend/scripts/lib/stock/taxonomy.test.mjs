/**
 * taxonomy.test.mjs — the subject-class taxonomy is data, and has to stay valid data.
 *
 * Run: cd backend && node --test "scripts/lib/stock/*.test.mjs"
 *
 * The taxonomy is deliberately a JSON file rather than a module: adding a class
 * must never require a code change (§4). The cost of that choice is that nothing
 * type-checks it, so a class with no queries — which would acquire nothing, in
 * silence — is caught here instead.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TAXONOMY_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "../../stock-taxonomy.json"
);
const taxonomy = JSON.parse(readFileSync(TAXONOMY_PATH, "utf8"));
const classes = taxonomy.classes;

test("the taxonomy file parses and holds a class list", () => {
  assert.ok(Array.isArray(classes), "classes must be an array");
  assert.ok(classes.length > 0);
});

test("every class carries at least one search query", () => {
  // A class with no queries acquires nothing and reports nothing wrong.
  for (const c of classes) {
    assert.ok(Array.isArray(c.queries), `${c.id}: queries must be an array`);
    assert.ok(c.queries.length >= 1, `${c.id}: needs at least one query`);
    for (const q of c.queries) {
      assert.equal(typeof q, "string", `${c.id}: every query is a string`);
      assert.ok(q.trim().length > 0, `${c.id}: no empty queries`);
    }
  }
});

test("class ids are unique and safe to use in a filename", () => {
  // Ids become asset ids and therefore filenames: ports-0003.mp4.
  const seen = new Set();
  for (const c of classes) {
    assert.match(c.id, /^[a-z0-9-]+$/, `${c.id}: lowercase, digits and hyphens only`);
    assert.ok(!seen.has(c.id), `${c.id}: duplicated`);
    seen.add(c.id);
  }
});

test("every class records the editorial constraint that applies to it", () => {
  // The rule that stock illustrates the SUBJECT and never the EVENT is the whole
  // editorial basis for this library, and curation is where it is enforced.
  for (const c of classes) {
    assert.equal(typeof c.editorial, "string", `${c.id}: needs an editorial note for curation`);
    assert.ok(c.editorial.length > 10, `${c.id}: the editorial note must say something`);
  }
});

test("ports and ships come first — they unblock Prototype 2", () => {
  const byPriority = [...classes].sort((a, b) => a.priority - b.priority);
  assert.deepEqual(byPriority.slice(0, 2).map((c) => c.id), ["ports", "ships"]);
});

test("the classes that must exclude identifiable people say so", () => {
  // §4 names these three explicitly; a face standing in for real people is the
  // failure mode the whole subject-not-event rule exists to prevent.
  for (const id of ["trading-floor", "courtroom", "parliament"]) {
    const cls = classes.find((c) => c.id === id);
    assert.ok(cls, `${id} must be in the taxonomy`);
    assert.match(cls.editorial, /face|people|politician/i, `${id}: must record the no-identifiable-people rule`);
  }
});

test("a flag class exists for each country the brief names", () => {
  for (const country of ["china", "us", "russia", "india", "pakistan", "ukraine", "israel", "iran", "eu", "uk"]) {
    assert.ok(classes.some((c) => c.id === `flag-${country}`), `flag-${country} is missing`);
  }
});
