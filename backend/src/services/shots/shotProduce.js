/**
 * shotProduce.js — produceVideo for the shot engine, and the pre-resolve plan store.
 *
 * PRE-RESOLVE (DrJ, 24 Sep). Resolving a short's shots costs minutes cold (a
 * Commons clip is 20–150 s: search, a streamed low-res read, one vision call),
 * and the render job holds a 10-minute lock. So resolution runs AHEAD of the
 * render slot: when the render cycle is rate-gated (most of its cycles), it
 * selects the article it would render next, writes that spec, resolves every
 * shot and stores the result here as a PLAN. When the slot opens and the cycle
 * selects the same article, it takes the plan — no second spec call, no
 * resolution — and goes straight to fetching and rendering. A plan is a file
 * under the persistent dir, not a table: it is a cache, and expires.
 */

import path from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { logger } from "../logger.js";
import { getDb } from "../../models/database.js";
import { voiceSpec } from "../videoVoice.js";
import { getFFmpegPath } from "../videoGenerator.js";
import { acquireFrameDir, releaseFrameDir, VIDEOS_DIR } from "../videoArtifacts.js";
import { deriveShortArc, buildBed, scoreShort } from "../videoMusicBed.js";
import { sourceFingerprint } from "../renderCore.js";
import { resolveSpecShots, defaultDeps } from "./shotResolver.js";
import {
  buildTimeline, placeShots, subCut, fetchAssets, buildPlan, endCardSources, renderPlan,
  buildNarration, muxNarration, END_CARD_SECS, HOOK_SECS, MAX_SHOT_SECS, ENGINE_DIR,
} from "./shotVideo.js";

// ─── The design key: every file that decides pixels ────────────────────────
export const SHOT_BUILDER_FINGERPRINT = sourceFingerprint([
  import.meta.url,
  new URL("./shotVideo.js", import.meta.url).href,
  new URL("./shotResolver.js", import.meta.url).href,
  `file://${path.join(ENGINE_DIR, "engine.py")}`,
  `file://${path.join(ENGINE_DIR, "render.py")}`,
  `file://${path.join(ENGINE_DIR, "tiles.py")}`,
]);
export const shotDesignKey = () => `shot-v1-${SHOT_BUILDER_FINGERPRINT}`;

// ─── Plan store ─────────────────────────────────────────────────────────────
export const PLAN_TTL_MS = 6 * 3600_000;
const plansDir = () => path.join(process.env.SCOOP_PERSISTENT_DATA_DIR || path.resolve("data"), "shot-plans");
const planPath = (articleId) => path.join(plansDir(), `${String(articleId).replace(/[^a-z0-9-]/gi, "")}.json`);

export function savePlan(articleId, { spec, resolved, attribution }, { now = Date.now() } = {}) {
  mkdirSync(plansDir(), { recursive: true });
  writeFileSync(planPath(articleId), JSON.stringify({ articleId, createdAt: now, spec, resolved, attribution }));
}

/** A fresh plan for this article, or null. Stale plans are deleted on read. */
export function loadPlan(articleId, { now = Date.now() } = {}) {
  const f = planPath(articleId);
  if (!existsSync(f)) return null;
  try {
    const p = JSON.parse(readFileSync(f, "utf8"));
    if (now - p.createdAt > PLAN_TTL_MS) { unlinkSync(f); return null; }
    return p;
  } catch { return null; }
}

/** Is there any fresh plan waiting? The pre-resolve step runs only when there is not. */
export function hasFreshPlan({ now = Date.now() } = {}) {
  const dir = plansDir();
  if (!existsSync(dir)) return false;
  for (const f of readdirSync(dir)) {
    try { if (now - statSync(path.join(dir, f)).mtimeMs < PLAN_TTL_MS) return true; else unlinkSync(path.join(dir, f)); }
    catch { /* a racing delete is fine */ }
  }
  return false;
}

/** Pre-resolve: resolve every shot of a validated spec and store the plan. */
export async function prepareShotPlan(article, spec, attribution, { deps = null } = {}) {
  const t0 = Date.now();
  const webDays = Math.max(2, Math.min(30, Math.ceil((Date.now() - (article.published_at || Date.now())) / 86_400_000) + 2));
  const res = await resolveSpecShots(spec, article, { db: getDb(), deps: deps || await defaultDeps(), webDays });
  savePlan(article.id, { spec, resolved: res.shots, attribution });
  logger.info(`🎯 pre-resolved ${article.id}: ${res.stats.shots} shots in ${((Date.now() - t0) / 1000).toFixed(0)}s — ` +
    `real ${Math.round(res.stats.realShare * 100)}% · video ${Math.round(res.stats.videoShare * 100)}% · ${JSON.stringify(res.stats.byRung)}`);
  return res;
}

