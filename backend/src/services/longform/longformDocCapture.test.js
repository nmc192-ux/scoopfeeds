/**
 * longformDocCapture.test.js — the sources, on screen, honestly.
 *
 * The engine run is injected; what is tested is the derivation (which
 * article, which phrase) and the honesty rules (capture unavailable → no
 * keys; captured without highlight rects → dropped).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  pickDocSentence, phraseSpan, buildDocsPlan, makeCaptureDocs, MAX_DOCS, MAX_PHRASE_CHARS,
} from "./longformDocCapture.js";

const BEATS = [
  { text: "OpenAI banned accounts running an influence operation from the fake institute." },
  { text: "The institute's website listed experts who never wrote for it." },
];

test("pickDocSentence: the sentence the script leans on hardest, or null when nothing overlaps", () => {
  const text = [
    "Unrelated preamble sentence that says nothing relevant to anything at all here.",
    "OpenAI said it banned accounts tied to an influence operation promoting the fake institute across platforms.",
    "Weather tomorrow is expected to be mild across the region with light winds.",
  ].join(" ");
  const s = pickDocSentence(text, BEATS);
  assert.ok(s.includes("banned accounts"), s);
  assert.equal(pickDocSentence("Nothing here matches the script in any way whatsoever, truly.", BEATS), null,
    "a doc card for a source the script never used would cite decoration");
});

test("phraseSpan: fits one text node, cuts at word boundaries, avoids quotes", () => {
  const long = "The institute claimed a roster of distinguished international experts including several who deny any affiliation with the organisation entirely";
  const p = phraseSpan(long);
  assert.ok(p.length <= MAX_PHRASE_CHARS);
  assert.ok(!p.endsWith(" "), "no trailing space");
  assert.ok(long.startsWith(p), "a prefix, so the Range can match the page text");
  assert.ok(!phraseSpan('Before the quote "then a quotation mark breaks extraction fidelity somewhere later on"').includes('"'));
});

test("buildDocsPlan: at most MAX_DOCS, real urls only, phrase doubles as container", () => {
  const corpus = Array.from({ length: 6 }, (_, i) => ({
    source: `Outlet${i}`, title: `T${i}`, url: i === 0 ? "not-a-url" : `https://x.example/${i}`,
    text: "OpenAI said it banned accounts tied to an influence operation promoting the fake institute broadly.",
  }));
  const plan = buildDocsPlan({ corpus, beats: BEATS });
  assert.ok(plan.length <= MAX_DOCS);
  assert.ok(plan.every((d) => d.url.startsWith("https://")), "the not-a-url source is skipped");
  for (const d of plan) {
    assert.equal(d.container, d.phrases[0], "the phrase IS the container needle — inside the crop by construction");
    assert.match(d.name, /^DOC_[A-Z0-9_]+_\d$/);
  }
});

const scaffold = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "doccap-"));
  mkdirSync(path.join(dir, "out/docs"), { recursive: true });
  return dir;
};
const TOPIC = { sourceCorpus: { corpus: [{
  source: "Reuters", title: "The story", url: "https://reuters.example/a",
  text: "OpenAI said it banned accounts tied to an influence operation promoting the fake institute broadly.",
}] } };

test("capture unavailable degrades to a film without doc cards, never a failure", async () => {
  const dir = scaffold();
  const stage = makeCaptureDocs({ dir, runEngine: async () => { throw new Error("Playwright is not installed"); } });
  const { keys, docs } = await stage({ topic: TOPIC, script: { beats: BEATS } });
  assert.deepEqual(keys, []);
  assert.deepEqual(docs, {});
  assert.ok(existsSync(path.join(dir, "docs.json")), "the plan was still written — a local rerun can capture it");
});

test("only pages captured WITH highlight rects become keys; the docs table is capture-derived", async () => {
  const dir = scaffold();
  const stage = makeCaptureDocs({ dir, runEngine: async () => {
    const plan = JSON.parse(readFileSync(path.join(dir, "docs.json"), "utf8"));
    const [a] = plan;
    writeFileSync(path.join(dir, `out/docs/${a.name}.png`), "png");
    writeFileSync(path.join(dir, "out/docs/rects.json"), JSON.stringify({
      [a.name]: { w: 100, h: 50, rects: [{ x: 1, y: 2, w: 30, h: 8 }] },
    }));
  } });
  const { keys, docs } = await stage({ topic: TOPIC, script: { beats: BEATS } });
  assert.equal(keys.length, 1);
  assert.equal(docs[keys[0]].eyebrow, "REUTERS");
  assert.match(docs[keys[0]].src, /^Reuters — The story$/);
});

test("a capture that produced no rects is dropped — an unhighlighted doc card asserts nothing", async () => {
  const dir = scaffold();
  const stage = makeCaptureDocs({ dir, runEngine: async () => {
    const plan = JSON.parse(readFileSync(path.join(dir, "docs.json"), "utf8"));
    writeFileSync(path.join(dir, `out/docs/${plan[0].name}.png`), "png");
    writeFileSync(path.join(dir, "out/docs/rects.json"), JSON.stringify({
      [plan[0].name]: { w: 100, h: 50, rects: [] },
    }));
  } });
  const { keys } = await stage({ topic: TOPIC, script: { beats: BEATS } });
  assert.deepEqual(keys, []);
});
