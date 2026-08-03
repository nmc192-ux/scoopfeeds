// IG caption V2: the flag contract, credit stripping, and duplicate-block
// suppression. Deliberately does NOT touch the DB — safeRiCallout swallows its
// own errors and returns null without one, which is the degrade path anyway.
import test from "node:test";
import assert from "node:assert/strict";
import { stripImageCredits, composeInstagramCaptionV2, deterministicSeoLine } from "./socialComposer.js";

const article = (over = {}) => ({
  id: "a-test-1",
  title: "Nvidia earnings beat forecasts",
  description: "Nvidia reported record data-centre revenue for the quarter.",
  category: "business",
  source_name: "Reuters",
  ...over,
});

// ── Image credits ────────────────────────────────────────────────────────

test("stripImageCredits removes the credit forms seen in real feeds", () => {
  // The one that actually published mid-caption.
  assert.equal(
    stripImageCredits("Eccentric exercise may help older individuals. DragonImages/Getty Images A lesser-known type of exercise builds strength."),
    "Eccentric exercise may help older individuals. A lesser-known type of exercise builds strength."
  );
  for (const [input, banned] of [
    ["Rescuers worked overnight. Photo: Jane Doe, Reuters", "Photo:"],
    ["Crowds gathered in the square (Photo by Jane Doe/Getty Images) as talks began.", "Photo by"],
    ["Troops advanced. REUTERS/Jane Doe", "REUTERS/"],
    ["A view of the site. AP Photo/John Smith", "AP Photo/"],
    ["The stadium filled early. Image credit: AFP", "Image credit"],
    ["Markets opened lower via Getty Images today.", "Getty Images"],
    ["The prototype on display. Shutterstock", "Shutterstock"],
  ]) {
    assert.ok(!stripImageCredits(input).includes(banned), `"${banned}" survived: ${stripImageCredits(input)}`);
  }
});

test("stripImageCredits does NOT eat legitimate prose about the same organisations", () => {
  for (const s of [
    "Reuters reported that talks had stalled.",
    "Getty sued the startup over training data.",
    "The AP called the race on Tuesday.",
    "An image of the vehicle was widely shared.",
    "Sources credit the deal to months of quiet diplomacy.",
  ]) {
    assert.equal(stripImageCredits(s), s, `mangled: ${s}`);
  }
});

test("stripImageCredits never throws and tidies its own seams", () => {
  for (const v of [undefined, null, "", 0, {}, []]) {
    assert.doesNotThrow(() => stripImageCredits(v));
  }
  assert.equal(stripImageCredits(undefined), "");
  // No doubled spaces or orphaned punctuation left behind.
  const out = stripImageCredits("Talks resumed . Photo: Reuters  and ended late.");
  assert.ok(!/\s{2,}/.test(out), out);
  assert.ok(!/\s+[.,;:]/.test(out), out);
});

// ── Duplicate-block suppression ──────────────────────────────────────────

test("seo_line is SUPPRESSED when it duplicates the summary", () => {
  // The real shape: a feed that sets description === title.
  const title = "Murree Shutter-Down: Traders Demand Exemption from Smart Lockdown";
  const out = composeInstagramCaptionV2(article({ title, description: title }));
  assert.equal(out.meta.seoLineSuppressed, true);
  // The correct sentence survives; the degraded copy above it does not.
  assert.ok(out.caption.startsWith(title), out.caption.slice(0, 120));
  assert.equal(out.caption.split(title).length - 1, 1, "the title must appear exactly once");
});

test("seo_line is KEPT when it genuinely differs from the summary", () => {
  const out = composeInstagramCaptionV2(article({
    title: "First dots on the road map to exiting fossil fuels",
    description: "The message from inaugural talks was clear: it's not if, but when and how.",
  }));
  assert.equal(out.meta.seoLineSuppressed, false);
  assert.ok(out.caption.startsWith("First dots on the road map to exiting fossil fuels"));
});

// ── Structure and the flag contract ──────────────────────────────────────

test("V2 has no dot separator and at most 5 tags", () => {
  const out = composeInstagramCaptionV2(article());
  assert.ok(!out.caption.includes(".\n.\n."), "the V1 dot separator must be gone");
  const tags = out.caption.split(/\s+/).filter((w) => w.startsWith("#"));
  assert.ok(tags.length >= 3 && tags.length <= 5, `got ${tags.length} tags`);
  assert.ok(out.caption.includes("Link in bio"));
  // Blocks separated by exactly one blank line, no leading whitespace.
  assert.ok(!/^\s/.test(out.caption));
  assert.ok(!/\n{3,}/.test(out.caption), "no more than one blank line between blocks");
});

test("a model seo_line wins over the derived one, and loses its trailing punctuation", () => {
  const out = composeInstagramCaptionV2(article(), { seoLine: "Nvidia earnings and the AI trade." });
  assert.ok(out.caption.startsWith("Nvidia earnings and the AI trade\n\n"), out.caption.slice(0, 80));
  assert.equal(out.meta.seoLineSource, "copy");
});

test("with no seoLine supplied the deterministic line is used", () => {
  const a = article();
  const out = composeInstagramCaptionV2(a);
  assert.equal(out.meta.seoLineSource, "deterministic");
  assert.ok(out.caption.startsWith(deterministicSeoLine(a.title)));
});

test("the caption stays within Instagram's 2200-char ceiling, truncating only the summary", () => {
  const out = composeInstagramCaptionV2(article({
    ig_summary: "word ".repeat(900).trim(),
    title: "Nvidia earnings beat forecasts",
  }));
  assert.ok(out.characterCount <= 2200, `got ${out.characterCount}`);
  // Neither end was sacrificed.
  assert.ok(out.caption.startsWith("Nvidia earnings beat forecasts"));
  assert.ok(/#\w+$/.test(out.caption.trim()), "tags must survive truncation");
});
