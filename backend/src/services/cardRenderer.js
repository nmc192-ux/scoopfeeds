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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const BACKEND_ROOT = path.resolve(__dirname, "../..");

const CARDS_DIR = path.join(BACKEND_ROOT, "data", "cards");
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
  // the configured font size without overflowing the hero region. Tighter
  // than the previous design because we bumped headline size for impact.
  if (preset === "og") return 120;
  if (preset === "square") return 150;
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

// Hash that invalidates the cache if the headline or category changes.
function contentHash(article) {
  const h = createHash("sha1");
  h.update(String(article.title || ""));
  h.update("|");
  h.update(String(article.category || ""));
  h.update("|");
  h.update(String(article.source_name || ""));
  return h.digest("hex").slice(0, 10);
}

function cachePath(articleId, preset, hash) {
  const safeId = String(articleId).replace(/[^a-z0-9_-]/gi, "_").slice(0, 120);
  return path.join(CARDS_DIR, `${safeId}-${preset}-${hash}.png`);
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
function buildTree(article, preset) {
  if (preset.startsWith("carousel")) {
    const slide = parseInt(preset.replace("carousel", ""), 10);
    if (slide >= 1 && slide <= 3) return buildCarouselTree(article, slide);
  }

  const dims = PRESETS[preset];
  const color = colorFor(article.category);
  const label = labelFor(article.category);
  const headline = truncate(article.title, headlineCap(preset));
  const source = article.source_name || "";
  const dateStr = formatShortDate(article.published_at);

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
  const footerLeftPieces = [];
  if (source) footerLeftPieces.push(`Via ${source}`);
  if (dateStr) footerLeftPieces.push(dateStr);
  const footerLeft = footerLeftPieces.join("  ·  ");

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
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    fontSize: taglineFont,
                    fontWeight: 600,
                    color: "#71717A",
                    letterSpacing: 0.5,
                  },
                  children: "News, sniffed out.",
                },
              },
            ],
          },
        },
      ],
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
      children: [headerRow, headlineSection, footerSection],
    },
  };

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

async function renderPng(article, preset) {
  const dims = PRESETS[preset];
  const tree = buildTree(article, preset);
  const svg = await satori(tree, {
    width: dims.width,
    height: dims.height,
    fonts: [
      { name: "Inter", data: FONT_SEMIBOLD, weight: 600, style: "normal" },
      { name: "Inter", data: FONT_BOLD,     weight: 700, style: "normal" },
    ],
  });
  const resvg = new Resvg(svg, { background: "#0B0B0D", fitTo: { mode: "original" } });
  return resvg.render().asPng();
}

// Public API: returns { path, buffer, contentType } — caches on disk.
export async function ensureCard(article, preset = "og") {
  if (!isCardRendererReady()) throw new Error("card renderer not ready (missing fonts)");
  if (!PRESETS[preset]) throw new Error(`unknown preset: ${preset}`);
  if (!article || !article.id || !article.title) throw new Error("article with id + title required");

  const hash = contentHash(article);
  const filePath = cachePath(article.id, preset, hash);

  if (existsSync(filePath)) {
    return { path: filePath, buffer: readFileSync(filePath), contentType: "image/png", hit: true };
  }

  const buffer = await renderPng(article, preset);
  try { writeFileSync(filePath, buffer); } catch (e) {
    logger.warn(`card renderer: failed to cache to ${filePath}: ${e.message}`);
  }
  return { path: filePath, buffer, contentType: "image/png", hit: false };
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
