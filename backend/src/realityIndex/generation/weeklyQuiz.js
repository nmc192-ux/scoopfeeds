/**
 * weeklyQuiz — "Did you scoop it?", the weekly news quiz on Originals (#271).
 *
 * Once a week: pick the week's biggest coherent dossiers, ask Claude for one
 * multiple-choice question per dossier in ONE call, check every question
 * against that dossier's own reports, and store the survivors. If the week's
 * quiz fails its checks, a 'refused' row is stored and nothing is published.
 *
 * On by default (flag flip after 24 h dark); ORIGINALS_QUIZ_ENABLED=0 switches it off (read at call time).
 *
 * Dossier selection (an event that fails any rule is never in the bundle):
 *   - has at least one event_articles row (machine-event gotcha) with article
 *     activity in the 7 days before week_start; ranked by distinct named outlets
 *     in that window;
 *   - title not sensitive (isSensitiveHeadline / isExplicitHarmHeadline);
 *   - passes eventReaderEligibility;
 *   - dossierCoherence(...).level === "ok" ("low" and null/unmeasured → dropped).
 *   The candidate query is capped at CANDIDATE_CAP; the 🧭 line says if it was hit.
 *
 * Validation fails CLOSED, per question (drop + reason):
 *   event in the bundle; exactly 4 distinct non-empty choices; answer 0-3; the
 *   correct choice appears (case-insensitive) in that dossier's bundle text; no
 *   wrong choice does; every number in q or a choice appears verbatim in that
 *   dossier's bundle; q and choices not sensitive; q ≤ MAX_Q_WORDS words.
 *   Fewer than MIN_QUESTIONS survivors → 'refused'.
 *
 * Written once per week_start, never rewritten. callJson → null (LLM unavailable:
 * nothing paid) writes nothing, so a later run that week may try again.
 */

import { getDb } from "../../models/database.js";
import { callJson } from "../llmQueue.js";
import { logger } from "../../services/logger.js";
import { dossierCoherence } from "../intelligence/eventCoherence.js";
import { eventReaderEligibility } from "../dal/readerEligibility.js";
import { isSensitiveHeadline, isExplicitHarmHeadline } from "../../services/editorialSensitivity.js";
import { buildBundle, numbersIn, hasNumberVerbatim } from "./whatWeKnow.js";
import { mondayOf } from "../intelligence/coverageGaps.js";

export const TASK = "weekly-quiz";
export const DISCLOSURE = "Questions written by AI from our dossiers. Each answer links to the reports it came from.";
export const MAX_DOSSIERS = 8;
export const MIN_QUESTIONS = 5;
export const MAX_Q_WORDS = 30;
export const ARTICLES_PER_DOSSIER = 6;
export const CANDIDATE_CAP = 60;
const DAY_MS = 24 * 3600e3;

/** Read at call time, so a flip needs no restart. */
export function weeklyQuizEnabled(env = process.env) {
  return String(env.ORIGINALS_QUIZ_ENABLED ?? "1") === "1";
}

const compass = (kind, fields) => logger.info(`🧭 ${kind} ${JSON.stringify(fields)}`);
const wordCount = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const sensitive = (s) => isSensitiveHeadline(s) || isExplicitHarmHeadline(s);
const bundleText = (arts) => arts.map((a) => `${a.title ?? ""}\n${a.description ?? ""}`).join("\n");

/** The week this run belongs to: the Monday on or before `now`, and the 7 days before it. */
export function quizWeek(now = Date.now()) {
  const weekStart = mondayOf(now);
  const endMs = Date.parse(`${weekStart}T00:00:00Z`);
  return { weekStart, startMs: endMs - 7 * DAY_MS, endMs };
}

/**
 * Pick up to MAX_DOSSIERS eligible dossiers for the window. Never writes.
 * → { dossiers:[{id, slug, title, outlets}], dropped:{reason:count}, candidates, capped }
 */
