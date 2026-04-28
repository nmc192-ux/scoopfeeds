/**
 * videoGenerator.js — Satori-rendered slide-show video pipeline.
 *
 * For each article we produce a 35-45 second vertical MP4 (1080 × 1920):
 *   Slide 1 (8s)  — Title card: category ribbon + headline + source badge
 *   Slide 2 (8s)  — Key point 1
 *   Slide 3 (8s)  — Key point 2
 *   Slide 4 (8s)  — Key point 3
 *   Slide 5 (5s)  — CTA: "Full story at scoopfeeds.com"
 *
 * Slide PNGs are rendered by Satori (zero runtime deps beyond what's already
 * installed for OG cards). FFmpeg stitches them into a video and multiplexes
 * the TTS audio track.
 *
 * Required env:
 *   (none — works in silent/text-only mode by default)
 *
 * Optional env:
 *   FFMPEG_PATH     — path to ffmpeg binary (auto-detected via PATH if absent)
 *   OPENAI_API_KEY  — enables OpenAI TTS voice-over
 *   ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID — ElevenLabs TTS alternative
 *   GOOGLE_TTS_KEY  — Google Cloud TTS fallback
 */

import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { execSync, spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "node:module";
import { logger } from "./logger.js";
import { generateTts, buildVideoScript } from "./ttsService.js";

// CommonJS bridge — needed to load packages that only export the binary path
// via require() (e.g. @ffmpeg-installer/ffmpeg).
const require = createRequire(import.meta.url);

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");
const FONT_DIR     = path.join(BACKEND_ROOT, "assets", "fonts");
const DATA_DIR     = path.join(BACKEND_ROOT, "data");
const VIDEOS_DIR   = path.join(DATA_DIR, "videos");
const FRAMES_DIR   = path.join(DATA_DIR, "_frames"); // temp slides

for (const d of [VIDEOS_DIR, FRAMES_DIR]) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

// ─── Font loading (reuse Inter fonts already present for OG cards) ──────────
function loadFont(filename) {
  const p = path.join(FONT_DIR, filename);
  try { return readFileSync(p); }
  catch { logger.warn(`videoGenerator: font missing at ${p}`); return null; }
}
const FONT_BOLD     = loadFont("Inter-Bold.otf");
const FONT_SEMIBOLD = loadFont("Inter-SemiBold.otf");
const fontsReady    = Boolean(FONT_BOLD && FONT_SEMIBOLD);

const FONTS = fontsReady ? [
  { name: "Inter", data: FONT_SEMIBOLD, weight: 600, style: "normal" },
  { name: "Inter", data: FONT_BOLD,     weight: 700, style: "normal" },
] : [];

// ─── Category colours (matches cardRenderer.js) ─────────────────────────────
const CAT_COLORS = {
  top:             "#DC2626",  politics:       "#7C3AED",
  pakistan:        "#059669",  international:  "#2563EB",
  science:         "#0891B2",  medicine:       "#DB2777",
  "public-health": "#EA580C",  health:         "#F59E0B",
  environment:     "#16A34A",  "self-help":    "#9333EA",
  sports:          "#EF4444",  cars:           "#475569",
  ai:              "#0EA5E9",
};
const catColor = (cat) => CAT_COLORS[cat] || "#2563EB";

// ─── FFmpeg detection ────────────────────────────────────────────────────────
// Resolution order:
//   1. FFMPEG_PATH env var (user-supplied)
//   2. system `ffmpeg` on PATH (works on most VPS / dev boxes)
//   3. @ffmpeg-installer/ffmpeg bundled static binary (works on managed
//      hosts like Hostinger Cloud where there's no shell + no apt-get)
//
// The bundled binary is loaded lazily so the dependency is optional — if it
// isn't installed (e.g. older deploy), we still fall through cleanly.
let _ffmpegPath = undefined; // undefined = unresolved, null = resolved-to-not-found
function resolveBundledFFmpeg() {
  try { return require("@ffmpeg-installer/ffmpeg")?.path || null; }
  catch { return null; }
}

export function getFFmpegPath() {
  if (_ffmpegPath !== undefined) return _ffmpegPath;
  if (process.env.FFMPEG_PATH) { _ffmpegPath = process.env.FFMPEG_PATH; return _ffmpegPath; }
  // Try the system PATH first — fastest, no Node-package overhead.
  try {
    const found = execSync("which ffmpeg 2>/dev/null || where ffmpeg 2>NUL", {
      stdio: ["pipe","pipe","pipe"],
    }).toString().trim().split("\n")[0];
    if (found) { _ffmpegPath = found; return _ffmpegPath; }
  } catch {}
  // Fall back to the bundled static binary.
  _ffmpegPath = resolveBundledFFmpeg();
  if (_ffmpegPath) logger.info(`videoGenerator: using bundled @ffmpeg-installer/ffmpeg → ${_ffmpegPath}`);
  return _ffmpegPath;
}

// Probe spawn() once per process. Some managed Node.js hosts (Hostinger
// Cloud, App Platform, Render free, etc.) ship with kernel-level fork
// restrictions (RLIMIT_NPROC ~ 0 for the user) — the binary path resolves
// fine but every spawn() call returns EAGAIN. We probe on first check and
// cache the result so cron jobs/admin endpoints fail fast instead of churning.
let _spawnOk = undefined;
function canSpawn() {
  if (_spawnOk !== undefined) return _spawnOk;
  try {
    // Minimal probe — fork+exec the simplest possible command. Same kernel
    // path as the real ffmpeg call, so if this works the render will too.
    execSync("true", { stdio: "ignore", timeout: 2000 });
    _spawnOk = true;
  } catch (err) {
    _spawnOk = false;
    logger.warn(`videoGenerator: subprocess execution blocked on this host (${err.code || err.message}). Video pipeline will no-op until deployed to a host that allows spawn() (any VPS, Docker, or self-hosted env).`);
  }
  return _spawnOk;
}

export function isVideoConfigured() {
  if (!fontsReady)        return false;
  if (!getFFmpegPath())   return false;
  return canSpawn();
}

// ─── Bullet extraction ───────────────────────────────────────────────────────
// Pulls 3 punchy sentences from the article body for the key-point slides.
// The naive "first 3 sentences" approach we shipped initially picked up too
// much boilerplate (datelines, "Read more →", attribution-only sentences),
// so this version scores sentences and picks the top 3 distinct ones.
const BOILERPLATE_PATTERNS = [
  /^read more/i,
  /^subscribe/i,
  /^follow (us|me)/i,
  /^click (here|to)/i,
  /^sign up/i,
  /^advertisement/i,
  /^image:/i,
  /^photo:/i,
  /^©/,
  /^all rights reserved/i,
  /^this (article|story) (is|was)/i,
  /^the (associated press|ap|reuters|afp)/i,
  /^\(reuters\)/i,
  /^\(ap\)/i,
];

function isBoilerplate(s) {
  return BOILERPLATE_PATTERNS.some(re => re.test(s));
}

// Score: rewards info density (numbers, named entities) and length sweet-spot.
function scoreSentence(s) {
  let score = 0;
  // Length sweet spot: 60-110 chars reads cleanly on a 1080×1920 slide.
  const len = s.length;
  if (len >= 60 && len <= 110) score += 4;
  else if (len >= 50 && len <= 130) score += 2;
  else if (len < 30 || len > 160) return -10;
  // Numbers / stats are concrete and visually scannable.
  if (/\b\d/.test(s)) score += 2;
  if (/\b\d+(?:[.,]\d+)?\s?(?:%|percent|million|billion|thousand|m|bn|k)\b/i.test(s)) score += 3;
  // Named entities (proper nouns) → higher information density.
  const properNouns = (s.match(/\b[A-Z][a-z]+/g) || []).length;
  if (properNouns >= 2) score += 2;
  // Penalize sentences that start with pronouns — usually need preceding context.
  if (/^(it|he|she|they|this|that|these|those)\b/i.test(s)) score -= 2;
  // Penalize attribution-only sentences ("said John Smith.")
  if (/^(said|added|noted|told|wrote|tweeted|posted)\b/i.test(s)) score -= 4;
  // Penalize question-only ("Why does this matter?") — better for headers, not bullets.
  if (s.endsWith("?") && len < 60) score -= 1;
  return score;
}

// Light dedup: don't pick two sentences that share a >5-word ngram.
function tooSimilar(a, b) {
  const wordsA = a.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  const wordsB = b.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  const setB = new Set(wordsB);
  let overlap = 0;
  for (const w of wordsA) if (setB.has(w)) overlap++;
  // 60%+ word overlap = effectively the same point.
  return overlap >= Math.min(wordsA.length, wordsB.length) * 0.6;
}

export function extractBullets(article) {
  const raw = String(article.content || article.description || article.title || "");
  // Strip HTML tags, normalise whitespace, drop common dateline patterns
  // ("WASHINGTON, April 26 (Reuters) - ...").
  const text = raw
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[A-Z][A-Z\s,]+\d+\s*\([^)]+\)\s*[-—–]\s*/, "")
    .trim();

  const titleLower = (article.title || "").toLowerCase().replace(/\s+/g, " ").trim();

  const candidates = text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map(s => s.trim().replace(/^[-—–•·]\s*/, ""))
    .filter(s => s.length >= 30 && s.length <= 220 && !isBoilerplate(s))
    // Don't echo the title back as a bullet.
    .filter(s => s.toLowerCase().replace(/\s+/g, " ").trim() !== titleLower)
    .map(s => ({ s, score: scoreSentence(s) }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const picked = [];
  for (const c of candidates) {
    if (picked.some(p => tooSimilar(p, c.s))) continue;
    picked.push(c.s);
    if (picked.length === 3) break;
  }

  // Fallbacks if scoring didn't yield 3 — top up with whatever sentences we have.
  if (picked.length < 3) {
    const fallback = text
      .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
      .map(s => s.trim())
      .filter(s => s.length >= 30 && s.length <= 220 && !picked.includes(s));
    while (picked.length < 3 && fallback.length > 0) picked.push(fallback.shift());
  }
  while (picked.length < 3) picked.push(article.title || "Read more at scoopfeeds.com");

  // Trim to readable length on a slide (110 chars max with ellipsis).
  return picked.slice(0, 3).map(s => {
    const clean = s.replace(/\s+/g, " ").trim();
    return clean.length > 110 ? clean.slice(0, 107) + "…" : clean;
  });
}

// ─── Satori slide renderers ──────────────────────────────────────────────────
const W = 1080, H = 1920;

// Build a subtle radial gradient background — pulls the category accent
// up from the bottom-left into the dark slate field. Reads as "premium"
// vs the original flat slate-900, costs nothing to render.
function gradientBg(accent) {
  // Convert #RRGGBB → rgba with alpha so satori CSS engine accepts it.
  const hex = (accent || "#2563EB").replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (
    `radial-gradient(circle at 20% 100%, rgba(${r},${g},${b},0.35) 0%, ` +
    `rgba(${r},${g},${b},0.1) 35%, #0f172a 70%)`
  );
}

function slideContainer(bg, children) {
  return {
    type: "div",
    props: {
      style: {
        display: "flex", flexDirection: "column", alignItems: "center",
        width: W, height: H, background: bg, position: "relative", overflow: "hidden",
      },
      children,
    },
  };
}

// Slide 1 — Title card
function slide1(article) {
  const color = catColor(article.category);
  const label = (article.category || "NEWS").toUpperCase().replace(/-/g, " ");
  const title = article.title || "";
  const src   = article.source_name || "Scoop";

  return slideContainer(gradientBg(color), [
    // Top category ribbon
    {
      type: "div",
      props: {
        style: {
          display: "flex", alignItems: "center", justifyContent: "center",
          width: W, height: 90, background: color,
          fontSize: 34, fontWeight: 700, color: "#fff", letterSpacing: 3,
          fontFamily: "Inter",
        },
        children: [{ type: "span", props: { children: label } }],
      },
    },
    // Headline + accent line
    {
      type: "div",
      props: {
        style: {
          display: "flex", flex: 1, flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          padding: "60px 80px", gap: 36,
        },
        children: [
          {
            type: "span",
            props: {
              style: {
                fontSize: 72, fontWeight: 700, color: "#f1f5f9", lineHeight: 1.25,
                textAlign: "center", fontFamily: "Inter",
              },
              children: title,
            },
          },
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                width: 140, height: 6, background: color, borderRadius: 3,
              },
              children: [],
            },
          },
        ],
      },
    },
    // Source badge
    {
      type: "div",
      props: {
        style: {
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "0 80px 60px", gap: 16, width: W,
        },
        children: [
          {
            type: "div",
            props: {
              style: {
                display: "flex", alignItems: "center",
                background: "rgba(255,255,255,0.1)", borderRadius: 40,
                padding: "14px 32px",
              },
              children: [{
                type: "span",
                props: {
                  style: { fontSize: 32, color: "#94a3b8", fontFamily: "Inter", fontWeight: 600 },
                  children: `via ${src}`,
                },
              }],
            },
          },
          {
            type: "div",
            props: {
              style: {
                display: "flex", alignItems: "center",
                background: color, borderRadius: 40, padding: "14px 32px",
              },
              children: [{
                type: "span",
                props: {
                  style: { fontSize: 32, color: "#fff", fontFamily: "Inter", fontWeight: 700 },
                  children: "Scoop",
                },
              }],
            },
          },
        ],
      },
    },
  ]);
}

