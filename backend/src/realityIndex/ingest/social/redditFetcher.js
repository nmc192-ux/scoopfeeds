/**
 * redditFetcher — search Reddit's public JSON search endpoint.
 *
 * Unauthenticated, rate-limited (~60/min/IP). Sufficient for v1 since we
 * batch one query per active event in the cycle.
 *
 * Endpoint: https://www.reddit.com/search.json?q=...
 */

import { safeFetchJson, normalizePost, SOCIAL_DEFAULTS } from "./baseSocialFetcher.js";

const ENDPOINT = "https://www.reddit.com/search.json";

// Reddit aggressively 403s the default User-Agent; spoof a desktop-y string.
const UA = "scoopfeeds/1.0 (+https://scoopfeeds.com)";

export async function fetchMentions(query, { limit = SOCIAL_DEFAULTS.maxPerQuery, sort = "new" } = {}) {
  if (!query) return [];
  const params = new URLSearchParams({
    q:        query,
    limit:    String(Math.min(limit, 100)),
    sort,
    type:     "link",
    raw_json: "1",
  });
  const data = await safeFetchJson(`${ENDPOINT}?${params}`, {
    label:   "reddit",
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  const children = data?.data?.children;
  if (!Array.isArray(children)) return [];

  return children.map(({ data: p }) => normalizePost({
    source:     "reddit",
    text:       p.title + (p.selftext ? `\n\n${p.selftext}` : ""),
    ts:         (p.created_utc ?? Date.now() / 1000) * 1000,
    author:     p.author,
    url:        `https://reddit.com${p.permalink}`,
    engagement: (p.score ?? 0) + 2 * (p.num_comments ?? 0),
  }));
}
