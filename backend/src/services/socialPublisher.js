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
  recordHeartbeat,
  getHeartbeatRow,
} from "../models/database.js";
import { composeAllPlatforms } from "./socialComposer.js";
import { ensureCard } from "./cardRenderer.js";
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
      // Post style is controlled by IG_POST_STYLE env var:
      //   "carousel" (default) — 3-slide carousel (cover → key points → CTA).
      //                          Highest save-rate, but requires the CAROUSEL_ALBUM
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

      const imageUrls = [
        squareUrl,
        `${SITE}/api/cards/carousel2/${baseId}.png`,
        `${SITE}/api/cards/carousel3/${baseId}.png`,
      ];
      const altTexts = [
        singleAlt,
        `Key points from ${article.source_name || "the source"}`.slice(0, 100),
        "Read the full story at scoopfeeds.com",
      ];

      const tryCarousel = async () => {
        const out = await postCarouselToInstagram({ text: composed.caption, imageUrls, altTexts });
        return { url: out.url, platformPostId: out.id };
      };
      const trySingle = async () => {
        const out = await postToInstagram({ text: composed.caption, imageUrl: squareUrl, altText: singleAlt });
        return { url: out.url, platformPostId: out.id };
      };

      if (style === "single") return trySingle();
      if (style === "carousel") return tryCarousel();

      // "auto" — carousel first, fall back to single on any error.
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

  // For Instagram carousel: pre-render all 3 slides we'll post so Meta's
  // image fetcher hits already-cached PNGs (avoids the 1–2s cold-render
  // window that can race with IG's container creation).
  if (platform === "instagram") {
    try {
      await Promise.all([
        ensureCard(article, "square"),
        ensureCard(article, "carousel2"),
        ensureCard(article, "carousel3"),
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

  const startedAt = Date.now();
  cycleInFlight = { startedAt };
  recordHeartbeat(SOCIAL_CYCLE_HEARTBEAT, { phase: "start", startedAt });
  pingHeartbeatUrl("/start");

  try {
    const out = {};
    for (const platform of Object.keys(ADAPTERS)) {
      out[platform] = await runPlatformCycle(platform, opts);
    }
    // Success ping fires ONLY here. A cycle that wedges mid-loop never reaches
    // this line, so the monitor sees a start with no success and alerts —
    // instead of staying green while nothing posts.
    const completedAt = Date.now();
    recordCycleCompletionGuarded(startedAt, {
      phase: "complete", startedAt, completedAt, durationMs: completedAt - startedAt,
    });
    pingHeartbeatUrl();
    return out;
  } catch (err) {
    // Record the failure in meta so an in-process reader can tell a crash from
    // a hang, then rethrow — the scheduler's own catch logs it. Deliberately
    // NO success ping: a thrown cycle must not look healthy to the monitor.
    const failedAt = Date.now();
    recordCycleCompletionGuarded(startedAt, {
      phase: "error", startedAt, failedAt, durationMs: failedAt - startedAt,
      error: String(err?.message || err).slice(0, 200),
    });
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
