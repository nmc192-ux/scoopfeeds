/**
 * Quarantine, treatment and the sweeper.
 *
 * The sweeper's tests are written the way a sweeper's tests have to be: the
 * dangerous direction is DELETING SOMETHING THAT MATTERED, so most of these
 * assert what survives. A quarantined candidate is evidence, not a cache.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { makeTestDb } from "../../testing/testDb.js";
import { createCandidate, transition } from "./incidentLedger.js";
import {
  quarantineRoot, ingestFile, resolveQuarantined, treatFile, sweep,
  buildIncidentFilter, assertNoFabricatedMotion, FORBIDDEN_FILTERS,
  parseQuarantineName, ALLOWED_EXTS, SWEEP_CAP, UNDECIDED_RETENTION_MS,
  IncidentFileError,
} from "./incidentFiles.js";
import { LIBRARY_GRADE } from "../videoHouseGrade.js";
import { ffmpegRaw } from "./incidentHash.js";

function caught(fn, Type) {
  try { fn(); } catch (err) {
    if (Type) assert.ok(err instanceof Type, `expected ${Type.name}, got ${err?.name}: ${err?.message}`);
    return err;
  }
  assert.fail("expected a throw, got none");
}

const UUID = () => crypto.randomUUID();

// ─── Where files live ───────────────────────────────────────────────────────

test("quarantine lives under SCOOP_PERSISTENT_DATA_DIR, not the deploy directory", () => {
  const prev = process.env.SCOOP_PERSISTENT_DATA_DIR;
  try {
    process.env.SCOOP_PERSISTENT_DATA_DIR = "/var/lib/scoop";
    assert.equal(quarantineRoot(), path.join("/var/lib/scoop", "incident-quarantine"));
    // A redeploy replaces the deploy directory; anything under it is destroyed.
    assert.equal(quarantineRoot().includes("/backend/data"), false);
  } finally {
    if (prev === undefined) delete process.env.SCOOP_PERSISTENT_DATA_DIR;
    else process.env.SCOOP_PERSISTENT_DATA_DIR = prev;
  }
});

test("names encode the candidate id, so the sweeper can decide by ledger state", () => {
  const id = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
  assert.deepEqual(parseQuarantineName(`${id}.mp4`), { candidateId: id, treated: false, ext: "mp4" });
  assert.deepEqual(parseQuarantineName(`${id}-treated.mp4`), { candidateId: id, treated: true, ext: "mp4" });
  // Anything else is somebody else's file.
  for (const name of ["notes.txt", "README", `${id}.exe.sh`, "manifest.json", ".DS_Store"]) {
    assert.equal(parseQuarantineName(name), null, name);
  }
});

// ─── Ingest ─────────────────────────────────────────────────────────────────

test("a supplied file is copied into quarantine, hashed, and the source untouched", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "inc-ing-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "q");
  const src = path.join(dir, "clip.mp4");
  const contents = "not really a video but bytes are bytes";
  writeFileSync(src, contents);

  const id = UUID();
  const out = ingestFile(id, src, { root });
  assert.equal(out.relPath, `${id}.mp4`);
  assert.ok(existsSync(out.absPath));
  assert.equal(out.bytes, Buffer.byteLength(contents));
  assert.match(out.sha256, /^[0-9a-f]{64}$/);
  assert.ok(existsSync(src), "the operator's own copy must not be consumed");
});

test("only the small accepted extension set is taken", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "inc-ext-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "q");
  for (const ext of ["exe", "sh", "svg", "zip", "pdf", "gif"]) {
    const src = path.join(dir, `x.${ext}`);
    writeFileSync(src, "x");
    assert.equal(caught(() => ingestFile(UUID(), src, { root }), IncidentFileError).code, "bad-ext", ext);
  }
  for (const ext of ALLOWED_EXTS) {
    const src = path.join(dir, `ok.${ext}`);
    writeFileSync(src, "x");
    assert.ok(ingestFile(UUID(), src, { root }).relPath.endsWith(`.${ext}`));
  }
});

test("a bad candidate id or a missing source is refused before anything is written", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "inc-bad-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "q");
  const src = path.join(dir, "a.mp4"); writeFileSync(src, "x");

  assert.equal(caught(() => ingestFile("not-a-uuid", src, { root }), IncidentFileError).code, "bad-id");
  assert.equal(caught(() => ingestFile(UUID(), "/nope/missing.mp4", { root }), IncidentFileError).code, "no-file");
  assert.equal(existsSync(root), false, "nothing should have been created");
});

test("stored paths are relative — an absolute path is machine-specific", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "inc-rel-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "q");
  const src = path.join(dir, "clip.mp4"); writeFileSync(src, "x");
  const out = ingestFile(UUID(), src, { root });
  assert.equal(path.isAbsolute(out.relPath), false);
  assert.equal(resolveQuarantined(out.relPath, { root }), path.join(root, out.relPath));
  assert.equal(resolveQuarantined(null), null);
});

// ─── The filter chain fabricates nothing ───────────────────────────────────

test("the incident chain uses the house grade — one definition, not a copy", () => {
  assert.ok(buildIncidentFilter().includes(LIBRARY_GRADE),
    "incident media must be graded with the same chain as the stock library");
});

test("no filter that fabricates motion or content appears in the chain", () => {
  assert.equal(assertNoFabricatedMotion(), true);
  assert.ok(FORBIDDEN_FILTERS.includes("minterpolate"), "frame interpolation is the headline case");
});

test("the guard is not vacuous — it catches a chain that DOES fabricate", () => {
  // If assertNoFabricatedMotion always returned true, the test above would pass
  // while proving nothing.
  for (const bad of FORBIDDEN_FILTERS) {
    const err = caught(() => assertNoFabricatedMotion(`scale=100:100,${bad}fps=60,format=yuv420p`), IncidentFileError);
    assert.equal(err.code, "fabricated-motion", bad);
  }
  assert.match(
    caught(() => assertNoFabricatedMotion("minterpolate=fps=60"), IncidentFileError).message,
    /never happened/i,
    "the refusal should say why, not just that"
  );
});

// ─── Real treatment ─────────────────────────────────────────────────────────

test("a real file is graded to a real output, and the source survives", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "inc-treat-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "q"); mkdirSync(root, { recursive: true });

  const id = UUID();
  const src = path.join(root, `${id}.mp4`);
  await ffmpegRaw(["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:duration=2:rate=25",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", src]);

  const out = await treatFile(id, `${id}.mp4`, { root });
  assert.equal(out.relPath, `${id}-treated.mp4`);
  assert.ok(out.bytes > 1000);
  assert.ok(existsSync(src), "the original is never overwritten");
  assert.notEqual(out.absPath, src);
});

test("treating a file that is not there fails loudly", async () => {
  await assert.rejects(() => treatFile(UUID(), "nope.mp4", { root: "/tmp/does-not-exist-xyz" }), IncidentFileError);
});

// ─── The sweeper ────────────────────────────────────────────────────────────

function sweepFixture() {
  const t = makeTestDb({ prefix: "incident-sweep-" });
  const dir = mkdtempSync(path.join(tmpdir(), "inc-sweep-"));
  const root = path.join(dir, "q");
  mkdirSync(root, { recursive: true });
  const n = Date.now();
  t.db.prepare(`INSERT INTO articles (id,title,url,source_name,category,published_at,fetched_at)
                VALUES ('art-1','Bridge reopens','https://n.example/1','E','world',?,?)`).run(n, n);
  let seq = 0;
  const make = (status, { updatedAt = Date.now() } = {}) => {
    const { candidate } = createCandidate(t.db, {
      storyKind: "article", storyId: "art-1",
      postUrl: `https://bsky.app/profile/s${++seq}.bsky.social/post/3k${seq}`,
    });
    if (status !== "candidate") {
      transition(t.db, candidate.id, "verifying", { checkName: "t" });
      if (status === "killed") transition(t.db, candidate.id, "killed", { checkName: "t", killReason: "stale" });
      else if (status !== "verifying") {
        transition(t.db, candidate.id, "verified", { checkName: "t" });
        if (status === "clearing" || status === "cleared" || status === "uncleared") {
          transition(t.db, candidate.id, "clearing", { checkName: "t" });
          if (status === "cleared") transition(t.db, candidate.id, "cleared", { checkName: "t", clearanceBasis: "owner" });
          if (status === "uncleared") transition(t.db, candidate.id, "uncleared", { checkName: "t" });
        }
      }
    }
    t.db.prepare("UPDATE media_candidates SET updated_at = ? WHERE id = ?").run(updatedAt, candidate.id);
    writeFileSync(path.join(root, `${candidate.id}.mp4`), "x".repeat(1000));
    return candidate.id;
  };
  return { ...t, root, dir, make, cleanupAll() { t.cleanup(); rmSync(dir, { recursive: true, force: true }); } };
}

test("killed and uncleared bytes go promptly; the ROW stays as the record of why", (t0) => {
  const f = sweepFixture(); t0.after(() => f.cleanupAll());
  const killed = f.make("killed");
  const uncleared = f.make("uncleared");

  const out = sweep(f.db, { root: f.root });
  assert.equal(out.deleted, 2);
  assert.ok(out.bytes >= 2000, "bytes are reported, not just a count");
  assert.equal(existsSync(path.join(f.root, `${killed}.mp4`)), false);
  assert.equal(existsSync(path.join(f.root, `${uncleared}.mp4`)), false);
  // The rows survive — they are what stop a re-acquire and record the decision.
  assert.ok(f.db.prepare("SELECT 1 FROM media_candidates WHERE id = ?").get(killed));
});

test("verified, clearing, cleared and constructed files are HELD — they are evidence", (t0) => {
  const f = sweepFixture(); t0.after(() => f.cleanupAll());
  const held = ["verified", "clearing", "cleared"].map((s) => f.make(s, { updatedAt: 0 }));

  const out = sweep(f.db, { root: f.root });
  assert.equal(out.deleted, 0, "a decided or in-progress candidate's file must not be swept");
  assert.equal(out.kept, held.length);
  for (const id of held) assert.ok(existsSync(path.join(f.root, `${id}.mp4`)), id);
});

test("undecided files go only once stale, not immediately", (t0) => {
  const f = sweepFixture(); t0.after(() => f.cleanupAll());
  const fresh = f.make("candidate", { updatedAt: Date.now() });
  const stale = f.make("candidate", { updatedAt: Date.now() - UNDECIDED_RETENTION_MS - 1000 });

  const out = sweep(f.db, { root: f.root });
  assert.equal(out.deleted, 1);
  assert.ok(existsSync(path.join(f.root, `${fresh}.mp4`)));
  assert.equal(existsSync(path.join(f.root, `${stale}.mp4`)), false);
});

test("an orphaned file — no row at all — is provably dead and goes", (t0) => {
  const f = sweepFixture(); t0.after(() => f.cleanupAll());
  const orphan = path.join(f.root, `${crypto.randomUUID()}.mp4`);
  writeFileSync(orphan, "x".repeat(500));
  assert.equal(sweep(f.db, { root: f.root }).deleted, 1);
  assert.equal(existsSync(orphan), false);
});

test("unrecognised filenames are counted and LEFT ALONE, never guessed at", (t0) => {
  const f = sweepFixture(); t0.after(() => f.cleanupAll());
  for (const name of ["notes.txt", "manifest.json", ".DS_Store"]) {
    writeFileSync(path.join(f.root, name), "x");
  }
  const out = sweep(f.db, { root: f.root });
  assert.equal(out.deleted, 0);
  assert.equal(out.unparseable, 3);
  for (const name of ["notes.txt", "manifest.json", ".DS_Store"]) {
    assert.ok(existsSync(path.join(f.root, name)), `${name} is somebody else's file`);
  }
});

test("the cap bounds one run, so a bug cannot empty the directory", (t0) => {
  const f = sweepFixture(); t0.after(() => f.cleanupAll());
  for (let i = 0; i < 5; i++) f.make("killed");
  const out = sweep(f.db, { root: f.root, cap: 2 });
  assert.equal(out.deleted, 2);
  assert.equal(out.skipped, 3);
  assert.equal(readdirSync(f.root).length, 3);
  assert.equal(SWEEP_CAP, 200);
});

test("a dry run reports exactly what it would do and deletes nothing", (t0) => {
  const f = sweepFixture(); t0.after(() => f.cleanupAll());
  const killed = f.make("killed");
  const out = sweep(f.db, { root: f.root, dryRun: true });
  assert.equal(out.deleted, 1);
  assert.ok(out.bytes > 0);
  assert.ok(existsSync(path.join(f.root, `${killed}.mp4`)), "dry run must not delete");
});

test("sweeping a directory that does not exist is a no-op, not a crash", (t0) => {
  const f = sweepFixture(); t0.after(() => f.cleanupAll());
  assert.deepEqual(sweep(f.db, { root: "/tmp/no-such-quarantine-xyz" }), { deleted: 0, bytes: 0, kept: 0, skipped: 0, unparseable: 0 });
});
