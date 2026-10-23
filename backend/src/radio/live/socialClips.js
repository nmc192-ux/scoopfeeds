/**
 * socialClips.js - short clips from public social posts inside our segments (#202 item 4).
 *
 * Rules (DrJ, 22 Oct 2026):
 *   - at most 30 seconds;
 *   - on-screen credit "via @handle on <platform>";
 *   - only when the post IS the story (the segment is about that post);
 *   - every clip played is logged with its URL, handle and duration.
 *
 * The segment player calls `prepareClip()` before playing and `recordClipPlayed()` after. Playing is
 * hard-capped at MAX_CLIP_SECONDS by `trimArgs()` even if the measured duration was wrong, so a clip
 * can never run long on air. (On main today no segment plays clips yet; the newsroom from #193/#200
 * is where these hooks get called.)
 */
export const MAX_CLIP_SECONDS = 30;

export const PLATFORMS = Object.freeze({
  x: "X", twitter: "X", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook",
  threads: "Threads", bluesky: "Bluesky", truthsocial: "Truth Social", telegram: "Telegram", linkedin: "LinkedIn",
});

export function platformName(p) {
  return PLATFORMS[String(p || "").toLowerCase().replace(/[\s_-]/g, "")] || null;
}

export function normalHandle(h) {
  const s = String(h || "").trim().replace(/^@+/, "");
  return /^[A-Za-z0-9._-]{1,60}$/.test(s) ? `@${s}` : null;
}

/** The on-screen credit. */
export function creditLine(handle, platform) {
  return `via ${normalHandle(handle)} on ${platformName(platform)}`;
}

/**
 * Check a clip before it plays. Returns { ok: true, clip } with the credit and the capped play length,
 * or { ok: false, errors }. Nothing that fails here may play.
 * @param {{ url: string, handle: string, platform: string, durationSec: number, isTheStory: boolean, storyId?: string }} c
 */
export function prepareClip(c = {}) {
  const errors = [];
  let url = null;
  try { const u = new URL(String(c.url)); if (u.protocol === "https:") url = u.toString(); } catch { /* bad */ }
  if (!url) errors.push("needs the post's https URL");
  const handle = normalHandle(c.handle);
  if (!handle) errors.push("needs the poster's @handle for the credit");
  const platform = platformName(c.platform);
  if (!platform) errors.push(`unknown platform "${c.platform}"`);
  const d = Number(c.durationSec);
  if (!Number.isFinite(d) || d <= 0) errors.push("needs a measured duration");
  else if (d > MAX_CLIP_SECONDS) errors.push(`is ${d.toFixed(1)} s; clips are at most ${MAX_CLIP_SECONDS} s (trim it first)`);
  if (c.isTheStory !== true) errors.push("may play only when the post is the story");
  if (errors.length) return { ok: false, errors };
  return { ok: true, clip: { url, handle, platform, durationSec: d, playSec: Math.min(d, MAX_CLIP_SECONDS), credit: creditLine(handle, platform), storyId: c.storyId ?? null } };
}

/** ffmpeg input options that make the cap physical: never more than 30 s of the clip is read. */
export function trimArgs(clip, { startSec = 0 } = {}) {
  const sec = Math.min(Number(clip?.playSec) || MAX_CLIP_SECONDS, MAX_CLIP_SECONDS);
  return ["-ss", String(Math.max(0, startSec)), "-t", String(sec)];
}

/**
 * Log a clip that played. `playedSec` is what actually aired. Throws if the record would be incomplete
 * or the clip ran over the cap, so a gap in the log is loud, not silent.
 */
export function recordClipPlayed(log, clip, { playedSec, segment = null } = {}) {
  if (!clip?.url || !clip?.handle || !clip?.platform) throw new Error("clip log needs url, handle and platform");
  const sec = Number(playedSec ?? clip.playSec);
  if (!Number.isFinite(sec) || sec <= 0) throw new Error("clip log needs the played duration");
  const rec = log.write({ type: "clip", url: clip.url, handle: clip.handle, platform: clip.platform, durationSec: Math.round(sec * 10) / 10, credit: clip.credit, storyId: clip.storyId ?? null, segment });
  if (sec > MAX_CLIP_SECONDS + 0.5) throw new Error(`clip ran ${sec.toFixed(1)} s, over the ${MAX_CLIP_SECONDS} s cap (logged)`);
  return rec;
}

/** Audit the log: every clip has url, handle and duration, none over 30 s. For the acceptance check. */
export function auditClipLog(records) {
  const clips = records.filter((r) => r.type === "clip");
  const problems = clips.filter((r) => !r.url || !r.handle || !(r.durationSec > 0) || r.durationSec > MAX_CLIP_SECONDS + 0.5);
  return { clips: clips.length, problems };
}
