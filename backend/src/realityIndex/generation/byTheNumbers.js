/**
 * byTheNumbers — "By the numbers", one checked number a day on Originals (#272).
 *
 * MECHANICAL, NO AI CALL. The number is picked from facts that already passed
 * the "What we know" checks (#250): every WWK fact cites ≥ 2 outlets and every
 * number in it was found word-for-word in a cited report. This picker re-checks
 * that against the articles as they are now, and writes one row per UTC day.
 *
 * Off unless BY_THE_NUMBERS_ENABLED is literally "1" (read at call time). It has
 * nothing to pick from until WHAT_WE_KNOW_ENABLED produces rows; that is correct.
 *
 * Candidates: event_what_we_know rows with status 'ok' generated in the last
 * CANDIDATE_WINDOW_MS, whose event still has articles (machine-event gotcha),
 * passes eventReaderEligibility and has a non-sensitive title. Per fact:
 *   - the first number in the fact that is not a bare year (1900-2100), a date,
 *     a time, an ordinal ("1st") or a percentage under 1. Builder's reading of
 *     the spec: a fact whose numbers are ALL of those kinds is skipped; a fact
 *     like "In 2025, 1,200 staff…" yields 1,200.
 *   - the fact is skipped when it is sensitive or mentions casualties
 *     (CASUALTY_RE): no casualty counts, ever.
 *   - the number must appear verbatim in the CURRENT title/description of the
 *     fact's cited articles from at least two distinct outlets. A deleted article
 *     does not count. Unmeasured = skip.
 * Ranked by the event's distinct outlets in the last 24 h, then generated_at
 * desc. The event of either of the two previous days is not picked again.
 *
 * Written once per day, never rewritten. No candidate → nothing written.
 * One 🧭 line per run: btn-pick / btn-none / btn-skip.
 */

import { getDb } from "../../models/database.js";
import { logger } from "../../services/logger.js";
import { eventReaderEligibility } from "../dal/readerEligibility.js";
import { isSensitiveHeadline, isExplicitHarmHeadline } from "../../services/editorialSensitivity.js";
import { hasNumberVerbatim } from "./whatWeKnow.js";

export const CANDIDATE_WINDOW_MS = 36 * 3600e3;
export const RANK_WINDOW_MS = 24 * 3600e3;
export const NO_REPEAT_DAYS = 2;
export const CASUALTY_RE = /\b(killed|dead|deaths?|died|injured|wounded|casualt\w*|victims?|hostages?)\b/i;
export const DISCLOSURE = "Each number appears in reports from at least two outlets. The sentence was written by AI from those reports.";
const DAY_MS = 24 * 3600e3;

/** Read at call time, so a flip needs no restart. */
export function byTheNumbersEnabled(env = process.env) {
  return String(env.BY_THE_NUMBERS_ENABLED ?? "") === "1";
}

const compass = (kind, fields) => logger.info(`🧭 ${kind} ${JSON.stringify(fields)}`);
const sensitive = (s) => isSensitiveHeadline(s) || isExplicitHarmHeadline(s);
export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

const NUM_RE = /\d+(?:[.,]\d+)*/g;
const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const MONTH_BEFORE = new RegExp(`\\b${MONTH}\\.?\\s*$`, "i");
const MONTH_AFTER = new RegExp(`^(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b`, "i");
const SCALE_AFTER = /^\s*(thousand|million|billion|trillion|bn)\b/i;
const CURRENCY_BEFORE = /([$£€¥₹])\s*$/;

/**
 * Why a number at `index` in `text` is not a reader-worthy figure, or null when it is.
 * Exported for tests.
 */
export function numberKindProblem(text, raw, index) {
  const num = raw.replace(/[.,]+$/, "");
  const before = text.slice(Math.max(0, index - 12), index);
  const after = text.slice(index + raw.length, index + raw.length + 16);
  const prev = text[index - 1] ?? "", next = text[index + raw.length] ?? "";
  if (/^\d{4}$/.test(num) && +num >= 1900 && +num <= 2100) return "year";
  if (/^(?:st|nd|rd|th)\b/i.test(after)) return MONTH_AFTER.test(after) ? "date" : "ordinal";
  if (MONTH_BEFORE.test(before) || MONTH_AFTER.test(after)) return "date";
  if (prev === "/" || next === "/" || (prev === "-" && /\d/.test(text[index - 2] ?? "")) || (next === "-" && /\d/.test(text[index + raw.length + 1] ?? ""))) return "date";
  if (prev === ":" || next === ":" || /^\s*(?:a\.?m\.?|p\.?m\.?)(?![a-z])/i.test(after) || /^\s*(?:GMT|UTC|BST|EST|EDT|PST|PDT|CET|PKT)\b/.test(after)) return "time";
  if (/^\s*(?:%|per ?cent\b)/i.test(after) && Number(num.replace(/,/g, "")) < 1) return "small percentage";
  return null;
}

/**
 * The first reader-worthy number in a fact → { num, display } or { problem } (the
 * reason of the first number seen, "no number" when there are none).
 */
export function pickNumber(text) {
  const s = String(text ?? "");
  let first = null;
  for (const m of s.matchAll(NUM_RE)) {
    const problem = numberKindProblem(s, m[0], m.index);
    if (problem) { first ??= problem; continue; }
    const num = m[0].replace(/[.,]+$/, "");
    const cur = s.slice(Math.max(0, m.index - 2), m.index).match(CURRENCY_BEFORE)?.[1] ?? "";
    const rest = s.slice(m.index + m[0].length);
    const pct = /^\s*(?:%|per ?cent\b)/i.test(rest) ? "%" : "";
    const scale = !pct ? (rest.match(SCALE_AFTER)?.[1] ?? "") : "";
    return { num, display: `${cur}${num}${pct}${scale ? ` ${scale.toLowerCase()}` : ""}` };
  }
  return { problem: first ?? "no number" };
}

