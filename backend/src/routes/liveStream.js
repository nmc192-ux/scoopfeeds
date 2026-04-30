/**
 * /api/live-stream
 *
 * Returns the current YouTube live-stream video ID for each channel.
 * Strategy (per channel):
 *   1. Use a known permanent 24/7 stream ID if the channel has one.
 *   2. Otherwise scrape the channel's YouTube /live page for the current ID.
 * Results cached 10 minutes.
 */

import https from "https";
import express from "express";

const router = express.Router();

/* ─── Channel definitions ──────────────────────────────────────────────────────
   permanentId : stable 24/7 stream that never changes — skip scraping
   handle      : YouTube @handle used when scraping is needed
   channelId   : UC... channel ID used as final embed fallback
   ─────────────────────────────────────────────────────────────────────────── */
const CHANNELS = [
  // Permanent 24/7 streams — these video IDs are stable for months/years
  { id: "aljazeera", permanentId: "gCNeDWCI0vo", handle: "AlJazeeraEnglish" },
  { id: "france24",  permanentId: "Ap-UM1O9RBU", handle: "FRANCE24English"  },
  { id: "geo",       permanentId: "_FwympjOSNE", handle: "geonews"           },

  // Scrape /live page for current stream; fallback to verified live ID
  // BBC and Sky don't maintain a single permanent video ID — rely on scraping only
  { id: "bbc",     handle: "BBCNews",   channelId: "UC16niRr50-MSBwiO3YDb3RA" },
  { id: "skynews", handle: "SkyNews",   channelId: "UCoMdktPbSTixAyNGwb-UYkQ" },
  { id: "dw",      handle: "DWNews",    channelId: "UCknLrEdhRCp1aegoMqRaCZg", fallbackId: "LuKwFajn37U" },
  { id: "wion",    handle: "WION",      channelId: "UC_gUM8rL-Lrg6O3adPW9K1g", fallbackId: "gadjsB5BkK4" },
  // ARY @handle is bot-blocked — must use channel ID URL
  { id: "ary",     handle: "ARYNEWSTVofficial", channelId: "UCMmpLL2ucRHAXbNHiCPyIyg", fallbackId: "K77zGtR_X58" },

  // ── Global expansion ──────────────────────────────────────────────────────
  // Americas
  { id: "abcnews",   handle: "ABCNews",          channelId: "UCBi2mrWuNuyYy4gbM6fU18Q", fallbackId: "iipR5yUp36o" },
  { id: "cbsnews",   handle: "CBSNews",          channelId: "UC8p1vwvWtl6T73JiExfWs1g", fallbackId: "u90I_CIBtM8" },
  { id: "bloomberg", handle: "Bloomberg",        channelId: "UCIALMKvObZNtJ6AmdCLP7Lg", fallbackId: "iEpJwprxDdk" },
  // Asia
  { id: "ndtv",      handle: "ndtv",             channelId: "UCZFMm1mMw0F81Z37aaEzTUA", fallbackId: "nSoxfu2tVAA" },
  { id: "cna",       handle: "channelnewsasia",  channelId: "UCXKCHNtNbjMl2wTbo5xs0KA", fallbackId: "XWq5kBlakcQ" },
  // channelId verified against https://www.youtube.com/channel/UCSPEjw8F2nQDtmUKPFNF7_A
  { id: "nhkworld",  handle: "NHKWORLDJAPAN",    channelId: "UCSPEjw8F2nQDtmUKPFNF7_A", fallbackId: "f0lYkdA-Gtw" },
  // channelId verified; fallbackId was pointing to unrelated ship-tracking stream — fixed
  { id: "cgtn",      handle: "CGTN",             channelId: "UCgrNz-aDmcr2uuto8_DL2jg", fallbackId: "BOy2xDU1LC8" },
  // MENA / Africa
  { id: "trtworld",  handle: "trtworld",         channelId: "UC7fWeaHhqgM4Ry-RMpM2YYw", fallbackId: "1VUhRQpz_9o" },
  // i24 uses @i24NEWS_EN handle; channelId verified
  { id: "i24",       handle: "i24NEWS_EN",        channelId: "UCvHDpsWKADrDia0c99X37vg", fallbackId: "lqfJJ5riJag" },
  // channelId verified against https://www.youtube.com/channel/UC1_E8NeF5QHY2dtdLRBCCLA
  { id: "africanews",handle: "africanews",       channelId: "UC1_E8NeF5QHY2dtdLRBCCLA", fallbackId: "NQjabLGdP5g" },
  // European multi-language
  // f24fr — French-language France 24 (@FRANCE24, not @FRANCE24English)
  { id: "f24fr",     handle: "FRANCE24",         channelId: "UCCCPCZNChQdGa9EkATeye4g", fallbackId: "l8PMl7tUDIE" },
  // dwde — DW German; channelId verified
  { id: "dwde",      handle: "deutschewelle",    channelId: "UCMIgOXM2JEQ2Pv2d0_PVfcg" },
  { id: "euronews",  handle: "euronews",         channelId: "UCSrZ3UV4jOidv8ppoVuvW9Q", fallbackId: "pykpO5kQJ98" },
  // Latin America — channelIds verified; globonews has no reliable permanent fallback ID
  { id: "globonews", handle: "globonews",        channelId: "UCp6RRaz93Pt2xYZoEye_rLA" },
  // dwes channelId verified against https://www.youtube.com/channel/UCT4Jg8h03dD0iN3Pb5L0PMA
  { id: "dwes",      handle: "dwespanol",        channelId: "UCT4Jg8h03dD0iN3Pb5L0PMA", fallbackId: "yZh3xsFqCt8" },
  // South Asia (Hindi)
  { id: "aajtak",    handle: "aajtak",           channelId: "UCt4t-jeY85JegMlZ-E5UWtA", fallbackId: "Nq2wYlWFucg" },
];

