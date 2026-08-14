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

/**
 * The publisher's own share image, from the page we are already holding.
 *
 * WHY HERE AND NOT AT INGESTION. 16 configured feeds ship no image element of
 * any kind — ESPN, CNBC, Science Daily, TechCrunch, Hacker News and others,
 * measured across every feed on 2026-08-14 — so for those the only source of an
 * image is the article page. This function already has that page in memory,
 * which makes the image free for every article enrichment was going to fetch
 * anyway.
 *
 * og:image is the publisher stating which image represents the story, which is
 * the same authority the RSS `isDefault` crop carries. twitter:image is the
 * fallback because a handful of sites set only that.
 *
 * Both attribute orders are matched: `property` before `content` and after. The
 * one-order regex is a classic silent miss — it looks like the site has no card
 * image when it simply wrote its meta tags the other way round.
 */
const OG_IMAGE_PATTERNS = [
  /<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i,
  /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
];

export function extractOgImage(html, baseUrl) {
  if (!html || typeof html !== "string") return null;
  // Only the <head> matters, and stopping there avoids matching an og:image
  // string quoted inside body copy or an embedded JSON blob.
  const head = html.slice(0, html.search(/<\/head>/i) + 1 || 200_000);
  for (const re of OG_IMAGE_PATTERNS) {
    const m = head.match(re);
    if (!m?.[1]) continue;
    const raw = m[1].trim().replace(/&amp;/g, "&");
    if (!raw) continue;
    try {
      // Relative and protocol-relative values are common and useless unresolved.
      const abs = new URL(raw, baseUrl).toString();
      if (!/^https?:$/.test(new URL(abs).protocol)) continue;   // no data: URIs
      return abs;
    } catch { /* unparseable — try the next pattern */ }
  }
  return null;
}

/**
 * Enrich one article from ONE page fetch.
 *
 * `article` carries its current state (`content`, `image_url`) so this can do
 * every job the page supports in a single request. An article picked because its
 * CONTENT is thin also gets its og:image here at no extra cost — that shared
 * fetch is the whole reason this lives in enrichment rather than in its own loop.
 */
async function enrichOne(article) {
  const host = hostOf(article.url);
  if (BLOCKED_HOSTS.has(host)) return { skipped: "blocked_host" };

  const needsText = !article.content || article.content.length < 500;
  const needsImage = !article.image_url;
  if (!needsText && !needsImage) return { skipped: "nothing_to_do" };

  try {
    const { data: html } = await http.get(article.url);

    const text = needsText ? extractArticleText(html) : null;
    const image = needsImage ? extractOgImage(html, article.url) : null;

    // ONE statement, only the columns that actually changed. A blanket UPDATE
    // would write NULL over a good value the moment one half of the job failed.
    const sets = [], params = [];
    if (text && text.length >= 300) { sets.push("content = ?"); params.push(text); }
    if (image) { sets.push("image_url = ?"); params.push(image); }
    if (!sets.length) return { skipped: "too_short" };

    getDb().prepare(`UPDATE articles SET ${sets.join(", ")} WHERE id = ?`).run(...params, article.id);
    return {
      enriched: Boolean(text && text.length >= 300),
      imaged: Boolean(image),
      length: text?.length ?? 0,
    };
  } catch (err) {
    return { error: err.code || err.message };
  }
}

/**
 * How far back an article can be and still be picked for its IMAGE ALONE.
 *
 * The content criterion stays unbounded — content feeds the event graph and
 * video full-text, where an older article is still worth having. An IMAGE is
 * only ever read by the social card, and the two queries that select articles
 * for posting (`findFreshUnpostedArticles` and the video candidate query) both
 * use a 12-HOUR window. An image fetched for a 3-day-old article can never be
 * used by anything.
 *
 * The window is also what stops the widened selection eating itself. An article
 * whose page genuinely has no og:image can never be satisfied, and with an
 * unbounded criterion it would be re-picked every 15 minutes forever, crowding
 * out new work with a fetch that is known to fail. Bounded, that set drains.
 *
 * 48h rather than 12h so a backlog, a slow cycle or a delayed publish still gets
 * its image before the posting window opens — four times the window it serves.
 */
export const IMAGE_ONLY_MAX_AGE_MS =
  Number.parseInt(process.env.ENRICH_IMAGE_MAX_AGE_MS || "", 10) || 48 * 60 * 60 * 1000;

// Pick articles missing real content (null, empty, or just description-length),
// OR — recently — missing an image. Runs in batches with small concurrency.
/**
 * WHO GETS FETCHED. Exported so the selection can be tested without a network:
 * it is the half of this change that decides cost, and the half most likely to
 * be got wrong.
 */
export function pickEnrichCandidates({ batchSize = 40, now = Date.now() } = {}) {
  return getDb().prepare(`
    SELECT id, url, content, image_url FROM articles
    WHERE (content IS NULL OR length(content) < 500)
       OR ((image_url IS NULL OR image_url = '') AND published_at > ?)
    ORDER BY published_at DESC
    LIMIT ?
  `).all(now - IMAGE_ONLY_MAX_AGE_MS, batchSize);
}

export async function enrichBatch({ batchSize = 40, concurrency = 4, now = Date.now() } = {}) {
  const rows = pickEnrichCandidates({ batchSize, now });

  if (rows.length === 0) return { picked: 0, enriched: 0, imaged: 0, imageOnly: 0, skipped: 0, errors: 0 };

  // NO SILENT COSTS. `imageOnly` is the number of fetches this change ADDED —
  // articles whose content was already fine and which the old query would never
  // have picked. Everything else was going to be fetched anyway.
  const imageOnly = rows.filter(r => r.content && r.content.length >= 500 && !r.image_url).length;
  const stats = { picked: rows.length, enriched: 0, imaged: 0, imageOnly, skipped: 0, errors: 0 };
  const queue = [...rows];

  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const art = queue.shift();
      if (!art) break;
      const r = await enrichOne(art);
      // Counted independently: one fetch can satisfy both jobs, and a page that
      // yielded an image but no usable body text is a success for this change
      // and would read as a "skip" under the old single counter.
      if (r.imaged) stats.imaged++;
      if (r.enriched) stats.enriched++;
      else if (r.skipped) stats.skipped++;
      else if (r.error) stats.errors++;
    }
  });
  await Promise.all(workers);

  logger.info(
    `📖 Enriched ${stats.enriched}/${stats.picked} articles, ${stats.imaged} images ` +
    `(${stats.imageOnly} of the batch were image-only picks — the fetches this cost) ` +
    `(${stats.skipped} skipped, ${stats.errors} errors)`
  );
  return stats;
}