// Slides 2–4 — Key points
function slidePoint(num, text, color) {
  return slideContainer(gradientBg(color), [
    // Number badge
    {
      type: "div",
      props: {
        style: {
          display: "flex", alignItems: "center", justifyContent: "center",
          width: W, paddingTop: 200,
        },
        children: [{
          type: "div",
          props: {
            style: {
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 120, height: 120, borderRadius: 60, background: color,
              fontSize: 56, fontWeight: 700, color: "#fff", fontFamily: "Inter",
            },
            children: [{ type: "span", props: { children: String(num) } }],
          },
        }],
      },
    },
    // Point label
    {
      type: "div",
      props: {
        style: {
          display: "flex", alignItems: "center", justifyContent: "center",
          paddingTop: 40,
        },
        children: [{
          type: "span",
          props: {
            style: { fontSize: 32, color, fontFamily: "Inter", fontWeight: 700, letterSpacing: 2 },
            children: `KEY POINT ${num}`,
          },
        }],
      },
    },
    // Divider — satori requires `display` on every div even with empty children.
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          width: 100, height: 4, background: color, borderRadius: 2,
          marginTop: 32, marginBottom: 60,
        },
        children: [],
      },
    },
    // Text
    {
      type: "div",
      props: {
        style: {
          display: "flex", flex: 1, alignItems: "center",
          padding: "0 90px", textAlign: "center",
        },
        children: [{
          type: "span",
          props: {
            style: {
              fontSize: 58, fontWeight: 600, color: "#e2e8f0",
              lineHeight: 1.4, fontFamily: "Inter", textAlign: "center",
            },
            children: text,
          },
        }],
      },
    },
    // Scoop watermark
    {
      type: "div",
      props: {
        style: {
          display: "flex", justifyContent: "center", paddingBottom: 100,
        },
        children: [{
          type: "span",
          props: {
            style: { fontSize: 28, color: "rgba(255,255,255,0.25)", fontFamily: "Inter" },
            children: "Scoop • scoopfeeds.com",
          },
        }],
      },
    },
  ]);
}

