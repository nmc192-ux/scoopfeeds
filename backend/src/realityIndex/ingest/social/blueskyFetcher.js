/**
 * blueskyFetcher — search Bluesky for posts mentioning a query.
 *
 * Uses the authenticated AppView via blueskyClient.searchBlueskyPosts
 * (the unauthenticated `public.api.bsky.app` path returns 403 as of late 2025).
 * If Bluesky credentials are missing, returns [] so the rest of the sentiment
 * cycle continues uninterrupted.
 */

import { normalizePost, SOCIAL_DEFAULTS } from "./baseSocialFetcher.js";
import { searchBlueskyPosts, isBlueskyConfigured } from "../../../services/blueskyClient.js";

export async function fetchMentions(query, { limit = SOCIAL_DEFAULTS.maxPerQuery } = {}) {
  if (!isBlueskyConfigured() || !query) return [];
  const posts = await searchBlueskyPosts(query, { limit });
  return posts.map(p => normalizePost({
    source:     "bluesky",
    text:       p.record?.text ?? "",
    ts:         p.record?.createdAt ? Date.parse(p.record.createdAt) : Date.now(),
    author:     p.author?.handle,
    url:        p.uri ? `https://bsky.app/profile/${p.author?.handle}/post/${p.uri.split("/").pop()}` : null,
    engagement: (p.likeCount ?? 0) + 2 * (p.repostCount ?? 0) + (p.replyCount ?? 0),
  }));
}
