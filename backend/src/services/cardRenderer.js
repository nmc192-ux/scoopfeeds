// Generates branded PNG cards (OG / square / story) for each article using
// satori (JSX tree → SVG) + @resvg/resvg-js (SVG → PNG). Output is cached on
// disk keyed by article id + preset + a short content hash so edits invalidate.
//
// The card is intentionally typographic — no source image. Many publishers'
// hero images are licensed, so reusing them on our own cards is a copyright
// hazard. Clean headline + category badge + Scoop mark reads well on every
// platform and sidesteps the licensing problem.

import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";
import { getStockPhotoForArticle, stockPhotoAsDataUri, isStockPhotoEnabled } from "./stockPhoto.js";
import axios from "axios";

// ── Article-image fetcher ─────────────────────────────────────────────────────
// Used by the magazine-style square card. Fetches the article's own image_url,
// converts it to a base64 data URI, and caches it on disk so re-renders are fast.
// Returns null on any failure (network error, non-image, too large, etc.).
//
// News CDNs are hostile in three different ways and we have to handle each:
//   1. UA blocking — they reject non-browser User-Agents. Solved with a
//      realistic Chrome UA + Accept-Language + Accept headers.
//   2. Hotlink protection — many require Referer pointing at the publisher's
//      site (not the CDN itself). We use a generic search-engine Referer
//      (google.com/) which most CDNs accept and which mimics organic traffic.
//   3. URL-thumbnail problem — RSS feeds advertise tiny thumbnail URLs (BBC's
//      /240x135/ path, Hill's ?w=900). We rewrite these to high-res variants,
//      with a fallback to the original URL if the upscale doesn't work.
function upscaleKnownThumbnailUrl(url) {
  // Skip upscaling URLs with signed-token params — changing width breaks the
  // signature (Guardian: ?s=..., AWS-signed: ?X-Amz-Signature=..., etc.).
  if (/[?&](?:s|sig|signature|x-amz-signature|token)=/i.test(url)) return url;

  // BBC iChef: /images/ic/240x135/x.jpg → /images/ic/976x549/x.jpg
  // 976 is BBC's largest standard size; 1024 returns a 1-byte placeholder.
  let out = url.replace(
    /(\/images\/ic\/)\d{2,4}x\d{2,4}(\/[a-z0-9]+\.(?:jpg|jpeg|png|webp))/i,
    "$1976x549$2"
  );
  // BBC ace: /ace/standard/240/cpsprodpb/... → /ace/standard/976/cpsprodpb/...
  // Same CDN, different URL shape used for newer articles.
  if (out === url) {
    out = url.replace(
      /(\/ace\/(?:standard|landscape|portrait|square)\/)(\d{2,4})(\/cpsprodpb\/)/i,
      "$1976$3"
    );
  }
  // Generic query-param pattern: ?w=240 / &width=240 / ?size=300 → 1080.
  // Done last because it's the broadest match.
  if (out === url) {
    out = url.replace(/([?&](?:w|width|size))=\d{2,4}\b/gi, "$1=1080");
  }
  return out;
}

// JPEG / PNG / WebP magic-byte detector. Used to verify fetched bytes are an
// actual image (some CDNs return 200 with a 1-byte placeholder body when a
// requested size doesn't exist) and to normalise the MIME type for satori.
function detectImageMime(buf) {
  if (!buf || buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return "image/png";
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "image/jpeg";
  // WebP: "RIFF" .... "WEBP"
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
      && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "image/webp";
  // GIF: "GIF87a" / "GIF89a"
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  return null;
}

// Try fetching one URL — returns { buf, mime } or null. Uses axios because
// the native fetch shipped with Node 18 on Hostinger's container wasn't
// reliably reaching external CDNs (axios works through the same routing as
// Gemini calls, which we know are reachable).
async function tryFetchImage(urlToFetch, refererHint) {
  try {
    const referer = refererHint || "https://www.google.com/";
    const { data, status, headers } = await axios.get(urlToFetch, {
      responseType: "arraybuffer",
      timeout: 12000,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": referer,
      },
    });
    if (status >= 400) return null;
    const buf = Buffer.from(data);
    const mime = detectImageMime(buf);
    // Magic-byte sniff catches 1-byte CDN placeholders that pass content-type checks.
    if (!mime) return null;
    if (buf.length < 2500 || buf.length > 12 * 1024 * 1024) return null;
    return { buf, mime, contentType: headers?.["content-type"] || "" };
  } catch (err) {
    if (err.code !== "ECONNABORTED") {
      logger.warn(`card renderer: image fetch error for ${urlToFetch.slice(0, 80)}: ${err.message}`);
    }
    return null;
  }
}