// Slide 5 — CTA
function slideCta(color) {
  return slideContainer(color, [
    {
      type: "div",
      props: {
        style: {
          display: "flex", flex: 1, flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 40,
          padding: "80px",
        },
        children: [
          {
            type: "span",
            props: {
              style: {
                fontSize: 56, fontWeight: 700, color: "#fff", fontFamily: "Inter",
                textAlign: "center", lineHeight: 1.3,
              },
              children: "Want the full story?",
            },
          },
          {
            type: "span",
            props: {
              style: {
                fontSize: 46, fontWeight: 700, color: "#fff", fontFamily: "Inter",
                textAlign: "center",
                background: "rgba(0,0,0,0.25)", borderRadius: 20,
                padding: "20px 40px",
              },
              children: "scoopfeeds.com",
            },
          },
          {
            type: "span",
            props: {
              style: {
                fontSize: 36, color: "rgba(255,255,255,0.85)", fontFamily: "Inter",
                textAlign: "center",
              },
              children: "News, sniffed out. 🐾",
            },
          },
        ],
      },
    },
  ]);
}

// ─── Render one slide to PNG ─────────────────────────────────────────────────
async function renderSlide(tree, outputPath) {
  if (!fontsReady) throw new Error("videoGenerator: fonts not loaded");
  const svg = await satori(tree, {
    width: W, height: H,
    fonts: FONTS,
    embedFont: true,
  });
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: W },
    imageRendering: 1,
  });
  const pngData = resvg.render().asPng();
  writeFileSync(outputPath, pngData);
  return outputPath;
}

// ─── FFmpeg slideshow composer ───────────────────────────────────────────────
const SLIDE_DURATIONS = [8, 8, 8, 8, 5]; // seconds per slide

// Quote a single shell arg the POSIX-safe way — wrap in single quotes and
// escape any embedded single quote as '"'"'. Used for shell-mode spawn below.
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

async function runFFmpeg(args, ffmpegPath) {
  // Shell-mode invocation: required on managed Node.js hosts (Hostinger Cloud,
  // App Platform, etc.) whose seccomp/AppArmor profile blocks direct execve
  // of binaries from /home/... but permits /bin/sh -c. The single-quote
  // shellQuote wrapper makes injection impossible since all args (file paths,
  // ffmpeg flags) are quoted before concatenation.
  const cmd = [ffmpegPath, ...args].map(shellQuote).join(" ");
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
    proc.on("error", reject);
  });
}

// Crossfade duration between slides — short enough to feel snappy on Shorts/
// TikTok but long enough that the transition reads on first watch. 0.4s is a
// well-tested sweet spot for vertical news content.
const XFADE_DURATION = 0.4;

