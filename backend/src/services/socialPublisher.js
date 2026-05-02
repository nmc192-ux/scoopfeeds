// Per-platform auto-poster. Currently wired for Bluesky; the shape is
// designed so adding Threads / X / LinkedIn is a matter of dropping in a
// new adapter object.
//
// Each cycle picks one fresh, high-credibility article that hasn't been
// posted to that platform yet, composes the platform-specific caption,
// fetches the branded OG card as a thumbnail, and ships it. Result is
// recorded in social_posts so the same story never double-posts.
//
// Cadence guard: each adapter has a `minIntervalMs`. If the last successful
// post on that platform was more recent than that, this cycle is a no-op.

import {
  findFreshUnpostedArticles,
  recordSocialPost,
  lastPostAt,
} from "../models/database.js";
import { composeAllPlatforms } from "./socialComposer.js";
import { ensureCard } from "./cardRenderer.js";
import { isBlueskyConfigured, postToBluesky } from "./blueskyClient.js";
import { isThreadsConfigured, postToThreads } from "./threadsClient.js";
import { isFacebookConfigured, postToFacebook } from "./facebookClient.js";
import { isInstagramConfigured, postToInstagram } from "./instagramClient.js";
import { isLinkedinConfigured, postToLinkedin } from "./linkedinClient.js";
import { isPinterestConfigured, postToPinterest } from "./pinterestClient.js";
import { ensureIgSummary } from "./igSummaryService.js";
import { logger } from "./logger.js";

const SITE = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");

