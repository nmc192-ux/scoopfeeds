#!/usr/bin/env node
// upload_longform.mjs — one-off upload of a finished long-form film that was
// produced OUTSIDE the automated /video-factory loop (no video_jobs row, no
// longformCycle claim). Manually written, run once.
//
// Run inside the worker container, which carries the real env vars and the
// persistent volume:
//   docker compose run --rm worker node scripts/upload_longform.mjs
//
// Deliberately touches nothing in videoAutopost.js, youtubeClient.js or the
// scheduler — this only imports their public API and writes one row.
//
// TABLE CHOICE: the task that produced this script asked for a "video_posts
// row marked as longform". video_posts has no such column (id, article_id,
// event_id, source_name, title, status, attempts, youtube_id, privacy_status,
// image_tier, image_ref, title_variants, error, created_at, updated_at,
// published_at — migration 022) — there is nothing to mark. Migration 030
// created `longform_posts` as a SEPARATE table for exactly this reason: every
// rolling counter the shorts loop reads (countVideosPublishedSince,
// publisherPublishedSince, eventPublishedSince, the per-channel counts in
// models/database.js) scans video_posts only, so a row in longform_posts is
// already invisible to them — no flag needed. Writing into video_posts would
// do the opposite of what was asked: it would count against those gates.
// See db/migrations/030_longform_posts.js's header for the full reasoning.
//
// This script reuses longformCycle.js's own claim/publish helpers so a
// manually-inserted row looks exactly like one the automated loop would have
// written, and follows the same insert-before-work / record-after-verified-
// upload ordering that file's header explains.

import "../src/config/env.js";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getDb } from "../src/models/database.js";
import { logger } from "../src/services/logger.js";
import {
  isYouTubeConfigured,
  uploadToYouTube,
  uploadCaptions,
  setYouTubeThumbnail,
  YouTubeScopeError,
} from "../src/services/youtubeClient.js";
import { isFacebookConfigured, postToFacebook } from "../src/services/facebookClient.js";
import { claimEvent, recordPublished, recordFailure } from "../src/services/longform/longformCycle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");

// Deliberately NOT under SCOOP_PERSISTENT_DATA_DIR / videoArtifacts.VIDEOS_DIR
// — that directory is swept at 48h and is where the autopost loop looks for
// its own renders. This lives under the repo-relative backend/data instead,
// exactly as asked, so neither the sweep nor the loop ever sees these files.
const FILM_DIR = path.join(BACKEND_ROOT, "data", "videos", "longform", "two-gates");
const MP4_PATH = path.join(FILM_DIR, "price_of_two_gates_4K.mp4");
const SRT_PATH = path.join(FILM_DIR, "price_of_two_gates_4K.srt");
const THUMB_PATH = path.join(FILM_DIR, "thumbnail.png");

const EVENT_ID = "manual-two-gates"; // no live graph event backs this upload — denormalised id, matches longform_posts' no-FK convention
const SLUG = "two-gates";

const TITLE = "The Price of Two Gates — how a $2,000 drone moved the price of every barrel on earth";

const DESCRIPTION_TEMPLATE = `WATCH FIRST ▶ How the Houthis took the Gate of Tears — our film on the fall of Yemen's Red Sea coast: {{HOUTHI_URL}}
This is the sequel: what it costs, and who pays.

A $2,000 drone moved the price of every barrel on earth. In September 2026 the Houthis took Yemen's entire Red Sea coast, drones hit Saudi Arabia's last export pipeline, and supertanker hire crossed $1 million a day for the first time in history. This film follows one barrel of Saudi crude from the ground to a fuel pump — and finds out who pays.

CHAPTERS
0:00 The brief
0:21 The meter: $1 million a day
0:56 Two gates and a back door
2:58 Pump Station 9
4:15 The clerk in London — how a number became the war
6:16 The war Saudi Arabia was supposed to win
7:57 Who pays — Lahore, Nairobi, Cairo, Ohio
10:09 The cheapest weapon, and the toll booth
11:34 The tag that never comes off

HOW THIS WAS MADE
ScoopFeeds sources from wire reporting and primary filings, checks every figure against the issuing body, and cites on screen. Six figures in the draft script failed a primary-source check and were corrected before air.

SOURCES
Reuters · Bloomberg · Lloyd's List · Seatrade Maritime · Fortune · Baltic Exchange · International Energy Agency · Oxford Economics · Gulf News · The National · Liverpool JMU Maritime Centre · Marsh · S&P Global Platts · ICE Brent · Saudi Ministry of Finance · GASTAT · AAA · EIA · Congressional Budget Office · NPR · CAPMAS · Suez Canal Authority · Petroleum Division of Pakistan · IOM · Middle East Eye · Axios · Al Jazeera

IMAGERY
NASA Worldview / MODIS and NASA ISS (public domain) · Planet Labs (CC BY-SA 4.0) · Wikimedia Commons portraits (licences on screen) · Natural Earth · footage: Mixkit free licence. Narration and music: ElevenLabs.

Part 1 of this story: {{HOUTHI_URL}}

#Hormuz #BabElMandeb #OilPrices #Houthis #SaudiArabia #Geopolitics #Energy #Pakistan`;