export function pickDossiers(db, { startMs, endMs, now = endMs, coherenceOf = dossierCoherence } = {}) {
  const rows = db.prepare(`
    SELECT e.id, e.slug, e.title, COUNT(DISTINCT a.source_name) AS outlets
    FROM events e
    JOIN event_articles ea ON ea.event_id = e.id
    JOIN articles a ON a.id = ea.article_id
    WHERE a.source_name IS NOT NULL AND a.source_name <> ''
      AND COALESCE(a.published_at, ea.added_at) >= ? AND COALESCE(a.published_at, ea.added_at) < ?
    GROUP BY e.id
    ORDER BY outlets DESC, e.last_activity_at DESC, e.id
    LIMIT ?
  `).all(startMs, endMs, CANDIDATE_CAP);

  const dropped = {};
  const drop = (why) => { dropped[why] = (dropped[why] ?? 0) + 1; };
  const dossiers = [];
  for (const r of rows) {
    if (dossiers.length >= MAX_DOSSIERS) break;
    if (!r.slug) { drop("no slug"); continue; }
    if (sensitive(r.title)) { drop("sensitive"); continue; }
    const elig = eventReaderEligibility(db, r.id, { now });
    if (!elig.eligible) { drop("not reader-eligible"); continue; }
    let coh;
    try { coh = coherenceOf(db, r.id, { now }); } catch { coh = null; }
    if (!coh || coh.level === null || coh.level === undefined) { drop("coherence unmeasured"); continue; }
    if (coh.level !== "ok") { drop("coherence low"); continue; }
    dossiers.push({ id: r.id, slug: r.slug, title: r.title, outlets: r.outlets });
  }
  return { dossiers, dropped, candidates: rows.length, capped: rows.length >= CANDIDATE_CAP };
}

export function buildPrompt(bundles) {
  const blocks = bundles.map((b) => {
    const items = b.articles.map((a) => `- (${a.source_name}) ${a.title}\n  ${a.description ?? ""}`.trimEnd()).join("\n");
    return `Dossier id: ${b.event.id}\nStory: "${b.event.title}"\nReports:\n${items}`;
  }).join("\n\n");
  return `You write a short, fair weekly news quiz for general readers.

Below are this week's stories, each with the reports we hold on it.

${blocks}

Return JSON only: {"questions":[{"event":<dossier id>,"q":string,"choices":[4 strings],"answer":<0-3>}]}
Rules:
- One question per dossier, about what its reports say. Use the exact dossier id.
- Plain, neutral wording, at most ${MAX_Q_WORDS} words. No trick questions, no opinion.
- Exactly 4 short choices. The correct choice must be written exactly as it appears in that dossier's reports.
- The 3 wrong choices must be plausible but must NOT appear anywhere in that dossier's reports.
- Do not use any number, date or figure that does not appear in that dossier's reports.
- No questions about deaths, injuries, casualty counts, violence or abuse.`;
}

/**
 * Validate a model response against the bundles. Fails closed.
 * → { questions:[{q, choices, answer, event:{id, slug, title}}], dropped:[{event, why}] }
 */
export function validate(parsed, bundles) {
  const byId = new Map(bundles.map((b) => [String(b.event.id), b]));
  const questions = [];
  const dropped = [];
  const seen = new Set();
  for (const item of Array.isArray(parsed?.questions) ? parsed.questions : []) {
    const evId = item?.event == null ? "" : String(item.event);
    const why = (() => {
      const b = byId.get(evId);
      if (!b) return "event outside the bundle";
      if (seen.has(evId)) return "second question for the same dossier";
      const q = typeof item.q === "string" ? item.q.trim() : "";
      if (!q) return "empty question";
      if (wordCount(q) > MAX_Q_WORDS) return "question too long";
      const choices = Array.isArray(item.choices) ? item.choices : [];
      if (choices.length !== 4) return `${choices.length} choices`;
      if (choices.some((c) => typeof c !== "string" || !c.trim())) return "empty choice";
      const norm = choices.map((c) => c.trim().toLowerCase());
      if (new Set(norm).size !== 4) return "duplicate choices";
      const answer = item.answer;
      if (!Number.isInteger(answer) || answer < 0 || answer > 3) return "answer not 0-3";
      const text = bundleText(b.articles);
      const lower = text.toLowerCase();
      if (!lower.includes(norm[answer])) return "correct answer not in the dossier's reports";
      if (norm.some((c, i) => i !== answer && lower.includes(c))) return "a wrong choice is in the dossier's reports";
      const bad = [q, ...choices].flatMap(numbersIn).find((n) => !hasNumberVerbatim(text, n));
      if (bad) return `number ${bad} not in the dossier's reports`;
      if ([q, ...choices].some(sensitive)) return "sensitive";
      return null;
    })();
    if (why) { dropped.push({ event: evId, why }); continue; }
    const b = byId.get(evId);
    seen.add(evId);
    questions.push({
      q: item.q.trim(),
      choices: item.choices.map((c) => c.trim()),
      answer: item.answer,
      event: { id: b.event.id, slug: b.event.slug, title: b.event.title },
    });
    if (questions.length >= MAX_DOSSIERS) break;
  }
  return { questions, dropped };
}