// xfade was added in ffmpeg 4.3 (Dec 2020). Older bundles like
// @ffmpeg-installer/ffmpeg@1.1.0 ship 4.2.x which fails with
// "No such filter: 'xfade'". Probe the version once and fall back to hard
// cuts (concat) when xfade isn't available so videos still render.
let _supportsXfade = undefined; // undefined = unprobed
function supportsXfade() {
  if (_supportsXfade !== undefined) return _supportsXfade;
  const ff = getFFmpegPath();
  if (!ff) { _supportsXfade = false; return _supportsXfade; }
  try {
    // -filters lists every available filter. Cheaper + more reliable than
    // parsing version numbers (some custom builds skip filters even on 4.3+).
    const out = execSync(`"${ff}" -hide_banner -filters 2>&1`, {
      stdio: ["pipe","pipe","pipe"],
      timeout: 5000,
    }).toString();
    _supportsXfade = / xfade /i.test(out) || /\sxfade\s/.test(out);
    if (!_supportsXfade) {
      logger.warn(`videoGenerator: ffmpeg lacks 'xfade' filter — falling back to hard cuts (no transitions)`);
    }
  } catch (err) {
    logger.warn(`videoGenerator: filter probe failed (${err.message}) — assuming no xfade`);
    _supportsXfade = false;
  }
  return _supportsXfade;
}

// Build a filter_complex that scales each slide then chains xfade transitions
// between them. The math is fiddly because xfade's `offset` is measured from
// the *combined* timeline of all preceding clips (already including their
// xfade overlaps), not from the start of clip N. See:
//   https://ffmpeg.org/ffmpeg-filters.html#xfade
function buildSlideshowFilter(slidePaths, durations) {
  // No-xfade fallback: scale each slide and concat them with hard cuts.
  // Visually less polished but works on every ffmpeg ≥ 2.1.
  if (!supportsXfade()) {
    const n = slidePaths.length;
    const parts = [];
    for (let i = 0; i < n; i++) {
      parts.push(
        `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=#0f172a,setsar=1,` +
        `format=yuv420p,fps=25[s${i}]`
      );
    }
    if (n === 1) {
      parts.push(`[s0]copy[out]`);
      return { filter: parts.join("; "), totalDuration: durations[0] };
    }
    const concatInputs = Array.from({ length: n }, (_, i) => `[s${i}]`).join("");
    parts.push(`${concatInputs}concat=n=${n}:v=1:a=0[out]`);
    const totalDuration = durations.reduce((a, b) => a + b, 0);
    return { filter: parts.join("; "), totalDuration };
  }

  const n = slidePaths.length;
  const parts = [];

  // 1. Scale each slide to canonical 1080×1920 + sane SAR.
  for (let i = 0; i < n; i++) {
    parts.push(
      `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=#0f172a,setsar=1,` +
      `format=yuv420p,fps=25[s${i}]`
    );
  }

  // 2. Chain xfades. For slide 0+1 with durations d0,d1 the offset is
  //    (d0 - XFADE). For each subsequent xfade the offset is the cumulative
  //    output length minus XFADE.
  if (n === 1) {
    parts.push(`[s0]copy[out]`);
    return { filter: parts.join("; "), totalDuration: durations[0] };
  }

  // First xfade: s0 → s1
  let offset = durations[0] - XFADE_DURATION;
  parts.push(
    `[s0][s1]xfade=transition=fade:duration=${XFADE_DURATION}:` +
    `offset=${offset.toFixed(3)}[xf1]`
  );

  // Cumulative output duration after the first xfade: d0 + d1 - XFADE
  let cumulative = durations[0] + durations[1] - XFADE_DURATION;

  // Subsequent xfades chain off the previous xfade output.
  for (let i = 2; i < n; i++) {
    const prev = `xf${i - 1}`;
    const curr = i === n - 1 ? "out" : `xf${i}`;
    offset = cumulative - XFADE_DURATION;
    parts.push(
      `[${prev}][s${i}]xfade=transition=fade:duration=${XFADE_DURATION}:` +
      `offset=${offset.toFixed(3)}[${curr}]`
    );
    cumulative += durations[i] - XFADE_DURATION;
  }

  // If only 2 slides, the first xfade was already labelled [xf1] but we want [out].
  if (n === 2) {
    // Replace the label of the only xfade.
    parts[parts.length - 1] = parts[parts.length - 1].replace("[xf1]", "[out]");
  }

  return { filter: parts.join("; "), totalDuration: cumulative };
}

