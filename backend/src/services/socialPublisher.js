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

import axios from "axios";
import {
  findFreshUnpostedArticles,
  recordSocialPost,
  lastPostAt,
  isEventRetiredForPlatform,
  recordHeartbeat,
  getHeartbeatRow,
} from "../models/database.js";
import { composeAllPlatforms } from "./socialComposer.js";
import { ensureCard, ensureEventCard } from "./cardRenderer.js";
import { resolveEventForArticle, qualifiesForCarousel, listQualifyingEvents, leadArticleForEvent } from "../realityIndex/dal/eventsDao.js";
import { ensureEventCarouselCopy } from "../realityIndex/generation/eventCarouselCopy.js";
import { isBlueskyConfigured, postToBluesky } from "./blueskyClient.js";
import { isThreadsConfigured, postToThreads } from "./threadsClient.js";
import { isFacebookConfigured, postToFacebook } from "./facebookClient.js";
import { isInstagramConfigured, postToInstagram, postCarouselToInstagram } from "./instagramClient.js";
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

// ─── Event carousel (7 slides) ────────────────────────────────────────────
//
// Dark-shipped behind IG_CAROUSEL_MODE (default "article" = today's exact
// behaviour). When "event", the IG adapter tries to upgrade the post from the
// 3-slide ARTICLE carousel to the 7-slide EVENT dossier.
//
// Every step is allowed to say no, and a no is not an error — it falls back to
// the article carousel, which is the common path by design: most IG-eligible
// articles have no parent event at all.
const EVENT_CAROUSEL_SLIDES = 7;

// Event-FIRST selection. The original flow selected a fresh article and then
// tried to resolve its parent event — structurally dead on arrival: IG picks
// FRESH articles (<12h old) while the event bar needs MATURE events (>=8
// sources, >=5 articles, coherent core). Opposite ends of a story's
// lifecycle, so the degrade path fired every cycle and article-carousel(3)
// was the only thing that ever posted. Inverted: pick the most recent
// QUALIFYING event not yet posted here, then derive its lead article for
// social_posts.article_id and the caption.
export function pickEventFirstForInstagram() {
  const events = listQualifyingEvents({});   // recency-ordered, coherence-gated
  for (const e of events) {
    if (isEventRetiredForPlatform(e.id, "instagram")) continue;
    const lead = leadArticleForEvent(e.id, { notPostedTo: "instagram" });
    if (!lead) {
      logger.info(`🎠 event ${e.slug} skipped: every member article already posted to instagram`);
      continue;
    }
    return { event: e, article: lead };
  }
  return null;
}

