import test from "node:test";
import assert from "node:assert/strict";
import { __test__ } from "./eventCarouselCopy.js";
import { deterministicSeoLine } from "../../services/socialComposer.js";

const { validateSeoLine, validateCopy, contentHashOf, COPY_RULES_VER } = __test__;

// Minimal ctx: validateSeoLine reads only entityTokens; validateCopy also
// reads event.title and corpus.
const ctx = (tokens = ["iran", "sanctions", "oil"], title = "Iran oil sanctions tighten") => ({
  event: { id: "e1", title },
  entityTokens: new Set(tokens),
  corpus: "",
  snippets: [],
  sources: [],
});

test("seo_line — a good line passes and is returned verbatim", () => {
  const r = validateSeoLine("Iran oil sanctions explained", ctx());
  assert.equal(r.ok, true);
  assert.equal(r.value, "Iran oil sanctions explained");
});

test("seo_line — hype is rejected", () => {
  for (const bad of [
    "BREAKING",
    "Breaking Iran sanctions news",
    "You won't believe what Iran did",
    "This changes everything for Iran",
    "The truth about Iran sanctions",
    "Everything you need to know about Iran",
  ]) {
    const r = validateSeoLine(bad, ctx());
    assert.equal(r.ok, false, `expected rejection: ${bad}`);
    assert.match(r.reason, /^(hype_|words_)/, `${bad} -> ${r.reason}`);
  }
});

test("seo_line — 'breaking' mid-line is NOT hype (anchored to start only)", () => {
  const r = validateSeoLine("Iran sanctions reach breaking point", ctx());
  assert.equal(r.ok, true, `unexpected rejection: ${r.reason}`);
});

test("seo_line — hashtag, emoji and URL are rejected with distinct reasons", () => {
  assert.equal(validateSeoLine("Iran oil sanctions #news", ctx()).reason, "has_hashtag");
  assert.equal(validateSeoLine("Iran oil sanctions 🔥 explained", ctx()).reason, "has_emoji");
  assert.equal(validateSeoLine("Iran sanctions at scoopfeeds.com", ctx()).reason, "has_url");
  assert.equal(validateSeoLine("Iran sanctions https://x.io news", ctx()).reason, "has_url");
});

test("seo_line — word count outside 3-10 is rejected, boundaries inclusive", () => {
  assert.equal(validateSeoLine("Iran sanctions", ctx()).reason, "words_2");
  assert.equal(validateSeoLine("Iran oil sanctions", ctx()).ok, true, "3 words must pass");
  const ten = "Iran oil sanctions explained for anyone who follows the story";
  assert.equal(ten.split(/\s+/).length, 10);
  assert.equal(validateSeoLine(ten, ctx()).ok, true, "10 words must pass");
  assert.equal(validateSeoLine(ten + " today", ctx()).reason, "words_11");
});

test("seo_line — a line with no entity token is rejected", () => {
  const r = validateSeoLine("Latest news update today", ctx());
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_entity_token");
});

test("seo_line — an event with no signature fails CLOSED, not open", () => {
  const r = validateSeoLine("Iran oil sanctions explained", ctx([]));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_signature");
});

test("seo_line — absent / non-string / blank all report `absent`", () => {
  for (const v of [undefined, null, "", "   ", 42, {}, []]) {
    assert.equal(validateSeoLine(v, ctx()).reason, "absent", `input ${JSON.stringify(v)}`);
  }
});

// ── The load-bearing property: seo_line is SOFT ──────────────────────────

const goodParsed = (seo) => ({
  details: [
    "Tehran said the new measures take effect on Monday.",
    "Exports fell for a third consecutive month in July.",
    "Two European refiners paused their crude purchases.",
  ],
  figures: [
    { value: "3", label: "European refiners", source_sentence: "3 European refiners paused their crude purchases this week." },
    { value: "12%", label: "Iran export decline", source_sentence: "Iranian crude exports fell 12% over the quarter." },
    { value: "$78", label: "Brent crude price", source_sentence: "Brent crude settled at $78 a barrel on Friday." },
  ],
  why_it_matters: "Tighter sanctions on Iranian crude push refiners toward costlier grades, which feeds through to pump prices.",
  seo_line: seo,
});

function copyCtx() {
  const snippets = [
    "3 European refiners paused their crude purchases this week.",
    "Iranian crude exports fell 12% over the quarter.",
    "Brent crude settled at $78 a barrel on Friday.",
  ];
  return {
    event: { id: "e1", title: "Iran oil sanctions tighten" },
    snippets,
    sources: ["Reuters", "Reuters", "Bloomberg"],
    corpus: __test__.normText(snippets.join(" \n ")),
    entityTokens: new Set(["iran", "iranian", "sanctions", "oil", "crude"]),
  };
}

test("a REJECTED seo_line does not fail the copy — fallback fires, post proceeds", () => {
  // Multi-word so this exercises the HYPE path, not the word-count path —
  // word count is checked first, and a bare "BREAKING" would report words_1.
  const v = validateCopy(goodParsed("Breaking Iran oil sanctions news"), copyCtx());
  assert.equal(v.ok, true, "copy must still be valid");
  assert.match(v.seoReason, /^hype_/);
  assert.equal(v.copy.seo_line, deterministicSeoLine("Iran oil sanctions tighten"));
  assert.ok(v.copy.seo_line.length > 0);
});

test("an ABSENT seo_line does not fail the copy", () => {
  const v = validateCopy(goodParsed(undefined), copyCtx());
  assert.equal(v.ok, true);
  assert.equal(v.seoReason, "absent");
  assert.equal(v.copy.seo_line, deterministicSeoLine("Iran oil sanctions tighten"));
});

