/**
 * longformQcGate.test.js — the gate that stands in for a human (#79).
 *
 * Every gate has a test that FAILS a film violating it. A gate with only a
 * passing test is not tested — it would go on passing after being deleted.
 *
 * The disclosure block is the highest-consequence part of the programme: with
 * no human ack before the publishAt slot, it is the only thing between a false
 * AI-provenance statement and the subscribers, and a published film cannot be
 * quietly corrected.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  qcVerdict, disclosureFailures, formatVerdict, rejectionsToPrune,
  publishIfPassed, AIGC_STAMP, GATES,
} from "./longformQcGate.js";

/** A film that passes everything; `over` breaks one gate at a time. */
const ok = (over = {}) => ({
  loudness: { measured: true, value: -14.2 },
  sideChannel: { measured: true, value: -38 },
  flatFactor: { measured: true, value: 0 },
  medianShot: { measured: true, value: 5.1 },
  shortsUnder2s: { measured: true, value: 0.12 },
  filmSeconds: { measured: true, value: 8.5 * 60 },
  srt: { measured: true, value: { cues: 73, lastCueSecs: 500 } },
  shorts: [1, 2, 3, 4, 5].map((i) => ({
    measured: true, name: `s${i}`, seconds: 55, width: 1080, height: 1920 })),
  disclosure: [],
  ...over,
});

const gatesOf = (v) => v.failures.map((f) => f.gate).join(" | ");

test("a compliant film passes and every gate is recorded as checked", () => {
  const v = qcVerdict(ok());
  assert.equal(v.pass, true, gatesOf(v));
  assert.ok(v.checked.length >= 8, "the verdict must record what it measured");
});

// ── UNMEASURED IS A FAILURE ─────────────────────────────────────────────────

test("EVERY gate fails when its measurement is absent — unmeasured is never a pass", () => {
  // The tempting bug is treating a missing measurement as "nothing found
  // wrong". Each of these must produce a FAILURE, not silence.
  for (const field of ["loudness", "sideChannel", "flatFactor", "medianShot",
                       "shortsUnder2s", "filmSeconds", "srt"]) {
    const v = qcVerdict(ok({ [field]: { measured: false, why: "ffmpeg gave no output" } }));
    assert.equal(v.pass, false, `${field}: an unmeasured gate must fail`);
    assert.ok(v.failures.some((f) => f.measured === "UNVERIFIED"),
      `${field}: must be reported UNVERIFIED, not omitted`);
  }
  // And the same for shorts as a group.
  const v = qcVerdict(ok({ shorts: [] }));
  assert.equal(v.pass, false);
  assert.match(gatesOf(v), /shorts/);
});

test("a measurement of undefined is a failure, not a skipped gate", () => {
  const v = qcVerdict(ok({ loudness: undefined }));
  assert.equal(v.pass, false);
  assert.match(gatesOf(v), /integrated loudness/);
});

// ── Each measured gate fails a violating film ───────────────────────────────

test("loudness outside the tolerance fails", () => {
  assert.equal(qcVerdict(ok({ loudness: { measured: true, value: -9 } })).pass, false);
  assert.equal(qcVerdict(ok({ loudness: { measured: true, value: -14 - GATES.loudnessTolerance - 0.1 } })).pass, false);
  assert.equal(qcVerdict(ok({ loudness: { measured: true, value: -15.4 } })).pass, true, "inside tolerance passes");
});

test("any clipping fails", () => {
  assert.equal(qcVerdict(ok({ flatFactor: { measured: true, value: 0.2 } })).pass, false);
});

test("a mono bed fails the stereo gate", () => {
  // A mono bed measures about -91 dB on the side channel; that difference
  // alone reads as "small production" on headphones.
  const v = qcVerdict(ok({ sideChannel: { measured: true, value: -91 } }));
  assert.equal(v.pass, false);
  assert.match(gatesOf(v), /stereo side channel/);
});

test("a slideshow-paced film fails the rhythm gates", () => {
  assert.equal(qcVerdict(ok({ medianShot: { measured: true, value: 7.7 } })).pass, false);
  assert.equal(qcVerdict(ok({ shortsUnder2s: { measured: true, value: 0.0 } })).pass, false);
});