// ─── Editorial filter: skip programming-block / show-promo headlines ──────
//
// Some sources (Bloomberg, CNBC, BBC) syndicate a steady drumbeat of items
// for daily TV/radio segments — "The China Show 4/28/2026", "Bloomberg
// Daybreak: Asia 4/28", "Squawk Box: Closing Bell". These have all the
// shape of an article in the feed but they're recurring program slots, not
// news events. Posting them to social is a credibility hit (looks like
// noise), so we filter them at publish time.
//
// We ONLY filter at the social-post layer — they still get ingested into
// the article DB so the homepage / API surface them if someone really
// wants the live block. This is a "what we choose to amplify" filter, not
// a "what counts as news" filter.
const PROGRAMMING_BLOCK_PATTERNS = [
  // Date stamp anywhere in the title is the strongest signal. Real news
  // headlines almost never carry M/D/YYYY or D-M-YYYY in the title — only
  // recurring program slots do ("The China Show 4/28/2026").
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
  /\b\d{1,2}-\d{1,2}-\d{2,4}\b/,
  // Generic "The X Show" — a recurring named show, not a story.
  /^the [\w\s'.&-]{2,40} show\s*$/i,
  /^the [\w\s'.&-]{2,40} show\b.*\d/i,
  // Bloomberg / CNBC / BBC daily program prefixes (curated — these are
  // names of recurring shows, not stories about them).
  /^bloomberg\s+(daybreak|surveillance|the\s+open|the\s+close|markets|technology|wall\s+street(\s+week)?|asia|europe|americas|business\s*week|baystate|quicktake|live)\b/i,
  /^(squawk\s+box|squawk\s+on\s+the\s+street|squawk\s+alley|fast\s+money|mad\s+money|closing\s+bell|opening\s+bell|power\s+lunch|halftime\s+report)\b/i,
  /^bbc\s+(news|world|business)\s+(at|on)\s+(one|six|ten|the\s+hour)\b/i,
  // Vague live markers — "Watch live:" or "Live:" with only a few words is
  // almost always a stream block, not a story.
  /^(watch|listen)\s+live:?\s*$/i,
  /^live\s*:\s*[\w\s.,'-]{0,30}$/i,
  // Episode markers.
  /^episode\s+\d+\b/i,
  /\bepisode\s+\d+\s*[:|–-]/i,
  // "X (podcast)" / "X — Podcast" style.
  /\bpodcast\s*[:|–-]/i,
];

export function looksLikeProgrammingBlock(title) {
  if (!title || typeof title !== "string") return true; // empty title — always skip
  return PROGRAMMING_BLOCK_PATTERNS.some(re => re.test(title));
}

// One adapter per platform. `enabled()` returns whether the env is set up;
// `post()` returns { url, platformPostId } on success or throws.
const ADAPTERS = {
  bluesky: {
    name: "bluesky",
    minIntervalMs: 30 * 60 * 1000, // 30 min — we hover around 8-12 posts/day max
    composeKey: "bluesky", // matches socialComposer's platform key
    enabled: isBlueskyConfigured,
    async post(article, composed, thumbBuffer) {
      const externalUrl = `${SITE}/article/${encodeURIComponent(article.id)}?utm_source=social_bluesky&utm_medium=social&utm_campaign=scoop_auto`;
      const out = await postToBluesky({
        text: composed.caption,
        externalUrl,
        externalTitle: article.title,
        externalDescription: article.description || "",
        thumbBuffer,
      });
      return { url: out.url, platformPostId: out.uri };
    },
  },

  threads: {
    name: "threads",
    minIntervalMs: 60 * 60 * 1000, // 60 min — Threads engagement peaks at slower cadence
    composeKey: "threads", // matches socialComposer's platform key
    enabled: isThreadsConfigured,
    async post(article, composed) {
      // Threads ingests images by URL (no blob upload). Pass our /api/cards
      // endpoint so the post unfurls with the branded card.
      const imageUrl = `${SITE}/api/cards/og/${encodeURIComponent(article.id)}.png`;
      const out = await postToThreads({ text: composed.caption, imageUrl });
      return { url: out.url, platformPostId: out.id };
    },
  },

  facebook: {
    name: "facebook",
    minIntervalMs: 60 * 60 * 1000, // 60 min — Facebook algorithm rewards spacing over volume
    composeKey: "facebook",
    enabled: isFacebookConfigured,
    async post(article, composed, thumbBuffer) {
      // Photo post with branded OG card for maximum visual reach.
      // Pass the in-memory buffer (already rendered upstream by ensureCard)
      // so Facebook receives the bytes via multipart instead of fetching the
      // URL — eliminates the cold-cache + URL-fetcher race that was silently
      // dropping images and falling back to link posts.
      const imageUrl = `${SITE}/api/cards/og/${encodeURIComponent(article.id)}.png`;
      const articleUrl = `${SITE}/article/${encodeURIComponent(article.id)}?utm_source=social_facebook&utm_medium=social&utm_campaign=scoop_auto`;
      const out = await postToFacebook({
        text: composed.caption,
        imageBuffer: thumbBuffer || null,
        imageUrl,
        link: articleUrl,
      });
      return { url: out.url, platformPostId: out.id };
    },
  },

  instagram: {
    name: "instagram",
    // Instagram's algorithm penalises high-frequency feed posting hard. 4h
    // between posts gives us 4-6 posts/day max — well within the safe band
    // for Business accounts (Meta has flagged accounts pushing 8+/day as
    // spam in past algo updates).
    minIntervalMs: 4 * 60 * 60 * 1000,
    composeKey: "instagram_feed",
    enabled: isInstagramConfigured,
    async post(article, composed) {
      // Always use our branded square card (1080×1080) — NEVER the raw
      // article image_url. Raw news images: no text overlay, inconsistent
      // aspect ratios, blurry thumbnails, no Scoop branding. Our card gives
      // every post a consistent, professional look with headline text on the
      // image, category badge, description teaser, and scoopfeeds.com URL.
      //
      // Note: the square card is pre-rendered and served from our CDN path.
      // If Meta's crawler can't reach scoopfeeds.com, check that the WAF
      // allowlist includes Meta's IP ranges (see /scoop-ops/ig-discover for
      // diagnostics). In practice, Meta has no trouble reaching Hostinger VPS.
      const imageUrl = `${SITE}/api/cards/square/${encodeURIComponent(article.id)}.png`;
      // Alt text = headline, capped at 100 chars (IG requirement).
      const altText = String(article.title || "").slice(0, 100);
      const out = await postToInstagram({
        text: composed.caption,
        imageUrl,
        altText,
      });
      return { url: out.url, platformPostId: out.id };
    },
  },

  linkedin: {
    name: "linkedin",
    // LinkedIn algorithm favours analytical, longer posts; 2-3/day max.
    // B2B/professional audience — only post high-credibility stories.
    minIntervalMs: 4 * 60 * 60 * 1000, // 4 hours between posts
    composeKey: "linkedin",
    enabled: isLinkedinConfigured,
    async post(article, composed) {
      const articleUrl = `${SITE}/article/${encodeURIComponent(article.id)}?utm_source=social_linkedin&utm_medium=social&utm_campaign=scoop_auto`;
      // LinkedIn renders the OG thumbnail automatically via the link-card unfurl
      // (no binary upload needed — the /article/:id SSR page has OG tags).
      const out = await postToLinkedin({
        text: composed.caption,
        articleUrl,
        articleTitle: article.title,
        articleDescription: article.description || "",
      });
      return { url: out.url, platformPostId: out.id };
    },
  },

  pinterest: {
    name: "pinterest",
    // Pinterest rewards 4-6 pins/day with good spread. High-credibility,
    // image-rich articles get the best organic reach. Pins persist for years
    // so this is one of the few social actions with durable SEO value.
    minIntervalMs: 4 * 60 * 60 * 1000, // 4 hours between pins
    composeKey: "pinterest",
    enabled: isPinterestConfigured,
    async post(article, composed) {
      const imageUrl = `${SITE}/api/cards/og/${encodeURIComponent(article.id)}.png`;
      const articleUrl = `${SITE}/article/${encodeURIComponent(article.id)}?utm_source=social_pinterest&utm_medium=social&utm_campaign=scoop_auto`;
      const out = await postToPinterest({
        imageUrl,
        description: composed.caption,
        link: articleUrl,
        title: article.title,
      });
      return { url: out.url, platformPostId: out.id };
    },
  },
};

function adapterFor(platform) {
  const a = ADAPTERS[platform];
  if (!a) throw new Error(`unknown platform: ${platform}`);
  return a;
}

// Run one platform's cycle. Returns a result object describing what
// happened — never throws (safe to call from cron tail).
export async function runPlatformCycle(platform, { dryRun = false, minCredibility, withinMs } = {}) {
  const adapter = adapterFor(platform);

  if (!adapter.enabled()) {
    return { platform, posted: false, reason: "not_configured" };
  }

  const last = lastPostAt(platform);
  if (last && Date.now() - last < adapter.minIntervalMs && !dryRun) {
    return { platform, posted: false, reason: "cadence_guard", lastAt: last };
  }

  // Pull a few extra candidates (10 vs 1) so the editorial filter can drop
  // the "China Show 4/28" / "Bloomberg Daybreak"-style program blocks
  // without leaving the cycle empty-handed.
  const candidates = findFreshUnpostedArticles({
    platform,
    minCredibility: minCredibility ?? 7,
    withinMs: withinMs ?? 12 * 60 * 60 * 1000,
    limit: 10,
  });

  // Editorial filter: skip recurring programming/show blocks. These come
  // through ingestion as articles but reading them on social as if they
  // were news events looks like noise.
  let droppedAsBlock = 0;
  const newsworthy = candidates.filter(c => {
    if (looksLikeProgrammingBlock(c.title)) {
      droppedAsBlock += 1;
      return false;
    }
    return true;
  });

  const article = newsworthy[0];
  if (!article) {
    return {
      platform,
      posted: false,
      reason: candidates.length ? "all_filtered" : "no_candidate",
      droppedAsBlock,
    };
  }

  // For Instagram: generate (or retrieve cached) AI summary before composing
  // so composeInstagramFeed() picks it up as article.ig_summary.
  if (platform === "instagram") {
    try { await ensureIgSummary(article); }
    catch (err) { logger.warn(`socialPublisher: ig_summary generation failed for ${article.id}: ${err.message}`); }
  }

  let composed;
  try {
    const all = composeAllPlatforms(article);
    composed = all.platforms[adapter.composeKey];
    if (!composed) throw new Error(`composer missing platform: ${adapter.composeKey}`);
  } catch (err) {
    return { platform, posted: false, reason: "compose_failed", error: err.message };
  }

  let thumbBuffer = null;
  try { thumbBuffer = (await ensureCard(article, "og")).buffer; }
  catch (err) { logger.warn(`socialPublisher: card render failed for ${article.id}: ${err.message}`); }

  if (dryRun) {
    return {
      platform,
      posted: false,
      reason: "dry_run",
      article: { id: article.id, title: article.title, category: article.category },
      caption: composed.caption,
      thumbBytes: thumbBuffer ? thumbBuffer.length : 0,
    };
  }

  try {
    const result = await adapter.post(article, composed, thumbBuffer);
    recordSocialPost({
      articleId: article.id,
      platform,
      status: "posted",
      platformPostId: result.platformPostId,
      url: result.url,
      caption: composed.caption,
    });
    logger.info(`📣 ${platform} posted: "${article.title.slice(0, 60)}" → ${result.url || result.platformPostId}`);
    return { platform, posted: true, article: { id: article.id, title: article.title }, ...result };
  } catch (err) {
    recordSocialPost({
      articleId: article.id,
      platform,
      status: "failed",
      caption: composed.caption,
      error: String(err.message || err).slice(0, 500),
    });
    logger.error(`socialPublisher ${platform} post failed: ${err.message}`);
    return { platform, posted: false, reason: "post_failed", error: err.message };
  }
}

// Run all configured platforms in series. Used by the scheduler tail step.
export async function runAllPlatformsCycle(opts = {}) {
  const out = {};
  for (const platform of Object.keys(ADAPTERS)) {
    out[platform] = await runPlatformCycle(platform, opts);
  }
  return out;
}

export function listEnabledPlatforms() {
  return Object.entries(ADAPTERS)
    .filter(([, a]) => a.enabled())
    .map(([name]) => name);
}
