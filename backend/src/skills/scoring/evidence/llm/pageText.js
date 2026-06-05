/**
 * pageText.js — extract LLM-judgment input text from a fetched page (B.6.3b).
 *
 * The judgment modules re-fetch ONE page (the corrections / funding page, via the
 * feeder row's evidenceUrl) and need its readable text for the harness. This is a
 * deliberately simple extractor (NOT @mozilla/readability): corrections/funding
 * pages are not articles, so main/article/body textContent is enough.
 *
 * Returns { text, truncated }. We take the TOP of the page and cap length; the
 * `truncated` flag is surfaced into the evidence value so a LOW judgment on a
 * truncated page is appropriately suspect (the disclosure/log might be below the
 * cut — Q5). Whitespace is collapsed so the grounding-quote substring check in
 * the harness matches the same normalization the model sees.
 */

const DEFAULT_CAP = 12000;

// Prefer the main content region; fall back to the whole body, then the doc.
const CONTENT_SELECTORS = ["main", "article", "[role='main']", "#content", ".content"];

export function pageText(doc, { cap = DEFAULT_CAP } = {}) {
  if (!doc) return { text: "", truncated: false };

  let root = null;
  for (const sel of CONTENT_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el && (el.textContent || "").trim().length > 0) { root = el; break; }
  }
  root = root || doc.body || doc;

  const raw = String(root.textContent || "").replace(/\s+/g, " ").trim();
  if (raw.length <= cap) return { text: raw, truncated: false };
  return { text: raw.slice(0, cap), truncated: true }; // top-of-page
}
