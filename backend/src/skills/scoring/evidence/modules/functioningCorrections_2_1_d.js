/**
 * 2.1.d — Functioning corrections process (Editorial track record / ET), B.6.3b.
 *
 * The FIRST real LLM-judgment module on the B.6.3a harness. It judges whether a
 * source's corrections process is FUNCTIONING (timely / transparent / proportional)
 * on the methodology's 4-step graduated scale, by re-fetching the corrections page
 * the deterministic feeder already located and applying evaluateWithConfidence.
 *
 * FEEDER: the "corrections-presence" row (correctionsPresence.js) — PRESENCE only.
 * This module CONSUMES it and writes its own "2.1.d" row (Q7: new id, normal module).
 * Registered AFTER correctionsPresence so the feeder row exists in-pass.
 *
 * ★ Q2 — the load-bearing honesty call. ★ Feeder PENDING means "we couldn't LOCATE
 * a corrections page," NOT "no corrections process exists" (absence-of-observation
 * ≠ absence-of-thing, #106). So feeder-pending → 2.1.d PENDING, NEVER the lowest
 * bucket. The lowest bucket ("no corrections process") is assignable ONLY in the
 * LOCUS case: a page WAS found but shows no functioning process (empty/stale/broken)
 * — and the prompt grounds that by quoting the locus (so it is NOT 0.4-penalized).
 *
 *   feeder evidenced + found + url → re-fetch → judge (harness) → return Evidence
 *   feeder pending                 → PENDING (couldn't locate the page; not lowest bucket)
 *   feeder blocked / unavailable   → propagate (NOT a confident negative)
 *   re-fetch fails                 → BLOCKED (a fetch failure is not an absence)
 *   LLM disabled / split runs      → harness returns pending-llm (no fabricated score)
 *
 * Evidence-only. needsDiscovery:false (re-fetches a known URL). language:undefined
 * → harness languageFactor 1.0 "unspecified" (no proxy; the non-English down-weight
 * is wired but not yet fed — a recorded B.6.3b limitation for B.6.5).
 */

import { EVIDENCE_STATUS } from "../contract.js";
import { getEvidence } from "../evidenceCache.js";
import { openSite } from "../siteFetch.js";
import { pageText } from "../llm/pageText.js";
import { evaluateWithConfidence } from "../llm/judgmentHarness.js";

const FEEDER_ID = "corrections-presence";
const JUDGED_BASIS = "llm-multi-run-agreement";

const LEVELS = [
  "no corrections process",
  "corrections issued but not transparent",
  "transparent corrections within reasonable timeframe",
  "public corrections log",
];

function evidence(status, value, confidence, evidenceUrl, now) {
  return { status, value, confidence, evidenceUrl: evidenceUrl ?? null, gatheredAt: now };
}

export default {
  id: "2.1.d",
  component: "ET",
  ttlDays: 180, // LLM judgment is stable; re-judge ~half-yearly
  needsDiscovery: false,

  async gather(source, ctx) {
    const now = ctx.now;
    const db = ctx.db;
    const feeder = getEvidence(source.id, FEEDER_ID, db);

    // No feeder row yet (presence not gathered this corpus) → nothing to judge.
    if (!feeder) {
      return evidence(EVIDENCE_STATUS.PENDING, { reason: "no-corrections-presence-row", basis: JUDGED_BASIS }, 0, null, now);
    }

    // Feeder blocked / unavailable → propagate honestly.
    if (feeder.status === EVIDENCE_STATUS.BLOCKED || feeder.status === EVIDENCE_STATUS.UNAVAILABLE) {
      return evidence(feeder.status, { reason: `feeder-${feeder.status}`, basis: JUDGED_BASIS }, 0, null, now);
    }

    // ★ Q2: feeder PENDING (page not located) → judgment PENDING, never lowest bucket.
    if (feeder.status !== EVIDENCE_STATUS.EVIDENCED || !feeder.value?.found || !feeder.evidence_url) {
      return evidence(EVIDENCE_STATUS.PENDING, {
        reason: "corrections-page-not-located",
        note: "Presence pending means the corrections page was not located — NOT that no corrections process exists.",
        basis: JUDGED_BASIS,
      }, 0, null, now);
    }

    // Re-fetch the located corrections page (one fetch; SSRF + robots + budget).
    const url = feeder.evidence_url;
    const site = await openSite(source, { ...ctx, maxFetchesPerSource: 1 });
    if (!site.ok) {
      return evidence(EVIDENCE_STATUS.BLOCKED, { reason: site.reason || "no-editorial-domain", url, basis: JUDGED_BASIS }, 0, url, now);
    }
    const res = await site.fetch(url);
    if (!res.ok) {
      // A fetch failure is NOT an absence of corrections — blocked, retry next run.
      return evidence(EVIDENCE_STATUS.BLOCKED, { reason: `refetch-${res.reason}`, url, basis: JUDGED_BASIS }, 0, url, now);
    }

    const { text, truncated } = pageText(res.doc);
    return evaluateWithConfidence({
      subCriterion: "2.1.d",
      input: { text, language: undefined, evidenceUrl: res.finalUrl || url, truncated },
      rubric: { levels: LEVELS },
      tier: "standard",
      ctx,
    });
  },
};
