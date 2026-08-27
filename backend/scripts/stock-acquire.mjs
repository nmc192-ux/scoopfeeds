#!/usr/bin/env node
/**
 * stock-acquire.mjs — populate the curated stock library (brief §3a).
 *
 * WHAT THIS IS FOR: render-time selection must be a lookup against known-good
 * assets, never a live search. Live keyword search is what put a globe on a gold
 * story and a bar chart on a displacement story. So the search happens HERE,
 * once, under a human's eye, and the render loop never talks to a provider.
 *
 * ⚠️ THE ENDPOINTS ARE UNVERIFIED. §2a requires each host and path be confirmed
 * against the provider's own documentation, and the environment this was written
 * in could not reach pexels.com or pixabay.com (egress blocked). Every endpoint
 * is quarantined in lib/stock/endpoints.mjs behind `verifiedAgainstDocs`, which
 * is false — so this script REFUSES to contact a provider until a human closes
 * §2a. That includes --dry-run: a dry run still asks the provider what exists, so
 * it reaches the same unverified host. --dry-run withholds the download and the
 * manifest write, not the request. --list-classes is the only offline mode.
 *
 * MAC ONLY (§2e). Downloaded media is foreign content that ffmpeg parses. There
 * is deliberately no VPS path, no cron and no container service for any of this,
 * and the API keys are Mac-local (§2d) — they must never reach the server, where
 * a leak would sit next to the ElevenLabs, Gemini, Meta and YouTube credentials.
 *
 * USAGE
 *   node scripts/stock-acquire.mjs --classes ports,ships --per-class 12 --dry-run
 *   node scripts/stock-acquire.mjs --classes ports --per-class 12
 *   node scripts/stock-acquire.mjs --classes ports --providers pexels
 *   node scripts/stock-acquire.mjs --list-classes
 *
 * ENV (Mac backend/.env only — NEVER the VPS, never docker-compose)
 *   PEXELS_API_KEY   https://www.pexels.com/api/     comma-separate for key rotation
 *   PIXABAY_API_KEY  https://pixabay.com/api/docs/   comma-separate for key rotation
 */

import "../src/config/env.js";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import { fetchTimeout, withNetworkRetry } from "../src/services/httpRetry.js";
import { gradeCandidate, GRADES, rationSoftCrops } from "./lib/stock/cropGate.mjs";
import { assertEndpointsVerified } from "./lib/stock/endpoints.mjs";
import {
  betterGradeCount, isKnown, LIBRARY_ROOT, makeEntry, nextId, readManifest, STAGING_DIR, writeManifest,
} from "./lib/stock/manifest.mjs";
import {
  apiKeys, makeKeyRotator, makeSearchCache, ProviderError, searchPexels, searchPixabay,
} from "./lib/stock/providers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAXONOMY_PATH = path.join(__dirname, "stock-taxonomy.json");
const SUPPORTED_PROVIDERS = ["pexels", "pixabay"];

// ── CLI ───────────────────────────────────────────────────────────────────
function die(msg, code = 1) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { classes: [], perClass: 12, providers: [...SUPPORTED_PROVIDERS], dryRun: false, listClasses: false };
  const positiveInt = (raw, flag) => {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) die(`${flag} needs a positive integer (got "${raw}")`);
    return n;
  };
  const list = (raw, flag) => {
    const parts = String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) die(`${flag} needs a comma-separated list (got "${raw}")`);
    return parts;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--list-classes") out.listClasses = true;
    else if (a === "--classes") out.classes = list(argv[++i], "--classes");
    else if (a.startsWith("--classes=")) out.classes = list(a.slice(10), "--classes");
    else if (a === "--per-class") out.perClass = positiveInt(argv[++i], "--per-class");
    else if (a.startsWith("--per-class=")) out.perClass = positiveInt(a.slice(12), "--per-class");
    else if (a === "--providers") out.providers = list(argv[++i], "--providers");
    else if (a.startsWith("--providers=")) out.providers = list(a.slice(12), "--providers");
    else die(`unknown flag: ${a}\nSupported: --classes a,b  --per-class N  --providers pexels,pixabay  --dry-run  --list-classes`);
  }

  for (const p of out.providers) {
    if (p === "coverr") {
      die(
        "Coverr is not ported (brief Q2). Its licence terms differ from Pexels/Pixabay, it needs a third key, " +
          "and its endpoint could not be verified against its own documentation either (§2a). The brief's default " +
          "is to skip it and revisit only if the two main providers leave classes thin — which is a decision to " +
          "make from a real acquisition run, not in advance."
      );
    }
    if (!SUPPORTED_PROVIDERS.includes(p)) die(`unknown provider: ${p}\nSupported: ${SUPPORTED_PROVIDERS.join(", ")}`);
  }
  return out;
}

