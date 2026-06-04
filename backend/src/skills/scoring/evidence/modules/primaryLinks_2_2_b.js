/**
 * 2.2.b — Primary documents linked (Methodology transparency / MT), B.6.2d.
 *
 * Methodology §2.2.b: "When a story cites a study, a court filing, a dataset, or
 * a government document, the document is linked directly rather than only
 * summarized. (Graduated.)" — a high-signal differentiator (line 103).
 *
 * Spec §3.1 measure: sample N recent articles → per article, does it carry ≥1
 * primary-document link? → ratio = articles-with-≥1-primary-link / sampled. This
 * module computes that ratio over a budget-capped sample (≤5 article pages),
 * reusing the byline cross-check's fetch pattern (SAMPLE_SQL + openSite budget).
 *
 * ★ Honesty (Q1/Q2, ruled). ★ Classification is a DOMAIN HEURISTIC counting
 * Tier-1 (clear-primary) ONLY → no false-positives, but real false-negatives
 * (the Ars Technica probe). So the ratio is a CLEAR-PRIMARY LOWER BOUND
 * (basis:"clear-primary-domains-lower-bound" + primaryHostsSeen in the value),
 * and confidence is MODERATE (cap ~0.7), scaled by sample completeness —
 * deliberately overriding the spec's "high (ratio observable)" on honesty
 * grounds. A low/zero ratio means "few clearly-primary links observed," NOT
 * "doesn't cite primary sources."
 *
 *   fetched ≥1            → EVIDENCED (ratio + primaryHostsSeen + lower-bound note)
 *   all fetches failed    → BLOCKED  (couldn't sample; NOT a confident 0)
 *   no editorial domain   → UNAVAILABLE
 *   no articles in DB     → UNAVAILABLE (nothing to sample)
 *
 * Evidence-only (NEVER writes sources.quality_score). needsDiscovery:false
 * (fetches article URLs directly; no homepage discovery).
 *
 * KNOWN EDGE (Q5, deferred): an institutional source on a primary TLD (NASA →
 * nasa.gov) cites its OWN domain; own-domain links are excluded as internal, so
 * those self-citations don't count. Rare; the lower-bound framing partly covers
 * it. KNOWN EDGE (B.6.5): the aggregator domainResolver artifact (Hacker News →
 * garbage domain) will mis-sample for aggregators — deferred, not solved here.
 *
 * B.6.4 EFFICIENCY OPTIMIZATION (recorded, not done here): byline-xcheck (≤5) and
 * 2.2.b (≤5) each fetch article pages separately → up to 10/source. A shared
 * article-page pre-pass (fetch ≤5 once, run byline + link-classify on the same
 * docs) would halve that; deferred to the B.6.4 runtime wiring.
 */

import { EVIDENCE_STATUS, round2 } from "../contract.js";
import { openSite } from "../siteFetch.js";
import { extractBodyExternalLinks, isPrimaryHost } from "../primaryLinkClassify.js";

const DEFAULT_SAMPLE = 5;

const SAMPLE_SQL = `
  SELECT url FROM articles
  WHERE source_name = ? AND is_duplicate = 0 AND url IS NOT NULL
  ORDER BY published_at DESC
  LIMIT ?
`;

const BASIS = "clear-primary-domains-lower-bound";
const LOWER_BOUND_NOTE =
  "Counts only links to clearly-primary domains (gov/edu/mil/legal/intl cores, "
  + "DOI + preprint/repository hosts, and a curated journal/publisher allowlist). "
  + "A low/zero ratio means FEW CLEARLY-PRIMARY links were observed — NOT that the "
  + "source doesn't cite primary sources: the domain heuristic misses ambiguous "
  + "primary documents, so this ratio is a lower bound.";

function bucketFor(ratio) {
  if (ratio >= 0.6) return "frequent";
  if (ratio >= 0.3) return "sometimes";
  if (ratio > 0) return "rare";
  return "none-observed";
}

function evidence(status, value, confidence, evidenceUrl, now) {
  return { status, value, confidence: round2(confidence), evidenceUrl: evidenceUrl ?? null, gatheredAt: now };
}

export default {
  id: "2.2.b",
  component: "MT",
  ttlDays: 120, // linking habits change slowly; re-sample ~quarterly
  needsDiscovery: false,

  async gather(source, ctx) {
    const now = ctx.now;
    const db = ctx.db;
    const target = ctx.linkSampleSize ?? DEFAULT_SAMPLE;

    const rows = db.prepare(SAMPLE_SQL).all(source.name, target);
    if (rows.length === 0) {
      return evidence(EVIDENCE_STATUS.UNAVAILABLE, { reason: "no-articles", basis: BASIS }, 0, null, now);
    }

    const site = await openSite(source, { ...ctx, maxFetchesPerSource: target });
    if (!site.ok) {
      return evidence(EVIDENCE_STATUS.UNAVAILABLE, { reason: site.reason || "no-editorial-domain", basis: BASIS }, 0, null, now);
    }

    let fetched = 0;
    let articlesWithPrimary = 0;
    const primaryHostsSeen = new Set();
    let firstPrimaryUrl = null;

    for (const r of rows) {
      const res = await site.fetch(r.url);
      if (!res.ok) continue; // blocked/timeout/budget/robots — skip this page
      fetched += 1;
      const links = extractBodyExternalLinks(res.doc, res.finalUrl || r.url, site.registrable);
      const primary = links.filter((l) => isPrimaryHost(l.host));
      if (primary.length > 0) {
        articlesWithPrimary += 1;
        for (const p of primary) primaryHostsSeen.add(p.host);
        if (!firstPrimaryUrl) firstPrimaryUrl = res.finalUrl || r.url;
      }
    }

    // ALL fetches failed → couldn't sample; a fetch failure is NOT a confident 0.
    if (fetched === 0) {
      return evidence(EVIDENCE_STATUS.BLOCKED, { reason: "all-fetches-failed", basis: BASIS }, 0, null, now);
    }

    const ratio = round2(articlesWithPrimary / fetched);
    // MODERATE confidence (Q2): scaled by sample completeness, capped ~0.7 — the
    // measurement is observable but the classification is a lower bound.
    const confidence = round2(Math.min(0.7, 0.4 + 0.3 * (fetched / target)));

    return evidence(EVIDENCE_STATUS.EVIDENCED, {
      ratio,
      articlesWithPrimary,
      sampled: fetched,
      primaryHostsSeen: [...primaryHostsSeen],
      bucket: bucketFor(ratio),
      basis: BASIS,
      note: LOWER_BOUND_NOTE,
    }, confidence, firstPrimaryUrl, now);
  },
};