// ── Smart photo picker — extract image candidates from article HTML ──────────
// Many articles ship a tiny RSS-thumbnail in image_url but embed a 1600px+
// hero in the article body. We scan the body's <img> tags for higher-quality
// candidates and return them in preference order.
function extractImageCandidatesFromHtml(html) {
  if (!html || typeof html !== "string") return [];
  const candidates = [];
  const seen = new Set();
  const add = (url) => {
    if (!url) return;
    const u = String(url).trim();
    if (!/^https?:\/\//i.test(u)) return;
    // Skip data URIs, tiny tracking pixels, common spacer/ad assets.
    if (/(?:^|\/)(?:1x1|spacer|pixel|blank|tracking|beacon)\b/i.test(u)) return;
    if (/\.(svg|gif)(\?|$)/i.test(u)) return;
    if (seen.has(u)) return;
    seen.add(u);
    candidates.push(u);
  };

  // <img src="..."> — most common
  const imgRe = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  // srcset="url1 1x, url2 2x" or "url1 320w, url2 800w" — pick the largest descriptor
  const srcsetRe = /<img\b[^>]*?\bsrcset\s*=\s*["']([^"']+)["'][^>]*>/gi;
  // <picture> <source srcset="..."> — same shape
  const sourceRe = /<source\b[^>]*?\bsrcset\s*=\s*["']([^"']+)["'][^>]*>/gi;
  // <meta property="og:image" content="..."> — high quality publisher hero
  const ogRe = /<meta\b[^>]*?\bproperty\s*=\s*["']og:image["'][^>]*?\bcontent\s*=\s*["']([^"']+)["']/gi;

  let m;
  while ((m = ogRe.exec(html))) add(m[1]);
  while ((m = srcsetRe.exec(html))) {
    // Pick the URL with the largest descriptor (e.g. "https://… 1600w").
    const set = m[1].split(",").map(s => s.trim()).filter(Boolean);
    let best = null;
    let bestSize = -1;
    for (const entry of set) {
      const parts = entry.split(/\s+/);
      const url = parts[0];
      const desc = parts[1] || "";
      const num = parseInt(desc, 10) || 0;
      if (num > bestSize) { bestSize = num; best = url; }
    }
    add(best);
  }
  while ((m = sourceRe.exec(html))) {
    const set = m[1].split(",").map(s => s.trim()).filter(Boolean);
    let best = null, bestSize = -1;
    for (const entry of set) {
      const parts = entry.split(/\s+/);
      const num = parseInt(parts[1] || "0", 10) || 0;
      if (num > bestSize) { bestSize = num; best = parts[0]; }
    }
    add(best);
  }
  while ((m = imgRe.exec(html))) add(m[1]);

  return candidates.slice(0, 6); // cap to avoid runaway fetches
}

async function fetchArticlePhotoDataUri(article, imgCacheDir) {
  const primary = article.image_url;
  // Build a candidate fetch list: original URL, upscaled variant, then HTML
  // body candidates (smart photo picker). Tries each in order until one
  // produces a valid image.
  const candidates = [];
  const pushUnique = (u) => { if (u && !candidates.includes(u)) candidates.push(u); };
  if (primary && /^https?:\/\//i.test(primary)) {
    const upscaled = upscaleKnownThumbnailUrl(primary);
    if (upscaled !== primary) pushUnique(upscaled);
    pushUnique(primary);
  }
  for (const c of extractImageCandidatesFromHtml(article.content || "")) pushUnique(c);
  if (candidates.length === 0) return null;

  if (!existsSync(imgCacheDir)) mkdirSync(imgCacheDir, { recursive: true });

  // Cache key: hash of the full candidate list (so changes in candidates
  // invalidate the cached photo on next render).
  const urlHash = createHash("sha1").update(candidates.join("|")).digest("hex").slice(0, 20);

  // Return cached version if present.
  for (const [ext, mime] of [
    [".jpg", "image/jpeg"],
    [".png", "image/png"],
  ]) {
    const p = path.join(imgCacheDir, `${urlHash}${ext}`);
    if (existsSync(p)) {
      try {
        const buf = readFileSync(p);
        return `data:${mime};base64,${buf.toString("base64")}`;
      } catch { /* fall through */ }
    }
  }

  // Use the article's source domain as Referer when possible — looks like
  // organic on-site browsing and slips past most hotlink protections.
  let referer = "https://www.google.com/";
  if (article.url) {
    try { referer = new URL(article.url).origin + "/"; } catch {}
  }

  for (const url of candidates) {
    const result = await tryFetchImage(url, referer);
    if (!result) continue;
    // Satori only handles JPEG / PNG. Skip WebP/GIF/AVIF — try next candidate.
    if (result.mime !== "image/jpeg" && result.mime !== "image/png") continue;
    const ext = result.mime === "image/png" ? ".png" : ".jpg";
    const cachePath = path.join(imgCacheDir, `${urlHash}${ext}`);
    try { writeFileSync(cachePath, result.buf); } catch {}
    logger.info(`card renderer: photo OK for ${article.id} via ${url.slice(0, 80)} (${result.buf.length}b ${result.mime})`);
    return `data:${result.mime};base64,${result.buf.toString("base64")}`;
  }

  logger.warn(`card renderer: no usable photo from ${candidates.length} candidate(s) for ${article.id} (primary=${(primary || "none").slice(0, 80)})`);
  return null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const BACKEND_ROOT = path.resolve(__dirname, "../..");

// Cards live under SCOOP_PERSISTENT_DATA_DIR when set so they survive
// Hostinger redeploys. Without persistence, every deploy wiped 600+ cached
// PNGs → first request after deploy triggers cold render (~500-1500ms) →
// Facebook's photo URL fetcher would time out and silently fall back to a
// link post (no image visible on FB). Persisting the cache eliminates that
// cold-render window entirely.
const CARDS_DIR = process.env.SCOOP_PERSISTENT_DATA_DIR
  ? path.join(path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR), "cards")
  : path.join(BACKEND_ROOT, "data", "cards");
if (!existsSync(CARDS_DIR)) mkdirSync(CARDS_DIR, { recursive: true });

const FONT_DIR = path.join(BACKEND_ROOT, "assets", "fonts");
const FONT_SEMIBOLD = readFontOnce(path.join(FONT_DIR, "Inter-SemiBold.otf"));
const FONT_BOLD     = readFontOnce(path.join(FONT_DIR, "Inter-Bold.otf"));

function readFontOnce(p) {
  try { return readFileSync(p); }
  catch (e) {
    logger.warn(`card renderer: font missing at ${p} — card rendering disabled`);
    return null;
  }
}

export function isCardRendererReady() {
  return Boolean(FONT_SEMIBOLD && FONT_BOLD);
}

// Preset dimensions chosen to match the platform's native aspect ratios so we
// don't get center-cropped weirdly. OG is the Open Graph standard; square is
// IG feed; story is IG/FB/TikTok stories and the Shorts thumbnail frame.
// carousel1/2/3 are the three slides of an IG/Threads 1:1 carousel sequence.
//
// Sizing notes for the redesigned hero cards (og/square/story):
//   - headlineSize is the *target* size; layout reserves enough vertical
//     space that 3-line headlines fit without truncation push.
//   - padding is the inner content padding INSIDE the top accent bar; the
//     accent bar itself sits flush at the top edge.
export const PRESETS = {
  og:        { width: 1200, height: 630,  headlineSize: 64, padding: 64 },
  square:    { width: 1080, height: 1080, headlineSize: 78, padding: 80 },
  story:     { width: 1080, height: 1920, headlineSize: 92, padding: 96 },
  carousel1: { width: 1080, height: 1080, headlineSize: 56, padding: 72 }, // cover
  carousel2: { width: 1080, height: 1080, headlineSize: 36, padding: 72 }, // key points
  carousel3: { width: 1080, height: 1080, headlineSize: 62, padding: 72 }, // CTA
};

const CATEGORY_COLORS = {
  top:            "#DC2626",
  politics:       "#7C3AED",
  pakistan:       "#059669",
  international:  "#2563EB",
  science:        "#0891B2",
  medicine:       "#DB2777",
  "public-health":"#EA580C",
  health:         "#F59E0B",
  environment:    "#16A34A",
  "self-help":    "#9333EA",
  sports:         "#EF4444",
  cars:           "#475569",
  ai:             "#0EA5E9",
};

const CATEGORY_LABELS = {
  top: "TOP STORIES",
  politics: "POLITICS",
  pakistan: "PAKISTAN",
  international: "WORLD",
  science: "SCIENCE",
  medicine: "MEDICINE",
  "public-health": "PUBLIC HEALTH",
  health: "HEALTH",
  environment: "ENVIRONMENT",
  "self-help": "SELF-HELP",
  sports: "SPORTS",
  cars: "AUTOMOTIVE",
  ai: "AI",
};

function labelFor(category) {
  if (!category) return "NEWS";
  return CATEGORY_LABELS[category] || String(category).toUpperCase();
}

function colorFor(category) {
  return CATEGORY_COLORS[category] || "#DC2626";
}

function truncate(s, limit) {
  const str = String(s || "").trim();
  if (str.length <= limit) return str;
  return str.slice(0, Math.max(0, limit - 1)).trimEnd() + "…";
}

function headlineCap(preset) {
  // Per-preset headline character budget — tuned so text fills ~3 lines at
  // the configured font size without overflowing the hero region. The square
  // preset is tighter because we now reserve space below the headline for a
  // 2-line description teaser.
  if (preset === "og") return 120;
  if (preset === "square") return 100; // reduced — description teaser below
  return 200;
}

// Format a unix-ms timestamp as "Apr 27" — short, locale-free, fits the
// footer attribution row alongside the source name.
const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function formatShortDate(input) {
  if (!input && input !== 0) return "";
  const d = typeof input === "number" ? new Date(input) : new Date(input);
  if (isNaN(d.getTime())) return "";
  return `${MONTH_ABBR[d.getMonth()]} ${d.getUTCDate ? d.getDate() : d.getDate()}`;
}

// ── Carousel helpers ──────────────────────────────────────────────────────────

// Extract up to `count` sentence-level bullets from the article description.
// Falls back to title if description is thin. Each bullet is capped at 160 chars.
function extractBullets(article, count = 3) {
  const raw = (article.description || article.content || "").replace(/\s+/g, " ").trim();
  const sentences = raw
    .split(/\.\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 45 && s.length < 300);
  const picked = sentences.slice(0, count).map(s =>
    truncate(s.endsWith(".") ? s : s + ".", 160)
  );
  while (picked.length < count) picked.push(truncate(article.title, 160));
  return picked;
}

// Renders a row of pagination dots (active dot wider + colored).
function paginationDots(activeIndex, total, color) {
  return {
    type: "div",
    props: {
      style: { display: "flex", gap: 8, alignItems: "center" },
      children: Array.from({ length: total }, (_, i) => ({
        type: "div",
        props: {
          style: {
            display: "flex",
            width: i === activeIndex ? 28 : 10,
            height: 10,
            borderRadius: 999,
            backgroundColor: i === activeIndex ? color : "#3F3F46",
          },
        },
      })),
    },
  };
}

// Reusable "scoopfeeds" wordmark node.
function scoopWordmark(color) {
  return {
    type: "div",
    props: {
      style: { display: "flex", fontSize: 26, fontWeight: 700, letterSpacing: -0.5 },
      children: [
        { type: "span", props: { style: { display: "flex", color }, children: "scoop" } },
        { type: "span", props: { style: { display: "flex", color: "#A1A1AA" }, children: "feeds" } },
      ],
    },
  };
}

// Base dark card style shared across all 3 carousel slides.
function carouselBase(color) {
  return {
    width: 1080,
    height: 1080,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    padding: 72,
    backgroundColor: "#0B0B0D",
    backgroundImage: `linear-gradient(135deg, #0B0B0D 0%, #1A1A1F 60%, ${color}22 100%)`,
    color: "#F5F5F7",
    fontFamily: "Inter",
  };
}

function buildCarouselTree(article, slide) {
  const color = colorFor(article.category);
  const label = labelFor(article.category);
  const source = article.source_name ? `Via ${article.source_name}` : "";
  const dots = paginationDots(slide - 1, 3, color);
  const mark = scoopWordmark(color);
  const base = carouselBase(color);

  const categoryPill = {
    type: "div",
    props: {
      style: {
        display: "flex", backgroundColor: color, color: "#fff",
        padding: "10px 22px", borderRadius: 999,
        fontSize: 20, fontWeight: 700, letterSpacing: 2,
      },
      children: label,
    },
  };

  const topRow = (leftNode) => ({
    type: "div",
    props: {
      style: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" },
      children: [leftNode, mark],
    },
  });

  if (slide === 1) {
    // Slide 1: Cover — headline front-and-center with category badge.
    const headline = truncate(article.title, 160);
    return {
      type: "div",
      props: {
        style: base,
        children: [
          topRow(categoryPill),
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                flexGrow: 1,
                alignItems: "center",
                fontSize: 56,
                fontWeight: 700,
                lineHeight: 1.2,
                letterSpacing: -1,
                color: "#F5F5F7",
                paddingTop: 24,
                paddingBottom: 24,
              },
              children: headline,
            },
          },
          {
            type: "div",
            props: {
              style: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", fontSize: 20, color: "#A1A1AA" },
              children: [
                { type: "div", props: { style: { display: "flex" }, children: source } },
                dots,
              ],
            },
          },
        ],
      },
    };
  }

  if (slide === 2) {
    // Slide 2: Key Points — 3 sentence bullets from description.
    const bullets = extractBullets(article);
    const bulletNodes = bullets.map(b => ({
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 20, marginBottom: 36 },
        children: [
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                width: 10,
                height: 10,
                borderRadius: 999,
                backgroundColor: color,
                marginTop: 13,
                flexShrink: 0,
              },
            },
          },
          {
            type: "div",
            props: {
              style: { display: "flex", fontSize: 30, fontWeight: 600, lineHeight: 1.45, color: "#E4E4E7" },
              children: b,
            },
          },
        ],
      },
    }));

    const keyPointsBadge = {
      type: "div",
      props: {
        style: {
          display: "flex",
          backgroundColor: color + "22",
          color,
          padding: "8px 20px",
          borderRadius: 999,
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: 3,
          borderWidth: 2,
          borderStyle: "solid",
          borderColor: color,
        },
        children: "KEY POINTS",
      },
    };

    return {
      type: "div",
      props: {
        style: base,
        children: [
          topRow(keyPointsBadge),
          {
            type: "div",
            props: {
              style: { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", paddingTop: 20, paddingBottom: 20 },
              children: bulletNodes,
            },
          },
          {
            type: "div",
            props: {
              style: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", fontSize: 18, color: "#71717A" },
              children: [
                { type: "div", props: { style: { display: "flex" }, children: truncate(article.title, 60) } },
                dots,
              ],
            },
          },
        ],
      },
    };
  }

  // Slide 3: CTA — read the full story.
  const siteDomain = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com")
    .replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return {
    type: "div",
    props: {
      style: base,
      children: [
        topRow(categoryPill),
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", gap: 28 },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", fontSize: 36, fontWeight: 600, color: "#A1A1AA", letterSpacing: -0.5 },
                  children: "Read the full story at",
                },
              },
              // URL with color underline accent div below it
              {
                type: "div",
                props: {
                  style: { display: "flex", flexDirection: "column", gap: 10 },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: { display: "flex", fontSize: 62, fontWeight: 700, color: "#F5F5F7", letterSpacing: -2 },
                        children: siteDomain,
                      },
                    },
                    { type: "div", props: { style: { display: "flex", height: 5, backgroundColor: color, borderRadius: 3, width: "100%" } } },
                  ],
                },
              },
              {
                type: "div",
                props: {
                  style: { display: "flex", fontSize: 24, fontWeight: 600, color: "#52525B" },
                  children: truncate(article.title, 100),
                },
              },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", fontSize: 20, color: "#71717A" },
            children: [
              { type: "div", props: { style: { display: "flex" }, children: "News, sniffed out." } },
              dots,
            ],
          },
        },
      ],
    },
  };
}

