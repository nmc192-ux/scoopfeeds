/**
 * analysisService.js — Gemini-powered news analysis pipeline.
 *
 * Runs every 2h via the scheduler. Produces:
 *   • Story clusters   — heuristic bigram grouping + Gemini briefing
 *   • Perspectives     — per-cluster outlet framing (top 3 clusters only)
 *   • Explained pieces — long-form Gemini analysis for top-2 categories
 *   • Topic trends     — pure SQL count aggregation (no LLM cost)
 *
 * Article deep dives are on-demand only (called from the route handler,
 * not from this scheduler cycle).
 *
 * Rate-limit budget: 15 RPM free tier.
 *   8 briefings + 3 perspectives + 2 explained = 13 calls / 2h run
 *   ≈ 1.86 RPM — well within limits.
 * Sequential calls with 4s sleep between them keep us safely below the cap.
 */

import axios from "axios";
import crypto from "crypto";
import {
  getDb,
  upsertStoryCluster,
  upsertExplainedPiece,
  upsertArticleAnalysisCache,
  getArticleAnalysisCache,
  getArticleById,
  listRelatedStories,
} from "../models/database.js";
import { logger } from "./logger.js";

const GEMINI_MODEL    = "gemini-1.5-flash-latest";
const GEMINI_ENDPOINT = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

// ─── Helpers ──────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const { data } = await axios.post(
      GEMINI_ENDPOINT(key),
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      },
      { timeout: 25000 }
    );
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    return JSON.parse(text);
  } catch (err) {
    logger.warn("📊 Gemini call failed", { error: err.message });
    return null;
  }
}

// ─── Heuristic story clustering ───────────────────────────────────────────
//
// Groups recent articles by shared title bigrams. No LLM cost — the LLM
// only runs AFTER clusters are formed, to write the brief.

const CLUSTER_STOPWORDS = new Set([
  "about", "after", "against", "amid", "among", "before", "being", "between",
  "both", "could", "during", "every", "first", "from", "have", "having",
  "into", "just", "last", "made", "make", "many", "more", "most", "much",
  "must", "news", "only", "other", "over", "reports", "said", "same", "says",
  "some", "still", "such", "than", "that", "them", "then", "there", "these",
  "they", "this", "those", "through", "under", "until", "very", "what",
  "when", "where", "which", "while", "will", "with", "would", "your",
  "update", "updates", "latest", "live", "report", "breaking", "watch",
  "read", "here", "week", "year", "month", "time", "days", "hours",
]);

function extractBigrams(title) {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 4 && !CLUSTER_STOPWORDS.has(t));
  const bigrams = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return { tokens, bigrams };
}

/**
 * Group last-24h articles into story clusters using shared bigram overlap.
 * Returns clusters sorted by article count (most covered first), capped at 8.
 */
export function clusterRecentArticles({ windowHours = 24, minArticles = 3 } = {}) {
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
  const articles = getDb().prepare(`
    SELECT id, title, description, url, source_name, category, published_at,
           credibility, image_url
    FROM   articles
    WHERE  published_at > ? AND credibility >= 5 AND is_duplicate = 0
    ORDER  BY credibility DESC, published_at DESC
    LIMIT  300
  `).all(cutoff);

  if (articles.length === 0) return [];

  const articleBigrams = articles.map(a => extractBigrams(a.title).bigrams);

  // Greedy clustering: article joins first cluster with 2+ shared bigrams.
  const clusters = [];
  const assigned = new Set();

  for (let i = 0; i < articles.length; i++) {
    if (assigned.has(i)) continue;
    const bgs = new Set(articleBigrams[i]);
    if (bgs.size === 0) continue;

    let merged = false;
    for (const cl of clusters) {
      const shared = [...cl.sigBigrams].filter(b => bgs.has(b)).length;
      if (shared >= 2) {
        cl.articleIdxs.push(i);
        // Only grow signature from high-credibility sources to avoid drift
        if (articles[i].credibility >= 7) {
          for (const b of articleBigrams[i]) cl.sigBigrams.add(b);
        }
        assigned.add(i);
        merged = true;
        break;
      }
    }

    if (!merged) {
      clusters.push({ sigBigrams: new Set(articleBigrams[i]), articleIdxs: [i] });
      assigned.add(i);
    }
  }

  return clusters
    .filter(cl => cl.articleIdxs.length >= minArticles)
    .map(cl => {
      const clArticles = cl.articleIdxs.map(i => articles[i]);
      // Anchor = most-credible article (already sorted by credibility)
      const anchor = clArticles[0];
      // Category = plurality vote
      const cats = {};
      for (const a of clArticles) cats[a.category] = (cats[a.category] || 0) + 1;
      const category = Object.entries(cats).sort((a, b) => b[1] - a[1])[0][0];
      // Stable cluster ID from anchor title
      const id = crypto
        .createHash("sha256")
        .update(anchor.title.toLowerCase())
        .digest("hex")
        .slice(0, 16);
      // Keywords = unique tokens from signature bigrams
      const keywords = [...new Set([...cl.sigBigrams].flatMap(b => b.split(" ")))].slice(0, 12);

      return {
        id,
        title: anchor.title,
        category,
        keywords,
        articles:      clArticles.slice(0, 25),
        article_count: clArticles.length,
        image_url:     clArticles.find(a => a.image_url)?.image_url || null,
      };
    })
    .sort((a, b) => b.article_count - a.article_count)
    .slice(0, 8);
}

