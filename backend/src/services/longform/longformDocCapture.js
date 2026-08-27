/**
 * longformDocCapture.js — the sources, ON SCREEN (DrJ's review, 2026-08-27).
 *
 * Two review findings on the first published film share this fix. "Sources
 * are not clearly mentioned": attribution lived only in small on-card src
 * lines. "Should we not use footage from the actual articles?": their press
 * imagery, never — Reuters/AP/Getty license their footage to the page, not
 * to us, and press agencies are the most aggressive Content ID claimants
 * there are. But their CONTENT can appear legitimately: a screenshot of the
 * article with the exact quoted phrase highlighted is quotation, attributed
 * on screen, and the engine already renders it (doc cards over measured
 * DOM-Range rects — capture-measured.mjs).
 *
 * What was missing is the unattended derivation: which articles, which
 * phrase. That is mechanical:
 *
 *   WHICH ARTICLES — the corpus. Those are the articles the script was
 *   grounded in; showing any other page would cite something the film did
 *   not use.
 *
 *   WHICH PHRASE — the corpus sentence the script leans on hardest,
 *   measured by bigram overlap with the beats. The phrase then shortens to
 *   a single-text-node span, because capture-measured matches with a DOM
 *   Range built from ONE text node: a sentence crossing an inline <a> tag
 *   can never match, and a phrase that fails to match refuses that doc
 *   rather than shipping an unhighlighted screenshot.
 *
 * CHROMIUM IS NOT IN THE PRODUCTION IMAGE — capture-measured refuses loudly
 * when Playwright is absent, and this stage degrades HONESTLY: no docs keys,
 * a film without doc cards, and a log line saying why. It does not stub, and
 * it does not fake rects. (To change that decision see the note at the top
 * of capture-measured.mjs — it is a Dockerfile change, made deliberately or
 * not at all.)
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { logger } from "../logger.js";

/** How many source articles a film shows on screen. */
export const MAX_DOCS = 3;
/** A phrase must fit one text node and survive line-wrapping legibly. */
export const MAX_PHRASE_CHARS = 90;
const MIN_SENTENCE_CHARS = 60, MAX_SENTENCE_CHARS = 280;

const bigrams = (text) => {
  const w = String(text).toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((x) => x.length > 2);
  const out = new Set();
  for (let i = 0; i + 2 <= w.length; i++) out.add(`${w[i]} ${w[i + 1]}`);
  return out;
};

/**
 * The sentence of `text` the script leans on hardest — the one sharing the
 * most bigrams with any beat. Returns null when nothing overlaps: a doc card
 * for a source the script never used would cite decoration.
 */
export function pickDocSentence(text, beats = []) {
  const beatGrams = new Set();
  for (const b of beats) for (const g of bigrams(b?.text || "")) beatGrams.add(g);
  if (!beatGrams.size) return null;

  let best = null, bestScore = 0;
  for (const s of String(text).split(/(?<=[.!?])\s+/)) {
    const t = s.trim();
    if (t.length < MIN_SENTENCE_CHARS || t.length > MAX_SENTENCE_CHARS) continue;
    let score = 0;
    for (const g of bigrams(t)) if (beatGrams.has(g)) score++;
    if (score > bestScore) { best = t; bestScore = score; }
  }
  // One shared bigram is coincidence; the doc must show a sentence the
  // narration actually drew on.
  return bestScore >= 2 ? best : null;
}

/**
 * Shorten a sentence to a Range-matchable span: the longest run of words
 * within the char budget, cut at word boundaries, quotes and entities
 * avoided (extracted text and page text disagree exactly there).
 */
export function phraseSpan(sentence, max = MAX_PHRASE_CHARS) {
  // Quotes and entities are exactly where extracted text and page text
  // disagree (curly vs straight, &#8217; artifacts) — cut before the first
  // quote character whenever enough phrase remains to match on.
  const beforeQuote = String(sentence).split(/["'‘’“”]/)[0].trim();
  const base = beforeQuote.length >= 20 ? beforeQuote : String(sentence).replace(/["'‘’“”]/g, "").trim();
  if (base.length <= max) return base;
  const cut = base.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return (at > 40 ? cut.slice(0, at) : cut.slice(0, max)).trim();
}

/**
 * The per-film docs.json capture-measured reads, derived from the corpus.
 * Sources whose text the script never leaned on contribute nothing.
 */
export function buildDocsPlan({ corpus = [], beats = [] } = {}) {
  const plan = [];
  for (const c of corpus) {
    if (plan.length >= MAX_DOCS) break;
    if (!c?.url || !/^https?:/.test(c.url)) continue;
    const sentence = pickDocSentence(c.text || "", beats);
    if (!sentence) continue;
    const phrase = phraseSpan(sentence);
    const name = "DOC_" + String(c.source || "SRC").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20) + `_${plan.length + 1}`;
    plan.push({
      name,
      url: c.url,
      // The phrase IS the container needle: capture-measured walks up from
      // the element containing it until the frame is big enough, so the
      // highlight is inside the crop by construction.
      container: phrase,
      phrases: [phrase],
      pad: 46,
      // For the storyboard's docs table:
      eyebrow: (c.source || "SOURCE").toUpperCase(),
      src: `${c.source || "Source"} — ${c.title || c.url}`,
    });
  }
  return plan;
}

/**
 * The capture stage. Writes docs.json, runs the engine's capture, reads back
 * what ACTUALLY captured with highlight rects, and returns only that.
 *
 * @returns {Promise<{keys: string[], docs: object}>}  docs is the storyboard
 *   `docs` table ({KEY: {eyebrow, src}}); keys ⊆ plan names.
 */
export function makeCaptureDocs({ dir, runEngine }) {
  if (!dir || !runEngine) throw new Error("makeCaptureDocs: dir and runEngine are required");
  return async ({ topic, script } = {}) => {
    const corpus = topic?.sourceCorpus?.corpus || [];
    const plan = buildDocsPlan({ corpus, beats: script?.beats || [] });
    if (!plan.length) {
      logger.info("🎬 doc capture: no source sentence overlaps the script enough to show — no doc cards");
      return { keys: [], docs: {} };
    }
    writeFileSync(path.join(dir, "docs.json"), JSON.stringify(plan, null, 2));

    try {
      await runEngine("capture-measured.mjs", dir);
    } catch (e) {
      // Playwright absent (prod image, by decision) or the browser died.
      // Honest degrade: a film without doc cards, and the reason in the log.
      logger.warn(`🎬 doc capture: not available here — film ships without doc cards (${String(e.message).split("\n")[0].slice(0, 140)})`);
      return { keys: [], docs: {} };
    }

    const rectsPath = path.join(dir, "out/docs/rects.json");
    const rects = existsSync(rectsPath) ? JSON.parse(readFileSync(rectsPath, "utf8")) : {};
    const keys = [], docs = {};
    for (const d of plan) {
      const r = rects[d.name];
      const png = path.join(dir, `out/docs/${d.name}.png`);
      // A capture without highlight rects is the silent-no-highlight failure
      // the measured-rects design exists to prevent — refused, not shipped.
      if (!r?.rects?.length || !existsSync(png)) {
        logger.warn(`🎬 doc capture: ${d.name} captured without usable highlight — dropped`);
        continue;
      }
      keys.push(d.name);
      docs[d.name] = { eyebrow: d.eyebrow, src: d.src };
    }
    logger.info(`🎬 doc capture: ${keys.length} of ${plan.length} source page(s) captured with measured highlights`);
    return { keys, docs };
  };
}