// Hash that invalidates the cache if the headline, category, or description
// changes — or when the card design version bumps (CARD_DESIGN_VER).
// Bump CARD_DESIGN_VER whenever the visual layout changes so stale cached
// PNGs are never served alongside the new design.
const CARD_DESIGN_VER = "v10"; // bumped: photo path now opt-in (CARD_USE_ARTICLE_PHOTO=1) — typographic by default

function contentHash(article, preset) {
  const h = createHash("sha1");
  h.update(CARD_DESIGN_VER);
  h.update("|");
  h.update(String(article.title || ""));
  h.update("|");
  h.update(String(article.category || ""));
  h.update("|");
  h.update(String(article.source_name || ""));
  h.update("|");
  // Include first 80 chars of description so the teaser re-renders when
  // the description is corrected/enriched after first ingest.
  h.update(String(article.description || "").slice(0, 80));
  // For the magazine square card, also hash the image URL so the card
  // invalidates when the article's image changes (e.g. after enrichment).
  if (preset === "square" || preset === "carousel1") {
    h.update("|");
    h.update(String(article.image_url || ""));
    // Tags drive the selective word-highlighting on the typographic path
    // so we hash them too — change tags → re-render with new highlights.
    h.update("|");
    let tagStr = "";
    try {
      const arr = Array.isArray(article.tags) ? article.tags : JSON.parse(article.tags || "[]");
      tagStr = arr.slice(0, 5).join(",");
    } catch { tagStr = ""; }
    h.update(tagStr);
  }
  return h.digest("hex").slice(0, 10);
}

