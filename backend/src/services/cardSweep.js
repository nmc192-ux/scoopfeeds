/**
 * cardSweep — the thing that deletes cards. Nothing ever did.
 *
 * 36,000 files and 34GB accumulated in about a month, because every
 * CARD_DESIGN_VER bump orphans the entire previous generation and no code path
 * removed any of it. Without this the disk is back at 99% by September.
 *
 * TWO CONDITIONS, both safe for different reasons:
 *
 *   ORPHANED          the filename's article prefix is not in `articles`.
 *                     Provably dead — the route can only ever 404 for it. This
 *                     IS the 7-day rule rather than an approximation of it,
 *                     because pruneOldArticles(7) is what removes the articles.
 *
 *   STALE GENERATION  mtime older than the same retention window. A
 *                     CARD_DESIGN_VER bump changes the content hash, so
 *                     old-hash files for LIVE articles are unreachable too.
 *                     Catching those by recomputing hashes would couple this to
 *                     the renderer; mtime is enough because CARDS ARE A CACHE —
 *                     deleting a live one costs one cold render and nothing
 *                     else. That self-healing property is what makes the blunt
 *                     instrument the correct one here.
 *
 * IMG-CACHE IS SWEPT TOO, and it is a different shape. Its filenames are
 * `<sha1-of-candidate-urls>.jpg` with NO article id, so orphan detection is
 * impossible there by construction and only the mtime rule applies. Same
 * argument holds: it is a cache of downloaded publisher photos and refetches.
 *
 * FOUR SAFETY PROPERTIES, because a sweep that silently deletes is how the next
 * incident starts:
 *
 *   1. A CAP per run, so a bug cannot empty the directory in one pass.
 *   2. UNPARSEABLE NAMES ARE SKIPPED, never guessed at. A file this module does
 *      not understand is somebody else's, and the count of them is logged.
 *   3. COUNT AND BYTES are reported, so "it ran" and "it did something" are
 *      distinguishable.
 *   4. BATCHED readdir with `withFileTypes` — 36k+ entries, so no recursive
 *      glob and no per-file stat before the cheap checks have run.
 */

import { readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

import { getDb } from "../models/database.js";
import { logger } from "./logger.js";

/**
 * `{articleId}-{preset}-{hash}.png`, as written by cardRenderer's cachePath().
 * The hash is exactly 10 hex chars (sha1 sliced) and the preset is a known name,
 * which together make the split unambiguous even though article ids contain
 * hyphens themselves — anchoring on the LAST two segments is what makes a UUID
 * prefix parse correctly.
 */
const PRESET_NAMES = [
  "og", "square", "story",
  "carousel1", "carousel2", "carousel3", "carousel4", "carousel5", "carousel6", "carousel7",
];
const CARD_RE = new RegExp(`^(.+)-(${PRESET_NAMES.join("|")})-([0-9a-f]{10})\\.png$`);

/** img-cache: `<sha1-20>.jpg|.png`. No article id — mtime only. */
const IMG_RE = /^[0-9a-f]{20}\.(?:jpg|png)$/;

export const CARD_SWEEP_MAX_DELETES = (() => {
  const raw = process.env.CARD_SWEEP_MAX_DELETES;
  if (raw === undefined || raw === "") return 20_000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 20_000;
})();

/**
 * Sweep the card cache.
 *
 * Call AFTER pruneOldArticles(daysToKeep) in the same cron tick: the orphan set
 * is exactly correct at that moment and needs no cutoff of its own.
 *
 * @param {string}  cardsDir     the directory cardRenderer writes to
 * @param {number}  daysToKeep   same retention as the article prune
 * @param {boolean} dryRun       count and measure, delete nothing
 */
export function sweepCards(cardsDir, { daysToKeep = 7, dryRun = false, maxDeletes = CARD_SWEEP_MAX_DELETES } = {}) {
  const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
  const started = Date.now();
  const stats = {
    scanned: 0, deleted: 0, bytes: 0,
    orphaned: 0, stale: 0, kept: 0, unparseable: 0, errors: 0,
    cappedAt: null, dryRun,
  };

  let entries;
  try {
    entries = readdirSync(cardsDir, { withFileTypes: true });
  } catch (err) {
    // A missing directory is not a failure — nothing has rendered yet.
    if (err?.code === "ENOENT") return { ...stats, skipped: "no cards directory" };
    throw err;
  }

  // ONE query, not one per file. 36k files against a live `articles` table is
  // the difference between a set membership test and 36k round trips.
  const liveIds = new Set(getDb().prepare("SELECT id FROM articles").all().map((r) => r.id));

  const remove = (full, reason) => {
    if (stats.deleted >= maxDeletes) {
      if (stats.cappedAt === null) stats.cappedAt = maxDeletes;
      return false;
    }
    let size = 0;
    try { size = statSync(full).size; } catch { /* vanished under us — fine */ }
    if (!dryRun) {
      try { unlinkSync(full); }
      catch (err) {
        if (err?.code !== "ENOENT") { stats.errors++; return false; }
      }
    }
    stats.deleted++; stats.bytes += size; stats[reason]++;
    return true;
  };

  for (const ent of entries) {
    if (ent.isDirectory()) continue;                 // img-cache handled below
    if (!ent.isFile()) continue;
    stats.scanned++;
    const m = CARD_RE.exec(ent.name);
    if (!m) {
      // NOT OURS, OR NOT UNDERSTOOD. Either way it is not this module's to
      // delete — guessing is how a sweep removes something that mattered.
      stats.unparseable++;
      continue;
    }
    const full = path.join(cardsDir, ent.name);
    if (!liveIds.has(m[1])) { remove(full, "orphaned"); continue; }

    // Live article, but possibly a superseded generation. mtime only — the file
    // is a cache and a wrong guess costs one re-render.
    let mtime = Infinity;
    try { mtime = statSync(full).mtimeMs; } catch { stats.errors++; continue; }
    if (mtime < cutoff) remove(full, "stale");
    else stats.kept++;
  }

  // ── img-cache: mtime only, no article id in the name ─────────────────────
  const imgDir = path.join(cardsDir, "img-cache");
  let imgEntries = [];
  try { imgEntries = readdirSync(imgDir, { withFileTypes: true }); }
  catch (err) { if (err?.code !== "ENOENT") stats.errors++; }
  for (const ent of imgEntries) {
    if (!ent.isFile()) continue;
    stats.scanned++;
    if (!IMG_RE.test(ent.name)) { stats.unparseable++; continue; }
    const full = path.join(imgDir, ent.name);
    let mtime = Infinity;
    try { mtime = statSync(full).mtimeMs; } catch { stats.errors++; continue; }
    if (mtime < cutoff) remove(full, "stale");
    else stats.kept++;
  }

  stats.durationMs = Date.now() - started;
  return stats;
}

/** The one line an operator reads. Bytes as well as count, per the ask. */
export function formatSweep(s) {
  if (s.skipped) return `🧹 card sweep: ${s.skipped}`;
  const mb = (s.bytes / 1048576).toFixed(1);
  return (
    `🧹 card sweep${s.dryRun ? " (DRY RUN)" : ""}: scanned ${s.scanned}, ` +
    `deleted ${s.deleted} (${s.orphaned} orphaned, ${s.stale} stale) — ${mb} MB reclaimed, ` +
    `kept ${s.kept}` +
    (s.unparseable ? `, skipped ${s.unparseable} unrecognised` : "") +
    (s.errors ? `, ${s.errors} errors` : "") +
    (s.cappedAt ? ` — CAPPED at ${s.cappedAt}, more remain (raise CARD_SWEEP_MAX_DELETES or wait for tomorrow)` : "") +
    ` in ${s.durationMs}ms`
  );
}
