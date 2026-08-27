/**
 * manifest.test.mjs — the library index and its dedupe key.
 *
 * Run: cd backend && node --test "scripts/lib/stock/*.test.mjs"
 *
 * Two behaviours here are load-bearing and neither is obvious:
 *
 *  1. A REJECTED asset keeps its row. The row is the only thing standing between
 *     a re-run and re-downloading a clip a human already looked at and turned
 *     down (§8.4). Prune the rejects and every acquisition run re-fetches them.
 *  2. Provenance is refused, not defaulted. An asset whose creator or source URL
 *     is lost cannot be attributed later, and the manifest is the only place that
 *     information exists once the file is on disk.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  betterGradeCount, isKnown, knownKeys, makeEntry, manifestPath, nextId, readManifest, writeManifest,
} from "./manifest.mjs";

const roots = [];
const tmpRoot = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "stocklib-"));
  roots.push(dir);
  return dir;
};
test.after(() => {
  for (const r of roots) { try { rmSync(r, { recursive: true, force: true }); } catch { /* best effort */ } }
});

const candidate = (over = {}) => ({
  provider: "pexels", providerId: "857195", creator: "A Name",
  sourceUrl: "https://www.pexels.com/video/x-857195/", license: "Pexels License",
  width: 3840, height: 2160, durationSec: 14, downloadUrl: "https://player.example/uhd.mp4", tags: [],
  ...over,
});

const entry = (over = {}) => makeEntry({
  id: "ports-0001", subjectClass: "ports", tags: ["ports"], candidate: candidate(),
  grade: "crisp-4k-crop", orientation: "landscape", filePath: "staging/ports-0001.mp4",
  addedAt: "2026-08-27T00:00:00.000Z", ...over,
});

// ─── Round trip ─────────────────────────────────────────────────────────────

test("an absent manifest reads as an empty library, not an error", () => {
  assert.deepEqual(readManifest(tmpRoot()), []);
});

test("what is written is what is read back", () => {
  const root = tmpRoot();
  writeManifest([entry()], root);
  const [got] = readManifest(root);
  assert.equal(got.id, "ports-0001");
  assert.equal(got.sourceUrl, "https://www.pexels.com/video/x-857195/");
  assert.equal(got.status, "staged");
  assert.equal(got.treatedPath, null);
});

test("a manifest that is not an array is refused rather than overwritten", () => {
  // The manifest is the only record of provenance for every file on disk.
  const root = tmpRoot();
  writeFileSync(manifestPath(root), '{"oops": true}');
  assert.throws(() => readManifest(root), /not a JSON array/);
});

test("the write is atomic — no .tmp file survives a completed write", () => {
  const root = tmpRoot();
  writeManifest([entry()], root);
  assert.throws(() => readFileSync(`${manifestPath(root)}.tmp`, "utf8"), /ENOENT/);
});

// ─── Dedupe ─────────────────────────────────────────────────────────────────

test("a providerId already in the manifest is known and skipped", () => {
  const existing = [entry()];
  assert.equal(isKnown(existing, candidate()), true);
  assert.equal(isKnown(existing, candidate({ providerId: "999" })), false);
});

test("the same id from a DIFFERENT provider is a different asset", () => {
  // Provider ids are only unique within a provider; keying on the id alone would
  // silently drop a Pixabay clip because Pexels happened to use the same number.
  const existing = [entry()];
  assert.equal(isKnown(existing, candidate({ provider: "pixabay" })), false);
  assert.equal(knownKeys(existing).has("pexels:857195"), true);
});

test("a REJECTED asset still counts as known — that is what stops a re-download", () => {
  const rejected = [entry({ id: "ports-0001" })];
  rejected[0].status = "rejected";
  assert.equal(isKnown(rejected, candidate()), true,
    "a human already looked at this clip and said no; do not fetch it again");
});

// ─── Ids ────────────────────────────────────────────────────────────────────

test("ids are class-scoped, zero-padded, and never reused", () => {
  assert.equal(nextId([], "ports"), "ports-0001");
  const some = [entry({ id: "ports-0001" }), entry({ id: "ports-0007" }), entry({ id: "ships-0002" })];
  assert.equal(nextId(some, "ports"), "ports-0008", "the highest wins, not the count");
  assert.equal(nextId(some, "ships"), "ships-0003");
  assert.equal(nextId(some, "flag-china"), "flag-china-0001");
});

test("deleting a row does not free its id for reuse within the same run", () => {
  // Ids appear in filenames; reusing one would point an old path at a new clip.
  const withGap = [entry({ id: "ports-0003" })];
  assert.equal(nextId(withGap, "ports"), "ports-0004");
});

// ─── Provenance is mandatory ────────────────────────────────────────────────

test("an asset with no source URL is refused, not written with a null", () => {
  assert.throws(
    () => entry({ candidate: candidate({ sourceUrl: null }) }),
    /missing provenance field `sourceUrl`/
  );
});

test("every mandatory provenance field is actually checked", () => {
  for (const field of ["provider", "providerId", "sourceUrl", "license"]) {
    assert.throws(
      () => entry({ candidate: candidate({ [field]: null }) }),
      new RegExp(`missing provenance field \`${field}\``),
      `${field} must be mandatory`
    );
  }
});

test("tags from the class and from the provider are merged without duplicates", () => {
  const e = entry({ tags: ["ports", "trade"], candidate: candidate({ tags: ["ports", "cranes"] }) });
  assert.deepEqual(e.tags, ["ports", "trade", "cranes"]);
});

// ─── The soft-crop quota reads from here ────────────────────────────────────

test("only better-grade, non-rejected assets count toward a class's quota", () => {
  const m = [
    entry({ id: "ports-0001", subjectClass: "ports", grade: "crisp-4k-crop" }),
    entry({ id: "ports-0002", subjectClass: "ports", grade: "native-portrait" }),
    entry({ id: "ports-0003", subjectClass: "ports", grade: "soft-hd-crop" }),
    entry({ id: "ships-0001", subjectClass: "ships", grade: "crisp-4k-crop" }),
  ];
  m.push({ ...entry({ id: "ports-0004", subjectClass: "ports", grade: "crisp-4k-crop" }), status: "rejected" });
  assert.equal(betterGradeCount(m, "ports"), 2,
    "soft ones do not count toward their own quota, and a reject is not an asset");
  assert.equal(betterGradeCount(m, "ships"), 1);
  assert.equal(betterGradeCount(m, "flags"), 0);
});
