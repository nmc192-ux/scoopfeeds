/**
 * /api/reader?url=... — server-side article extraction using Mozilla Readability.
 *
 * Returns a clean article payload {title, byline, content, excerpt, siteName, length, url}
 * so the frontend can render a distraction-free in-app reader instead of bouncing to
 * the source site.
 *
 * Caching: 12h per URL in memory.
 * Fetch strategy: tries up to 3 browser-like UA variants; classifies errors so
 * the frontend can show a useful message (blocked vs timeout vs parse failure).
 *
 * DOM: uses linkedom (not jsdom) — jsdom has a transitive CJS→ESM compat issue
 * with html-encoding-sniffer/@exodus/bytes that crashes on Node 18 shared hosting.
 * linkedom is a drop-in for Readability with no encoding-sniffer dependency.
 */
import { Router } from "express";
import axios from "axios";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { logger } from "../services/logger.js";

const router = Router();

// ─── Cache (12h) ─────────────────────────────────────────────────────────────
const CACHE = new Map();
const TTL   = 12 * 60 * 60 * 1000;

function getCached(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > TTL) { CACHE.delete(key); return null; }
  return hit.v;
}
function setCached(key, v) {
  if (CACHE.size > 500) {
    const keys = [...CACHE.keys()].slice(0, 50);
    keys.forEach(k => CACHE.delete(k));
  }
  CACHE.set(key, { t: Date.now(), v });
}

// ─── URL validation ──────────────────────────────────────────────────────────
function isSafeUrl(raw) {
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
    if (/^10\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch { return false; }
}

// ─── Browser-like fetch strategies ──────────────────────────────────────────
// We try multiple UA / header combos in sequence. Most news sites pass on the
// first attempt; Cloudflare-protected ones often need the full Accept-Encoding
// + Sec-Fetch header set of a real Chrome request.
const FETCH_STRATEGIES = [
  // Strategy 1: Chrome 124 on Windows
  {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  },
  // Strategy 2: Firefox 125 on macOS
  {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
  },
  // Strategy 3: Safari on iPhone — often less restricted by news sites
  {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
  },
];

async function fetchHtml(url) {
  let lastErr;
  for (const headers of FETCH_STRATEGIES) {
    try {
      // Use the source domain as Referer on retry attempts so it looks like
      // an internal navigation rather than a cold direct load.
      const origin = new URL(url).origin;
      const hdrs = { ...headers, Referer: origin + "/" };

      const resp = await axios.get(url, {
        timeout: 15_000,
        maxContentLength: 5 * 1024 * 1024,
        headers: hdrs,
        responseType: "text",
        maxRedirects: 5,
        // Accept any 2xx/3xx — treat 4xx/5xx as errors to try next strategy
        validateStatus: s => s >= 200 && s < 400,
      });
      return { html: resp.data, contentType: String(resp.headers?.["content-type"] || "") };
    } catch (err) {
      lastErr = err;
      // Only retry on 403/429/503 (bot-block signals). For genuine errors
      // (network unreachable, ECONNREFUSED) bail immediately.
      const status = err?.response?.status;
      const retriable = !status || status === 403 || status === 429 || status === 503 || status === 520 || status === 521 || status === 522;
      if (!retriable) throw err;
    }
  }
  throw lastErr;
}

// ─── Error classifier ────────────────────────────────────────────────────────
function classifyError(err) {
  const status = err?.response?.status;
  if (status === 403 || status === 401)
    return { code: 403, error: "Source site blocked access", hint: "This site requires a subscription or restricts automated access." };
  if (status === 404)
    return { code: 404, error: "Article not found", hint: "This article may have been removed or the link is broken." };
  if (status === 429)
    return { code: 429, error: "Rate limited by source site", hint: "The source site is temporarily blocking requests. Try again in a few minutes." };
  if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT" || err.message?.includes("timeout"))
    return { code: 504, error: "Source site timed out", hint: "The site took too long to respond. Try opening it directly." };
  if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN")
    return { code: 502, error: "Could not reach source site", hint: "DNS lookup failed. The site may be down." };
  return { code: 502, error: "Couldn't fetch article", hint: err.message || "Unknown error." };
}

// ─── Domain-specific alternate URL strategies ─────────────────────────────────
// For paywalled/bot-blocked sites, try AMP or mobile variants that bypass
// the paywall check or have simpler HTML that Readability handles better.
const DOMAIN_ALT_URL = {
  "bloomberg.com": (url) => {
    try {
      const u = new URL(url);
      if (!u.pathname.startsWith("/amp/")) {
        return "https://www.bloomberg.com/amp" + u.pathname;
      }
    } catch {}
    return null;
  },
  "ft.com": (url) => {
    try {
      const u = new URL(url);
      return `https://amp.ft.com${u.pathname}${u.search}`;
    } catch {}
    return null;
  },
  "wsj.com": (url) => {
    try {
      const u = new URL(url);
      if (!u.pathname.startsWith("/amp/")) {
        return `https://www.wsj.com/amp${u.pathname}`;
      }
    } catch {}
    return null;
  },
  "nytimes.com": (url) => {
    // NYT has a Google AMP cache version
    try {
      const u = new URL(url);
      const ampPath = u.hostname.replace(/\./g, "-") + u.pathname.replace(/\//g, "/");
      return `https://www-nytimes-com.cdn.ampproject.org/c/s/www.nytimes.com${u.pathname}`;
    } catch {}
    return null;
  },
  "thetimes.co.uk": (url) => {
    try {
      const u = new URL(url);
      return `https://amp.thetimes.co.uk${u.pathname}`;
    } catch {}
    return null;
  },
};

function getAltUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const fn = DOMAIN_ALT_URL[host];
    return fn ? fn(url) : null;
  } catch { return null; }
}

