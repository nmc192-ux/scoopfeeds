/**
 * analystBriefGenerator — drafts evidence-grounded analyst briefs for the
 * highest-truth-gap active events. Per plan §5J, ALL briefs land as
 * status='draft' — there is no auto-publish path in v1.
 *
 * Per cycle:
 *   1. Pick top events by |truth_gap| × confidence in the last 24h.
 *   2. Skip if the event already has a draft in the last 24h.
 *   3. Build a context bundle: event hero, top markets w/ live prices,
 *      latest sentiment per source, top 5 articles by recency.
 *   4. Call the premium LLM (Groq Llama 3.3 70B Versatile by default,
 *      via llmQueue.callJson tier='premium').
 *   5. Validate: every claim in evidence[] must reference an id present
 *      in the bundle. Drop any unsupported claims; fail the whole brief
 *      if fewer than 2 grounded claims survive.
 *   6. Persist as draft. Editor reviews in /scoop-ops/briefs.
 *
 * Cron-bounded: BRIEFS_PER_CYCLE per run (default 2). Skips when LLM is
 * disabled or the queue is saturated.
 */

import crypto from "crypto";
import { getDb } from "../../models/database.js";
import { topTruthGap } from "../dal/realityIndexDao.js";
import { latestSnapshotsByScope } from "../dal/sentimentDao.js";
import { insertBrief, alreadyHasRecentDraft } from "../dal/briefsDao.js";
import { callJson, getQueueStatus } from "../llmQueue.js";
import { logger } from "../../services/logger.js";

const BRIEFS_PER_CYCLE = parseInt(process.env.BRIEFS_PER_CYCLE || "2", 10);
const MIN_CONFIDENCE   = parseFloat(process.env.BRIEFS_MIN_CONF || "0.4");
const MIN_TRUTH_GAP    = parseFloat(process.env.BRIEFS_MIN_GAP  || "0.25");

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 70)
    .replace(/^-+|-+$/g, "") || crypto.randomUUID().slice(0, 8);
}

function pickCandidateEvents(db, limit) {
  // topTruthGap returns RI snapshots; hydrate event metadata + filter.
  const all = topTruthGap({ windowMs: 24 * 60 * 60 * 1000, limit: 25, direction: "both", scope: "event" });
  const filtered = all.filter(r =>
    Math.abs(r.truth_gap ?? 0) >= MIN_TRUTH_GAP &&
    (r.confidence ?? 0) >= MIN_CONFIDENCE
  );
  if (!filtered.length) return [];

  const ids  = filtered.map(r => r.scope_id);
  const meta = new Map(
    db.prepare(`
      SELECT id, slug, title, category, severity, status, last_activity_at
      FROM events WHERE id IN (${ids.map(() => "?").join(",")}) AND status='active'
    `).all(...ids).map(e => [e.id, e])
  );
  return filtered
    .map(r => meta.has(r.scope_id) ? { ...r, ...meta.get(r.scope_id), event_id: r.scope_id } : null)
    .filter(Boolean)
    .filter(e => !alreadyHasRecentDraft(e.event_id))
    .slice(0, limit);
}

function buildContext(db, ev) {
  const markets = db.prepare(`
    SELECT pm.id, pm.question, pm.yes_price, pm.no_price, pm.volume_24h, pm.source, eml.weight, eml.rank
    FROM event_market_links eml
    JOIN prediction_markets pm ON pm.id = eml.market_id
    WHERE eml.event_id = ? AND pm.active=1 ORDER BY eml.rank LIMIT 3
  `).all(ev.event_id);

  const articles = db.prepare(`
    SELECT a.id, a.title, a.url, a.source_name, a.published_at, a.description
    FROM event_articles ea
    JOIN articles a ON a.id = ea.article_id
    WHERE ea.event_id = ?
    ORDER BY a.published_at DESC LIMIT 5
  `).all(ev.event_id);

  const sentiment = latestSnapshotsByScope("event", ev.event_id);

  // Allowed-id set the LLM can cite. Anything outside this set is rejected.
  const allowedIds = new Set([
    ...markets.map(m => `market:${m.id}`),
    ...articles.map(a => `article:${a.id}`),
    ...sentiment.map(s => `sentiment:${s.source}@${s.ts}`),
  ]);

  return { ev, markets, articles, sentiment, allowedIds };
}

