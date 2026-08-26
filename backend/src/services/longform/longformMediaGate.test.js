/**
 * longformMediaGate.test.js — what may enter a film (#78).
 *
 * THE END-TO-END PROPERTY IS THE POINT: acquisition writes LICENSES.md, the
 * publish plan DERIVES its disclosure from that file, and #79's gate then
 * verifies the four surfaces agree. This suite closes that loop, so an AI clip
 * slipping through acquisition cannot end up under a disclosure saying there
 * is none — the failure that produced a false declaration on a shipped film.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  screenCandidate, screenAcquisition, renderLicenses, planAcquisition,
  ALLOWED_LICENCES, MIN_WIDTH,
} from "./longformMediaGate.js";
import { buildPublishPlan, buildTikTokPlan } from "./longformPublishPlan.js";
import { disclosureFailures } from "./longformQcGate.js";

const real = (over = {}) => ({
  key: "F_SEA", licence: "pexels",
  url: "https://videos.pexels.com/video-files/12345/12345-hd.mp4",
  width: 1920, height: 1080, ...over,
});

// ── The sourcing rules, each failing a violating asset ──────────────────────

test("a compliant contributor-shot clip passes", () => {
  assert.deepEqual(screenCandidate(real()), []);
});

test("AI STOCK IS REFUSED — it would silently falsify the disclosure", () => {
  const errs = screenCandidate(real({
    url: "https://content.pexels.com/aigc-bundle/999/clip.mp4" }));
  assert.match(errs.join("\n"), /aigc-bundle/);
  assert.match(errs.join("\n"), /silently falsify the film's disclosure/);
});

test("a pexels licence on a non-pexels-video url is refused as unclear", () => {
  assert.match(screenCandidate(real({ url: "https://example.com/clip.mp4" })).join("\n"),
    /provenance unclear/);
});

test("upscales and unmeasured resolutions are both refused", () => {
  assert.match(screenCandidate(real({ width: 1280, height: 720 })).join("\n"),
    /below 1920×1080 — upscales show next to native material/);
  // Unmeasured is a REFUSAL, not a pass — the unmeasured clip is exactly the
  // one that turns out to be an upscale.
  assert.match(screenCandidate(real({ width: undefined, height: undefined })).join("\n"),
    /resolution not measured — unmeasured is not a pass/);
});

test("rights-managed licences are structurally absent", () => {
  for (const bad of ["getty", "ap", "rights-managed", "editorial-licensed"]) {
    assert.match(screenCandidate(real({ licence: bad })).join("\n"),
      new RegExp(`licence "${bad}" is not usable`),
      `${bad} must be unregisterable — it is the class channels get struck over`);
  }
  assert.ok(!ALLOWED_LICENCES.includes("getty"));
});

test("CC licences require attribution", () => {
  assert.match(screenCandidate(real({ licence: "cc-by", url: "https://commons.wikimedia.org/x", attribution: null })).join("\n"),
    /requires attribution and none was recorded/);
  assert.deepEqual(
    screenCandidate(real({ licence: "cc-by", url: "https://commons.wikimedia.org/x", attribution: "A. Photographer" })), []);
});

test("NO SYNTHETIC HUMANS — generated environments are fine, people are not", () => {
  assert.deepEqual(screenCandidate(real({ synthetic: true, licence: "public-domain",
    url: "generated://scene", containsPeople: false })), []);
  assert.match(screenCandidate(real({ synthetic: true, licence: "public-domain",
    url: "generated://scene", containsPeople: true })).join("\n"),
    /synthetic humans are not/);
});

test("duplicate keys are refused — one clip would silently replace the other", () => {
  const { ok, problems } = screenAcquisition([real(), real()]);
  assert.equal(ok, false);
  assert.match(problems.join("\n"), /duplicate key "F_SEA"/);
});

test("a partially-bad set is refused whole, not acquired partially", () => {
  const r = planAcquisition({ title: "T", candidates: [real(), real({ key: "F_BAD", width: 640, height: 360 })] });
  assert.equal(r.ok, false);
  assert.equal(r.assets.length, 0, "nothing is acquired from a set that cannot all be trusted");
  assert.equal(r.licenses, null);
});

// ── LICENSES.md is emitted from the assets themselves ───────────────────────

test("the AIGC stamp appears only when a synthetic asset is present", () => {
  const clean = renderLicenses({ title: "T", assets: [real()] });
  assert.match(clean, /\*\*None\.\*\* No generated imagery is used/);
  assert.doesNotMatch(clean, /\*\*AI-generated content present in this project\.\*\*/);

  const withAi = renderLicenses({ title: "T", assets: [real(),
    { key: "G_SCALES", licence: "public-domain", url: "generated://x", width: 1920, height: 1080,
      synthetic: true, register: "object", note: "unequal scales" }] });
  assert.match(withAi, /\*\*AI-generated content present in this project\.\*\*/);
  assert.match(withAi, /G_SCALES/);
  assert.match(withAi, /No synthetic humans/);
});

