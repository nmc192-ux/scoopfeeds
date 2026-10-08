#!/usr/bin/env node
/**
 * manualPost.mjs — publish ONE externally made video through the autopost
 * pipeline's own platform clients.
 *
 * For one-off reels that did not come out of the render loop (DrJ, 27 Sep 2026).
 * No new services: every upload goes through the same client function
 * videoAutopost uses, with the same credentials. What it deliberately does NOT
 * reuse is videoAutopost's per-surface wrappers — those are keyed to an article
 * row and write video_posts bookkeeping, and a manual post has neither.
 *
 *   node scripts/manualPost.mjs --manifest post.json [--platforms youtube,x] [--video file|url]
 *   node scripts/manualPost.mjs --manifest post.json --publish
 *
 * DRY RUN IS THE DEFAULT. It validates the files, the texts after every
 * transform the client applies, the platform limits and the credentials, runs
 * Rule 0 and the sensitivity tiers, and prints exactly what would be sent. Only
 * --publish sends anything.
 *
 * NO SILENT CAPS. Where a client would truncate (YouTube's 99-char title, X's
 * fitPost, Threads' 500), the dry run FAILS the platform instead, so the text
 * that goes out is the text that was approved.
 *
 * RULE 0 BLOCKS THE WHOLE RUN. assertPublishAllowed is run once over the
 * manifest before anything else; a match stops every platform. There is no
 * override flag, on purpose.
 *
 * Manifest shape (per-platform `video` falls back to --video):
 *   {
 *     "id": "manual-nvidia-climate-20260927",          // [a-z0-9_-], used for the public URL
 *     "source": { "title": "...", "source_name": "...", "category": "..." },
 *     "platforms": {
 *       "youtube":  { "video", "title", "description", "tags", "category", "privacy",
 *                     "isShort", "containsSyntheticMedia" },
 *       "facebook": { "video", "caption" },               // posted as a Reel
 *       "threads":  { "video", "text" },                  // URL-fetch: staged in VIDEOS_DIR
 *       "bluesky":  { "video", "text" },
 *       "x":        { "video", "text" }
 *     }
 *   }
 */

import "../src/config/env.js";
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, unlinkSync } from "fs";
import { execFileSync } from "child_process";
import path from "path";
import os from "os";

import { assertPublishAllowed } from "../src/services/videoPakistanBlock.js";
import { isSensitiveHeadline, isExplicitHarmHeadline } from "../src/services/editorialSensitivity.js";
import { VIDEOS_DIR } from "../src/services/videoArtifacts.js";
import { uploadToYouTube, isYouTubeConfigured, getChannelInfo } from "../src/services/youtubeClient.js";
import { postReelToFacebook, isFacebookConfigured } from "../src/services/facebookClient.js";
import { postVideoToThreads, isThreadsConfigured } from "../src/services/threadsClient.js";
import { postVideoToBluesky, isBlueskyConfigured, BLUESKY_VIDEO_MAX_BYTES, BLUESKY_VIDEO_MAX_SECS }
  from "../src/services/blueskyClient.js";
import { postToX, isXConfigured, fitPost, assertNoLink } from "../src/services/xClient.js";

const ORDER = ["youtube", "facebook", "threads", "bluesky", "x"];
const SITE_ORIGIN = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");

// ─── args ───────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { publish: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--publish") a.publish = true;
    else if (k === "--dry-run") a.publish = false;
    else if (["--manifest", "--platforms", "--video", "--log"].includes(k)) a[k.slice(2)] = argv[++i];
    else throw new Error(`unknown argument: ${k}`);
  }
  if (!a.manifest) throw new Error("--manifest <json> is required");
  return a;
}

const graphemes = (s) => typeof Intl?.Segmenter === "function"
  ? [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(String(s))].length
  : Array.from(String(s)).length;

