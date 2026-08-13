/**
 * videoArtifacts.js — where video files live, and what deletes them.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE: no new persistent artifact class
 * without its sweeper. CARDS_DIR is the worked example of the alternative —
 * cards are keyed on article.id, the 03:00 cron prunes article ROWS at 7 days
 * and touches no files, and every CARD_DESIGN_VER bump adds a generation
 * without removing the previous one. Nothing anywhere sweeps it. The result is
 * ~19 GB of orphaned PNGs on a disk at 77%.
 *
 * TWO CLASSES, deliberately separated — the existing code conflates them, and
 * that conflation is the leak:
 *
 *   FRAMES — pure scratch. EPHEMERAL container storage, never the persistent
 *     volume. videoGenerator today puts them at <persist>/_frames with a
 *     comment saying "can be transient", cleaned by an unlinkSync in a
 *     `finally`. A crash between render and compose therefore leaks frames
 *     onto the persistent disk with nothing to collect them — and the keyframe
 *     renderer makes each leak ~120 files. Frames are re-derivable from the
 *     spec by definition, so they have no business surviving the process that
 *     made them, let alone a redeploy.
 *
 *   MP4s — durable for 48h, then deleted. Long enough to inspect a bad upload
 *     and understand it; after that the file is re-derivable and YouTube holds
 *     the copy that matters, with video_posts.youtube_id as the pointer. A
 *     video kept "just in case" is 20-40 MB that never gets looked at.
 *
 * Sweeps run at STARTUP, not on a cron: a cron that stops firing is invisible
 * (the social posting cycle went dark for ~5 days in Jul 2026 with zero failed
 * rows), whereas a startup sweep runs on every deploy and every restart, which
 * is exactly when leaked scratch has accumulated. The MP4 retention sweep is
 * cheap enough to also run per cycle.
 */

import { existsSync, mkdirSync, readdirSync, statSync, rmSync, unlinkSync } from "fs";
import os from "os";
import path from "path";
import { logger } from "./logger.js";

const BACKEND_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

// ─── Frames: ephemeral, inside the container ────────────────────────────────
//
// os.tmpdir() is the container's own writable layer — wiped when the container
// is recreated, which is precisely the lifetime scratch should have. It is NOT
// under SCOOP_PERSISTENT_DATA_DIR and must never be moved there.
export const FRAMES_ROOT = process.env.VIDEO_FRAMES_DIR
  ? path.resolve(process.env.VIDEO_FRAMES_DIR)
  : path.join(os.tmpdir(), "scoop-video-frames");

// ─── MP4s: persistent, swept at 48h ─────────────────────────────────────────
export const VIDEOS_DIR = process.env.SCOOP_PERSISTENT_DATA_DIR
  ? path.join(path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR), "videos")
  : path.join(BACKEND_ROOT, "data", "videos");

export const MP4_RETENTION_MS =
  Number.parseInt(process.env.VIDEO_MP4_RETENTION_HOURS || "48", 10) * 60 * 60 * 1000;

/**
 * How long a PENDING URL-fetch publish may pin its MP4 past the retention
 * window. Default 24h.
 *
 * Instagram and Threads do not receive bytes — Meta FETCHES a public URL from
 * our own server, asynchronously, after the container is created. Sweeping the
 * file inside that window breaks a publish that has already been accepted, and
 * the failure surfaces at PUBLISH time rather than at upload time, long after
 * the log line that said "posted".
 *
 * The sweep runs at WORKER STARTUP rather than on a clock, so a deploy at the
 * wrong moment triggers it regardless of how much of the window has elapsed.
 * That is the realistic trigger, not the 48h boundary.
 *
 * BOUNDED, because a crash mid-publish would otherwise pin a file forever: past
 * this hold the file is swept anyway and the pin is reported, since a row stuck
 * `pending` for a day is itself worth seeing.
 */
export const PENDING_FETCH_HOLD_MS =
  Number.parseInt(process.env.VIDEO_PENDING_FETCH_HOLD_MS || "", 10) || 24 * 60 * 60 * 1000;

/**
 * A per-render scratch directory. Caller owns it and should releaseFrameDir()
 * when done; the startup sweep is the backstop for the crash case, not the
 * primary cleanup.
 */
