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
import { mkdirSync, writeFileSync, existsSync, rmSync, utimesSync, readdirSync, readFileSync } from "fs";
import os from "os";
import path from "path";

// Point both roots at throwaway dirs BEFORE importing the module — it resolves
// them at import, exactly as it will in production.
const TMP = path.join(os.tmpdir(), `videoartifacts-test-${process.pid}`);
process.env.VIDEO_FRAMES_DIR = path.join(TMP, "frames");
process.env.SCOOP_PERSISTENT_DATA_DIR = path.join(TMP, "persist");
mkdirSync(path.join(TMP, "persist", "videos"), { recursive: true });

const {
  FRAMES_ROOT, VIDEOS_DIR, MP4_RETENTION_MS, PENDING_FETCH_HOLD_MS,
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

// ─── The wiring ─────────────────────────────────────────────────────────────
//
// Every test above this line passed for months while sweepAtStartup() had NO
// CALLER ANYWHERE. All three sweeps were dead code in all three processes: the
// 48h MP4 window, the frame-leak backstop and the 7-day TTS cache never ran,
// and docs/video-pipeline.md documented them as working. A local checkout still
// held a rendered MP4 fifteen days old.
//
// A sweeper is only a sweeper if something calls it, so that is what this
// asserts — reachability from a process entry point, not the presence of a
// literal string in one known file. Move the wiring into a shared bootstrap and
// this still passes; delete it and it fails.

const BACKEND_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

const PROCESS_ENTRY_POINTS = [
  "server.js",                      // web
  "src/jobs/schedulerProcess.js",   // scheduler
  "src/jobs/workerProcess.js",      // worker
];

/** Every module reachable from `entry` by relative import, transitively. */
function reachableFrom(entry) {
  const seen = new Set();
  const queue = [path.resolve(BACKEND_ROOT, entry)];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    // `from "./x.js"`, `import("./x.js")` — internal modules are always relative.
    for (const m of src.matchAll(/(?:from\s*|import\s*\(\s*)["'](\.[^"']+)["']/g)) {
      queue.push(path.resolve(path.dirname(file), m[1].split("?")[0]));
    }
  }
  return seen;
}

test("the startup sweep is WIRED — reachable from a process entry point", () => {
  const callers = [];
  for (const entry of PROCESS_ENTRY_POINTS) {
    for (const file of reachableFrom(entry)) {
      if (file.endsWith(".test.js")) continue;
      if (file === path.resolve(BACKEND_ROOT, "src/services/videoArtifacts.js")) continue; // the definition
      if (/\bsweepAtStartup\s*\(/.test(readFileSync(file, "utf8"))) {
        callers.push(`${entry} → ${path.relative(BACKEND_ROOT, file)}`);
      }
    }
  }
  assert.ok(
    callers.length > 0,
    "sweepAtStartup() has no caller reachable from server.js, schedulerProcess.js or " +
    "workerProcess.js. Every sweep in this module is therefore dead code and nothing " +
    "reclaims video disk — the exact state this file shipped in. Wire it into a process " +
    "that starts. (If you added a fourth process, add its entry point to " +
    "PROCESS_ENTRY_POINTS above.)"
  );
});

// ─── The URL-fetch hold (2026-08-13) ────────────────────────────────────────
//
// The sweep stays AGE-based — an orphan with no row has nothing else to judge
// it by, which is the CARDS_DIR lesson above. One exception, and only one:
// Instagram and Threads do not receive bytes. Meta FETCHES the file from our
// own server, asynchronously, after the container is created. Sweeping it
// mid-fetch breaks a publish that has already been accepted, and the failure
// surfaces at PUBLISH time — long after the line that said "posted".
//
// The predicate is INJECTED so videoArtifacts stays database-free; sweepAtStartup
// wires the real one.

const HOUR = 3600_000;
function agedMp4(name, hours) {
  const p = path.join(VIDEOS_DIR, name);
  writeFileSync(p, "0".repeat(20_000));
  ageFile(p, hours * HOUR);
  return p;
}
const clearVideos = () => {
  for (const f of readdirSync(VIDEOS_DIR)) rmSync(path.join(VIDEOS_DIR, f), { force: true });
};

test("the article id is recovered from an autopost filename, not a legacy one", async () => {
  const { articleIdFromVideoFile } = await import("./videoArtifacts.js");
  assert.equal(articleIdFromVideoFile("abc-123-vid-v1-ab033bc4b0ef.mp4"), "abc-123");
  // Legacy deliberately does NOT match: it carries no design key, and treating
  // it as one would recover the wrong id. It is also not a URL-fetch surface.
  assert.equal(articleIdFromVideoFile("abc-shorts.mp4"), null);
  assert.equal(articleIdFromVideoFile("notavideo.txt"), null);
});

test("with no predicate the sweep is byte-for-byte the old behaviour", () => {
  clearVideos();
  agedMp4("old-vid-v1-aaaaaaaaaaaa.mp4", 72);
  agedMp4("fresh-vid-v1-aaaaaaaaaaaa.mp4", 1);
  const r = sweepVideos();
  assert.equal(r.removed, 1);
  assert.equal(r.kept, 1);
  assert.equal(r.held, 0);
});

test("a PENDING url-fetch publish HOLDS its MP4 past retention", () => {
  // The hold is measured BEYOND retention — 48h + 24h = 72h. Measuring it from
  // mtime made the guard a no-op, since anything old enough to sweep was
  // already past a 24h window. That bug was caught by this test.
  clearVideos();
  agedMp4("held-vid-v1-aaaaaaaaaaaa.mp4", 60);
  const r = sweepVideos({ pendingUrlFetch: (id) => id === "held" });
  assert.equal(r.held, 1);
  assert.equal(r.removed, 0);
  assert.equal(r.kept, 0, "60h is past retention — HELD, not merely kept");
  assert.ok(existsSync(path.join(VIDEOS_DIR, "held-vid-v1-aaaaaaaaaaaa.mp4")));
});

test("the hold is BOUNDED — a crash mid-publish cannot pin a file forever", () => {
  clearVideos();
  agedMp4("stuck-vid-v1-aaaaaaaaaaaa.mp4", 73);
  const r = sweepVideos({ pendingUrlFetch: () => true });
  assert.equal(r.removed, 1, "past retention + hold the file is swept regardless");
  assert.equal(r.held, 0);
});

test("only the article with a pending publish is held", () => {
  clearVideos();
  agedMp4("keepme-vid-v1-aaaaaaaaaaaa.mp4", 60);
  agedMp4("sweepme-vid-v1-aaaaaaaaaaaa.mp4", 60);
  const r = sweepVideos({ pendingUrlFetch: (id) => id === "keepme" });
  assert.equal(r.held, 1);
  assert.equal(r.removed, 1);
  assert.ok(existsSync(path.join(VIDEOS_DIR, "keepme-vid-v1-aaaaaaaaaaaa.mp4")));
  assert.ok(!existsSync(path.join(VIDEOS_DIR, "sweepme-vid-v1-aaaaaaaaaaaa.mp4")));
});

test("a legacy-named MP4 is never held — it is not a URL-fetch surface", () => {
  clearVideos();
  agedMp4("legacy-shorts.mp4", 60);
  const r = sweepVideos({ pendingUrlFetch: () => true });
  assert.equal(r.removed, 1);
  assert.equal(r.held, 0);
});

test("the hold window is configurable, and a short one cannot save an old file", () => {
  assert.equal(PENDING_FETCH_HOLD_MS, 24 * HOUR);
  clearVideos();
  agedMp4("short-vid-v1-aaaaaaaaaaaa.mp4", 60);
  const r = sweepVideos({ pendingUrlFetch: () => true, pendingHoldMs: 1 * HOUR });
  assert.equal(r.removed, 1, "48h retention + a 1h hold cannot save a 60h file");
});