// ─── Meta-tag fallback extractor ─────────────────────────────────────────────
// When full Readability extraction fails (paywall / bot-block), extract meta
// tags to build a usable "preview" payload — title, description, image, author,
// publication date. Better than a blank screen.
function extractMetaFallback(html, url) {
  const get = (re) => {
    const m = html.match(re);
    return m ? m[1]
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim() : null;
  };

  const title =
    get(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
    get(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i) ||
    get(/<meta[^>]+name="title"[^>]+content="([^"]+)"/i) ||
    get(/<title>([^<]+)<\/title>/i);

  const description =
    get(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i) ||
    get(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/i) ||
    get(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);

  const image =
    get(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ||
    get(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);

  const author =
    get(/<meta[^>]+name="author"[^>]+content="([^"]+)"/i) ||
    get(/<meta[^>]+property="article:author"[^>]+content="([^"]+)"/i) ||
    get(/<meta[^>]+name="byl"[^>]+content="([^"]+)"/i);

  const published =
    get(/<meta[^>]+property="article:published_time"[^>]+content="([^"]+)"/i) ||
    get(/<meta[^>]+name="publishdate"[^>]+content="([^"]+)"/i) ||
    get(/<meta[^>]+itemprop="datePublished"[^>]+content="([^"]+)"/i);

  const siteName =
    get(/<meta[^>]+property="og:site_name"[^>]+content="([^"]+)"/i) ||
    new URL(url).hostname.replace(/^www\./, "");

  if (!title && !description) return null;

  // Build minimal HTML from extracted meta — gives Readability something to work
  // with AND gives the frontend a useful display even for hard-paywalled content.
  const paraDesc = description
    ? `<p>${description}</p>`
    : "";
  const imgTag = image
    ? `<p><img src="${image}" alt="" style="max-width:100%" /></p>`
    : "";
  const paywall = `<p><em>⚠️ Full article requires a subscription at <a href="${url}" target="_blank" rel="noopener">${siteName}</a>. The summary above is extracted from public metadata.</em></p>`;

  const content = `${imgTag}${paraDesc}${paywall}`;

  return {
    title,
    byline:        author,
    siteName,
    excerpt:       description,
    content,
    textContent:   description || "",
    length:        (description || "").length,
    lang:          null,
    publishedTime: published,
    url,
    isMeta: true,   // flag so frontend can show "preview only" badge
  };
}

