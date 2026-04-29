/**
 * /api/reader?url=... — server-side article extraction using Mozilla Readability.
 *
 * Returns a clean article payload {title, byline, content, excerpt, siteName, length, url}
 * so the frontend can render a distraction-free in-app reader instead of bouncing to
 * the source site.
 *
 * Caching: 12h per URL in memory. Timeouts: 10s fetch.
 * Safety: only http/https URLs; blocks loopback/private-IP targets.
 */
import { Router } from "express";
import axios from "axios";
import { Readability } from "@mozilla/readability";
import { logger } from "../services/logger.js";

const router = Router();

// jsdom is loaded lazily — it has a transitive CJS→ESM compat issue with
// html-encoding-sniffer/@exodus/bytes that crashes Node 18 at module load
// time. Lazy-loading lets the rest of the server start even if jsdom fails.
let _JSDOM = null;
async function getJSDOM() {
  if (_JSDOM) return _JSDOM;
  const mod = await import("jsdom");
  _JSDOM = mod.JSDOM;
  return _JSDOM;
}

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
    // drop 50 oldest entries
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

const UA = "Mozilla/5.0 (compatible; ScoopReader/1.0; +https://scoopfeeds.com)";

// ─── Route ───────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const url = String(req.query.url || "").trim();

  if (!isSafeUrl(url)) {
    return res.status(400).json({ success: false, error: "Invalid or unsafe URL" });
  }

  const cached = getCached(url);
  if (cached) return res.json({ success: true, data: cached, cached: true });

  try {
    const { data: html, headers } = await axios.get(url, {
      timeout: 10_000,
      maxContentLength: 5 * 1024 * 1024, // 5MB
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en;q=0.9,*;q=0.5",
      },
      responseType: "text",
      validateStatus: s => s < 400,
    });

    const ct = String(headers?.["content-type"] || "");
    if (!ct.includes("html")) {
      return res.status(415).json({ success: false, error: "Not an HTML page" });
    }

    const JSDOM = await getJSDOM();
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.content) {
      return res.status(422).json({ success: false, error: "Could not extract article content" });
    }

    const payload = {
      title:    article.title || null,
      byline:   article.byline || null,
      siteName: article.siteName || new URL(url).hostname,
      excerpt:  article.excerpt || null,
      content:  article.content,        // sanitized HTML
      textContent: article.textContent || "",
      length:   article.length || 0,
      lang:     article.lang || null,
      publishedTime: article.publishedTime || null,
      url,
    };

    setCached(url, payload);
    res.json({ success: true, data: payload, cached: false });
  } catch (err) {
    logger.warn(`reader extract failed for ${url}: ${err.message}`);
    res.status(502).json({ success: false, error: "Fetch or parse failed", message: err.message });
  }
});

export default router;
