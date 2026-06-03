/**
 * robots.js — hand-rolled robots.txt (common subset, no dependency).
 *
 * Supports the fields that matter for polite structure-scraping:
 *   User-agent, Disallow, Allow, Crawl-delay.
 * NOT the full spec (no wildcards `*`/`$` in paths, no Sitemap, no Host) — a
 * documented, conservative subset. Behavior is fail-OPEN by design: a missing,
 * empty, or unfetchable robots.txt → ALLOW (Q4 ruling). We never invent a
 * restriction the site didn't actually publish.
 *
 * UA matching: we present a browser User-Agent on fetches (to avoid blocks),
 * so we honor the catch-all `*` group (plus any group whose token matches our
 * configured robots UA). A browser UA is not named in robots files, so in
 * practice the `*` group applies — the honest, conservative reading.
 */

import { fetchRaw, isSafeUrl } from "./httpFetch.js";

const ALLOW_ALL = Object.freeze({
  isAllowed: () => true,
  crawlDelay: null,
  matchedAgents: [],
  basis: "default-allow",
});

/**
 * parseRobots(text, userAgent) → { isAllowed(path), crawlDelay, matchedAgents }.
 * Selects the most specific applicable group (named-token match, else `*`) and
 * applies longest-match Allow/Disallow within it.
 */
export function parseRobots(text, userAgent = "*") {
  const lines = String(text || "").split(/\r?\n/);
  const groups = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      // A user-agent line AFTER rules have begun starts a fresh group block;
      // consecutive user-agent lines (before any rule) share one group.
      if (current && current.started) current = null;
      if (!current) { current = { agents: [], rules: [], crawlDelay: null, started: false }; groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else if (current) {
      current.started = true;
      if (field === "disallow") current.rules.push({ type: "disallow", path: value });
      else if (field === "allow") current.rules.push({ type: "allow", path: value });
      else if (field === "crawl-delay") {
        const n = parseFloat(value);
        if (!Number.isNaN(n)) current.crawlDelay = n;
      }
    }
  }

  const ua = String(userAgent || "*").toLowerCase();
  let match = groups.find((g) => g.agents.some((a) => a !== "*" && (ua.includes(a) || a.includes(ua))));
  if (!match) match = groups.find((g) => g.agents.includes("*"));

  const rules = match ? match.rules : [];
  const crawlDelay = match ? match.crawlDelay : null;

  function isAllowed(path) {
    const p = path || "/";
    let decision = true;   // default allow
    let bestLen = -1;      // longest-match wins; Allow ties beat Disallow
    for (const r of rules) {
      if (!r.path) continue; // empty Disallow/Allow value → no constraint
      if (p.startsWith(r.path)) {
        if (r.path.length > bestLen || (r.path.length === bestLen && r.type === "allow")) {
          bestLen = r.path.length;
          decision = r.type === "allow";
        }
      }
    }
    return decision;
  }

  return { isAllowed, crawlDelay, matchedAgents: match ? match.agents : [] };
}

/**
 * loadRobots(origin, ctx) → robots rules for a site origin. Fetches
 * <origin>/robots.txt via the SSRF-guarded substrate; fail-OPEN (ALLOW_ALL) on
 * missing / empty / 4xx / unfetchable.
 */
export async function loadRobots(origin, ctx = {}) {
  if (!origin || !isSafeUrl(origin)) return ALLOW_ALL;
  try {
    const { status, body } = await fetchRaw(origin.replace(/\/+$/, "") + "/robots.txt", ctx);
    if (status >= 400 || !body || !String(body).trim()) return ALLOW_ALL;
    return { ...parseRobots(body, ctx.robotsUserAgent || "*"), basis: "robots.txt" };
  } catch {
    return ALLOW_ALL; // missing / unfetchable → default allow
  }
}
