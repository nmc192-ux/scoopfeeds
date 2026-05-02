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

async function fetchArticlePhotoDataUri(imageUrl, imgCacheDir) {
  if (!imageUrl || typeof imageUrl !== "string") return null;
  // Only absolute HTTP(S) URLs.
  if (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://")) return null;

  const finalUrl = upscaleKnownThumbnailUrl(imageUrl);
  // Cache key includes the upscaled URL so changing the upscaler in the
  // future invalidates old cached low-res images.
  const urlHash = createHash("sha1").update(finalUrl).digest("hex").slice(0, 20);
  if (!existsSync(imgCacheDir)) mkdirSync(imgCacheDir, { recursive: true });

  // Return cached version if present (any image extension).
  for (const [ext, mime] of [
    [".jpg", "image/jpeg"],
    [".png", "image/png"],
    [".webp", "image/webp"],
  ]) {
    const p = path.join(imgCacheDir, `${urlHash}${ext}`);
    if (existsSync(p)) {
      try {
        const buf = readFileSync(p);
        return `data:${mime};base64,${buf.toString("base64")}`;
      } catch { /* fall through */ }
    }
  }

  // Fetch with browser-like headers and an organic Referer. CDN hotlink
  // protection rejects empty referers and referers pointing at the CDN itself,
  // so we use google.com/ which mimics a search-result click. Generous timeout
  // because Hostinger → remote CDN paths can be slow.
  const tryFetch = async (urlToFetch) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(urlToFetch, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://www.google.com/",
        },
      });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      // Magic-byte sniff — many CDNs return 200 + image/* content-type but
      // a 1-byte body when the requested size variant doesn't exist.
      // Validating the magic bytes guarantees satori actually has decodable
      // pixels to render.
      const mime = detectImageMime(buf);
      if (!mime) return null;
      // Reject suspiciously small (broken thumbnails) or huge bodies.
      if (buf.length < 2500 || buf.length > 12 * 1024 * 1024) return null;
      return { buf, mime };
    } catch (err) {
      if (!String(err.name || "").includes("Abort")) {
        logger.warn(`card renderer: image fetch error for ${urlToFetch.slice(0, 80)}: ${err.message}`);
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  // Try upscaled URL first; if it doesn't return a valid image (CDN gave a
  // 1-byte placeholder, 404, or not-an-image type), fall back to the original
  // thumbnail URL. Better a small valid image than no image at all.
  let result = await tryFetch(finalUrl);
  if (!result && finalUrl !== imageUrl) {
    result = await tryFetch(imageUrl);
  }
  if (!result) {
    logger.warn(`card renderer: article image unusable for ${imageUrl.slice(0, 80)}`);
    return null;
  }

  // Satori only handles JPEG / PNG natively. WebP and GIF inputs would render
  // as broken images and trigger a 500 on the cards endpoint. Reject anything
  // that isn't JPEG/PNG so the renderer falls through to no-photo mode.
  if (result.mime !== "image/jpeg" && result.mime !== "image/png") {
    logger.warn(`card renderer: unsupported image type ${result.mime} for ${imageUrl.slice(0, 80)}`);
    return null;
  }

  const ext = result.mime === "image/png" ? ".png" : ".jpg";
  const cachePath = path.join(imgCacheDir, `${urlHash}${ext}`);
  try { writeFileSync(cachePath, result.buf); } catch {}
  return `data:${result.mime};base64,${result.buf.toString("base64")}`;
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
const CARD_DESIGN_VER = "v5"; // bumped: BBC ace pattern, magic-byte validation, signature-aware skip

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
  if (preset === "square") {
    h.update("|");
    h.update(String(article.image_url || ""));
  }
  return h.digest("hex").slice(0, 10);
}

function cachePath(articleId, preset, hash) {
  const safeId = String(articleId).replace(/[^a-z0-9_-]/gi, "_").slice(0, 120);
  return path.join(CARDS_DIR, `${safeId}-${preset}-${hash}.png`);
}

// ── Magazine-style square card ───────────────────────────────────────────────
//
// Instagram 1080×1080 card that looks like a polished editorial photo-post:
//
//   ┌──────────────────────────────────────────────┐
//   │ scoopfeeds            [CATEGORY PILL]        │  ← top bar
//   │                                              │
//   │            article photo fills              │
//   │               entire background             │
//   │                                              │
//   │████████████ gradient darkens ████████████████│
//   │                                              │
//   │  BIG BOLD WHITE HEADLINE GOES               │  ← headline
//   │  HERE ACROSS UP TO THREE LINES              │
//   │                                              │
//   │  [f][ig][X][in][www]         via BBC News   │  ← footer icons
//   └──────────────────────────────────────────────┘
//
// When the article has no usable image_url (fetch failed or absent), the card
// falls back to the standard dark typographic layout (buildTree with no bgDataUri).
function buildSquareMagazineTree(article, bgDataUri) {
  const W = 1080, H = 1080;
  const PAD = 60;
  const color = colorFor(article.category);
  const label = labelFor(article.category);
  const source = article.source_name || "";

  // Headline: larger font than the standard square, tight letter-spacing.
  // Up to 110 chars — at 88px Inter Bold, ~3 lines at 1080px width.
  const headline = truncate(article.title, 110);
  const dateStr = formatShortDate(article.published_at);

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

  // ── Bottom section: headline + footer ────────────────────────────────
  const bottomSection = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        gap: 24,
      },
      children: [
        // Headline — large, bold, white. Bigger size now that the social-
        // icon row is gone — gives the headline more visual real estate.
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              fontSize: 88,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -2.3,
              color: "#FFFFFF",
              width: "100%",
            },
            children: headline,
          },
        },
        // Footer row: scoopfeeds.com left, "via Source · Date" right.
        // Clean, editorial — no platform-icon clutter.
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
                    fontSize: 24,
                    fontWeight: 700,
                    color: "#FFFFFF",
                    letterSpacing: -0.2,
                  },
                  children: "scoopfeeds.com",
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    fontSize: 22,
                    fontWeight: 600,
                    color: "rgba(255,255,255,0.65)",
                    letterSpacing: 0.2,
                  },
                  children: [source, dateStr].filter(Boolean).join(" · "),
                },
              },
            ],
          },
        },
      ],
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

  // Fallback (no article photo): dark typographic card but with the magazine
  // layout (large headline, social icons, no description teaser).
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
          `radial-gradient(ellipse 70% 60% at 92% 0%, ${color}33 0%, ${color}10 35%, transparent 70%),` +
          ` linear-gradient(180deg, #0A0A0C 0%, #111114 60%, #16161B 100%)`,
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
  if (preset.startsWith("carousel")) {
    const slide = parseInt(preset.replace("carousel", ""), 10);
    if (slide >= 1 && slide <= 3) return buildCarouselTree(article, slide);
  }

  // Square preset uses the magazine photo-background layout.
  if (preset === "square") {
    return buildSquareMagazineTree(article, opts.bgDataUri || null);
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

async function renderPng(article, preset, opts = {}) {
  const dims = PRESETS[preset];
  const fonts = [
    { name: "Inter", data: FONT_SEMIBOLD, weight: 600, style: "normal" },
    { name: "Inter", data: FONT_BOLD,     weight: 700, style: "normal" },
  ];

  // First attempt: with whatever bgDataUri we got. If satori or resvg throw
  // (e.g. malformed image bytes that magic-byte sniff didn't catch — corrupt
  // JPEG headers, truncated PNGs), retry without the photo so we still
  // produce a valid card instead of 500'ing the cards endpoint.
  try {
    const tree = buildTree(article, preset, opts);
    const svg = await satori(tree, { width: dims.width, height: dims.height, fonts });
    return new Resvg(svg, { background: "#0B0B0D", fitTo: { mode: "original" } }).render().asPng();
  } catch (err) {
    if (opts.bgDataUri) {
      logger.warn(`card renderer: render failed with photo for ${article.id} — retrying without: ${err.message}`);
      const tree = buildTree(article, preset, { ...opts, bgDataUri: null });
      const svg = await satori(tree, { width: dims.width, height: dims.height, fonts });
      return new Resvg(svg, { background: "#0B0B0D", fitTo: { mode: "original" } }).render().asPng();
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
    if (preset === "square") {
      // Magazine square card: prefer the article's own image_url, fall back
      // to a Pexels stock photo if the article fetch fails (or the article
      // has no image_url).  Cached under CARDS_DIR/img-cache/ keyed by URL.
      const imgCacheDir = path.join(CARDS_DIR, "img-cache");
      if (article.image_url) {
        try {
          bgDataUri = await fetchArticlePhotoDataUri(article.image_url, imgCacheDir);
        } catch (e) {
          logger.warn(`card renderer: article photo fetch failed for ${article.id}: ${e.message}`);
        }
      }
      if (!bgDataUri && isStockPhotoEnabled()) {
        try {
          const stock = await getStockPhotoForArticle(article, { orientation: "square" });
          if (stock) bgDataUri = stockPhotoAsDataUri(stock.path);
        } catch (e) {
          logger.warn(`card renderer: stock photo fallback failed for ${article.id}: ${e.message}`);
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
  // photo vs no-photo renders (they look very different).
  const hashSuffix = bgDataUri ? "p1" : "p0";
  const hash = `${contentHash(article, preset)}-${hashSuffix}`;
  const filePath = cachePath(article.id, preset, hash);

  if (existsSync(filePath)) {
    return { path: filePath, buffer: readFileSync(filePath), contentType: "image/png", hit: true, withPhoto: Boolean(bgDataUri) };
  }

  const buffer = await renderPng(article, preset, { bgDataUri });
  try { writeFileSync(filePath, buffer); } catch (e) {
    logger.warn(`card renderer: failed to cache to ${filePath}: ${e.message}`);
  }
  return { path: filePath, buffer, contentType: "image/png", hit: false, withPhoto: Boolean(bgDataUri) };
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
