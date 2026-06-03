/**
 * confirmPage.js — STRICT page confirmation (B.6.2b-2a, Q6 + live-validation tuning).
 *
 * A 200 doesn't mean the candidate is really the page we sought (soft-404s,
 * redirects-to-home, generic pages). confirmPage decides whether a fetched page
 * genuinely IS a page of the requested type.
 *
 * STRICT (bias against false-positive `evidenced`): confirmed requires ALL of —
 *   (a) NO negative markers ("page not found" / "404" / "no longer available" …),
 *   (b) path PRESERVED (finalUrl didn't redirect to "/" or a no-shared-segment
 *       path — the soft-404 redirect tell), AND
 *   (c) a POSITIVE type keyword present — in title/h1/body OR in the URL SLUG.
 *
 * The URL-SLUG signal (live finding): the Guardian's real corrections page has
 * thin static body text but its path is /corrections-and-clarifications — the
 * slug itself is strong evidence. So a type keyword in the slug counts as a
 * positive signal. Keyword matching is word-boundary (the "ai" hazard applies
 * to the slug too — short tokens use a full word boundary so "ai" can't match
 * "airport"/"email"; longer tokens use a leading boundary so "correction"
 * matches the slug "corrections").
 *
 * Returns the full signal breakdown so B.6.2b-2b detectors can apply the Q1
 * hybrid (nav-found → evidenced even on a confirm-miss; convention-guess →
 * requires confirmed). The POLICY stays in 2b; 2a exposes the detail. Pure
 * function — doc + strings in, result out.
 */

import { round2 } from "./contract.js";

const NEGATIVE_MARKERS = Object.freeze([
  "page not found", "404", "no longer available",
  "doesn't exist", "does not exist", "can't be found", "cannot be found", "page you requested",
]);

const MAX_BODY_SCAN = 20_000;

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary keyword in free text — "\bai\b" matches "AI" not "email".
function bodyHasWord(haystack, keyword) {
  return new RegExp("\\b" + escapeRegex(String(keyword).toLowerCase()) + "\\b", "i").test(haystack);
}

// Slug keyword: short tokens (≤3, e.g. "ai") need a FULL boundary so "ai"
// doesn't hit "airport"; longer tokens use a LEADING boundary so "correction"
// matches the slug word "corrections" (plural/inflected forms).
function slugHasWord(slug, keyword) {
  const k = String(keyword).toLowerCase();
  const re = k.length <= 3
    ? new RegExp("\\b" + escapeRegex(k) + "\\b", "i")
    : new RegExp("\\b" + escapeRegex(k), "i");
  return re.test(slug);
}

function pathToSlug(pathname) {
  return String(pathname || "").toLowerCase().replace(/[/_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function checkPathPreserved(finalUrl, requestedPath) {
  let finalPath;
  try {
    finalPath = new URL(finalUrl).pathname.toLowerCase().replace(/\/+$/, "");
  } catch {
    return false;
  }
  if (finalPath === "") return false; // redirected to home root → soft-404 tell
  const reqSegs = String(requestedPath || "").toLowerCase().replace(/\/+$/, "").split("/").filter(Boolean);
  const finSegs = finalPath.split("/").filter(Boolean);
  if (reqSegs.length === 0) return finSegs.length > 0;
  return reqSegs.some((s) => finSegs.includes(s));
}

/**
 * confirmPage(doc, finalUrl, requestedPath, config)
 * @param config { confirmKeywords: string[] }
 * @returns { confirmed, signals:{negativeMarker, pathPreserved, positiveKeyword, slugSignal, positiveHits}, confidence }
 */
export function confirmPage(doc, finalUrl, requestedPath, config = {}) {
  const keywords = config.confirmKeywords || [];
  const title = (doc?.querySelector?.("title")?.textContent || "").toLowerCase();
  const h1 = (doc?.querySelector?.("h1")?.textContent || "").toLowerCase();
  const bodyText = (doc?.body?.textContent || "").toLowerCase().replace(/\s+/g, " ").slice(0, MAX_BODY_SCAN);
  const hay = `${title}\n${h1}\n${bodyText}`;

  // Slug from the FINAL url's path (falls back to requestedPath).
  let slug = "";
  try { slug = pathToSlug(new URL(finalUrl).pathname); } catch { slug = pathToSlug(requestedPath); }
  if (!slug) slug = pathToSlug(requestedPath);

  // (a) negative markers
  const negativeMarker = NEGATIVE_MARKERS.some((m) => title.includes(m) || h1.includes(m) || bodyText.includes(m));

  // (b) path preserved
  const pathPreserved = checkPathPreserved(finalUrl, requestedPath);

  // (c) positive keyword — body OR slug
  const bodyHits = keywords.filter((k) => bodyHasWord(hay, k));
  const slugHits = keywords.filter((k) => slugHasWord(slug, k));
  const slugSignal = slugHits.length > 0;
  const positiveKeyword = bodyHits.length > 0 || slugSignal;

  const confirmed = !negativeMarker && pathPreserved && positiveKeyword;
  const totalHits = bodyHits.length + slugHits.length;
  const confidence = confirmed ? round2(Math.min(1, 0.5 + 0.15 * totalHits)) : 0;

  return {
    confirmed,
    signals: {
      negativeMarker,
      pathPreserved,
      positiveKeyword,
      slugSignal,
      positiveHits: [...new Set([...bodyHits, ...slugHits])].slice(0, 6),
    },
    confidence,
  };
}
