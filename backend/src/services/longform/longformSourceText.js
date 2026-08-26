/**
 * longformSourceText.js — assembling a groundable corpus, per candidate (#78).
 *
 * THE PROBLEM, measured on a real prod topic: an event with 161 articles and
 * 42 sources yielded 2,436 chars of stored text, because contentEnricher caps
 * stored bodies at 5,000 chars and most rows carry only an RSS teaser. A
 * grounded 1,000-1,400-word script cannot be written from that — the model
 * would invent figures and the grounding screen would abandon the film AFTER
 * paying for generation.
 *
 * THE SHAPE OF THE FIX, and where it sits, both matter:
 *
 *   FETCH-EXTRACT-DISCARD, scaled. videoFullText.js solved this for shorts —
 *   one HTTP request at generation time for the article already chosen,
 *   nothing stored, no schema change (its header explains why raising the
 *   stored cap is the wrong trade). Long-form needs several articles for nine
 *   minutes instead of one for sixty seconds, so this fetches a LADDER of
 *   tranches, widening until the floor is met or candidates run out.
 *
 *   A CANDIDATE-LEVEL GATE, NEVER A CYCLE-LEVEL ONE. DrJ's requirement: the
 *   loop must not go quiet because the top story has thin sources. A topic
 *   that cannot assemble a corpus loses to the NEXT candidate; the cycle
 *   skips only when the whole shortlist fails. And a thin topic is not
 *   retired — events accumulate articles over time, so a story thin at six
 *   hours old is often rich at two days old, and the gate runs BEFORE the
 *   claim so the topic stays selectable for the next cycle.
 *
 *   DISTINCT SOURCES FIRST, WIRE COPIES DEDUPED. Corroboration is what the
 *   depth gate selected for; forty syndicated copies of one Reuters piece are
 *   one source, and the floor must count real corpus, not repetition.
 *
 * The fetcher is injected (production: videoFullText.resolveVideoSourceText),
 * so every rule here is testable offline.
 */

import { logger } from "../logger.js";
import { restatesAny } from "../textSimilarity.js";

/** The corpus floor. ~8k chars ≈ enough distinct material for 1,200 grounded words. */
export const MIN_SOURCE_CHARS = () =>
  Number.parseInt(process.env.LONGFORM_MIN_SOURCE_CHARS || "", 10) || 8000;

/** Ladder bounds: how many candidate articles each widening step may consider. */
export const TRANCHES = Object.freeze([12, 24, 40]);

/** A fetched body must add something beyond its own teaser to count. */
const MIN_USEFUL_CHARS = 300;

/**
 * Order candidates so the first pass covers DISTINCT sources. Within a source,
 * callers should already have ranked by credibility; that order is preserved.
 */
export function distinctSourcesFirst(articles = []) {
  const bySource = new Map();
  for (const a of articles) {
    const k = a?.source_name || "unknown";
    if (!bySource.has(k)) bySource.set(k, []);
    bySource.get(k).push(a);
  }
  const queues = [...bySource.values()];
  const out = [];
  // Round-robin across sources: one from each, then seconds, and so on.
  for (let round = 0; out.length < articles.length; round++) {
    for (const q of queues) if (q[round]) out.push(q[round]);
  }
  return out;
}

/**
 * Assemble a corpus for one topic, widening tranche by tranche.
 *
 * @param {object} o
 * @param {object[]} o.articles      ranked candidates ({title, source_name, url, content})
 * @param {(article) => Promise<{text:string, chars:number, origin:string}>} o.fetchFullText
 * @param {number} [o.floor]
 * @param {number[]} [o.tranches]
 * @returns {Promise<{ok, totalChars, corpus, sources, sourceText, fetched, duplicates, thin, reason?}>}
 */
export async function assembleSourceCorpus({
  articles = [], fetchFullText, floor = MIN_SOURCE_CHARS(), tranches = TRANCHES,
} = {}) {
  if (!fetchFullText) throw new Error("assembleSourceCorpus: fetchFullText is required");

  const ordered = distinctSourcesFirst(articles);
  const corpus = [];
  let totalChars = 0, fetched = 0, duplicates = 0, thin = 0;

  for (const bound of tranches) {
    for (let i = fetched + duplicates + thin; i < Math.min(bound, ordered.length); ) {
      const a = ordered[i];
      let r;
      try {
        r = await fetchFullText(a);
      } catch (e) {
        r = { text: String(a?.content || ""), chars: String(a?.content || "").length, origin: `fetch-failed: ${e.message}` };
      }
      i++;
      const text = String(r?.text || "").trim();
      if (text.length < MIN_USEFUL_CHARS) { thin++; continue; }
      // Wire copies: the same story syndicated forty times is ONE source.
      // restatesAny takes { text, label } references — a raw string ref has
      // no .text, fails canJudgeSimilarity, and is SILENTLY skipped, which
      // disabled this dedup entirely until the test caught it.
      if (corpus.length && restatesAny(text.slice(0, 1200),
            corpus.map((c) => ({ text: c.text.slice(0, 1200), label: c.source }))).restates) {
        duplicates++;
        continue;
      }
      corpus.push({
        title: a?.title || "", source: a?.source_name || "unknown", url: a?.url || "",
        text, chars: text.length, origin: r?.origin || "unknown",
      });
      totalChars += text.length;
      fetched++;
      // Stop MID-TRANCHE, not just between tranches: every fetch past the
      // floor is a paid HTTP request buying nothing.
      if (totalChars >= floor) break;
    }
    if (totalChars >= floor) break;
    if (Math.min(bound, ordered.length) >= ordered.length) break;  // nothing left to widen into
  }

  const ok = totalChars >= floor;
  const result = {
    ok, totalChars, fetched, duplicates, thin, floor,
    corpus,
    // What the prompts consume: attributed source lines, and the raw text the
    // grounding screen checks figures against.
    sources: corpus.map((c) => `${c.source} — ${c.title}`),
    sourceText: corpus.map((c) => c.text).join("\n\n"),
  };
  if (!ok) {
    result.reason =
      `source corpus is ${totalChars} chars after ${fetched} fetched, ${duplicates} wire duplicate(s), ` +
      `${thin} thin (floor ${floor}) — not groundable unattended; the topic stays eligible and may be richer next cycle`;
  }
  return result;
}

/**
 * The selection-time gate. Same contract as demandGate: per CANDIDATE, and a
 * failure costs that candidate its place in this cycle's shortlist — never
 * the cycle, and never the topic's future eligibility.
 */
export function makeSourceGate({ fetchArticles, fetchFullText, floor } = {}) {
  if (!fetchArticles) throw new Error("makeSourceGate: fetchArticles is required");
  if (!fetchFullText) throw new Error("makeSourceGate: fetchFullText is required");
  return async (ev) => {
    const articles = await fetchArticles(ev);
    if (!articles?.length) {
      return { ok: false, reason: "no articles could be listed for this event" };
    }
    const corpus = await assembleSourceCorpus({ articles, fetchFullText, floor });
    if (!corpus.ok) {
      logger.info(`🎬 source gate — ${ev.title}: ${corpus.reason}`);
      return { ok: false, reason: corpus.reason };
    }
    logger.info(
      `🎬 source gate — ${ev.title}: ${corpus.totalChars} chars from ${corpus.fetched} article(s), ` +
      `${corpus.duplicates} wire duplicate(s) dropped`);
    return { ok: true, corpus };
  };
}
