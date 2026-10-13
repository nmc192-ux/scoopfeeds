import test from "node:test";
import assert from "node:assert/strict";
import { logoProblems, validLogo, isFootage } from "./logo.mjs";

const clip = (extra = {}) => ({ kind: "clip", t0: 1, T: 3, path: "/m/M1.mp4", cams: [[1, 0.5, 0.5, 1]], ...extra });
const lay = (e) => ({ shots: [{ t0: 1, T: 3, path: "/m/M1.mp4", ...e }] });

test("only shots with a path and cams are footage", () => {
  assert.equal(isFootage(clip()), true);
  assert.equal(isFootage({ kind: "punch", t0: 0, T: 2 }), false);
  assert.equal(isFootage({ kind: "photo", path: "/m/x.jpg", t0: 0, T: 2 }), false);
});

test("logo values: corner codes, normalised boxes and none are valid; anything else is not", () => {
  for (const v of ["br", "TL", "none", null, [0.86, 0.86, 0.95, 0.96]]) assert.equal(validLogo(v), true, JSON.stringify(v));
  for (const v of ["middle", [1, 2, 3], [0.5, 0.5, 0.4, 0.9], [-0.1, 0, 0.5, 0.5], [0, 0, 1.2, 1], "", 5, undefined, ["a", "b", "c", "d"]]) assert.equal(validLogo(v), false, JSON.stringify(v));
});

test("a footage shot that does not say where the logo is fails", () => {
  const p = logoProblems({ shots: [clip()] }, null);
  assert.equal(p.length, 1); assert.match(p[0], /does not say where the source logo is/);
});

test("an invalid logo value fails", () => {
  assert.match(logoProblems({ shots: [clip({ logo: "middle" })] }, null)[0], /not tl\|tr\|bl\|br/);
});

test('"none" passes without a layout record', () => {
  assert.deepEqual(logoProblems({ shots: [clip({ logo: "none" })] }, null), []);
});

test("a declared logo needs layout.json from the renderer", () => {
  assert.match(logoProblems({ shots: [clip({ logo: "br" })] }, null)[0], /layout\.json is missing/);
  assert.match(logoProblems({ shots: [clip({ logo: "br" })] }, { shots: [] })[0], /no layout record/);
});

test("band, and a crop that contains the logo, pass", () => {
  assert.deepEqual(logoProblems({ shots: [clip({ logo: "br" })] }, lay({ layout: "band", logo_in_crop: false })), []);
  assert.deepEqual(logoProblems({ shots: [clip({ logo: [0.4, 0.4, 0.6, 0.6] })] }, lay({ layout: "crop", logo_in_crop: true })), []);
});

test("a crop that does not contain the logo fails (the 2 Oct DVIDS case)", () => {
  const p = logoProblems({ shots: [clip({ logo: [0.86, 0.86, 0.95, 0.96] })] }, lay({ layout: "crop", logo_in_crop: false }));
  assert.match(p[0], /did not keep the logo/);
});

test("per-film code with its own frame() cannot be verified, so it fails", () => {
  assert.match(logoProblems({ shots: [clip({ kind: "x-clipov", logo: "br" })] }, lay({ layout: "custom", logo_in_crop: null }))[0], /cannot be verified/);
});

test("non-footage shots are ignored", () => {
  assert.deepEqual(logoProblems({ shots: [{ kind: "count", t0: 0, T: 2 }, { kind: "end", t0: 58, T: 2 }] }, null), []);
});