test("every accepted asset appears in the record with its provenance", () => {
  const md = renderLicenses({ title: "T", acquiredOn: Date.UTC(2026, 7, 26),
    assets: [real({ key: "F_A" }), real({ key: "F_B", licence: "cc-by", attribution: "A. Photographer",
                                          url: "https://commons.wikimedia.org/b" })] });
  assert.match(md, /`F_A`/); assert.match(md, /`F_B`/);
  assert.match(md, /A\. Photographer/);
  assert.match(md, /1920×1080/);
  assert.match(md, /2026-08-26/);
});

// ── THE LOOP: acquisition → LICENSES.md → disclosure → gate ─────────────────

test("END TO END: what acquisition accepts determines the disclosure, and the gate agrees", () => {
  const shorts = [1, 2, 3].map((i) => ({ file: `0${i}.mp4`, title: `S${i}`, hook: `H${i}` }));

  for (const [label, candidates, expectAi] of [
    ["real footage only", [real({ key: "F_A" }), real({ key: "F_B" })], false],
    ["with a generated scene", [real({ key: "F_A" }),
      { key: "G_SCALES", licence: "public-domain", url: "generated://x", width: 1920, height: 1080,
        synthetic: true, register: "object", note: "unequal scales" }], true],
  ]) {
    const acq = planAcquisition({ title: "T", candidates });
    assert.equal(acq.ok, true, `${label}: should acquire`);

    const plan = buildPublishPlan({
      slug: "t", title: "T", description: "D", shorts,
      licensesText: acq.licenses,
      generatedScenes: acq.assets.filter((a) => a.synthetic).map((a) => a.key),
      startFrom: Date.UTC(2026, 7, 26, 9, 0, 0),
    });
    const tiktok = buildTikTokPlan({ licensesText: acq.licenses, shorts,
      generatedScenes: acq.assets.filter((a) => a.synthetic).map((a) => a.key) });

    assert.equal(Boolean(plan.syntheticContent), expectAi, `${label}: disclosure must match what was acquired`);
    assert.equal(tiktok.isAigc, expectAi);
    assert.deepEqual(
      disclosureFailures({ licensesText: acq.licenses, publishJson: plan, tiktokJson: tiktok }), [],
      `${label}: the whole chain must be self-consistent`);
  }
});

test("an AI clip that slipped past acquisition could never reach a 'no AI' disclosure", () => {
  // The failure mode this whole chain exists to prevent, asserted directly:
  // the gate refuses the acquisition, so no LICENSES.md is produced and no
  // plan can be built from one.
  const r = planAcquisition({ title: "T", candidates: [
    real({ key: "F_FAKE", url: "https://content.pexels.com/aigc-bundle/1/x.mp4" })] });
  assert.equal(r.ok, false);
  assert.equal(r.licenses, null, "no provenance file means no plan can claim anything about provenance");
});