// ── Taxonomy ──────────────────────────────────────────────────────────────
function loadTaxonomy() {
  if (!existsSync(TAXONOMY_PATH)) die(`taxonomy missing: ${TAXONOMY_PATH}`, 2);
  const parsed = JSON.parse(readFileSync(TAXONOMY_PATH, "utf8"));
  if (!Array.isArray(parsed?.classes)) die(`${TAXONOMY_PATH} has no \`classes\` array`, 2);
  return parsed.classes;
}

// ── Acquisition ───────────────────────────────────────────────────────────
const GRADE_RANK = new Map(GRADES.map((g, i) => [g, i]));

/** Best grade first, then highest resolution — the order the §5 quota is spent in. */
function byPreference(a, b) {
  const rank = GRADE_RANK.get(a.grade) - GRADE_RANK.get(b.grade);
  if (rank !== 0) return rank;
  return b.candidate.width * b.candidate.height - a.candidate.width * a.candidate.height;
}

/**
 * Every candidate a class's queries turn up, deduped within the run and against
 * the manifest. Requests are SERIAL on purpose (§3a): these are free tiers, and a
 * 429 stops the run rather than being retried.
 */
async function gatherCandidates(cls, { providers: wanted, keys, cache, existing }) {
  const seenThisRun = new Set();
  const out = [];

  for (const query of cls.queries) {
    if (wanted.includes("pexels")) {
      // Native portrait first (§3a), then landscape — Pexels supports the filter.
      for (const orientation of ["portrait", "landscape"]) {
        const found = await cache(`pexels:${orientation}:${query}`, () =>
          withNetworkRetry(
            () => searchPexels({ query, orientation, key: keys.pexels(), fetchImpl: timedFetch }),
            { label: `pexels "${query}" (${orientation})` }
          ));
        collect(found);
      }
    }
    if (wanted.includes("pixabay")) {
      // Pixabay video search has no orientation filter — dimensions decide (§3a).
      const found = await cache(`pixabay:${query}`, () =>
        withNetworkRetry(
          () => searchPixabay({ query, key: keys.pixabay(), fetchImpl: timedFetch }),
          { label: `pixabay "${query}"` }
        ));
      collect(found);
    }
  }

  function collect(found) {
    for (const candidate of found) {
      const key = `${candidate.provider}:${candidate.providerId}`;
      if (seenThisRun.has(key)) continue;
      seenThisRun.add(key);
      if (isKnown(existing, candidate)) continue; // dedupe incl. past rejects (§8.4)
      const verdict = gradeCandidate(candidate);
      out.push({ candidate, ...verdict });
    }
  }

  return out;
}

const timedFetch = (url, init) => fetch(url, { ...init, signal: fetchTimeout() });

/** Remove a partial download, best effort — the caller is already reporting a failure. */
function discard(file) {
  try {
    if (existsSync(file)) unlinkSync(file);
  } catch { /* the error being reported matters more than this cleanup */ }
}

async function download(url, destPath) {
  const res = await withNetworkRetry(() => timedFetch(url), { label: `download ${url}` });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  if (!res.body) throw new Error("download failed: empty response body");
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
  } catch (e) {
    // A truncated file left on disk has no manifest row, so nothing would ever
    // attribute it and curation would be looking at half a clip.
    discard(destPath);
    throw new Error(`download interrupted: ${e.message}`);
  }
  const { size } = statSync(destPath);
  if (size === 0) {
    discard(destPath);
    throw new Error("download produced an empty file");
  }
  return size;
}

// ── Run ───────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
const taxonomy = loadTaxonomy();

if (args.listClasses) {
  console.log(`\n📚 ${taxonomy.length} subject classes in stock-taxonomy.json\n`);
  for (const c of [...taxonomy].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))) {
    console.log(`  ${String(c.priority ?? "—").padStart(3)}  ${c.id.padEnd(16)} ${c.queries.length} quer${c.queries.length === 1 ? "y" : "ies"}`);
  }
  console.log("");
  process.exit(0);
}

if (!args.classes.length) die("--classes is required (or --list-classes to see them)");

