/**
 * domainResolver.js — resolve a source's EDITORIAL domain (B.6.2b-1, Q2).
 *
 * The sources table stores only the FEED url, which is often a feed-host that
 * is NOT the editorial site (BBC feed = feeds.bbci.co.uk, but articles live on
 * www.bbc.com; NPR feed = feeds.npr.org → www.npr.org). Page discovery needs
 * the editorial origin, so we derive it from the source's ARTICLE urls
 * (articles.url reliably carries the real domain) — the most-common hostname
 * across a recent sample, preferring non-feed-host hostnames.
 *
 * No public-suffix-list dependency: we return the modal HOSTNAME to fetch
 * (e.g. www.bbc.com) rather than computing a strict eTLD+1 — the hostname is
 * exactly what page discovery fetches. `registrable` (www-stripped) is provided
 * for display/grouping only.
 *
 * Returns null when the source has no article URLs (caller marks the source's
 * structure criteria unavailable — honest, rather than guessing from the
 * unreliable feed host).
 */

import { getDb } from "../../../models/database.js";

// Hostnames that are feed delivery infrastructure, not editorial sites.
const FEED_HOST = /^(feeds?|rss|feedproxy|feedburner|cdn)\./i;

const SAMPLE_SQL = `
  SELECT url FROM articles
  WHERE source_name = ? AND is_duplicate = 0 AND url IS NOT NULL
  ORDER BY published_at DESC
  LIMIT ?
`;

export function resolveEditorialDomain(source, ctx = {}) {
  const db = ctx.db || getDb();
  const limit = ctx.domainSampleSize ?? 10;
  const rows = db.prepare(SAMPLE_SQL).all(source.name, limit);
  if (rows.length === 0) return null;

  const tally = new Map();
  for (const r of rows) {
    let host;
    try { host = new URL(r.url).hostname.toLowerCase(); } catch { continue; }
    if (host) tally.set(host, (tally.get(host) ?? 0) + 1);
  }
  if (tally.size === 0) return null;

  const entries = [...tally.entries()];
  // Prefer non-feed-host hostnames; only fall back to feed-hosts if nothing else.
  const nonFeed = entries.filter(([h]) => !FEED_HOST.test(h));
  const pool = (nonFeed.length ? nonFeed : entries).sort((a, b) => b[1] - a[1]);
  const host = pool[0][0];

  return {
    host,
    origin: `https://${host}`,
    registrable: host.replace(/^www\./, ""),
    basis: "articles",
    sampleSize: rows.length,
    distinctHosts: tally.size,
  };
}
