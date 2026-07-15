/**
 * Live Events synthesizer — builds the dossiers rendered on the "Live" tab.
 *
 * For each seeded event:
 *   1. Pull related articles from the DB (keyword OR-match, preferred-
 *      source boost). See findArticlesForEvent.
 *   2. Ask Gemini 1.5 Flash (free tier, 15 RPM) to collapse them into a
 *      timestamped point-wise brief + extract metric estimates. If no
 *      GEMINI_API_KEY is configured, fall back to a deterministic brief
 *      built straight from article headlines (no hallucination risk).
 *   3. Fetch live metrics (crude oil quote) and overlay them onto the
 *      LLM output.
 *   4. Cache the dossier in live_events (JSON blobs).
 *
 * Why Gemini 1.5 Flash: it's free, fast, and handles 30–50 article
 * excerpts in one prompt without hitting the free-tier rate limits when
 * refreshed hourly. Phase C will route this through a self-hosted model
 * on HF if the free tier is insufficient.
 */

import axios from "axios";
import { LIVE_EVENTS } from "../config/liveEvents.js";
import {
  findArticlesForEvent,
  upsertLiveEvent,
} from "../models/database.js";
import { rankByAuthenticity, scoreFor } from "../config/mediaAuthenticity.js";
import { fetchEventSocialSignals } from "./socialSignals.js";
import { logger } from "./logger.js";
import {
  buildGeminiGenerationConfig,
  isGeminiThinkingRejection,
  markGeminiThinkingRejected,
  isGeminiModelGone,
  markGeminiModelGone,
  consumeLlmBudget,
} from "../realityIndex/llmQueue.js";

// PINNED (2026-07-15 cost incident) — same pin + rates as llmQueue:
// gemini-2.5-flash, $0.30/1M input, $2.50/1M output. This site also had no
// output cap while thinking billed as output.
const GEMINI_MODEL = process.env.GEMINI_GENERATION_MODEL || "gemini-2.5-flash";
const GEMINI_ENDPOINT = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
const GEMINI_MAX_OUTPUT_TOKENS = Number.parseInt(process.env.LIVE_EVENTS_MAX_OUTPUT_TOKENS || "1536", 10);

// ─── Metric fetchers ───────────────────────────────────────────────────────

