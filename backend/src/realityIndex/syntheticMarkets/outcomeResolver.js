/**
 * outcomeResolver — LLM verifier that proposes outcomes for synthetic
 * markets near or past their end_date. Drafts only; editor confirms via
 * /scoop-ops/synthetic before any payouts move per plan §6 ("LLM verifier
 * with citation, escalates to manual oracle on low confidence").
 *
 * Per cycle:
 *   1. Pull open markets where end_date < now + GRACE_MS, with no
 *      existing proposed_outcome (or with one older than REPROPOSE_MS).
 *   2. For each, ask the LLM: given the question + description + the
 *      latest event articles + market price, what is the likely outcome?
 *      Output JSON: { outcome: yes|no|cancel, confidence: 0..1, reasoning,
 *                     sources_summary }
 *   3. Validate, then write the proposal into synthetic_markets.meta JSON
 *      under proposed_outcome / proposed_at / proposed_confidence /
 *      proposed_reasoning.
 *   4. NEVER auto-resolves. The /scoop-ops/synthetic admin page surfaces
 *      proposals for editor review.
 *
 * Bounded per cycle. Skips when LLM disabled or no candidates.
 */

import { getDb } from "../../models/database.js";
import { callJson } from "../llmQueue.js";
import { logger } from "../../services/logger.js";

const PER_CYCLE       = parseInt(process.env.OUTCOME_PER_CYCLE     || "3", 10);
const GRACE_MS        = parseInt(process.env.OUTCOME_GRACE_MS      || String(24 * 60 * 60 * 1000), 10);
const REPROPOSE_MS    = parseInt(process.env.OUTCOME_REPROPOSE_MS  || String(48 * 60 * 60 * 1000), 10);
const MIN_ARTICLES    = 3;

function pickCandidates(db, limit) {
  const cutoff = Date.now() + GRACE_MS;
  return db.prepare(`
    SELECT id, question, description, event_id, end_date, yes_price, meta
    FROM synthetic_markets
    WHERE resolved = 0 AND end_date IS NOT NULL AND end_date <= ?
    ORDER BY end_date ASC
    LIMIT ?
  `).all(cutoff, limit * 4);   // over-fetch then filter by recency of existing proposal
}

function shouldPropose(meta, now) {
  if (!meta) return true;
  try {
    const m = JSON.parse(meta);
    if (!m.proposed_at) return true;
    if (now - Number(m.proposed_at) > REPROPOSE_MS) return true;
    return false;
  } catch { return true; }
}

function fetchEventEvidence(db, eventId, marketEndDate) {
  if (!eventId) return { articles: [], summary: "" };
  const articles = db.prepare(`
    SELECT a.id, a.title, a.published_at, a.source_name, a.url, a.description
    FROM event_articles ea
    JOIN articles a ON a.id = ea.article_id
    WHERE ea.event_id = ?
    ORDER BY a.published_at DESC
    LIMIT 12
  `).all(eventId);
  return { articles };
}

function buildPrompt(market, evidence) {
  const ends = market.end_date ? new Date(market.end_date).toISOString().slice(0, 10) : "TBD";
  const articleLines = evidence.articles.map(a =>
    `- "${(a.title || "").slice(0, 160)}" (${a.source_name}, ${new Date(a.published_at).toISOString().slice(0, 10)})`
  ).join("\n").slice(0, 3000);

  return `You are an editorial fact-checker resolving a binary prediction market.

MARKET
Question: ${market.question}
${market.description ? `Resolution criterion: ${market.description}` : ""}
Deadline: ${ends}
Current market YES price: ${market.yes_price?.toFixed?.(2) ?? "—"}

EVIDENCE (most recent articles linked to the bound event)
${articleLines || "(no linked articles)"}

TASK
Given ONLY the evidence above, has the question been answered as of today?
Be conservative: prefer "cancel" over a forced answer when evidence is
ambiguous, and emit confidence < 0.5 to escalate to the human editor.

OUTPUT — STRICT JSON, no other text:
{
  "outcome": "yes" | "no" | "cancel",
  "confidence": 0.0..1.0,
  "reasoning": "1-2 sentence rationale citing the source(s) you relied on",
  "sources_summary": "comma-separated outlet names you weighted most"
}

Rules:
- "cancel" means the question is malformed or unverifiable from the evidence.
- Don't invent sources. If no evidence supports a definitive answer, return
  outcome=cancel with low confidence.
- Confidence reflects YOUR certainty given the evidence, not the market price.`;
}

function validate(parsed) {
  if (!parsed) return null;
  const outcome = String(parsed.outcome || "").toLowerCase();
  if (!["yes", "no", "cancel"].includes(outcome)) return null;
  let confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence)) return null;
  confidence = Math.max(0, Math.min(1, confidence));
  return {
    outcome,
    confidence,
    reasoning: String(parsed.reasoning || "").slice(0, 600),
    sources_summary: String(parsed.sources_summary || "").slice(0, 240),
  };
}

export async function runOutcomeResolverCycle({ limit = PER_CYCLE } = {}) {
  const db = getDb();
  const now = Date.now();
  const candidates = pickCandidates(db, limit);
  if (!candidates.length) return { proposed: 0, attempted: 0 };

  const filtered = candidates.filter(c => shouldPropose(c.meta, now)).slice(0, limit);
  if (!filtered.length) return { proposed: 0, attempted: 0, allFresh: true };

  let proposed = 0, skipped = 0;
  for (const m of filtered) {
    try {
      const evidence = fetchEventEvidence(db, m.event_id, m.end_date);
      if (m.event_id && evidence.articles.length < MIN_ARTICLES) {
        // Without enough evidence we'd just be guessing — defer to a later
        // cycle when more articles have accumulated.
        skipped++;
        continue;
      }
      const parsed = await callJson(buildPrompt(m, evidence), { tier: "premium", maxOutputTokens: 500, task: "outcome-resolve" });
      const v = validate(parsed);
      if (!v) { skipped++; continue; }

      let meta = {};
      try { meta = JSON.parse(m.meta || "{}"); } catch { /* ignore */ }
      meta.proposed_outcome    = v.outcome;
      meta.proposed_confidence = v.confidence;
      meta.proposed_reasoning  = v.reasoning;
      meta.proposed_sources    = v.sources_summary;
      meta.proposed_at         = now;
      meta.proposer            = "llm";

      db.prepare("UPDATE synthetic_markets SET meta = ? WHERE id = ?")
        .run(JSON.stringify(meta), m.id);
      proposed++;
      logger.info(`🔍 outcome proposed: ${m.id.slice(0,8)} → ${v.outcome} (confidence ${v.confidence.toFixed(2)})`);
    } catch (err) {
      logger.warn(`outcomeResolver ${m.id}: ${err.message}`);
      skipped++;
    }
  }

  return { proposed, skipped, attempted: filtered.length };
}