// ─── Metrics (brief §0 bars; Phase 6 reports them) ─────────────────────────
export function shotMetrics(planShots, placed) {
  const content = planShots.filter((s) => s.kind !== "end");
  const secs = content.reduce((n, s) => n + s.T, 0) || 1;
  const realKinds = new Set(["clip", "photo", "satellite", "map", "headline"]);
  const real = content.filter((s) => realKinds.has(s.kind)).reduce((n, s) => n + s.T, 0);
  const video = content.filter((s) => s.kind === "clip").reduce((n, s) => n + s.T, 0);
  return {
    shots: content.length,
    avgShotSecs: +(secs / Math.max(1, content.length)).toFixed(2),
    realShare: +(real / secs).toFixed(3),
    videoShare: +(video / secs).toFixed(3),
    punchCards: content.filter((s) => s.kind === "punch").length,
    outlets: [...new Set(placed.map((p) => p.record?.credit).filter(Boolean))].length,
  };
}

/**
 * produceVideo for the shot engine. Returns the same shape the cycle expects
 * ({ path, slides, footage, thumbPath }) plus `shots` (every record shown — the
 * cycle passes it to Rule 0's publish gate as an artifact) and `metrics`.
 */
export async function produceShotVideo(article, spec, attribution, { plan = null, deps = null } = {}) {
  const slides = spec.slides;
  const audio = await voiceSpec(slides, { articleId: article.id });
  const timeline = buildTimeline(slides, audio);
  const d = deps || await defaultDeps();

  const tResolve = Date.now();
  const resolved = plan?.resolved || (await resolveSpecShots(spec, article, { db: getDb(), deps: d })).shots;
  const resolveSecs = (Date.now() - tResolve) / 1000;
  const placed = placeShots(slides, resolved, timeline, audio);
  const segments = placed.flatMap(subCut);
  const total = +(timeline.narrationSecs + END_CARD_SECS).toFixed(3);

  const work = acquireFrameDir(`shots-${article.id}`);
  try {
    const local = await fetchAssets(placed, work, d);
    const firstPicture = [...local.values()].find((v) => typeof v === "string") || null;
    const { shots, fallbacks } = buildPlan({ segments, slides, timeline, local, article, attribution, firstPicture });
    const lastPicture = [...local.values()].reverse().find((v) => typeof v === "string") || firstPicture;
    shots.push({ kind: "end", t0: timeline.narrationSecs, T: END_CARD_SECS, sources: endCardSources(article, attribution, placed), bg: lastPicture, caps: false });
    const title = slides[0]?.t === "title" && Array.isArray(slides[0].lines) ? slides[0].lines.slice(0, 2) : null;
    const planJson = {
      W: 1080, H: 1920, total, words: timeline.words, shots,
      hook: title ? { lines: title.map((l) => (Array.isArray(l) ? l : [l, "white"])), until: Math.min(HOOK_SECS, timeline.starts[1] ?? HOOK_SECS) } : null,
    };
    const silent = path.join(work, "video_noaudio.mp4");
    const tRender = Date.now();
    const perf = await renderPlan(planJson, path.join(work, "plan.json"), silent);
    const renderSecs = (Date.now() - tRender) / 1000;

    const narration = await buildNarration(audio, slides, total, path.join(work, "narration.wav"));
    const out = path.join(VIDEOS_DIR, `${article.id}-${shotDesignKey()}.mp4`);
    await muxNarration(silent, narration, out);
    let finalPath = out;
    if (process.env.VIDEO_MUSIC_BED_ENABLED === "1") {
      try {
        const { arc, sections, phases } = deriveShortArc(slides, timeline.starts, total);
        const bed = path.join(work, "bed.wav");
        const scored = path.join(VIDEOS_DIR, `${article.id}-${shotDesignKey()}-scored.mp4`);
        await buildBed(total, bed, { arc, sections, phases, ffmpegPath: getFFmpegPath() });
        await scoreShort(out, bed, scored, { ffmpegPath: getFFmpegPath() });
        if (existsSync(scored) && statSync(scored).size > 10_000) finalPath = scored;
      } catch (err) { logger.warn(`🎬 shot engine: music bed failed (shipping unscored) — ${String(err.message).slice(0, 160)}`); }
    }

    const metrics = { ...shotMetrics(shots, placed), resolveSecs: +resolveSecs.toFixed(1), renderSecs: +renderSecs.toFixed(1),
      preResolved: Boolean(plan), cardFallbacks: fallbacks.length, render: perf };
    logger.info(`🎬 shot engine [${article.id}]: ${metrics.shots} shots · avg ${metrics.avgShotSecs}s · real ${Math.round(metrics.realShare * 100)}% · ` +
      `video ${Math.round(metrics.videoShare * 100)}% · resolve ${metrics.resolveSecs}s${plan ? " (pre-resolved)" : ""} · render ${metrics.renderSecs}s` +
      `${fallbacks.length ? ` · fallbacks: ${fallbacks.join("; ")}` : ""}`);
    const records = placed.map((p) => p.record).filter(Boolean);
    const footage = records.filter((r) => ["clip", "photo"].includes(r.kind))
      .map((r) => ({ credit: r.credit, licence: r.licence, sourceUrl: r.source_url }));
    return { path: finalPath, slides, footage, thumbPath: null, shots: records, metrics, planShots: shots };
  } finally {
    releaseFrameDir(work);
  }
}
