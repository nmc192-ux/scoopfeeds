/**
 * whatWeKnow — the dossier's "What we know" block (#250).
 *
 * 3 to 5 plain sentences of what the coverage agrees on, each tied to the
 * articles it came from, written by Claude and served with a visible
 * disclosure line. full-throttle.md §5 lifts the mechanical-only header rule
 * for THIS block only; the header itself stays mechanical.
 *
 * Off unless WHAT_WE_KNOW_ENABLED is literally "1" (read at call time).
 *
 * Who gets one (every "no" emits one 🧭 wwk-skip line with its reason):
 *   - active, has articles (machine-event gotcha), passes reader eligibility;
 *   - dossierCoherence(...).level === "ok". "low" or null (unmeasured) → never;
 *   - the title is not sensitive (isSensitiveHeadline / isExplicitHarmHeadline);
 *   - the bundle reaches at least MIN_OUTLETS distinct named outlets.
 *
 * Cost rails, copied from eventActorExtractor (the 2026-07-15 incident):
 *   - content hash of the article ids sent; an unchanged hash is never re-paid
 *     once it produced a good block;
 *   - at most MAX_ATTEMPTS calls per hash, spaced 0 / 6 h / 24 h;
 *   - a changed hash regenerates only when the last good block is older than 6 h;
 *   - at most WHAT_WE_KNOW_PER_CYCLE LLM calls per cycle (default 10), and the
 *     daily cap in llmQueue (task "what-we-know") still applies on top.
 *
 * Validation fails CLOSED: a fact citing an id outside the bundle, citing
 * fewer than two outlets, or carrying a number not found verbatim in a cited
 * input is dropped. Fewer than MIN_FACTS survivors → status 'refused', and
 * nothing is rendered.
 *
 * The row in event_what_we_know reflects the LATEST attempt. A refused or
 * failed attempt on new content therefore withdraws an older good block
 * rather than serving one the current coverage was not checked against.
 */

import crypto from "crypto";
import { getDb } from "../../models/database.js";
import { callJson } from "../llmQueue.js";
import { logger } from "../../services/logger.js";
import { dossierCoherence } from "../intelligence/eventCoherence.js";
import { eventReaderEligibility, sourceEligibleSql } from "../dal/readerEligibility.js";
import { isSensitiveHeadline, isExplicitHarmHeadline } from "../../services/editorialSensitivity.js";

export const TASK = "what-we-know";
export const DISCLOSURE = "Written by AI from the reports listed below. It can be wrong; check the sources.";
export const MIN_FACTS = 3;
export const MAX_FACTS = 5;
export const MAX_UNKNOWN = 2;
export const MAX_WORDS = 30;
export const MIN_OUTLETS = 3;
export const MAX_ARTICLES = 12;
export const MAX_ATTEMPTS = 3;
export const ATTEMPT_SPACING_MS = [0, 6 * 3600e3, 24 * 3600e3]; // before attempt 1, 2, 3
export const REFRESH_AFTER_MS = 6 * 3600e3;
const DEFAULT_PER_CYCLE = 10;

