/**
 * articleBodyPrepass.js — the SHARED article-body pre-pass for B.6.3c (infra only).
 *
 * The B.6.3c article-text judgments (2.2.a source attribution, 2.1.e news/opinion
 * separation, 2.3.d sourcing quality, …) all judge a sample of the source's recent
 * article BODIES. `articles.content` is RSS-summary-only (no body, no links), so the
 * bodies must be fetched live. To avoid N judgments × 5 fetches, the runner fetches
 * the ≤5 bodies ONCE per source (mirroring the discovery pre-pass) and hands the SAME
 * bodies to every article-body judgment via ctx.articleBodies.
 *
 * SCOPE (ratified): this pre-pass is for B.6.3c ONLY. It deliberately does NOT touch
 * bylineCrossCheck_2_1_c.js or primaryLinks_2_2_b.js — consolidating those two onto
 * this shared sample is a separate, later task. One openSite session per source.
 *
 * Honest-miss contract: a 404 / bot-block / empty body is a recorded miss
 * ({ ok:false, reason }), NEVER a throw. A failed fetch is data, not a crash — the
 * consuming judgment decides what a miss means for it.
 *
 * NO persistence: ctx-scoped sharing only (no bodies cache layer).
 */

import { getDb } from "../../../../models/database.js";
import { openSite } from "../siteFetch.js";
import { pageText } from "./pageText.js";

const DEFAULT_LIMIT = 5;

// NEW shared body-sample query — selects the metadata the judgments need alongside
// the URL. Distinct from byline/primaryLinks' url-only SAMPLE_SQL (left untouched).
const BODY_SAMPLE_SQL = `
  SELECT url, title, category, language
  FROM articles
  WHERE source_name = ? AND is_duplicate = 0 AND url IS NOT NULL
  ORDER BY published_at DESC
  LIMIT ?
`;

/**
 * ArticleBody = {
 *   url, finalUrl, language, category, title,
 *   text, truncated,            // from pageText (empty + truncated:false on a miss)
 *   ok,                         // true iff a non-empty body was fetched
 *   reason?                     // miss reason when ok:false
 * }
 *
 * fetchArticleBodies(source, ctx, { limit=5 }) → ArticleBody[]
 *   One openSite(source,{maxFetchesPerSource:limit}) session; ≤limit fetches total.
 *   Never throws.
 */
export async function fetchArticleBodies(source, ctx = {}, { limit = DEFAULT_LIMIT } = {}) {
  const db = ctx.db || getDb();
  const rows = db.prepare(BODY_SAMPLE_SQL).all(source.name, limit);
  if (rows.length === 0) return []; // source with no sampleable articles → clean empty

  // language is CARRIED ONLY here — passed through in the data shape, NOT fed to the
  // harness languageFactor. Verify ingest language detection before B.6.5 (carried item).
  const miss = (r, reason, finalUrl = null) => ({
    url: r.url, finalUrl, language: r.language, category: r.category, title: r.title,
    text: "", truncated: false, ok: false, reason,
  });

  const site = await openSite(source, { ...ctx, maxFetchesPerSource: limit });
  if (!site.ok) {
    // No editorial domain / site unreachable → every body is an honest miss (no fetch).
    return rows.map((r) => miss(r, site.reason || "site-unavailable"));
  }

  const bodies = [];
  for (const r of rows) {
    let res;
    try {
      res = await site.fetch(r.url);
    } catch (e) {
      bodies.push(miss(r, "fetch-error"));
      continue;
    }
    if (!res.ok) { bodies.push(miss(r, res.reason)); continue; } // 404 / bot-block / budget
    const { text, truncated } = pageText(res.doc);
    if (!text) { bodies.push(miss(r, "empty-body", res.finalUrl || r.url)); continue; }
    bodies.push({
      url: r.url,
      finalUrl: res.finalUrl || r.url,
      language: r.language, // carried only — see note above
      category: r.category,
      title: r.title,
      text,
      truncated,
      ok: true,
    });
  }
  return bodies;
}