async function composeVideo(slidePaths, audioPath, outputPath, ffmpegPath) {
  const args = ["-y", "-loglevel", "warning"];

  // Image inputs (one per slide, looped for the slide's duration)
  for (let i = 0; i < slidePaths.length; i++) {
    args.push("-loop", "1", "-t", String(SLIDE_DURATIONS[i]), "-i", slidePaths[i]);
  }

  // Audio input (optional)
  const hasAudio = audioPath && existsSync(audioPath);
  if (hasAudio) args.push("-i", audioPath);

  const { filter, totalDuration } = buildSlideshowFilter(slidePaths, SLIDE_DURATIONS);
  args.push("-filter_complex", filter);
  args.push("-map", "[out]");
  if (hasAudio) {
    args.push("-map", `${slidePaths.length}:a`);
  }

  args.push(
    "-t",        totalDuration.toFixed(3),
    "-c:v",      "libx264",
    "-preset",   "fast",
    "-crf",      "23",
    "-pix_fmt",  "yuv420p",
    "-movflags", "+faststart",
    "-r",        "25",
  );
  if (hasAudio) {
    args.push("-c:a", "aac", "-b:a", "128k", "-shortest");
  } else {
    args.push("-an");
  }

  args.push(outputPath);
  await runFFmpeg(args, ffmpegPath);
  return totalDuration;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a vertical MP4 for the given article.
 * Returns { outputPath, durationSecs, hasAudio, slideCount } on success.
 * Returns null if video generation is not configured (no ffmpeg or no fonts).
 */
export async function generateVideo(article) {
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    logger.debug("videoGenerator: ffmpeg not available, skipping");
    return null;
  }
  if (!fontsReady) {
    logger.warn("videoGenerator: Inter fonts not found in assets/fonts/, skipping");
    return null;
  }

  const id         = article.id;
  const outputPath = path.join(VIDEOS_DIR, `${id}-shorts.mp4`);

  // Don't re-render if already exists
  if (existsSync(outputPath)) {
    return { outputPath, cached: true };
  }

  const color   = catColor(article.category);
  const bullets = extractBullets(article);

  // 1. Render slides
  const slideFiles = [];
  const slideTime  = Date.now();
  try {
    const slides = [
      { tree: slide1(article),                  file: `${id}_s1.png` },
      { tree: slidePoint(1, bullets[0], color), file: `${id}_s2.png` },
      { tree: slidePoint(2, bullets[1], color), file: `${id}_s3.png` },
      { tree: slidePoint(3, bullets[2], color), file: `${id}_s4.png` },
      { tree: slideCta(color),                  file: `${id}_s5.png` },
    ];
    for (const s of slides) {
      const p = path.join(FRAMES_DIR, s.file);
      await renderSlide(s.tree, p);
      slideFiles.push(p);
    }
    logger.debug(`videoGenerator: rendered ${slideFiles.length} slides in ${Date.now() - slideTime}ms`);
  } catch (err) {
    logger.error(`videoGenerator: slide render failed for ${id}: ${err.message}`);
    throw err;
  }

  // 2. Generate TTS (optional — null if not configured)
  let audioPath = null;
  try {
    const script = buildVideoScript(article, bullets);
    audioPath = await generateTts(script, id);
    if (audioPath) logger.debug(`videoGenerator: TTS audio at ${audioPath}`);
  } catch (err) {
    logger.warn(`videoGenerator: TTS failed for ${id}: ${err.message} — continuing silent`);
    audioPath = null;
  }

  // 3. Compose video with ffmpeg
  const composeStart = Date.now();
  let actualDuration = SLIDE_DURATIONS.reduce((a, b) => a + b, 0);
  try {
    actualDuration = await composeVideo(slideFiles, audioPath, outputPath, ffmpegPath) || actualDuration;
    logger.info(`videoGenerator: rendered "${article.title?.slice(0, 60)}" in ${Date.now() - composeStart}ms → ${outputPath}`);
  } catch (err) {
    logger.error(`videoGenerator: ffmpeg failed for ${id}: ${err.message}`);
    throw err;
  } finally {
    // Clean up temp slide PNGs
    for (const f of slideFiles) {
      try { unlinkSync(f); } catch {}
    }
  }

  return {
    outputPath,
    durationSecs: Math.round(actualDuration * 10) / 10,
    hasAudio: Boolean(audioPath),
    slideCount: slideFiles.length,
  };
}

// ─── Recap video pipeline ────────────────────────────────────────────────────
// Daily "Top 5 stories" / weekly "This week in {topic}" — single MP4 covering
// multiple articles. Higher retention than single-story clips and the format
// platforms (YouTube Shorts, TikTok, Reels) reward with broader distribution.

const RECAP_SLIDE_DURATIONS = [5, 10, 10, 10, 10, 10, 5]; // intro + 5 items + outro = 60s

// Intro slide — "Top 5 stories" + date, branded. 5s.
function slideRecapIntro(label, dateStr, accent = "#DC2626") {
  return slideContainer(gradientBg(accent), [
    {
      type: "div",
      props: {
        style: {
          display: "flex", flex: 1, flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 30,
          padding: "0 80px",
        },
        children: [
          {
            type: "div",
            props: {
              style: {
                display: "flex", alignItems: "center", justifyContent: "center",
                background: accent, borderRadius: 999, padding: "12px 36px",
              },
              children: [{
                type: "span",
                props: {
                  style: { fontSize: 28, color: "#fff", fontFamily: "Inter", fontWeight: 700, letterSpacing: 3 },
                  children: "SCOOP RECAP",
                },
              }],
            },
          },
          {
            type: "span",
            props: {
              style: {
                fontSize: 96, fontWeight: 700, color: "#f1f5f9", fontFamily: "Inter",
                lineHeight: 1.1, textAlign: "center",
              },
              children: label,
            },
          },
          {
            type: "span",
            props: {
              style: { fontSize: 36, color: "#94a3b8", fontFamily: "Inter", fontWeight: 600, marginTop: 20 },
              children: dateStr,
            },
          },
        ],
      },
    },
  ]);
}

// Per-article recap slide — large numeric badge + category + headline + source. 10s.
function slideRecapItem(num, article, accent = "#DC2626") {
  const color = catColor(article.category);
  const cat   = (article.category || "NEWS").toUpperCase().replace(/-/g, " ");
  const title = (article.title || "").slice(0, 160);
  const src   = article.source_name || "";

  return slideContainer(gradientBg(color), [
    // Top: big number + category ribbon
    {
      type: "div",
      props: {
        style: {
          display: "flex", alignItems: "center", justifyContent: "flex-start",
          width: W, padding: "100px 70px 0", gap: 40,
        },
        children: [
          {
            type: "div",
            props: {
              style: {
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 180, height: 180, borderRadius: 90, background: accent,
              },
              children: [{
                type: "span",
                props: {
                  style: { fontSize: 110, fontWeight: 700, color: "#fff", fontFamily: "Inter" },
                  children: String(num),
                },
              }],
            },
          },
          {
            type: "div",
            props: {
              style: {
                display: "flex", alignItems: "center", justifyContent: "center",
                background: color, borderRadius: 12, padding: "14px 28px",
              },
              children: [{
                type: "span",
                props: {
                  style: { fontSize: 32, fontWeight: 700, color: "#fff", fontFamily: "Inter", letterSpacing: 2 },
                  children: cat,
                },
              }],
            },
          },
        ],
      },
    },
    // Headline
    {
      type: "div",
      props: {
        style: {
          display: "flex", flex: 1, alignItems: "center",
          padding: "60px 70px",
        },
        children: [{
          type: "span",
          props: {
            style: {
              fontSize: 68, fontWeight: 700, color: "#f1f5f9", lineHeight: 1.25,
              fontFamily: "Inter",
            },
            children: title,
          },
        }],
      },
    },
    // Source + Scoop watermark
    {
      type: "div",
      props: {
        style: {
          display: "flex", justifyContent: "space-between", alignItems: "center",
          width: W, padding: "0 70px 90px",
        },
        children: [
          {
            type: "span",
            props: {
              style: { fontSize: 32, color: "#94a3b8", fontFamily: "Inter", fontWeight: 600 },
              children: src ? `via ${src}` : "",
            },
          },
          {
            type: "span",
            props: {
              style: { fontSize: 30, color: "rgba(255,255,255,0.35)", fontFamily: "Inter", fontWeight: 600 },
              children: "scoopfeeds.com",
            },
          },
        ],
      },
    },
  ]);
}

