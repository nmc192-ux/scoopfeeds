/**
 * 2.4.b judgment — Funding mix transparent (Independence / Ind), B.6.3b.
 *
 * UPGRADES the "2.4.b" presence row IN PLACE (Q7 / Q3) — the byline-cross-check
 * pattern: this module's own scheduler id is "2.4.b-judgment" (so the runner can
 * schedule it), but it READS the "2.4.b" presence row, judges the graduated level,
 * and upserts "2.4.b" directly, returning null (a no-op sentinel — no own row).
 * Because it never writes a "2.4.b-judgment" row, the runner re-runs it every pass;
 * its cheap guard (one cache read) decides whether to act.
 *
 * Lifecycle / guard:
 *   "2.4.b" not evidenced-presence (pending / blocked / unavailable / missing)
 *                                   → NO-OP (Q2: never judge "opaque" from a page we
 *                                     couldn't locate — presence-pending ≠ no funding info)
 *   "2.4.b" already judged (value.basis === llm-multi-run-agreement)
 *                                   → NO-OP (don't re-judge; presence refresh at its own
 *                                     ttl resets basis → re-judge then)
 *   evidenced presence, not judged  → re-fetch the funding page → judge:
 *     majority + grounded           → upsert "2.4.b" in place (the graduated bucket)
 *     genuine split / tie           → upsert pending-llm WITH presenceConfirmed:true
 *                                     (status downgrades, but the upstream FACT that the
 *                                     funding page EXISTS is preserved → founder review)
 *     re-fetch fail / LLM disabled / no committed runs / empty page
 *                                   → NO-OP (KEEP the presence row; do NOT downgrade on
 *                                     an infra/transient failure)
 *
 * Evidence-only. needsDiscovery:false. language:undefined → harness factor 1.0
 * "unspecified" (no region proxy; non-English down-weight wired, data not — a
 * recorded B.6.3b limitation for B.6.5).
 */

import { EVIDENCE_STATUS } from "../contract.js";
import { getEvidence, upsertEvidence } from "../evidenceCache.js";
import { openSite } from "../siteFetch.js";
import { pageText } from "../llm/pageText.js";
import { evaluateWithConfidence } from "../llm/judgmentHarness.js";

const TARGET_ID = "2.4.b";
const JUDGED_BASIS = "llm-multi-run-agreement";
// Infra/transient pending-llm reasons → keep presence, retry. (A GENUINE split
// — runs-disagree / runs-tie — is a real unresolved judgment and DOES overwrite.)
const INFRA_REASONS = new Set(["llm-disabled", "no-committed-runs"]);

const LEVELS = [
  "opaque",
  "disclosed in aggregate",
  "disclosed by category",
  "disclosed by named funder",
];

export default {
  id: "2.4.b-judgment",
  component: "Ind",
  ttlDays: 180, // moot in practice (returns null → no own row → re-runs each pass)
  needsDiscovery: false,

  async gather(source, ctx) {
    const db = ctx.db;
    const cur = getEvidence(source.id, TARGET_ID, db);

    // Guard — only act on an evidenced-presence row that is NOT yet judged.
    if (!cur || cur.status !== EVIDENCE_STATUS.EVIDENCED || !cur.value?.found || !cur.evidence_url) return null; // Q2
    if (cur.value?.basis === JUDGED_BASIS) return null; // already judged

    // Re-fetch the located funding page (one fetch). Failure → keep presence (no-op).
    const url = cur.evidence_url;
    const site = await openSite(source, { ...ctx, maxFetchesPerSource: 1 });
    if (!site.ok) return null;
    const res = await site.fetch(url);
    if (!res.ok) return null; // re-fetch fail → no-op, keep presence

    const { text, truncated } = pageText(res.doc);
    const judged = await evaluateWithConfidence({
      subCriterion: TARGET_ID,
      input: { text, language: undefined, evidenceUrl: res.finalUrl || url, truncated },
      rubric: { levels: LEVELS },
      tier: "standard",
      ctx,
    });

    // Empty page / infra-pending → keep presence (don't downgrade on a transient failure).
    if (judged.status === EVIDENCE_STATUS.UNAVAILABLE) return null;
    if (judged.status === EVIDENCE_STATUS.PENDING_LLM && INFRA_REASONS.has(judged.value?.reason)) return null;

    // Evidenced (the graduated bucket) OR a genuine split (unresolved → founder):
    // upgrade "2.4.b" in place, preserving the upstream fact that the page exists.
    const upgraded = { ...judged, value: { ...judged.value, presenceConfirmed: true } };
    upsertEvidence(source.id, TARGET_ID, upgraded, ctx.methodologyVersion, db);
    return null; // wrote "2.4.b" directly; no separate row
  },
};
