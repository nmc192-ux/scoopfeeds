#!/usr/bin/env node
/**
 * stock-curate.mjs — record the human keep/reject decision (brief §8).
 *
 * ANSWERING Q3 (review-tool shape): the brief offers a manifest-editing CLI or a
 * generated review HTML and says to pick the smaller one. This is the CLI, and it
 * is smaller by a wide margin — the HTML would need a page generator, a writeback
 * channel and a local server to carry the decision back, where this is a list of
 * ids. QuickLook over the staging folder is already a better clip viewer than
 * anything worth building here, which is exactly what §8.2 assumes.
 *
 * The judgement itself stays human and is not automatable: whether the subject
 * survives a 9:16 centre crop, whether the clip illustrates the SUBJECT rather
 * than the EVENT, and whether it carries an unnamed face standing in for real
 * people. The gate in stock-acquire stops at resolution and duration.
 *
 * A rejected asset KEEPS its manifest row so re-acquisition never re-downloads it
 * (§8.4); only the file is deleted.
 *
 * USAGE
 *   node scripts/stock-curate.mjs --list
 *   node scripts/stock-curate.mjs --keep ports-0001,ports-0003 --reject ports-0002
 */

import "../src/config/env.js";
import { existsSync, unlinkSync } from "fs";
import path from "path";
import { LIBRARY_ROOT, readManifest, writeManifest } from "./lib/stock/manifest.mjs";

function die(msg, code = 1) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { keep: [], reject: [], list: false };
  const list = (raw, flag) => {
    const parts = String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) die(`${flag} needs a comma-separated list of asset ids (got "${raw}")`);
    return parts;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") out.list = true;
    else if (a === "--keep") out.keep = list(argv[++i], "--keep");
    else if (a.startsWith("--keep=")) out.keep = list(a.slice(7), "--keep");
    else if (a === "--reject") out.reject = list(argv[++i], "--reject");
    else if (a.startsWith("--reject=")) out.reject = list(a.slice(9), "--reject");
    else die(`unknown flag: ${a}\nSupported: --keep ids  --reject ids  --list`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const manifest = readManifest();

if (args.list || (!args.keep.length && !args.reject.length)) {
  const staged = manifest.filter((e) => e.status === "staged");
  console.log(`\n📋 ${staged.length} staged asset(s) awaiting a decision (of ${manifest.length} in the library)\n`);
  for (const e of staged) {
    console.log(`  ${e.id.padEnd(18)} ${e.cropGrade.padEnd(15)} ${e.width}×${e.height} ${e.durationSec}s  ${e.provider}`);
    console.log(`  ${" ".repeat(18)} ${path.join(LIBRARY_ROOT, e.filePath)}`);
  }
  if (!staged.length) console.log("  (none)");
  console.log("\nMark them:  node scripts/stock-curate.mjs --keep <ids> --reject <ids>\n");
  process.exit(0);
}

const overlap = args.keep.filter((id) => args.reject.includes(id));
if (overlap.length) die(`these ids are in both --keep and --reject: ${overlap.join(", ")}`);

const byId = new Map(manifest.map((e) => [e.id, e]));
const unknown = [...args.keep, ...args.reject].filter((id) => !byId.has(id));
if (unknown.length) die(`unknown asset id(s): ${unknown.join(", ")}\nRun --list to see what is staged.`);

let kept = 0;
let rejected = 0;
const deleted = [];

for (const id of args.keep) {
  byId.get(id).status = "kept";
  kept++;
}

for (const id of args.reject) {
  const entry = byId.get(id);
  entry.status = "rejected";
  rejected++;
  // The row survives — it is what stops re-acquire re-downloading this clip (§8.4).
  const abs = path.join(LIBRARY_ROOT, entry.filePath);
  if (existsSync(abs)) {
    unlinkSync(abs);
    deleted.push(entry.filePath);
  }
  if (entry.treatedPath) {
    const treatedAbs = path.join(LIBRARY_ROOT, entry.treatedPath);
    if (existsSync(treatedAbs)) unlinkSync(treatedAbs);
    entry.treatedPath = null;
  }
}

writeManifest(manifest);

console.log(`\n✅ ${kept} kept, ${rejected} rejected`);
if (deleted.length) console.log(`   ${deleted.length} file(s) deleted; their manifest rows remain so re-acquire skips them.`);
console.log(`\nNext: node scripts/stock-treat.mjs\n`);
