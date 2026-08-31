// decaySplit.test.mjs — the two cards added for the xylitol film.
//
// Run:  node --test backend/src/services/longform/engine/decaySplit.test.mjs
//
// THE LOAD-BEARING TEST IS THE PAYOFF-SEAM ONE. build.mjs renders the entrance
// over p∈[0,0.35], HOLDS that last frame, then plays the payoff span — so any
// timing window that straddles 0.35 freezes mid-motion and then jumps. The
// equation card carries the scar; this pins the rule for the new cards by
// requiring p=0.34 and p=0.35 to be PIXEL-IDENTICAL. It earned its place
// immediately: split's right panel entered 0.20→0.38 and its figure 0.22→0.40,
// and this test is what caught both.
//
// Deliberately no recorded sha256 fixtures. Those pin a card against
// unintended drift, which is worth it for cards other films already shipped;
// these two have no shipped film behind them yet, and a fixture recorded on
// day one only asserts that today's output equals today's output.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { renderCard, HAS_PAYOFF, PAYOFF_P } from "./render.mjs";

const TMP = mkdtempSync(path.join(os.tmpdir(), "decaysplit-"));
const render = async (spec, name, p) => {
  const f = path.join(TMP, `${name}.png`);
  await renderCard(spec, f, p);
  return createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 16);
};

const DECAY = {
  card: "decay",
  kicker: "PLASMA XYLITOL AFTER A 30 g DRINK",
  title: "It is gone long before the blood is drawn.",
  peak: 1000, baseline: 1, halfLife: 13, xMax: 360,
  yAxis: [{ at: 1000, label: "1,000×" }, { at: 500, label: "500×" }, { at: 1, label: "BASELINE" }],
  xAxis: [{ at: 0, label: "DRINK" }, { at: 240, label: "4 HRS" }, { at: 360, label: "6 HRS" }],
  marks: [{ at: 13, label: "Half-life ≈ 13 min" }],
  beyond: { label: "BLOOD SAMPLE TAKEN — 12 HRS" },
  note: "The cohorts sampled after an overnight fast.",
  src: "EUR HEART J 2024;45:2439–2452",
};

const SPLIT = {
  card: "split",
  kicker: "THE NUMBER THAT ISN'T THERE",
  title: "Fifty-seven per cent more than what?",
  left: { label: "Relative risk increase — top vs bottom quartile", figure: "+57%" },
  right: { label: "Events per 1,000 people", stamp: "NOT PUBLISHED" },
  note: "Without the underlying event rate, nobody can convert this into your risk.",
  src: "ESC CONGRESS 2026",
};

test("both cards declare a payoff, so build.mjs renders their second phase", () => {
  // A HAS_PAYOFF card that holds nothing back renders a redundant phase; a card
  // that holds something back WITHOUT declaring one never shows it at all.
  for (const t of ["decay", "split"]) {
    assert.ok(HAS_PAYOFF.has(t), `${t} must be in HAS_PAYOFF — its payoff would never play`);
  }
});

test("nothing straddles the payoff seam: p=0.34 and p=0.35 are identical", async () => {
  for (const [name, spec] of [["decay", DECAY], ["split", SPLIT]]) {
    const before = await render(spec, `${name}-seam-before`, PAYOFF_P - 0.01);
    const after = await render(spec, `${name}-seam-after`, PAYOFF_P);
    assert.equal(before, after,
      `${name}: an animation is still running across the entrance/payoff cut — it will freeze mid-motion and jump`);
  }
});

test("the payoff actually lands after the seam, and the card is not finished at it", async () => {
  for (const [name, spec] of [["decay", DECAY], ["split", SPLIT]]) {
    const atSeam = await render(spec, `${name}-seam`, PAYOFF_P);
    const atEnd = await render(spec, `${name}-end`, 1.0);
    assert.notEqual(atSeam, atEnd,
      `${name}: the frame at the seam already equals the final frame — the payoff shows nothing`);
  }
});

test("rendering is deterministic — the same spec and p give the same pixels", async () => {
  for (const [name, spec] of [["decay", DECAY], ["split", SPLIT]]) {
    const a = await render(spec, `${name}-det-a`, 1.0);
    const b = await render(spec, `${name}-det-b`, 1.0);
    assert.equal(a, b, `${name} must render deterministically`);
  }
});

test("decay: the curve is computed from halfLife, so changing it changes the picture", async () => {
  // The whole reason the curve is not authored as points: the drawn line must
  // be the half-life the card prints beside it, and cannot drift from it.
  const fast = await render({ ...DECAY, halfLife: 13 }, "hl-13", 1.0);
  const slow = await render({ ...DECAY, halfLife: 120 }, "hl-120", 1.0);
  assert.notEqual(fast, slow, "a different half-life must draw a different curve");
});

test("decay: `beyond` is optional and its absence reclaims the right margin", async () => {
  const { beyond, ...noBeyond } = DECAY;
  const withArrow = await render(DECAY, "beyond-yes", 1.0);
  const without = await render(noBeyond, "beyond-no", 1.0);
  assert.notEqual(withArrow, without, "dropping `beyond` must widen the plot, not just hide the arrow");
});

test("split: the stamped panel is what changes across the payoff", async () => {
  // Swapping the stamp text must move the frame at p=1 but not at the seam,
  // which is what "the stamp is the payoff" means in pixels.
  const other = { ...SPLIT, right: { ...SPLIT.right, stamp: "NOT REPORTED" } };
  assert.equal(await render(SPLIT, "stamp-seam-a", PAYOFF_P),
               await render(other, "stamp-seam-b", PAYOFF_P),
               "before the seam the stamp must not be on screen yet");
  assert.notEqual(await render(SPLIT, "stamp-end-a", 1.0),
                  await render(other, "stamp-end-b", 1.0),
                  "by p=1 the stamp must have landed");
});

// ── ledger `muted` ──────────────────────────────────────────────────────────

const LEDGER = {
  card: "ledger", kicker: "WHAT THE PANEL DOES NOT TELL YOU",
  title: "Sugar alcohols are not required to be listed individually.",
  rows: [{ who: "Xylitol", what: "" }, { who: "Erythritol", what: "" },
         { who: "Sorbitol", what: "" }, { who: "Maltitol", what: "" }],
  src: "NIH",
};

test("ledger: `muted` is opt-in — without it a hot-less ledger is unchanged", async () => {
  // The additive proof. Every shipped ledger passes no `muted`, so every
  // shipped ledger must render exactly as it did before the flag existed.
  const plain = await render(LEDGER, "ledger-plain", 1.0);
  const alsoPlain = await render({ ...LEDGER, muted: false }, "ledger-false", 1.0);
  assert.equal(plain, alsoPlain, "muted:false must be identical to omitting it");
  assert.notEqual(plain, await render({ ...LEDGER, muted: true }, "ledger-muted", 1.0),
    "muted:true must actually change the frame");
});

test("ledger: `muted` recedes rows that a hot row would otherwise light", async () => {
  // A hot-less ledger lights every row white, which is right for a list and
  // backwards for one the viewer is being told they cannot see.
  const hot = { ...LEDGER, rows: LEDGER.rows.map((r, i) => (i === 0 ? { ...r, hot: true } : r)) };
  const muted = await render({ ...LEDGER, muted: true }, "ledger-muted-2", 1.0);
  assert.notEqual(muted, await render(hot, "ledger-hot", 1.0),
    "muted and hot are different pictures");
});
