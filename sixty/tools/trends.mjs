#!/usr/bin/env node
/**
 * trends.mjs — the Scout's raw intake, mechanical only (fetch, normalise, dedupe).
 * Judgement (clustering into stories, virality score, "why now") is the Scout agent's.
 *
 *   node sixty/tools/trends.mjs <out.json>
 *
 * Sources wired in Phase 0 (all public, no login, no scraping of IG/TikTok/X):
 *   - ScoopFeeds top-story scorer: /api/news/featured, plus the latest 100 articles
 *   - Google Trends daily trending RSS: US, GB, IN, and global (no geo)
 * NOT wired yet, stated rather than silently skipped (see sources_missing in the output):
 *   - YouTube Data API most-popular / Shorts (needs the API key on the Mac — DrJ)
 *   - Reddit API (unauthenticated JSON returns a block page — needs a Reddit app)
 *   - TikTok Creative Center, X API (paid tier not enabled)
 */
import { writeFileSync } from "fs";

const out = process.argv[2];
if (!out) { console.error("usage: trends.mjs <out.json>"); process.exit(1); }
const UA = "Scoopfeeds-60/0.1 (+https://scoopfeeds.com; contact: ops@scoopfeeds.com)";
const get = async (url, as = "json") => {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return as === "json" ? r.json() : r.text();
};
const strip = (s) => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const tag = (xml, t) => [...xml.matchAll(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, "g"))].map((m) => strip(m[1]));

const cands = [], errors = [];
try {
  const f = await get("https://scoopfeeds.com/api/news/featured?limit=20");
  f.data.forEach((a, i) => cands.push({ id: `sf-feat-${a.id}`, source: "scoopfeeds-featured", rank: i + 1, title: a.title, description: a.description, url: a.url || a.link, source_name: a.source_name || a.source, category: a.category, published_at: a.published_at }));
} catch (e) { errors.push(String(e.message)); }
try {
  const f = await get("https://scoopfeeds.com/api/news?limit=100");
  f.data.forEach((a, i) => cands.push({ id: `sf-${a.id}`, source: "scoopfeeds-latest", rank: i + 1, title: a.title, description: a.description, url: a.url || a.link, source_name: a.source_name || a.source, category: a.category, published_at: a.published_at }));
} catch (e) { errors.push(String(e.message)); }
for (const geo of ["US", "GB", "IN", ""]) {
  try {
    const xml = await get(`https://trends.google.com/trending/rss${geo ? `?geo=${geo}` : ""}`, "text");
    const items = xml.split("<item>").slice(1);
    items.forEach((it, i) => {
      const title = tag(it, "title")[0];
      const traffic = tag(it, "ht:approx_traffic")[0];
      const news = tag(it, "ht:news_item_title");
      const newsSrc = tag(it, "ht:news_item_source");
      cands.push({ id: `gt-${geo || "global"}-${i}`, source: `google-trends-${geo || "global"}`, rank: i + 1, title, traffic,
        description: news.slice(0, 3).join(" | "), source_name: newsSrc[0] || "", related_urls: tag(it, "ht:news_item_url").slice(0, 3) });
    });
  } catch (e) { errors.push(String(e.message)); }
}

// Dedupe: identical normalised titles only. Story-level clustering is the Scout's job.
const seen = new Map();
for (const c of cands) {
  const k = String(c.title || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (!k) continue;
  if (seen.has(k)) seen.get(k).also.push(c.source); else seen.set(k, { ...c, also: [] });
}
const list = [...seen.values()];
writeFileSync(out, JSON.stringify(list, null, 1));
console.log(JSON.stringify({ candidates: list.length, raw: cands.length, errors,
  sources_missing: ["youtube-data-api (no key on Mac)", "reddit-api (unauthenticated blocked)", "tiktok-creative-center", "x-api (no paid tier)"] }));
