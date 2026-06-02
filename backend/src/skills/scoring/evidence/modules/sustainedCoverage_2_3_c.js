/**
 * 2.3.c — Sustained coverage over time (Domain expertise / DE).
 *
 * Methodology §2.3.c: "The source has covered the relevant beat continuously
 * for at least 12 months, not opportunistically following news cycles.
 * (Graduated.)"
 *
 * OWN-DB criterion (B.6.2a): computed from articles.published_at + category +
 * source_name. Picks the source's primary (most-published) category, counts
 * distinct calendar months with ≥1 article in that category, and measures
 * coverage continuity across the observed span.
 *
 * ★ HONESTY CAVEAT (Finding #99/#100) ★ — our articles table spans only OUR
 * ingestion window, NOT the source's full archive. "≥12 months sustained"
 * cannot be observed if we have only been ingesting for weeks. So a short
 * observation window CAPS confidence regardless of the computed continuity,
 * and the value carries `observationWindowLimited` so downstream (B.6.3 /
 * scoring) never mistakes "we only watched 3 weeks" for "the source only
 * covered 3 weeks." The measure is honest about what it can and cannot see.
 */

import { EVIDENCE_STATUS, round2 } from "../contract.js";

const ALL_SQL = `
  SELECT category, published_at
  FROM articles
  WHERE source_name = ? AND is_duplicate = 0
`;

const DAY_MS = 24 * 60 * 60 * 1000;

function yearMonth(ms) {
  return new Date(ms).toISOString().slice(0, 7); // YYYY-MM (UTC)
}

export default {
  id: "2.3.c",
  component: "DE",
  ttlDays: 30,

  gather(source, ctx) {
    const rows = ctx.db.prepare(ALL_SQL).all(source.name);

    if (rows.length === 0) {
      return {
        status: EVIDENCE_STATUS.UNAVAILABLE,
        value: { reason: "no ingested articles for this source" },
        confidence: 0,
        evidenceUrl: null,
        gatheredAt: ctx.now,
      };
    }

    // Primary category = the source's most-published category.
    const counts = new Map();
    let earliest = Infinity;
    let latest = -Infinity;
    for (const r of rows) {
      counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
      if (r.published_at < earliest) earliest = r.published_at;
      if (r.published_at > latest) latest = r.published_at;
    }
    let primaryCategory = null;
    let primaryCount = 0;
    for (const [cat, n] of counts) {
      if (n > primaryCount) { primaryCategory = cat; primaryCount = n; }
    }

    // Distinct months covered within the primary category.
    const months = new Set();
    for (const r of rows) {
      if (r.category === primaryCategory) months.add(yearMonth(r.published_at));
    }

    const observationWindowDays = Math.round((latest - earliest) / DAY_MS);
    const spanMonths = Math.max(1, Math.round(observationWindowDays / 30));
    const monthsCovered = months.size;
    const continuity = round2(Math.min(1, monthsCovered / spanMonths));

    // Confidence is bounded by BOTH our observation window (short window →
    // can't claim sustained coverage) AND volume in the primary category.
    const windowConfidence = Math.min(1, observationWindowDays / 365);
    const volumeConfidence = Math.min(1, primaryCount / ctx.sampleSize);
    const confidence = round2(Math.min(windowConfidence, volumeConfidence));

    return {
      status: EVIDENCE_STATUS.EVIDENCED,
      value: {
        primaryCategory,
        monthsCovered,
        spanMonths,
        continuity,
        observationWindowDays,
        articlesInPrimary: primaryCount,
        totalArticles: rows.length,
        meets12moInWindow: monthsCovered >= 12,
        observationWindowLimited: observationWindowDays < 365,
      },
      confidence,
      evidenceUrl: null,
      gatheredAt: ctx.now,
    };
  },
};
