/**
 * videoSourceBundle.test.js — assembly discipline.
 *
 * The bundle exists to add BEATS, not bytes. What must hold: wire copy
 * republished across outlets is deduped rather than counted twice, one outlet
 * cannot eat the budget, every excerpt is attributed (grounding and the
 * attribution card both depend on it), and the whole thing degrades to the primary article
 * rather than costing a video.
 *
 * DB-backed paths are exercised through makeTestDb per CLAUDE.md — never
 * runMigrations() directly.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _internals } from "./videoSourceBundle.js";

const RAW = readFileSync(new URL("./videoSourceBundle.js", import.meta.url), "utf8");
// Scan CODE, not prose. The first version of these assertions matched the word
// "updates" inside a comment about wire updates and failed a clean module.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const SRC = stripComments(RAW);
const { tooSimilar, MAX_BUNDLE_CHARS, MAX_SIBLING_CHARS, MAX_SIBLINGS } = _internals;

// ─── Dedup: the reason the bundle is worth anything ─────────────────────────

test("verbatim wire copy is caught as a duplicate", () => {
  const wire = "The central bank raised its benchmark rate by twenty five basis points on Thursday, citing persistent services inflation across the eurozone economy.";
  const seen = [new Set(wire.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w.length > 4))];
  assert.equal(tooSimilar(wire, seen), true);
});

test("a lightly reworded republication is still caught", () => {
  const original = "The central bank raised its benchmark rate by twenty five basis points on Thursday, citing persistent services inflation across the eurozone economy.";
  const reworded = "Citing persistent services inflation across the eurozone economy, the central bank raised its benchmark rate Thursday by twenty five basis points.";
  const seen = [new Set(original.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w.length > 4))];
  assert.equal(tooSimilar(reworded, seen), true);
});

test("genuinely different reporting is KEPT — otherwise the bundle adds nothing", () => {
  const original = "The central bank raised its benchmark rate by twenty five basis points on Thursday, citing persistent services inflation.";
  const distinct = "Manufacturers in Bavaria reported order books shrinking for a fourth consecutive quarter, according to the regional chamber of commerce survey published Monday.";
  const seen = [new Set(original.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w.length > 4))];
  assert.equal(tooSimilar(distinct, seen), false);
});

test("empty or trivial text is refused rather than counted", () => {
  assert.equal(tooSimilar("", [new Set(["anything"])]), true);
});

// ─── Budget shape ───────────────────────────────────────────────────────────

test("a single sibling cannot consume the whole budget", () => {
  assert.ok(MAX_SIBLING_CHARS * MAX_SIBLINGS <= MAX_BUNDLE_CHARS,
    "per-sibling cap x max siblings must fit the bundle, or breadth is unreachable");
  assert.ok(MAX_SIBLING_CHARS < MAX_BUNDLE_CHARS / 4,
    "one outlet taking a quarter of the budget defeats the point of breadth");
});

test("the bundle cap keeps input cost negligible", () => {
  // ~4 chars/token at the pinned $0.30/M input rate.
  const usd = (MAX_BUNDLE_CHARS / 4 / 1e6) * 0.30;
  assert.ok(usd < 0.01, `bundle input should stay under a cent, got $${usd.toFixed(4)}`);
});

// ─── Discipline, asserted against the source ────────────────────────────────

test("siblings use STORED content — the bundle adds no extra fetches", () => {
  // resolveVideoSourceText is the only fetching path and must be called once,
  // for the primary. Sixteen publisher requests per upload is not "one request
  // per video".
  assert.equal((SRC.match(/resolveVideoSourceText\(/g) || []).length, 1);
  assert.ok(!/http\.get|axios/.test(SRC), "the bundle itself must never fetch");
});

test("nothing is written or cached", () => {
  assert.ok(!/INSERT|UPDATE|DELETE|\.run\(/i.test(SRC), "the bundle is read-only");
  assert.ok(!/new Map\(|_cache/.test(SRC), "a cache is stored bytes under another name");
});

test("sibling reads go through the DAL's event accessor, not ad-hoc event logic", () => {
  assert.match(SRC, /resolveEventForArticle/);
});

test("every excerpt is attributed — grounding and the attribution card depend on it", () => {
  assert.match(SRC, /PRIMARY SOURCE — \$\{outlet\}/);
  assert.match(SRC, /ADDITIONAL COVERAGE — \$\{outlet\}/);
});

test("failure degrades to the primary article rather than costing the video", () => {
  assert.match(SRC, /catch \(err\)[\s\S]*primary article only/);
});