function cachePath(articleId, preset, hash) {
  const safeId = String(articleId).replace(/[^a-z0-9_-]/gi, "_").slice(0, 120);
  return path.join(CARDS_DIR, `${safeId}-${preset}-${hash}.png`);
}

// ── Magazine-style square card ───────────────────────────────────────────────
//
// Instagram 1080×1080 card that looks like a polished editorial photo-post.
// Two render paths:
//
//   1. Photo path (article image_url loaded successfully) — full-bleed photo
//      background + dark bottom gradient + headline overlay.
//
//   2. Typographic path (no photo OR resvg can't decode it) — vibrant
//      category-colored gradient background + selective WORD HIGHLIGHTING
//      (1-2 keywords from article tags get a white background pill behind
//      them, à la editorial magazine covers).
//
// Both paths use the same top bar + bottom footer structure so cards in a
// feed read as cohesive even when some have photos and others don't.

// Pick 1-2 keywords from the article to highlight in the headline. Drawn
// from article tags first (more specific), then capitalised proper nouns
// from the headline. Skips category-name + generic news vocab so we don't
// get vacuous "POLITICS" highlighted on a politics post.
function pickHighlightKeywords(article, headline) {
  const out = new Set();
  const headLower = String(headline || "").toLowerCase();
  const cat = String(article.category || "").toLowerCase();

  // Generic words that add no editorial weight when highlighted.
  const NOISE = new Set([
    "news", "story", "report", "update", "breaking", "live", "latest",
    "today", "yesterday", "watch", "video", "photos", "the", "and", "with",
    "from", "after", "before", "during", "amid", "over", "about",
    "global", "world", "international", "national",
  ]);

  // Try article.tags first (most editorially-curated source).
  let tags = [];
  try { tags = Array.isArray(article.tags) ? article.tags : JSON.parse(article.tags || "[]"); } catch {}
  for (const tag of tags) {
    const t = String(tag || "").trim();
    if (!t) continue;
    const tl = t.toLowerCase();
    if (tl === cat || NOISE.has(tl)) continue;
    if (t.length < 3 || t.length > 18) continue;
    // Tag must actually appear (case-insensitive) in the headline to highlight.
    if (!headLower.includes(tl)) continue;
    out.add(tl);
    if (out.size >= 2) break;
  }

  // Fallback: proper-noun capitalised words in the headline (≥4 chars).
  if (out.size === 0) {
    const properNouns = [...String(headline || "").matchAll(/\b([A-Z][a-z]{3,15})\b/g)].map(m => m[1].toLowerCase());
    for (const p of properNouns) {
      if (NOISE.has(p) || p === cat) continue;
      out.add(p);
      if (out.size >= 1) break; // just one fallback to avoid over-highlighting
    }
  }

  return [...out];
}

