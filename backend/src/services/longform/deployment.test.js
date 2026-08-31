/**
 * deployment.test.js — the long-form engine's deployment contract (#76).
 *
 * Named .test.js (not .mjs) ON PURPOSE: backend/package.json sets
 * "type": "module", so this is still ESM, and it is picked up by the repo's
 * standard `node --test "src/**\/*.test.js"` run. The engine had no presence
 * in that suite at all before the move — this is the file that gives it one.
 *
 * WHY THIS FILE EXISTS. The engine was relocated from
 * `.claude/skills/video-factory/engine` into the backend so it would ship in
 * the production image. `_deps.mjs` derived every path by counting levels to
 * the repo root, so the move silently repointed all of them, and the first
 * symptom was `cannot resolve "@ffmpeg-installer/ffmpeg"` — which reads as a
 * missing dependency, not a relocation. Nothing in any suite caught it.
 *
 * Each assertion below pins one link of the chain that broke:
 *   BACKEND resolves → node_modules resolves → ASSETS resolves → fonts load
 *   → satori+resvg actually render → project dirs honour the persistent dir.
 *
 * A future move inside the backend should fail HERE, loudly, naming the path.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const ENGINE = "./engine";

test("BACKEND and REPO_ROOT resolve to the real directories", async () => {
  const { BACKEND, REPO_ROOT } = await import(`${ENGINE}/_deps.mjs`);
  assert.ok(existsSync(path.join(BACKEND, "package.json")),
    `BACKEND does not point at the backend (got ${BACKEND})`);
  assert.equal(JSON.parse(readFileSync(path.join(BACKEND, "package.json"), "utf8")).type, "module");
  assert.ok(existsSync(path.join(REPO_ROOT, "Dockerfile")),
    `REPO_ROOT does not point at the repo root (got ${REPO_ROOT})`);
  // No developer's home directory may be baked in — the regression that made
  // the engine work on exactly one machine at exactly one path.
  //
  // CHECK THE SOURCE, NOT THE RUNTIME VALUE. A correctly DERIVED path contains
  // the home directory whenever the repo lives under one, so asserting on
  // `BACKEND` itself passed only because this first ran from a worktree in
  // /private/tmp — a location-dependent test that would have gone on hiding
  // the very thing it was written to catch.
  const depsSrc = readFileSync(new URL(`${ENGINE}/_deps.mjs`, import.meta.url), "utf8");
  const hardcoded = depsSrc.match(/["'`]\/(?:Users|home)\/[^"'`\n]+/g);
  assert.equal(hardcoded, null,
    `a hardcoded absolute home path is baked into _deps.mjs: ${hardcoded?.join(", ")}`);
});

test("dep() resolves the render toolchain from the engine's new home", async () => {
  const { dep, ffmpegPath } = await import(`${ENGINE}/_deps.mjs`);
  assert.ok(existsSync(ffmpegPath), `bundled ffmpeg not resolvable at ${ffmpegPath}`);
  assert.ok(dep("satori"), "satori not resolvable");
  assert.ok(dep("@resvg/resvg-js"), "resvg not resolvable");
});

test("ASSETS points at backend/assets, and the fonts are really there", async () => {
  const { ASSETS, BACKEND } = await import(`${ENGINE}/_deps.mjs`);
  assert.equal(path.resolve(ASSETS), path.resolve(path.join(BACKEND, "assets")),
    "ASSETS must live under backend/ so it ships in the image");
  for (const f of ["Anton-Regular.ttf", "Inter-Bold.otf", "Inter-SemiBold.otf"]) {
    assert.ok(existsSync(path.join(ASSETS, "fonts", f)), `missing font ${f} — cards cannot render`);
  }
});

test("a card actually renders headless from the new location", async () => {
  // The end-to-end proof: satori + resvg + fonts + paths, all at once. If this
  // passes, the engine can render inside the production image.
  const { renderCard } = await import(`${ENGINE}/render.mjs`);
  const out = path.join(mkdtempSync(path.join(os.tmpdir(), "deploy-")), "card.png");
  await renderCard({ card: "stat", kicker: "DEPLOYMENT", figure: "1", unit: "OK",
    label: "The engine renders from inside the backend." }, out, 1.0);
  assert.ok(existsSync(out));
  const png = readFileSync(out);
  assert.ok(png.length > 5000, `PNG suspiciously small (${png.length} bytes)`);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG", "not a PNG");
});

test("project working directories honour SCOOP_PERSISTENT_DATA_DIR", async () => {
  // In production this MUST resolve outside the deploy directory: a redeploy
  // wipes /opt/scoopfeeds, and that trap already cost this project its news.db
  // once (docs/reference/env_reference.md).
  const prev = process.env.SCOOP_PERSISTENT_DATA_DIR;
  process.env.SCOOP_PERSISTENT_DATA_DIR = "/var/lib/scoop";
  try {
    const mod = await import(`${ENGINE}/_deps.mjs?persist=${Math.random().toString(36).slice(2)}`);
    assert.equal(mod.projectDir("hormuz-strait"), "/var/lib/scoop/longform/hormuz-strait");
    assert.ok(!mod.projectDir("x").startsWith("/opt/scoopfeeds"),
      "project dirs must never sit inside the deploy directory");
  } finally {
    if (prev === undefined) delete process.env.SCOOP_PERSISTENT_DATA_DIR;
    else process.env.SCOOP_PERSISTENT_DATA_DIR = prev;
  }
});

test("new-project.sh scaffolds a working project from the engine's new home", () => {
  // THE SHELL SCRIPT HAS ITS OWN PATH DERIVATION, and the relocation broke it
  // exactly as it broke _deps.mjs — but nothing here looked at it, so it stayed
  // broken. It counted four levels up to the REPO ROOT, which from
  // backend/src/services/longform/engine lands on backend/, making BACKEND
  // backend/backend and SKILL the longform service directory. Every template
  // copy then pointed at a path that does not exist.
  //
  // Asserting on the script's TEXT would only pin today's spelling. Running it
  // pins the thing that matters: the symlinks resolve and the templates arrive.
  const dir = mkdtempSync(path.join(os.tmpdir(), "newproj-"));
  const script = new URL(`${ENGINE}/new-project.sh`, import.meta.url).pathname;
  // A RELATIVE parent, deliberately: $DIR is handed to require() by the
  // script's own toolchain check, and require() reads a bare relative path as
  // a module name, so this used to fail its own verification after scaffolding
  // correctly. cwd is the temp dir, so "." exercises that path.
  execFileSync("bash", [script, "demo-slug", "."], { cwd: dir, encoding: "utf8" });

  const proj = path.join(dir, "demo-slug");
  assert.ok(existsSync(path.join(proj, "node_modules", "satori")),
    "the node_modules symlink does not reach the backend's toolchain");
  assert.ok(existsSync(path.join(proj, "fonts", "Anton-Regular.ttf")),
    "the fonts symlink does not reach the skill's assets");
  for (const f of ["storyboard.mjs", "script.md"]) {
    assert.ok(readFileSync(path.join(proj, f), "utf8").length > 500,
      `${f} was not copied from the skill's template — SKILL is pointing at the wrong directory`);
  }
});

test("source screenshots fail loudly when Chromium is absent, never silently", async () => {
  // v1 decision: Chromium is NOT in the production image (~400 MB + CVE
  // surface for one card type). The contract is that capture-measured refuses
  // rather than emitting an empty rects.json — a doc card rendering with no
  // highlights is exactly what the measured-rects design exists to prevent.
  const src = readFileSync(new URL(`${ENGINE}/capture-measured.mjs`, import.meta.url), "utf8");
  assert.match(src, /existsSync\(PLAYWRIGHT\)/, "no guard on Playwright's presence");
  assert.match(src, /throw new Error/, "the guard must throw, not warn");
  const guard = src.slice(src.indexOf("if (!existsSync(PLAYWRIGHT))"));
  assert.match(guard.slice(0, 600), /LOCAL-ONLY|local-only/i,
    "the error must say the step is local-only, so the reader knows it is a decision");
});
