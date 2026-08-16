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
 * `{id}-{preset}-{hash}[-p0|-p1].png`.
 *
 * THE SUFFIX IS NOT OPTIONAL IN PRACTICE, and getting this wrong is what made
 * the first dry run skip 12,029 of 14,156 files as unrecognised. The regex was
 * written against `cachePath()`'s SIGNATURE — `(articleId, preset, hash)` — but
 * no live caller passes a bare hash. All four append a photo suffix first:
 *
 *   cachePath(article.id, preset, `${baseHash}-${intendedSuffix}`)   // p1 | p0
 *   cachePath(article.id, preset, `${baseHash}-p0`)
 *   cachePath(article.id, preset, `${baseHash}-${finalSuffix}`)
 *   cachePath(`evt-${ctx.event.id}`, preset, `${hash}-p0`)
 *
 * p1 = rendered with the article's photograph, p0 = typographic. The suffix
 * exists so a cache lookup can prefer a known-good typographic render over
 * re-attempting a photo that already failed. It arrived with the article-photo
 * work, which is why the ~2,000 files that DID parse were older ones.
 *
 * Kept optional rather than required: the bare shape is what `cachePath` alone
 * produces, it is still what pre-suffix files on disk look like, and those need
 * sweeping too.
 */
const PRESET_NAMES = [
  "og", "square", "story",
  "carousel1", "carousel2", "carousel3", "carousel4", "carousel5", "carousel6", "carousel7",
];
const CARD_RE = new RegExp(`^(.+)-(${PRESET_NAMES.join("|")})-([0-9a-f]{10})(?:-(p[01]))?\\.png$`);

/**
 * Event-carousel cards are keyed `evt-{eventId}`, not by an article id.
 *
 * DrJ's ruling (2026-08-16): check the prefix against the EVENTS table the way
 * an article id is checked against `articles` — and never let these take the
 * orphan path against a table they cannot possibly be in. Under the broken
 * regex they were unparseable and therefore skipped; a naive fix would have
 * made them parse and then be judged orphaned on EVERY run, deleting live event
 * carousels immediately regardless of age. The broken parser was accidentally
 * hiding that.
 *
 * Checking `events` was the cheaper of the two options and is the one taken: it
 * is one `SELECT id`, the same shape already used for articles, and the table
 * is small enough to hold as a Set. It is also strictly more accurate than
 * mtime alone — a deleted event's carousels go on the next sweep instead of
 * lingering for the retention window.
 *
 * Note events are NOT pruned on a 7-day rule the way articles are, so in
 * practice almost no evt- card will be orphaned and the mtime rule is what
 * actually reclaims them. That is correct: the orphan check is there to catch
 * the event that genuinely went away.
 */
const EVENT_PREFIX = "evt-";

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
    evtChecked: 0, evtMtimeOnly: 0,
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

  // Loaded LAZILY and memoised: a directory with no event carousels should not
  // pay for a 20k-row scan. `null` means "could not read the table", which
  // downgrades evt- cards to mtime-only rather than orphaning them — the one
  // outcome that must never happen against a table they cannot be in.
  let eventIds;
  const eventIdSet = () => {
    if (eventIds !== undefined) return eventIds;
    try {
      eventIds = new Set(getDb().prepare("SELECT id FROM events").all().map((r) => r.id));
    } catch (err) {
      logger.warn(`🧹 card sweep: events table unreadable (${err.message}) — evt- cards fall back to mtime only`);
      eventIds = null;
    }
    return eventIds;
  };

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
    const id = m[1];

    // WHICH TABLE OWNS THIS PREFIX. An evt- card judged against `articles` would
    // be orphaned on every single run.
    let alive;
    if (id.startsWith(EVENT_PREFIX)) {
      const known = eventIdSet();
      if (known === null) { stats.evtMtimeOnly++; alive = true; }   // never orphan on an unreadable table
      else { alive = known.has(id.slice(EVENT_PREFIX.length)); stats.evtChecked++; }
    } else {
      alive = liveIds.has(id);
    }
    if (!alive) { remove(full, "orphaned"); continue; }

    // Alive, but possibly a superseded generation. mtime only — the file is a
    // cache and a wrong guess costs one re-render.
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
    (s.evtChecked ? `, ${s.evtChecked} evt- checked against events` : "") +
    (s.evtMtimeOnly ? `, ${s.evtMtimeOnly} evt- on mtime only (events unreadable)` : "") +
    (s.unparseable ? `, skipped ${s.unparseable} unrecognised` : "") +
    (s.errors ? `, ${s.errors} errors` : "") +
    (s.cappedAt ? ` — CAPPED at ${s.cappedAt}, more remain (raise CARD_SWEEP_MAX_DELETES or wait for tomorrow)` : "") +
    ` in ${s.durationMs}ms`
  );
}
