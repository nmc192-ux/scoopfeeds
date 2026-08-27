#!/usr/bin/env node
/**
 * stock-treat.mjs — grade kept assets into the house palette (brief §3b).
 *
 * Runs over manifest entries with status "kept" and writes a graded rendition
 * alongside the original. The source download is NEVER overwritten: a bad grade
 * must be re-runnable without re-acquiring, and the provider clip is the only
 * copy of the untreated original we hold.
 *
 * Idempotent — an entry that already has a treatedPath on disk is skipped unless
 * --only names it, which is the escape hatch for re-treating a single asset after
 * a grade change.
 *
 * GRAIN IS OFF BY DEFAULT (Q1). Grain baked in here is re-encoded again at
 * assembly, so the library holds grade-only masters and grain stays a render-time
 * decision. --grain static14 exists for measuring that choice, not for routine use.
 *
 * USAGE
 *   node scripts/stock-treat.mjs
 *   node scripts/stock-treat.mjs --only ports-0003
 *   node scripts/stock-treat.mjs --grain static14
 */

import "../src/config/env.js";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { LIBRARY_ROOT, readManifest, TREATED_DIR, writeManifest } from "./lib/stock/manifest.mjs";
import { GRAIN_CHAINS, LIBRARY_GRADE, resolveFfmpeg, treatFile } from "./lib/stock/treat.mjs";

function die(msg, code = 1) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { only: null, grain: "none" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only") out.only = argv[++i] ?? die("--only needs an asset id");
    else if (a.startsWith("--only=")) out.only = a.slice(7);
    else if (a === "--grain") out.grain = argv[++i] ?? die("--grain needs a value");
    else if (a.startsWith("--grain=")) out.grain = a.slice(8);
    else die(`unknown flag: ${a}\nSupported: --only <assetId>  --grain ${Object.keys(GRAIN_CHAINS).join("|")}`);
  }
  if (!(out.grain in GRAIN_CHAINS)) {
    die(`--grain must be one of: ${Object.keys(GRAIN_CHAINS).join(", ")} (got "${out.grain}")`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const ffmpegPath = resolveFfmpeg();
if (!ffmpegPath) {
  die("no ffmpeg found. Set FFMPEG_PATH, install ffmpeg on PATH, or run npm ci in backend/ " +
    "(@ffmpeg-installer/ffmpeg is already a dependency). Brief §10 asks that the Mac's ffmpeg be current.", 2);
}

const manifest = readManifest();
const candidates = manifest.filter((e) => (args.only ? e.id === args.only : e.status === "kept"));
const alreadyTreated = manifest.filter((e) => e.status === "treated").length;

if (args.only && !candidates.length) die(`no manifest entry with id "${args.only}"`);

console.log(`\n🎨 stock-treat — ${candidates.length} asset(s), grain: ${args.grain}`);
console.log(`   ffmpeg: ${ffmpegPath}`);
console.log(`   grade:  ${LIBRARY_GRADE}\n`);

mkdirSync(path.join(LIBRARY_ROOT, TREATED_DIR), { recursive: true });

let treated = 0;
let skipped = 0;
let failed = 0;
let totalBytes = 0;

for (const entry of candidates) {
  const rel = path.join(TREATED_DIR, `${entry.id}.mp4`);
  const abs = path.join(LIBRARY_ROOT, rel);
  const sourceAbs = path.join(LIBRARY_ROOT, entry.filePath);

  // Idempotent: an --only run re-treats deliberately, a bulk run does not.
  if (!args.only && entry.treatedPath && existsSync(abs)) {
    console.log(`  ${entry.id.padEnd(18)} already treated — skipping`);
    skipped++;
    continue;
  }

  if (!existsSync(sourceAbs)) {
    console.log(`  ${entry.id.padEnd(18)} ❌ source missing: ${entry.filePath}`);
    failed++;
    continue;
  }

  try {
    const { bytes } = await treatFile({ sourcePath: sourceAbs, outputPath: abs, grain: args.grain, ffmpegPath });
    entry.treatedPath = rel;
    entry.status = "treated";
    totalBytes += bytes;
    treated++;
    writeManifest(manifest);
    console.log(`  ${entry.id.padEnd(18)} ✅ ${rel} (${(bytes / 1e6).toFixed(1)} MB)`);
  } catch (e) {
    console.log(`  ${entry.id.padEnd(18)} ❌ ${e.message}`);
    failed++;
  }
}

console.log("\n" + "─".repeat(72));
console.log(`✅ ${treated} treated, ${skipped} skipped, ${failed} failed — ${(totalBytes / 1e6).toFixed(1)} MB written`);
if (!candidates.length && alreadyTreated) {
  // Otherwise a re-run reads as "nothing happened" when it means "nothing left to do".
  console.log(`   Nothing was waiting: ${alreadyTreated} asset(s) in the library are already treated.`);
  console.log(`   Re-treat one with --only <assetId>.`);
}
if (failed) {
  console.log("   Failures are reported, not swallowed: nothing was marked treated that did not produce a file.");
  process.exit(1);
}
console.log("");
