/**
 * radioState.js — builds ScoopFeeds Radio's screen state every ~5 minutes.
 *
 * Runs on the WORKER (radio queue), dispatched by the scheduler; does nothing unless
 * RADIO_ENABLED=true. Writes ONE JSON object, ATOMICALLY (temp file in the same
 * directory + rename), to $SCOOP_PERSISTENT_DATA_DIR/radio/state.json. The card
 * cache's bare writeFileSync let a reader see a half-written file; rename() is
 * atomic on one filesystem, so a reader sees the old file or the new one, never part.
 *
 * Keys match the R1 screen's STATE exactly:
 *   sample:false · updatedAt · headline · alsoThisHour[{h,src}] (5) · music[{cat,h,src}] (4–6)
 * weatherLine / markets / weather / key are OMITTED in R2 (no feed yet).
 *
 * Pipeline: candidates (this hour, not duplicate, credibility ≥ 7, not a programming
 * block — the social selector's own filters) → D1 rules (radioRules.js) → group →
 * rank (radioRank.js) → pick with caps → LLM judge on picks with a Pakistan signal
 * (fail closed; a dropped pick is replaced from further down the ranking) →
 * one LLM call to word the lines (falls back to cleanHeadline; never blocks).
 * Every drop is logged to radio_dropped (14-day prune) for DrJ's weekly review.
 */
import fs from "node:fs";
import path from "node:path";
import { getDb, recordHeartbeat } from "../models/database.js";
import { logger } from "../services/logger.js";
import { cleanHeadline } from "../services/socialComposer.js";
import { looksLikeProgrammingBlock } from "../services/socialPublisher.js";
import { HEARTBEAT_PING_URLS, pingHeartbeat } from "../services/heartbeatPing.js";
import { callJson } from "../realityIndex/llmQueue.js";
import { radioRulesVerdict, judgeItems, hasPakistanSignal, isRadioSensitive } from "./radioRules.js";
import { groupArticles, rankStories, pickSlots, attribution, displayCategory, GROUP_WINDOW_MS } from "./radioRank.js";

export const HEADLINE_MAX = 90;
export const DROP_RETENTION_MS = 14 * 24 * 60 * 60_000;
const MIN_CREDIBILITY = 7;
const MAX_JUDGE_ROUNDS = 3;

export function radioEnabled() {
  return String(process.env.RADIO_ENABLED || "").trim().toLowerCase() === "true";
}

export function radioDir() {
  const base = process.env.SCOOP_PERSISTENT_DATA_DIR || path.resolve("data");
  return path.join(base, "radio");
}
export const statePath = () => path.join(radioDir(), "state.json");

/** Atomic JSON write: temp file in the target directory, then rename over it. */
export function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw err;
  }
}

const MIN_CLAUSE = 30;
/**
 * ≤ HEADLINE_MAX characters AND a complete thought, or "" — never a mid-sentence cut and
 * never a trailing "…". A line that is too long is shortened only at a clause boundary
 * (": ", " – ", "; ", ", ") and only if what is left is still a real headline.
 */
export function fitHeadline(s, max = HEADLINE_MAX) {
  const h = String(s || "").replace(/\s+/g, " ").trim().replace(/[….]{2,}$|…$/, "").trim();
  if (h.length <= max) return h;
  let best = "";
  for (const m of h.matchAll(/:\s|\s[–—-]\s|;\s|,\s/g)) {
    const head = h.slice(0, m.index).trim();
    if (head.length > max) break;
    if (head.length >= MIN_CLAUSE && /\s/.test(head)) best = head;
  }
  return best;
}

// ─── radio_dropped ──────────────────────────────────────────────────────────

