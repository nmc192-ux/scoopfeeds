/**
 * siteFetch.js — the budgeted, robots-aware, SSRF-safe fetch primitive that
 * the B.6.2b detection modules (2.1.a/b, 2.2.e, 2.4.b, corrections, 2.1.c
 * byline cross-check) will call. B.6.2b-1 ships this foundation; the modules
 * build on it next.
 *
 * openSite(source, ctx) resolves the editorial domain, loads robots.txt once,
 * and returns a handle with a `fetch(pathOrUrl)` that:
 *   1. resolves the path against the editorial origin (or accepts an absolute URL),
 *   2. SSRF-guards it,
 *   3. checks robots.txt (disallow → not fetched),
 *   4. enforces the PER-SOURCE fetch budget (Q5),
 *   5. fetches via the substrate and returns a parsed linkedom doc.
 *
 * The primitive is policy-NEUTRAL: it returns discriminated results
 * ({ok:true,...} | {ok:false, reason}); each MODULE maps reasons to evidence
 * status per the honesty model (e.g. a guessed-path `not-found` → `pending`,
 * never a confident negative; `blocked`/`timeout` → `blocked`). Keeping the
 * honesty policy in the modules (not here) lets each criterion decide what an
 * absence means for it.
 *
 * Budget note: the one-time robots.txt fetch does NOT count against the
 * per-source page budget (it goes straight through the substrate, not via
 * site.fetch).
 */

import { fetchRaw, isSafeUrl, parseHtml, classifyError } from "./httpFetch.js";
import { loadRobots } from "./robots.js";
import { resolveEditorialDomain } from "./domainResolver.js";

const DEFAULT_BUDGET = 12;

export async function openSite(source, ctx = {}) {
  const domain = resolveEditorialDomain(source, ctx);

  if (!domain) {
    // No editorial domain (no article URLs) — honest: the whole site is
    // undiscoverable. Every fetch yields unavailable; modules → unavailable.
    return {
      ok: false,
      reason: "no-editorial-domain",
      origin: null,
      host: null,
      crawlDelay: null,
      robotsBasis: null,
      fetchesUsed: () => 0,
      budget: 0,
      async fetch() { return { ok: false, reason: "no-editorial-domain" }; },
    };
  }

  const robots = await loadRobots(domain.origin, ctx);
  const budget = ctx.maxFetchesPerSource ?? DEFAULT_BUDGET;
  let used = 0;

  function toUrl(pathOrUrl) {
    try {
      if (/^https?:\/\//i.test(pathOrUrl)) return new URL(pathOrUrl);
      return new URL(pathOrUrl, domain.origin + "/");
    } catch {
      return null;
    }
  }

  async function fetch(pathOrUrl) {
    const u = toUrl(pathOrUrl);
    if (!u) return { ok: false, reason: "bad-url" };
    const url = u.toString();

    if (!isSafeUrl(url)) return { ok: false, reason: "unsafe-url" };
    if (!robots.isAllowed(u.pathname)) return { ok: false, reason: "robots-disallow" };
    if (used >= budget) return { ok: false, reason: "budget-exhausted" };
    used += 1;

    try {
      const { status, body, finalUrl, contentType } = await fetchRaw(url, ctx);
      return { ok: true, httpStatus: status, finalUrl, contentType, html: body, doc: parseHtml(body) };
    } catch (err) {
      const c = classifyError(err);
      return { ok: false, reason: c.kind, httpStatus: c.status ?? null };
    }
  }

  return {
    ok: true,
    origin: domain.origin,
    host: domain.host,
    registrable: domain.registrable,
    basis: domain.basis,
    crawlDelay: robots.crawlDelay,
    robotsBasis: robots.basis,
    budget,
    fetchesUsed: () => used,
    fetch,
  };
}
