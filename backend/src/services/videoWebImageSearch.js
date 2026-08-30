/**
 * videoWebImageSearch.js — the open web, at the top of the imagery cascade.
 *
 * WHY IT SITS ABOVE BODY-MINED. The pool-depth ceiling measured earlier
 * (~2.2 usable images per article, so a typical short carried ONE photograph
 * across seven beats) was an artefact of where the resolver was allowed to
 * look: the article page, Wikidata, and stock. Given the open web the same
 * stories yield materially more — measured across ten real stories on
 * 2026-08-30: 5.7 usable photographs per story, 2.6 of them from news
 * publishers.
 *
 * ─── What the measurement changed about the design ─────────────────────────
 *
 * DATE RESTRICTION IS A SIGNAL, NOT A FILTER. Restricting to the story's window
 * REDUCED publisher share on four of ten stories — West Bank went from four
 * publisher hits to zero — because social platforms republish fastest, so
 * `qdr:` surfaces Instagram and Facebook reposts rather than publisher
 * photography. The union of an open query and a dated one, ranked by source, is
 * what produced 5.7. Recency still contributes to confidence; it does not gate
 * the query.
 *
 * NEVER TRUST THE REPORTED DIMENSIONS. Serper's width/height are frequently the
 * thumbnail's. Gating on them discarded the actual AP photograph of Federer's
 * induction (599x399 reported) and the BBC one (865x487). Candidates are
 * measured after fetching, the way the body pool already does it — this module
 * returns candidates, and the caller fetches.
 *
 * CONFIDENCE COMES FROM THE SOURCE, consistent with the rest of the cascade:
 * a news-publisher domain with date proximity is "high"; anything else is
 * "low" and the caller may decline it. Nothing here scores an image against an
 * intent — that is the machinery that produced the polar bear.
 */

import { logger } from "./logger.js";
import { imageIdentity } from "./videoImageIdentity.js";

export const webImageSearchEnabled = () =>
  Boolean(process.env.SERPER_API_KEY) && process.env.VIDEO_WEB_IMAGES_ENABLED === "1";

const ENDPOINT = "https://google.serper.dev/images";

/**
 * News publishers. Presence here is a CONFIDENCE signal, never an admission
 * gate — measured: gating on it cost real photographs from time.com, the New
 * Yorker and the Moscow Times.
 *
 * Tested against `host + "."` so entries carrying their own TLD (ft.com,
 * ap.org) match — the first version required a trailing dot and could never
 * match any of them, which under-reported high-confidence by 13%.
 */
export const PUBLISHER_DOMAINS =
  /(reuters|apnews|ap\.org|afp|bbc|guardian|nytimes|washingtonpost|aljazeera|cnn|cnbc|ft\.com|bloomberg|dw\.com|france24|thehindu|timesofisrael|haaretz|jpost|espn|skysports|sky\.com|abc\.net|abs-cbn|npr|politico|axios|independent|telegraph|thetimes|lemonde|spiegel|euronews|nbcnews|cbsnews|usatoday|latimes|wsj|time\.com|newsweek|forbes|economist|thestreet|fool\.com|inc\.com|moscowtimes|kyivindependent|scmp|straitstimes|japantimes|thenationalnews|arabnews|middleeasteye|newyorker|theatlantic|vox|axios|semafor|unrwa\.org|un\.org)\./i;

/**
 * SOCIAL IS EXCLUDED OUTRIGHT, and this is the rule the date measurement
 * earned. These platforms republish fastest, so a date-restricted query fills
 * with them — and what it fills with is reposts, screenshots and graphics
 * rather than publisher photography. It is also precisely the repost-collapse
 * problem the incident lane already refuses.
 */
const SOCIAL = /(instagram|facebook|fb\.watch|x\.com|twitter|t\.co|tiktok|pinterest|reddit|youtube|youtu\.be|linkedin|threads|tumblr|vk\.com|telegram)\./i;

/** A watermarked licensing comp is not a usable picture. */
const LICENSING = /(reutersconnect|gettyimages|alamy|shutterstock|istockphoto|dreamstime|depositphotos|agefotostock|newscom|zuma|sipa|profimedia)\./i;

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

/** The two queries whose UNION the measurement showed is what works. */
export function buildQueries(intent, { headline = "", days = 14 } = {}) {
  // Headline entities plus the beat's own intent: the beat says what to point
  // a camera at, the headline says which event it belongs to. Neither alone is
  // enough — "ballot box" finds stock, "Iceland referendum" finds the story.
  const subject = [String(headline || "").slice(0, 90), String(intent || "")]
    .map((s) => s.trim()).filter(Boolean).join(" ");
  if (!subject) return [];
  return [
    { q: subject, tbs: null },
    { q: subject, tbs: `qdr:d${Math.max(1, Math.min(365, Math.round(days)))}` },
  ];
}

async function callSerper(q, tbs, _fetch) {
  const res = await _fetch(ENDPOINT, {
    method: "POST",
    headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ q, num: 10, ...(tbs ? { tbs } : {}) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`serper ${res.status}`);
  const body = await res.json();
  return Array.isArray(body?.images) ? body.images : [];
}

/**
 * Candidates for one beat, best-source first. NEVER THROWS — the web is an
 * enhancement and its failure costs a beat its picture, not the video.
 *
 * Returns [{ imageUrl, pageUrl, host, title, confidence }]. Dimensions are
 * deliberately absent: the caller fetches and measures, because the reported
 * ones are thumbnails often enough to matter.
 */
export async function searchEventImages(intent, { headline = "", days = 14, limit = 8, _fetch = fetch, _log = logger } = {}) {
  if (!process.env.SERPER_API_KEY) return [];
  const queries = buildQueries(intent, { headline, days });
  if (!queries.length) return [];

  const raw = [];
  for (const { q, tbs } of queries) {
    try { raw.push(...await callSerper(q, tbs, _fetch)); }
    catch (err) { _log.warn(`🔎 web images: ${tbs || "open"} query failed — ${String(err.message).slice(0, 90)}`); }
  }

  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const imageUrl = r?.imageUrl;
    if (!imageUrl) continue;
    const pageUrl = r?.link || "";
    const host = hostOf(pageUrl) || hostOf(imageUrl);
    if (SOCIAL.test(`${host}.`) || LICENSING.test(`${host}.`) || LICENSING.test(`${hostOf(imageUrl)}.`)) continue;
    // URL identity in front of the fetch, so a crop or size variant of a
    // picture we already have is never downloaded at all.
    const id = imageIdentity(imageUrl);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      imageUrl, pageUrl, host,
      title: String(r?.title || "").slice(0, 180),
      confidence: PUBLISHER_DOMAINS.test(`${host}.`) ? "high" : "low",
    });
  }
  // Publisher sources first; within a band the search engine's own order
  // stands. No scoring of image against intent, anywhere.
  out.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === "high" ? -1 : 1));
  _log.info(`🔎 web images "${String(intent).slice(0, 40)}": ${out.length} candidate(s), ` +
    `${out.filter((c) => c.confidence === "high").length} from publishers`);
  return out.slice(0, limit);
}