test("a film outside the 7-10 minute band fails at both ends", () => {
  assert.equal(qcVerdict(ok({ filmSeconds: { measured: true, value: 4 * 60 } })).pass, false);
  assert.equal(qcVerdict(ok({ filmSeconds: { measured: true, value: 14 * 60 } })).pass, false);
});

test("a missing or empty SRT fails — the SRT is the timeline", () => {
  const v = qcVerdict(ok({ srt: { measured: true, value: { cues: 0, lastCueSecs: 0 } } }));
  assert.equal(v.pass, false);
  assert.match(gatesOf(v), /SRT/);
});

test("too few Shorts fails, and each Short's duration and shape are checked", () => {
  assert.match(gatesOf(qcVerdict(ok({ shorts: ok().shorts.slice(0, 2) }))), /shorts count/);
  // One second over the platform ceiling is an edge this format reaches — Meta
  // rejects it at publish time, after the container already exists.
  const overLong = ok().shorts.map((s, i) => (i === 0 ? { ...s, seconds: 60 } : s));
  assert.match(gatesOf(qcVerdict(ok({ shorts: overLong }))), /short s1 duration/);
  const wrongShape = ok().shorts.map((s, i) => (i === 1 ? { ...s, width: 1920, height: 1080 } : s));
  assert.match(gatesOf(qcVerdict(ok({ shorts: wrongShape }))), /short s2 shape/);
});

// ── THE DISCLOSURE CHAIN, BOTH DIRECTIONS ───────────────────────────────────

const withAigc = `# Licences\n\n${AIGC_STAMP}\n\n- clip A\n`;
const noAigc = "# Licences\n\n- Pexels clip A\n- Pexels clip B\n";

test("consistent disclosures pass in both states", () => {
  assert.deepEqual(disclosureFailures({
    licensesText: withAigc,
    publishJson: { syntheticContent: "5 generated environment stills", youtube: { description: "A film." } },
    tiktokJson: { isAigc: true },
  }), []);
  assert.deepEqual(disclosureFailures({
    licensesText: noAigc,
    publishJson: { youtube: { description: "No AI-generated imagery was used." } },
    tiktokJson: { isAigc: false },
  }), []);
});

test("AI present + description claiming none = refused", () => {
  const f = disclosureFailures({
    licensesText: withAigc,
    publishJson: { syntheticContent: "x", youtube: { description: "No AI-generated imagery." } },
  });
  assert.match(f.join("\n"), /a false public statement/);
});

test("AI present + no syntheticContent declaration = refused", () => {
  const f = disclosureFailures({ licensesText: withAigc, publishJson: { youtube: { description: "A film." } } });
  assert.match(f.join("\n"), /'Altered content' disclosure would be skipped/);
});

test("AI present + tiktok isAigc not true = refused", () => {
  const f = disclosureFailures({
    licensesText: withAigc,
    publishJson: { syntheticContent: "x", youtube: { description: "A film." } },
    tiktokJson: { isAigc: false },
  });
  assert.match(f.join("\n"), /tiktok.json isAigc is not true/);
});

test("THE CONVERSE: declaring synthetic content on a film that has none = refused", () => {
  // The half the shipped publish-time gate never checked. Declaring synthetic
  // media that is not present tells YouTube and the audience something untrue;
  // "erring toward disclosure" is not a defence for an inaccurate one.
  const f = disclosureFailures({
    licensesText: noAigc,
    publishJson: { syntheticContent: "5 generated stills", youtube: { description: "A film." } },
  });
  assert.match(f.join("\n"), /declaring synthetic media that is not present is also a false statement/);
  const t = disclosureFailures({ licensesText: noAigc, publishJson: {}, tiktokJson: { isAigc: true } });
  assert.match(t.join("\n"), /isAigc is true but LICENSES.md records no AI-generated content/);
});

test("a missing LICENSES.md fails — unverifiable provenance is not a pass", () => {
  const f = disclosureFailures({ licensesText: null, publishJson: {} });
  assert.match(f.join("\n"), /provenance cannot be verified/);
});

