/**
 * longformFootageRelevance.js — is this clip about the story? (DrJ, 2026-08-27)
 *
 * The first published film's footage was six clips of unrelated US Army
 * b-roll, and every one of them was CORRECT by the pipeline's own rules —
 * verified provenance, real 1080p, licences clean. Relevance was never a
 * gate anywhere: footage-search ranks by provenance tier, the media gate
 * screens rights and resolution, and nothing in between asks whether a clip
 * about a graduation ceremony belongs in a film about facial recognition.
 *
 * The measure is embedding cosine against the STORY, using the same Gemini
 * embeddings the event graph runs on — not keyword overlap, which is what
 * produced the b-roll in the first place ("cyber tests" matches an Air Force
 * exercise title perfectly).
 *
 * A candidate below the floor costs THAT CANDIDATE, never the film: the
 * acquirer downloads fewer, more relevant clips, and a card-led film
 * degrades gracefully to more card time. The floor is env-tunable because
 * it is an empirical quantity — calibrate against real search results, not
 * intuition.
 *
 * Embedding is injected, so every rule here is testable offline.
 */

import { logger } from "../logger.js";

/**
 * The floor is RELATIVE to the best hit, with an absolute backstop.
 *
 * Calibrated live (2026-08-27, the published film's own queries against real
 * DVIDS/NASA results): Gemini cosines compress into 0.45-0.65 — the on-story
 * hits ("AFOTEC AI Tech Showcase" 0.649, "Exercise Wolverine Cyber Warfare"
 * 0.626) and the junk that actually shipped ("Bring Your Lion Cub to Work
 * Day" 0.501, a birthday motion graphic 0.526) are separated by margin, not
 * by any absolute number a config could carry between topics. So: keep a
 * candidate within MARGIN of the best score, and never below the absolute
 * backstop.
 */
export const RELEVANCE_FLOOR = () => {
  const v = Number.parseFloat(process.env.LONGFORM_FOOTAGE_RELEVANCE || "");
  return Number.isFinite(v) ? v : 0.45;
};
export const RELEVANCE_MARGIN = () => {
  const v = Number.parseFloat(process.env.LONGFORM_FOOTAGE_RELEVANCE_MARGIN || "");
  return Number.isFinite(v) ? v : 0.10;
};

export function cosine(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? null : dot / d;
}

/** What of a candidate is worth embedding: its own words, not its url. */
export function candidateText(c = {}) {
  return [c.title, c.note].filter(Boolean).join(" — ").slice(0, 500);
}

/**
 * Build the relevance hook acquireFootage takes.
 *
 * @param {object} o
 * @param {(text:string) => Promise<number[]|null>} o.embed
 * @param {string} o.topicText   what the film is about — title + spine, not the whole corpus
 * @param {number} [o.floor]
 * @returns {(candidates:object[]) => Promise<{kept:object[], refused:object[]}>}
 */
export function makeRelevanceScreen({ embed, topicText, floor = RELEVANCE_FLOOR(), margin = RELEVANCE_MARGIN() } = {}) {
  if (!embed) throw new Error("makeRelevanceScreen: embed is required");
  if (!topicText?.trim()) throw new Error("makeRelevanceScreen: topicText is required");

  return async (candidates = []) => {
    const topicVec = await embed(topicText);
    if (!topicVec) {
      // UNMEASURED IS NOT A PASS — but it is also not this film's fault.
      // With no topic vector nothing can be scored, so nothing is refused
      // ON RELEVANCE; the honest report says the screen did not run.
      logger.warn("🎬 relevance screen: topic embedding unavailable — screen NOT applied (unmeasured, reported as such)");
      return { kept: candidates, refused: [], measured: false };
    }
    const scored = [], refused = [];
    for (const c of candidates) {
      const vec = await embed(candidateText(c));
      const score = vec ? cosine(topicVec, vec) : null;
      if (score === null) {
        // An unmeasurable candidate loses to measurable ones: it is refused
        // with the honest reason rather than passed on a guess.
        refused.push({ ...c, why: "relevance unmeasurable: candidate embedding unavailable" });
        continue;
      }
      scored.push({ ...c, relevance: score });
    }
    // The cut is decided AFTER every score exists — it depends on the best.
    const best = scored.reduce((m, c) => Math.max(m, c.relevance), 0);
    const cut = Math.max(floor, best - margin);
    const kept = [];
    for (const c of scored) {
      if (c.relevance < cut) {
        refused.push({ ...c, why: `relevance ${c.relevance.toFixed(2)} below cut ${cut.toFixed(2)} (best ${best.toFixed(2)} − margin ${margin}) — about something else` });
      } else kept.push(c);
    }
    // Most-relevant first: the acquirer downloads in this order, so the
    // want-N cap keeps the N most on-story clips, not the N newest.
    kept.sort((a, b) => b.relevance - a.relevance);
    return { kept, refused, measured: true };
  };
}
