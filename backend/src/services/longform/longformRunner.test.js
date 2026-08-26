/**
 * longformRunner.test.js — the wiring (#78/#80).
 *
 * The engine is injected (`runEngine`), so the stage order and the on-disk
 * contract are tested without spawning ffmpeg or writing a real film.
 *
 * What matters here is what the runner is responsible for and the chain is
 * not: a project directory in the right place, the right files in it, the
 * engine steps in the right order, and NO node_modules symlink.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, lstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { scaffoldProject, writeProjectInputs, makeRenderStage } from "./longformRunner.js";

const root = () => mkdtempSync(path.join(os.tmpdir(), "runner-"));

const SCRIPT = { doc: { spine: { throughLine: "the ship" },
                        beats: [{ text: "One." }, { text: "Two." }] } };
const BOARD = { beats: { 1: { card: "statement", lines: ["X"] } }, shorts: [] };

// ── The project directory ───────────────────────────────────────────────────

test("a project is scaffolded with the directories the engine writes into", () => {
  const dir = scaffoldProject("strait", { root: root() });
  assert.ok(existsSync(path.join(dir, "out")));
  assert.ok(existsSync(path.join(dir, "out/footage")));
  assert.equal(JSON.parse(readFileSync(path.join(dir, "project.json"), "utf8")).slug, "strait");
});

test("NO node_modules SYMLINK IS CREATED", () => {
  // new-project.sh creates one, and it made sense when the engine lived under
  // .claude/. Since #76 the engine is inside backend/, so dep() resolves by
  // construction — and an absolute symlink is exactly what reached git once.
  const dir = scaffoldProject("strait", { root: root() });
  const entries = readdirSync(dir);
  assert.ok(!entries.includes("node_modules"), "the runner must not create a node_modules link");
  for (const e of entries) {
    assert.ok(!lstatSync(path.join(dir, e)).isSymbolicLink(), `${e} is a symlink — nothing here should be`);
  }
});

test("a directory with existing output is REFUSED, not silently reused", () => {
  // A half-finished render reused silently is worse than a clean failure: the
  // film would mix two runs' artifacts.
  const r = root();
  const dir = path.join(r, "strait");
  mkdirSync(path.join(dir, "out"), { recursive: true });
  writeFileSync(path.join(dir, "out/old.mp4"), "x");
  assert.throws(() => scaffoldProject("strait", { root: r }),
    /already has output — refusing to reuse a half-finished render/);
});

test("scaffolding requires a root — production puts these outside the deploy dir", () => {
  // A redeploy wipes /opt/scoopfeeds, and that trap already cost this project
  // its news.db once.
  assert.throws(() => scaffoldProject("s", {}), /root is required/);
  assert.throws(() => scaffoldProject("", { root: "/tmp" }), /slug is required/);
});

// ── Project inputs ──────────────────────────────────────────────────────────

test("THE STORYBOARD IS WRITTEN AS JSON, never as a module", () => {
  // The whole point of #77: the unattended path emits DATA, and no generated
  // code is executed — not even a shim that re-exports it.
  const dir = scaffoldProject("strait", { root: root() });
  writeProjectInputs({ dir, slug: "strait", title: "T", script: SCRIPT, board: BOARD });
  assert.ok(existsSync(path.join(dir, "storyboard.json")));
  assert.ok(!existsSync(path.join(dir, "storyboard.mjs")), "no generated module may be written");
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(dir, "storyboard.json"), "utf8")).beats["1"].lines, ["X"]);
});

test("beats.json is numbered from 1, in script order — narration reads it", () => {
  const dir = scaffoldProject("strait", { root: root() });
  writeProjectInputs({ dir, slug: "strait", title: "T", script: SCRIPT, board: BOARD });
  const beats = JSON.parse(readFileSync(path.join(dir, "beats.json"), "utf8"));
  assert.deepEqual(beats, [{ id: 1, text: "One." }, { id: 2, text: "Two." }]);
});

test("provenance is written where the disclosure chain reads it", () => {
  const dir = scaffoldProject("strait", { root: root() });
  writeProjectInputs({ dir, slug: "strait", title: "T", script: SCRIPT, board: BOARD,
                       licenses: "# Licences\n\n**None.**\n" });
  assert.match(readFileSync(path.join(dir, "out/footage/LICENSES.md"), "utf8"), /Licences/);
});

// ── The render stage ────────────────────────────────────────────────────────

test("the engine steps run in order: narrate → build → music → shorts", async () => {
  const dir = scaffoldProject("strait", { root: root() });
  const ran = [];
  const out = await makeRenderStage({ dir, runEngine: async (s) => { ran.push(s); return ""; } })({ slug: "strait" });
  assert.deepEqual(ran, ["narrate.mjs", "build.mjs", "music.mjs", "shorts.mjs"]);
  // THE SCORED FILM PUBLISHES. The unscored one is an intermediate, and
  // uploading it would ship a film with no music bed.
  assert.match(out.film, /strait-scored\.mp4$/);
  assert.match(out.srt, /strait\.srt$/);
});

test("shorts are discovered from disk, and their absence is visible", async () => {
  const dir = scaffoldProject("strait", { root: root() });
  const run = makeRenderStage({ dir, runEngine: async () => "" });
  assert.deepEqual((await run({ slug: "strait" })).shortFiles, [],
    "no shorts dir yields an empty list, which the QC gate then fails on");

  mkdirSync(path.join(dir, "out/shorts"), { recursive: true });
  for (const f of ["02_b.mp4", "01_a.mp4", "notes.txt"]) writeFileSync(path.join(dir, "out/shorts", f), "x");
  const files = (await run({ slug: "strait" })).shortFiles;
  assert.equal(files.length, 2, "only .mp4 files count");
  assert.match(files[0], /01_a\.mp4$/, "sorted, so the order is the film's order");
});

test("an engine step that fails propagates rather than continuing to the next", async () => {
  const dir = scaffoldProject("strait", { root: root() });
  await assert.rejects(
    () => makeRenderStage({ dir, runEngine: async (s) => {
      if (s === "build.mjs") throw new Error("ffmpeg died");
      return "";
    } })({ slug: "strait" }),
    /ffmpeg died/);
});
