#!/usr/bin/env node
/**
 * stock-treat.mjs — grade kept assets into the house palette (brief §3b).
 *
 * Runs over manifest entries with status "kept" and writes a graded rendition,
 * DOWNSCALED TO 1080x1920, alongside the original. The 2160x3840 master in
 * staging/ is NEVER overwritten: it is the re-treat source, and the only reason
 * writing a smaller treated file is a safe one-way change.
 *
 * Idempotent — an entry that already has a treatedPath on disk is skipped unless
 * --only names it (one asset) or --retreat is given (everything). Neither is
 * automatic: see the note above `candidates` for why a settings change must not
 * invalidate the library by itself.
 *
 * GRAIN IS OFF BY DEFAULT. Grain baked in here is re-encoded again at assembly,
 * so the library holds grade-only masters and grain stays a render-time
 * decision. --grain static14 exists for measuring that choice, not for routine use.
 *
 * USAGE
 *   node scripts/stock-treat.mjs
 *   node scripts/stock-treat.mjs --only ports-0003
 *   node scripts/stock-treat.mjs --retreat          # re-encode the whole library
 *   node scripts/stock-treat.mjs --grain static14
 */

import "../src/config/env.js";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { LIBRARY_ROOT, readManifest, TREATED_DIR, writeManifest } from "./lib/stock/manifest.mjs";
import { DELIVERY, GRAIN_CHAINS, LIBRARY_CRF, LIBRARY_GRADE, resolveFfmpeg, treatFile } from "./lib/stock/treat.mjs";

function die(msg, code = 1) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { only: null, grain: "none", retreat: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only") out.only = argv[++i] ?? die("--only needs an asset id");
    else if (a.startsWith("--only=")) out.only = a.slice(7);
    else if (a === "--retreat") out.retreat = true;
    else if (a === "--grain") out.grain = argv[++i] ?? die("--grain needs a value");
    else if (a.startsWith("--grain=")) out.grain = a.slice(8);
    else die(`unknown flag: ${a}\nSupported: --only <assetId>  --retreat  --grain ${Object.keys(GRAIN_CHAINS).join("|")}`);
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
/**
 * --retreat re-encodes everything already treated, from its untouched master.
 *
 * It is EXPLICIT and never automatic. Invalidating on a settings change would
 * mean a future tweak to the grade or the crf silently re-encoded the whole
 * library the next time anyone ran this — hours of work nobody asked for, and
 * a set of files that no longer match what was reviewed. The tool stays
 * idempotent; the operator says when a re-treat is wanted.
 */
const candidates = manifest.filter((e) => {
  if (args.only) return e.id === args.only;
  if (args.retreat) return e.status === "treated" || e.status === "kept";
  return e.status === "kept";
});
const alreadyTreated = manifest.filter((e) => e.status === "treated").length;

if (args.only && !candidates.length) die(`no manifest entry with id "${args.only}"`);

console.log(`\n🎨 stock-treat — ${candidates.length} asset(s), grain: ${args.grain}`);
console.log(`   ffmpeg: ${ffmpegPath}`);
console.log(`   grade:  ${LIBRARY_GRADE}`);
console.log(`   output: ${DELIVERY.width}x${DELIVERY.height} @ crf ${LIBRARY_CRF}${args.retreat ? "  (RE-TREAT: every treated asset is re-encoded from its master)" : ""}\n`);

mkdirSync(path.join(LIBRARY_ROOT, TREATED_DIR), { recursive: true });

let treated = 0;
let skipped = 0;
let failed = 0;
let totalBytes = 0;

for (const entry of candidates) {
  const rel = path.join(TREATED_DIR, `${entry.id}.mp4`);
  const abs = path.join(LIBRARY_ROOT, rel);
  const sourceAbs = path.join(LIBRARY_ROOT, entry.filePath);

  // Idempotent: --only and --retreat re-treat deliberately, a bulk run does not.
  if (!args.only && !args.retreat && entry.treatedPath && existsSync(abs)) {
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
    const { bytes } = await treatFile({
      sourcePath: sourceAbs, outputPath: abs, grain: args.grain, ffmpegPath,
      // The manifest already records what the provider served, so the aspect
      // check costs no probe. A non-portrait asset stops rather than stretching.
      sourceWidth: entry.width, sourceHeight: entry.height,
    });
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
  console.log("   Re-treat one with --only <assetId>, or the whole library with --retreat.");
}
if (failed) {
  console.log("   Failures are reported, not swallowed: nothing was marked treated that did not produce a file.");
  process.exit(1);
}
console.log("");
