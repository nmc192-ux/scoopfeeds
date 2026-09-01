// The licence gate's off switch — and, more importantly, what it CANNOT turn
// off. Run: node --test backend/src/services/longform/longformLicenceSwitch.test.js
//
// The switch exists so a research cut can carry real footage before rights are
// settled. The danger it introduces is that someone reaches for it expecting a
// rights bypass and gets a DISCLOSURE bypass as well — an AI clip entering a
// film whose published statement says there is none. These tests pin the line
// between the two.

import test from "node:test";
import assert from "node:assert/strict";
import {
  screenCandidate, licenceGateEnabled, licenceNotes, renderLicenses,
} from "./longformMediaGate.js";

const OK = {
  key: "F_TEST", url: "https://videos.pexels.com/video-files/123/x.mp4",
  licence: "pexels", width: 1920, height: 1080,
};
const withEnv = (v, fn) => {
  const had = Object.prototype.hasOwnProperty.call(process.env, "LONGFORM_LICENCE_GATE");
  const old = process.env.LONGFORM_LICENCE_GATE;
  if (v === undefined) delete process.env.LONGFORM_LICENCE_GATE;
  else process.env.LONGFORM_LICENCE_GATE = v;
  try { return fn(); } finally {
    if (had) process.env.LONGFORM_LICENCE_GATE = old;
    else delete process.env.LONGFORM_LICENCE_GATE;
  }
};

test("the gate is ON unless explicitly switched off", () => {
  assert.equal(withEnv(undefined, licenceGateEnabled), true, "absent must mean on");
  assert.equal(withEnv("", licenceGateEnabled), true, "empty must mean on");
  assert.equal(withEnv("on", licenceGateEnabled), true);
  assert.equal(withEnv("1", licenceGateEnabled), true, "only the word 'off' disables it");
  assert.equal(withEnv("off", licenceGateEnabled), false);
  assert.equal(withEnv("OFF", licenceGateEnabled), false, "case must not decide a rights question");
});

test("with the gate on, an unknown licence is refused", () => {
  const errs = screenCandidate({ ...OK, licence: "some-rights-reserved" }, { licenceGate: true });
  assert.ok(errs.some((e) => /is not usable/.test(e)), errs.join("; "));
});

test("with the gate off, an unknown or missing licence lands", () => {
  assert.deepEqual(screenCandidate({ ...OK, licence: "some-rights-reserved" }, { licenceGate: false }), []);
  assert.deepEqual(screenCandidate({ ...OK, licence: undefined }, { licenceGate: false }), []);
  const noAttrib = { ...OK, licence: "cc-by", attribution: undefined };
  assert.deepEqual(screenCandidate(noAttrib, { licenceGate: false }), [],
    "a missing attribution is a licence condition, so it relaxes with the rest");
});

// ── The line the switch must never cross ────────────────────────────────────

test("AI-generated stock is refused even with the gate off", () => {
  const ai = { ...OK, url: "https://content.pexels.com/aigc-bundle/999/x.mp4" };
  const errs = screenCandidate(ai, { licenceGate: false });
  assert.ok(errs.some((e) => /AI-generated stock/.test(e)),
    "the licence switch must not admit AI stock — that would make the film's own "
    + `disclosure false. Got: ${JSON.stringify(errs)}`);
});

test("synthetic humans are refused even with the gate off", () => {
  const errs = screenCandidate({ ...OK, synthetic: true, containsPeople: true }, { licenceGate: false });
  assert.ok(errs.some((e) => /synthetic imagery containing people/.test(e)), errs.join("; "));
});

test("resolution and identity rules are refused even with the gate off", () => {
  const small = screenCandidate({ ...OK, width: 640, height: 360 }, { licenceGate: false });
  assert.ok(small.some((e) => /below 1920×1080/.test(e)), "an upscale is a quality fact, not a rights one");
  const unmeasured = screenCandidate({ ...OK, width: undefined, height: undefined }, { licenceGate: false });
  assert.ok(unmeasured.some((e) => /not measured/.test(e)), "unmeasured is still not a pass");
  const nokey = screenCandidate({ ...OK, key: undefined }, { licenceGate: false });
  assert.ok(nokey.some((e) => /no key/.test(e)));
  const nourl = screenCandidate({ ...OK, url: "" }, { licenceGate: false });
  assert.ok(nourl.some((e) => /no url/.test(e)));
});

test("the bypass suppresses ONLY licence rules, counted exactly", () => {
  // One candidate that trips a licence rule AND a resolution rule. With the
  // gate off exactly the licence one should disappear — not both, not neither.
  const bad = { ...OK, licence: "rights-managed", width: 640, height: 360 };
  const on = screenCandidate(bad, { licenceGate: true });
  const off = screenCandidate(bad, { licenceGate: false });
  assert.equal(on.length, 2, `expected a licence error and a resolution error, got ${JSON.stringify(on)}`);
  assert.equal(off.length, 1, `expected only the resolution error to survive, got ${JSON.stringify(off)}`);
  assert.match(off[0], /below 1920×1080/);
});

test("licenceNotes reports what the bypass suppressed", () => {
  const notes = licenceNotes({ ...OK, licence: "rights-managed" });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /is not usable/);
  assert.deepEqual(licenceNotes(OK), [], "a clean candidate has nothing to note");
});

// ── The record ──────────────────────────────────────────────────────────────

test("a bypassed licence is stated in LICENSES.md, not silently omitted", () => {
  const md = renderLicenses({
    title: "T",
    assets: [{ ...OK, licence: "rights-managed", licenceUnverified: true,
               licenceNotes: ['licence "rights-managed" is not usable'] }],
  });
  assert.match(md, /## Licence NOT verified/);
  assert.match(md, /not cleared for publication/);
  assert.match(md, /rights-managed/);
  assert.match(md, /F_TEST/);
});

test("with nothing bypassed the record gains no such section", () => {
  const md = renderLicenses({ title: "T", assets: [OK] });
  assert.doesNotMatch(md, /Licence NOT verified/,
    "a clean film must not carry a warning that invites being ignored");
});
