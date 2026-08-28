/**
 * manifest.mjs — the library's index (brief §6).
 *
 * The manifest is the only durable record of provenance, so it is written
 * atomically (temp file + rename): a half-written manifest would strand assets
 * whose creator and source URL are no longer recoverable from anything on disk.
 *
 * The manifest and the assets it describes are gitignored (§3c). Only the schema
 * — this file, and manifest.schema.json beside it — is committed.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** backend/ — this file is at backend/scripts/lib/stock/. */
export const BACKEND_ROOT = path.resolve(HERE, "../../..");
export const LIBRARY_ROOT = path.join(BACKEND_ROOT, "data", "stock-library");
export const STAGING_DIR = "staging";
export const TREATED_DIR = "treated";

export const STATUSES = ["staged", "kept", "rejected", "treated"];

/**
 * THE SHAPE THIS TOOLCHAIN READS AND WRITES.
 *
 * The manifest is a bare JSON array, so it cannot carry a version of its own
 * without changing shape — which is the thing a version exists to signal. So the
 * expectation is versioned at the READER, the same way videoFootage.js versions
 * its cache with CACHE_VERSION rather than stamping the cached files.
 *
 * BUMP THIS WHENEVER WHAT A READER GETS BACK CHANGES. That means a field added,
 * removed or repurposed — and it also means a change to what `treatedPath`
 * POINTS AT, because a reader that assumed one thing about those files and gets
 * another is broken in exactly the way a version is meant to catch.
 *
 *   1 — the original: entries as makeEntry writes them, treated files at the
 *       master's own resolution (2160x3840) and crf 18.
 *   2 — treated files are now 1080x1920 at crf 20. No FIELD changed, so nothing
 *       that reads the manifest breaks; what changed is the contract about the
 *       files those rows point to, and a library holding a mix of the two is a
 *       library half of which is stale. `stock-treat --retreat` is how the mix
 *       is resolved.
 *
 * There is a second copy of this expectation on the renderer side, which reads
 * the synced manifest at render time. The two are deliberately independent —
 * the renderer must be able to tolerate a manifest written by a newer toolchain
 * without a lockstep deploy — so this constant is not imported there and must
 * not be.
 */
export const MANIFEST_SHAPE_VERSION = 2;

export function manifestPath(root = LIBRARY_ROOT) {
  return path.join(root, "manifest.json");
}

/** Read the manifest, or an empty library if none exists yet. */
export function readManifest(root = LIBRARY_ROOT) {
  const file = manifestPath(root);
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, "utf8").trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${file} is not a JSON array — refusing to overwrite it.`);
  }
  return parsed;
}

/** Write the manifest atomically. */
export function writeManifest(entries, root = LIBRARY_ROOT) {
  mkdirSync(root, { recursive: true });
  const file = manifestPath(root);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(entries, null, 2)}\n`);
  renameSync(tmp, file);
  return file;
}

const dedupeKey = (provider, providerId) => `${provider}:${providerId}`;

/** Set of provider:providerId already known, INCLUDING rejects (§8.4). */
export function knownKeys(entries) {
  return new Set(entries.map((e) => dedupeKey(e.provider, e.providerId)));
}

export function isKnown(entries, candidate) {
  return knownKeys(entries).has(dedupeKey(candidate.provider, candidate.providerId));
}

/** Next free id for a class: `ports-0003`. Ids are never reused. */
export function nextId(entries, subjectClass) {
  const prefix = `${subjectClass}-`;
  let max = 0;
  for (const e of entries) {
    if (typeof e.id === "string" && e.id.startsWith(prefix)) {
      const n = Number.parseInt(e.id.slice(prefix.length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

/** How many better-than-soft assets a class already holds — feeds the §5 quota. */
export function betterGradeCount(entries, subjectClass) {
  return entries.filter(
    (e) => e.subjectClass === subjectClass && e.status !== "rejected" &&
      (e.cropGrade === "native-portrait" || e.cropGrade === "crisp-4k-crop")
  ).length;
}

/**
 * Build a manifest entry. Provenance fields are mandatory (§6) — an asset whose
 * creator or source URL is unknown cannot be attributed later, so it is refused
 * here rather than written with nulls.
 */
export function makeEntry({ id, subjectClass, tags, candidate, grade, orientation, filePath, addedAt }) {
  for (const field of ["provider", "providerId", "sourceUrl", "license"]) {
    if (!candidate?.[field]) {
      throw new Error(`refusing to record ${id}: missing provenance field \`${field}\` (brief §6)`);
    }
  }
  return {
    id,
    subjectClass,
    tags: [...new Set([...(tags || []), ...(candidate.tags || [])])],
    provider: candidate.provider,
    providerId: candidate.providerId,
    creator: candidate.creator,
    sourceUrl: candidate.sourceUrl,
    license: candidate.license,
    width: candidate.width,
    height: candidate.height,
    durationSec: candidate.durationSec,
    orientation,
    cropGrade: grade,
    filePath,
    treatedPath: null,
    status: "staged",
    addedAt,
  };
}