async function tryBuildEventCarousel(article, preEvent = null) {
  if ((process.env.IG_CAROUSEL_MODE || "article").toLowerCase() !== "event") return null;

  // carousel4-7 have no legacy design, so the event deck simply cannot be
  // rendered under the legacy style. Explicit guard rather than a confusing
  // render failure seven slides deep.
  if ((process.env.CARD_STYLE || "").toLowerCase() !== "scoopfeeds") {
    logger.warn("🎠 IG_CAROUSEL_MODE=event but CARD_STYLE is not scoopfeeds — using the 3-slide article carousel");
    return null;
  }

  // preEvent comes from event-first selection and is authoritative — the lead
  // article may belong to several events, and re-resolving could land on a
  // DIFFERENT parent than the one that was selected and dedupe-checked.
  const event = preEvent || resolveEventForArticle(article.id);
  if (!event) return null;                    // common case, not worth a log line

  const q = qualifiesForCarousel(event.id);
  if (!q.ok) {
    logger.info(`🎠 event ${event.slug} not carousel-worthy: ${q.reason} (${q.coverage.sources} sources, ${q.coherence.nKeys} core keys)`);
    return null;
  }

  // The only paid step. Cached per event, so a re-post attempt or a retry does
  // not re-call the model.
  const copy = await ensureEventCarouselCopy(event.id);
  if (!copy) return null;                     // generator already logged the reason

  const ctx = { event: q.event, coverage: q.coverage, copy };

  // Pre-render all 7 so Meta's fetcher hits warm PNGs. A cold render mid-album
  // is how carousels fail: Meta gives each child container a short window, and
  // seven cold satori renders will not finish inside it.
  try {
    await Promise.all(
      Array.from({ length: EVENT_CAROUSEL_SLIDES }, (_, i) => ensureEventCard(ctx, `carousel${i + 1}`))
    );
  } catch (err) {
    logger.warn(`🎠 event card pre-render failed for ${event.slug}: ${err.message} — falling back to article carousel`);
    return null;
  }

  const slug = encodeURIComponent(event.slug);
  return {
    eventId: event.id,
    eventSlug: event.slug,
    // Carried out so the caption can be rebuilt from the SAME copy object that
    // rendered the slides. The caption is composed from the LEAD ARTICLE up in
    // runPlatformCycle, before this function has run — and it must be, because
    // generating copy is the paid step and only happens for the event actually
    // being posted. So an event's seo_line cannot be known at compose time;
    // without this the event path would silently fall back to a line derived
    // from the lead article's title, and Commit 3 would never be visible.
    seoLine: copy.seo_line || "",
    imageUrls: Array.from({ length: EVENT_CAROUSEL_SLIDES }, (_, i) => `${SITE}/api/cards/carousel${i + 1}/event/${slug}.png`),
    altTexts: [
      String(event.title || "").slice(0, 100),
      "What happened",
      `${q.coverage.articles} articles from ${q.coverage.sources} sources`.slice(0, 100),
      "The details",
      "The numbers",
      "Why it matters",
      "Read the full story at scoopfeeds.com",
    ],
  };
}

// ─── IG pre-publish self-check ────────────────────────────────────────────
//
// Fetch every card URL from the PUBLIC internet before handing it to Meta.
// Meta's image fetcher reports any non-image response as an opaque
// "400 Invalid parameter" on the media container, which is undiagnosable from
// our side — a 404 from an old web build, a 422 "event card not ready", and a
// render 500 all look identical in Meta's error. Checking ourselves turns
// each of those into a loud, specific log line BEFORE anything is submitted.
// Returns [] when all URLs are good, else one {url, status, contentType,
// bodySnippet} per failure.
export async function verifyCardUrls(urls) {
  const failures = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) });
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || !contentType.startsWith("image/png")) {
        let bodySnippet = "";
        try { bodySnippet = (await res.text()).slice(0, 120); } catch { /* stream may be gone */ }
        failures.push({ url, status: res.status, contentType, bodySnippet });
      } else {
        // Drain so the socket is released cleanly.
        await res.arrayBuffer();
      }
    } catch (err) {
      failures.push({ url, status: 0, contentType: "", bodySnippet: String(err?.message || err).slice(0, 120) });
    }
  }
  return failures;
}

// One log line per IG submission attempt — style, presets, subject id and the
// EXACT URLs handed to Meta — so a failed cycle is reconstructable from logs
// alone instead of from guesses about which path ran.
function logIgAttempt({ style, kind, subjectId, imageUrls }) {
  logger.info(`📸 IG attempt: style=${style} kind=${kind} subject=${subjectId} urls=${JSON.stringify(imageUrls)}`);
}