test("the stamp match is EXACT — a provenance note mentioning AI is not a declaration", () => {
  // Keyed on the exact phrase, not /AI-generated/i: notes legitimately contain
  // those words while EXCLUDING AI content (the Ebola project's does). A
  // looser match would refuse correct films.
  const mentionsButExcludes = "# Licences\n\nNo AI-generated imagery is used in this film.\n";
  assert.deepEqual(
    disclosureFailures({ licensesText: mentionsButExcludes,
      publishJson: { youtube: { description: "No AI-generated imagery." } } }),
    [], "a film that says it has no AI, and has none, must pass");
});

test("a disclosure inconsistency alone fails the whole verdict", () => {
  const v = qcVerdict(ok({ disclosure: ["disclosure: something inconsistent"] }));
  assert.equal(v.pass, false, "every other gate passing cannot rescue a bad disclosure");
  assert.match(gatesOf(v), /disclosure/);
});

// ── Reporting and retention ─────────────────────────────────────────────────

test("the verdict log names gate, measured value and threshold", () => {
  const line = formatVerdict("hormuz", qcVerdict(ok({ loudness: { measured: true, value: -9 } })));
  assert.match(line, /🧭 qc-reject hormuz/);
  assert.match(line, /integrated loudness: -9 \(target -14 ±1.5 LUFS\)/);
  assert.match(formatVerdict("hormuz", qcVerdict(ok())), /🧭 qc-pass hormuz/);
});

test("rejected artifacts are retained but BOUNDED — newest kept, rest pruned", () => {
  const entries = [1, 2, 3, 4, 5].map((i) => ({ dir: `d${i}`, at: i }));
  assert.deepEqual(rejectionsToPrune(entries, { keep: 3 }), ["d2", "d1"],
    "the two oldest are pruned, the three newest retained");
  assert.deepEqual(rejectionsToPrune(entries, { keep: 0 }), ["d5", "d4", "d3", "d2", "d1"]);
  assert.deepEqual(rejectionsToPrune([], { keep: 3 }), []);
});

// ── The one-way door ────────────────────────────────────────────────────────

test("A REJECTED FILM MAKES ZERO CALLS TO ANY PUBLISHING SURFACE", async () => {
  // The safety property this whole issue exists for.
  let publishCalls = 0;
  const r = await publishIfPassed({
    slug: "hormuz",
    verdict: qcVerdict(ok({ loudness: { measured: true, value: -9 } })),
    publish: async () => { publishCalls++; },
  });
  assert.equal(r.published, false);
  assert.equal(publishCalls, 0, "a failed gate must not reach a publisher at all");
});

test("a disclosure failure alone blocks publishing", async () => {
  let publishCalls = 0;
  await publishIfPassed({
    verdict: qcVerdict(ok({ disclosure: ["disclosure: inconsistent"] })),
    publish: async () => { publishCalls++; },
  });
  assert.equal(publishCalls, 0);
});

test("a passing film publishes exactly once", async () => {
  let publishCalls = 0;
  const r = await publishIfPassed({ verdict: qcVerdict(ok()), publish: async () => { publishCalls++; } });
  assert.equal(r.published, true);
  assert.equal(publishCalls, 1);
});

test("a MISSING verdict refuses — the failure mode of a skipped check is never 'proceed'", async () => {
  let publishCalls = 0;
  for (const v of [undefined, null, {}, { pass: "yes" }]) {
    const r = await publishIfPassed({ verdict: v, publish: async () => { publishCalls++; } });
    assert.equal(r.published, false, `verdict ${JSON.stringify(v)} must refuse`);
  }
  assert.equal(publishCalls, 0);
});

test("the rejection is logged before the refusal, so the reason is never silent", async () => {
  const lines = [];
  await publishIfPassed({
    slug: "hormuz", verdict: qcVerdict(ok({ flatFactor: { measured: true, value: 0.4 } })),
    publish: async () => {}, log: (l) => lines.push(l),
  });
  assert.match(lines.join("\n"), /qc-reject hormuz/);
  assert.match(lines.join("\n"), /clipping/);
});
