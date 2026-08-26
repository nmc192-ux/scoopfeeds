/**
 * longformTopicSelector.js — which story becomes a 7-10 minute film (#78).
 *
 * Two gates, in this order, and BOTH are hard:
 *
 *   1. DEPTH, from the event graph. A film is not a long short: it needs a
 *      story with enough sourced material to sustain nine minutes and a
 *      through-line that lasted more than a news cycle. The shorts loop wants
 *      the freshest qualifying event; long-form wants the most DURABLE one.
 *
 *   2. DEMAND, from engine/demand.mjs. SKILL.md opens with "does anyone search
 *      for this?" for a reason — the channel has no algorithmic push, so a
 *      film nobody searches for is a week of compute nobody watches. A topic
 *      that fails demand is SKIPPED WITH A LOGGED REASON, never forced.
 *
 * Candidates come from `listQualifyingEvents`, which already excludes machine
 * events (USGS/NOAA) by requiring `event_articles >= MIN_ARTICLES` — those
 * carry no articles and have consumed selection windows twice in production.
 * Reusing it rather than writing a second query is deliberate: a fresh query
 * would have to re-derive that guard, and the next person to write one would
 * forget it again.
 *
 * Everything here is pure or injected, so the whole selector is testable
 * without a database or a network.
 */

import { logger } from "../logger.js";

/** A film needs materially more than a 60-second clip. */
export const MIN_ARTICLES = () =>
  Number.parseInt(process.env.LONGFORM_MIN_ARTICLES || "", 10) || 8;
export const MIN_SOURCES = () =>
  Number.parseInt(process.env.LONGFORM_MIN_SOURCES || "", 10) || 4;
/** A story that ran for at least this long is a story, not a flash. */
export const MIN_SPAN_MS = () =>
  Number.parseInt(process.env.LONGFORM_MIN_SPAN_MS || "", 10) || 3 * 24 * 60 * 60 * 1000;
/** Search-demand floor: distinct completions the phrase must return. */
export const MIN_DEMAND_BREADTH = () =>
  Number.parseInt(process.env.LONGFORM_MIN_DEMAND || "", 10) || 6;

/**
 * Depth score. Deliberately NOT recency-weighted — that is the shorts loop's
 * question. Corroboration (distinct sources) is weighted above raw volume,
 * because ten articles from one wire are one article.
 */
export function depthScore(ev) {
  const articles = ev?.articles ?? 0;
  const sources = ev?.sources ?? 0;
  const idf = ev?.idf_mass ?? 0;
  const keys = ev?.n_keys ?? 0;
  return Math.round(
    sources * 10 +              // corroboration dominates
    Math.min(articles, 40) * 2 + // volume, capped so a wire flood cannot win
    Math.min(idf, 50) +          // entity distinctiveness
    Math.min(keys, 20)
  );
}

/**
 * Structural gate: is there enough here for nine minutes?
 * Returns null when the event passes, or a reason string when it does not.
 */
export function depthGate(ev, { now = Date.now() } = {}) {
  if (!ev) return "no event";
  if ((ev.articles ?? 0) < MIN_ARTICLES()) {
    return `only ${ev.articles ?? 0} articles (need ${MIN_ARTICLES()}) — not enough for nine minutes`;
  }
  if ((ev.sources ?? 0) < MIN_SOURCES()) {
    return `only ${ev.sources ?? 0} distinct sources (need ${MIN_SOURCES()}) — single-source stories are not filmable`;
  }
  if (!ev.summary || !String(ev.summary).trim()) return "no summary";
  // Durability: the story must have spanned real time, not one news cycle.
  if (ev.first_activity_at && ev.last_activity_at) {
    const span = ev.last_activity_at - ev.first_activity_at;
    if (span < MIN_SPAN_MS()) {
      return `span ${Math.round(span / 3600000)}h (need ${Math.round(MIN_SPAN_MS() / 3600000)}h) — a flash, not a story`;
    }
  }
  return null;
}

/**
 * Candidate search phrases for a topic, most specific first.
 *
 * demand.mjs measures a PHRASE, not a story, so the phrasing is the
 * measurement. A title is often a headline ("Iran declares closure") where
 * viewers search a question ("strait of hormuz closed"), so both shapes are
 * offered and the best-performing one becomes the film's title basis.
 */
export function demandPhrases(ev) {
  const title = String(ev?.title || "").trim();
  const out = [];

  // Entity keys first when the graph has them — they ARE search phrases.
  for (const k of (ev?.keys || []).slice(0, 2)) {
    if (typeof k === "string" && k.trim()) out.push(k.toLowerCase().trim());
  }

  if (title) {
    const clean = title.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    const words = clean.split(" ").filter((w) => w && !STOPWORDS.has(w));
    // SHORT PHRASES BEFORE THE FULL TITLE. Measured on a real event: the title
    // "how ai is making cyberattacks harder to stop" returned ZERO completions
    // while "ai hacking" returned 18 and "ai security" 61. A headline is
    // written to be read, a search phrase is typed — they are different
    // artifacts, and testing only the headline reports no demand for stories
    // that plainly have some.
    for (let n = 2; n <= 3 && n <= words.length; n++) {
      for (let i = 0; i + n <= words.length && i < 3; i++) {
        out.push(words.slice(i, i + n).join(" "));
      }
    }
    if (words.length) out.push(words.slice(0, 4).join(" "));
    out.push(clean);
  }
  return [...new Set(out.filter(Boolean))].slice(0, 8);
}

