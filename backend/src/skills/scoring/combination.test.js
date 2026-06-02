/**
 * combination.test.js — the validation harness (heart of Sprint B.6.1).
 *
 * Proves the score-combination logic against the 15-source v1.0 calibration
 * ground-truth BEFORE any evidence-gathering exists: each calibration source's
 * published component vector is run through combineScore and the result must
 * land within ±5 of the documented combined score (scoring spec §8.1 gate).
 *
 * Plus a synthetic floor-rule unit test (the floor never triggers on the 15
 * real sources — calibration §1.4: closest is Hacker News ET=35, ≥30).
 *
 * Runner: node --test (built-in, zero deps). Run:
 *   node --test backend/src/skills/scoring/
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { combineScore, ScoringInputError } from "./combination.js";
import { CALIBRATION_V1_SOURCES, TOLERANCE } from "./fixtures/calibration_v1.js";

test(`combination reproduces all ${CALIBRATION_V1_SOURCES.length} calibration sources within ±${TOLERANCE}`, () => {
  const results = CALIBRATION_V1_SOURCES.map((s) => {
    const { score } = combineScore(s.c);
    return { name: s.name, expected: s.combined, got: score, delta: score - s.combined };
  });

  // Always print the full table so review sees per-source deltas.
  console.log("\n  Source                       expected  got  Δ");
  for (const r of results) {
    console.log(`  ${r.name.padEnd(28)} ${String(r.expected).padStart(8)} ${String(r.got).padStart(4)} ${r.delta >= 0 ? "+" : ""}${r.delta}`);
  }

  const failures = results.filter((r) => Math.abs(r.delta) > TOLERANCE);
  assert.equal(
    failures.length, 0,
    `${failures.length}/${results.length} outside ±${TOLERANCE}: ` +
      failures.map((f) => `${f.name} expected ${f.expected} got ${f.got} (Δ${f.delta})`).join("; "),
  );
});

test("each calibration source individually within tolerance; none triggers the floor", async (t) => {
  for (const s of CALIBRATION_V1_SOURCES) {
    await t.test(`#${s.n} ${s.name}`, () => {
      const { score, floorTriggered } = combineScore(s.c);
      assert.ok(
        Math.abs(score - s.combined) <= TOLERANCE,
        `expected ${s.combined}, got ${score} (Δ${score - s.combined})`,
      );
      assert.equal(floorTriggered, false, `${s.name} unexpectedly triggered the floor`);
    });
  }
});

test("floor rule: a component <30 caps the overall score at 50 (synthetic)", () => {
  // Strong everywhere except ET=20 (<30). Uncapped weighted sum would be ~73.
  const { score, raw, floorTriggered } = combineScore({ ET: 20, MT: 90, DE: 90, Ind: 90, HA: 90 });
  assert.equal(floorTriggered, true);
  assert.ok(raw > 50, `precondition: uncapped sum should exceed 50 (got ${raw})`);
  assert.ok(score <= 50, `floor should cap at 50, got ${score}`);
});

test("floor rule: exactly 30 does NOT trigger (threshold is strict <30)", () => {
  const { floorTriggered } = combineScore({ ET: 30, MT: 30, DE: 30, Ind: 30, HA: 30 });
  assert.equal(floorTriggered, false);
});

test("combineScore rejects missing or out-of-range components", () => {
  assert.throws(() => combineScore({ ET: 50, MT: 50, DE: 50, Ind: 50 }), ScoringInputError); // missing HA
  assert.throws(() => combineScore({ ET: 120, MT: 50, DE: 50, Ind: 50, HA: 50 }), /\[0,100\]/);
  assert.throws(() => combineScore(null), ScoringInputError);
});
