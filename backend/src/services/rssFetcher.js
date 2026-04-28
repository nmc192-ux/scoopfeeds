import Parser from "rss-parser";
import { v5 as uuidv5 } from "uuid";
import { logger, logIngestion, logSourceHealth } from "./logger.js";
import { upsertArticle, logIngestionEvent, updateSourceHealth } from "../models/database.js";

const NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

// Region → likely primary publication language. Soft fallback when the feed
// itself doesn't declare `<language>`. Pakistani English papers (Dawn, Geo,
// Tribune etc.) all publish in English, so region=pk → en, not ur.
const REGION_LANG = {
  pk: "en", in: "en", us: "en", uk: "en", global: "en",
  de: "de", fr: "fr", es: "es", pt: "pt", it: "it", ru: "ru",
  cn: "zh", jp: "ja", kr: "ko", tr: "tr", sa: "ar", ae: "ar",
};
function inferSourceLanguage(source) {
  return REGION_LANG[(source.region || "").toLowerCase()] || null;
}

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent": "NewsAggregator/1.0 (RSS Reader; educational/news aggregation)",
    "Accept": "application/rss+xml, application/xml, text/xml, application/atom+xml",
  },
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: false }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: false }],
      ["enclosure", "enclosure", { keepArray: false }],
      ["dc:creator", "dcCreator"],
    ],
  },
});

function extractImageUrl(item) {
  // Try various image fields
  if (item.mediaContent?.["$"]?.url) return item.mediaContent["$"].url;
  if (item.mediaThumbnail?.["$"]?.url) return item.mediaThumbnail["$"].url;
  if (item.enclosure?.url && item.enclosure.type?.startsWith("image/")) return item.enclosure.url;

  // Try to extract from content/description HTML
  const html = item["content:encoded"] || item.content || item.description || "";
  const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch) return imgMatch[1];

  return null;
}

function cleanText(text, maxLen = 500) {
  if (!text) return null;
  return text
    .replace(/<[^>]+>/g, "") // strip HTML
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

// Strip the noise that varies between feeds for the same canonical article:
//   - protocol (http/https treated as equivalent)
//   - leading "www."
//   - trailing slash
//   - URL fragment
//   - tracking query params (utm_*, ref, fbclid, gclid, mc_cid, …)
// Without this, the same NYT article re-fed via Google News + the publisher's
// own RSS becomes two distinct article IDs, and our social_posts dedup
// (keyed on article_id) treats them as separate stories — re-posting the same
// piece to FB/Bluesky/etc. multiple times within hours.
const TRACKING_PARAM_PREFIXES = ["utm_", "_hsenc", "_hsmi", "vero_"];
const TRACKING_PARAM_NAMES = new Set([
  "ref", "ref_src", "ref_url", "source", "src",
  "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid",
  "share", "shared", "via", "feed_id", "_ga",
  "yclid", "dclid", "cmpid", "ito", "smid", "smtyp",
]);
function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.protocol = "https:";
    u.hostname = u.hostname.replace(/^www\./i, "").toLowerCase();
    u.hash = "";
    // Drop tracking params; keep meaningful ones (story IDs, page numbers, etc.).
    const keep = new URLSearchParams();
    for (const [k, v] of u.searchParams) {
      const lk = k.toLowerCase();
      if (TRACKING_PARAM_NAMES.has(lk)) continue;
      if (TRACKING_PARAM_PREFIXES.some(p => lk.startsWith(p))) continue;
      keep.append(k, v);
    }
    // Sort surviving params so ?a=1&b=2 == ?b=2&a=1.
    keep.sort();
    u.search = keep.toString() ? `?${keep.toString()}` : "";
    let out = u.toString();
    // Drop trailing "/" on the path (but keep "/" for root URLs).
    if (u.pathname !== "/" && out.endsWith("/")) out = out.slice(0, -1);
    return out;
  } catch {
    return String(rawUrl || "").trim();
  }
}