// ─── video ──────────────────────────────────────────────────────────────────
async function resolveVideo(ref) {
  if (!ref) return null;
  if (!/^https?:\/\//i.test(ref)) return path.resolve(ref);
  const out = path.join(os.tmpdir(), `manualpost-${Date.now()}.mp4`);
  const res = await fetch(ref);
  if (!res.ok) throw new Error(`video download ${ref} → ${res.status}`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  return out;
}

function probe(file) {
  if (!file || !existsSync(file)) return { ok: false, error: `file not found: ${file}` };
  try {
    const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json",
      "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate", file],
      { encoding: "utf8", timeout: 20000 }));
    const v = j.streams.find((s) => s.codec_type === "video");
    const a = j.streams.find((s) => s.codec_type === "audio");
    return {
      ok: Boolean(v), bytes: statSync(file).size, secs: Number(j.format?.duration),
      video: v && `${v.codec_name} ${v.width}x${v.height} @ ${v.r_frame_rate}`,
      audio: a ? a.codec_name : "NONE", width: v?.width, height: v?.height,
      ...(v ? {} : { error: "no video stream" }),
    };
  } catch (err) {
    return { ok: false, error: `ffprobe failed: ${err.message.slice(0, 200)}` };
  }
}

// ─── per-platform plan: the exact payload plus every problem found ──────────
function plan(name, cfg, file, info, { id }) {
  const errors = [];
  const warnings = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  if (!info.ok) errors.push(info.error);

  switch (name) {
    case "youtube": {
      need(isYouTubeConfigured(), "YouTube not configured");
      const title = String(cfg.title || "");
      const clean = title.replace(/[<>]/g, "");
      need(clean.length > 0, "title is empty");
      need(clean.length <= 99, `title is ${clean.length} chars; the client cuts at 99`);
      need(clean === title, "title contains < or >, which the client strips");
      const isShort = cfg.isShort !== false;
      let description = String(cfg.description || "");
      need(description.length <= 4900, `description is ${description.length} chars; the client cuts at 4900`);
      if (isShort) description += "\n\n#Shorts #News #BreakingNews";
      const privacy = cfg.privacy || "public";
      need(["public", "unlisted", "private"].includes(privacy), `invalid privacy ${privacy}`);
      need(typeof cfg.containsSyntheticMedia === "boolean",
        "containsSyntheticMedia must be set explicitly (true/false) for a manual post");
      return { errors, warnings, payload: {
        filePath: file, title: clean, description, tags: cfg.tags || [], category: cfg.category ?? 25,
        isShort, containsSyntheticMedia: cfg.containsSyntheticMedia, privacy,
      } };
    }
    case "facebook": {
      need(isFacebookConfigured(), "Facebook not configured");
      const caption = String(cfg.caption || "");
      need(caption.length > 0, "caption is empty");
      need(caption.length <= 2200, `caption is ${caption.length} chars; limit 2200`);
      if (info.secs > 90) warnings.push(`${info.secs.toFixed(1)}s is over 90s — Meta may publish it as a regular video, not a Reel`);
      return { errors, warnings, payload: { filePath: file, caption } };
    }
    case "threads": {
      need(isThreadsConfigured(), "Threads not configured");
      const text = String(cfg.text || "");
      need(text.length > 0, "text is empty");
      need(text.length <= 500, `text is ${text.length} chars; Threads' limit is 500`);
      if (info.secs > 300) errors.push(`${info.secs.toFixed(1)}s exceeds Threads' 5-minute ceiling`);
      const staged = path.join(VIDEOS_DIR, `${id}-shorts.mp4`);
      const videoUrl = `${SITE_ORIGIN}/scoop-ops/videos-gen/file/${encodeURIComponent(id)}`;
      return { errors, warnings, payload: { text, videoUrl }, staged };
    }
    case "bluesky": {
      need(isBlueskyConfigured(), "Bluesky not configured");
      const text = String(cfg.text || "");
      const n = graphemes(text);
      need(n > 0, "text is empty");
      need(n <= 300, `text is ${n} graphemes; Bluesky's limit is 300`);
      need(info.bytes <= BLUESKY_VIDEO_MAX_BYTES(), `${info.bytes} bytes exceeds ${BLUESKY_VIDEO_MAX_BYTES()}`);
      need(info.secs <= BLUESKY_VIDEO_MAX_SECS(), `${info.secs}s exceeds ${BLUESKY_VIDEO_MAX_SECS()}s`);
      return { errors, warnings, payload: {
        text, filePath: file, durationSecs: info.secs,
        // An object, never "9:16" — the string form is what poisoned an MP4 on 2026-09-22.
        aspectRatio: { width: info.width, height: info.height },
      } };
    }
    case "x": {
      need(isXConfigured(), "X not configured");
      const text = String(cfg.text || "");
      try { assertNoLink(text); } catch (err) { errors.push(err.message); }
      const fitted = fitPost(text);
      need(fitted === text.trim(), `text is ${graphemes(text)} graphemes; fitPost would truncate at 280`);
      const tags = (text.match(/#\w+/g) || []).length;
      if (tags > 2) warnings.push(`${tags} hashtags — xHashtags measured 3+ as costing reach`);
      return { errors, warnings, payload: { text: fitted, filePath: file } };
    }
    default:
      return { errors: [`unknown platform ${name}`], warnings, payload: null };
  }
}

// ─── publish ────────────────────────────────────────────────────────────────
async function publishOne(name, p) {
  const x = p.payload;
  switch (name) {
    case "youtube": {
      // The client reads privacy from env; set it for this process only.
      process.env.YOUTUBE_PRIVACY = x.privacy;
      const r = await uploadToYouTube(x);
      return { id: r.videoId, url: r.videoUrl };
    }
    case "facebook": return postReelToFacebook(x);
    case "threads": {
      // URL-FETCH: Meta downloads from our public file route, so the MP4 is
      // staged under VIDEOS_DIR for the duration of the post and removed after.
      copyFileSync(p.file, p.staged);
      try {
        const head = await fetch(x.videoUrl, { method: "HEAD" });
        const len = Number(head.headers.get("content-length"));
        if (!head.ok || len !== statSync(p.file).size) {
          throw new Error(`public URL check failed: ${head.status}, ${len} bytes (expected ${statSync(p.file).size})`);
        }
        return await postVideoToThreads(x);
      } finally {
        try { unlinkSync(p.staged); } catch { /* already gone */ }
      }
    }
    case "bluesky": {
      const r = await postVideoToBluesky(x);
      return { id: r.uri, url: r.url };
    }
    case "x": return postToX(x);
  }
  throw new Error(`no publisher for ${name}`);
}

// ─── main ───────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(args.manifest, "utf8"));
  const id = String(manifest.id || "");
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error(`manifest id must match [a-z0-9_-]+, got "${id}"`);

  const wanted = (args.platforms ? args.platforms.split(",") : Object.keys(manifest.platforms || {}))
    .map((s) => s.trim().toLowerCase()).filter(Boolean);
  const platforms = ORDER.filter((p) => wanted.includes(p));
  const unknown = wanted.filter((p) => !ORDER.includes(p));
  if (unknown.length) throw new Error(`unknown platform(s): ${unknown.join(", ")}`);
  const missing = platforms.filter((p) => !manifest.platforms?.[p]);
  if (missing.length) throw new Error(`no manifest entry for: ${missing.join(", ")}`);

  console.log(`\n=== manualPost ${args.publish ? "PUBLISH" : "DRY RUN"} — ${id} — ${platforms.join(", ")} ===\n`);

  // RULE 0, over everything that will be published. Blocks the whole run.
  const src = manifest.source || {};
  const pseudoArticle = {
    id, title: src.title || manifest.platforms?.youtube?.title || "",
    description: src.description || "", source_name: src.source_name || "", category: src.category || "",
    content: platforms.map((p) => JSON.stringify(manifest.platforms[p])).join("\n"), tags: "",
  };
  assertPublishAllowed(pseudoArticle, platforms.map((p) => manifest.platforms[p]));
  console.log("Rule 0 (Pakistan block): PASS — no match in source or any platform text\n");

  // Sensitivity tiers are IMAGE guards, not publish gates; reported, never overridden.
  const sens = [];
  for (const p of platforms) {
    const c = manifest.platforms[p];
    const head = String(c.title || c.caption || c.text || "").split("\n")[0];
    if (isExplicitHarmHeadline(head)) sens.push(`${p}: EXPLICIT-HARM tier matched "${head.slice(0, 80)}"`);
    else if (isSensitiveHeadline(head)) sens.push(`${p}: broad tier matched "${head.slice(0, 80)}"`);
  }
  console.log(sens.length
    ? `Sensitivity tiers (advisory — they suppress stock imagery and engagement CTAs in the autopost; they do not block publishing):\n  ${sens.join("\n  ")}\n`
    : "Sensitivity tiers: no match\n");

  const plans = {};
  const probes = new Map();
  for (const p of platforms) {
    const cfg = manifest.platforms[p];
    const file = await resolveVideo(cfg.video || args.video);
    if (!probes.has(file)) probes.set(file, probe(file));
    const info = probes.get(file);
    plans[p] = { ...plan(p, cfg, file, info, { id }), file, info };
  }

  // Credential liveness: YouTube is the only client with a read-only probe.
  // Everything else is config-presence only — reported as UNVERIFIED, not passing.
  if (platforms.includes("youtube") && isYouTubeConfigured()) {
    try {
      const ch = await getChannelInfo();
      console.log(`YouTube token: LIVE — channel "${ch?.title}" (${ch?.channelId})`);
    } catch (err) { plans.youtube.errors.push(`YouTube token check failed: ${err.message}`); }
  }
  const unverified = platforms.filter((p) => p !== "youtube");
  if (unverified.length) console.log(`Tokens for ${unverified.join(", ")}: configured, liveness UNVERIFIED until publish`);
  console.log("");

  for (const p of platforms) {
    const { payload, errors, warnings, info, file } = plans[p];
    console.log(`── ${p.toUpperCase()} ${errors.length ? "✗ FAIL" : "✓ ready"} ─────────────────────────`);
    console.log(`  file: ${file}`);
    if (info.ok) console.log(`        ${info.bytes} bytes · ${info.video} · audio ${info.audio} · ${info.secs.toFixed(2)}s`);
    const shown = { ...payload };
    delete shown.filePath;
    for (const [k, v] of Object.entries(shown)) {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      console.log(`  ${k}:${s.includes("\n") ? "\n    " + s.replace(/\n/g, "\n    ") : " " + s}`);
    }
    if (plans[p].staged) console.log(`  staged at publish: ${plans[p].staged} (removed after)`);
    for (const w of warnings) console.log(`  ⚠ ${w}`);
    for (const e of errors) console.log(`  ✗ ${e}`);
    console.log("");
  }

  const failing = platforms.filter((p) => plans[p].errors.length);
  if (!args.publish) {
    console.log(failing.length
      ? `DRY RUN: ${failing.length} platform(s) would be refused: ${failing.join(", ")}. Nothing was sent.`
      : "DRY RUN: all platforms valid. Nothing was sent. Re-run with --publish to post.");
    process.exitCode = failing.length ? 1 : 0;
    return;
  }
  if (failing.length) {
    throw new Error(`refusing to publish — fix these first: ${failing.join(", ")}`);
  }

  const results = [];
  for (const p of platforms) {
    try {
      const r = await publishOne(p, plans[p]);
      results.push({ platform: p, status: "posted", id: r.id, url: r.url });
      console.log(`✓ ${p}: ${r.url} (id ${r.id})`);
    } catch (err) {
      const hint = p === "bluesky" && /already_exists|JOB_STATE_COMPLETED/i.test(err.message)
        ? " — these bytes are now poisoned on Bluesky; remux (ffmpeg -c copy -movflags +faststart) and retry that copy"
        : "";
      results.push({ platform: p, status: "failed", error: err.message });
      console.log(`✗ ${p}: ${err.message}${hint}`);
    }
  }

  const logFile = args.log || path.join(path.dirname(VIDEOS_DIR), "manual-posts", `${id}.json`);
  mkdirSync(path.dirname(logFile), { recursive: true });
  writeFileSync(logFile, JSON.stringify({ id, at: new Date().toISOString(), results }, null, 2));
  console.log(`\nresults logged to ${logFile}`);
  process.exitCode = results.some((r) => r.status !== "posted") ? 1 : 0;
}

main().catch((err) => {
  console.error(`manualPost: ${err.message}`);
  process.exitCode = 1;
});