// Meta's useful detail lives in err.body (the Graph API error object), which
// err.message truncates to "400 Invalid parameter". Always log the whole body.
function logIgFailure(kind, err) {
  logger.error(`📸 IG ${kind} FAILED: ${err?.message || err} | meta_error=${JSON.stringify(err?.body ?? null)}`);
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
    // spam in past algo updates). IG_MIN_INTERVAL_MS overrides without a
    // deploy (e.g. 7200000 for the planned 2h cadence).
    minIntervalMs: Number.parseInt(process.env.IG_MIN_INTERVAL_MS || "", 10) || 4 * 60 * 60 * 1000,
    composeKey: "instagram_feed",
    enabled: isInstagramConfigured,
    async post(article, composed, _thumbBuffer, extras = {}) {
      // Post style is controlled by IG_POST_STYLE env var:
      //   "carousel" (default) — 3-slide carousel (cover → key points → CTA).
      //                          Highest save-rate, but requires the CAROUSEL
      //                          API path which has stricter rate limits.
      //   "single"             — single branded square card (reliable, was original).
      //   "auto"               — tries carousel, falls back to single if it throws.
      //
      // Meta's carousel API is more fragile than single-image: the 4-step
      // child-container → wait-FINISHED → parent-container → publish dance can fail
      // if any container takes too long or the children param is mis-formed.
      // Setting IG_POST_STYLE=auto makes the adapter self-heal.
      const style = (process.env.IG_POST_STYLE || "auto").toLowerCase();
      const baseId = encodeURIComponent(article.id);

      const squareUrl = `${SITE}/api/cards/square/${baseId}.png`;
      const singleAlt = String(article.title || "").slice(0, 100);

      // Event upgrade: 7-slide dossier when this article has a qualifying
      // parent event AND its copy generated AND all 7 cards rendered AND all
      // 7 URLs verify publicly. Any no falls through to the 3-slide article
      // carousel below — loudly, never silently.
      const evt = await tryBuildEventCarousel(article, extras.event || null);
      if (evt) {
        const bad = await verifyCardUrls(evt.imageUrls);
        if (bad.length) {
          logger.error(`📸 IG event-carousel REFUSED pre-publish: ${bad.length}/7 card URLs failed self-check for "${evt.eventSlug}": ${JSON.stringify(bad)} — falling back to article carousel`);
        } else {
          // Rebuild the caption with the EVENT's seo_line now that copy exists.
          // Only the seo_line differs; every other block is article-derived
          // exactly as before. Under IG_CAPTION_V2=off this is a no-op — V1
          // ignores opts entirely — so the flag stays byte-identical.
          let text = composed.caption;
          if (evt.seoLine) {
            try {
              const re = composeAllPlatforms(article, { seoLine: evt.seoLine });
              text = re.platforms.instagram_feed.caption;
            } catch (err) {
              logger.warn(`📸 caption rebuild with event seo_line failed (${err.message}) — posting the article-derived caption`);
            }
          }
          logIgAttempt({ style, kind: "event-carousel(7)", subjectId: `event:${evt.eventId}`, imageUrls: evt.imageUrls });
          try {
            const out = await postCarouselToInstagram({
              text, imageUrls: evt.imageUrls, altTexts: evt.altTexts,
            });
            logger.info(`🎠 posted 7-slide event carousel for "${evt.eventSlug}"`);
            // eventId flows back so runPlatformCycle records the post event-keyed;
            // the partial unique index then enforces once-per-event-per-platform.
            // `caption` flows back so social_posts records what was ACTUALLY
            // posted, not the pre-rebuild text.
            return { url: out.url, platformPostId: out.id, eventId: evt.eventId, caption: text };
          } catch (err) {
            logIgFailure(`event-carousel "${evt.eventSlug}"`, err);
            throw err; // no silent fallback from a SUBMITTED event carousel
          }
        }
      }

      // Slide 1 MUST be the carousel1 preset, not square. Under the legacy
      // style the two are byte-identical (buildTree routes carousel1 →
      // buildSquareMagazineTree), which is why squareUrl worked here — but
      // under CARD_STYLE=scoopfeeds they diverge: carousel* gets the 1080x1350
      // ScoopFeeds cover, while square stays the legacy 1080x1080 magazine
      // card. Posting squareUrl therefore shipped a legacy 1:1 cover in front
      // of two 4:5 ScoopFeeds slides — mismatched styling AND mismatched
      // aspect ratios inside one album, which Meta resolves by cropping every
      // child to the first child's ratio.
      const imageUrls = [
        `${SITE}/api/cards/carousel1/${baseId}.png`,
        `${SITE}/api/cards/carousel2/${baseId}.png`,
        `${SITE}/api/cards/carousel3/${baseId}.png`,
      ];
      const altTexts = [
        singleAlt,
        `Key points from ${article.source_name || "the source"}`.slice(0, 100),
        "Read the full story at scoopfeeds.com",
      ];

      const tryCarousel = async () => {
        // Pre-publish self-check: refuse rather than hand Meta a URL that will
        // come back as an opaque "Invalid parameter".
        const bad = await verifyCardUrls(imageUrls);
        if (bad.length) {
          const err = new Error(`IG article-carousel pre-publish self-check failed: ${JSON.stringify(bad)}`);
          logger.error(`📸 ${err.message}`);
          throw err;
        }
        logIgAttempt({ style, kind: "article-carousel(3)", subjectId: `article:${article.id}`, imageUrls });
        try {
          const out = await postCarouselToInstagram({ text: composed.caption, imageUrls, altTexts });
          return { url: out.url, platformPostId: out.id };
        } catch (err) {
          logIgFailure(`article-carousel ${article.id}`, err);
          throw err;
        }
      };
      const trySingle = async () => {
        const bad = await verifyCardUrls([squareUrl]);
        if (bad.length) {
          const err = new Error(`IG single-card pre-publish self-check failed: ${JSON.stringify(bad)}`);
          logger.error(`📸 ${err.message}`);
          throw err;
        }
        logIgAttempt({ style, kind: "single", subjectId: `article:${article.id}`, imageUrls: [squareUrl] });
        try {
          const out = await postToInstagram({ text: composed.caption, imageUrl: squareUrl, altText: singleAlt });
          return { url: out.url, platformPostId: out.id };
        } catch (err) {
          logIgFailure(`single ${article.id}`, err);
          throw err;
        }
      };

      if (style === "single") return trySingle();
      if (style === "carousel") return tryCarousel();

      // "auto" — carousel first, fall back to single on any error. The
      // fallback is NOT silent: tryCarousel has already logged the full Meta
      // error body (or the self-check detail) before we get here.
      try {
        return await tryCarousel();
      } catch (carouselErr) {
        logger.warn(`instagram carousel failed (${carouselErr.message?.slice(0, 120)}) — falling back to single image`);
        return trySingle();
      }
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

  // EVENT-FIRST (instagram + IG_CAROUSEL_MODE=event): select from qualifying
  // events, not fresh articles — see pickEventFirstForInstagram for why the
  // article-first order never produced an event post. Selection is read-only
  // (no LLM copy is generated here; that happens in the adapter, and only for
  // the event actually being posted). Falls through to article-first when no
  // qualifying unposted event exists.
  let article = null;
  let preEvent = null;
  let droppedAsBlock = 0;
  if (platform === "instagram" && (process.env.IG_CAROUSEL_MODE || "article").toLowerCase() === "event") {
    const pick = pickEventFirstForInstagram();
    if (pick) {
      article = pick.article;
      preEvent = pick.event;
      logger.info(`📸 IG event-first: selected event "${pick.event.slug}" (${pick.event.sources} sources, ${pick.event.articles} articles) lead article ${article.id}`);
    } else {
      logger.info("📸 IG event-first: no qualifying unposted event — falling back to article selection");
    }
  }

  if (!article) {
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
    const newsworthy = candidates.filter(c => {
      if (looksLikeProgrammingBlock(c.title)) {
        droppedAsBlock += 1;
        return false;
      }
      return true;
    });

    article = newsworthy[0];
    if (!article) {
      return {
        platform,
        posted: false,
        reason: candidates.length ? "all_filtered" : "no_candidate",
        droppedAsBlock,
      };
    }
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

  // For Instagram carousel: pre-render all 3 slides we'll post so Meta's
  // image fetcher hits already-cached PNGs (avoids the 1–2s cold-render
  // window that can race with IG's container creation).
  if (platform === "instagram") {
    try {
      await Promise.all([
        ensureCard(article, "carousel1"),
        ensureCard(article, "carousel2"),
        ensureCard(article, "carousel3"),
        // square is still warmed: IG_POST_STYLE=single posts it directly, and
        // "auto" falls back to it if the carousel path throws.
        ensureCard(article, "square"),
      ]);
    } catch (err) {
      logger.warn(`socialPublisher: carousel pre-render failed for ${article.id}: ${err.message}`);
    }
  }

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
    // extras.event carries the event-first selection to the IG adapter;
    // other adapters take (article, composed, thumbBuffer) and ignore it.
    const result = await adapter.post(article, composed, thumbBuffer, { event: preEvent });
    recordSocialPost({
      articleId: article.id,
      platform,
      status: "posted",
      platformPostId: result.platformPostId,
      url: result.url,
      // The IG event path may rebuild the caption with the event's seo_line
      // after copy generation; record what actually went out.
      caption: result.caption ?? composed.caption,
      // Set only by the IG event carousel; NULL for every article-only post.
      eventId: result.eventId ?? null,
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

// ─── Cycle heartbeat + staleness detection ────────────────────────────────
//
// Two DISTINCT signals, tracked separately (this distinction is the whole
// point — conflating them produces an alert that fires on healthy behaviour
// and gets ignored):
//   • cycle EXECUTED  — the runner fired at all. A cycle that runs and
//     declines to post (throttle not elapsed, no candidate clears the filter)
//     is HEALTHY. A cycle that never runs is the outage we're catching
//     (Jul 4-9 2026: ~5 days dark, thousands of candidates, ZERO failed rows).
//   • post SUCCEEDED  — a post actually went out, per platform. Derived from
//     social_posts via lastPostAt (already persisted; no new state to drift).
const SOCIAL_CYCLE_HEARTBEAT = "social_cycle";
const CYCLE_STALE_MS = 90 * 60 * 1000;   // 3 missed */30 runs
// A started-but-never-finished cycle is wedged past this age. Env-tunable
// (SOCIAL_CYCLE_HANG_MS) so ops can tighten it; read at call time so dotenv
// load order can't freeze a default in.
const CYCLE_HANG_MS = () => Number.parseInt(process.env.SOCIAL_CYCLE_HANG_MS || "", 10) || 15 * 60 * 1000;
const PLATFORM_STALE_MULTIPLIER = 2.5;   // × each platform's minIntervalMs

// ─── Single-flight guard (process-local) ──────────────────────────────────
// Cross-process overlap is already prevented by the BullMQ singleton job;
// this covers the in-process entry points the scheduler's isRunning flag does
// NOT — the /scoop-ops social route calls runAllPlatformsCycle directly, and
// a manual poke during a wedged cron cycle would otherwise run concurrently
// AND stamp a fresh phase:"start" over the stale one, refreshing the hang
// signal forever (the Bluesky rate-limit-loop shape, again).
//
// Deliberately NOT a bare skip-if-set flag: that converts one hung cycle into
// permanent silence — the isRunning wedge reproduced one layer down. Skip
// only while the in-flight cycle is younger than CYCLE_HANG_MS; past that,
// log HUNG and let the fresh cycle proceed. The wedged one is unrecoverable
// anyway (every network call it holds carries its own timeout), and its late
// completion is defanged by the ownership guard on the heartbeat write below.
let cycleInFlight = null; // { startedAt } | null

// External dead-man's switch (Healthchecks.io free tier or equivalent). This
// is the ONLY signal that survives a fully-down process — the in-process
// staleness check below cannot fire when nothing is running, which by
// definition is the outage. Strictly telemetry: no-op when unset (no error,
// no log spam), ~3s timeout, every error swallowed. It must never block or
// break a posting cycle.
//
// Fired as a START/SUCCESS PAIR, not once. A single ping at cycle start goes
// green the moment the runner begins — so a cycle that starts, pings, then
// wedges on a hung HTTP call keeps the monitor green while nothing posts,
// which is the exact failure the switch exists to catch. Pinging {url}/start
// on entry and {url} only on successful completion means a hang shows as a
// start with no matching success, and the monitor alerts on it.
function pingHeartbeatUrl(pathSuffix = "") {
  const base = process.env.SOCIAL_HEARTBEAT_PING_URL;
  if (!base) return; // unset → complete no-op
  try {
    const url = `${String(base).replace(/\/+$/, "")}${pathSuffix}`;
    // Fire-and-forget: not awaited, rejection swallowed so it can never
    // surface as an unhandled rejection or delay the cycle.
    axios.get(url, { timeout: 3000 }).catch(() => {});
  } catch { /* never let telemetry break posting */ }
}

// Evaluate both signals, emit a greppable logger.error on staleness, and
// return the structured health for the metrics-ops route. Called on each
// cycle (so a run returning after a gap logs the gap it recovered from) and
// on each /scoop-ops/metrics scrape (so an external monitor triggers it even
// while the process is otherwise idle).
export function getSocialCycleHealth() {
  const now = Date.now();

  const { lastAt: cycleLastAt, meta: cycleMeta } = getHeartbeatRow(SOCIAL_CYCLE_HEARTBEAT);
  const cycleAgeMs  = cycleLastAt ? now - cycleLastAt : null;
  const cycleStale  = cycleLastAt ? cycleAgeMs > CYCLE_STALE_MS : false; // never-fired ≠ stale
  if (cycleStale) {
    logger.error(`🫀 social cycle STALE — last execution ${Math.round(cycleAgeMs / 60000)}m ago (threshold ${Math.round(CYCLE_STALE_MS / 60000)}m). The posting runner is not firing.`);
  }

  // Hang detection: a cycle that recorded "start" but never "complete". A
  // legitimately in-flight cycle also reads as "start", so only a start older
  // than CYCLE_HANG_MS counts — past that the runner is wedged (e.g. a hung
  // HTTP call), which a bare timestamp cannot distinguish from a healthy run.
  const hangMs      = CYCLE_HANG_MS();
  const phase       = cycleMeta && typeof cycleMeta === "object" ? cycleMeta.phase : null;
  const startedAt   = cycleMeta && typeof cycleMeta === "object" ? cycleMeta.startedAt || null : null;
  const startAgeMs  = startedAt ? now - startedAt : null;
  const cycleHung   = phase === "start" && startAgeMs != null && startAgeMs > hangMs;
  if (cycleHung) {
    logger.error(`🫀 social cycle HUNG — started ${Math.round(startAgeMs / 60000)}m ago and never completed (threshold ${Math.round(hangMs / 60000)}m). The runner is wedged mid-cycle; posts are not going out.`);
  }

  const platforms = [];
  for (const [name, adapter] of Object.entries(ADAPTERS)) {
    if (!adapter.enabled()) continue; // only judge platforms we're actually running
    const lastAt      = lastPostAt(name);
    const thresholdMs = adapter.minIntervalMs * PLATFORM_STALE_MULTIPLIER;
    const ageMs       = lastAt ? now - lastAt : null;
    const stale       = lastAt ? ageMs > thresholdMs : false; // never-posted ≠ stale
    if (stale) {
      logger.error(`🫀 ${name} posts STALE — last success ${Math.round(ageMs / 60000)}m ago (threshold ${Math.round(thresholdMs / 60000)}m, ${PLATFORM_STALE_MULTIPLIER}× minInterval).`);
    }
    platforms.push({ platform: name, lastAt, ageMs, thresholdMs, stale });
  }

  return {
    cycle: {
      lastAt: cycleLastAt,
      ageMs: cycleAgeMs,
      thresholdMs: CYCLE_STALE_MS,
      stale: cycleStale,
      // Hang signal — distinguishes "ran and finished" from "started and never
      // came back", which the external monitor sees as a missing success ping.
      phase: phase || null,
      startedAt,
      completedAt: cycleMeta && typeof cycleMeta === "object" ? cycleMeta.completedAt || null : null,
      durationMs: cycleMeta && typeof cycleMeta === "object" ? cycleMeta.durationMs ?? null : null,
      hangThresholdMs: hangMs,
      hung: cycleHung,
    },
    platforms,
  };
}

// Run all configured platforms in series. Used by the scheduler tail step.
export async function runAllPlatformsCycle(opts = {}) {
  // Single-flight: a fresh in-flight cycle means this invocation is a genuine
  // overlap (ops-route poke, cron catch-up) — skip it WITHOUT the /start ping,
  // because a skip that refreshed the external monitor would reintroduce the
  // exact false-green the start/success pair exists to prevent. A stale
  // in-flight cycle (older than CYCLE_HANG_MS) is a wedge: log it and proceed.
  if (cycleInFlight) {
    const inFlightAgeMs = Date.now() - cycleInFlight.startedAt;
    if (inFlightAgeMs <= CYCLE_HANG_MS()) {
      logger.warn(`⏸️ social cycle already in flight (started ${Math.round(inFlightAgeMs / 1000)}s ago) — skipping this invocation`);
      return { skipped: "already_in_flight", inFlightForMs: inFlightAgeMs };
    }
    logger.error(`🫀 social cycle HUNG in-process — previous invocation started ${Math.round(inFlightAgeMs / 60000)}m ago and never returned (threshold ${Math.round(CYCLE_HANG_MS() / 60000)}m). Proceeding with a fresh cycle over the wedged one.`);
  }

  // Evaluate staleness against the PREVIOUS heartbeat first — so a cycle
  // returning after a gap (or finding a hung predecessor) logs what it
  // recovered from — then stamp THIS execution's start. The heartbeat records
  // that the cycle RAN, independent of whether any platform posts.
  getSocialCycleHealth();

  // A dry run is a REHEARSAL, not evidence the pipeline is alive: it selects
  // and composes but deliberately posts nothing. So it must leave no liveness
  // trace — no heartbeat write, no /start ping, no success ping. Otherwise an
  // operator poking dry-run to inspect an outage would refresh the external
  // dead-man's switch and hold the monitor green while nothing is posting,
  // which is precisely the false-green the start/success pair exists to
  // prevent. Staleness is still EVALUATED above (read-only, and its alerts are
  // useful during exactly that investigation) — only the writes are skipped.
  const isDryRun = Boolean(opts.dryRun);

  const startedAt = Date.now();
  cycleInFlight = { startedAt };
  if (!isDryRun) {
    recordHeartbeat(SOCIAL_CYCLE_HEARTBEAT, { phase: "start", startedAt });
    pingHeartbeatUrl("/start");
  }

  try {
    const out = {};
    for (const platform of Object.keys(ADAPTERS)) {
      out[platform] = await runPlatformCycle(platform, opts);
    }
    // Success ping fires ONLY here. A cycle that wedges mid-loop never reaches
    // this line, so the monitor sees a start with no success and alerts —
    // instead of staying green while nothing posts.
    const completedAt = Date.now();
    if (!isDryRun) {
      recordCycleCompletionGuarded(startedAt, {
        phase: "complete", startedAt, completedAt, durationMs: completedAt - startedAt,
      });
      pingHeartbeatUrl();
    }
    return out;
  } catch (err) {
    // Record the failure in meta so an in-process reader can tell a crash from
    // a hang, then rethrow — the scheduler's own catch logs it. Deliberately
    // NO success ping: a thrown cycle must not look healthy to the monitor.
    const failedAt = Date.now();
    if (!isDryRun) {
      recordCycleCompletionGuarded(startedAt, {
        phase: "error", startedAt, failedAt, durationMs: failedAt - startedAt,
        error: String(err?.message || err).slice(0, 200),
      });
    }
    throw err;
  } finally {
    // Release only if this invocation still owns the flag: a stale-overridden
    // cycle completing late must not clear the NEWER cycle's in-flight state.
    if (cycleInFlight && cycleInFlight.startedAt === startedAt) cycleInFlight = null;
  }
}

// Ownership-guarded heartbeat write for cycle completion/error. An abandoned
// cycle — timed out at the scheduler, or overridden by the stale check above —
// that eventually completes will fire its success ping late (accepted), but it
// must NOT clobber a NEWER cycle's heartbeat meta: recordHeartbeat also bumps
// last_at, so an unguarded stale write would both overwrite the newer cycle's
// phase and falsely refresh the staleness clock. Exported for verification.
export function recordCycleCompletionGuarded(startedAt, meta) {
  const current = getHeartbeatRow(SOCIAL_CYCLE_HEARTBEAT);
  const ownerStartedAt = current.meta && typeof current.meta === "object" ? current.meta.startedAt || null : null;
  if (ownerStartedAt && ownerStartedAt > startedAt) {
    logger.warn(`🫀 stale social-cycle ${meta?.phase || "completion"} (started ${new Date(startedAt).toISOString()}) ignored — a newer cycle (started ${new Date(ownerStartedAt).toISOString()}) owns the heartbeat`);
    return false;
  }
  recordHeartbeat(SOCIAL_CYCLE_HEARTBEAT, meta);
  return true;
}

// Scheduler-facing wrapper: bounds how long the social tail can hold the
// ingestion cycle. The tail runs inside runIngestionCycle's isRunning guard,
// so a wedged social cycle would otherwise block ALL RSS ingestion
// indefinitely — social must never be able to stop ingestion. On timeout we
// log and return so the scheduler's finally releases isRunning; the abandoned
// promise keeps running, which is exactly the case the single-flight stale
// override and the ownership-guarded completion write handle on later ticks.
// Never throws (cycle errors are logged and absorbed, matching the previous
// call-site behaviour). `cycleFn` is injectable for verification only.
export async function runSocialCycleWithTimeout({ timeoutMs, cycleFn = runAllPlatformsCycle } = {}) {
  const budgetMs = timeoutMs ?? (Number.parseInt(process.env.SOCIAL_TAIL_TIMEOUT_MS || "", 10) || 10 * 60 * 1000);
  let timer = null;
  const timedOut = Symbol("social-tail-timeout");
  // Catch is attached BEFORE the race so a cycle that rejects after losing the
  // race can never surface as an unhandled rejection.
  const guarded = Promise.resolve()
    .then(() => cycleFn())
    .catch((err) => {
      logger.error(`❌ Auto-social failed: ${String(err?.message || err)}`);
      return { failed: String(err?.message || err).slice(0, 200) };
    })
    .finally(() => { if (timer) clearTimeout(timer); });
  const result = await Promise.race([
    guarded,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(timedOut), budgetMs);
      timer.unref?.(); // never hold the process open for telemetry
    }),
  ]);
  if (result === timedOut) {
    logger.error(`⏱️ social tail timed out after ${Math.round(budgetMs / 1000)}s — continuing ingestion (isRunning releases); the abandoned cycle may still be running and is covered by the in-flight guard + hang detection`);
    return { timedOut: true, budgetMs };
  }
  return result;
}

export function listEnabledPlatforms() {
  return Object.entries(ADAPTERS)
    .filter(([, a]) => a.enabled())
    .map(([name]) => name);
}