const selected = args.classes.map((id) => {
  const cls = taxonomy.find((c) => c.id === id);
  if (!cls) die(`unknown class: ${id}\nRun --list-classes to see them. Classes are DATA — add one to stock-taxonomy.json, no code change needed.`);
  return cls;
});

// §2a applies to --dry-run too. A dry run still asks the provider what exists,
// which means contacting the same unverified host — the exact thing §2a is
// written against. --dry-run withholds the DOWNLOAD and the manifest write, not
// the request. Only --list-classes works before the endpoints are verified.
try {
  assertEndpointsVerified();
} catch (e) {
  die(e.message, 2);
}

const keys = {
  pexels: makeKeyRotator(apiKeys(process.env.PEXELS_API_KEY)),
  pixabay: makeKeyRotator(apiKeys(process.env.PIXABAY_API_KEY)),
};
const cache = makeSearchCache();
const manifest = readManifest();
const added = [];
let totalBytes = 0;

console.log(`\n🎞  stock-acquire — ${selected.length} class(es), up to ${args.perClass} each, providers: ${args.providers.join(", ")}`);
if (args.dryRun) console.log("   DRY RUN — nothing is downloaded and the manifest is not touched.\n");
else console.log("");

for (const cls of selected) {
  let graded;
  try {
    graded = await gatherCandidates(cls, { providers: args.providers, keys, cache, existing: manifest });
  } catch (e) {
    if (e instanceof ProviderError || e?.cause instanceof ProviderError) {
      const pe = e instanceof ProviderError ? e : e.cause;
      die(`${cls.id}: ${pe.message}\n   (reason: ${pe.reason})`, 2);
    }
    die(`${cls.id}: ${e.message}`, 2);
  }

  const accepted = rationSoftCrops(
    graded.filter((g) => g.accepted).sort(byPreference),
    betterGradeCount(manifest, cls.id)
  ).filter((g) => g.accepted).slice(0, args.perClass);

  const rejected = graded.filter((g) => !g.accepted);
  console.log(`── ${cls.id} — ${graded.length} candidate(s), ${accepted.length} accepted, ${rejected.length} rejected`);

  for (const item of accepted) {
    const { candidate, grade, orientation } = item;
    const id = args.dryRun ? `${cls.id}-????` : nextId(manifest, cls.id);
    const rel = path.join(STAGING_DIR, `${id}.mp4`);
    const label = `   ${grade.padEnd(15)} ${candidate.provider.padEnd(8)} ${String(candidate.providerId).padEnd(10)} ` +
      `${candidate.width}×${candidate.height} ${candidate.durationSec}s`;

    if (args.dryRun) {
      console.log(`${label}  → ${rel}`);
      continue;
    }

    const absDir = path.join(LIBRARY_ROOT, STAGING_DIR);
    mkdirSync(absDir, { recursive: true });
    const abs = path.join(LIBRARY_ROOT, rel);
    try {
      const bytes = await download(candidate.downloadUrl, abs);
      totalBytes += bytes;
      const entry = makeEntry({
        id, subjectClass: cls.id, tags: cls.tags, candidate, grade, orientation,
        filePath: rel, addedAt: new Date().toISOString(),
      });
      manifest.push(entry);
      added.push(entry);
      writeManifest(manifest); // after each asset: a crash must not strand a downloaded file
      console.log(`${label}  → ${rel} (${(bytes / 1e6).toFixed(1)} MB)`);
    } catch (e) {
      console.log(`${label}  → SKIPPED: ${e.message}`);
    }
  }

  for (const r of rejected) {
    console.log(`   rejected ${r.candidate.provider}:${r.candidate.providerId} — ${r.reason}` +
      `${r.grade ? ` (would have been ${r.grade})` : ""}`);
  }
  console.log("");
}

const distribution = added.reduce((acc, e) => ({ ...acc, [e.cropGrade]: (acc[e.cropGrade] || 0) + 1 }), {});
console.log("─".repeat(72));
if (args.dryRun) {
  console.log("DRY RUN — nothing written. Re-run without --dry-run to acquire.");
} else {
  console.log(`✅ ${added.length} asset(s) staged, ${(totalBytes / 1e6).toFixed(1)} MB total`);
  console.log(`   grades: ${Object.entries(distribution).map(([g, n]) => `${g}=${n}`).join(", ") || "none"}`);
  console.log(`   manifest: ${path.join(LIBRARY_ROOT, "manifest.json")}`);
  console.log("\nNext: review the staging folder, then mark each asset with");
  console.log("  node scripts/stock-curate.mjs --keep <ids> --reject <ids>");
}
console.log("");
