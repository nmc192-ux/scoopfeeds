/**
 * 2.5.b — Correction rate and severity (Historical accuracy / HA), B.6.3c-2b.
 *
 * A SINGLE-PAGE judgment — a sibling of 2.1.d, NOT an article-body judgment. It reads the
 * "corrections-presence" feeder, re-fetches the corrections page, and judges the SEVERITY
 * of the corrections LISTED there (cosmetic vs substantive). It does NOT use the article-
 * body pre-pass, the find-relevant factory, or the cross-article aggregator.
 *
 * Severity-ONLY (the rate is not computable): there is no corrected-flag and no
 * correction↔article linkage in the corpus, so "fraction of stories corrected" has no
 * denominator. The scale describes the MIX of the corrections listed on the page — the
 * prompt must NOT imply a rate over all stories.
 *
 * Honesty (mirrors 2.1.d exactly):
 *   feeder evidenced + found + evidence_url → re-fetch → judge severity
 *   feeder pending (page not located)       → PENDING (never lowest; couldn't-observe)
 *   feeder blocked / unavailable            → propagate
 *   re-fetch fails                          → BLOCKED (a fetch failure is not an absence)
 *
 * Evidence-only. needsDiscovery:false (re-fetches a known URL via the feeder). Language unfed.
 */

import { EVIDENCE_STATUS } from "../contract.js";
import { getEvidence } from "../evidenceCache.js";
import { openSite } from "../siteFetch.js";
import { pageText } from "../llm/pageText.js";
import { evaluateWithConfidence } from "../llm/judgmentHarness.js";

const FEEDER_ID = "corrections-presence";
const JUDGED_BASIS = "llm-multi-run-agreement";

// Severity of the listed corrections, low→high (worse track record → better).
const LEVELS = ["substantive errors common", "some substantive", "mixed", "mostly cosmetic"];

function evidence(status, value, confidence, evidenceUrl, now) {
  return { status, value, confidence, evidenceUrl: evidenceUrl ?? null, gatheredAt: now };
}

export default {
  id: "2.5.b",
  component: "HA",
  ttlDays: 180, // matches 2.1.d (LLM judgment is stable)
  needsDiscovery: false,

  async gather(source, ctx) {
    const now = ctx.now;
    const db = ctx.db;
    const feeder = getEvidence(source.id, FEEDER_ID, db);

    if (!feeder) {
      return evidence(EVIDENCE_STATUS.PENDING, { reason: "no-corrections-presence-row", basis: JUDGED_BASIS }, 0, null, now);
    }
    if (feeder.status === EVIDENCE_STATUS.BLOCKED || feeder.status === EVIDENCE_STATUS.UNAVAILABLE) {
      return evidence(feeder.status, { reason: `feeder-${feeder.status}`, basis: JUDGED_BASIS }, 0, null, now);
    }
    // Feeder PENDING (page not located) → PENDING, never lowest bucket.
    if (feeder.status !== EVIDENCE_STATUS.EVIDENCED || !feeder.value?.found || !feeder.evidence_url) {
      return evidence(EVIDENCE_STATUS.PENDING, {
        reason: "corrections-page-not-located",
        note: "Presence pending means the corrections page was not located — NOT that corrections lack severity.",
        basis: JUDGED_BASIS,
      }, 0, null, now);
    }

    const url = feeder.evidence_url;
    const site = await openSite(source, { ...ctx, maxFetchesPerSource: 1 });
    if (!site.ok) {
      return evidence(EVIDENCE_STATUS.BLOCKED, { reason: site.reason || "no-editorial-domain", url, basis: JUDGED_BASIS }, 0, url, now);
    }
    const res = await site.fetch(url);
    if (!res.ok) {
      return evidence(EVIDENCE_STATUS.BLOCKED, { reason: `refetch-${res.reason}`, url, basis: JUDGED_BASIS }, 0, url, now);
    }

    const { text, truncated } = pageText(res.doc);
    return evaluateWithConfidence({
      subCriterion: "2.5.b",
      input: { text, language: undefined, evidenceUrl: res.finalUrl || url, truncated },
      rubric: { levels: LEVELS },
      tier: "standard",
      ctx,
    });
  },
};
