/**
 * 2.2.d — Conflicts of interest disclosed (Methodology transparency / MT), B.6.3c-2b.
 *
 * A find-relevant judgment that DEPENDS on knowing who the source's owner is. It reads
 * the 2.4.a ownership evidence from the store (like 2.1.d reads corrections-presence) and
 * injects the owner/parent NAMES into each body's judgment so the model knows whose
 * conflicts to look for.
 *
 * ★ Pre-flight honesty (couldn't-know-the-conflict ≠ observed-no-disclosure). ★ If 2.4.a is
 * not evidenced with a NAMED owner/parent, we cannot define what a conflict even is →
 * return UNAVAILABLE "owner-unknown" IMMEDIATELY, no LLM, no judging. (A structural-type-only
 * 2.4.a — "nonprofit" with no named owner — is also owner-unknown for COI purposes.)
 *
 * Otherwise delegate to the c-2a makeFindRelevantJudgment UNCHANGED, via its buildInput hook
 * (owner-injection — no factory surgery). The gate then abstains to UNAVAILABLE
 * "no-relevant-article-in-sample" for the common, correct case where no sampled story
 * touches the owner; aggregates over the touching stories otherwise.
 *
 * Scope (honest, recorded): assessed = owner/parent COI + in-body named-writer affiliations;
 * NOT assessed = advertiser COI (2.4.a carries no advertisers — an out-of-scope gap).
 *
 * Article-body judgment (needsArticleBodies → shared pre-pass). Language unfed.
 */

import { EVIDENCE_STATUS } from "../contract.js";
import { getEvidence } from "../evidenceCache.js";
import { makeFindRelevantJudgment } from "../llm/findRelevantJudgment.js";

const OWNERSHIP_ID = "2.4.a";
const LEVELS = ["no disclosure", "vague", "disclosed", "prominently disclosed"];

// Scope annotation carried on every 2.2.d result (the honest advertiser gap).
const SCOPE = {
  assessedScope: "owner/parent COI + in-body named-writer affiliations",
  notAssessed: "advertiser COI (2.4.a carries no advertisers)",
};

// Extract a usable named owner/parent from a 2.4.a evidence row, or null.
function ownerFrom(row) {
  if (!row || row.status !== EVIDENCE_STATUS.EVIDENCED || !row.value) return null;
  const v = row.value;
  const owner = v.owner?.label || v.resolvedOwner?.label || null;
  const parent = v.parent?.label || v.resolvedParent?.label || null;
  if (!owner && !parent) return null; // structural-type-only / no named owner → unknown
  return { owner, parent };
}

export default {
  id: "2.2.d",
  component: "MT",
  ttlDays: 120,
  needsArticleBodies: true, // so the runner builds the shared ctx.articleBodies
  requiresCapableModel: true, // B.6.4a / #109 — runner guards against an unvalidated model

  async gather(source, ctx) {
    const now = ctx.now;

    // PRE-FLIGHT: we must know the owner before we can judge COI disclosure.
    const own = ownerFrom(getEvidence(source.id, OWNERSHIP_ID, ctx.db));
    if (!own) {
      return {
        status: EVIDENCE_STATUS.UNAVAILABLE,
        value: { reason: "owner-unknown", basis: "llm-multi-article-aggregate", ...SCOPE },
        confidence: 0,
        evidenceUrl: null,
        gatheredAt: now,
      };
    }

    // Owner known → delegate to the find-relevant factory, injecting owner context.
    const inner = makeFindRelevantJudgment({
      id: "2.2.d",
      component: "MT",
      levels: LEVELS,
      ttlDays: 120,
      buildInput: (b) => ({
        text: b.text,
        language: undefined, // unfed (carried item)
        evidenceUrl: b.finalUrl,
        truncated: b.truncated,
        ownerContext: own, // {owner, parent} — read by the gitignored 2.2.d prompt
      }),
    });

    const ev = await inner.gather(source, ctx);
    return { ...ev, value: { ...ev.value, owner: own.owner, parent: own.parent, ...SCOPE } };
  },
};
