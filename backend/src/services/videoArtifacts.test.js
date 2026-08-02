/**
 * videoArtifacts.test.js — the sweeper, and the separation it enforces.
 *
 * The failure being designed against is CARDS_DIR: an artifact class with no
 * sweeper, on a persistent volume, that reached ~19 GB. So the tests that
 * matter are the ones asserting frames never touch the persistent volume, that
 * a leak is actually reclaimed, and that the MP4 window is enforced by AGE —
 * an orphan with no DB row has nothing else left to judge it by.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync, rmSync, utimesSync, readdirSync } from "fs";
import os from "os";
import path from "path";

// Point both roots at throwaway dirs BEFORE importing the module — it resolves
// them at import, exactly as it will in production.
const TMP = path.join(os.tmpdir(), `videoartifacts-test-${process.pid}`);
process.env.VIDEO_FRAMES_DIR = path.join(TMP, "frames");
process.env.SCOOP_PERSISTENT_DATA_DIR = path.join(TMP, "persist");
mkdirSync(path.join(TMP, "persist", "videos"), { recursive: true });

const {
  FRAMES_ROOT, VIDEOS_DIR, MP4_RETENTION_MS,
  acquireFrameDir, releaseFrameDir, sweepFrames, sweepVideos, sweepAtStartup,
} = await import("./videoArtifacts.js");

const ageFile = (p, ms) => {
  const t = (Date.now() - ms) / 1000;
  utimesSync(p, t, t);
};

test.after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });

// ─── The separation ─────────────────────────────────────────────────────────

test("frames NEVER live under the persistent volume", () => {
  const persist = path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR);
  assert.ok(!FRAMES_ROOT.startsWith(persist),
    `frames must be ephemeral, got ${FRAMES_ROOT} inside ${persist}`);
});

test("MP4s DO live under the persistent volume", () => {
  assert.ok(VIDEOS_DIR.startsWith(path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR)));
});

test("the default frames root is container-local when unset", async () => {
  // Re-import with the override removed to check the fallback, not the override.
  const saved = process.env.VIDEO_FRAMES_DIR;
  delete process.env.VIDEO_FRAMES_DIR;
  const fresh = await import(`./videoArtifacts.js?default-check=${Date.now()}`);
  assert.ok(fresh.FRAMES_ROOT.startsWith(os.tmpdir()),
    `default frames root must be os.tmpdir(), got ${fresh.FRAMES_ROOT}`);
  process.env.VIDEO_FRAMES_DIR = saved;
});

// ─── Frames lifecycle ───────────────────────────────────────────────────────

test("acquire creates a scratch dir, release removes it", () => {
  const dir = acquireFrameDir("job-1");
  assert.ok(existsSync(dir));
  writeFileSync(path.join(dir, "f0001.png"), "x");
  assert.equal(releaseFrameDir(dir), true);
  assert.ok(!existsSync(dir));
});

test("release refuses to delete anything outside the scratch root", () => {
  const outside = path.join(TMP, "persist", "videos");
  assert.equal(releaseFrameDir(outside), false);
  assert.ok(existsSync(outside), "a path outside FRAMES_ROOT must survive");
  assert.equal(releaseFrameDir(null), false);
});

test("sweepFrames reclaims a leaked dir — the crash case", () => {
  // Simulate a crash between render and compose: frames written, never released.
  const dir = acquireFrameDir("crashed-job");
  for (let i = 0; i < 5; i++) writeFileSync(path.join(dir, `f${i}.png`), "x".repeat(1000));
  const r = sweepFrames();
  assert.equal(r.removed, 1);
  assert.ok(r.bytes >= 5000, `expected reclaimed bytes, got ${r.bytes}`);
  assert.ok(!existsSync(dir));
});

test("sweepFrames on a clean root is a no-op, not an error", () => {
  assert.deepEqual(sweepFrames(), { removed: 0, bytes: 0 });
});

test("job keys are sanitised — a traversal cannot escape the scratch root", () => {
  const dir = acquireFrameDir("../../etc/passwd");
  assert.ok(dir.startsWith(FRAMES_ROOT), `escaped scratch root: ${dir}`);
  releaseFrameDir(dir);
});

// ─── MP4 retention ──────────────────────────────────────────────────────────

const mp4 = (name, ageMs) => {
  const p = path.join(VIDEOS_DIR, name);
  writeFileSync(p, "0".repeat(2048));
  if (ageMs) ageFile(p, ageMs);
  return p;
};

test("MP4s older than the window are deleted, newer ones kept", () => {
  const old  = mp4("old.mp4", 72 * 3600 * 1000);
  const recent = mp4("recent.mp4", 2 * 3600 * 1000);
  const r = sweepVideos();
  assert.equal(r.removed, 1);
  assert.equal(r.kept, 1);
  assert.ok(!existsSync(old));
  assert.ok(existsSync(recent));
  rmSync(recent, { force: true });
});

test("the default window is 48h", () => {
  assert.equal(MP4_RETENTION_MS, 48 * 3600 * 1000);
});

test("retention is AGE-based so an orphan with no DB row is still collected", () => {
  // The cards failure mode exactly: the row is gone, the file is not. A
  // DB-driven sweep would skip this forever.
  const orphan = mp4("no-such-job-in-db.mp4", 72 * 3600 * 1000);
  const r = sweepVideos();
  assert.equal(r.removed, 1);
  assert.ok(!existsSync(orphan));
});

test("non-mp4 files in the videos dir are left alone", () => {
  const other = path.join(VIDEOS_DIR, "notes.txt");
  writeFileSync(other, "keep me");
  ageFile(other, 72 * 3600 * 1000);
  sweepVideos();
  assert.ok(existsSync(other), "the sweeper must only claim what it owns");
  rmSync(other, { force: true });
});

test("sweepAtStartup runs every sweep and reports each", async () => {
  const dir = acquireFrameDir("startup-leak");
  writeFileSync(path.join(dir, "f.png"), "x");
  mp4("stale.mp4", 72 * 3600 * 1000);
  const r = await sweepAtStartup();
  assert.equal(r.frames.removed, 1);
  assert.equal(r.videos.removed, 1);
  assert.ok(r.tts, "the TTS cache must be swept here too — one place to look for what reclaims disk");
  assert.equal(readdirSync(FRAMES_ROOT).length, 0);
});
