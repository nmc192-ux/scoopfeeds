/**
 * projectDisclosures.test.js — the disclosure gate, run over REAL projects (#79).
 *
 * The unit tests in longformQcGate.test.js use synthetic fixtures. This file
 * points the same gate at every project that actually shipped, because the
 * failure this guards against is not hypothetical: on first contact with real
 * data it found that `bundibugyo` declared `isAigc: true` to TikTok while its
 * own LICENSES.md states "AI-generated imagery: None." and publish.json sets
 * syntheticContent false — a film telling a platform it contains synthetic
 * media that it does not contain.
 *
 * That is the CONVERSE error, the half the shipped publish-time gate never
 * checked. Keeping this test means any project whose four disclosure surfaces
 * disagree fails the suite before it can be published or re-published.
 *
 * Skips cleanly when the skill's projects directory is absent (it lives under
 * .claude/, which is excluded from the production image).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { disclosureFailures } from "./longformQcGate.js";

const PROJECTS = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../.claude/skills/video-factory/projects");

const readJson = (f) => {
  try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; } catch { return null; }
};

test("every shipped project's disclosure surfaces agree with each other", (t) => {
  if (!existsSync(PROJECTS)) return t.skip(`projects dir absent: ${PROJECTS}`);

  const problems = [];
  let checked = 0;

  for (const slug of readdirSync(PROJECTS)) {
    const dir = path.join(PROJECTS, slug);
    const publishJson = readJson(path.join(dir, "publish.json"));
    if (!publishJson) continue;               // not a complete project

    // LICENSES.md is written into out/ during a build and copied to data/ for
    // the record; accept either.
    const licPaths = [path.join(dir, "data/LICENSES.md"), path.join(dir, "out/footage/LICENSES.md")];
    const licPath = licPaths.find(existsSync);
    if (!licPath) continue;

    checked++;
    const fails = disclosureFailures({
      licensesText: readFileSync(licPath, "utf8"),
      publishJson,
      tiktokJson: readJson(path.join(dir, "tiktok.json")),
    });
    for (const f of fails) problems.push(`${slug}: ${f}`);
  }

  assert.ok(checked > 0, "no complete project was checked — the fixture path is probably wrong");
  assert.deepEqual(problems, [],
    `a shipped project makes inconsistent AI-provenance disclosures:\n  ${problems.join("\n  ")}`);
});