const TAGS = [
  "Strait of Hormuz", "Bab el-Mandeb", "oil prices", "Houthis", "Saudi Arabia",
  "Yemen", "Red Sea", "Gate of Tears", "tanker rates", "war risk insurance",
  "Iran war 2026", "Yanbu pipeline", "diesel prices", "Pakistan fuel prices",
  "Federal Reserve", "geopolitics", "ScoopFeeds",
];

const HOUTHI_TITLE_PATTERN = /houthi|mandeb|gate of tears/i;

// ─── STEP 1: find the Houthi film's URL ────────────────────────────────────
//
// Checked in this order:
//   1. longform_posts — the architecturally correct home for a prior film.
//   2. video_posts — as asked, in case that earlier upload predates this
//      script and was recorded the same ad-hoc way the task described.
//   3. The channel's recent uploads, straight from the Data API, matched by
//      title. youtubeClient.js exports no "list uploads" call and it is
//      off-limits to modify, so this duplicates the minimum needed slice of
//      its token-refresh logic rather than adding to that file.
//   4. --houthi-url=... on the command line, as a manual override if none of
//      the above find it.

function cliArg(name) {
  const pre = `--${name}=`;
  const hit = process.argv.find(a => a.startsWith(pre));
  return hit ? hit.slice(pre.length) : null;
}

function findHouthiUrlInDb(db) {
  const longform = db.prepare(
    `SELECT youtube_id FROM longform_posts WHERE youtube_id IS NOT NULL AND (title LIKE '%Houthi%' OR title LIKE '%Mandeb%' OR title LIKE '%Gate of Tears%') ORDER BY published_at DESC LIMIT 1`
  ).get();
  if (longform?.youtube_id) {
    return { url: `https://www.youtube.com/watch?v=${longform.youtube_id}`, source: "longform_posts" };
  }
  const short = db.prepare(
    `SELECT youtube_id FROM video_posts WHERE youtube_id IS NOT NULL AND (title LIKE '%Houthi%' OR title LIKE '%Mandeb%' OR title LIKE '%Gate of Tears%') ORDER BY published_at DESC LIMIT 1`
  ).get();
  if (short?.youtube_id) {
    return { url: `https://www.youtube.com/watch?v=${short.youtube_id}`, source: "video_posts" };
  }
  return null;
}

// Minimal, standalone token refresh — youtubeClient._getAccessToken is not
// exported and this file must not add an export to reach it.
async function getAccessTokenForListing() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: (process.env.YOUTUBE_CLIENT_ID || "").trim(),
      client_secret: (process.env.YOUTUBE_CLIENT_SECRET || "").trim(),
      refresh_token: (process.env.YOUTUBE_REFRESH_TOKEN || "").trim(),
      grant_type: "refresh_token",
    }).toString(),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(`token refresh failed: ${body.error_description || body.error || res.status}`);
  }
  return body.access_token;
}