// Build a ~120-word TTS narration string for the recap.
export function buildRecapScript(articles, label = "Today's top stories") {
  const intro = `${label} on Scoop. Here's what you need to know.`;
  const lines = articles.slice(0, 5).map((a, i) => {
    const headline = (a.title || "").replace(/\s+/g, " ").trim().slice(0, 140);
    return `Number ${i + 1}: ${headline}.`;
  });
  const outro = "Get the full reporting at scoopfeeds dot com. News, sniffed out.";
  return [intro, ...lines, outro].join(" ");
}

/**
 * Generate a recap MP4 covering up to 5 articles.
 *
 * @param {Object} opts
 * @param {Array} opts.articles  — up to 5 articles
 * @param {string} opts.label    — "Top 5 stories" or "This week in AI"
 * @param {string} opts.slug     — output filename slug (e.g. "daily-2026-04-26")
 * @param {string} [opts.accent] — accent colour, defaults to brand red
 *
 * Returns { outputPath, durationSecs, hasAudio, slideCount } or null if not configured.
 */
export async function generateRecapVideo({ articles, label, slug, accent = "#DC2626" }) {
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    logger.debug("videoGenerator (recap): ffmpeg not available, skipping");
    return null;
  }
  if (!fontsReady) {
    logger.warn("videoGenerator (recap): Inter fonts not found, skipping");
    return null;
  }
  if (!Array.isArray(articles) || articles.length < 3) {
    throw new Error(`recap needs at least 3 articles, got ${articles?.length || 0}`);
  }

  const items      = articles.slice(0, 5);
  const safeSlug   = String(slug || `recap-${Date.now()}`).replace(/[^a-z0-9_-]/gi, "_");
  const outputPath = path.join(VIDEOS_DIR, `${safeSlug}.mp4`);
  if (existsSync(outputPath)) {
    return { outputPath, cached: true };
  }

  const dateStr = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  // 1. Build slide trees (intro + 5 items + outro). Pad with the last article
  //    if fewer than 5 items, so the schedule of 7 slides * RECAP_SLIDE_DURATIONS lines up.
  const slideTrees = [
    { tree: slideRecapIntro(label, dateStr, accent), file: `${safeSlug}_intro.png` },
  ];
  for (let i = 0; i < 5; i++) {
    const a = items[i] || items[items.length - 1];
    slideTrees.push({
      tree: slideRecapItem(i + 1, a, accent),
      file: `${safeSlug}_item${i + 1}.png`,
    });
  }
  slideTrees.push({ tree: slideCta(accent), file: `${safeSlug}_cta.png` });

  // 2. Render each slide to PNG.
  const slideFiles = [];
  const renderStart = Date.now();
  try {
    for (const s of slideTrees) {
      const p = path.join(FRAMES_DIR, s.file);
      await renderSlide(s.tree, p);
      slideFiles.push(p);
    }
    logger.debug(`videoGenerator (recap): rendered ${slideFiles.length} slides in ${Date.now() - renderStart}ms`);
  } catch (err) {
    logger.error(`videoGenerator (recap): slide render failed: ${err.message}`);
    throw err;
  }

  // 3. TTS narration (optional).
  let audioPath = null;
  try {
    const script = buildRecapScript(items, label);
    audioPath = await generateTts(script, safeSlug);
  } catch (err) {
    logger.warn(`videoGenerator (recap): TTS failed: ${err.message} — continuing silent`);
    audioPath = null;
  }

  // 4. Compose the recap with the recap-specific durations.
  const composeStart = Date.now();
  let actualDuration = RECAP_SLIDE_DURATIONS.reduce((a, b) => a + b, 0);
  try {
    actualDuration = await composeVideoWithDurations(
      slideFiles, RECAP_SLIDE_DURATIONS, audioPath, outputPath, ffmpegPath
    ) || actualDuration;
    logger.info(`videoGenerator (recap): "${label}" rendered in ${Date.now() - composeStart}ms → ${outputPath}`);
  } catch (err) {
    logger.error(`videoGenerator (recap): ffmpeg failed: ${err.message}`);
    throw err;
  } finally {
    for (const f of slideFiles) { try { unlinkSync(f); } catch {} }
  }

  return {
    outputPath,
    durationSecs: Math.round(actualDuration * 10) / 10,
    hasAudio: Boolean(audioPath),
    slideCount: slideFiles.length,
  };
}

// Variant of composeVideo that accepts a per-slide durations array. Lets the
// recap pipeline use slide-specific timings without forking the whole composer.
// Uses the same xfade chaining as composeVideo so transitions are consistent
// across single-article shorts, recaps, and live-event videos.
async function composeVideoWithDurations(slidePaths, durations, audioPath, outputPath, ffmpegPath) {
  const args = ["-y", "-loglevel", "warning"];
  for (let i = 0; i < slidePaths.length; i++) {
    args.push("-loop", "1", "-t", String(durations[i]), "-i", slidePaths[i]);
  }
  const hasAudio = audioPath && existsSync(audioPath);
  if (hasAudio) args.push("-i", audioPath);

  const { filter, totalDuration } = buildSlideshowFilter(slidePaths, durations);
  args.push("-filter_complex", filter);
  args.push("-map", "[out]");
  if (hasAudio) args.push("-map", `${slidePaths.length}:a`);

  args.push(
    "-t",        totalDuration.toFixed(3),
    "-c:v",      "libx264",
    "-preset",   "fast",
    "-crf",      "23",
    "-pix_fmt",  "yuv420p",
    "-movflags", "+faststart",
    "-r",        "25",
  );
  if (hasAudio) args.push("-c:a", "aac", "-b:a", "128k", "-shortest");
  else          args.push("-an");
  args.push(outputPath);
  await runFFmpeg(args, ffmpegPath);
  return totalDuration;
}

