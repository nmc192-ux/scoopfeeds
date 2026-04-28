// Pexels stock-photo lookup for branded card backgrounds.
//
// The card renderer's typographic-only design reads as "lightweight" on
// social feeds full of imagery. To compete on Facebook / IG / LinkedIn we
// need a real photo behind every headline — but we can't reuse source-
// publisher images (licensing risk). Pexels gives us a free, broad
// editorial-safe library: 200 reqs/hr, 20k/mo on the free tier, which is
// 100× our worst-case cadence.
//
// Strategy:
//   1. Build a search query from article tags + category + headline keywords
//   2. Hit Pexels /v1/search with orientation=landscape, size=large
//   3. Pick from the top 5 results (variety) and download to data/stock-photos/
//   4. Cache the JPG keyed by article id; downstream renderer uses the
//      cached file path
//   5. On API failure or no results, fall back to a per-category default
//      query, then to null (renderer keeps the typographic-only layout)
//
// Pexels attribution: their license requires "give credit to photographers
// or to Pexels when possible" — we do this in the post caption / footer
// where appropriate, and in /credits page (TODO Phase 4 polish).
//
// Env: PEXELS_API_KEY — get one free at pexels.com/api

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");

// Mirror cardRenderer's persist strategy — let SCOOP_PERSISTENT_DATA_DIR
// override so a Hostinger redeploy doesn't blow away the cache.
const PERSIST_DIR = process.env.SCOOP_PERSISTENT_DATA_DIR
  ? path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR)
  : path.join(BACKEND_ROOT, "data");
const STOCK_DIR = path.join(PERSIST_DIR, "stock-photos");
if (!existsSync(STOCK_DIR)) {
  try { mkdirSync(STOCK_DIR, { recursive: true }); } catch { /* best effort */ }
}

const getApiKey = () => (process.env.PEXELS_API_KEY || "").trim();

export function isStockPhotoEnabled() {
  return Boolean(getApiKey());
}

// Per-category fallback queries when an article-specific query yields nothing.
// Tuned to surface editorial-safe, recognizable imagery — no people-faces
// front-and-center (those date a card to a specific person fast).
const CATEGORY_FALLBACK_QUERIES = {
  top:            ["newspaper", "skyline", "cityscape"],
  politics:       ["government building", "capitol", "parliament"],
  pakistan:       ["pakistan", "karachi", "islamabad", "south asia"],
  international:  ["world map", "globe earth", "international"],
  science:        ["laboratory", "microscope", "research science"],
  medicine:       ["hospital", "stethoscope", "medical"],
  "public-health":["healthcare", "vaccine", "pharmacy"],
  health:         ["wellness", "yoga", "healthy lifestyle"],
  environment:    ["forest", "ocean", "climate nature"],
  "self-help":    ["meditation", "mountain top", "sunrise"],
  sports:         ["stadium", "football", "athletics"],
  cars:           ["sports car", "automotive", "highway driving"],
  ai:             ["circuit board", "data center", "artificial intelligence"],
};

// Words we strip from the article title before using it as a query, because
// they hurt search relevance on Pexels (they don't index news-style verbs).
const STOPWORDS = new Set([
  "the","a","an","of","for","to","in","on","at","by","with","from","is","are","was",
  "were","be","been","being","and","or","but","not","as","this","that","these","those",
  "it","its","his","her","their","says","said","tells","could","would","should","may",
  "might","will","can","new","top","watch","live","report","reports","update","breaking",
  "exclusive","video","photos","photo","pictures","picture","explained","why","how",
]);

// Build a Pexels search query from article tags + category + headline keywords.
// Pexels returns better photos for nouns/places/objects than for full sentences.
function queryFor(article) {
  const tags = Array.isArray(article.tags)
    ? article.tags
    : (typeof article.tags === "string" && article.tags ? article.tags.split(",") : []);
  const tagWords = tags
    .map(t => String(t).trim().toLowerCase())
    .filter(t => t && t.length > 2 && !STOPWORDS.has(t))
    .slice(0, 3);

  if (tagWords.length >= 2) return tagWords.join(" ");

  // Pull 2-3 strong content nouns from the title.
  const titleWords = String(article.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w))
    .slice(0, 4);

  if (tagWords.length === 1 && titleWords.length) {
    return [tagWords[0], titleWords[0]].join(" ");
  }
  if (titleWords.length >= 2) return titleWords.slice(0, 3).join(" ");

  // Last resort — category fallback handled by caller.
  return "";
}