test("an ACCEPTED seo_line is carried through with no seoReason", () => {
  const v = validateCopy(goodParsed("Iran oil sanctions explained"), copyCtx());
  assert.equal(v.ok, true);
  assert.equal(v.seoReason, null);
  assert.equal(v.copy.seo_line, "Iran oil sanctions explained");
});

test("a bad FIGURE still refuses the whole copy — softness is scoped to seo_line", () => {
  const parsed = goodParsed("Iran oil sanctions explained");
  parsed.figures[0].source_sentence = "A sentence that appears nowhere in the corpus at all.";
  const v = validateCopy(parsed, copyCtx());
  assert.equal(v.ok, false);
  assert.equal(v.reason, "source_sentence_not_in_corpus");
});

// ── Cache identity ───────────────────────────────────────────────────────

test("COPY_RULES_VER is v4 and changes the content hash", () => {
  assert.equal(COPY_RULES_VER, "v4");
  const c = copyCtx();
  const v3 = contentHashOf(c, "v3");
  const v4 = contentHashOf(c, "v4");
  assert.notEqual(v3, v4, "v3 and v4 must hash differently or cached rows never regenerate");
  assert.equal(contentHashOf(c), v4, "default must be the current version");
  assert.equal(contentHashOf(c, "v4"), v4, "hashing must be deterministic");
});

// ── Deterministic fallback ───────────────────────────────────────────────

test("deterministicSeoLine strips the publisher suffix and caps at 10 words", () => {
  assert.equal(
    deterministicSeoLine("The president of the United States will visit the border - BBC News"),
    "The president of the United States will visit the border"
  );
  assert.equal(
    deterministicSeoLine("A very long title with many words that should be cut off at exactly ten words here"),
    "A very long title with many words that should be"
  );
  assert.ok(deterministicSeoLine("Iran oil sanctions tighten").split(/\s+/).length <= 10);
  // The suffix must be gone, not merely shortened.
  assert.ok(!/BBC/.test(deterministicSeoLine("Markets slide on rate fears - BBC News")));
});

test("deterministicSeoLine KEEPS function words — it must read as English", () => {
  // The regression: stripping stopwords produced machine output. "our" is a
  // stopword, so the subject of the trailing clause vanished and left a
  // dangling noun; "This/of/Can" left telegraphese.
  assert.equal(
    deterministicSeoLine("This Type of Exercise Can Help You Build More Muscle With Less Effort"),
    "This Type of Exercise Can Help You Build More Muscle"
  );
  // A "?" is a boundary, so the truncated trailing clause is cut, not mangled.
  assert.equal(
    deterministicSeoLine("Who wins Game 7 of Lightning-Canadiens? Our panel ..."),
    "Who wins Game 7 of Lightning-Canadiens"
  );
  for (const out of [
    deterministicSeoLine("The message from talks on exiting fossil fuels"),
    deterministicSeoLine("First dots on the road map to exiting fossil fuels"),
  ]) {
    assert.match(out, /\b(?:the|on|of|to)\b/, `function words must survive: "${out}"`);
  }
});

test("deterministicSeoLine cuts at the first clause boundary", () => {
  // Originally a fix for clause FUSION: "as" was a stopword, so stripping
  // function words welded two clauses into a run-on. Stopword stripping is
  // gone now, but the cut still earns its place — it is what keeps the line
  // to one clause instead of a whole sentence.
  assert.equal(
    deterministicSeoLine("Iran oil sanctions tighten as European refiners pause purchases"),
    "Iran oil sanctions tighten"
  );
  // Every boundary form.
  assert.equal(deterministicSeoLine("Markets slide on rate fears, analysts warn"), "Markets slide on rate fears");
  assert.equal(deterministicSeoLine("Nvidia earnings beat forecasts — shares jump"), "Nvidia earnings beat forecasts");
  assert.equal(deterministicSeoLine("Ceasefire holds in Gaza after talks in Cairo"), "Ceasefire holds in Gaza");
  assert.equal(deterministicSeoLine("Flooding worsens in Sindh amid record monsoon rain"), "Flooding worsens in Sindh");
  assert.equal(deterministicSeoLine("Strike enters third week while talks stall"), "Strike enters third week");
  assert.equal(deterministicSeoLine("Fed holds rates: what it means"), "Fed holds rates");
});

test("deterministicSeoLine does not cut when the head would be too short", () => {
  // A leading connective must not truncate the line to nothing.
  const out = deterministicSeoLine("As it happened, Iran sanctions tightened");
  assert.ok(out.split(/\s+/).length >= 3, `got "${out}"`);
  assert.ok(/iran|happened/i.test(out), `got "${out}"`);
});

test("deterministicSeoLine leaves a short title intact but drops its trailing punctuation", () => {
  // Under the old stripping rule this collapsed to the single word "over".
  assert.equal(deterministicSeoLine("Is it over?"), "Is it over");
  assert.equal(deterministicSeoLine("Nvidia earnings beat forecasts."), "Nvidia earnings beat forecasts");
});

test("deterministicSeoLine never throws and returns '' only for empty input", () => {
  for (const v of [undefined, null, "", "   ", 0, {}, [], { toString() { throw new Error("x"); } }]) {
    let out;
    assert.doesNotThrow(() => { out = deterministicSeoLine(v); });
    assert.equal(typeof out, "string");
  }
  assert.equal(deterministicSeoLine(""), "");
  assert.ok(deterministicSeoLine("Nvidia earnings beat expectations").length > 0);
});
