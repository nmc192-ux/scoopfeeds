/**
 * pexelsEndpointGuard.test.js — one ban on the deprecated Pexels video path,
 * covering the whole backend.
 *
 * THE STRING THIS BANS
 *   https://api.pexels.com/videos/...     ← deprecated
 *   https://api.pexels.com/v1/videos/...  ← current
 *
 * Pexels' documentation carries the notice: "Video endpoints are now available
 * at https://api.pexels.com/v1/videos/. The https://api.pexels.com/videos/
 * endpoints will be deprecated in the future."
 *
 * WHY IT LIVES HERE, AND NOT WHERE IT STARTED. This ban was first written in
 * scripts/lib/stock/endpoints.test.mjs, and it had two holes that together let a
 * live occurrence sit in production code unnoticed:
 *
 *   1. It only scanned scripts/. The stale path was in
 *      src/services/longform/engine/footage-search.mjs, on the longform render
 *      path — the half of the repo the ban did not look at.
 *   2. It only ran under the stock-suite command. The standard backend run is
 *      `node --test "src/**\/*.test.js"`, which does not match a .test.mjs under
 *      scripts/ — so a session working in src/ would never have executed it even
 *      if it had scanned src/.
 *
 * Fixing one hole without the other would have left the guard reassuring and
 * useless, so it moved here: a .test.js under src/, inside the standard run,
 * scanning BOTH subtrees. It is a source-level string scan and imports none of
 * the modules it reads — a guard that had to load the longform engine to check
 * a URL would be a guard nobody could run cheaply.
 *
 * The asymmetry that produced the bug is worth remembering: Pexels' PHOTO
 * endpoints were always under /v1/, and the video endpoints moved there later.
 * Code written against older video examples keeps the pre-move path, and it sits
 * one line away from a photo call that looks correct.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Both halves of the backend that hold hand-written code. */
const SCANNED_SUBTREES = ["src", "scripts"];

const CODE_FILE = /\.(js|mjs|cjs)$/;
const DEPRECATED = /https?:\/\/api\.pexels\.com\/videos\//;

/**
 * Comments are stripped before scanning. Quoting the deprecation notice — as
 * footage-search.mjs and endpoints.mjs both do, so the next reader knows why the
 * path looks the way it does — must not trip a ban on USING it.
 * Same idiom as videoVoice.test.js's source check.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every hand-written code file under the scanned subtrees. */
function codeFiles() {
  const out = [];
  for (const subtree of SCANNED_SUBTREES) {
    const root = path.join(BACKEND_ROOT, subtree);
    let entries;
    try {
      entries = readdirSync(root, { recursive: true });
    } catch {
      continue; // a subtree that does not exist is not a failure
    }
    for (const rel of entries) {
      const abs = path.join(root, String(rel));
      if (!CODE_FILE.test(abs)) continue;
      if (abs.includes(`${path.sep}node_modules${path.sep}`)) continue;
      try {
        if (!statSync(abs).isFile()) continue;
      } catch {
        continue;
      }
      out.push(abs);
    }
  }
  return out;
}

test("the scan actually reads the backend — this ban is not vacuous", () => {
  // A ban over an empty file list passes forever. It must see both subtrees and
  // the specific file the deprecated path was found in.
  const files = codeFiles();
  assert.ok(files.length > 100, `only ${files.length} files scanned — the walk is broken`);

  const rel = files.map((f) => path.relative(BACKEND_ROOT, f));
  assert.ok(rel.some((f) => f.startsWith(`src${path.sep}`)), "src/ must be scanned — it is where the live occurrence was");
  assert.ok(rel.some((f) => f.startsWith(`scripts${path.sep}`)), "scripts/ must still be scanned");
  assert.ok(
    rel.includes(path.join("src", "services", "longform", "engine", "footage-search.mjs")),
    "the file that carried the deprecated path must be in the scan"
  );
});

test("no backend code calls the deprecated Pexels video endpoint", () => {
  const offenders = [];
  for (const file of codeFiles()) {
    if (/\.test\.(js|mjs|cjs)$/.test(file)) continue; // tests name the string to ban it
    const lines = stripComments(readFileSync(file, "utf8")).split("\n");
    lines.forEach((line, i) => {
      if (DEPRECATED.test(line)) {
        offenders.push(`  ${path.relative(BACKEND_ROOT, file)}:${i + 1}`);
      }
    });
  }

  assert.deepEqual(
    offenders, [],
    "the DEPRECATED Pexels video endpoint is used at:\n" +
      offenders.join("\n") +
      "\n\n  Replace  https://api.pexels.com/videos/" +
      "\n  with     https://api.pexels.com/v1/videos/" +
      "\n\nPexels' docs: \"Video endpoints are now available at " +
      "https://api.pexels.com/v1/videos/. The https://api.pexels.com/videos/ endpoints will be " +
      "deprecated in the future.\" (https://www.pexels.com/api/documentation/)\n" +
      "Note the asymmetry that causes this: PHOTO endpoints were always /v1/, so a photo call " +
      "on a neighbouring line looks right while the video call is stale.\n" +
      "The old path still answers today, so nothing will appear broken — which is why this is a " +
      "test and not an incident."
  );
});

test("the current path is the one production code actually uses", () => {
  // The ban above only proves the wrong string is absent. This proves the right
  // one is present, so deleting the call entirely cannot satisfy the guard.
  const footageSearch = path.join(BACKEND_ROOT, "src/services/longform/engine/footage-search.mjs");
  const src = stripComments(readFileSync(footageSearch, "utf8"));
  assert.match(src, /https:\/\/api\.pexels\.com\/v1\/videos\/search/,
    "footage-search.mjs must call the /v1/ video search endpoint");
  assert.match(src, /https:\/\/api\.pexels\.com\/v1\/search/,
    "and its photo search, which was always /v1/, must be unchanged");
});