// ─── Prompt builders ──────────────────────────────────────────────────────

function buildBriefingPrompt(cluster) {
  const items = cluster.articles.map((a, i) => {
    const when = new Date(a.published_at).toISOString();
    const desc = (a.description || "").slice(0, 350);
    return `[${i + 1}] ${when} — ${a.source_name} — ${a.title}\n    ${desc}\n    URL: ${a.url}`;
  }).join("\n\n");

  return `You are Scoop's analysis desk editor. Write a neutral, factual briefing on "${cluster.title}".

Ground rules:
- Only use facts from the sources below. No speculation.
- Order brief points newest first. Each point: 1-2 short factual sentences.
- Cite 1-3 source indices per point as sourceIndices (1-based integers).

Return ONLY valid JSON with this exact shape:
{
  "summary": "One-sentence headline max 140 chars",
  "brief": [
    { "ts": "ISO-8601 timestamp", "text": "...", "sourceIndices": [1, 2] }
  ]
}

Sources:
${items}`;
}

function buildPerspectivesPrompt(cluster) {
  const items = cluster.articles.slice(0, 15).map((a, i) =>
    `[${i + 1}] ${a.source_name}: ${a.title}\n    ${(a.description || "").slice(0, 200)}`
  ).join("\n\n");

  return `Given these articles on "${cluster.title}" from different news outlets, identify 3-5 distinct editorial angles or framings.

For each angle: which outlet(s) take it, what framing do they use (1 sentence), and a representative quote (max 20 words).

Return ONLY a valid JSON array:
[
  {
    "sourceName": "Reuters",
    "outlets": ["Reuters", "AP"],
    "angle": "...",
    "quote": "..."
  }
]

Articles:
${items}`;
}

function buildExplainedPrompt(topic, articles) {
  const items = articles.slice(0, 20).map((a, i) =>
    `[${i + 1}] ${a.source_name}: ${a.title}\n    ${(a.description || "").slice(0, 300)}`
  ).join("\n\n");

  return `Write a comprehensive, neutral explainer on "${topic}" based on these ${articles.length} articles.

Return ONLY valid JSON:
{
  "title": "...",
  "summary": "2-sentence opening summary",
  "content": "<HTML body, 400-600 words, use <h3>, <p>, <ul>/<li> tags only>",
  "facts": [
    { "value": "42%", "unit": "", "label": "...", "source": "..." }
  ],
  "timeline": [
    { "date": "YYYY-MM-DD", "event": "...", "source": "..." }
  ]
}

Articles:
${items}`;
}

function buildDeepDivePrompt(article) {
  const text = [
    article.title,
    article.description || "",
    (article.content || "").slice(0, 2000),
  ].join("\n\n");

  return `Analyze this news article. Return ONLY valid JSON:
{
  "takeaways": ["bullet 1", "bullet 2", "bullet 3"],
  "tone": "neutral|critical|optimistic|alarming|analytical",
  "toneReason": "1 short sentence explaining the tone classification"
}

Article:
${text}`;
}

// ─── Deterministic fallback (no GEMINI_API_KEY) ───────────────────────────

function fallbackBrief(cluster) {
  return {
    summary: `${cluster.article_count} sources covering "${cluster.title}"`,
    brief: cluster.articles.slice(0, 6).map(a => ({
      ts:      new Date(a.published_at).toISOString(),
      text:    a.title,
      sources: [{ name: a.source_name, url: a.url }],
    })),
  };
}

// ─── Main refresh cycle ───────────────────────────────────────────────────