function generateId(url) {
  return uuidv5(normalizeUrl(url), NAMESPACE);
}

export async function fetchSource(source) {
  const startTime = Date.now();
  const result = {
    source: source.name,
    category: source.category,
    fetched: 0,
    newArticles: 0,
    errors: [],
  };

  try {
    logIngestion("fetch_start", { source: source.name, category: source.category });

    const feed = await parser.parseURL(source.url);
    const items = feed.items || [];

    result.fetched = items.length;

    for (const item of items) {
      if (!item.title || !item.link) continue;

      const id = generateId(item.link);
      const published = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();

      // Skip if older than 7 days
      if (Date.now() - published > 7 * 24 * 60 * 60 * 1000) continue;

      const article = {
        id,
        title: cleanText(item.title, 200),
        description: cleanText(item.description || item.contentSnippet, 500),
        content: cleanText(item["content:encoded"] || item.content, 2000),
        url: item.link,
        image_url: extractImageUrl(item),
        source_name: source.name,
        category: source.category,
        region: source.region || "global",
        author: cleanText(item.dcCreator || item.creator || item.author, 100),
        published_at: published,
        fetched_at: Date.now(),
        credibility: source.credibility || 7,
        tags: JSON.stringify([source.category, source.region || "global"]),
        // Source language: feed-provided → source config → inferred from
        // region → "en". Used by the frontend to default each article to
        // its publication's language (user can override).
        language: (
          (feed.language && String(feed.language).slice(0, 2).toLowerCase()) ||
          source.language ||
          inferSourceLanguage(source) ||
          "en"
        ),
      };

      const insertResult = upsertArticle(article);
      if (insertResult.changes > 0) result.newArticles++;
    }

    const duration = Date.now() - startTime;
    updateSourceHealth(source.name, true, result.newArticles);
    logIngestionEvent({
      source_name: source.name,
      category: source.category,
      status: "success",
      articles_fetched: result.fetched,
      articles_new: result.newArticles,
      error_msg: null,
      duration_ms: duration,
      fetched_at: Date.now(),
    });

    logSourceHealth(source.name, "ok", { fetched: result.fetched, new: result.newArticles, ms: duration });
    logIngestion("fetch_complete", { source: source.name, new: result.newArticles, total: result.fetched });

  } catch (err) {
    const duration = Date.now() - startTime;
    result.errors.push(err.message);

    updateSourceHealth(source.name, false);
    logIngestionEvent({
      source_name: source.name,
      category: source.category,
      status: "error",
      articles_fetched: 0,
      articles_new: 0,
      error_msg: err.message,
      duration_ms: duration,
      fetched_at: Date.now(),
    });

    logSourceHealth(source.name, "error", { error: err.message });
    logger.warn(`Failed to fetch ${source.name}: ${err.message}`);
  }

  return result;
}

export async function fetchAllSources(sources) {
  logger.info(`🚀 Starting ingestion cycle — ${sources.length} sources`);
  const startTime = Date.now();

  // Process in batches of 5 concurrent requests to avoid overwhelming servers
  const BATCH_SIZE = 5;
  const results = [];

  for (let i = 0; i < sources.length; i += BATCH_SIZE) {
    const batch = sources.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map(source => fetchSource(source)));
    results.push(...batchResults);

    if (i + BATCH_SIZE < sources.length) {
      await new Promise(r => setTimeout(r, 1000)); // 1s delay between batches
    }
  }

  const totalFetched = results.reduce((sum, r) => sum + (r.value?.fetched || 0), 0);
  const totalNew = results.reduce((sum, r) => sum + (r.value?.newArticles || 0), 0);
  const totalErrors = results.filter(r => r.value?.errors?.length > 0).length;

  logger.info(`✅ Ingestion complete — ${totalNew} new articles from ${totalFetched} fetched (${totalErrors} errors) in ${Date.now() - startTime}ms`);

  return { totalFetched, totalNew, totalErrors, duration: Date.now() - startTime };
}
