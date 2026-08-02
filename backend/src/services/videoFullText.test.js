/**
 * videoFullText.test.js — the discipline, not the happy path.
 *
 * What must hold: nothing is stored, nothing is retried, a failure is never
 * fatal, and a fetch that does not actually beat the stored copy is refused
 * rather than counted as a win. The network is never touched — every test
 * either exercises a pre-network guard or a pure function.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveVideoSourceText, _internals } from "./videoFullText.js";
import { extractArticleText } from "./contentEnricher.js";

const SRC = readFileSync(new URL("./videoFullText.js", import.meta.url), "utf8");

// ─── The no-storage discipline, asserted against the source itself ──────────

test("the module never touches the database", () => {
  // A cache is storage with a different name, and would reintroduce exactly
  // the growth this module exists to avoid on a 15GB db at 77% disk.
  assert.ok(!/getDb|better-sqlite3|INSERT|UPDATE|prepare\(/i.test(SRC),
    "videoFullText must not read or write the database");
});

test("no cache of any kind", () => {
  assert.ok(!/\bnew Map\(|\bnew Set\(|globalThis\.|_cache/i.test(SRC),
    "a cache is stored bytes under another name");
});

test("one request, never retried", () => {
  assert.equal((SRC.match(/http\.get\(/g) || []).length, 1, "exactly one fetch call site");
  assert.ok(!/for \(|while \(|retry/i.test(SRC.split("export async function")[1] || ""),
    "the resolve path must contain no retry loop");
});

// ─── Pre-network guards ─────────────────────────────────────────────────────

test("no url falls back to stored content", async () => {
  const r = await resolveVideoSourceText({ id: "a", content: "stored body text" });
  assert.equal(r.origin, "stored");
  assert.equal(r.text, "stored body text");
  assert.equal(r.reason, "no_url");
});

test("a blocked host falls back without fetching", async () => {
  const r = await resolveVideoSourceText({ id: "b", url: "https://www.wsj.com/x", content: "stored" });
  assert.equal(r.origin, "stored");
  assert.equal(r.reason, "blocked_host");
});

test("a fetch failure is never fatal — stored content is returned", async () => {
  // .invalid is reserved by RFC 2606 and never resolves, so this exercises the
  // catch path without depending on any real host.
  const r = await resolveVideoSourceText({ id: "c", url: "https://nonexistent.invalid/x", content: "stored body" });
  assert.equal(r.origin, "stored");
  assert.equal(r.text, "stored body");
  assert.match(r.reason, /^fetch_error:/);
});

test("the shape is stable across every path", async () => {
  for (const article of [
    { id: "1", content: "x" },
    { id: "2", url: "https://ft.com/a", content: "x" },
    { id: "3", url: "https://nonexistent.invalid/a", content: "x" },
  ]) {
    const r = await resolveVideoSourceText(article);
    for (const k of ["text", "chars", "origin", "reason"]) assert.ok(k in r, `missing ${k}`);
    assert.equal(typeof r.text, "string");
    assert.equal(r.chars, r.text.length);
  }
});

// ─── The uncapped extraction path ───────────────────────────────────────────

const html = (paras) => `<html><body><article>${paras.map(p => `<p>${p}</p>`).join("")}</article></body></html>`;
const longPara = (n) => `Paragraph ${n} carries a full sentence of real body text well past the minimum paragraph length threshold used by the extractor.`;

test("extractArticleText still caps at 5000 by default — the ingestion path is unchanged", () => {
  const big = html(Array.from({ length: 200 }, (_, i) => longPara(i)));
  assert.equal(extractArticleText(big).length, 5000);
});

test("a larger maxLen returns more text — the whole point of the module", () => {
  const big = html(Array.from({ length: 200 }, (_, i) => longPara(i)));
  const wide = extractArticleText(big, { maxLen: _internals.MAX_FULLTEXT_LEN });
  assert.ok(wide.length > 5000, `expected > 5000, got ${wide.length}`);
  assert.ok(wide.length <= _internals.MAX_FULLTEXT_LEN);
  // And it is a strict superset — same extraction, longer ceiling.
  assert.ok(wide.startsWith(extractArticleText(big)));
});

test("the gain threshold is real — a re-fetch must beat stored by a margin", () => {
  assert.ok(_internals.MIN_GAIN_CHARS >= 100,
    "too small a margin makes a wasted request look like an upgrade");
});

test("the inline timeout is tighter than enrichment's 12s", () => {
  assert.ok(_internals.FETCH_TIMEOUT_MS < 12000,
    "this runs inline in generation; a slow publisher must not hold a video hostage");
});
