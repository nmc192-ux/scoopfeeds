import axios from "axios";
import { getDb } from "../models/database.js";
import { logger } from "./logger.js";

const UA = "Mozilla/5.0 (compatible; ScoopBot/1.0; +https://scoopfeeds.com)";
const FETCH_TIMEOUT = 12000;
const MAX_CONTENT_LEN = 5000;
const MIN_PARAGRAPH_LEN = 40;

const http = axios.create({
  timeout: FETCH_TIMEOUT,
  maxRedirects: 3,
  headers: {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
  },
  validateStatus: s => s >= 200 && s < 400,
});

// Sources that reliably block scrapers or lock content behind paywalls.
// Skipping saves bandwidth and avoids rate-limit/403 pollution in logs.
export const BLOCKED_HOSTS = new Set([
  "www.ft.com", "ft.com",
  "www.wsj.com", "wsj.com",
  "www.nytimes.com", "nytimes.com",
  "www.bloomberg.com", "bloomberg.com",
  "www.economist.com", "economist.com",
]);

export function hostOf(url) {
  try { return new URL(url).host.toLowerCase(); } catch { return ""; }
}

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—")
    .replace(/&hellip;/g, "…").replace(/&#x27;/g, "'")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Heuristic readability: try <article> / <main> / common class names, then
// collect <p> text. No deps — good enough for 80%+ of news sites.
//
// `maxLen` defaults to MAX_CONTENT_LEN so the enrichment path is byte-identical
// to before. videoFullText.js passes a larger value for the one article about
// to become a video: that text is used once and discarded, so it never touches
// the 5,000-char budget that governs what news.db actually stores.
export function extractArticleText(html, { maxLen = MAX_CONTENT_LEN } = {}) {
  if (!html || html.length < 200) return null;

  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const candidates = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]*(?:class|id)=["'][^"']*(?:article-body|story-body|post-content|entry-content|article__body|rich-text)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];
  let body = cleaned;
  for (const re of candidates) {
    const m = cleaned.match(re);
    if (m && m[1].length > 400) { body = m[1]; break; }
  }

  const paragraphs = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(body))) {
    const text = stripHtml(m[1]);
    if (text.length >= MIN_PARAGRAPH_LEN) paragraphs.push(text);
  }

  if (paragraphs.length < 2) return null;
  return paragraphs.join("\n\n").slice(0, maxLen);
}

async function enrichOne(article) {
  const host = hostOf(article.url);
  if (BLOCKED_HOSTS.has(host)) return { skipped: "blocked_host" };

  try {
    const { data: html } = await http.get(article.url);
    const text = extractArticleText(html);
    if (!text || text.length < 300) return { skipped: "too_short" };

    getDb().prepare("UPDATE articles SET content = ? WHERE id = ?").run(text, article.id);
    return { enriched: true, length: text.length };
  } catch (err) {
    return { error: err.code || err.message };
  }
}

// Pick articles missing real content (null, empty, or just description-length)
// and enrich them. Runs in batches with small concurrency to be polite.
export async function enrichBatch({ batchSize = 40, concurrency = 4 } = {}) {
  const rows = getDb().prepare(`
    SELECT id, url FROM articles
    WHERE (content IS NULL OR length(content) < 500)
    ORDER BY published_at DESC
    LIMIT ?
  `).all(batchSize);

  if (rows.length === 0) return { picked: 0, enriched: 0, skipped: 0, errors: 0 };

  const stats = { picked: rows.length, enriched: 0, skipped: 0, errors: 0 };
  const queue = [...rows];

  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const art = queue.shift();
      if (!art) break;
      const r = await enrichOne(art);
      if (r.enriched) stats.enriched++;
      else if (r.skipped) stats.skipped++;
      else if (r.error) stats.errors++;
    }
  });
  await Promise.all(workers);

  logger.info(`📖 Enriched ${stats.enriched}/${stats.picked} articles (${stats.skipped} skipped, ${stats.errors} errors)`);
  return stats;
}