// ─── Parse HTML with Readability ─────────────────────────────────────────────
function parseWithReadability(html, url) {
  const { document } = parseHTML(html);
  const reader = new Readability(document, { charThreshold: 20 });
  const article = reader.parse();
  if (!article || !article.content || article.length < 100) return null;
  return {
    title:         article.title         || null,
    byline:        article.byline        || null,
    siteName:      article.siteName      || new URL(url).hostname,
    excerpt:       article.excerpt       || null,
    content:       article.content,
    textContent:   article.textContent   || "",
    length:        article.length        || 0,
    lang:          article.lang          || null,
    publishedTime: article.publishedTime || null,
    url,
    isMeta: false,
  };
}

// ─── Route ───────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const url = String(req.query.url || "").trim();

  if (!isSafeUrl(url)) {
    return res.status(400).json({ success: false, error: "Invalid or unsafe URL" });
  }

  const cached = getCached(url);
  if (cached) return res.json({ success: true, data: cached, cached: true });

  // ── Step 1: fetch the original URL ───────────────────────────────────────
  let html, contentType, fetchErr;
  try {
    ({ html, contentType } = await fetchHtml(url));
  } catch (err) {
    fetchErr = err;
  }

  // ── Step 2: if blocked, try domain-specific alt URL (AMP / mobile) ───────
  if (fetchErr || (html && !contentType.includes("html"))) {
    const altUrl = getAltUrl(url);
    if (altUrl && isSafeUrl(altUrl)) {
      try {
        ({ html, contentType } = await fetchHtml(altUrl));
        fetchErr = null;
        logger.info(`reader: alt URL succeeded for ${url} → ${altUrl}`);
      } catch (altErr) {
        logger.warn(`reader: alt URL also failed for ${url}: ${altErr.message}`);
        // keep original fetchErr so we report the primary failure
      }
    }
  }

  // ── Step 3: if still no HTML, give up ────────────────────────────────────
  if (fetchErr) {
    const { code, error, hint } = classifyError(fetchErr);
    logger.warn(`reader fetch failed [${code}] ${url}: ${fetchErr.message}`);
    return res.status(code).json({ success: false, error, hint });
  }

  if (!contentType.includes("html")) {
    return res.status(415).json({ success: false, error: "Not an HTML page", hint: "This link points to a non-HTML resource (PDF, image, etc.)." });
  }

  // ── Step 4: parse with Readability ───────────────────────────────────────
  let payload = null;
  try {
    payload = parseWithReadability(html, url);
  } catch (err) {
    logger.warn(`reader parse error for ${url}: ${err.message}`);
  }

  // ── Step 5: if Readability got nothing, try alt URL HTML ─────────────────
  if (!payload) {
    const altUrl = getAltUrl(url);
    if (altUrl && isSafeUrl(altUrl)) {
      try {
        const { html: altHtml } = await fetchHtml(altUrl);
        payload = parseWithReadability(altHtml, url);
        if (payload) logger.info(`reader: Readability succeeded on alt URL for ${url}`);
      } catch {}
    }
  }

  // ── Step 6: last resort — extract meta tags only ─────────────────────────
  if (!payload) {
    payload = extractMetaFallback(html, url);
    if (payload) {
      logger.info(`reader: meta-only fallback used for ${url}`);
    }
  }

  if (!payload) {
    return res.status(422).json({
      success: false,
      error: "Could not extract article content",
      hint: "The page structure isn't compatible with reader extraction. Try reading on the source site.",
    });
  }

  setCached(url, payload);
  return res.json({ success: true, data: payload, cached: false });
});

export default router;
