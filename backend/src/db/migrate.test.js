import test from "node:test";
import assert from "node:assert/strict";
import { assertMigrationOrder, getRegisteredMigrations } from "./migrate.js";

test("the real MIGRATIONS array passes — ids unique and strictly ascending", () => {
  const out = assertMigrationOrder();
  assert.ok(out.count > 0);
  assert.equal(out.count, getRegisteredMigrations().length);
});

test("a DUPLICATE id throws — this is the silent-skip case", () => {
  assert.throws(
    () => assertMigrationOrder([
      { id: "001_a", up() {} },
      { id: "002_b", up() {} },
      { id: "002_b", up() {} },
    ]),
    /duplicate migration id "002_b" at positions 1 and 2/
  );
  // The message must say WHY it matters, not just that it happened — a future
  // reader hitting this at 3am needs the consequence, not the rule.
  assert.throws(() => assertMigrationOrder([
    { id: "001_a", up() {} }, { id: "001_a", up() {} },
  ]), /SILENTLY SKIPPED/);
});

test("two agents appending the SAME number is caught", () => {
  // The near-miss that motivated this: both sessions reach for 024.
  assert.throws(
    () => assertMigrationOrder([
      { id: "022_video_posts", up() {} },
      { id: "023_video_posts_facebook", up() {} },
      { id: "024_event_carousel_seo_line", up() {} },
      { id: "024_something_else", up() {} },
    ]),
    /not strictly ascending — "024_something_else" \(24\) follows 24/
  );
});

test("out-of-order ids throw", () => {
  assert.throws(
    () => assertMigrationOrder([
      { id: "001_a", up() {} },
      { id: "003_c", up() {} },
      { id: "002_b", up() {} },
    ]),
    /not strictly ascending — "002_b" \(2\) follows 3/
  );
});

test("gaps are allowed — a number may be retired without blocking boot", () => {
  assert.doesNotThrow(() => assertMigrationOrder([
    { id: "001_a", up() {} },
    { id: "005_e", up() {} },
    { id: "009_i", up() {} },
  ]));
});

test("a missing or malformed id throws", () => {
  assert.throws(() => assertMigrationOrder([{ up() {} }]), /has no string `id`/);
  assert.throws(() => assertMigrationOrder([{ id: "", up() {} }]), /has no string `id`/);
  assert.throws(() => assertMigrationOrder([{ id: "   ", up() {} }]), /has no string `id`/);
  assert.throws(() => assertMigrationOrder([{ id: "abc_no_number", up() {} }]), /does not start with a 3-digit number/);
});

test("an empty array is vacuously fine", () => {
  assert.doesNotThrow(() => assertMigrationOrder([]));
});