// Tokenise a headline into nodes for satori, applying highlight styling to
// any token whose lowercased word (sans trailing punctuation) is in `highlights`.
// Returns an array of satori div nodes, suitable for use as flex-wrap children.
function buildHighlightedHeadlineNodes(headline, highlights, opts) {
  const { fontSize = 92, color = "#FFFFFF", highlightBg = "#FFFFFF", highlightFg = "#0A0A0C" } = opts || {};
  const set = new Set(highlights.map(h => h.toLowerCase()));
  if (!headline) return [];

  // Split on whitespace, preserving punctuation attached to words. Each
  // token becomes a flex-item div; satori's flex-wrap handles line-breaks.
  const tokens = headline.split(/\s+/);
  return tokens.map((token) => {
    const stripped = token.toLowerCase().replace(/[.,;:!?'""()]/g, "");
    const isHi = set.has(stripped);
    return {
      type: "div",
      props: {
        style: {
          display: "flex",
          fontSize,
          fontWeight: 700,
          letterSpacing: -2,
          lineHeight: 1.04,
          color: isHi ? highlightFg : color,
          backgroundColor: isHi ? highlightBg : "transparent",
          paddingLeft:  isHi ? 14 : 0,
          paddingRight: isHi ? 14 : 0,
          paddingTop:   isHi ? 2  : 0,
          paddingBottom:isHi ? 2  : 0,
          borderRadius: isHi ? 8 : 0,
        },
        children: token,
      },
    };
  });
}

function buildSquareMagazineTree(article, bgDataUri) {
  const W = 1080, H = 1080;
  const PAD = 60;
  const color = colorFor(article.category);
  const label = labelFor(article.category);
  const source = article.source_name || "";

  // Headline: 92px Inter Bold for typographic-only path (no photo); slightly
  // smaller (88px) when a photo is the focal point. Up to 110 chars → ~3 lines.
  const headline = truncate(article.title, 110);
  const dateStr = formatShortDate(article.published_at);
  const highlights = pickHighlightKeywords(article, headline);

  // ── Top row: wordmark left, category pill right ───────────────────────
  const topRow = {
    type: "div",
    props: {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        width: "100%",
      },
      children: [
        // scoopfeeds wordmark — pill background so it reads on any photo
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "baseline",
              backgroundColor: "rgba(0,0,0,0.50)",
              paddingTop: 10,
              paddingBottom: 10,
              paddingLeft: 18,
              paddingRight: 18,
              borderRadius: 999,
            },
            children: [
              { type: "span", props: { style: { display: "flex", fontSize: 26, fontWeight: 700, color: "#FFFFFF", letterSpacing: -0.3 }, children: "scoop" } },
              { type: "span", props: { style: { display: "flex", fontSize: 26, fontWeight: 700, color: "rgba(255,255,255,0.65)" }, children: "feeds" } },
            ],
          },
        },
        // Category badge
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              backgroundColor: color,
              color: "#fff",
              paddingTop: 10,
              paddingBottom: 10,
              paddingLeft: 22,
              paddingRight: 22,
              borderRadius: 999,
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: 2,
            },
            children: label,
          },
        },
      ],
    },
  };

  // ── Footer row: scoopfeeds.com left, "Source · Date" right ───────────
  const footerRow = {
    type: "div",
    props: {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        width: "100%",
      },
      children: [
        {
          type: "div",
          props: {
            style: { display: "flex", fontSize: 24, fontWeight: 700, color: "#FFFFFF", letterSpacing: -0.2 },
            children: "scoopfeeds.com",
          },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", fontSize: 22, fontWeight: 600, color: "rgba(255,255,255,0.65)", letterSpacing: 0.2 },
            children: [source, dateStr].filter(Boolean).join(" · "),
          },
        },
      ],
    },
  };

  // ── Headline section — flex-wrap of per-word nodes so highlighted tokens
  // can carry a background pill independently. Uses a slightly smaller font
  // when a photo is the focal point (88px) vs. typographic-only (94px).
  const headlineFontSize = bgDataUri ? 86 : 94;
  const headlineNodes = buildHighlightedHeadlineNodes(headline, highlights, {
    fontSize: headlineFontSize,
    color: "#FFFFFF",
    // For the no-photo path we use the category color as the highlight bg
    // (more visually energetic than plain white). For the photo path we use
    // white because category-color highlights would compete with the photo.
    highlightBg: bgDataUri ? "#FFFFFF" : color,
    highlightFg: bgDataUri ? "#0A0A0C" : "#FFFFFF",
  });

  const headlineSection = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexWrap: "wrap",
        width: "100%",
        rowGap: 8,
        columnGap: 18,
        alignItems: "center",
      },
      children: headlineNodes,
    },
  };

  // ── Bottom section: headline + footer (used in both render paths) ─────
  const bottomSection = {
    type: "div",
    props: {
      style: { display: "flex", flexDirection: "column", width: "100%", gap: 28 },
      children: [headlineSection, footerRow],
    },
  };

  // When we have a background photo, layer photo → gradient → content.
  if (bgDataUri) {
    return {
      type: "div",
      props: {
        style: {
          width: W,
          height: H,
          display: "flex",
          position: "relative",
          backgroundColor: "#0A0A0C",
          fontFamily: "Inter",
          color: "#FFFFFF",
        },
        children: [
          // Layer 1: article photo (full bleed)
          {
            type: "img",
            props: {
              src: bgDataUri,
              width: W,
              height: H,
              style: {
                position: "absolute",
                top: 0,
                left: 0,
                width: W,
                height: H,
                objectFit: "cover",
              },
            },
          },
          // Layer 2: gradient — heavy at bottom where text lives, very light at top
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                top: 0,
                left: 0,
                width: W,
                height: H,
                display: "flex",
                backgroundImage:
                  "linear-gradient(180deg," +
                  "rgba(0,0,0,0.55) 0%," +
                  "rgba(0,0,0,0.08) 28%," +
                  "rgba(0,0,0,0.10) 42%," +
                  "rgba(0,0,0,0.72) 62%," +
                  "rgba(0,0,0,0.96) 100%)",
              },
            },
          },
          // Layer 3: thin category-colour accent line at very bottom edge
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                bottom: 0,
                left: 0,
                width: W,
                height: 6,
                display: "flex",
                backgroundColor: color,
              },
            },
          },
          // Layer 4: content (topRow + bottomSection, space-between)
          {
            type: "div",
            props: {
              style: {
                position: "relative",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                width: W,
                height: H,
                paddingTop: PAD,
                paddingBottom: PAD + 6, // clear the accent line
                paddingLeft: PAD,
                paddingRight: PAD,
              },
              children: [topRow, bottomSection],
            },
          },
        ],
      },
    };
  }

  // Typographic-only path (no photo): vibrant category-coloured gradient
  // background. Three layered gradients give the card depth and brand
  // identity while keeping headline contrast readable:
  //   1. Bottom-anchored radial bloom in category colour — hero of the card
  //   2. Top-left subtle bloom — adds depth on the upper half
  //   3. Vertical near-black fade — keeps the top-bar pills legible
  return {
    type: "div",
    props: {
      style: {
        width: W,
        height: H,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: "#0A0A0C",
        backgroundImage:
          `radial-gradient(ellipse 110% 75% at 50% 105%, ${color}AA 0%, ${color}55 28%, ${color}1A 55%, transparent 80%),` +
          `radial-gradient(ellipse 70% 55% at 18% 12%, ${color}40 0%, ${color}10 40%, transparent 70%),` +
          `linear-gradient(180deg, #0A0A0C 0%, #0E0E13 40%, #14141B 100%)`,
        paddingTop: PAD,
        paddingBottom: PAD,
        paddingLeft: PAD,
        paddingRight: PAD,
        fontFamily: "Inter",
        color: "#FFFFFF",
      },
      children: [topRow, bottomSection],
    },
  };
}

