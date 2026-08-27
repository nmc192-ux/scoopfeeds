/**
 * stockLibraryBoundary.test.js — the stock-library tooling is NOT part of the runtime.
 *
 * WHY THIS FILE LIVES HERE, away from the code it guards. The tooling it protects
 * is under backend/scripts/, and tests live beside their source in this repo. But
 * the standard backend run is `node --test "src/**\/*.test.js"`, so a guard under
 * scripts/ would only ever run when someone remembered to run it — and a boundary
 * nobody checks is not a boundary. The precedent is
 * services/longform/deployment.test.js, which sits in the standard run for the
 * same reason: it pins a path contract that a change elsewhere silently breaks.
 *
 * WHAT IT ASSERTS (brief docs/briefs/stock-library-builder.md §2c). Nothing in
 * server.js, schedulerProcess.js, workerProcess.js, any queue handler or any
 * render-path module may import the stock-library scripts, directly or
 * transitively. Those scripts download foreign media from third-party APIs using
 * Mac-local keys that are deliberately absent from production (§2d), and they run
 * on the Mac only (§2e). The moment one becomes reachable from a process that
 * boots on the VPS, both of those properties quietly stop being true.
 *
 * A NEGATIVE GUARD CAN PASS FOR THE WRONG REASON, which is the trap this file is
 * written around: if the import walker below silently resolves nothing, the
 * reachable set is empty and "the tooling is not in it" is trivially satisfied.
 * So the walker is checked against a POSITIVE CONTROL first — a module known to
 * be reachable — and the test fails if the walk looks implausibly small.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const PROCESS_ENTRY_POINTS = [
  "server.js",                      // web
  "src/jobs/schedulerProcess.js",   // scheduler
  "src/jobs/workerProcess.js",      // worker
];

/**
 * A module known to be reachable, used to prove the walker works at all.
 * workerProcess.js calls sweepAtStartup() from this module; services/videoArtifacts.test.js
 * is the guard that keeps that wiring in place.
 */
const POSITIVE_CONTROL = "src/services/videoArtifacts.js";

/**
 * Resolve a relative specifier the way Node would, well enough for this walk:
 * as written, then with .js/.mjs appended, then as a directory index.
 * The precedent walker in videoArtifacts.test.js uses the specifier literally,
 * which is fine for a positive guard — an unresolved path just prunes a branch.
 * For a NEGATIVE guard an unresolved path is a false pass, so it is resolved here.
 */
