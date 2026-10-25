/**
 * filmClearance.js — #208 item 5: a ScoopFeeds film or episode enters the radio rotation only when it is
 * KNOWN to be clear of copyright claims that block or mute it. Anything unchecked is EXCLUDED, not assumed clean.
 *
 * Two things must both hold, at air time:
 *   1. A recorded copyright check. YouTube's Data API v3 does not expose Content ID claims or the Studio
 *      "Checks" result (that needs the Content ID API, partners only). So the result is read in YouTube
 *      Studio by a session with DrJ's browser and written to <film dir>/clearance.json (docs/radio/safety.md):
 *        { "films": [ { "file": "a-eye-ep4.mp4", "videoId": "abc123", "copyright": "no-issues",
 *                       "checkedAt": "2026-10-24T10:00:00Z", "checkedBy": "Claude in Chrome, YouTube Studio > Content > Checks" } ] }
 *      Only "no-issues" passes. A record older than MAX_AGE_DAYS is stale (claims can arrive later) and fails.
 *   2. The Data API, now: the video exists, processed, not rejected (rejectionReason empty, e.g. no
 *      "copyright"), public or unlisted, and not blocked in any region. An API that cannot be read = unknown = excluded.
 */
import fs from "node:fs";
import path from "node:path";

export const CLEARANCE_FILE = "clearance.json";
export const MAX_AGE_DAYS = 30;
const VIDEO = /\.(mp4|mov|m4v|webm)$/i;

export function loadClearance(dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, CLEARANCE_FILE), "utf8"));
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.films) ? raw.films : [];
    return new Map(list.filter((r) => r?.file).map((r) => [path.basename(String(r.file)), r]));
  } catch { return new Map(); }
}

/** Is the recorded Studio check good enough? null = yes, else the reason not. */
export function recordProblem(rec, now = Date.now()) {
  if (!rec) return "no recorded copyright check";
  if (!rec.videoId) return "the record has no videoId";
  if (rec.copyright !== "no-issues") return `recorded copyright check is "${rec.copyright ?? "unknown"}", not "no-issues"`;
  const t = Date.parse(rec.checkedAt);
  if (!Number.isFinite(t)) return "the record has no checkedAt date";
  if (now - t > MAX_AGE_DAYS * 86_400_000) return `the copyright check is over ${MAX_AGE_DAYS} days old`;
  return null;
}

/** Is the live API status clean? null = yes, else the reason not. `st` from youtubeLive.videoStatus()[id]. */
export function apiProblem(st) {
  if (!st) return "YouTube status unknown (not read)";
  if (!st.found) return "the video is not on the channel (removed, private to another account, or wrong id)";
  if (st.rejectionReason) return `YouTube rejected the video: ${st.rejectionReason}`;
  if (st.uploadStatus !== "processed") return `upload status is ${st.uploadStatus || "unknown"}`;
  if (!["public", "unlisted"].includes(st.privacyStatus)) return `privacy is ${st.privacyStatus || "unknown"}`;
  if ((st.regionBlocked || []).length) return `blocked in ${st.regionBlocked.length} region(s)`;
  return null;
}

/**
 * The newest film in `p` (a file or a folder) that is cleared, or null. Every exclusion is logged.
 * @param {{ videoStatus: (ids:string[]) => Promise<object> } | null} yt  null = the API is not configured = nothing is cleared
 */
export async function pickClearedFilm(p, { yt, now = Date.now(), log = () => {} } = {}) {
  if (!p || !fs.existsSync(p)) return null;
  const isDir = fs.statSync(p).isDirectory();
  const dir = isDir ? p : path.dirname(p);
  const files = isDir
    ? fs.readdirSync(p).filter((f) => VIDEO.test(f)).map((f) => path.join(p, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    : [p];
  if (!files.length) return null;
  const records = loadClearance(dir);
  const candidates = [];
  for (const f of files) {
    const why = recordProblem(records.get(path.basename(f)), now);
    if (why) log(`film excluded: ${path.basename(f)}: ${why}`); else candidates.push(f);
  }
  if (!candidates.length) return null;
  if (!yt) { log(`film excluded: ${candidates.map((f) => path.basename(f)).join(", ")}: YouTube API not configured, status unknown`); return null; }
  let st;
  try { st = await yt.videoStatus(candidates.map((f) => records.get(path.basename(f)).videoId)); }
  catch (e) { log(`film excluded: YouTube status could not be read (${e.message})`); return null; }
  for (const f of candidates) {
    const why = apiProblem(st?.[records.get(path.basename(f)).videoId]);
    if (!why) return f;
    log(`film excluded: ${path.basename(f)}: ${why}`);
  }
  return null;
}