function buildPrompt(ctx) {
  const { ev, markets, articles, sentiment } = ctx;
  const mLines = markets.map(m =>
    `[market:${m.id}] "${m.question}" — YES ${(m.yes_price * 100).toFixed(0)}% (vol $${Math.round(m.volume_24h || 0).toLocaleString()})`
  ).join("\n");
  const aLines = articles.map(a =>
    `[article:${a.id}] ${a.source_name}: "${a.title}"`
  ).join("\n");
  const sLines = sentiment.map(s =>
    `[sentiment:${s.source}@${s.ts}] polarity=${(s.polarity ?? 0).toFixed(2)} intensity=${(s.intensity ?? 0).toFixed(2)} volume=${s.volume}`
  ).join("\n");

  return `You are an analyst at Scoopfeeds writing a short, evidence-grounded brief.

EVENT
Title: ${ev.title}
Category: ${ev.category}
Reality Index composite: ${(ev.reality_score * 100).toFixed(0)}% (truth_gap ${ev.truth_gap.toFixed(2)}, confidence ${(ev.confidence * 100).toFixed(0)}%)
The truth_gap measures the divergence between market-implied probability and media tone.
Positive = markets are more confident than media; negative = media is more alarmed than markets.

EVIDENCE (you may cite ONLY these ids — no external facts, no hallucinated quotes)
Markets:
${mLines || "(none)"}

Articles (use for narrative context; the body content is the headline only):
${aLines || "(none)"}

Sentiment snapshots:
${sLines || "(none)"}

TASK
Write a brief that explains WHY the divergence exists and what a reader should watch next. Each claim must cite a single id from above (in brackets, e.g. [market:abc] or [article:xyz]). If a claim cannot be supported by an id above, OMIT it.

OUTPUT — STRICT JSON, no other text:
{
  "title": "Punchy 60-char headline",
  "thesis": "One-sentence thesis under 160 chars.",
  "body_md": "3-5 short paragraphs in Markdown. Inline citations in [bracket:id] format.",
  "evidence": [
    {"kind": "market"|"article"|"sentiment", "ref_id": "<id from above>", "claim": "what this evidence supports"}
  ]
}

Rules:
- evidence[].ref_id MUST exactly match one of the bracketed ids above.
- Write at most 5 evidence entries.
- If you cannot find at least 2 grounded claims, return {"title":"","thesis":"","body_md":"","evidence":[]}.
- No emoji. No phrases like "in conclusion". Plain factual tone.`;
}

function validateBrief(parsed, allowedIds) {
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "not an object" };
  if (!parsed.title || !parsed.thesis || !parsed.body_md) return { ok: false, reason: "missing required fields" };
  const evidence = Array.isArray(parsed.evidence) ? parsed.evidence : [];
  const validEvidence = evidence.filter(e => {
    if (!e?.ref_id || !e?.kind || !e?.claim) return false;
    return allowedIds.has(`${e.kind}:${e.ref_id.split("@")[0]}`) || allowedIds.has(`${e.kind}:${e.ref_id}`);
  });
  if (validEvidence.length < 2) return { ok: false, reason: `only ${validEvidence.length} grounded claims (need ≥2)` };
  return { ok: true, evidence: validEvidence };
}

async function generateForEvent(ctx) {
  const prompt = buildPrompt(ctx);
  const parsed = await callJson(prompt, { tier: "premium", maxOutputTokens: 1200, task: "analyst-brief" });
  const v = validateBrief(parsed, ctx.allowedIds);
  if (!v.ok) {
    logger.info(`📝 brief skipped (${ctx.ev.event_id.slice(0, 8)}): ${v.reason}`);
    return null;
  }
  const status = getQueueStatus();
  return {
    slug:           slugify(parsed.title) + "-" + ctx.ev.event_id.slice(0, 6),
    event_id:       ctx.ev.event_id,
    title:          String(parsed.title).slice(0, 200),
    thesis:         String(parsed.thesis).slice(0, 280),
    body_md:        String(parsed.body_md).slice(0, 4000),
    evidence_json:  v.evidence,
    confidence:     ctx.ev.confidence,
    ri_snapshot_ts: ctx.ev.ts,
    provider:       status.premiumProvider,
    model:          status.premiumModel,
  };
}

export async function runAnalystBriefCycle({ limit = BRIEFS_PER_CYCLE } = {}) {
  const db = getDb();
  const candidates = pickCandidateEvents(db, limit);
  if (!candidates.length) return { drafted: 0, attempted: 0 };

  let drafted = 0;
  for (const ev of candidates) {
    try {
      const ctx = buildContext(db, ev);
      const brief = await generateForEvent(ctx);
      if (!brief) continue;
      insertBrief(brief);
      drafted++;
      logger.info(`📝 brief drafted: "${brief.title}" → /scoop-ops/briefs (status=draft)`);
    } catch (err) {
      logger.warn(`brief generation failed for ${ev.event_id}: ${err.message}`);
    }
  }
  return { drafted, attempted: candidates.length };
}