// World-class card layout — typographic hero with editorial polish:
//
//   ████████████████████████████████   ← top accent bar (category color)
//   [POLITICS]              scoopfeeds.com
//
//   ▌ Bold headline takes the
//   ▌ visual real estate with
//   ▌ tight, confident type
//
//   ──────────────────────────────────
//   Via BBC News · Apr 27   News, sniffed out.
//
// Design choices:
//   - Top accent stripe (8-12px) gives the card a "branded publication"
//     read at a glance — same trick the FT, Bloomberg, Axios use.
//   - Radial highlight in the top-right blooms the category color into
//     the corner without dominating, adds depth vs the old flat gradient.
//   - Left vertical accent stripe before the headline is the editorial
//     "here's what matters" signal — pulls the eye straight to the hero.
//   - Footer divider hairline + small-caps source attribution + date
//     reads as press-quality vs the old single-row attribution.
function buildTree(article, preset, opts = {}) {
  // Carousel slide 1 (cover) shares the magazine photo-background layout
  // with the standalone square card so the cover slide visually matches the
  // single-image post style. Slides 2 and 3 stay typographic for legibility
  // of the bullet points and CTA.
  if (preset === "carousel1" || preset === "square") {
    return buildSquareMagazineTree(article, opts.bgDataUri || null);
  }
  if (preset.startsWith("carousel")) {
    const slide = parseInt(preset.replace("carousel", ""), 10);
    if (slide >= 2 && slide <= 3) return buildCarouselTree(article, slide);
  }

  const dims = PRESETS[preset];
  const color = colorFor(article.category);
  const label = labelFor(article.category);
  const headline = truncate(article.title, headlineCap(preset));
  const source = article.source_name || "";
  const dateStr = formatShortDate(article.published_at);
  const bgDataUri = opts.bgDataUri || null;

  // Per-preset visual scale.
  const isStory = preset === "story";
  const accentBarH = isStory ? 14 : (preset === "square" ? 12 : 10);
  const stripeWidth = isStory ? 10 : 8;
  const pillFont = isStory ? 26 : (preset === "square" ? 24 : 20);
  const wordmarkFont = isStory ? 32 : (preset === "square" ? 30 : 24);
  const footerFont = isStory ? 26 : (preset === "square" ? 24 : 20);
  const taglineFont = isStory ? 22 : (preset === "square" ? 20 : 18);

  // The top accent bar lives flush against the top edge; the rest of the
  // content sits in a padded body container below it.
  const topAccentBar = {
    type: "div",
    props: {
      style: {
        display: "flex",
        width: "100%",
        height: accentBarH,
        backgroundColor: color,
        flexShrink: 0,
      },
    },
  };

  // Header row: category pill + scoopfeeds wordmark.
  const headerRow = {
    type: "div",
    props: {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        width: "100%",
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              backgroundColor: color,
              color: "#FFFFFF",
              paddingTop: isStory ? 12 : 8,
              paddingBottom: isStory ? 12 : 8,
              paddingLeft: isStory ? 26 : 20,
              paddingRight: isStory ? 26 : 20,
              borderRadius: 999,
              fontSize: pillFont,
              fontWeight: 700,
              letterSpacing: 2.5,
            },
            children: label,
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              fontSize: wordmarkFont,
              fontWeight: 700,
              letterSpacing: -0.5,
            },
            children: [
              { type: "span", props: { style: { display: "flex", color }, children: "scoop" } },
              { type: "span", props: { style: { display: "flex", color: "#E4E4E7" }, children: "feeds" } },
              { type: "span", props: { style: { display: "flex", color: "#71717A" }, children: ".com" } },
            ],
          },
        },
      ],
    },
  };

  // Hero: vertical accent stripe + headline. The stripe is a flex sibling
  // (not a border-left) so we can make it the full headline-block height
  // without satori's borderLeft quirks.
  const headlineSection = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        gap: isStory ? 36 : 28,
        width: "100%",
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              width: stripeWidth,
              backgroundColor: color,
              borderRadius: stripeWidth / 2,
              flexShrink: 0,
            },
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexGrow: 1,
              fontSize: dims.headlineSize,
              fontWeight: 700,
              lineHeight: 1.12,
              letterSpacing: -1.5,
              color: "#FAFAFA",
            },
            children: headline,
          },
        },
      ],
    },
  };

  // Footer: hairline divider + (source · date) on left, tagline on right.
  // For the square (Instagram) preset: replace the tagline with a prominent
  // "scoopfeeds.com ↗" so the branded URL is immediately visible in the feed.
  const footerLeftPieces = [];
  if (source) footerLeftPieces.push(`Via ${source}`);
  if (dateStr) footerLeftPieces.push(dateStr);
  const footerLeft = footerLeftPieces.join("  ·  ");

  const isSquare = preset === "square";

  // Square-only: description teaser — 2 lines of article context visible in
  // the image itself. Gives the viewer a reason to "link in bio" before they
  // even read the caption. Shown only when description is non-empty.
  const descTeaser = (() => {
    if (!isSquare) return null;
    const rawDesc = String(article.description || "").replace(/\s+/g, " ").trim();
    if (!rawDesc) return null;
    const text = truncate(rawDesc, 130);
    return {
      type: "div",
      props: {
        style: {
          display: "flex",
          fontSize: 28,
          fontWeight: 600,
          lineHeight: 1.45,
          color: "#A1A1AA",
          letterSpacing: 0.1,
        },
        children: text,
      },
    };
  })();

  // Right-side footer: branded tagline normally, prominent "scoopfeeds.com ↗"
  // for the square (IG) preset to maximize brand recall in the feed.
  const footerRight = isSquare
    ? {
        type: "div",
        props: {
          style: { display: "flex", flexDirection: "row", gap: 3, alignItems: "baseline" },
          children: [
            {
              type: "span",
              props: {
                style: { display: "flex", fontSize: taglineFont + 3, fontWeight: 700, color, letterSpacing: -0.3 },
                children: "scoopfeeds.com",
              },
            },
            {
              type: "span",
              props: {
                style: { display: "flex", fontSize: taglineFont, fontWeight: 600, color: "#52525B" },
                children: " ↗",
              },
            },
          ],
        },
      }
    : {
        type: "div",
        props: {
          style: { display: "flex", fontSize: taglineFont, fontWeight: 600, color: "#71717A", letterSpacing: 0.5 },
          children: "News, sniffed out.",
        },
      };

  const footerSection = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        gap: isStory ? 22 : 16,
      },
      children: [
        // Hairline divider
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              width: "100%",
              height: 1,
              backgroundColor: "#27272A",
            },
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    fontSize: footerFont,
                    fontWeight: 600,
                    color: "#D4D4D8",
                    letterSpacing: 0.2,
                  },
                  children: footerLeft || " ",
                },
              },
              footerRight,
            ],
          },
        },
      ],
    },
  };

  // Middle section: headline + optional description teaser, grouped so they
  // stay together when justifyContent: "space-between" positions the three
  // main regions (header · mid · footer).
  const midSection = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: isSquare ? 24 : 0,
      },
      children: [headlineSection, ...(descTeaser ? [descTeaser] : [])],
    },
  };

  // Body container — everything below the accent bar gets uniform padding.
  const body = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        justifyContent: "space-between",
        paddingLeft: dims.padding,
        paddingRight: dims.padding,
        paddingTop: dims.padding - 8, // shave a touch since accent bar adds visual weight up top
        paddingBottom: dims.padding,
      },
      children: [headerRow, midSection, footerSection],
    },
  };

  // When we have a stock photo, composite three layers:
  //   1. The full-bleed photo (absolute, behind everything)
  //   2. A dark scrim — gradient + flat overlay — to guarantee headline
  //      contrast on every photo (bright sky, busy crowd, white wall, etc.)
  //   3. The category-color radial bloom (subtle, brings brand into the
  //      top-right corner without dominating)
  //   4. The existing accent bar + body, on top
  //
  // Without a photo, fall back to the original two-layer dark gradient —
  // visually still strong but not photographic.
  if (bgDataUri) {
    return {
      type: "div",
      props: {
        style: {
          width: dims.width,
          height: dims.height,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          backgroundColor: "#0A0A0C",
          color: "#F5F5F7",
          fontFamily: "Inter",
        },
        children: [
          // Layer 1: photo — absolutely positioned, behind everything.
          {
            type: "img",
            props: {
              src: bgDataUri,
              width: dims.width,
              height: dims.height,
              style: {
                position: "absolute",
                top: 0,
                left: 0,
                width: dims.width,
                height: dims.height,
                objectFit: "cover",
              },
            },
          },
          // Layer 2: dark scrim — heavier at the top (where the pill +
          // wordmark live) and at the bottom (where the footer + headline
          // foot live). Keeps a slight reveal of the photo through the middle.
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                top: 0,
                left: 0,
                width: dims.width,
                height: dims.height,
                display: "flex",
                backgroundImage:
                  `linear-gradient(180deg, rgba(8,8,10,0.78) 0%, rgba(8,8,10,0.55) 35%, rgba(8,8,10,0.82) 75%, rgba(8,8,10,0.92) 100%)`,
              },
            },
          },
          // Layer 3: subtle category-color bloom in the top-right corner.
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                top: 0,
                left: 0,
                width: dims.width,
                height: dims.height,
                display: "flex",
                backgroundImage:
                  `radial-gradient(ellipse 60% 55% at 92% 0%, ${color}55 0%, ${color}22 35%, transparent 70%)`,
              },
            },
          },
          // Layer 4: the existing accent bar + body, in a relatively-positioned
          // wrapper so they paint above the absolute layers above.
          {
            type: "div",
            props: {
              style: {
                position: "relative",
                display: "flex",
                flexDirection: "column",
                width: dims.width,
                height: dims.height,
              },
              children: [topAccentBar, body],
            },
          },
        ],
      },
    };
  }

  return {
    type: "div",
    props: {
      style: {
        width: dims.width,
        height: dims.height,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#0A0A0C",
        // Two-layer background: a soft radial bloom of the category color
        // in the top-right (depth + brand color), over a vertical near-black
        // gradient (so the hairline divider reads cleanly at the bottom).
        backgroundImage:
          `radial-gradient(ellipse 70% 60% at 92% 0%, ${color}33 0%, ${color}10 35%, transparent 70%),` +
          ` linear-gradient(180deg, #0A0A0C 0%, #111114 60%, #16161B 100%)`,
        color: "#F5F5F7",
        fontFamily: "Inter",
      },
      children: [topAccentBar, body],
    },
  };
}

