/**
 * videoSourceBundle.js — assemble SOURCE MATERIAL from an event's sibling
 * coverage, not just the one article that was selected.
 *
 * WHY. Measured 2026-08-02, in order:
 *   - four prompt framings gave beats 26, 6, 5, 5
 *   - three model tiers gave 5.0, 5.5, 6.5
 *   - full-text fetch gave 2.3x-2.9x more input, and beats tracked DENSITY
 *     rather than length: a DW piece at 14,579 chars was thin, a Guardian
 *     piece at 11,704 gave 7 beats. Wire updates are genuinely 4-beat stories.
 * So the ceiling is not the prompt, not the tier, and not the character count
 * of ONE article — it is how much that single article establishes. The Hungary
 * story had SIXTEEN sources in its event and used one of them. Sixteen outlets
 * covering one story do not each establish the same four facts; the union is
 * where the additional beats actually live.
 *
 * ATTRIBUTION IS THE WHOLE DESIGN. Every excerpt is labelled with the outlet
 * that published it, for two reasons that both break silently otherwise:
 *   1. GROUNDING — validateSpec screens figures against the source text it is
 *      handed. That text must be the same bytes the model saw, or every figure
 *      drawn from a sibling drops as ungrounded.
 *   2. THE sources CARD — Section 6 builds it from event_articles, and the
 *      outlets named there have to be the outlets that actually contributed.
 * The model is told, in the bundle itself, which outlet said what, so the
 * `source` field on a stat card has a correct answer available.
 *
 * ONE FETCH, TOTAL. The primary article gets on-demand full text
 * (videoFullText); siblings use their STORED content only. Fetching sixteen
 * URLs per video would be sixteen requests against sixteen publishers for one
 * upload, which is a different thing entirely from "one request per video".
 *
 * NOTHING IS STORED. Same discipline as videoFullText: assembled, used for one
 * spec call, discarded. No cache, no writes.
 */

import { logger } from "./logger.js";
import { getDb } from "../models/database.js";
import { resolveEventForArticle } from "../realityIndex/dal/eventsDao.js";
import { resolveVideoSourceText } from "./videoFullText.js";

// ~10k tokens of input at the pinned rate is $0.003 — negligible against a
// spec's output cost, and well inside every candidate model's context.
const MAX_BUNDLE_CHARS  = Number.parseInt(process.env.VIDEO_BUNDLE_MAX_CHARS || "40000", 10);
// Per-sibling ceiling so one long piece cannot eat the whole budget before the
// other outlets get a turn. Breadth is the point; depth is what the primary is for.
const MAX_SIBLING_CHARS = Number.parseInt(process.env.VIDEO_BUNDLE_SIBLING_CHARS || "2500", 10);
const MAX_SIBLINGS      = Number.parseInt(process.env.VIDEO_BUNDLE_MAX_SIBLINGS || "8", 10);

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Near-duplicate check. Wire copy is republished verbatim across outlets, and
 * ten copies of the same AP story would fill the budget while adding nothing —
 * the exact opposite of why siblings are being pulled in. Same shape as
 * videoGenerator.tooSimilar: content-word overlap, not exact match.
 */
function tooSimilar(candidate, seenWordSets) {
  const words = new Set(norm(candidate).split(" ").filter(w => w.length > 4));
  if (words.size === 0) return true;
  for (const seen of seenWordSets) {
    let overlap = 0;
    for (const w of words) if (seen.has(w)) overlap++;
    if (overlap >= Math.min(words.size, seen.size) * 0.6) return true;
  }
  return false;
}

/**
 * Sibling articles for an event, excluding the primary. Read-only, ordered by
 * credibility then recency so the budget is spent on the best coverage first.
 */
function siblingArticles(eventId, primaryId) {
  return getDb().prepare(`
    SELECT a.id, a.source_name, a.title, a.description, a.content, a.published_at
    FROM event_articles ea
    JOIN articles a ON a.id = ea.article_id
    WHERE ea.event_id = ?
      AND a.id <> ?
      AND a.source_name IS NOT NULL AND a.source_name <> ''
    ORDER BY a.credibility DESC, a.published_at DESC
  `).all(eventId, primaryId);
}

/**
 * Build the source bundle for one article.
 *
 * @returns {{ text, parts, totalChars, siblingCount, eventId, primaryOrigin }}
 *   `parts` is [{ outlet, chars, role }] — the provenance ledger, recorded in
 *   spec meta so a run can be audited for where its beats came from.
 *
 * Never throws. With no event linkage the bundle is just the primary article,
 * which is exactly the pre-existing behaviour.
 */
export async function buildSourceBundle(article, { includeSiblings = true } = {}) {
  const primary = await resolveVideoSourceText(article);
  const parts = [{ outlet: article.source_name || "unknown", chars: primary.chars, role: "primary" }];

  const header = (outlet, role) =>
    role === "primary"
      ? `PRIMARY SOURCE — ${outlet}:\n`
      : `ADDITIONAL COVERAGE — ${outlet}:\n`;

  let text = header(article.source_name || "unknown", "primary") + primary.text;
  let eventId = null, siblingCount = 0;

  if (!includeSiblings) {
    return { text, parts, totalChars: text.length, siblingCount: 0, eventId: null, primaryOrigin: primary.origin };
  }

  try {
    const event = resolveEventForArticle(article.id);
    if (!event) {
      return { text, parts, totalChars: text.length, siblingCount: 0, eventId: null, primaryOrigin: primary.origin };
    }
    eventId = event.id;

    const seen = [new Set(norm(primary.text).split(" ").filter(w => w.length > 4))];
    const usedOutlets = new Set([norm(article.source_name)]);

    for (const sib of siblingArticles(event.id, article.id)) {
      if (siblingCount >= MAX_SIBLINGS) break;
      if (text.length >= MAX_BUNDLE_CHARS) break;

      // One excerpt per outlet: a second piece from the same masthead is much
      // more likely to restate than to add.
      const outletKey = norm(sib.source_name);
      if (usedOutlets.has(outletKey)) continue;

      const body = String(sib.content || sib.description || "").trim();
      if (body.length < 300) continue;

      const excerpt = body.slice(0, MAX_SIBLING_CHARS);
      if (tooSimilar(excerpt, seen)) continue;

      const block = `\n\n${header(sib.source_name, "sibling")}${excerpt}`;
      if (text.length + block.length > MAX_BUNDLE_CHARS) break;

      text += block;
      seen.push(new Set(norm(excerpt).split(" ").filter(w => w.length > 4)));
      usedOutlets.add(outletKey);
      parts.push({ outlet: sib.source_name, chars: excerpt.length, role: "sibling" });
      siblingCount++;
    }

    if (siblingCount > 0) {
      logger.info(
        `📚 videoSourceBundle [${article.id}]: event ${event.slug || event.id} — ` +
        `${primary.chars} primary + ${siblingCount} sibling outlet(s) = ${text.length} chars ` +
        `(${parts.map(p => `${p.outlet}:${p.chars}`).join(", ")})`
      );
    }
  } catch (err) {
    // A bundle failure must never cost the video — fall back to the primary.
    logger.warn(`📚 videoSourceBundle [${article?.id}]: ${err.message} — primary article only`);
  }

  return { text, parts, totalChars: text.length, siblingCount, eventId, primaryOrigin: primary.origin };
}

export const _internals = { tooSimilar, MAX_BUNDLE_CHARS, MAX_SIBLING_CHARS, MAX_SIBLINGS };
