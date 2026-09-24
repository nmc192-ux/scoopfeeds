/**
 * shotMetrics.js — per-short metrics, the brief's bars, and the digest's records
 * (shot-engine brief, Phase 6).
 *
 * Every short the shot engine produces gets a RECORD: the measured metrics
 * (real-imagery share, real-video share, average shot length, card fallbacks,
 * outlets shown), the loudness measured after AAC, which bars it missed, and a
 * 12-frame contact sheet. A short that misses a bar STILL PUBLISHES — the digest
 * flags it (brief §2, Phase 6). Records are files under <data>/shot-metrics/
 * (a cache of what was made, not state anything depends on), one folder per UTC
 * day, so the digest is a directory listing and nothing needs a migration.
 */

import path from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "fs";
import { execFile } from "child_process";
import { logger } from "../logger.js";
import { getFFmpegPath } from "../videoGenerator.js";

// Brief §0: the bars the approved sample set.
export const BARS = Object.freeze({
  realShareMin: 0.70,        // real imagery (footage, photos, satellite, maps, real headlines)
  videoShareMin: 0.25,       // real video — only where the resolver found any
  avgShotMax: 3.0,           // seconds
  paragraphCaptions: 0,      // word-by-word only (structural: the shot engine has no paragraph track)
  lufsTarget: -14, lufsTol: 1,
  truePeakMax: -1.0,         // dBTP after AAC
});

/** Which bars a short misses. `videoFound`: did the resolver find ANY clip for this short? */
export function evaluate(metrics = {}, sound = {}, { videoFound = false } = {}) {
  const misses = [];
  if (!(metrics.realShare >= BARS.realShareMin)) misses.push(`real imagery ${Math.round((metrics.realShare || 0) * 100)}% < ${BARS.realShareMin * 100}%`);
  if (videoFound && !(metrics.videoShare >= BARS.videoShareMin)) misses.push(`real video ${Math.round((metrics.videoShare || 0) * 100)}% < ${BARS.videoShareMin * 100}%`);
  if (!(metrics.avgShotSecs <= BARS.avgShotMax)) misses.push(`average shot ${metrics.avgShotSecs}s > ${BARS.avgShotMax}s`);
  const a = sound.after_aac || {};
  if (!(Math.abs(a.I - BARS.lufsTarget) <= BARS.lufsTol)) misses.push(`loudness ${a.I} LUFS outside ${BARS.lufsTarget}±${BARS.lufsTol}`);
  if (!(a.TP <= BARS.truePeakMax)) misses.push(`true peak ${a.TP} dBTP > ${BARS.truePeakMax}`);
  return { pass: misses.length === 0, misses };
}

export const metricsDir = () => path.join(process.env.SCOOP_PERSISTENT_DATA_DIR || path.resolve("data"), "shot-metrics");
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** A 12-frame contact sheet (6x2, 270x480 cells) of a finished short. */
export async function contactSheet(mp4, out, { durationSecs }) {
  const ff = getFFmpegPath();
  const d = Math.max(1, Number(durationSecs) || 60);
  await new Promise((res, rej) => execFile(ff, ["-v", "error", "-y", "-i", mp4, "-vf", `fps=12/${d.toFixed(2)},scale=270:480,tile=6x2`,
    "-frames:v", "1", "-q:v", "4", out], { timeout: 120000 }, (e, _o, se) => (e ? rej(new Error(String(se).slice(-300))) : res())));
  return out;
}

/** Write the record (and contact sheet) for a produced short. Never throws. */
export async function recordShort({ article, mp4, metrics, sound, videoFound, durationSecs, now = Date.now() }) {
  try {
    const dir = path.join(metricsDir(), dayOf(now));
    mkdirSync(dir, { recursive: true });
    const verdict = evaluate(metrics, sound, { videoFound });
    const sheet = path.join(dir, `${article.id}.jpg`);
    try { await contactSheet(mp4, sheet, { durationSecs }); } catch (err) { logger.warn(`📊 contact sheet failed for ${article.id}: ${String(err.message).slice(0, 100)}`); }
    const rec = {
      articleId: article.id, title: article.title, source: article.source_name, producedAt: now, publishedAt: null, youtubeId: null,
      metrics, sound: { tone: sound.tone, bed: sound.bed, I: sound.after_aac?.I, TP: sound.after_aac?.TP },
      videoFound: Boolean(videoFound), bars: verdict, sheet: existsSync(sheet) ? path.basename(sheet) : null,
    };
    writeFileSync(path.join(dir, `${article.id}.json`), JSON.stringify(rec, null, 1));
    logger.info(`📊 shot metrics [${article.id}]: real ${Math.round(metrics.realShare * 100)}% · video ${Math.round(metrics.videoShare * 100)}%` +
      ` · avg shot ${metrics.avgShotSecs}s · fallbacks ${metrics.cardFallbacks} · outlets ${metrics.outlets} · ` +
      `${verdict.pass ? "meets every bar" : `MISSES: ${verdict.misses.join("; ")}`}`);
    return rec;
  } catch (err) {
    logger.warn(`📊 shot metrics record failed for ${article?.id}: ${String(err.message).slice(0, 120)}`);
    return null;
  }
}

/** Mark a record published (called by the cycle after the upload). Never throws. */
export function markPublished(articleId, { youtubeId, now = Date.now() } = {}) {
  try {
    const root = metricsDir();
    if (!existsSync(root)) return false;
    for (const day of readdirSync(root).sort().reverse().slice(0, 3)) {
      const f = path.join(root, day, `${articleId}.json`);
      if (!existsSync(f)) continue;
      const rec = JSON.parse(readFileSync(f, "utf8"));
      rec.publishedAt = now; rec.youtubeId = youtubeId || null;
      writeFileSync(f, JSON.stringify(rec, null, 1));
      return true;
    }
  } catch { /* the digest shows it as produced-not-published; nothing breaks */ }
  return false;
}

/** The PUBLISHED shorts of one UTC day, with their contact sheets. */
export function publishedOn(day) {
  const dir = path.join(metricsDir(), day);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json"))
    .map((f) => { try { return JSON.parse(readFileSync(path.join(dir, f), "utf8")); } catch { return null; } })
    .filter((r) => r && r.publishedAt)
    .map((r) => ({ ...r, sheetPath: r.sheet ? path.join(dir, r.sheet) : null }))
    .sort((a, b) => a.publishedAt - b.publishedAt);
}

/**
 * Delete day folders older than the retention window. Shipped WITH the records
 * (the CARDS_DIR rule: a file class with no sweeper is an orphan class).
 * Wired into videoArtifacts.sweepAtStartup.
 */
export const METRICS_RETENTION_DAYS = () => Math.max(2, Number(process.env.SHOT_METRICS_RETENTION_DAYS) || 14);
export function sweepShotMetrics({ now = Date.now(), days = METRICS_RETENTION_DAYS() } = {}) {
  const root = metricsDir();
  if (!existsSync(root)) return { removed: 0 };
  const cutoff = dayOf(now - days * 86_400_000);
  let removed = 0;
  for (const day of readdirSync(root)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < cutoff) {
      try { rmSync(path.join(root, day), { recursive: true, force: true }); removed++; } catch { /* next startup */ }
    }
  }
  if (removed) logger.info(`📊 sweepShotMetrics: removed ${removed} day folder(s) older than ${days}d`);
  return { removed };
}