/**
 * KNOWN LIMITATION, measured 2026-08-26 and deliberately not papered over.
 *
 * Short phrases are searchable, but a SHORT GENERIC one overstates a film's
 * findability. Two real prod candidates passed demand on the phrase
 * "ai firms" (breadth 49) — which is high because it is a broad category, not
 * because anyone wants those particular stories. Any title beginning with two
 * common words can clear the floor the same way.
 *
 * Not fixed here because the honest fix is a specificity measure (does the
 * phrase's completion set actually relate to THIS story?), which needs its own
 * design and calibration corpus. Until then the gate answers "is there search
 * traffic in this space", not "will this film be found" — and a reviewer
 * choosing a title should read the winning phrase, not just the verdict.
 */
export const DEMAND_PHRASE_CAVEAT =
  "a short generic phrase can clear the demand floor without the film being findable";

/**
 * Words that carry no search intent. Deliberately small: an aggressive list
 * strips the words that make a phrase specific.
 */
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "how", "why", "what", "when", "where", "who", "which",
  "to", "of", "in", "on", "at", "for", "with", "by", "from", "as",
  "and", "or", "but", "if", "than", "then", "that", "this", "these", "those",
  "it", "its", "has", "have", "had", "will", "would", "can", "could",
  "making", "makes", "made", "harder", "easier", "new", "now", "more", "most",
]);

/**
 * Demand gate. `demandFn` is injected (engine/demand.mjs in production).
 * Returns { ok, phrase, breadth, reason }.
 *
 * NEVER FORCED. A topic that fails is skipped and the reason is logged — the
 * temptation is to lower the floor for a story we like, which is how a channel
 * ends up making films for itself.
 */
export async function demandGate(ev, { demandFn, min = MIN_DEMAND_BREADTH() } = {}) {
  if (!demandFn) return { ok: false, reason: "no demand function supplied" };
  const phrases = demandPhrases(ev);
  if (!phrases.length) return { ok: false, reason: "no searchable phrase could be formed" };

  let best = null;
  for (const phrase of phrases) {
    let r;
    try {
      r = await demandFn(phrase);
    } catch (e) {
      logger.warn(`🎬 demand check failed for "${phrase}": ${e.message}`);
      continue;
    }
    const breadth = r?.breadth ?? 0;
    if (!best || breadth > best.breadth) best = { phrase, breadth, top: r?.top || [] };
  }
  if (!best) return { ok: false, reason: "every demand lookup failed" };
  if (best.breadth < min) {
    return { ok: false, phrase: best.phrase, breadth: best.breadth,
             reason: `demand ${best.breadth} < ${min} — nobody searches for this` };
  }
  return { ok: true, ...best };
}

/**
 * Select topics for long-form, best first.
 *
 * @param {object} opts
 * @param {() => object[]} opts.listEvents      injected DAL call
 * @param {(phrase:string) => Promise<object>} opts.demandFn
 * @param {Set<string>} [opts.alreadyFilmed]    event ids already made into films
 * @param {number} [opts.limit=1]               how many to return
 * @returns {Promise<{selected: object[], rejected: object[]}>}
 */
export async function selectLongformTopics({
  listEvents, demandFn, alreadyFilmed = new Set(), limit = 1, now = Date.now(),
} = {}) {
  if (!listEvents) throw new Error("selectLongformTopics: listEvents is required");

  const events = listEvents() || [];
  const rejected = [];
  const ranked = [];

  for (const ev of events) {
    if (alreadyFilmed.has(String(ev.id))) {
      rejected.push({ id: ev.id, title: ev.title, reason: "already filmed" });
      continue;
    }
    const why = depthGate(ev, { now });
    if (why) { rejected.push({ id: ev.id, title: ev.title, reason: why }); continue; }
    ranked.push({ ...ev, score: depthScore(ev) });
  }
  ranked.sort((a, b) => b.score - a.score);

  // Demand is checked ONLY on candidates that already pass depth — each check
  // is several network round trips, and a shallow story would be skipped
  // regardless of how well it searches.
  const selected = [];
  for (const ev of ranked) {
    if (selected.length >= limit) break;
    const d = await demandGate(ev, { demandFn });
    if (!d.ok) {
      rejected.push({ id: ev.id, title: ev.title, reason: d.reason });
      logger.info(`🎬 topic skipped — ${ev.title}: ${d.reason}`);
      continue;
    }
    selected.push({ ...ev, demand: d });
    logger.info(`🎬 topic selected — ${ev.title} (depth ${ev.score}, demand ${d.breadth} on "${d.phrase}")`);
  }

  if (!selected.length) {
    logger.info(`🎬 no long-form topic qualified — ${events.length} events considered, ${rejected.length} rejected`);
  }
  return { selected, rejected };
}
