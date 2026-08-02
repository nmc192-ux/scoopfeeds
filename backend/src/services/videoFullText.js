/**
 * videoFullText.js — on-demand full article text, for the one article about to
 * become a video. Fetch, extract, use, DISCARD.
 *
 * WHY THIS EXISTS. Measured 2026-08-02 across four prompt framings and three
 * model tiers: beat counts came back 26, 6, 5, 5 by prompt, and 5.0 / 5.5 / 6.5
 * by tier. Neither prompt nor model is the variable. The binding constraint is
 * INPUT — contentEnricher caps stored content at MAX_CONTENT_LEN = 5000 chars
 * (~350-850 words), and a body that size does not contain twelve distinct
 * beats. No rubric can enumerate what was never passed in.
 *
 * WHY NOT SIMPLY RAISE MAX_CONTENT_LEN. That cap governs EVERY article ingested
 * — thousands a day — while roughly five a day become videos. news.db is
 * already ~15 GB growing ~190 MB/day on a disk at 77%; multiplying stored body
 * text to serve 0.1% of rows is the wrong trade, and it is irreversible in the
 * sense that the bytes are written before anyone decides whether they were
 * needed. This module inverts it: pay one HTTP request at generation time, for
 * the article already chosen, and keep nothing.
 *
 * THE DISCIPLINE, and it is the whole point:
 *   - NO schema change. Nothing here reads or writes the database.
 *   - NO stored bytes. The text lives in a local variable for the duration of
 *     one spec call. There is deliberately no cache — a cache is storage with
 *     a different name, and it would reintroduce exactly the growth this
 *     avoids.
 *   - ONE request per video, bounded by timeout, never retried. A failed fetch
 *     falls back to the stored 5,000-char content and the video still ships;
 *     more input is an improvement, not a precondition.
 *
 * Extraction reuses contentEnricher.extractArticleText verbatim rather than
 * reimplementing readability — same heuristics, same blocked-host list, just a
 * larger length ceiling for text that is never persisted.
 */

import axios from "axios";
import { logger } from "./logger.js";
import { extractArticleText, BLOCKED_HOSTS, hostOf } from "./contentEnricher.js";

// 24,000 chars ≈ 6,000 tokens ≈ $0.0018 of input at the pinned flash rate —
// negligible against a spec's output cost, and comfortably inside every
// candidate model's context. Long enough that a 15-20k-char feature arrives
// whole, capped so a pathological page cannot blow the request up.
const MAX_FULLTEXT_LEN = Number.parseInt(process.env.VIDEO_FULLTEXT_MAX_CHARS || "24000", 10);

// Tighter than enrichment's 12s: this runs inline in the generation path, and a
// slow publisher must not hold a video hostage when usable text already exists.
const FETCH_TIMEOUT_MS = Number.parseInt(process.env.VIDEO_FULLTEXT_TIMEOUT_MS || "8000", 10);

// Only worth using if it beats what we already have by a real margin — a
// re-fetch that yields the same 5,000 chars is a wasted request, not an upgrade.
const MIN_GAIN_CHARS = 500;

const http = axios.create({
  timeout: FETCH_TIMEOUT_MS,
  maxRedirects: 3,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; ScoopBot/1.0; +https://scoopfeeds.com)",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
  },
  validateStatus: s => s >= 200 && s < 400,
  // A 24k-char article is ~200 KB of HTML; 5 MB is a generous ceiling that
  // still refuses a page that would stall the generation path.
  maxContentLength: 5 * 1024 * 1024,
  maxBodyLength: 5 * 1024 * 1024,
});

/**
 * Resolve the best available source text for one article.
 *
 * Never throws — every failure path returns the stored content, because a
 * shorter video beats no video. Returns:
 *   { text, chars, origin: "fetched"|"stored", reason }
 *
 * `origin` and `reason` are recorded in spec meta so the mix of fetched vs
 * stored is reviewable: a sudden collapse to all-stored means a publisher
 * started blocking us, and that shows up as shorter videos long before anyone
 * would think to check the fetcher.
 */
export async function resolveVideoSourceText(article) {
  const stored = String(article?.content || "");
  const fallback = (reason) => ({ text: stored, chars: stored.length, origin: "stored", reason });

  const url = article?.url;
  if (!url) return fallback("no_url");

  const host = hostOf(url);
  if (BLOCKED_HOSTS.has(host)) return fallback("blocked_host");

  const started = Date.now();
  try {
    const { data: html } = await http.get(url);
    const text = extractArticleText(html, { maxLen: MAX_FULLTEXT_LEN });
    if (!text) return fallback("extract_failed");

    // Refuse a downgrade. Extraction can return less than the stored copy when
    // a page reorganises behind a consent wall or renders body text in JS.
    if (text.length < stored.length + MIN_GAIN_CHARS) {
      return fallback(`no_gain (fetched ${text.length} vs stored ${stored.length})`);
    }

    logger.info(
      `📄 videoFullText [${article.id}]: ${stored.length} → ${text.length} chars ` +
      `(${(text.length / Math.max(1, stored.length)).toFixed(1)}x) from ${host} in ${Date.now() - started}ms`
    );
    return { text, chars: text.length, origin: "fetched", reason: null };
  } catch (err) {
    logger.warn(`📄 videoFullText [${article?.id}]: fetch failed (${err.code || err.message}) — using stored content`);
    return fallback(`fetch_error: ${err.code || err.message}`);
  }
}

export const _internals = { MAX_FULLTEXT_LEN, FETCH_TIMEOUT_MS, MIN_GAIN_CHARS };