export async function refreshAnalysis() {
  const now   = Date.now();
  const TTL_CLUSTER   = 24 * 60 * 60 * 1000; // 24h
  const TTL_EXPLAINED = 12 * 60 * 60 * 1000; // 12h
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);

  if (!hasGemini) {
    logger.info("📊 Analysis: GEMINI_API_KEY not set — clusters saved with deterministic briefs only");
  }

  logger.info("📊 Analysis refresh starting");

  // 1. Cluster articles heuristically (no LLM cost)
  const clusters = clusterRecentArticles({ windowHours: 24, minArticles: 3 });
  logger.info(`📊 Found ${clusters.length} story clusters`);

  // 2. For each cluster: generate brief + (for top 3) perspectives
  for (let ci = 0; ci < clusters.length; ci++) {
    const cluster = clusters[ci];

    // — Brief —
    let briefData = fallbackBrief(cluster);
    if (hasGemini) {
      const result = await callGemini(buildBriefingPrompt(cluster));
      if (result?.brief) {
        briefData = {
          summary: result.summary || briefData.summary,
          brief: (result.brief || []).map(p => ({
            ts:      p.ts,
            text:    p.text,
            sources: (p.sourceIndices || [])
              .map(i => cluster.articles[i - 1])
              .filter(Boolean)
              .map(a => ({ name: a.source_name, url: a.url })),
          })),
        };
      }
      await sleep(4000); // rate limit: 4s between calls
    }

    // — Perspectives (top 3 clusters only to conserve quota) —
    let perspectives = null;
    if (hasGemini && ci < 3) {
      const perspResult = await callGemini(buildPerspectivesPrompt(cluster));
      if (Array.isArray(perspResult)) perspectives = perspResult;
      await sleep(4000);
    }

    upsertStoryCluster({
      id:            cluster.id,
      title:         cluster.title,
      summary:       briefData.summary,
      category:      cluster.category,
      keywords:      cluster.keywords,
      article_ids:   cluster.articles.map(a => a.id),
      article_count: cluster.article_count,
      brief:         briefData.brief,
      perspectives,
      created_at:    now,
      updated_at:    now,
      expires_at:    now + TTL_CLUSTER,
    });
  }

  // 3. Explained pieces for top 2 categories by article volume
  const categoryCounts = {};
  for (const cl of clusters) {
    categoryCounts[cl.category] = (categoryCounts[cl.category] || 0) + cl.article_count;
  }
  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([cat]) => cat);

  for (const category of topCategories) {
    const catArticles = getDb().prepare(`
      SELECT id, title, description, content, source_name, url, image_url,
             published_at, credibility
      FROM   articles
      WHERE  category = ? AND published_at > ? AND credibility >= 6 AND is_duplicate = 0
      ORDER  BY credibility DESC, published_at DESC
      LIMIT  25
    `).all(category, now - 24 * 60 * 60 * 1000);

    if (catArticles.length < 5) continue;

    if (hasGemini) {
      const topicName = category.charAt(0).toUpperCase() + category.slice(1);
      const result = await callGemini(buildExplainedPrompt(topicName, catArticles));
      await sleep(4000);

      if (!result) continue;

      const slug = `${category}-${new Date().toISOString().slice(0, 10)}`;
      const id   = crypto.createHash("sha256").update(slug).digest("hex").slice(0, 16);

      upsertExplainedPiece({
        id,
        slug,
        title:     result.title || `${topicName} — Analysis`,
        category,
        summary:   result.summary || null,
        content:   result.content || null,
        facts:     result.facts || [],
        timeline:  result.timeline || [],
        sources:   catArticles.slice(0, 8).map(a => ({ name: a.source_name, url: a.url })),
        image_url: catArticles.find(a => a.image_url)?.image_url || null,
        created_at: now,
        updated_at: now,
        expires_at: now + TTL_EXPLAINED,
      });
    }
  }

  logger.info(`📊 Analysis refresh complete — clusters: ${clusters.length}, explained: ${topCategories.length}`);
  return { clusters: clusters.length, explained: topCategories.length };
}

// ─── On-demand Article Deep Dive ──────────────────────────────────────────

export async function getOrCreateDeepDive(articleId) {
  // Return cached result if still fresh (6h TTL)
  const cached = getArticleAnalysisCache(articleId);
  if (cached) return cached;

  const article = getArticleById(articleId);
  if (!article) return null;

  const related = listRelatedStories(article, 4);
  const related_ids = related.map(r => r.id);

  if (!process.env.GEMINI_API_KEY) {
    const result = { article_id: articleId, takeaways: [], tone: "neutral", tone_reason: "AI analysis not configured", related_ids };
    upsertArticleAnalysisCache(result);
    return result;
  }

  const parsed = await callGemini(buildDeepDivePrompt(article));
  const result = {
    article_id:  articleId,
    takeaways:   parsed?.takeaways || [],
    tone:        parsed?.tone || "neutral",
    tone_reason: parsed?.toneReason || null,
    related_ids,
  };
  upsertArticleAnalysisCache(result);
  return result;
}

// ─── Topic Trends (pure SQL, no LLM) ─────────────────────────────────────

/**
 * Returns article counts per category bucketed into 3h windows for the
 * last N hours (default 72). Returns top 8 categories by total volume.
 */
export function getTopicTrends({ windowHours = 72 } = {}) {
  const cutoff    = Date.now() - windowHours * 60 * 60 * 1000;
  const BUCKET_MS = 3 * 60 * 60 * 1000; // 3-hour buckets

  const rows = getDb().prepare(`
    SELECT category,
           (published_at / ?) AS bucket,
           COUNT(*)           AS count
    FROM   articles
    WHERE  published_at > ? AND is_duplicate = 0
    GROUP  BY category, bucket
    ORDER  BY category, bucket
  `).all(BUCKET_MS, cutoff);

  const byCategory = {};
  for (const row of rows) {
    if (!byCategory[row.category]) byCategory[row.category] = [];
    byCategory[row.category].push({
      hour:  new Date(row.bucket * BUCKET_MS).toISOString(),
      count: row.count,
    });
  }

  return Object.entries(byCategory)
    .map(([category, counts]) => ({
      category,
      total: counts.reduce((s, c) => s + c.count, 0),
      counts,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
}