function fallbackQuery(category) {
  const list = CATEGORY_FALLBACK_QUERIES[category] || CATEGORY_FALLBACK_QUERIES.top;
  return list[Math.floor(Math.random() * list.length)];
}

async function searchPexels(query, { perPage = 5, orientation = "landscape" } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", orientation);
  url.searchParams.set("size", "large");
  url.searchParams.set("per_page", String(perPage));
  try {
    const res = await fetch(url, {
      headers: { Authorization: apiKey },
    });
    if (!res.ok) {
      logger.warn(`stockPhoto: pexels search ${res.status} for "${query}"`);
      return null;
    }
    const json = await res.json();
    return json?.photos || [];
  } catch (e) {
    logger.warn(`stockPhoto: pexels search error for "${query}": ${e.message}`);
    return null;
  }
}

// Pick from top results pseudo-randomly (article-id-deterministic) so the
// same article always renders the same photo, but two articles with the same
// query don't both pick photo #0 → repetition in the feed.
function pickPhoto(photos, articleId) {
  if (!photos || !photos.length) return null;
  const seed = String(articleId).split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  return photos[seed % photos.length];
}

async function downloadImage(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(destPath, buf);
  return destPath;
}

function cachedPath(articleId) {
  const safeId = String(articleId).replace(/[^a-z0-9_-]/gi, "_").slice(0, 120);
  return path.join(STOCK_DIR, `${safeId}.jpg`);
}

// Returns { path, photographer, photographerUrl, source } on success, or null.
// On null the card renderer falls back to typographic-only — caller never has
// to handle errors, just check for null.
export async function getStockPhotoForArticle(article, { orientation = "landscape" } = {}) {
  if (!isStockPhotoEnabled()) return null;
  if (!article || !article.id) return null;

  const dest = cachedPath(article.id);
  // Check cache first — note we don't keep metadata in cache (photographer
  // attribution is best-effort; card already has source attribution).
  if (existsSync(dest)) {
    try {
      const st = statSync(dest);
      if (st.size > 1000) {
        return { path: dest, source: "cache" };
      }
    } catch { /* fall through */ }
  }

  // Try article-specific query first; if no results, fall back to category.
  const queries = [];
  const q1 = queryFor(article);
  if (q1) queries.push(q1);
  queries.push(fallbackQuery(article.category));

  let chosen = null;
  for (const q of queries) {
    const photos = await searchPexels(q, { orientation });
    chosen = pickPhoto(photos, article.id);
    if (chosen) break;
  }
  if (!chosen) return null;

  // Pexels gives us multiple sizes. `large` is ~940×650, `large2x` ~1880×1300.
  // We use large2x for the OG (1200×630) and square (1080×1080) card so
  // there's no upscaling visible. Story (1080×1920) wants portrait — we
  // re-fetch with orientation=portrait the first time the renderer asks
  // for it. For now (Tier 1 = OG only on FB) landscape is enough.
  const src = chosen.src?.large2x || chosen.src?.large || chosen.src?.original;
  if (!src) return null;

  try {
    await downloadImage(src, dest);
    return {
      path: dest,
      photographer: chosen.photographer || "",
      photographerUrl: chosen.photographer_url || "",
      pexelsUrl: chosen.url || "",
      source: "fresh",
    };
  } catch (e) {
    logger.warn(`stockPhoto: download failed for article ${article.id}: ${e.message}`);
    return null;
  }
}

// Read a cached photo as a base64 data URI for satori embedding.
// Returns null if no photo is cached or read fails.
export function stockPhotoAsDataUri(filePath) {
  try {
    if (!filePath || !existsSync(filePath)) return null;
    const buf = readFileSync(filePath);
    if (!buf || buf.length < 1000) return null;
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch (e) {
    logger.warn(`stockPhoto: read failed: ${e.message}`);
    return null;
  }
}