/** Log a drop, at most once per (article, rule) per 24 h so a 5-minute cadence cannot bloat the table. */
export function logDrop(db, { article_id = null, event_id = null, title = "", source = "", rule, reason = "" }, now = Date.now()) {
  const seen = db.prepare(`SELECT 1 FROM radio_dropped WHERE COALESCE(article_id,'') = COALESCE(?, '') AND rule = ? AND created_at > ? LIMIT 1`)
    .get(article_id, rule, now - 24 * 60 * 60_000);
  if (seen) return false;
  db.prepare(`INSERT INTO radio_dropped (article_id, event_id, title, source, rule, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(article_id, event_id, String(title).slice(0, 300), String(source || "").slice(0, 120), rule, String(reason || "").slice(0, 300), now);
  return true;
}

export function pruneDrops(db, now = Date.now()) {
  return db.prepare(`DELETE FROM radio_dropped WHERE created_at < ?`).run(now - DROP_RETENTION_MS).changes;
}

// ─── candidates ─────────────────────────────────────────────────────────────

export function loadCandidates(db, now = Date.now()) {
  return db.prepare(`
    SELECT id, title, description, category, source_name, credibility, fetched_at, published_at
    FROM articles
    WHERE fetched_at >= ? AND COALESCE(is_duplicate, 0) = 0 AND COALESCE(credibility, 0) >= ?
    ORDER BY fetched_at DESC
    LIMIT 2000
  `).all(now - GROUP_WINDOW_MS, MIN_CREDIBILITY).filter((a) => !looksLikeProgrammingBlock(a.title));
}

// ─── wording ────────────────────────────────────────────────────────────────

const WORDING_PROMPT = (items) => [
  "Rewrite each news headline for a calm, factual US news radio screen (ScoopFeeds).",
  `Each must be at most ${HEADLINE_MAX} characters, plain English, present tense, no clickbait, no emoji,`,
  "no outlet names, and must not add any fact that is not in the original.",
  'Reply ONLY with JSON: {"items":[{"id":"<id>","h":"<headline>"}]}',
  "",
  ...items.map((s) => `id=${s.lead.id} | ${String(s.lead.title || "").slice(0, 220)}`),
].join("\n");

const fitOf = (a) => fitHeadline(cleanHeadline(a.title) || a.title);

/**
 * Give each story a lead whose own cleaned title fits, preferring the existing lead
 * (highest credibility) and falling back to the next article in the group. A story with
 * no fitting title is returned in `unfit` — when the wording LLM is down there is
 * nothing to put on air for it, and truncating is not allowed.
 */
export function chooseFittingLeads(stories) {
  const fit = [], unfit = [];
  for (const s of stories) {
    const order = [s.lead, ...[...s.articles].sort((x, y) => (y.credibility || 0) - (x.credibility || 0) || (y.fetched_at || 0) - (x.fetched_at || 0)).filter((a) => a !== s.lead)];
    const lead = order.find((a) => fitOf(a));
    if (lead) { s.lead = lead; fit.push(s); } else unfit.push(s);
  }
  return { fit, unfit };
}

async function wordLines(stories, llm) {
  const fallback = (s) => fitOf(s.lead);
  const lines = new Map(stories.map((s) => [s.lead.id, fallback(s)]));
  if (!stories.length) return { lines, source: "none" };
  try {
    const res = await llm(WORDING_PROMPT(stories));
    if (res == null) return { lines, source: "fallback:no answer" };   // llmQueue returns null when disabled / over budget
    const got = Array.isArray(res?.items) ? res.items : null;
    if (!got) return { lines, source: "fallback:malformed" };
    let used = 0;
    for (const it of got) {
      const raw = String(it?.h || "").replace(/\s+/g, " ").trim();
      const h = raw.length <= HEADLINE_MAX && !/…|\.\.\.$/.test(raw) ? raw : "";   // over-long LLM lines are rejected, not cut
      if (h && lines.has(String(it?.id)) && h.length >= 12) { lines.set(String(it.id), h); used++; }
    }
    return { lines, source: used ? `llm:${used}/${stories.length}` : "fallback:empty" };
  } catch (err) {
    return { lines, source: `fallback:error ${String(err?.message || err).slice(0, 80)}` };
  }
}

// ─── build ──────────────────────────────────────────────────────────────────

/**
 * Build the state object. Pure apart from DB reads, drop logging and the injected LLM.
 * @param {{ db?, now?, gateLlm?, wordLlm? }} deps
 */
export async function buildRadioState({
  db = getDb(),
  now = Date.now(),
  gateLlm = (p, o = {}) => callJson(p, { task: "radio-gate", priority: "normal", ...o }),
  wordLlm = (p) => callJson(p, { task: "radio-headline", priority: "normal" }),
} = {}) {
  const drops = {};
  const drop = (a, rule, reason) => {
    drops[rule] = (drops[rule] || 0) + 1;
    logDrop(db, { article_id: a.id, title: a.title, source: a.source_name, rule, reason }, now);
  };

  // 1 · candidates → rules layer
  const candidates = loadCandidates(db, now);
  const kept = [];
  for (const a of candidates) {
    const v = radioRulesVerdict(a);
    if (v.allowed) kept.push(a); else drop(a, v.rule, v.reason);
  }

  // 2 · group + rank; the sensitivity check MARKS (News may carry it, music never does)
  let ranked = rankStories(groupArticles(kept), { now });
  const multiOutlet = ranked.filter((s) => s.outlets.length >= 2).length;
  // A story airs only if some article in it has a title that fits whole (no truncation).
  const { fit, unfit } = chooseFittingLeads(ranked);
  for (const s of unfit) drop(s.lead, "radio:no-fitting-headline", `all ${s.articles.length} title(s) exceed ${HEADLINE_MAX} chars`);
  ranked = fit;
  // Every title in the group plus the lead's description: one tragic outlet's framing is enough.
  for (const s of ranked) s.sensitive = isRadioSensitive(s.articles.map((a) => a.title));

  // 3 · pick, judge the picks, replace any the judge drops
  const judged = new Map();
  let slots = pickSlots(ranked);
  for (let round = 0; round < MAX_JUDGE_ROUNDS; round++) {
    const picked = [slots.headline, ...slots.also, ...slots.music].filter(Boolean);
    const toJudge = picked.map((s) => s.lead).filter((a) => !judged.has(a.id));
    const verdicts = await judgeItems(toJudge, gateLlm);
    for (const [id, v] of verdicts) judged.set(id, v);
    const rejected = picked.filter((s) => judged.get(s.lead.id)?.allowed === false);
    if (!rejected.length) break;
    for (const s of rejected) drop(s.lead, "radio:judge", judged.get(s.lead.id).reason);
    ranked = ranked.filter((s) => !rejected.includes(s));
    slots = pickSlots(ranked);
    if (round === MAX_JUDGE_ROUNDS - 1) {
      // Out of rounds: anything still unjudged or rejected does not air.
      const still = [slots.headline, ...slots.also, ...slots.music].filter(Boolean);
      const bad = new Set(still.filter((s) => judged.get(s.lead.id)?.allowed === false || (!judged.has(s.lead.id) && verdictsNeeded(s))));
      if (bad.size) {
        slots = {
          headline: bad.has(slots.headline) ? null : slots.headline,
          also: slots.also.filter((s) => !bad.has(s)),
          music: slots.music.filter((s) => !bad.has(s)),
        };
      }
    }
  }

  // 4 · wording (one call; never blocks the build)
  const airing = [slots.headline, ...slots.also, ...slots.music].filter(Boolean);
  const { lines, source: wording } = await wordLines(airing, wordLlm);
  const line = (s) => lines.get(s.lead.id);

  const state = {
    sample: false,
    updatedAt: now,
    headline: slots.headline ? line(slots.headline) : "",
    alsoThisHour: slots.also.map((s) => ({ h: line(s), src: attribution(s.outlets), ...(s.sensitive ? { sensitive: true } : {}) })),
    music: slots.music.map((s) => ({ cat: displayCategory(s.lead.category), h: line(s), src: attribution(s.outlets) })),
  };
  const stats = {
    candidates: candidates.length, kept: kept.length, stories: ranked.length, multiOutlet,
    airing: airing.length, music: state.music.length, drops, wording,
  };
  return { state, stats };
}

// verdictsNeeded is only reached when rounds run out; a pick with a Pakistan
// signal that was never judged must not air.
function verdictsNeeded(story) { return hasPakistanSignal(story.lead); }

/**
 * The scheduled cycle: gate on RADIO_ENABLED, build, write atomically, heartbeat.
 * Never throws (a BullMQ retry would only repeat the same failure five minutes early).
 */
export async function runRadioStateCycle(deps = {}) {
  if (!radioEnabled()) return { skipped: "RADIO_ENABLED is not true" };
  const startedAt = Date.now();
  const db = deps.db || getDb();
  try {
    recordHeartbeat("radio_state", { phase: "start", startedAt });
    const pruned = pruneDrops(db, startedAt);
    const { state, stats } = await buildRadioState({ ...deps, db });
    writeJsonAtomic(deps.file || statePath(), state);
    const meta = { phase: "complete", startedAt, ms: Date.now() - startedAt, pruned, ...stats };
    recordHeartbeat("radio_state", meta);
    pingHeartbeat(HEARTBEAT_PING_URLS.radio);            // completion only
    logger.info(`📻 radio state: ${stats.airing} item(s) from ${stats.stories} stories (${stats.multiOutlet} with ≥2 outlets); drops ${JSON.stringify(stats.drops)}; wording ${stats.wording}`);
    return meta;
  } catch (err) {
    const meta = { phase: "error", startedAt, ms: Date.now() - startedAt, error: String(err?.message || err).slice(0, 300) };
    try { recordHeartbeat("radio_state", meta); } catch { /* heartbeat is best effort */ }
    logger.error(`📻 radio state FAILED: ${meta.error}`);
    return meta;
  }
}