// Brent crude via Yahoo Finance v8 (same pattern used in routes/market.js).
// Returns { price, change, pctChange, currency, asOf } or null on failure.
async function fetchBrentCrude() {
  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/BZ=F?interval=1d&range=5d";
  try {
    const { data } = await axios.get(url, {
      timeout: 6000,
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    const r = data?.chart?.result?.[0];
    const meta = r?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose;
    const change = price - prevClose;
    const pctChange = (change / prevClose) * 100;
    return {
      value: Number(price.toFixed(2)),
      unit: "USD/bbl",
      change: Number(change.toFixed(2)),
      pctChange: Number(pctChange.toFixed(2)),
      source: "Yahoo Finance (BZ=F)",
      asOf: new Date(meta.regularMarketTime * 1000).toISOString(),
    };
  } catch (err) {
    logger.warn("Brent crude fetch failed", { error: err.message });
    return null;
  }
}

function buildCeasefireTile(ceasefireIso) {
  if (!ceasefireIso) {
    return {
      value: null,
      unit: "—",
      note: "No active ceasefire agreement tracked",
      source: null,
    };
  }
  const ts = new Date(ceasefireIso).getTime();
  const now = Date.now();
  const ms = ts - now;
  if (ms < 0) {
    return { value: "Expired", unit: "", note: `Expired on ${new Date(ts).toDateString()}`, source: null };
  }
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  return {
    value: `${days}d ${hours}h`,
    unit: "remaining",
    note: `Until ${new Date(ts).toDateString()}`,
    source: null,
  };
}

// ─── Gemini synthesizer ────────────────────────────────────────────────────

function buildPrompt(event, articles, socialPosts = []) {
  const items = articles.map((a, i) => {
    const when = new Date(a.published_at).toISOString();
    const desc = (a.description || "").slice(0, 400);
    return `[${i + 1}] ${when} — ${a.source_name} — ${a.title}\n    ${desc}\n    URL: ${a.url}`;
  }).join("\n\n");

  const socialBlock = socialPosts.length > 0
    ? "\n\nPrimary-source social posts (treat as leads, not verified facts — cite with the (social) suffix):\n" +
      socialPosts.slice(0, 10).map((p, i) => {
        const when = new Date(p.published_at).toISOString();
        const desc = (p.description || "").slice(0, 240);
        return `[S${i + 1}] ${when} — ${p.source_name} — ${p.title}\n    ${desc}`;
      }).join("\n\n")
    : "";

  return `You are Scoop's live-events desk editor. Build a neutral, timestamped briefing on the "${event.title}".

Ground rules:
- Only use facts supported by the sources below. If a fact appears in just one source, flag it with "(single-source)".
- Primary-source social posts (S-prefixed) are leads only — a point that rests on a social post alone must say "(social)" and must not be stated as a confirmed fact.
- Order points newest first.
- Each point: 1-2 short sentences, specific, factual. No speculation, no adjectives like "shocking".
- Cite 1-3 source numbers per point as sourceIndices (1-based). Use "S" prefix for social.
- Also return rough metric estimates if the sources support them. Use null when unknown — NEVER guess.

Return ONLY valid JSON with this exact shape:
{
  "summary": "One-sentence headline (max 140 chars)",
  "brief": [
    { "ts": "ISO-8601 timestamp", "text": "...", "sourceIndices": [1, 3] }
  ],
  "metrics": {
    "casualties":   { "value": <number or null>, "unit": "people", "note": "short qualifier" },
    "economicLoss": { "value": <number or null>, "unit": "USD",    "note": "..." }
  }
}

Sources:
${items}${socialBlock}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Free-tier Gemini intermittently returns 503 UNAVAILABLE / 429 RESOURCE_EXHAUSTED
// for prompts of this size. Retry transient errors with exponential backoff so
// we don't silently fall back to deterministic briefs every cycle.
async function synthesizeWithGemini(event, articles, socialPosts = []) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (articles.length === 0 && socialPosts.length === 0) return null;
  const prompt = buildPrompt(event, articles, socialPosts);
  if (!consumeLlmBudget("live-events")) return null; // global daily rail (gate a)
  const RETRY_DELAYS_MS = [4000, 9000, 18000];

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const { data } = await axios.post(
        GEMINI_ENDPOINT(key),
        {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: buildGeminiGenerationConfig({
            temperature: 0.2,
            responseMimeType: "application/json",
            maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
          }),
        },
        { timeout: 25000 }
      );
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        const fr = data?.candidates?.[0]?.finishReason;
        const thought = data?.usageMetadata?.thoughtsTokenCount;
        logger.warn(`🛰️  Gemini empty text for event ${event.id} (finishReason=${fr ?? "?"}, thoughtsTokenCount=${thought ?? "?"})`);
        return null;
      }
      const parsed = JSON.parse(text);
      // Attach source objects using the indices Gemini returned.
      const brief = (parsed.brief || []).map((p) => ({
        ts: p.ts,
        text: p.text,
        sources: (p.sourceIndices || [])
          .map((i) => articles[i - 1])
          .filter(Boolean)
          .map((a) => ({ name: a.source_name, url: a.url })),
      }));
      return {
        summary: parsed.summary || null,
        brief,
        metrics: parsed.metrics || {},
      };
    } catch (err) {
      if (isGeminiThinkingRejection(err)) {
        markGeminiThinkingRejected(logger);
        continue;
      }
      if (isGeminiModelGone(err)) {
        markGeminiModelGone(GEMINI_MODEL, logger);
        return null; // pin is dead — deterministic brief takes over
      }
      const status = err.response?.status;
      const transient = status === 503 || status === 429 || err.code === "ECONNRESET" || err.code === "ETIMEDOUT";
      if (transient && attempt < RETRY_DELAYS_MS.length) {
        logger.warn(`🛰️  Gemini ${status || err.code} for event ${event.id} — retrying in ${RETRY_DELAYS_MS[attempt]}ms`);
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      logger.warn("Gemini synthesis failed", { event: event.id, status, error: err.message });
      return null;
    }
  }
  return null;
}

// Deterministic fallback — no LLM, no hallucination. Just the most recent
// headlines from preferred sources, presented as a timeline.
function fallbackSynthesize(event, articles, socialPosts = []) {
  const articleBrief = articles.slice(0, 10).map((a) => ({
    ts: new Date(a.published_at).toISOString(),
    text: a.title,
    sources: [{ name: a.source_name, url: a.url }],
  }));
  // Add top-3 social signals marked as primary-source leads so the
  // audience sees them but the UI can visually distinguish them.
  const socialBrief = socialPosts.slice(0, 3).map((p) => ({
    ts: new Date(p.published_at).toISOString(),
    text: `${p.title} (social — lead, not verified)`,
    sources: [{ name: p.source_name, url: p.url }],
  }));
  const brief = [...articleBrief, ...socialBrief].sort(
    (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()
  );
  const outletCount = new Set(articles.slice(0, 10).map((a) => a.source_name)).size;
  const summary = articles.length > 0
    ? `${articles.length} recent updates from ${outletCount} outlets` +
      (socialPosts.length ? ` + ${socialPosts.length} social posts` : "")
    : socialPosts.length > 0
    ? `No mainstream articles yet — ${socialPosts.length} social posts pending verification`
    : "No recent updates found in ingested feeds yet";
  return { summary, brief, metrics: {} };
}

// ─── Per-event refresh ─────────────────────────────────────────────────────

export async function refreshEvent(eventConfig) {
  const rawArticles = findArticlesForEvent({
    keywords: eventConfig.keywords,
    preferredSources: eventConfig.preferredSources,
    limit: 40,
  });

  // Re-rank by media-authenticity score (topic/region-aware) so the
  // most trusted outlets for this beat feed into the LLM prompt first.
  const articles = rankByAuthenticity(rawArticles, {
    topic: eventConfig.topicBeat,
    region: eventConfig.countryCode,
  }).slice(0, 30);

  // Pull X / Truth Social posts if RSSHub is configured. These are
  // passed to the synthesizer as additional low-trust sources (LLM is
  // told to treat them as primary-source signals, not wire reports).
  const social = await fetchEventSocialSignals(eventConfig);

  // Try LLM first, fall back to deterministic brief.
  let synth = await synthesizeWithGemini(eventConfig, articles, social.posts);
  if (!synth) synth = fallbackSynthesize(eventConfig, articles, social.posts);

  // Merge LLM metrics with live fetchers.
  const brent = await fetchBrentCrude();
  const metrics = {
    ...(eventConfig.baseline || {}),
    ...(synth.metrics || {}),
  };
  if (brent) metrics.crudeOil = brent;
  metrics.ceasefireClock = buildCeasefireTile(eventConfig.ceasefire);

  const ceasefireAt = eventConfig.ceasefire
    ? new Date(eventConfig.ceasefire).getTime()
    : null;

  // Attach a provenance footer — which outlets fed this dossier and
  // their authenticity scores. Useful for the "why should I trust
  // this?" panel in the UI + a debug aid for us.
  const provenance = {
    outlets: Array.from(new Set(articles.map((a) => a.source_name))).slice(0, 12).map((name) => ({
      name,
      score: scoreFor(name, {
        topic: eventConfig.topicBeat,
        region: eventConfig.countryCode,
      }),
    })),
    socialEnabled: social.enabled,
    socialPosts: social.posts.length,
    llmUsed: Boolean(process.env.GEMINI_API_KEY),
  };

  upsertLiveEvent({
    id: eventConfig.id,
    title: eventConfig.title,
    subtitle: eventConfig.subtitle,
    emoji: eventConfig.emoji,
    status: eventConfig.status,
    region: eventConfig.region,
    brief: synth.brief,
    metrics: { ...metrics, _provenance: provenance },
    summary: synth.summary,
    updated_at: Date.now(),
    ceasefire_at: ceasefireAt,
  });

  return {
    id: eventConfig.id,
    briefCount: synth.brief.length,
    articlesUsed: articles.length,
    socialUsed: social.posts.length,
  };
}

export async function refreshAllEvents() {
  const results = [];
  for (let i = 0; i < LIVE_EVENTS.length; i++) {
    const evt = LIVE_EVENTS[i];
    try {
      results.push(await refreshEvent(evt));
    } catch (err) {
      logger.error("Event refresh failed", { event: evt.id, error: err.message });
    }
    // Space Gemini calls out — free tier is 15 RPM and these prompts are
    // large enough to hit transient 503/429. 5s gap keeps us safely under
    // the limit without dragging the cycle out.
    if (i < LIVE_EVENTS.length - 1) await sleep(5000);
  }
  logger.info(`🛰️  Live events refreshed: ${results.length}`);
  return results;
}
