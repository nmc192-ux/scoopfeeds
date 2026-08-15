/**
 * videoSpecWriter.test.js — the tolerant JSON extractor.
 *
 * The live 2026-08-02 run lost specs to "unparseable_json" with no visible
 * cause. The extractor exists so a cosmetic wrapper (markdown fence, a line of
 * prose around the object) never costs an article; a genuinely truncated
 * payload must still come back null, because "tolerant" must never mean
 * "accepts a spec the model didn't finish".
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _internals, writeVideoSpec } from "./videoSpecWriter.js";
import { validateSpec, CAPTION_MAX_CHARS } from "./videoSpecSchema.js";
import { resolveAttribution } from "./videoAttribution.js";

const { extractJsonPayload, buildSpecPrompt } = _internals;

// ─── The return contract: a result object on EVERY path, never null ─────────
//
// The prod dry run of 2026-08-03 died here. d7e2c6e changed writeVideoSpec from
// null-or-spec to `{ ok, spec, costUsd, reason, attempts }` and the caller
// started reading `r.costUsd` BEFORE `r.ok` — but the too-thin path still
// returned bare null. The first thin article therefore threw
// "Cannot read properties of null (reading 'costUsd')" out of the whole cycle,
// and every later candidate was never attempted. One survivor of an old
// contract cost the entire run.
//
// Both halves are pinned: the shape is asserted, and the source is walked so a
// future `return null` cannot be reintroduced without failing.

const SPEC_KEYS = ["ok", "spec", "costUsd", "reason", "attempts"];

function assertResultShape(r, label) {
  assert.notEqual(r, null, `${label}: writeVideoSpec returned null — the contract is a result object`);
  assert.equal(typeof r, "object", `${label}: expected an object`);
  for (const k of SPEC_KEYS) {
    assert.ok(k in r, `${label}: result is missing "${k}" — the caller reads all five`);
  }
  assert.equal(typeof r.ok, "boolean", `${label}: ok must be a boolean`);
  assert.equal(typeof r.costUsd, "number", `${label}: costUsd must be a number, the caller sums it`);
  assert.ok(Number.isFinite(r.costUsd), `${label}: costUsd must be finite`);
  if (!r.ok) {
    assert.equal(r.spec, null, `${label}: a rejection must carry spec:null`);
    assert.equal(typeof r.reason, "string", `${label}: a rejection must explain itself`);
    assert.ok(r.reason.length > 0, `${label}: reason must not be empty`);
  }
}

test("writeVideoSpec has no `return null` — every exit is a result object", () => {
  const raw = readFileSync(new URL("./videoSpecWriter.js", import.meta.url), "utf8");
  const start = raw.indexOf("export async function writeVideoSpec");
  assert.ok(start !== -1, "writeVideoSpec not found");
  // Ends at the next top-level export — writePackaging.
  const end = raw.indexOf("\nexport ", start + 1);
  assert.ok(end > start, "could not bound writeVideoSpec's body");
  const body = raw.slice(start, end);

  const returns = [...body.matchAll(/\breturn\b([^\n]*)/g)].map(m => m[1].trim());
  assert.ok(returns.length >= 6, `expected every exit path present, found ${returns.length}`);
  for (const r of returns) {
    assert.ok(
      r.startsWith("reject(") || r.startsWith("{ ok: true"),
      `writeVideoSpec exit must be reject(...) or a { ok: true } object, found: return ${r}`
    );
  }
  assert.ok(!/\breturn\s+null\b/.test(body),
    "writeVideoSpec must never return null — the caller reads .costUsd before .ok");
});

test("the too-thin path returns a result carrying its spend, not null", () => {
  // The exact prod sequence, pinned at the source level: the too-thin branch is
  // the one that regressed, and it must hand back both spentUsd and attempts —
  // a rejected article still paid for its model call.
  const raw = readFileSync(new URL("./videoSpecWriter.js", import.meta.url), "utf8");
  const branch = raw.slice(raw.indexOf("if (v.errors.some(isThinnessError))"));
  const exit = branch.slice(0, branch.indexOf("if (attempts === 1)"));
  assert.match(exit, /return reject\(/, "the too-thin branch must return a rejection object");
  assert.match(exit, /spentUsd/, "the too-thin rejection must carry the spend it already incurred");
  assert.match(exit, /attempts/, "the too-thin rejection must carry the attempt count");
});

test("every reachable rejection path has the full result shape", async () => {
  // No network: both of these exit before any model call.
  const saved = process.env.VIDEO_SPEC_ENABLED;
  process.env.VIDEO_SPEC_ENABLED = "";
  try {
    assertResultShape(await writeVideoSpec({ id: "a", title: "T" }), "flag unset");
  } finally {
    if (saved === undefined) delete process.env.VIDEO_SPEC_ENABLED;
    else process.env.VIDEO_SPEC_ENABLED = saved;
  }
});

// ─── The prompt must contain NO slide count ─────────────────────────────────
//
// Measured 2026-08-02: given "AT LEAST 6 and AT MOST N", all three articles
// returned EXACTLY 6 — the floor — with an identical card mix, including a
// story carrying 30 allowed sources. The run before that anchored on the
// ceiling and padded to it. The model does not weigh a stated range; it
// anchors on the nearest number. These tests exist so a well-meaning future
// edit cannot quietly reintroduce one.

const promptFor = (over = {}) => buildSpecPrompt({
  article: { title: "T", description: "D", content: "C", source_name: "Reuters", category: "world" },
  allowedSources: ["Reuters", "BBC News"],
  ...over,
});

test("the spec prompt states no slide count, in any form", () => {
  const p = promptFor();
  // Scoped to the VIDEO'S LENGTH. Per-card field constraints are a different
  // thing entirely and must survive — see the bars assertion below.
  const banned = [
    /\bAT LEAST \d+ cards?\b/i, /\bAT MOST \d+ cards?\b/i,
    /\bemit \d+ cards?\b/i, /\bexactly \d+ cards?\b/i,
    /\b\d+\s*(?:to|-|–)\s*\d+\s*cards?\b/i,
    /\baim for (?:about |roughly )?\d+\s*(?:cards?|slides?|words?)\b/i,
    /\b\d+\s*seconds?\b/i, /\b\d+\s*slides?\b/i, /\b\d+\s*minutes?\b/i,
    /target duration/i, /maximum runtime/i,
  ];
  for (const re of banned) {
    const m = p.match(re);
    assert.ok(!m, `prompt must not contain a length instruction matching ${re} — found ${JSON.stringify(m?.[0])}`);
  }
});

test("per-card field constraints survive — they are not length instructions", () => {
  const p = promptFor();
  assert.match(p, /"bars" MUST contain AT LEAST 2 entries/);
  assert.match(p, /AT MOST ONE line may have the colour "lime"/);
});

test("the prompt demands beats AS OUTPUT, before the slides", () => {
  const p = promptFor();
  assert.match(p, /ENUMERATE THE BEATS — AS OUTPUT, BEFORE THE SLIDES/);
  for (const kind of ["figure", "mechanism", "turn", "consequence"]) {
    assert.match(p, new RegExp(`"${kind}"`));
  }
  assert.match(p, /KINDS, not a checklist/);
  assert.match(p, /ONE CARD PER BEAT/i);
  assert.match(p, /a discovery you make, never a decision/);
  // The return shape names beats before slides.
  const shape = p.slice(p.lastIndexOf("Return ONLY a JSON object"));
  assert.ok(shape.indexOf('"beats"') !== -1 && shape.indexOf('"beats"') < shape.indexOf('"slides"'),
    "return shape must show beats before slides");
});

test("the worked example enumerates 12+ beats and is fenced off from grounding", () => {
  const p = promptFor();
  const example = p.slice(p.indexOf("WORKED EXAMPLE"));
  assert.ok(example.length > 100, "worked example must be present");
  const beatEntries = (example.match(/"kind":\s*"/g) || []).length;
  assert.ok(beatEntries >= 12, `worked example must show 12+ beats, found ${beatEntries}`);
  assert.match(example, /Twelve beats, because that source established twelve distinct things/);
  assert.match(example, /A thinner source might establish four/);
  assert.match(p, /ILLUSTRATIVE ONLY/);
  assert.match(p, /never reuse its facts, figures, or wording/);
});

// ─── Regression guard: every rejection log names its model ──────────────────

test("no logRejection call site omits `model`", () => {
  // a63b45d made the model per-call and updated three of five sites. The two it
  // missed logged `model=undefined` in production, on the too-thin and
  // exhausted-retries paths — invisible until a live run surfaced it.
  const raw = readFileSync(new URL("./videoSpecWriter.js", import.meta.url), "utf8");
  const calls = [...raw.matchAll(/logRejection\(\{[\s\S]*?\}\);/g)].map(m => m[0]);
  assert.ok(calls.length >= 6, `expected every rejection path covered, found ${calls.length}`);
  for (const c of calls) {
    assert.match(c, /\bmodel\b\s*[:,}]/, `logRejection call omits model:\n${c}`);
  }
});

// ─── INVALID_ARGUMENT classifier (evidence-gated, not a widened match) ──────

test("isInvalidArgument matches a bare 400 with no mention of thinking", () => {
  const { isInvalidArgument } = _internals;
  const err = { response: { status: 400, data: { error: { code: 400, message: "Request contains an invalid argument", status: "INVALID_ARGUMENT" } } } };
  assert.equal(isInvalidArgument(err), true);
});

test("isInvalidArgument ignores non-400s and unrelated 400s", () => {
  const { isInvalidArgument } = _internals;
  assert.equal(isInvalidArgument({ response: { status: 404 } }), false);
  assert.equal(isInvalidArgument({ response: { status: 429, data: { error: { message: "quota" } } } }), false);
  assert.equal(isInvalidArgument({ response: { status: 400, data: { error: { message: "API key not valid" } } } }), false);
});

test("the shared thinking classifier is NOT widened to bare 400s", () => {
  // Widening llmQueue's predicate would let any malformed request flip the
  // process-wide flag for igSummary, scriptWriter and llmQueue itself. The
  // probe lives here, gated on the retry's outcome, precisely to avoid that.
  const raw = readFileSync(new URL("../realityIndex/llmQueue.js", import.meta.url), "utf8");
  const fn = raw.slice(raw.indexOf("export function isGeminiThinkingRejection"));
  assert.match(fn.slice(0, 300), /\/thinking\/i\.test/);
  assert.ok(!/INVALID_ARGUMENT/.test(fn.slice(0, 300)),
    "the shared classifier must stay evidence-specific");
});

test("the probe only fires when thinkingConfig was actually sent", () => {
  const raw = readFileSync(new URL("./videoSpecWriter.js", import.meta.url), "utf8");
  assert.match(raw, /isInvalidArgument\(err\) && sentThinkingConfig && !thinkingRetryUsed/);
  // And the shared flag is flipped only after the retry SUCCEEDS.
  assert.match(raw, /if \(forceNoThinking && !thinkingConfirmed\)[\s\S]{0,200}markGeminiThinkingRejected/);
});

test("the prompt carries the SUPPLIED body text, not the stored content", () => {
  // Grounding and generation must see the same bytes: prompting with fetched
  // full text while screening against stored content would drop every
  // correctly-sourced figure drawn from the part the validator could not see.
  const p = buildSpecPrompt({
    article: { title: "T", description: "D", content: "STORED-ONLY-MARKER", source_name: "Reuters" },
    allowedSources: ["Reuters"],
    bodyText: "FETCHED-FULL-TEXT-MARKER with a great deal more detail.",
  });
  assert.match(p, /FETCHED-FULL-TEXT-MARKER/);
  assert.ok(!/STORED-ONLY-MARKER/.test(p), "stored content must not leak in when bodyText is supplied");
});

test("without bodyText the prompt falls back to stored content", () => {
  const p = buildSpecPrompt({
    article: { title: "T", content: "STORED-BODY-MARKER", source_name: "Reuters" },
    allowedSources: ["Reuters"],
  });
  assert.match(p, /STORED-BODY-MARKER/);
});

test("the retry correction note strips slide counts before the model sees it", () => {
  const { stripCounts } = _internals;
  assert.equal(stripCounts('only 4 slides remain after dropping 3 (< 6) — too thin for a video'), "too thin for a video");
  assert.match(stripCounts("too many slides: 41 > 34"), /enumerate the beats again/);
  assert.ok(!/\d/.test(stripCounts("too many slides: 41 > 34")));
  // Card-level adjacency facts are NOT counts of the video's length, and stay.
  assert.match(stripCounts('3 consecutive "stat" cards (max 2 in a row)'), /consecutive "stat" cards/);
});

test("exact JSON parses", () => {
  assert.deepEqual(extractJsonPayload('{"slides":[{"t":"title"}]}'), { slides: [{ t: "title" }] });
});

test("a markdown fence is stripped", () => {
  assert.deepEqual(extractJsonPayload('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJsonPayload('```\n{"a":1}\n```'), { a: 1 });
});

test("prose around the object is tolerated", () => {
  const raw = 'Here is the spec you asked for:\n{"a":{"b":[1,2]}}\nHope this helps!';
  assert.deepEqual(extractJsonPayload(raw), { a: { b: [1, 2] } });
});

test("braces and escaped quotes inside string values do not fool the scanner", () => {
  const raw = 'note: {"caption":"use } and { freely, say \\"hi\\"","x":1} trailing';
  assert.deepEqual(extractJsonPayload(raw), { caption: 'use } and { freely, say "hi"', x: 1 });
});

// ─── Trailing commas — the measured 2026-08-02 cause ────────────────────────

test("a trailing comma before } is repaired", () => {
  assert.deepEqual(extractJsonPayload('{"a":1,"b":2,}'), { a: 1, b: 2 });
});

test("a trailing comma before ] is repaired", () => {
  assert.deepEqual(extractJsonPayload('{"slides":[{"t":"title"},{"t":"kicker"},]}'), {
    slides: [{ t: "title" }, { t: "kicker" }],
  });
});

test("trailing commas are repaired inside a fence and around prose", () => {
  assert.deepEqual(extractJsonPayload('```json\n{"a":[1,2,],}\n```'), { a: [1, 2] });
  assert.deepEqual(extractJsonPayload('Here you go:\n{"a":[1,],}\ndone'), { a: [1] });
});

test("a comma before } INSIDE a string value is untouched", () => {
  const raw = '{"caption":"anchors, storms, and }, that is all","n":1,}';
  assert.deepEqual(extractJsonPayload(raw), { caption: "anchors, storms, and }, that is all", n: 1 });
});

test("repair does not rescue a genuinely truncated payload", () => {
  assert.equal(extractJsonPayload('{"slides":[{"t":"title"},'), null);
});

test("a truncated payload stays null — tolerance never accepts an unfinished spec", () => {
  assert.equal(extractJsonPayload('{"slides":[{"t":"title","lines":[["A","white"'), null);
});

test("no object at all stays null", () => {
  assert.equal(extractJsonPayload("I cannot produce a spec for this article."), null);
  assert.equal(extractJsonPayload(""), null);
  assert.equal(extractJsonPayload(null), null);
});

// ─── Decoration must run BEFORE validation ──────────────────────────────────
//
// THE LIVE DEFECT (2026-08-03). A dry run produced a video whose stat@1 and
// bars@4 were dropped with "first use of Yahoo Finance carries no verbal
// credit (§3b/3)" — on a spec whose title caption RECEIVES that credit from
// decorateTitleCard. Validation ran first, so the title had no credit yet, the
// §3b/3 fallback fired, and the figure cards were stripped out of an otherwise
// valid video.
//
// Two causes, both fixed and both covered here: the ordering, and
// `preCreditedSources` never being destructured in writeVideoSpec — so it
// reached nothing and validateSpec always ran with an empty credit set.

test("a model spec with NO written credit validates clean once decorated", () => {
  // The regression DrJ asked for, checked at the seam where the ordering lives:
  // decorate, then validate, and expect ZERO §3b/3 drops.
  const article = {
    id: "a1", source_name: "Yahoo Finance",
    url: "https://finance.yahoo.com/news/x", published_at: Date.UTC(2026, 7, 3),
  };
  const attribution = resolveAttribution(article);

  // Exactly what the model emits: figure cards whose captions credit nobody.
  const parsed = {
    beats: [
      { kind: "figure", beat: "three names drove 40% of the move", evidence: "forty percent" },
      { kind: "mechanism", beat: "inflows reach price through the index", evidence: "index" },
      { kind: "turn", beat: "the flows reversed", evidence: "reversed" },
      { kind: "consequence", beat: "concentration is unpriced", evidence: "sixty" },
    ],
    slides: [
      { t: "title", eyebrow: "MARKETS", lines: [["THE GAP", "white"], ["40%", "lime"]],
        caption: "Forty percent of the move came from three names." },
      { t: "stat", eyebrow: "SHARE", value: 40, unit: "%", lines: ["of the move"],
        source: "Yahoo Finance", caption: "Three names carried forty percent of it." },
      { t: "diagram", eyebrow: "FLOW", nodes: [["inflow", "cash"], ["index", "weights"], ["price", "print"]],
        caption: "The money moves through the index before it reaches price." },
      { t: "turn", lines: [["BUT THE FLOWS", "white"], ["REVERSED", "lime"]],
        caption: "Then the flows reversed, and nobody had priced that." },
      { t: "bars", eyebrow: "SPLIT", bars: [["three names", 40], ["everyone else", 60]],
        source: "Yahoo Finance", caption: "The rest of the market did the other sixty." },
      { t: "kicker", top: "STILL", bottom: "CONCENTRATED",
        caption: "Nobody has said what happens when the next one sells." },
    ],
  };

  const decorated = _internals.decorateParsedSpec(parsed, article, attribution);
  const title = decorated.slides[0];
  assert.match(title.caption, /Reported by Yahoo Finance\.$/,
    "decoration must put the credit on the title caption");

  const v = validateSpec(decorated, {
    allowedSources: ["Yahoo Finance"],
    preCreditedSources: [attribution.publisher],
    sourceText: "Forty percent 40 of the move came from three names, sixty 60 for the rest.",
  });

  const sourcingDrops = v.dropped.filter(d => d.kind === "sourcing");
  assert.deepEqual(sourcingDrops, [],
    `zero §3b/3 drops expected, got ${JSON.stringify(v.dropped)}`);
  assert.ok(v.spec.slides.some(c => c.t === "stat"), "the stat card must survive");
  assert.ok(v.spec.slides.some(c => c.t === "bars"), "the bars card must survive");
  assert.ok(!v.errors.some(e => /title caption does not credit/.test(e)), JSON.stringify(v.errors));
});

test("the per-figure credit rule still fires for a SECOND, uncredited source", () => {
  // Its actual purpose. Decoration credits the primary outlet only; a figure
  // attributed to a DIFFERENT outlet must still name that one aloud.
  const article = { id: "a2", source_name: "Reuters", url: "https://www.reuters.com/x" };
  const parsed = {
    beats: [
      { kind: "figure", beat: "70% of faults involve anchors", evidence: "seventy" },
      { kind: "turn", beat: "the cause was not weather", evidence: "anchors" },
    ],
    slides: [
      { t: "title", lines: [["X", "white"]], caption: "A claim." },
      { t: "stat", value: 70, unit: "%", lines: ["of faults"], source: "BBC News",
        caption: "Seventy percent of faults involve anchors." },
      { t: "diagram", nodes: [["a", "one"], ["b", "two"], ["c", "three"]], caption: "It moves through here first." },
      { t: "turn", lines: [["BUT", "white"]], caption: "But the cause was not the weather." },
      { t: "kicker", top: "NOT", bottom: "WEATHER", caption: "Nobody has said who pays next." },
    ],
  };
  const decorated = _internals.decorateParsedSpec(parsed, article, resolveAttribution(article));
  const v = validateSpec(decorated, {
    allowedSources: ["Reuters", "BBC News"],
    preCreditedSources: ["Reuters"],
    sourceText: "seventy 70 percent of faults involve anchors",
  });
  assert.ok(
    v.dropped.some(d => d.kind === "sourcing" && /BBC News/.test(d.reason)),
    `the second uncredited outlet must still be caught: ${JSON.stringify(v.dropped)}`
  );
});

test("writeVideoSpec DESTRUCTURES the credit it is given — no silent drop", () => {
  // preCreditedSources was accepted by the caller and never destructured, so it
  // reached nothing. The credit is now derived inside writeVideoSpec from the
  // same attribution that decorates the card, which makes the two unable to
  // disagree. Source-walked because the failure was invisible at runtime.
  const raw = readFileSync(new URL("./videoSpecWriter.js", import.meta.url), "utf8");
  const fn = raw.slice(raw.indexOf("export async function writeVideoSpec"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /preCreditedSources:\s*\[credit\?\.publisher\]/,
    "validateOpts must carry the credit derived alongside the decoration");
  const decorateAt = body.indexOf("decorateParsedSpec");
  const validateAt = body.indexOf("validateSpec(");
  assert.ok(decorateAt !== -1 && validateAt !== -1);
  assert.ok(decorateAt < validateAt,
    "decoration must appear BEFORE validation — the ordering is the bug");
});

// ─── Caption length: a writing constraint, never a gate ─────────────────────

test("the prompt states the measured caption-length constraint", () => {
  const p = promptFor();
  assert.match(p, /CAPTION LENGTH IS A HARD WRITING CONSTRAINT/);
  assert.match(p, new RegExp(`at or under ${CAPTION_MAX_CHARS} characters`),
    "the number must come from CAPTION_MAX_CHARS, not be written twice");
  assert.match(p, /measured width of two lines/,
    "state WHY, so it is not read as an arbitrary style preference");
  assert.match(p, /do not compress by deleting the source credit or the figure/,
    "shortening must not come out of attribution or grounding");
});

test("caption length is NOT enforced anywhere — no reject, no drop", () => {
  // DrJ's ruling: a three-line caption sits slightly higher than the band
  // intends; discarding an otherwise good video over one long sentence is a far
  // larger cost. The assembler's warning stays and refuses nothing.
  const schema = readFileSync(new URL("./videoSpecSchema.js", import.meta.url), "utf8");
  const code = schema.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.ok(!/CAPTION_MAX_CHARS/.test(code.replace(/export const CAPTION_MAX_CHARS = \d+;/, "")),
    "CAPTION_MAX_CHARS must be declared and never used as a validation threshold");

  const assembler = readFileSync(new URL("./videoAssembler.js", import.meta.url), "utf8");
  assert.match(assembler, /caption wraps to \$\{lines\.length\} lines/,
    "the assembler keeps its warning");
  const warnBlock = assembler.slice(assembler.indexOf("caption wraps to") - 400, assembler.indexOf("caption wraps to") + 400);
  assert.ok(!/throw|return null|dropped\.push/.test(warnBlock),
    "the wrap warning must refuse nothing");
});

// ─── ARC prompt rules (B1, B2) ──────────────────────────────────────────────

test("B1: the cold-open rule teaches by CORRECT/WRONG example, not by assertion", () => {
  // Abstract instructions have failed repeatedly on this model; the worked-pair
  // technique is what fixed the stat `lines` defect outright. Three pairs from
  // three different story shapes, so the SHAPE generalises rather than the
  // subject — and marked illustrative, like the beats example, so none of it is
  // ever reused as fact.
  const p = promptFor();
  assert.match(p, /THE TITLE CAPTION IS A COLD OPEN/);
  assert.match(p, /ILLUSTRATIVE ONLY/);
  assert.equal((p.match(/WRONG:/g) || []).length >= 3, true, "expected three worked WRONG lines");
  assert.equal((p.match(/RIGHT:/g) || []).length >= 3, true, "expected three worked RIGHT lines");
  // The three permitted moves are named explicitly rather than implied.
  assert.match(p, /QUESTION the story answers/);
  assert.match(p, /name the STAKE/);
  assert.match(p, /concrete ANOMALY/);
});

test("B2: the prompt PRESCRIBES NO OPENERS — a list is what causes the monotony", () => {
  // Given an approved list the model picks one and reuses it; ban a phrase and
  // it finds a synonym and reuses that. Rule 15b states a RELATIONSHIP and names
  // no opener at all. This test is what stops a later edit "helpfully" adding
  // one back, which would recreate the exact defect B2 exists to remove.
  const p = promptFor();
  assert.match(p, /EXTEND the one before it, COMPLICATE it, or CONTRADICT it/);
  assert.match(p, /DO NOT ADOPT A HOUSE OPENER/);
  assert.ok(
    !/approved (openers|transitions)|use one of these openers|begin each caption with/i.test(p),
    "the prompt must not hand the model a transition vocabulary",
  );
});

test("B2: the LIST-vs-SEQUENCE example shows the connection coming from the facts", () => {
  // The failure mode is a connecting phrase bolted onto an unchanged list. The
  // example carries the SAME three facts both times so the difference can only
  // be the ordering and the earning, not extra content.
  const p = promptFor();
  assert.match(p, /LIST \(each fact true, no sequence\)/);
  assert.match(p, /SEQUENCE \(same three facts, each one earning the next\)/);
});

test("B3: the closer rule names the three permitted moves and both wrong shapes", () => {
  const p = promptFor();
  assert.match(p, /THE KICKER MUST ANSWER "SO WHAT\?"/);
  assert.match(p, /the IMPLICATION/);
  assert.match(p, /the CONSEQUENCE/);
  assert.match(p, /WHAT TO WATCH/);
  // Both restatement shapes are shown, because the model reaches for the second
  // one — circling back to its own cold open — far more often than the first.
  assert.match(p, /\(the headline again\)/);
  assert.match(p, /\(your own cold open again\)/);
  assert.match(p, /ILLUSTRATIVE ONLY/);
});

// ─── Spoken register ────────────────────────────────────────────────────────
//
// DrJ, 2026-08-14: "the captions are written news prose read aloud". The fix is
// in the prompt, so the prompt is what these test. Whether the MODEL complies is
// a live-cycle question no local test can answer — see the PR.

const { CAPTION_MIN_CHARS: MINC } = await import("./videoSpecSchema.js");

test("the prompt names the MECHANICS of spoken register, not just the adjective", () => {
  // Rule 5 said "plain spoken prose" for months and produced wire copy. An
  // adjective is not an instruction; these are.
  const p = promptFor();
  assert.match(p, /WRITE IT TO BE SAID, NOT TO BE READ/);
  assert.match(p, /USE CONTRACTIONS/);
  assert.match(p, /ONE IDEA PER CLAUSE/);
  assert.match(p, /VARY THE LENGTH DELIBERATELY/);
  assert.match(p, /FRAGMENTS ARE ALLOWED/);
});

test("the prompt SHOWS the change, with worked pairs", () => {
  const p = promptFor();
  const written = (p.match(/WRITTEN: "/g) || []).length;
  const spoken = (p.match(/SPOKEN:  "/g) || []).length;
  assert.ok(written >= 3, `expected at least 3 worked examples, found ${written}`);
  assert.equal(written, spoken, "every WRITTEN example needs its SPOKEN counterpart");
});

test("THE EXEMPLARS OBEY THE RULES THEY TEACH", () => {
  // A prompt that demonstrates its own constraint being broken teaches the
  // broken version. Every SPOKEN example must sit inside the caption bounds.
  const p = promptFor();
  const spoken = [...p.matchAll(/SPOKEN:  "([^"]+)"/g)].map(m => m[1]);
  assert.ok(spoken.length >= 3);
  for (const s of spoken) {
    assert.ok(s.length <= CAPTION_MAX_CHARS, `exemplar is ${s.length} chars, over the ${CAPTION_MAX_CHARS} ceiling: "${s}"`);
    assert.ok(s.length >= MINC, `exemplar is ${s.length} chars, under the ${MINC} floor: "${s}"`);
  }
});

test("register changed; STANCE did not", () => {
  // The risk in rewriting the tone rule was quietly dropping the editorial
  // protections that lived in the same paragraph.
  const p = promptFor();
  assert.match(p, /STANCE, NOT REGISTER/);
  assert.match(p, /No editorialising/i);
  assert.match(p, /Preserve the source's hedging/);
  assert.match(p, /officials say/, "the hedging example must survive");
  assert.match(p, /never a licence to lose precision/,
    "spoken register must be explicitly fenced off from losing figures or qualifiers");
  assert.ok(!/Neutral wire-service register/.test(p),
    "the instruction that produced the written register must be gone");
});

// ─── The caption floor ──────────────────────────────────────────────────────

test("the prompt states the floor, sourced from the constant", () => {
  const p = promptFor();
  assert.match(p, new RegExp(`at or above ${MINC}`),
    "the number must come from CAPTION_MIN_CHARS, not be written twice");
  assert.match(p, /loses one of the slide's reveals/, "state WHY — it costs a beat, not just tidiness");
});

test("the floor is NOT enforced anywhere either", () => {
  const schema = readFileSync(new URL("./videoSpecSchema.js", import.meta.url), "utf8");
  const code = schema.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.ok(!/CAPTION_MIN_CHARS/.test(code.replace(/export const CAPTION_MIN_CHARS = \d+;/, "")),
    "CAPTION_MIN_CHARS must be declared and never used as a validation threshold");
});

test("the floor is WHERE THE COLLAPSE RULE BITES — the constant matches its evidence", async () => {
  // If someone later 'tidies' 70 to a rounder number, this fails: the value is
  // derived from fitStatesToDuration, not chosen for looking sensible.
  const { statesForCard, fitStatesToDuration } = await import("./videoSlideRenderer.js");
  const ctx = { outlet: "Reuters", slideIndex: 2, slideCount: 7, orientation: "vertical" };
  const card = { t: "stat", eyebrow: "F", value: "70", unit: "%", lines: ["a", "b"], hi: 1, source: "R", caption: "c" };
  const all = statesForCard(card, ctx);
  const secsFor = (chars) => (chars / 6.1) / 2.6;      // ~2.6 words/sec, ~6.1 chars/word
  const kept = (chars) => fitStatesToDuration(all, secsFor(chars), { cardType: "stat", slideIndex: 2 }).length;

  assert.equal(kept(MINC), all.length, `at the ${MINC}-char floor every state must survive`);
  assert.ok(kept(MINC - 15) < all.length,
    "well below the floor a beat must actually be dropped, or the floor is protecting nothing");
});

// ─── The spec dry-run gate ──────────────────────────────────────────────────
//
// DrJ, 2026-08-15: "I want to read what the model actually emits before a frame
// is rendered, and right now there's no path to that." There wasn't:
// writeVideoSpec had exactly one caller and it was inside the render cycle.

test("VIDEO_SPEC_LOG_JSON is OFF unless explicitly set to 1", () => {
  const src = readFileSync(new URL("./videoSpecWriter.js", import.meta.url), "utf8");
  assert.match(src, /process\.env\.VIDEO_SPEC_LOG_JSON === "1"/,
    "a literal 1, not a truthiness check — every other flag in this codebase reads that way");
  assert.ok(!/VIDEO_SPEC_LOG_JSON \|\|/.test(src), "no default-on fallback");
});

test("the dry-run script is READ-ONLY at the handle, not by convention", async () => {
  const raw = readFileSync(new URL("../../scripts/spec-dry-run.mjs", import.meta.url), "utf8");
  // CODE ONLY. The header explains WHY getDb() is avoided, so a naive search of
  // the whole file matches the explanation and fails on the documentation.
  const src = raw.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.match(src, /readonly:\s*true/, "the database handle must refuse writes");
  assert.ok(!/\bgetDb\(/.test(src),
    "getDb() runs bootstrapSchema — an inspection command must not apply migrations");
  for (const forbidden of ["claimVideoPost", "markVideoPublished", "produceVideo", "uploadToYouTube", "INSERT ", "UPDATE "]) {
    assert.ok(!src.includes(forbidden), `the dry run must never reach ${forbidden.trim()}`);
  }
});

test("the script builds its prompt with the REAL builder, not a copy", async () => {
  // A second prompt assembled for inspection would drift from the one actually
  // sent, and the drift would be invisible precisely when it mattered.
  const src = readFileSync(new URL("../../scripts/spec-dry-run.mjs", import.meta.url), "utf8");
  assert.match(src, /buildSpecPrompt\(/);
  assert.match(src, /import\("\.\.\/src\/services\/videoSpecWriter\.js"\)/,
    "imported from the real module — a copied prompt builder would drift invisibly");
  const { buildSpecPrompt } = await import("./videoSpecWriter.js");
  assert.equal(typeof buildSpecPrompt, "function", "the script depends on this staying exported");
});

test("the script selects the SAME columns the cycle does, image_url included", () => {
  // If the dry run inspected a different article shape from the one the cycle
  // hands the model, it would be reviewing a hypothetical.
  const src = readFileSync(new URL("../../scripts/spec-dry-run.mjs", import.meta.url), "utf8");
  const db = readFileSync(new URL("../models/database.js", import.meta.url), "utf8");
  const cycleCols = db.slice(db.indexOf("export function findFreshUnvideoedArticles"));
  for (const col of ["a.id", "a.title", "a.description", "a.content", "a.category",
                     "a.source_name", "a.published_at", "a.credibility", "a.url", "a.tags", "a.image_url"]) {
    assert.ok(src.includes(col), `the dry run must select ${col}`);
    assert.ok(cycleCols.includes(col), `the cycle must still select ${col} — otherwise this test is stale`);
  }
});

// ─── The beats/cards arithmetic, and who is exempt from it ──────────────────
//
// DrJ, 2026-08-15: four rejections in the logs, every one "enumerated N beats
// but emitted N-1 content cards", off by one in the same direction, surviving
// the retry. Two model calls and a lost video each time. Rule 8 said "no card
// without a beat" while rule 16b required the kicker to deliver a consequence —
// and "consequence" named two different things.

test("rule 8 states the wrappers are exempt, in so many words", () => {
  const p = promptFor();
  assert.match(p, /THE TITLE AND THE KICKER CARRY NO BEAT AND ARE NOT COUNTED/);
  assert.match(p, /governs the cards BETWEEN them/,
    "the arithmetic has to be stated, not left to be inferred from 'wrapped by'");
});

test("BOTH rules disambiguate 'consequence', each naming the other", () => {
  // The root cause was one word meaning two things in two places. Fixing one
  // side would have left the collision intact from the other direction.
  const p = promptFor();
  assert.match(p, /A NOTE ON THE WORD "CONSEQUENCE"/, "rule 8 side");
  assert.match(p, /rule 16b/, "rule 8 must point at the other rule by name");
  assert.match(p, /ALL THREE ARE DERIVED, AND NONE OF THEM IS A BEAT/, "rule 16b side");
  assert.match(p, /rule 8's "consequence" beat kind/, "and 16b must point back");
});

test("the arithmetic failure is named as a consequence of confusing them", () => {
  assert.match(promptFor(), /one more beat than you have content cards and the spec is rejected/,
    "state the actual failure, so the rule reads as a reason rather than a preference");
});

test("THE WORKED EXAMPLE SHOWS ITS KICKER", () => {
  // It ended on a "consequence" beat and never showed the closer, which taught
  // the exact failure being seen: the natural home for a final consequence is
  // the kicker, and the kicker is not counted.
  const p = promptFor();
  const beatsAt = p.indexOf('"kind": "consequence", "beat": "Operators are rerouting');
  const kickerAt = p.indexOf('AND HERE IS THAT SPEC\'S KICKER');
  assert.ok(beatsAt > 0, "the twelve-beat example is still there");
  assert.ok(kickerAt > beatsAt, "and the kicker is shown after it, where it will be read");
  assert.match(p, /NOTE WHAT IS NOT THERE/,
    "the example must say explicitly that the closer is absent from the list");
});

test("a rejected spec is returned for inspection, and never as a usable one", () => {
  // `spec` must stay null on rejection — a caller reading `.spec` must not get
  // something that failed validation. `rejectedSpec` is inspection only.
  const src = readFileSync(new URL("./videoSpecWriter.js", import.meta.url), "utf8");
  assert.match(src, /ok: false, spec: null, rejectedSpec/,
    "spec stays null; the parse rides alongside it");
  assert.match(src, /reject\(v\.errors\.slice\(0, 3\)\.join\(" \| "\), spentUsd, attempts, result\.parsed/,
    "the validation rejection is the one that must carry the parse");
});

test("the dry run prints the rejected spec and the mismatch arithmetic", () => {
  const src = readFileSync(new URL("../../scripts/spec-dry-run.mjs", import.meta.url), "utf8");
  assert.match(src, /r\.rejectedSpec/);
  assert.match(src, /MISMATCH of/, "the off-by-N is the diagnosis — print it, do not make it be counted by hand");
  assert.match(src, /beat kinds, in order/);
  assert.match(src, /last beat/, "the comparison that diagnosed this class: closer against the final beat");
});