// Renders the satori → SVG → PNG pipeline for a single article + preset.
// Returns { buffer, photoEmbedded } so callers can tell whether the photo
// actually made it into the rendered output (vs. fell back to no-photo).
async function renderPng(article, preset, opts = {}) {
  const dims = PRESETS[preset];
  const fonts = [
    { name: "Inter", data: FONT_SEMIBOLD, weight: 600, style: "normal" },
    { name: "Inter", data: FONT_BOLD,     weight: 700, style: "normal" },
  ];

  const renderOnce = async (treeOpts) => {
    const tree = buildTree(article, preset, treeOpts);
    const svg = await satori(tree, { width: dims.width, height: dims.height, fonts });
    return new Resvg(svg, { background: "#0B0B0D", fitTo: { mode: "original" } }).render().asPng();
  };

  try {
    const buffer = await renderOnce(opts);
    return { buffer, photoEmbedded: Boolean(opts.bgDataUri) };
  } catch (err) {
    if (opts.bgDataUri) {
      logger.error(`card renderer: SATORI FAILED with photo for ${article.id} (preset=${preset}): ${err.message} — retrying typographic-only`);
      const buffer = await renderOnce({ ...opts, bgDataUri: null });
      return { buffer, photoEmbedded: false };
    }
    throw err;
  }
}

