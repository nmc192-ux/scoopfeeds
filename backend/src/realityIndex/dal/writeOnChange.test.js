/**
 * writeOnChange — the change gate for the snapshot time-series.
 *
 * Measured on a 6.6GB prod snapshot (2026-08-16): 99.96% of consecutive
 * reality_index rows and 100.0% of consecutive sentiment rows were identical.
 * These tests pin the three properties DrJ named as load-bearing, because each
 * one fails SILENTLY if it is wrong — a broken gate looks exactly like a working
 * one until you read the row count a week later.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  sameValue, shouldWrite, noteDecision, drainSnapshotWriteStats,
  formatSnapshotWriteStats, SNAPSHOT_HEARTBEAT_MS, SNAPSHOT_EPSILON,
} from "./writeOnChange.js";

// ── 1. Epsilon, not equality ───────────────────────────────────────────────
test("float noise does not count as a change", () => {
  // The failure this prevents: `0.1 + 0.2 !== 0.3`. With exact equality the gate
  // passes everything through and suppresses nothing, while appearing to work.
  assert.equal(sameValue(0.1 + 0.2, 0.3), true, "recomputation noise must not be a change");
  assert.equal(sameValue(0.5, 0.5 + 1e-12), true);
});

test("a real change is still a change", () => {
  assert.equal(sameValue(0.5, 0.51), false);
  assert.equal(sameValue(0.5, 0.5 + SNAPSHOT_EPSILON * 10), false);
});

test("NULL is not zero", () => {
  // "no market bound yet" and "the market says 0.0" are different facts, and
  // collapsing them would hide the moment a component starts reporting.
  assert.equal(sameValue(null, 0), false);
  assert.equal(sameValue(null, null), true);
  assert.equal(sameValue(undefined, null), true, "absent and null are the same absence");
  assert.equal(sameValue(0, 0), true);
});

// ── 2. The heartbeat ───────────────────────────────────────────────────────
test("an unchanged value inside the heartbeat window is suppressed", () => {
  const prev = { ts: 1_000_000, reality_score: 0.42 };
  const d = shouldWrite(prev, { reality_score: 0.42 }, 1_000_000 + 60_000);
  assert.equal(d.write, false);
  assert.equal(d.reason, "unchanged");
});

test("an unchanged value writes anyway once the heartbeat elapses", () => {
  // WHY THIS MATTERS MORE THAN THE BYTES: without it, "flat for six weeks" and
  // "the scorer died six weeks ago" produce the same empty range, and nothing
  // downstream can tell them apart afterwards.
  const prev = { ts: 1_000_000, reality_score: 0.42 };
  const d = shouldWrite(prev, { reality_score: 0.42 }, 1_000_000 + SNAPSHOT_HEARTBEAT_MS);
  assert.equal(d.write, true);
  assert.equal(d.reason, "heartbeat");
});

test("the first row for a key is always written", () => {
  const d = shouldWrite(null, { reality_score: 0.42 }, 1_000_000);
  assert.equal(d.write, true);
  assert.equal(d.reason, "first");
});

test("a changed field is named, so the log says WHICH moved", () => {
  const prev = { ts: 1_000_000, reality_score: 0.42, truth_gap: 0.1 };
  const d = shouldWrite(prev, { reality_score: 0.42, truth_gap: 0.9 }, 1_000_100);
  assert.equal(d.write, true);
  assert.equal(d.reason, "changed");
  assert.equal(d.field, "truth_gap");
});

test("volume is an integer count and a change of one is a change", () => {
  // Sentiment measured 100% identical INCLUDING volume, but a mention count
  // going 4 -> 5 is real signal and must not be rounded away by the epsilon.
  const prev = { ts: 1_000_000, polarity: 0.2, intensity: 0.5, volume: 4 };
  const d = shouldWrite(prev, { polarity: 0.2, intensity: 0.5, volume: 5 }, 1_000_100);
  assert.equal(d.write, true);
  assert.equal(d.field, "volume");
});

// ── 3. The accounting ──────────────────────────────────────────────────────
test("stats count written vs skipped and report the suppression ratio", () => {
  drainSnapshotWriteStats();                        // start clean
  for (let i = 0; i < 999; i++) noteDecision("t", "unchanged");
  noteDecision("t", "changed");
  const [row] = drainSnapshotWriteStats();
  assert.equal(row.written, 1);
  assert.equal(row.skipped, 999);
  assert.equal(row.suppression, 999, "the ratio DrJ reads on day one");
  assert.equal(row.suppressedPct, 99.9);
});

test("draining resets, so two cycles never share a total", () => {
  drainSnapshotWriteStats();
  noteDecision("t", "changed");
  assert.equal(drainSnapshotWriteStats()[0].written, 1);
  assert.deepEqual(drainSnapshotWriteStats(), [], "a second drain must be empty");
});

test("the log line separates changed from heartbeat from new", () => {
  // A run that is all heartbeat and no change is a DIFFERENT state from a run
  // that is genuinely tracking movement, and the line has to show which.
  drainSnapshotWriteStats();
  noteDecision("reality_index_snapshots", "changed");
  noteDecision("reality_index_snapshots", "heartbeat");
  noteDecision("reality_index_snapshots", "first");
  noteDecision("reality_index_snapshots", "unchanged");
  const [line] = formatSnapshotWriteStats();
  assert.match(line, /wrote 3 \(1 changed, 1 heartbeat, 1 new\)/);
  assert.match(line, /skipped 1 unchanged/);
});
