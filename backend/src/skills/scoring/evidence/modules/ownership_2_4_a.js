/**
 * 2.4.a — Ownership disclosed/known (Independence / Ind), via Wikidata (B.6.2c-2).
 *
 * Methodology §2.4.a: "Ownership structure is publicly KNOWN. For corporate-
 * owned: parent named. For state-affiliated: state body named. For non-profit:
 * funders named." → a transparency-with-capture signal: finding the owner (or a
 * structural type that IS the ownership answer) in public structured data = the
 * positive evidence.
 *
 * Builds on the B.6.2c-1 resolver (resolveOrgByDomain — host-equality + P279*
 * org/media type filter → single-match-or-pending, never wrong). Evidence-only;
 * the runner upserts. needsDiscovery:false (queries Wikidata, not the outlet site).
 *
 * Ruled mapping:
 *   resolved + owner (P127/P749)        → EVIDENCED (named owner/parent)
 *   resolved + structural type          → EVIDENCED (the type IS the ownership
 *     (nonprofit/public-broadcaster/…)    answer — "independent nonprofit" etc.)
 *   resolved + no owner + no structural → PENDING (knowable, not captured)
 *   ambiguous → OWNER-CONVERGENCE (below)
 *   no-entity → PENDING (honest; never confident-wrong)
 *   Wikidata unreachable/query-failed   → BLOCKED (retry next run, NOT absence)
 *   no editorial domain                 → UNAVAILABLE
 *
 * OWNER-CONVERGENCE (ruling b): when the entity is ambiguous (flagship outlets
 * like BBC/Guardian have several Wikidata entities on one domain), the OWNERSHIP
 * question can still be unambiguous. If ALL ambiguous candidates share the SAME
 * owner (P127) — or the same parent (P749) — report that owner: entity ambiguous,
 * ownership unanimous → EVIDENCED. GUARDRAIL: genuine unanimity ONLY — any
 * candidate with a null or differing owner breaks convergence (4-of-5 agree =
 * CONFLICT → pending). No majority / popularity / sitelink logic, ever.
 */

import { EVIDENCE_STATUS, round2 } from "../contract.js";
import { resolveEditorialDomain } from "../domainResolver.js";
import { resolveOrgByDomain } from "../wikidataClient.js";

// Entity types that themselves answer the ownership question (no P127 needed).
const STRUCTURAL_KEYWORDS = [
  "nonprofit", "non-profit", "public broadcast", "government", "state media",
  "state-owned", "state owned", "university", "foundation", "cooperative",
  "charit", "statutory corporation", "public corporation", "intergovernmental",
];

function structuralTypes(types) {
  return (types || []).filter((t) => {
    const lc = String(t).toLowerCase();
    return STRUCTURAL_KEYWORDS.some((k) => lc.includes(k));
  });
}

function wikiUrl(qid) {
  return qid ? `https://www.wikidata.org/wiki/${qid}` : null;
}

// Genuine unanimity: every candidate has the SAME non-null value for `field`.
// Any null or differing value → not converged (returns null).
function convergedValue(candidates, field) {
  if (!candidates || candidates.length === 0) return null;
  const first = candidates[0][field]?.qid ?? null;
  if (first == null) return null;
  return candidates.every((c) => c[field]?.qid === first) ? candidates[0][field] : null;
}

function evidence(status, value, confidence, evidenceUrl, now) {
  return { status, value, confidence: round2(confidence), evidenceUrl: evidenceUrl ?? null, gatheredAt: now };
}

export default {
  id: "2.4.a",
  component: "Ind",
  ttlDays: 270, // ownership rarely changes (~9 months)
  needsDiscovery: false,

  async gather(source, ctx) {
    const now = ctx.now;
    const d = resolveEditorialDomain(source, ctx);
    if (!d) {
      return evidence(EVIDENCE_STATUS.UNAVAILABLE, { reason: "no-editorial-domain", basis: "wikidata" }, 0, null, now);
    }

    const r = await resolveOrgByDomain(d.registrable, { ...ctx, sourceName: source.name });

    // Wikidata unreachable / query failed → blocked (retry next run; NOT a false absence).
    if (!r.resolved && typeof r.reason === "string" && r.reason.startsWith("query-failed")) {
      return evidence(EVIDENCE_STATUS.BLOCKED, { reason: r.reason, basis: "wikidata" }, 0, null, now);
    }

    if (r.resolved) {
      if (r.owner || r.parent) {
        return evidence(EVIDENCE_STATUS.EVIDENCED, {
          entity: r.entity, owner: r.owner, parent: r.parent, basis: "wikidata",
        }, 0.9, wikiUrl(r.entity.qid), now);
      }
      const struct = structuralTypes(r.types);
      if (struct.length > 0) {
        return evidence(EVIDENCE_STATUS.EVIDENCED, {
          entity: r.entity, owner: null, structuralType: struct, basis: "wikidata",
          note: "Ownership structure knowable from entity type (e.g. nonprofit / public broadcaster).",
        }, 0.85, wikiUrl(r.entity.qid), now);
      }
      // Resolved org, but no owner statement and no structural type → not captured.
      return evidence(EVIDENCE_STATUS.PENDING, {
        entity: r.entity, types: r.types, basis: "wikidata",
        note: "Entity resolved but no owner (P127/P749) and no structural type recorded.",
      }, 0, wikiUrl(r.entity.qid), now);
    }

    if (r.reason === "ambiguous") {
      const cands = r.candidates || [];
      const sharedOwner = convergedValue(cands, "owner");
      if (sharedOwner) {
        return evidence(EVIDENCE_STATUS.EVIDENCED, {
          ownershipBasis: "owner-convergence", entityAmbiguous: true, candidateCount: cands.length,
          resolvedOwner: sharedOwner, basis: "wikidata",
          note: "Entity ambiguous, but all candidates share the same owner — ownership unanimous.",
        }, 0.75, wikiUrl(sharedOwner.qid), now);
      }
      const sharedParent = convergedValue(cands, "parent");
      if (sharedParent) {
        return evidence(EVIDENCE_STATUS.EVIDENCED, {
          ownershipBasis: "parent-convergence", entityAmbiguous: true, candidateCount: cands.length,
          resolvedParent: sharedParent, basis: "wikidata",
          note: "Entity ambiguous, but all candidates share the same parent organization.",
        }, 0.75, wikiUrl(sharedParent.qid), now);
      }
      return evidence(EVIDENCE_STATUS.PENDING, {
        reason: "ambiguous-conflicting-owners", entityAmbiguous: true, candidateCount: cands.length,
        candidates: cands.map((c) => ({ qid: c.qid, label: c.label, owner: c.owner?.label ?? null })),
        basis: "wikidata",
      }, 0, null, now);
    }

    // no-entity (or any other unresolved reason) → pending.
    return evidence(EVIDENCE_STATUS.PENDING, { reason: r.reason || "no-entity", basis: "wikidata" }, 0, null, now);
  },
};