// ─── Live-event video pipeline ───────────────────────────────────────────────
// Renders a 60s vertical MP4 from a synthesized live-event dossier:
//   intro (5s) → 4 brief points (10s each) → metrics tile (10s) → CTA (5s)
// = 60s total. Pulls directly from the LiveEvents brief/metrics so we get
// editorial framing for free (no extra LLM calls). Output goes to
// data/videos/live-{eventId}-{date}.mp4 for human review before publishing.

const LIVE_EVENT_DURATIONS = [5, 10, 10, 10, 10, 10, 5]; // = 60s

// Intro slide for a live event — pulse-styled "LIVE" badge + event title.
function slideLiveIntro(event) {
  const accent = "#DC2626"; // brand red
  const label  = (event.title || "Live event").slice(0, 80);
  const sub    = (event.subtitle || event.region || "").slice(0, 60);
  return slideContainer(gradientBg(accent), [
    {
      type: "div",
      props: {
        style: {
          display: "flex", flex: 1, flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 30,
          padding: "0 80px",
        },
        children: [
          {
            type: "div",
            props: {
              style: {
                display: "flex", alignItems: "center", justifyContent: "center", gap: 16,
                background: accent, borderRadius: 999, padding: "14px 40px",
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      width: 18, height: 18, borderRadius: 9, background: "#fff",
                    },
                    children: [],
                  },
                },
                {
                  type: "span",
                  props: {
                    style: { fontSize: 36, color: "#fff", fontFamily: "Inter", fontWeight: 700, letterSpacing: 4 },
                    children: "LIVE",
                  },
                },
              ],
            },
          },
          {
            type: "span",
            props: {
              style: {
                fontSize: 84, fontWeight: 700, color: "#f1f5f9", fontFamily: "Inter",
                lineHeight: 1.15, textAlign: "center", marginTop: 20,
              },
              children: `${event.emoji ? event.emoji + " " : ""}${label}`,
            },
          },
          sub ? {
            type: "span",
            props: {
              style: { fontSize: 38, color: "#94a3b8", fontFamily: "Inter", fontWeight: 600 },
              children: sub,
            },
          } : null,
          {
            type: "span",
            props: {
              style: { fontSize: 30, color: "rgba(255,255,255,0.45)", fontFamily: "Inter", fontWeight: 600, marginTop: 24 },
              children: "Scoop · live updates",
            },
          },
        ].filter(Boolean),
      },
    },
  ]);
}

// Per-point slide for the dossier — large bullet number + timestamped text.
function slideLivePoint(num, point) {
  const text = (point?.text || "").slice(0, 220);
  const ts   = point?.timestamp || point?.at || null;
  const when = ts ? new Date(ts).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  }) : "";
  return slideContainer(gradientBg("#DC2626"), [
    {
      type: "div",
      props: {
        style: {
          display: "flex", alignItems: "center", justifyContent: "flex-start",
          width: W, padding: "120px 70px 0", gap: 32,
        },
        children: [
          {
            type: "div",
            props: {
              style: {
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 100, height: 100, borderRadius: 16, background: "#DC2626",
              },
              children: [{
                type: "span",
                props: {
                  style: { fontSize: 64, fontWeight: 700, color: "#fff", fontFamily: "Inter" },
                  children: String(num),
                },
              }],
            },
          },
          when ? {
            type: "span",
            props: {
              style: { fontSize: 30, color: "#94a3b8", fontFamily: "Inter", fontWeight: 600 },
              children: when,
            },
          } : null,
        ].filter(Boolean),
      },
    },
    {
      type: "div",
      props: {
        style: {
          display: "flex", flex: 1, alignItems: "center",
          padding: "60px 70px",
        },
        children: [{
          type: "span",
          props: {
            style: {
              fontSize: 60, fontWeight: 700, color: "#f1f5f9", lineHeight: 1.3,
              fontFamily: "Inter",
            },
            children: text,
          },
        }],
      },
    },
    {
      type: "div",
      props: {
        style: {
          display: "flex", justifyContent: "flex-end",
          width: W, padding: "0 70px 90px",
        },
        children: [{
          type: "span",
          props: {
            style: { fontSize: 28, color: "rgba(255,255,255,0.35)", fontFamily: "Inter", fontWeight: 600 },
            children: "scoopfeeds.com",
          },
        }],
      },
    },
  ]);
}