/** Read at call time, so a flip needs no restart of the test process. */
export function whatWeKnowEnabled() {
  return process.env.WHAT_WE_KNOW_ENABLED === "1";
}
export function whatWeKnowPerCycle() {
  const n = Number.parseInt(process.env.WHAT_WE_KNOW_PER_CYCLE ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_PER_CYCLE;
}
/** API kill switch: default on, but nothing is served unless rows exist. */
export function whatWeKnowApiOn() {
  const v = String(process.env.WHAT_WE_KNOW_API ?? "true").trim().toLowerCase();
  return !(v === "false" || v === "0" || v === "off");
}

const NAMED = "a.source_name IS NOT NULL AND a.source_name <> ''";

/**
 * The bundle: up to MAX_ARTICLES member articles, newest first, taken round-
 * robin across outlets so one prolific outlet cannot fill it. Numbered 1..n.
 */
export function buildBundle(db, eventId) {
  const rows = db.prepare(`
    SELECT a.id, a.title, a.description, a.url, a.source_name
    FROM event_articles ea JOIN articles a ON a.id = ea.article_id
    WHERE ea.event_id = ? AND ${NAMED}
    ORDER BY COALESCE(a.published_at, ea.added_at) DESC, a.id
  `).all(eventId);
  const byOutlet = new Map();
  for (const r of rows) {
    if (!byOutlet.has(r.source_name)) byOutlet.set(r.source_name, []);
    byOutlet.get(r.source_name).push(r);
  }
  const queues = [...byOutlet.values()];
  const picked = [];
  for (let round = 0; picked.length < MAX_ARTICLES; round++) {
    let any = false;
    for (const q of queues) {
      if (round < q.length) { any = true; picked.push(q[round]); if (picked.length >= MAX_ARTICLES) break; }
    }
    if (!any) break;
  }
  return picked.map((r, i) => ({ n: i + 1, ...r }));
}

export function contentHash(bundle) {
  return crypto.createHash("sha256").update(bundle.map((a) => a.id).join("|")).digest("hex");
}

export function buildPrompt(event, bundle) {
  const items = bundle.map((a) => `[${a.n}] (${a.source_name}) ${a.title}\n${a.description ?? ""}`.trim()).join("\n\n");
  return `You summarise what news coverage AGREES on about one story.

Story: "${event.title}"

Reports (numbered):
${items}

Return JSON only: {"facts":[{"text":string,"sources":[number,...]}],"unknown":[string]}
Rules:
- 3 to 5 facts. Each is one plain sentence of at most ${MAX_WORDS} words.
- Each fact cites at least 2 report numbers, from at least 2 DIFFERENT outlets, that both support it.
- Only what the reports state. No opinion, no prediction, no background knowledge.
- Do not use any number, date or figure that does not appear in a report you cite.
- "unknown" is optional: at most ${MAX_UNKNOWN} short items the reports say are not yet confirmed.`;
}

const NUM_RE = /\d+(?:[.,]\d+)*/g;
export function numbersIn(text) {
  return (String(text).match(NUM_RE) || []).map((n) => n.replace(/[.,]+$/, ""));
}
export function hasNumberVerbatim(haystack, num) {
  const esc = num.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\d.,])${esc}(?![\\d]|[.,]\\d)`).test(haystack);
}
const wordCount = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

/**
 * Validate a model response against the bundle. Fails closed.
 * → { facts:[{text, sources:[n]}], unknown:[text], dropped:[{text, why}] }
 */
export function validate(parsed, bundle) {
  const byN = new Map(bundle.map((a) => [a.n, a]));
  const facts = [];
  const dropped = [];
  for (const f of Array.isArray(parsed?.facts) ? parsed.facts : []) {
    const text = typeof f?.text === "string" ? f.text.trim() : "";
    if (!text) { dropped.push({ text, why: "empty" }); continue; }
    if (wordCount(text) > MAX_WORDS) { dropped.push({ text, why: "too long" }); continue; }
    const srcs = [...new Set((Array.isArray(f?.sources) ? f.sources : []).map(Number))];
    if (srcs.some((n) => !byN.has(n))) { dropped.push({ text, why: "cites an id outside the bundle" }); continue; }
    const outlets = new Set(srcs.map((n) => byN.get(n).source_name));
    if (outlets.size < 2) { dropped.push({ text, why: "fewer than 2 outlets" }); continue; }
    const cited = srcs.map((n) => `${byN.get(n).title ?? ""}\n${byN.get(n).description ?? ""}`).join("\n");
    const bad = numbersIn(text).find((num) => !hasNumberVerbatim(cited, num));
    if (bad) { dropped.push({ text, why: `number ${bad} not in a cited report` }); continue; }
    facts.push({ text, sources: srcs });
    if (facts.length >= MAX_FACTS) break;
  }
  const unknown = (Array.isArray(parsed?.unknown) ? parsed.unknown : [])
    .filter((u) => typeof u === "string" && u.trim() && wordCount(u) <= MAX_WORDS)
    .map((u) => u.trim())
    .filter((u) => !numbersIn(u).some((num) => !bundle.some((a) => hasNumberVerbatim(`${a.title ?? ""}\n${a.description ?? ""}`, num))))
    .slice(0, MAX_UNKNOWN);
  return { facts, unknown, dropped };
}

/** Ledger decision. → { proceed, reason?, reset? } */
export function ledgerDecision(row, hash, now) {
  if (!row) return { proceed: true, reset: true };
  if (row.content_hash !== hash) {
    if (row.status === "ok" && row.generated_at && now - row.generated_at < REFRESH_AFTER_MS) {
      return { proceed: false, reason: "fresh" };
    }
    return { proceed: true, reset: true };
  }
  if (row.status === "ok") return { proceed: false, reason: "unchanged" };
  if (row.attempts >= MAX_ATTEMPTS) return { proceed: false, reason: "unchanged (attempts exhausted)" };
  const wait = ATTEMPT_SPACING_MS[Math.min(row.attempts, ATTEMPT_SPACING_MS.length - 1)];
  if (now - (row.last_attempt_at ?? 0) < wait) return { proceed: false, reason: "unchanged (retry not due)" };
  return { proceed: true };
}

function record(db, eventId, { hash, now, status, body = null, model = null, reason = null, reset }) {
  db.prepare(`
    INSERT INTO event_what_we_know (event_id, content_hash, body_json, model, generated_at, attempts, last_attempt_at, status, refusal_reason)
    VALUES (@id, @hash, @body, @model, @gen, 1, @now, @status, @reason)
    ON CONFLICT(event_id) DO UPDATE SET
      attempts        = CASE WHEN @reset = 1 THEN 1 ELSE event_what_we_know.attempts + 1 END,
      content_hash    = excluded.content_hash,
      body_json       = excluded.body_json,
      model           = excluded.model,
      generated_at    = excluded.generated_at,
      last_attempt_at = excluded.last_attempt_at,
      status          = excluded.status,
      refusal_reason  = excluded.refusal_reason
  `).run({ id: eventId, hash, body, model, gen: status === "ok" ? now : null, now, status, reason, reset: reset ? 1 : 0 });
}

const compass = (kind, fields) => logger.info(`🧭 ${kind} ${JSON.stringify(fields)}`);

/**
 * One event. → { called: boolean, status?: string, skip?: string }
 * Exported for tests; the cycle below is the only production caller.
 */
export async function generateForEvent(db, event, { now = Date.now(), llm = callJson, coherenceOf = dossierCoherence } = {}) {
  const skip = (reason) => { compass("wwk-skip", { event: event.id, reason }); return { called: false, skip: reason }; };

  if (isSensitiveHeadline(event.title) || isExplicitHarmHeadline(event.title)) return skip("sensitive");

  // Order matters only for which reason the 🧭 line names: coherence and
  // outlet count first (the reasons the spec names), then the remaining
  // reader-eligibility rule (one outlet dominating).
  let coh;
  try { coh = coherenceOf(db, event.id, { now }); } catch { coh = null; }
  if (!coh || coh.level === null || coh.level === undefined) return skip("coherence unmeasured");
  if (coh.level !== "ok") return skip("coherence low");

  const bundle = buildBundle(db, event.id);
  if (new Set(bundle.map((a) => a.source_name)).size < MIN_OUTLETS) return skip("few outlets");

  const elig = eventReaderEligibility(db, event.id, { now });
  if (!elig.eligible) return skip(`not reader-eligible (${elig.reasons.join(",")})`);

  const hash = contentHash(bundle);
  const row = db.prepare("SELECT * FROM event_what_we_know WHERE event_id = ?").get(event.id);
  const gate = ledgerDecision(row, hash, now);
  if (!gate.proceed) return skip(gate.reason);

  let res;
  try {
    res = await llm(buildPrompt(event, bundle), { task: TASK, maxOutputTokens: 600, withMeta: true });
  } catch (err) {
    res = { ok: false, errClass: err?.message ?? "error" };
  }
  // callJson resolves to null when the LLM is unavailable (no key, breaker
  // open, daily cap spent): nothing was paid, so nothing is ledgered.
  if (res == null) return skip("llm unavailable");
  if (!res.ok) {
    record(db, event.id, { hash, now, status: "failed", reason: String(res.errClass ?? "llm error").slice(0, 200), reset: gate.reset });
    compass("wwk-refuse", { event: event.id, reason: "llm failed" });
    return { called: true, status: "failed" };
  }

  const v = validate(res.value, bundle);
  if (v.facts.length < MIN_FACTS) {
    const reason = `only ${v.facts.length} fact(s) survived validation` + (v.dropped.length ? `: ${v.dropped.map((d) => d.why).join("; ")}` : "");
    record(db, event.id, { hash, now, status: "refused", reason: reason.slice(0, 500), reset: gate.reset });
    compass("wwk-refuse", { event: event.id, reason, dropped: v.dropped.length });
    return { called: true, status: "refused" };
  }

  const byN = new Map(bundle.map((a) => [a.n, a]));
  const body = {
    facts: v.facts.map((f) => ({ text: f.text, sources: f.sources.map((n) => ({ article_id: byN.get(n).id, source_name: byN.get(n).source_name, url: byN.get(n).url })) })),
    unknown: v.unknown,
  };
  record(db, event.id, { hash, now, status: "ok", body: JSON.stringify(body), model: res.model ?? null, reset: gate.reset });
  compass("wwk-generate", { event: event.id, facts: body.facts.length, unknown: body.unknown.length, dropped: v.dropped.length, articles: bundle.length });
  return { called: true, status: "ok" };
}

/** Hourly cycle. Off unless WHAT_WE_KNOW_ENABLED=1. */
export async function runWhatWeKnow({ db = getDb(), now = Date.now(), llm = callJson, coherenceOf = dossierCoherence } = {}) {
  if (!whatWeKnowEnabled()) return { enabled: false };
  const perCycle = whatWeKnowPerCycle();
  if (perCycle === 0) return { enabled: true, candidates: 0, llm_calls: 0 };

  // The ledger is consulted IN the selection (the actor extractor's lesson):
  // settled events must not occupy candidate slots by recency forever. An
  // event re-qualifies when it has new activity since its last attempt, or a
  // capped retry is due. The in-loop content hash stays the precise guard.
  const events = db.prepare(`
    SELECT e.id, e.title
    FROM events e
    LEFT JOIN event_what_we_know w ON w.event_id = e.id
    WHERE e.status = 'active'
      AND EXISTS (SELECT 1 FROM event_articles ea WHERE ea.event_id = e.id)
      AND ${sourceEligibleSql("e")}
      AND (
        w.event_id IS NULL
        OR e.last_activity_at > w.last_attempt_at
        OR (w.status <> 'ok' AND w.attempts < ?
            AND w.last_attempt_at <= ? - (CASE WHEN w.attempts <= 1 THEN ${ATTEMPT_SPACING_MS[1]} ELSE ${ATTEMPT_SPACING_MS[2]} END))
      )
    ORDER BY e.last_activity_at DESC
    LIMIT ?
  `).all(MAX_ATTEMPTS, now, perCycle * 10);

  let calls = 0, ok = 0, refused = 0, skipped = 0;
  for (const event of events) {
    if (calls >= perCycle) break;
    try {
      const r = await generateForEvent(db, event, { now, llm, coherenceOf });
      if (r.called) { calls++; if (r.status === "ok") ok++; else refused++; } else skipped++;
    } catch (err) {
      logger.warn(`whatWeKnow: event ${event.id} error — ${err.message}`);
    }
    // Yield between events: the coherence read is synchronous, and this cycle
    // runs in the scheduler process next to dispatch crons (scheduler.cronCollision.test.js).
    await new Promise((r) => setImmediate(r));
  }
  const stats = { enabled: true, candidates: events.length, llm_calls: calls, ok, refused, skipped };
  logger.info(`📝 whatWeKnow done — ${JSON.stringify(stats)}`);
  return stats;
}

/**
 * The API field. Served only when a row is 'ok' AND the event's live
 * coherence level is "ok" now. Anything else → undefined (no field).
 */
export function whatWeKnowForApi(db, eventId, coherence) {
  if (!whatWeKnowApiOn()) return undefined;
  if (!coherence || coherence.level !== "ok") return undefined;
  const row = db.prepare("SELECT body_json, model, generated_at, status FROM event_what_we_know WHERE event_id = ?").get(eventId);
  if (!row || row.status !== "ok" || !row.body_json) return undefined;
  let body;
  try { body = JSON.parse(row.body_json); } catch { return undefined; }
  if (!Array.isArray(body?.facts) || body.facts.length < MIN_FACTS) return undefined;
  return { facts: body.facts, unknown: Array.isArray(body.unknown) ? body.unknown : [], generated_at: row.generated_at, model: row.model, disclosure: DISCLOSURE };
}
