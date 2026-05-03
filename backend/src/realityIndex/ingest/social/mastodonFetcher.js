/**
 * mastodonFetcher — search a Mastodon instance for status mentions.
 *
 * Uses the v2 search API: GET /api/v2/search?q=...&type=statuses
 * No auth required for public statuses on most instances. Default instance
 * is mastodon.social; override via MASTODON_INSTANCE.
 *
 * Note: Mastodon's API is per-instance — we hit one instance's federated
 * timeline. Good enough for a coarse signal; not exhaustive.
 */

import { safeFetchJson, normalizePost, SOCIAL_DEFAULTS } from "./baseSocialFetcher.js";

const INSTANCE = (process.env.MASTODON_INSTANCE || "https://mastodon.social").replace(/\/+$/, "");

export async function fetchMentions(query, { limit = SOCIAL_DEFAULTS.maxPerQuery } = {}) {
  if (!query) return [];
  const params = new URLSearchParams({
    q:     query,
    type:  "statuses",
    limit: String(Math.min(limit, 40)),
  });
  const url = `${INSTANCE}/api/v2/search?${params}`;
  const data = await safeFetchJson(url, { label: "mastodon" });
  const statuses = Array.isArray(data?.statuses) ? data.statuses : [];

  return statuses.map(s => normalizePost({
    source:     "mastodon",
    // Mastodon returns HTML; strip tags coarsely for sentiment input.
    text:       (s.content ?? "").replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/gi, " ").trim(),
    ts:         s.created_at ? Date.parse(s.created_at) : Date.now(),
    author:     s.account?.acct,
    url:        s.url,
    engagement: (s.favourites_count ?? 0) + 2 * (s.reblogs_count ?? 0) + (s.replies_count ?? 0),
  }));
}