/**
 * Every candidate for `now`, ranked. Never writes.
 * → { candidates:[{event_id, slug, title, number_text, num, fact_text, sources, outlets24h, generated_at}], skipped:{reason:count} }
 */
export function findCandidates(db, { now = Date.now() } = {}) {
  const skipped = {};
  const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  const rows = db.prepare(`
    SELECT w.event_id, w.body_json, w.generated_at, e.slug, e.title
    FROM event_what_we_know w
    JOIN events e ON e.id = w.event_id
    WHERE w.status = 'ok' AND w.generated_at >= ? AND w.generated_at <= ?
    ORDER BY w.generated_at DESC
  `).all(now - CANDIDATE_WINDOW_MS, now);
  const hasArticles = db.prepare("SELECT 1 FROM event_articles WHERE event_id = ? LIMIT 1");
  const article = db.prepare("SELECT title, description, source_name, url FROM articles WHERE id = ?");
  const outlets = db.prepare(`
    SELECT COUNT(DISTINCT a.source_name) AS n
    FROM event_articles ea JOIN articles a ON a.id = ea.article_id
    WHERE ea.event_id = ? AND a.source_name IS NOT NULL AND a.source_name <> ''
      AND COALESCE(a.published_at, ea.added_at) >= ?
  `);

  const candidates = [];
  for (const r of rows) {
    if (!r.slug) { skip("no slug"); continue; }
    if (!hasArticles.get(r.event_id)) { skip("event has no articles"); continue; }
    if (sensitive(r.title)) { skip("sensitive event"); continue; }
    if (!eventReaderEligibility(db, r.event_id, { now }).eligible) { skip("not reader-eligible"); continue; }
    let body;
    try { body = JSON.parse(r.body_json || "{}"); } catch { skip("unreadable body"); continue; }
    const outlets24h = outlets.get(r.event_id, now - RANK_WINDOW_MS)?.n ?? 0;
    for (const fact of Array.isArray(body.facts) ? body.facts : []) {
      const text = typeof fact?.text === "string" ? fact.text.trim() : "";
      if (!text) { skip("empty fact"); continue; }
      if (sensitive(text) || CASUALTY_RE.test(text)) { skip("sensitive or casualty fact"); continue; }
      const pick = pickNumber(text);
      if (!pick.num) { skip(pick.problem); continue; }
      // re-check against the reports as they are now: verbatim in ≥ 2 distinct outlets
      const confirmed = new Map();
      for (const src of Array.isArray(fact.sources) ? fact.sources : []) {
        const a = src?.article_id ? article.get(src.article_id) : null;
        if (!a || !a.source_name) continue;
        if (hasNumberVerbatim(`${a.title ?? ""}\n${a.description ?? ""}`, pick.num) && !confirmed.has(a.source_name)) {
          confirmed.set(a.source_name, { source_name: a.source_name, url: a.url ?? src.url ?? null });
        }
      }
      if (confirmed.size < 2) { skip("number not verbatim in two outlets"); continue; }
      candidates.push({
        event_id: r.event_id, slug: r.slug, title: r.title, generated_at: r.generated_at, outlets24h,
        num: pick.num, number_text: pick.display, fact_text: text, sources: [...confirmed.values()],
      });
    }
  }
  candidates.sort((a, b) => b.outlets24h - a.outlets24h || b.generated_at - a.generated_at);
  return { candidates, skipped };
}

/** The daily run. → { enabled, day?, status?: 'skip'|'none'|'picked', event_id? } */
export function runByTheNumbers({ db = getDb(), now = Date.now(), env = process.env } = {}) {
  if (!byTheNumbersEnabled(env)) return { enabled: false };
  const day = dayOf(now);
  if (db.prepare("SELECT 1 FROM daily_numbers WHERE day = ?").get(day)) {
    compass("btn-skip", { day, reason: "already stored" });
    return { enabled: true, day, status: "skip" };
  }
  const recentDays = Array.from({ length: NO_REPEAT_DAYS }, (_, i) => dayOf(now - (i + 1) * DAY_MS));
  const recent = new Set(db.prepare(`SELECT event_id FROM daily_numbers WHERE day IN (${recentDays.map(() => "?").join(",")})`).all(...recentDays).map((r) => r.event_id));

  const { candidates, skipped } = findCandidates(db, { now });
  const pick = candidates.find((c) => !recent.has(c.event_id));
  if (!pick) {
    if (candidates.length) skipped["event picked in the last two days"] = candidates.length;
    compass("btn-none", { day, candidates: candidates.length, skipped });
    return { enabled: true, day, status: "none" };
  }
  const changes = db.prepare(`
    INSERT OR IGNORE INTO daily_numbers (day, picked_at, event_id, number_text, fact_text, sources_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(day, now, pick.event_id, pick.number_text, pick.fact_text, JSON.stringify(pick.sources)).changes;
  compass("btn-pick", { day, event: pick.event_id, number: pick.number_text, candidates: candidates.length, written: changes === 1, skipped });
  return { enabled: true, day, status: "picked", event_id: pick.event_id };
}
