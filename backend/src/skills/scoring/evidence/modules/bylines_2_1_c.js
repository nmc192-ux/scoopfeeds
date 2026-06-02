/**
 * 2.1.c — Bylines on news content (Editorial track record / ET).
 *
 * Methodology §2.1.c: "Reporters are named on stories; pseudonymous or
 * unbylined news content is the exception, not the norm. (Graduated: never /
 * sometimes / usually / always.)"
 *
 * OWN-DB criterion (B.6.2a): computed from the articles table — the `author`
 * column is populated at ingestion. No external fetch. We sample the source's
 * N most-recent non-duplicate articles and compute the byline-presence ratio.
 *
 * ★ RSS-GAP HONESTY (Finding #99/#100) ★ — the byline signal is ASYMMETRIC:
 *   - A PRESENT byline is reliable POSITIVE evidence — when authors show up in
 *     the feed, the source demonstrably bylines. A high ratio → `evidenced`.
 *   - An ABSENT/low byline signal is UNKNOWN, NOT negative. Many RSS feeds
 *     simply omit <author>/<dc:creator> even though the published articles are
 *     bylined (the real-DB sanity check showed BBC/Al Jazeera/ARY at ratio 0 —
 *     they ARE bylined; their feeds drop the field). So a low ratio does NOT
 *     support a confident "never"/"sometimes" verdict. We downgrade it to
 *     `pending` with an `rss-metadata-gap` flag and ~0 confidence — it awaits a
 *     B.6.2b article-page cross-check that can read the on-page byline.
 *
 * Refusing to assert "unbylined" from a feed that merely omits the field IS
 * the honesty-of-derivation discipline.
 *
 * Join key: articles.source_name === sources.name.
 */

import { EVIDENCE_STATUS, round2 } from "../contract.js";

const SAMPLE_SQL = `
  SELECT author
  FROM articles
  WHERE source_name = ? AND is_duplicate = 0
  ORDER BY published_at DESC
  LIMIT ?
`;

// At/above this ratio, bylines are demonstrably the norm → trustworthy
// positive evidence. Below it, the absence is inconclusive from RSS alone.
const EVIDENCED_RATIO = 0.6;

export default {
  id: "2.1.c",
  component: "ET",
  ttlDays: 30, // byline policy is stable; monthly re-check is ample.

  gather(source, ctx) {
    const rows = ctx.db.prepare(SAMPLE_SQL).all(source.name, ctx.sampleSize);

    if (rows.length === 0) {
      return {
        status: EVIDENCE_STATUS.UNAVAILABLE,
        value: { reason: "no ingested articles for this source" },
        confidence: 0,
        evidenceUrl: null,
        gatheredAt: ctx.now,
      };
    }

    const bylined = rows.filter((r) => r.author != null && String(r.author).trim() !== "").length;
    const ratio = bylined / rows.length;

    // POSITIVE evidence: bylines are clearly the norm. Trustworthy.
    if (ratio >= EVIDENCED_RATIO) {
      const confidence = round2(Math.min(1, rows.length / ctx.sampleSize)); // sample completeness
      return {
        status: EVIDENCE_STATUS.EVIDENCED,
        value: {
          ratio: round2(ratio),
          bylined,
          sampled: rows.length,
          bucket: ratio >= 0.95 ? "always" : "usually",
        },
        confidence,
        evidenceUrl: null,
        gatheredAt: ctx.now,
      };
    }

    // INCONCLUSIVE: low/absent RSS byline is unknown, NOT a "never" verdict.
    // Pending a B.6.2b article-page byline cross-check. Confidence ~0.
    return {
      status: EVIDENCE_STATUS.PENDING,
      value: {
        ratio: round2(ratio),
        bylined,
        sampled: rows.length,
        bucket: "inconclusive",
        signal: "rss-metadata-gap",
        note: "Low/absent byline in RSS is not evidence of unbylined publishing; "
          + "many feeds omit the author field. Awaits B.6.2b article-page cross-check.",
      },
      confidence: 0,
      evidenceUrl: null,
      gatheredAt: ctx.now,
    };
  },
};
