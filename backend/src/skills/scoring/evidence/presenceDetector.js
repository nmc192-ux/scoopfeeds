/**
 * presenceDetector.js — makePresenceDetector(config) factory (B.6.2b-2b).
 *
 * ONE tested code path; the 5 site-structure sub-criteria are config objects
 * that parameterize it (Q4). Each returned module honors the evidence contract
 * {id, component, ttlDays, gather(source, ctx)→Evidence} and is flagged
 * needsDiscovery:true so the runner's discovery pre-pass builds {site,
 * discovery} once per source and injects it on ctx.
 *
 * Configs supply only { id, component, pageType, confirmKeywords, ttlDays? }.
 * navKeywords + conventionPaths + negativeMarkers are NOT duplicated here — they
 * live in the B.6.2b-2a primitives (pageDiscovery classifies nav links;
 * CONVENTION_PATHS supplies fallbacks; confirmPage owns the universal negative
 * markers). Single source of truth.
 *
 * ★ The Q1 nav-vs-guess ASYMMETRY (the subtle core) ★
 *   - NAV-ADVERTISED candidate (discovery found it in nav/footer) → EVIDENCED.
 *     A confirm-fetch (budget permitting) only sets the CONFIDENCE: confirmed →
 *     high; confirm-MISS (fetch failed, budget-exhausted, or confirmPage false
 *     on a thin landing page / link-rot) → STILL evidenced, LOW confidence +
 *     flag. The site advertising the page is its own claim = evidence; a
 *     nav-advertised candidate is NEVER demoted to pending.
 *   - CONVENTION-GUESSED candidate (no nav link; we try CONVENTION_PATHS) →
 *     REQUIRES strict confirmPage. Confirmed → evidenced (medium — our guess,
 *     verified). Unconfirmed → NOT evidenced (our hypothesis, unverified) →
 *     contributes to pending.
 *
 * Honesty model (absence ≠ negative): found (nav or confirmed guess) →
 * evidenced; not found anywhere → PENDING (couldn't locate, NEVER "no such
 * page"); site/homepage unreachable → blocked; no editorial domain →
 * unavailable. Evidence-only — never writes quality_score.
 */

import { confirmPage } from "./confirmPage.js";
import { CONVENTION_PATHS } from "./pageDiscovery.js";
import { EVIDENCE_STATUS, round2 } from "./contract.js";

const DEFAULT_TTL_DAYS = 120;            // structure evidence is stable
const DEFAULT_CONVENTION_ATTEMPTS = 3;   // cap guesses per detector

function pathOf(u) {
  try { return new URL(u).pathname; } catch { return u; }
}

export function makePresenceDetector(config) {
  const { id, component, pageType, confirmKeywords = [], ttlDays = DEFAULT_TTL_DAYS } = config;
  const conventionPaths = config.conventionPaths || CONVENTION_PATHS[pageType] || [];

  function evidence(status, value, confidence, evidenceUrl, now) {
    return { status, value, confidence: round2(confidence), evidenceUrl: evidenceUrl ?? null, gatheredAt: now };
  }

  async function gather(source, ctx) {
    const now = ctx.now;
    const disc = ctx.discovery;

    // Discovery didn't run / failed → honest blocked|unavailable (NOT negative).
    if (!disc) {
      return evidence(EVIDENCE_STATUS.BLOCKED, { found: false, reason: "discovery-not-run" }, 0, null, now);
    }
    if (!disc.ok) {
      const status = disc.reason === "no-editorial-domain" ? EVIDENCE_STATUS.UNAVAILABLE : EVIDENCE_STATUS.BLOCKED;
      return evidence(status, { found: false, reason: disc.reason }, 0, null, now);
    }

    const site = disc.site;
    const navCands = (disc.candidates?.[pageType] || []).filter((c) => c.source === "nav");

    // ── (b) NAV-ADVERTISED → EVIDENCED (never pending) ───────────────────────
    if (navCands.length > 0) {
      const cand = navCands[0];
      const res = await site.fetch(cand.url);
      let confirmed = false, confirmSignals = null, confConfidence = 0, fetchReason = null;
      if (res.ok) {
        // nav-advertised: the SITE chose this URL → its slug is real evidence.
        const c = confirmPage(res.doc, res.finalUrl, pathOf(cand.url), { confirmKeywords, allowSlug: true });
        confirmed = c.confirmed;
        confirmSignals = c.signals;
        confConfidence = c.confidence;
      } else {
        fetchReason = res.reason; // budget-exhausted / blocked / timeout — still evidenced (advertised)
      }
      const confidence = confirmed ? Math.max(0.7, confConfidence) : 0.4;
      return evidence(EVIDENCE_STATUS.EVIDENCED, {
        found: true,
        via: "nav",
        url: cand.url,
        linkText: cand.linkText,
        confirmed,
        confirmSignals,
        flag: confirmed ? null : "nav-advertised-unconfirmed",
        fetchReason,
      }, confidence, cand.url, now);
    }

    // ── (c) CONVENTION GUESS → requires strict confirmPage ───────────────────
    const attempts = [];
    const cap = ctx.maxConventionAttempts ?? DEFAULT_CONVENTION_ATTEMPTS;
    let hit = null;
    for (const path of conventionPaths.slice(0, cap)) {
      const res = await site.fetch(path);
      if (!res.ok) {
        attempts.push({ path, ok: false, reason: res.reason });
        if (res.reason === "budget-exhausted") break;
        continue;
      }
      // convention GUESS: WE constructed this path → the slug is circular;
      // require BODY confirmation (allowSlug:false).
      const c = confirmPage(res.doc, res.finalUrl, path, { confirmKeywords, allowSlug: false });
      attempts.push({ path, ok: true, confirmed: c.confirmed });
      if (c.confirmed) { hit = { finalUrl: res.finalUrl, confidence: c.confidence, signals: c.signals }; break; }
    }
    if (hit) {
      return evidence(EVIDENCE_STATUS.EVIDENCED, {
        found: true, via: "convention", url: hit.finalUrl, confirmed: true, confirmSignals: hit.signals, attempts,
      }, Math.min(0.8, hit.confidence), hit.finalUrl, now);
    }

    // ── (d) Nothing located → PENDING (couldn't find it, NEVER "no such page")
    return evidence(EVIDENCE_STATUS.PENDING, {
      found: false, via: null, attempts, note: "no nav candidate; convention guesses unconfirmed",
    }, 0, null, now);
  }

  return { id, component, ttlDays, needsDiscovery: true, pageType, gather };
}
