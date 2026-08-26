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

import { scaffoldProject, writeProjectInputs, makeRenderStage, synthesizeTitleSegment } from "./longformRunner.js";

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

// ── the title segment, synthesized mechanically ──────────────────────────────
// build.mjs refuses a storyboard without TITLE_SEGMENT, and the first real
// render found that out after narration was paid for. The card is mechanical:
// the film's title and the spine's question, no model prose.

test("synthesizeTitleSegment: every word of the title survives, in at most three lines", () => {
  const title = "AI Firms Debate Putting Cyber Tests Online After Model Hacks";
  const t = synthesizeTitleSegment({ title, spine: { question: "Who decides?" } });
  assert.equal(t.spec.card, "title");
  assert.ok(t.spec.lines.length <= 3, "three lines maximum");
  assert.equal(t.spec.lines.join(" "), title.toUpperCase(),
    "a truncated title is not a title — the wrap widens instead of dropping words");
  assert.equal(t.spec.sub, "Who decides?", "the sub is the spine's question");
});

test("synthesizeTitleSegment: no question means no sub, not an empty one", () => {
  const t = synthesizeTitleSegment({ title: "Short Title" });
  assert.equal(t.spec.sub, undefined);
  assert.deepEqual(t.spec.lines, ["SHORT TITLE"]);
});

test("writeProjectInputs: a storyboard without a titleSegment gets the mechanical one; one with keeps its own", () => {
  const dir = scaffoldProject("strait", { root: root() });
  writeProjectInputs({ dir, slug: "strait", title: "The Strait", script: SCRIPT, board: BOARD });
  const w = JSON.parse(readFileSync(path.join(dir, "storyboard.json"), "utf8"));
  assert.ok(w.titleSegment?.spec?.lines?.length, "synthesized when absent");
  assert.equal(w.titleSegment.spec.lines.join(" "), "THE STRAIT");

  const authored = { after: 5, seconds: 3.2, spec: { card: "title", lines: ["OWN"] } };
  writeProjectInputs({ dir, slug: "strait", title: "The Strait", script: SCRIPT,
    board: { ...BOARD, titleSegment: authored } });
  const w2 = JSON.parse(readFileSync(path.join(dir, "storyboard.json"), "utf8"));
  assert.deepEqual(w2.titleSegment, authored, "an authored title segment is never overwritten");
});

test("writeProjectInputs: shorts reach the engine as shorts.json, index-prefixed so sorted files match storyboard order", () => {
  const dir = scaffoldProject("strait", { root: root() });
  writeProjectInputs({ dir, slug: "strait", title: "T", script: SCRIPT,
    board: { ...BOARD, shorts: [
      { name: "The Svetofor Slip", from: 1, to: 4, title: "A", hook: "h" },
      { name: "Moral Red Line", from: 17, to: 22, title: "B", hook: "h" },
    ] } });
  const shorts = JSON.parse(readFileSync(path.join(dir, "shorts.json"), "utf8"));
  assert.deepEqual(shorts.map((s) => s.name), ["01_the-svetofor-slip", "02_moral-red-line"],
    "display names sort alphabetically, not in film order — the index prefix is what keeps " +
    "the publish plan's sorted-filename zip attached to the right titles");
  assert.equal(shorts[1].to, 22, "the cut range survives the rename");
});