function insert(db, { weekStart, now, status, body = null, model = null, reason = null }) {
  return db.prepare(`
    INSERT OR IGNORE INTO weekly_quizzes (week_start, generated_at, status, body_json, model, refusal_reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(weekStart, now, status, body, model, reason).changes === 1;
}

/**
 * The weekly run. → { enabled, weekStart?, status?: 'skip'|'refused'|'published', reason? }
 */
export async function runWeeklyQuiz({ db = getDb(), now = Date.now(), llm = callJson, coherenceOf = dossierCoherence, env = process.env } = {}) {
  if (!weeklyQuizEnabled(env)) return { enabled: false };
  const { weekStart, startMs, endMs } = quizWeek(now);

  if (db.prepare("SELECT 1 FROM weekly_quizzes WHERE week_start = ?").get(weekStart)) {
    compass("quiz-skip", { week: weekStart, reason: "already stored" });
    return { enabled: true, weekStart, status: "skip", reason: "already stored" };
  }

  const pick = pickDossiers(db, { startMs, endMs, now, coherenceOf });
  if (pick.dossiers.length < MIN_QUESTIONS) {
    const reason = "too few eligible dossiers";
    insert(db, { weekStart, now, status: "refused", reason: `${reason} (${pick.dossiers.length}); dropped ${JSON.stringify(pick.dropped)}` });
    compass("quiz-refuse", { week: weekStart, reason, eligible: pick.dossiers.length, candidates: pick.candidates, capped: pick.capped, dropped: pick.dropped });
    return { enabled: true, weekStart, status: "refused", reason };
  }

  const bundles = pick.dossiers.map((d) => ({ event: d, articles: buildBundle(db, d.id).slice(0, ARTICLES_PER_DOSSIER) }));

  let res;
  try {
    res = await llm(buildPrompt(bundles), { task: TASK, maxOutputTokens: 1200, withMeta: true });
  } catch (err) {
    res = { ok: false, errClass: err?.message ?? "error" };
  }
  // null = LLM unavailable (no key, breaker open, daily cap spent): nothing was
  // paid, so nothing is stored and a later run this week may try again.
  if (res == null) {
    compass("quiz-skip", { week: weekStart, reason: "llm unavailable" });
    return { enabled: true, weekStart, status: "skip", reason: "llm unavailable" };
  }
  if (!res.ok) {
    const reason = `llm failed: ${String(res.errClass ?? "error").slice(0, 200)}`;
    insert(db, { weekStart, now, status: "refused", reason });
    compass("quiz-refuse", { week: weekStart, reason });
    return { enabled: true, weekStart, status: "refused", reason };
  }

  const v = validate(res.value, bundles);
  if (v.questions.length < MIN_QUESTIONS) {
    const reason = `only ${v.questions.length} question(s) survived validation`;
    const detail = v.dropped.map((d) => `${d.event}: ${d.why}`).join("; ");
    insert(db, { weekStart, now, status: "refused", model: res.model ?? null, reason: `${reason}${detail ? `: ${detail}` : ""}`.slice(0, 1000) });
    compass("quiz-refuse", { week: weekStart, reason, dropped: v.dropped });
    return { enabled: true, weekStart, status: "refused", reason };
  }

  const body = { questions: v.questions, disclosure: DISCLOSURE };
  insert(db, { weekStart, now, status: "published", body: JSON.stringify(body), model: res.model ?? null });
  compass("quiz-publish", { week: weekStart, questions: v.questions.length, dossiers: bundles.length, dropped: v.dropped, candidates: pick.candidates, capped: pick.capped, dossiers_dropped: pick.dropped });
  return { enabled: true, weekStart, status: "published", questions: v.questions.length };
}