export function acquireFrameDir(jobKey) {
  const safe = String(jobKey).replace(/[^a-z0-9_-]/gi, "_").slice(0, 64);
  const dir = path.join(FRAMES_ROOT, safe);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Delete one render's scratch. Never throws — cleanup must not fail a video. */
export function releaseFrameDir(dir) {
  if (!dir || !dir.startsWith(FRAMES_ROOT)) return false;   // refuse to rm outside scratch
  try { rmSync(dir, { recursive: true, force: true }); return true; }
  catch (err) { logger.warn(`🎞️ videoArtifacts: could not release ${dir}: ${err.message}`); return false; }
}

/**
 * Remove every leftover scratch directory. Runs at startup, when by definition
 * no render of this process is in flight, so there is nothing to race.
 */
export function sweepFrames() {
  if (!existsSync(FRAMES_ROOT)) return { removed: 0, bytes: 0 };
  let removed = 0, bytes = 0;
  for (const entry of readdirSync(FRAMES_ROOT)) {
    const p = path.join(FRAMES_ROOT, entry);
    try {
      for (const f of readdirSync(p)) {
        try { bytes += statSync(path.join(p, f)).size; } catch {}
      }
      rmSync(p, { recursive: true, force: true });
      removed++;
    } catch (err) {
      logger.warn(`🎞️ videoArtifacts: sweep could not remove ${p}: ${err.message}`);
    }
  }
  if (removed > 0) {
    logger.info(`🎞️ videoArtifacts: swept ${removed} leaked frame dir(s), ${(bytes / 1048576).toFixed(1)} MB reclaimed`);
  }
  return { removed, bytes };
}

/** The article id embedded in `{articleId}-{designKey}.mp4`. */
export function articleIdFromVideoFile(filename) {
  const m = String(filename).match(/^(.+)-vid-v\d+-[0-9a-f]{12}\.mp4$/);
  return m ? m[1] : null;
}

/**
 * Delete MP4s older than the retention window.
 *
 * STILL mtime-based, not DB-driven: a file with no row is EXACTLY the orphan
 * class that produced the cards problem, and a DB-driven sweep would skip it
 * forever. Age is the only property an orphan still has.
 *
 * THE ONE EXCEPTION IS A PUBLISH IN FLIGHT. Instagram and Threads are served by
 * URL, so between "container created" and "published" the file on disk is still
 * load-bearing. `pendingUrlFetch` is injected rather than queried here so this
 * module stays free of the database — the caller supplies the predicate, and
 * the default (no predicate) sweeps exactly as before.
 */
export function sweepVideos({
  retentionMs = MP4_RETENTION_MS,
  now = Date.now(),
  pendingUrlFetch = null,
  pendingHoldMs = PENDING_FETCH_HOLD_MS,
} = {}) {
  if (!existsSync(VIDEOS_DIR)) return { removed: 0, bytes: 0, kept: 0, held: 0 };
  let removed = 0, bytes = 0, kept = 0, held = 0;
  for (const entry of readdirSync(VIDEOS_DIR)) {
    if (!entry.endsWith(".mp4")) continue;
    const p = path.join(VIDEOS_DIR, entry);
    try {
      const st = statSync(p);
      if (now - st.mtimeMs <= retentionMs) { kept++; continue; }

      // Past retention. Is a URL-fetch publish still waiting on this file?
      if (pendingUrlFetch) {
        const articleId = articleIdFromVideoFile(entry);
        const age = now - st.mtimeMs;
        // MEASURED BEYOND RETENTION, not from the file's birth. The hold is
        // extra time a pending publish may buy AFTER the file became sweepable;
        // measuring it from mtime made it a no-op, because any file old enough
        // to be swept (48h) was already past a 24h hold.
        const holdUntil = retentionMs + pendingHoldMs;
        if (articleId && age <= holdUntil && pendingUrlFetch(articleId)) {
          held++;
          logger.info(
            `🎞️ videoArtifacts: HELD ${entry} past retention — an Instagram or Threads publish ` +
            `is still pending and Meta fetches this file by URL. Age ${(age / 3600000).toFixed(1)}h ` +
            `of ${(holdUntil / 3600000).toFixed(0)}h (${(retentionMs / 3600000).toFixed(0)}h retention ` +
            `+ ${(pendingHoldMs / 3600000).toFixed(0)}h hold).`
          );
          continue;
        }
        if (articleId && age > holdUntil && pendingUrlFetch(articleId)) {
          // The hold is bounded on purpose — a crash mid-publish would pin this
          // file forever. Sweeping anyway, but a row stuck pending for this long
          // is a fault worth seeing rather than a quiet deletion.
          logger.warn(
            `🎞️ videoArtifacts: sweeping ${entry} DESPITE a pending URL-fetch publish — the row has ` +
            `been pending ${(age / 3600000).toFixed(1)}h, past the ${(holdUntil / 3600000).toFixed(0)}h ` +
            `limit. That publish will now fail to fetch; the pending row is the thing to investigate.`
          );
        }
      }

      bytes += st.size;
      unlinkSync(p);
      removed++;
    } catch (err) {
      logger.warn(`🎞️ videoArtifacts: could not sweep ${p}: ${err.message}`);
    }
  }
  if (removed > 0 || held > 0) {
    logger.info(
      `🎞️ videoArtifacts: deleted ${removed} MP4(s) older than ${(retentionMs / 3600000).toFixed(0)}h, ` +
      `${(bytes / 1048576).toFixed(1)} MB reclaimed, ${kept} kept, ${held} held for a pending publish`
    );
  }
  return { removed, bytes, kept, held };
}

/**
 * Every sweep. Call once at process start, before any render.
 *
 * The TTS cache is swept here too rather than owning its own entry point —
 * one place to look for "what reclaims disk", so a new artifact class cannot
 * be added without appearing in this function.
 */
export async function sweepAtStartup() {
  const frames = sweepFrames();
  // The predicate is wired HERE, at the one place that already knows about
  // every artifact class, rather than inside sweepVideos — which stays
  // database-free so its tests need no schema.
  const { hasPendingUrlFetchPublish } = await import("../models/database.js");
  const videos = sweepVideos({ pendingUrlFetch: hasPendingUrlFetchPublish });
  const { sweepTtsCache } = await import("./videoVoice.js");
  const tts = sweepTtsCache();
  return { frames, videos, tts };
}

export const _internals = { BACKEND_ROOT };
