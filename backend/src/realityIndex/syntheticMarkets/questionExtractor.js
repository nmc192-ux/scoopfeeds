/**
 * questionExtractor — LLM-driven generator for synthetic-market questions.
 *
 * Per plan §6, picks high-Reality-Index events that don't yet have any
 * Polymarket binding and asks the LLM to draft a binary, time-bounded
 * question that captures a forward-looking outcome of the event. Each
 * draft becomes a new synthetic market with generated_by='llm', status
 * implicit (always tradeable on creation; editor can resolve or expire).
 *
 * Hard rules:
 *   - Only events with confidence >= MIN_CONF and severity >= MIN_SEV.
 *   - Skip events that already have ANY market binding (event_market_links)
 *     or any synthetic market (event_id match).
 *   - Generated question MUST be binary, time-bounded, with a clear
 *     resolution criterion. Output validated against shape.
 *   - end_date defaults to 2 weeks out unless the LLM proposes a date.
 *
 * Bounded per cycle. Skips when LLM is disabled.
 */

import { getDb } from "../../models/database.js";
import { topTruthGap } from "../dal/realityIndexDao.js";
import { createMarket } from "../dal/syntheticMarketsDao.js";
import { callJson } from "../llmQueue.js";
import { logger } from "../../services/logger.js";

const PER_CYCLE   = parseInt(process.env.SYNTH_PER_CYCLE   || "2", 10);
const MIN_CONF    = parseFloat(process.env.SYNTH_MIN_CONF  || "0.4");
const MIN_SEV     = parseFloat(process.env.SYNTH_MIN_SEV   || "0.4");
const DEFAULT_HORIZON_DAYS = parseInt(process.env.SYNTH_HORIZON_DAYS || "14", 10);

function pickCandidates(db, limit) {
  const all = topTruthGap({ windowMs: 7 * 24 * 60 * 60 * 1000, limit: 50, direction: "both", scope: "event" });
  if (!all.length) return [];

  const ids = all.map(r => r.scope_id);
  const placeholders = ids.map(() => "?").join(",");
  const meta = new Map(
    db.prepare(`
      SELECT e.id, e.slug, e.title, e.category, e.severity, e.last_activity_at,
        (SELECT COUNT(*) FROM event_market_links eml WHERE eml.event_id = e.id) AS market_count,
        (SELECT COUNT(*) FROM synthetic_markets sm  WHERE sm.event_id = e.id)  AS synth_count
      FROM events e
      WHERE e.id IN (${placeholders}) AND e.status = 'active'
    `).all(...ids).map(e => [e.id, e])
  );

  return all
    .map(r => {
      const m = meta.get(r.scope_id);
      if (!m) return null;
      if ((m.severity ?? 0) < MIN_SEV) return null;
      if ((r.confidence ?? 0) < MIN_CONF) return null;
      if (m.market_count > 0 || m.synth_count > 0) return null;
      return { ...r, ...m, event_id: r.scope_id };
    })
    .filter(Boolean)
    .slice(0, limit);
}

function buildPrompt(ev) {
  const horizonDate = new Date(Date.now() + DEFAULT_HORIZON_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  return `You are an editor designing a binary prediction-market question for a tracked news event.

EVENT
Title: ${ev.title}
Category: ${ev.category}
Severity: ${(ev.severity * 100).toFixed(0)}%
Reality Index composite: ${(ev.reality_score * 100).toFixed(0)}% (truth_gap ${ev.truth_gap?.toFixed(2)})

TASK
Write ONE binary, time-bounded, falsifiable question. Resolution criterion
must be objective enough that anyone reading it could verify the answer
from public sources by ${horizonDate} (or your proposed earlier date).

Rules:
- Question must be answerable YES or NO.
- Must reference a specific verifiable event (named entity, date, threshold).
- No questions about feelings, vibes, or subjective takes.
- No questions about events that have already resolved.
- Default deadline ${horizonDate} unless a different date is more natural.

OUTPUT — STRICT JSON, no other text:
{
  "question": "Will X happen by Y date?",
  "description": "1-2 sentence resolution criterion. Source(s) used to resolve.",
  "end_date": "YYYY-MM-DD"
}

If no good question fits this event, return {"question":""}.`;
}

function validate(parsed) {
  if (!parsed?.question || typeof parsed.question !== "string") return null;
  const q = parsed.question.trim();
  if (q.length < 15 || q.length > 240) return null;
  if (!/[?]\s*$/.test(q))               return null;       // must end in ?
  if (!/\b(will|by|reach|exceed|cross|hit|sign|resign|win|lose|ratify|pass|reject|approve)\b/i.test(q)) return null;
  const desc = String(parsed.description || "").trim().slice(0, 500);
  let end_ms = null;
  if (parsed.end_date) {
    const t = Date.parse(parsed.end_date);
    if (Number.isFinite(t) && t > Date.now()) end_ms = t;
  }
  if (end_ms == null) end_ms = Date.now() + DEFAULT_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  return { question: q, description: desc || null, end_date: end_ms };
}

export async function runQuestionExtractor({ limit = PER_CYCLE } = {}) {
  const db = getDb();
  const candidates = pickCandidates(db, limit);
  if (!candidates.length) return { drafted: 0, attempted: 0 };

  let drafted = 0, skipped = 0;
  for (const ev of candidates) {
    try {
      const parsed = await callJson(buildPrompt(ev), { tier: "premium", maxOutputTokens: 400 });
      const v = validate(parsed);
      if (!v) { skipped++; continue; }
      createMarket({
        question:    v.question,
        description: v.description,
        cluster_id:  ev.cluster_id || null,
        event_id:    ev.event_id,
        generated_by: "llm",
        end_date:    v.end_date,
        initial_liquidity: 100,
        meta: { source_event_slug: ev.slug, ri_at_creation: ev.reality_score, truth_gap_at_creation: ev.truth_gap },
      });
      drafted++;
      logger.info(`🎲 synth market drafted: "${v.question}" (event ${ev.slug.slice(0, 30)})`);
    } catch (err) {
      logger.warn(`questionExtractor ${ev.event_id}: ${err.message}`);
      skipped++;
    }
  }
  return { drafted, skipped, attempted: candidates.length };
}
