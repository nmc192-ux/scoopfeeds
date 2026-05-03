/**
 * hnFetcher — search Hacker News via the public Algolia index.
 *
 * No auth, generous rate limit, fast. Best signal for tech / finance / AI
 * stories; weaker for politics / sports.
 *
 * Endpoint: https://hn.algolia.com/api/v1/search_by_date?query=...
 */

import { safeFetchJson, normalizePost, SOCIAL_DEFAULTS } from "./baseSocialFetcher.js";

const ENDPOINT = "https://hn.algolia.com/api/v1/search_by_date";

export async function fetchMentions(query, { limit = SOCIAL_DEFAULTS.maxPerQuery } = {}) {
  if (!query) return [];
  const params = new URLSearchParams({
    query,
    tags:        "story,comment",
    hitsPerPage: String(Math.min(limit, 50)),
  });
  const data = await safeFetchJson(`${ENDPOINT}?${params}`, { label: "hn" });
  const hits = Array.isArray(data?.hits) ? data.hits : [];

  return hits.map(h => normalizePost({
    source:     "hn",
    text:       h.title || h.story_title || h.comment_text || "",
    ts:         (h.created_at_i ?? Date.now() / 1000) * 1000,
    author:     h.author,
    url:        h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    engagement: (h.points ?? 0) + (h.num_comments ?? 0),
  }));
}
