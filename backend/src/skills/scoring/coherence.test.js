/**
 * coherence.test.js — doc↔code coherence (scoring spec §6.2).
 *
 * Guarantees the committed rubric (rubric.js) matches what the source
 * documentation states, so the two can never silently drift. The numeric
 * weights + floor rule are published in the calibration audit §1.2 (the doc
 * that actually states the numbers — the methodology doc keeps them
 * qualitative); this test parses that table and asserts rubric.js agrees. If
 * the doc is reformatted or a number changes without a matching rubric.js
 * update (or vice-versa), this test fails loudly.
 *
 * Weights are stable v1.0 → v1.1 (calibration §4 refinements are rubric
 * sub-criteria, not weight changes), so binding the v1.1 rubric to the v1.0
 * calibration §1.2 table is correct.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUBRIC } from "./rubric.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// skills/scoring → skills → src → backend → repo root (4 up), then docs/...
const CALIBRATION_DOC = path.resolve(
  __dirname,
  "../../../../docs/audits/phase_a_source_audit_phase2_calibration.md",
);

const doc = fs.readFileSync(CALIBRATION_DOC, "utf8");

// §1.2 weight rows look like:  | Editorial track record (ET) | 25% |
function docWeight(label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = doc.match(new RegExp(`\\|\\s*${escaped}\\s*\\|\\s*(\\d+)%`));
  assert.ok(m, `calibration §1.2 weight row not found for "${label}"`);
  return Number(m[1]);
}

test("rubric weights match calibration §1.2 verbatim", () => {
  assert.equal(RUBRIC.weights.ET,  docWeight("Editorial track record (ET)"));
  assert.equal(RUBRIC.weights.Ind, docWeight("Independence (Ind)"));
  assert.equal(RUBRIC.weights.HA,  docWeight("Historical accuracy (HA)"));
  assert.equal(RUBRIC.weights.MT,  docWeight("Methodology transparency (MT)"));
  assert.equal(RUBRIC.weights.DE,  docWeight("Domain expertise (DE)"));
});

test("rubric weights sum to 100 and each is within the §3.1 published 5–40% bound", () => {
  const vals = Object.values(RUBRIC.weights);
  assert.equal(vals.reduce((a, b) => a + b, 0), 100);
  for (const w of vals) assert.ok(w >= 5 && w <= 40, `weight ${w} outside the 5–40% bound`);
});

test("rubric floor rule matches calibration §1.2 (<30 → cap 50)", () => {
  const m = doc.match(/below\s+(\d+),?\s+overall quality score is capped at\s+(\d+)/i);
  assert.ok(m, "calibration §1.2 floor-rule sentence not found");
  assert.equal(RUBRIC.floor.threshold, Number(m[1]));
  assert.equal(RUBRIC.floor.cap, Number(m[2]));
});

test("rubric methodology_version is recorded", () => {
  assert.match(RUBRIC.methodology_version, /^v\d+\.\d+$/);
});