function resolveSpecifier(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier.split("?")[0]);
  const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`,
    path.join(base, "index.js"), path.join(base, "index.mjs")];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/**
 * Every module reachable from `entry` by relative import, transitively.
 *
 * Covers more import forms than the precedent walker deliberately: a side-effect
 * import (`import "./env.js"`) and a `require("./x.js")` are both real edges that
 * a `from`-only regex misses, and either could carry the tooling in unseen.
 */
function reachableFrom(entry) {
  const seen = new Set();
  const unresolved = [];
  const queue = [path.resolve(BACKEND_ROOT, entry)];

  const EDGE = new RegExp(
    [
      /(?:^|[^.\w])(?:import|export)\s+[^;'"]*?from\s*["'](\.[^"']+)["']/.source, // import x from "./y"
      /(?:^|[^.\w])import\s*\(\s*["'](\.[^"']+)["']/.source,                       // import("./y")
      /(?:^|[^.\w])import\s*["'](\.[^"']+)["']/.source,                            // import "./y"
      /(?:^|[^.\w])require\s*\(\s*["'](\.[^"']+)["']/.source,                      // require("./y")
    ].join("|"),
    "g"
  );

  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let src;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const m of src.matchAll(EDGE)) {
      const specifier = m[1] || m[2] || m[3] || m[4];
      if (!specifier) continue;
      const resolved = resolveSpecifier(file, specifier);
      if (resolved) queue.push(resolved);
      else unresolved.push(`${path.relative(BACKEND_ROOT, file)} → ${specifier}`);
    }
  }
  return { seen, unresolved };
}

/** Is this file part of the stock-library tooling? */
function isStockTooling(absPath) {
  const rel = path.relative(BACKEND_ROOT, absPath);
  return rel.startsWith(path.join("scripts", "lib", "stock")) ||
    /^scripts[/\\]stock-[\w-]+\.mjs$/.test(rel);
}

// ─── The walker has to work before its silence means anything ───────────────

test("the import walker actually reaches things — the guard below is not vacuous", () => {
  const all = new Set();
  for (const entry of PROCESS_ENTRY_POINTS) {
    for (const f of reachableFrom(entry).seen) all.add(f);
  }

  assert.ok(
    all.has(path.resolve(BACKEND_ROOT, POSITIVE_CONTROL)),
    `the walker did not reach ${POSITIVE_CONTROL}, which workerProcess.js definitely imports. ` +
      "The walk is broken, so the non-reachability assertion below would pass for the wrong reason. " +
      "Fix the walker before trusting this file."
  );
  assert.ok(
    all.size > 50,
    `the walk found only ${all.size} modules across three process entry points, which is implausibly ` +
      "few. Something is pruning the graph, and a negative guard over a pruned graph proves nothing."
  );
});

// ─── The boundary itself ────────────────────────────────────────────────────

test("no process entry point reaches the stock-library tooling", () => {
  const offenders = [];
  for (const entry of PROCESS_ENTRY_POINTS) {
    for (const file of reachableFrom(entry).seen) {
      if (isStockTooling(file)) {
        offenders.push(`${entry} → ${path.relative(BACKEND_ROOT, file)}`);
      }
    }
  }

  assert.deepEqual(
    offenders, [],
    "the stock-library acquisition tooling is reachable from a process that runs in production:\n" +
      offenders.map((o) => `  ${o}`).join("\n") +
      "\n\nThat tooling downloads foreign media from third-party APIs using keys that are Mac-local by " +
      "design (brief §2d) and absent from the VPS, and it is meant to run on the Mac only (§2e). Wiring it " +
      "into the runtime puts an acquisition path — and the expectation of those keys — on the server. " +
      "Import the library FROM the scripts, never the scripts from the runtime. (If a fourth process was " +
      "added, add its entry point to PROCESS_ENTRY_POINTS above.)"
  );
});

test("no runtime module so much as names the stock scripts", () => {
  // Defence in depth against an edge the walker cannot see: a dynamic import
  // built from a variable, a spawn of `node scripts/stock-acquire.mjs`, a config
  // string. None of these is an import edge, and all of them would reintroduce
  // the acquisition path the test above exists to keep out.
  const mentions = [];
  for (const entry of PROCESS_ENTRY_POINTS) {
    for (const file of reachableFrom(entry).seen) {
      if (file.endsWith(".test.js") || file.endsWith(".test.mjs")) continue;
      const src = readFileSync(file, "utf8");
      if (/stock-acquire|stock-treat|stock-curate|scripts\/lib\/stock/.test(src)) {
        mentions.push(path.relative(BACKEND_ROOT, file));
      }
    }
  }
  assert.deepEqual(mentions, [],
    `these runtime modules name the stock tooling: ${mentions.join(", ")}. Even a string is a route back in.`);
});

test("the tooling being guarded actually exists — this guard cannot be retired by deletion", () => {
  // If the scripts are renamed or moved, the two tests above start passing for a
  // reason that has nothing to do with the boundary holding.
  for (const f of ["scripts/stock-acquire.mjs", "scripts/stock-treat.mjs", "scripts/stock-curate.mjs",
    "scripts/lib/stock/providers.mjs", "scripts/lib/stock/endpoints.mjs"]) {
    assert.ok(existsSync(path.resolve(BACKEND_ROOT, f)), `${f} is missing — update this guard to match.`);
  }
});