/* ─── In-memory cache ──────────────────────────────────────────────────────── */
const TTL_MS = 10 * 60 * 1000;
const cache  = new Map(); // id → { videoId, expiresAt }

/* ─── HTTP fetch helper ────────────────────────────────────────────────────── */
function fetchText(url, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 3) return reject(new Error("Too many redirects"));
    const req = https.get(url, {
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const next = res.headers.location.startsWith("/")
          ? `https://www.youtube.com${res.headers.location}` : res.headers.location;
        return fetchText(next, hops + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let body = "";
      res.on("data", c => (body += c));
      res.on("end",  () => resolve(body));
    });
    req.on("error", reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

/* ─── Scrape a /live page URL for current live video ID ───────────────────── */
async function scrapeCurrentLiveUrl(url) {
  const html = await fetchText(url);

  // 1. og:url meta tag — most reliable when the page resolves to a video
  const ogMatch = html.match(/<meta property="og:url" content="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})"/);
  if (ogMatch) return ogMatch[1];

  // 2. "videoId":"..." adjacent to "isLive":true
  const isLiveIdx = html.indexOf('"isLive":true');
  if (isLiveIdx !== -1) {
    const window = html.substring(Math.max(0, isLiveIdx - 300), isLiveIdx + 300);
    const m = window.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    if (m) return m[1];
  }

  // 3. First "videoId" anywhere (last resort)
  const anyMatch = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
  return anyMatch ? anyMatch[1] : null;
}

/* ─── Get video ID for one channel ────────────────────────────────────────── */
async function getVideoId(ch) {
  // Check cache
  const cached = cache.get(ch.id);
  if (cached && Date.now() < cached.expiresAt) return cached.videoId;

  let videoId = null;

  if (ch.permanentId) {
    // Permanent 24/7 stream — no need to scrape
    videoId = ch.permanentId;
  } else {
    // Try @handle first, then channel ID URL as fallback
    const urls = [];
    if (ch.handle)    urls.push(`https://www.youtube.com/@${ch.handle}/live`);
    if (ch.channelId) urls.push(`https://www.youtube.com/channel/${ch.channelId}/live`);

    for (const url of urls) {
      try {
        videoId = await scrapeCurrentLiveUrl(url);
        if (videoId) break;
      } catch { /* try next */ }
    }

    // If scraping failed, use the known fallback ID
    if (!videoId && ch.fallbackId) videoId = ch.fallbackId;
  }

  cache.set(ch.id, { videoId, expiresAt: Date.now() + TTL_MS });
  return videoId;
}

/* ─── Route ────────────────────────────────────────────────────────────────── */
router.get("/", async (req, res) => {
  const results = await Promise.allSettled(
    CHANNELS.map(async ch => ({ id: ch.id, videoId: await getVideoId(ch) }))
  );

  const streams = {};
  results.forEach((r, i) => {
    streams[CHANNELS[i].id] = r.status === "fulfilled" ? r.value.videoId : null;
  });

  res.json({ success: true, streams });
});

export default router;