// Metrics tile slide — up to 3 key metrics from the dossier.
function slideLiveMetrics(metrics = {}, accent = "#DC2626") {
  const entries = Object.entries(metrics).slice(0, 3);
  const tiles = entries.map(([key, m]) => {
    const value = m?.value != null ? String(m.value) : "—";
    const unit  = m?.unit  || "";
    const note  = m?.note  || (m?.source ? `via ${m.source}` : "");
    const label = key.replace(/_/g, " ");
    return {
      type: "div",
      props: {
        style: {
          display: "flex", flexDirection: "column", alignItems: "center",
          padding: "30px 40px", borderRadius: 22,
          background: "rgba(255,255,255,0.06)", marginBottom: 24,
          width: W - 160,
        },
        children: [
          {
            type: "span",
            props: {
              style: { fontSize: 26, color: "#94a3b8", fontFamily: "Inter", fontWeight: 700, letterSpacing: 3, textTransform: "uppercase" },
              children: label,
            },
          },
          {
            type: "span",
            props: {
              style: { fontSize: 76, fontWeight: 700, color: "#f1f5f9", fontFamily: "Inter", marginTop: 8 },
              children: `${value}${unit ? " " + unit : ""}`,
            },
          },
          note ? {
            type: "span",
            props: {
              style: { fontSize: 24, color: "rgba(255,255,255,0.45)", fontFamily: "Inter", fontWeight: 600, marginTop: 8 },
              children: note.slice(0, 70),
            },
          } : null,
        ].filter(Boolean),
      },
    };
  });

  return slideContainer(gradientBg(accent), [
    {
      type: "div",
      props: {
        style: {
          display: "flex", alignItems: "center", justifyContent: "center",
          width: W, paddingTop: 110,
        },
        children: [{
          type: "span",
          props: {
            style: { fontSize: 44, color: "#f1f5f9", fontFamily: "Inter", fontWeight: 700, letterSpacing: 3 },
            children: "BY THE NUMBERS",
          },
        }],
      },
    },
    {
      type: "div",
      props: {
        style: {
          display: "flex", flex: 1, flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 16,
        },
        children: tiles.length > 0 ? tiles : [{
          type: "span",
          props: {
            style: { fontSize: 38, color: "#94a3b8", fontFamily: "Inter", fontWeight: 600, padding: "0 80px", textAlign: "center" },
            children: "See the full breakdown at scoopfeeds.com",
          },
        }],
      },
    },
  ]);
}

// TTS narration: ~80-90 words for a 60s clip.
export function buildLiveEventScript(event, points) {
  const intro = `Live update on ${event.title}.`;
  const trimmed = points.slice(0, 4).map(p => {
    const t = (p.text || "").replace(/\s+/g, " ").trim();
    return t.length > 200 ? t.slice(0, 197) + "..." : t;
  });
  const outro = "For the full live dossier and source links, visit scoopfeeds dot com.";
  return [intro, ...trimmed, outro].join(" ");
}

/**
 * Render a 60s vertical MP4 from a live-event dossier.
 *
 * @param {Object} event — hydrated live event row { id, title, subtitle, emoji, brief: [...], metrics: {...} }
 * @param {Object} [opts]
 * @param {string} [opts.slug] — output filename slug (default: "live-{eventId}-{YYYY-MM-DD}")
 *
 * Returns { outputPath, durationSecs, hasAudio, slideCount } or null if not configured.
 */
export async function generateLiveEventVideo(event, opts = {}) {
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    logger.debug("videoGenerator (live): ffmpeg not available, skipping");
    return null;
  }
  if (!fontsReady) {
    logger.warn("videoGenerator (live): Inter fonts not found, skipping");
    return null;
  }
  if (!event || !event.id || !Array.isArray(event.brief) || event.brief.length < 2) {
    throw new Error(`live event needs at least 2 brief points; got ${event?.brief?.length || 0}`);
  }

  const points    = event.brief.slice(0, 4);
  const dateStamp = new Date().toISOString().slice(0, 10);
  const safeSlug  = String(opts.slug || `live-${event.id}-${dateStamp}`).replace(/[^a-z0-9_-]/gi, "_");
  const outputPath = path.join(VIDEOS_DIR, `${safeSlug}.mp4`);
  if (existsSync(outputPath)) {
    return { outputPath, cached: true };
  }

  // Pad to 4 points (repeat last) so the slide schedule lines up.
  while (points.length < 4) points.push(points[points.length - 1] || { text: "Live updates continue." });

  const slideTrees = [
    { tree: slideLiveIntro(event),                      file: `${safeSlug}_intro.png` },
    { tree: slideLivePoint(1, points[0]),               file: `${safeSlug}_p1.png`    },
    { tree: slideLivePoint(2, points[1]),               file: `${safeSlug}_p2.png`    },
    { tree: slideLivePoint(3, points[2]),               file: `${safeSlug}_p3.png`    },
    { tree: slideLivePoint(4, points[3]),               file: `${safeSlug}_p4.png`    },
    { tree: slideLiveMetrics(event.metrics || {}),      file: `${safeSlug}_metrics.png` },
    { tree: slideCta("#DC2626"),                         file: `${safeSlug}_cta.png`  },
  ];

  const slideFiles = [];
  const renderStart = Date.now();
  try {
    for (const s of slideTrees) {
      const p = path.join(FRAMES_DIR, s.file);
      await renderSlide(s.tree, p);
      slideFiles.push(p);
    }
    logger.debug(`videoGenerator (live): rendered ${slideFiles.length} slides in ${Date.now() - renderStart}ms`);
  } catch (err) {
    logger.error(`videoGenerator (live): slide render failed: ${err.message}`);
    throw err;
  }

  let audioPath = null;
  try {
    const script = buildLiveEventScript(event, points);
    audioPath = await generateTts(script, safeSlug);
  } catch (err) {
    logger.warn(`videoGenerator (live): TTS failed: ${err.message} — continuing silent`);
    audioPath = null;
  }

  const composeStart = Date.now();
  let actualDuration = LIVE_EVENT_DURATIONS.reduce((a, b) => a + b, 0);
  try {
    actualDuration = await composeVideoWithDurations(
      slideFiles, LIVE_EVENT_DURATIONS, audioPath, outputPath, ffmpegPath
    ) || actualDuration;
    logger.info(`videoGenerator (live): "${event.title}" rendered in ${Date.now() - composeStart}ms → ${outputPath}`);
  } catch (err) {
    logger.error(`videoGenerator (live): ffmpeg failed: ${err.message}`);
    throw err;
  } finally {
    for (const f of slideFiles) { try { unlinkSync(f); } catch {} }
  }

  return {
    outputPath,
    durationSecs: Math.round(actualDuration * 10) / 10,
    hasAudio: Boolean(audioPath),
    slideCount: slideFiles.length,
  };
}

/**
 * Dry run — render slides only, no audio, no ffmpeg. Returns a base64 preview
 * of the first slide PNG so the admin queue can show a thumbnail.
 */
export async function previewSlide(article) {
  if (!fontsReady) return null;
  try {
    const tree = slide1(article);
    const svg = await satori(tree, { width: W, height: H, fonts: FONTS, embedFont: true });
    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 400 } });
    return resvg.render().asPng().toString("base64");
  } catch { return null; }
}