// Public API: returns { path, buffer, contentType } — caches on disk.
//
// Photo-backed mode:
//   - square preset: always tries to fetch article.image_url as the background
//     (magazine layout). Falls back to dark typographic card on failure.
//   - og / story presets: uses PEXELS_API_KEY stock photo when configured.
//   - carousel: always typographic-only (three slides look better with a
//     unified dark background instead of three different photos).
//
// `opts.usePhoto = false` forces the typographic-only fallback for any preset
// (useful for admin preview "before" comparison).
export async function ensureCard(article, preset = "og", opts = {}) {
  if (!isCardRendererReady()) throw new Error("card renderer not ready (missing fonts)");
  if (!PRESETS[preset]) throw new Error(`unknown preset: ${preset}`);
  if (!article || !article.id || !article.title) throw new Error("article with id + title required");

  const isHero = !preset.startsWith("carousel");
  const wantsPhoto = opts.usePhoto !== undefined ? Boolean(opts.usePhoto) : isHero;

  let bgDataUri = null;

  if (wantsPhoto) {
    if (preset === "square" || preset === "carousel1") {
      // Magazine square / carousel cover. Photo embedding is opt-in via
      // CARD_USE_ARTICLE_PHOTO=1 because the @resvg/resvg-js v2.6.x linux-x64
      // build silently drops embedded JPEG images (data URIs make it through
      // satori but rasterise as transparent on Hostinger's Node 18 container,
      // while macOS arm64 renders them perfectly). The typographic-only path
      // looks great on its own — vibrant category gradient + word-highlighted
      // headline — so we default to it until resvg-js is fixed/upgraded.
      const photoBgEnabled = process.env.CARD_USE_ARTICLE_PHOTO === "1";
      if (photoBgEnabled) {
        const imgCacheDir = path.join(CARDS_DIR, "img-cache");
        try {
          bgDataUri = await fetchArticlePhotoDataUri(article, imgCacheDir);
        } catch (e) {
          logger.warn(`card renderer: article photo fetch failed for ${article.id}: ${e.message}`);
        }
        if (!bgDataUri && isStockPhotoEnabled()) {
          try {
            const stock = await getStockPhotoForArticle(article, { orientation: "square" });
            if (stock) bgDataUri = stockPhotoAsDataUri(stock.path);
          } catch (e) {
            logger.warn(`card renderer: stock photo fallback failed for ${article.id}: ${e.message}`);
          }
        }
      }
    } else if (isStockPhotoEnabled()) {
      // OG / story: use Pexels stock photo when configured.
      let stockPhoto = null;
      try {
        stockPhoto = await getStockPhotoForArticle(article);
      } catch (e) {
        logger.warn(`card renderer: stock photo lookup failed for ${article.id}: ${e.message}`);
      }
      bgDataUri = stockPhoto ? stockPhotoAsDataUri(stockPhoto.path) : null;
    }
  }

  // Hash includes whether a photo is present so the cache distinguishes
  // photo vs no-photo renders (they look very different). We check BOTH
  // possible filenames (p0 and p1) on cache lookup — that way, if a previous
  // render fell back to typographic-only after a satori failure, we don't
  // re-attempt the bad photo on every request.
  const baseHash = contentHash(article, preset);
  const intendedSuffix = bgDataUri ? "p1" : "p0";
  const intendedPath = cachePath(article.id, preset, `${baseHash}-${intendedSuffix}`);
  const fallbackPath = cachePath(article.id, preset, `${baseHash}-p0`);

  if (existsSync(intendedPath)) {
    return { path: intendedPath, buffer: readFileSync(intendedPath), contentType: "image/png", hit: true, withPhoto: intendedSuffix === "p1" };
  }
  // If a typographic-only render is already cached, prefer it over re-trying
  // a known-bad photo (only applies when we have a bgDataUri but the previous
  // render fell back). This avoids the "fetch + retry satori" cost on each request.
  if (bgDataUri && existsSync(fallbackPath)) {
    return { path: fallbackPath, buffer: readFileSync(fallbackPath), contentType: "image/png", hit: true, withPhoto: false };
  }

  const { buffer, photoEmbedded } = await renderPng(article, preset, { bgDataUri });
  // If satori had to fall back (photo bytes were malformed even after our
  // magic-byte check), persist under the p0 filename — that way subsequent
  // requests skip the broken-photo render entirely.
  const finalSuffix = photoEmbedded ? "p1" : "p0";
  const finalPath = cachePath(article.id, preset, `${baseHash}-${finalSuffix}`);
  try { writeFileSync(finalPath, buffer); } catch (e) {
    logger.warn(`card renderer: failed to cache to ${finalPath}: ${e.message}`);
  }
  return { path: finalPath, buffer, contentType: "image/png", hit: false, withPhoto: photoEmbedded };
}

export function cardUrl(articleId, preset = "og", siteUrl = "") {
  const base = String(siteUrl || "").replace(/\/+$/, "");
  const safeId = encodeURIComponent(articleId);
  return `${base}/api/cards/${preset}/${safeId}.png`;
}

// Convenience: generate (or return cached) all 3 carousel slides for an article.
// Returns [slide1, slide2, slide3] where each is { path, buffer, contentType, hit }.
export async function ensureCarousel(article) {
  return Promise.all([
    ensureCard(article, "carousel1"),
    ensureCard(article, "carousel2"),
    ensureCard(article, "carousel3"),
  ]);
}

// Returns the public URL array for the 3 carousel slides.
export function carouselUrls(articleId, siteUrl = "") {
  return [1, 2, 3].map(i => cardUrl(articleId, `carousel${i}`, siteUrl));
}