async function findHouthiUrlViaApi() {
  const accessToken = await getAccessTokenForListing();
  const chRes = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const chBody = await chRes.json();
  const uploadsPlaylistId = chBody?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) throw new Error("could not resolve channel uploads playlist");

  const plRes = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=25&playlistId=${encodeURIComponent(uploadsPlaylistId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const plBody = await plRes.json();
  const items = plBody?.items || [];
  const hit = items.find(it => HOUTHI_TITLE_PATTERN.test(it?.snippet?.title || ""));
  if (!hit) {
    return { recentTitles: items.map(it => it?.snippet?.title).filter(Boolean) };
  }
  const videoId = hit.snippet?.resourceId?.videoId;
  return { url: `https://www.youtube.com/watch?v=${videoId}`, title: hit.snippet?.title, source: "channel uploads" };
}

async function resolveHouthiUrl(db) {
  const override = cliArg("houthi-url");
  if (override) return { url: override, source: "--houthi-url override" };

  const fromDb = findHouthiUrlInDb(db);
  if (fromDb) return fromDb;

  const viaApi = await findHouthiUrlViaApi();
  if (viaApi.url) return viaApi;

  throw new Error(
    "Could not find the Houthi film automatically.\n" +
    "Recent channel uploads found instead:\n" +
    (viaApi.recentTitles || []).map(t => `  - ${t}`).join("\n") +
    "\nRe-run with --houthi-url=<url> to supply it directly."
  );
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🎬 upload_longform.mjs — "${TITLE}"`);

  for (const [label, p] of [["MP4", MP4_PATH], ["SRT", SRT_PATH], ["thumbnail", THUMB_PATH]]) {
    if (!existsSync(p)) throw new Error(`${label} not found at ${p}`);
  }
  if (!isYouTubeConfigured()) throw new Error("YouTube not configured (YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN missing)");

  const db = getDb();

  console.log("→ resolving the Houthi film's URL…");
  const houthi = await resolveHouthiUrl(db);
  console.log(`  found via ${houthi.source}: ${houthi.url}`);

  const description = DESCRIPTION_TEMPLATE.replaceAll("{{HOUTHI_URL}}", houthi.url);

  // Claim before any work — a crash between upload and record must not leave
  // an untracked published film (longformCycle.js's own rule).
  const claimed = claimEvent(db, { eventId: EVENT_ID, slug: SLUG, title: TITLE, now: Date.now() });
  if (!claimed) {
    const existing = db.prepare("SELECT * FROM longform_posts WHERE event_id = ?").get(EVENT_ID);
    throw new Error(
      `longform_posts already has a row for event_id="${EVENT_ID}" (status=${existing?.status}, youtube_id=${existing?.youtube_id || "none"}). ` +
      `Refusing to upload a possible duplicate — delete or investigate that row first if this is a genuine re-run.`
    );
  }

  let videoId, privacyStatus;
  try {
    console.log("→ uploading MP4 to YouTube (public, category 25)…");
    const up = await uploadToYouTube({
      filePath: MP4_PATH,
      title: TITLE,
      description,
      tags: TAGS,
      category: 25,
      isShort: false, // long-form: isShort=true would append "#Shorts" to the description, which belongs to a different format
    });
    videoId = up.videoId;
    // NOT up.videoUrl — uploadToYouTube always returns a /shorts/ URL
    // regardless of isShort, which is wrong for a 13-minute film. Built here
    // instead of touching that function.
    privacyStatus = "public";
    console.log(`  ✅ uploaded: ${videoId}`);
  } catch (err) {
    recordFailure(db, { eventId: EVENT_ID, stage: "youtube_upload", error: err.message });
    throw err;
  }

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const outcome = { videoUrl, houthiUrl: houthi.url, captions: null, thumbnail: null, facebook: null };

  // Captions — best-effort. Missing force-ssl scope or a not-verified-channel
  // 403 must not roll back the (already public) upload.
  console.log("→ uploading captions…");
  try {
    await uploadCaptions({ videoId, filePath: SRT_PATH, language: "en", name: "English" });
    outcome.captions = { ok: true };
    console.log("  ✅ captions uploaded");
  } catch (err) {
    const reason = err instanceof YouTubeScopeError
      ? `missing ${err.missingScope} scope — re-run backend/scripts/youtube-auth.mjs and replace YOUTUBE_REFRESH_TOKEN`
      : err.message;
    outcome.captions = { ok: false, reason };
    console.warn(`  ⚠️  captions failed: ${reason}`);
  }

  // Thumbnail — setYouTubeThumbnail never throws; it returns false and logs.
  console.log("→ setting thumbnail…");
  const thumbOk = await setYouTubeThumbnail({ videoId, filePath: THUMB_PATH });
  outcome.thumbnail = { ok: thumbOk, reason: thumbOk ? null : "set failed — see log above (often a 403 on a channel that isn't phone-verified)" };
  console.log(thumbOk ? "  ✅ thumbnail set" : "  ⚠️  thumbnail failed");

  // Record the publish BEFORE the Facebook cross-post: the film itself is
  // what the dedupe/cooldown machinery must never lose track of, and a
  // Facebook failure below must not un-record a real YouTube publish.
  recordPublished(db, {
    eventId: EVENT_ID,
    youtubeId: videoId,
    privacyStatus,
    publishAt: Date.now(),
    qc: { manual: true, uploadedBy: "upload_longform.mjs" },
  });
  console.log(`→ recorded in longform_posts (event_id=${EVENT_ID})`);

  // Facebook — link post only, never the file (320MB is well over the ~200MB
  // practical cap for a synchronous page-feed video upload).
  if (isFacebookConfigured()) {
    console.log("→ posting the YouTube link to Facebook…");
    try {
      const fb = await postToFacebook({
        text: `${TITLE}\n\nA $2,000 drone moved the price of every barrel on earth. Full film ↓`,
        link: videoUrl,
      });
      outcome.facebook = { ok: true, url: fb.url };
      console.log(`  ✅ Facebook posted: ${fb.url}`);
    } catch (err) {
      outcome.facebook = { ok: false, reason: err.message };
      console.warn(`  ⚠️  Facebook post failed: ${err.message}`);
    }
  } else {
    outcome.facebook = { ok: false, reason: "Facebook not configured" };
    console.warn("  ⚠️  Facebook not configured — skipped");
  }

  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(outcome, null, 2));
  return outcome;
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    logger.error(`upload_longform: ${err.message}`);
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
  });
