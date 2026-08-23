// Scheduled publish: YouTube (long-form + 5 Shorts) and Facebook (page video + Reel).
//
//   node publish-all.mjs            # dry run — shows every payload, posts nothing
//   node publish-all.mjs --confirm  # schedules
//
// SCHEDULING RATIONALE
// The channel has 15 subs, so long-form gets no algorithmic push. The Shorts are
// the distribution and the film is the destination. The film therefore lands
// FIRST, so every Short has somewhere to send people, then one Short per day for
// five days — separate days means five independent shots at the Shorts feed
// rather than five clips competing on one.
//
// 19:00 UTC = 3pm US Eastern: the film gets the US afternoon and the European
// evening on day one, which is the window YouTube uses to decide who else to
// show it to.
//
// Everything goes up unpublished with a scheduled time, so it is fully
// reversible until the slot. Nothing is publicly visible when this finishes.
//
// TWO API CONSTRAINTS THIS SCRIPT IS BUILT AROUND
//   1. The YouTube refresh token carries youtube.upload + youtube.readonly, and
//      NOT youtube (or force-ssl). videos.update is therefore forbidden, so
//      publishAt cannot be set in a second pass — it is sent inside the initial
//      videos.insert, which youtube.upload does permit. captions.insert has no
//      such workaround and is left to the user.
//   2. The production facebookClient hardcodes published=true on both endpoints,
//      so neither of its post functions can schedule. The two calls are made
//      directly here rather than widening a live auto-poster's API for one video.

import { readFileSync, writeFileSync, existsSync, statSync, createReadStream } from "fs";
import { P, ENV_FILES, BACKEND } from "./_deps.mjs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
for (const f of ENV_FILES) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const confirm = process.argv.includes("--confirm");

// ── per-video metadata lives in the PROJECT, not here ────────────────────
// This file shipped with video 2's title, description, tags, Shorts list and
// schedule baked in — the same class of bug as capture-measured.mjs carrying
// one film's source list. Publishing the wrong film's copy is not recoverable
// by editing afterwards: subscribers see the notification that went out.
const CFG_PATH = P("publish.json");
if (!existsSync(CFG_PATH)) {
  console.error(`no publish.json in ${P(".")} — nothing to schedule.`);
  console.error(`It needs: { film, thumb, youtube:{title,description,tags,publishAt},`);
  console.error(`            shorts:[{file,title,desc,publishAt}], facebook:{caption,publishAt,reel} }`);
  process.exit(1);
}
const CFG = JSON.parse(readFileSync(CFG_PATH, "utf8"));
for (const [k, ok] of [["film", CFG.film], ["thumb", CFG.thumb],
                       ["youtube.title", CFG.youtube?.title],
                       ["youtube.publishAt", CFG.youtube?.publishAt],
                       ["shorts", CFG.shorts?.length],
                       ["facebook.publishAt", CFG.facebook?.publishAt]]) {
  if (!ok) {
    console.error(`publish.json in ${P(".")} is missing "${k}".`);
    console.error(`See template/publish.example.json in the skill for the full shape.`);
    process.exit(1);
  }
}

// ── AIGC consistency gate ─────────────────────────────────────────────────
// genscene.mjs `use` stamps LICENSES.md with the EXACT phrase below when an
// AI-generated scene enters a project. A description still claiming "No
// AI-generated imagery" over that stamp is a false public statement — the one
// class of error this pipeline refuses to publish rather than paper over.
// Keyed on the exact stamp, not /AI-generated/i: provenance notes legitimately
// contain those words while EXCLUDING AI content (the Ebola project's does).
const AIGC_STAMP = "**AI-generated content present in this project.**";
{
  const lic = P("out/footage/LICENSES.md");
  if (existsSync(lic) && readFileSync(lic, "utf8").includes(AIGC_STAMP)) {
    const desc = CFG.youtube?.description || "";
    if (/no ai-generated imagery/i.test(desc)) {
      console.error("REFUSING: LICENSES.md declares AI-generated content, but the YouTube");
      console.error("description claims \"No AI-generated imagery\". Fix the description.");
      process.exit(1);
    }
    if (!CFG.syntheticContent) {
      console.error("REFUSING: AI-generated scenes present but publish.json syntheticContent");
      console.error("is not set — the YouTube 'Altered content' disclosure would be skipped.");
      process.exit(1);
    }
    const ttPath = P("tiktok.json");
    if (existsSync(ttPath) && JSON.parse(readFileSync(ttPath, "utf8")).isAigc !== true) {
      console.error("REFUSING: AI-generated scenes present but tiktok.json isAigc is not true.");
      process.exit(1);
    }
    console.log("AIGC gate    : generated scenes present — disclosures verified consistent");
  }
}

const FILM = P(CFG.film);
const THUMB = P(CFG.thumb);
const SRT = CFG.srt ? P(CFG.srt) : null;
const SHORTS_DIR = P("out/shorts");
const TITLE = CFG.youtube.title;
const DESCRIPTION = CFG.youtube.description;
const TAGS = CFG.youtube.tags;
const SHORTS = CFG.shorts;
const FB = CFG.facebook;

const mb = (f) => (statSync(f).size / 1048576).toFixed(1);

// ── preflight ─────────────────────────────────────────────────────────────
if (!existsSync(FILM)) throw new Error("film missing: " + FILM);
if (!existsSync(THUMB)) throw new Error("thumbnail missing: " + THUMB);

console.log("LONG-FORM");
console.log("  file       :", path.basename(FILM), `(${mb(FILM)} MB)`);
console.log("  title      :", TITLE, `(${TITLE.length} chars)`);
console.log("  description:", DESCRIPTION.length, "chars |", TAGS.length, "tags");
console.log("  thumbnail  :", mb(THUMB), "MB (limit 2 MB)");
console.log("  publishAt  :", CFG.youtube.publishAt);
console.log("\nSHORTS");
for (const s of SHORTS) {
  const f = path.join(SHORTS_DIR, s.file);
  if (!existsSync(f)) throw new Error("short missing: " + f);
  console.log(`  ${s.publishAt}  ${s.file.padEnd(30)} ${mb(f).padStart(5)}MB  ${s.title}`);
}
console.log("\nFACEBOOK");
console.log("  page video : scheduled", FB.publishAt, `| caption ${FB.caption.length} chars`);
console.log("  reel       : scheduled", FB.reel.publishAt, "|", FB.reel.file);

// ── identity gates ────────────────────────────────────────────────────────
// Both are checked BEFORE anything uploads. A token minted for a different
// channel or page answers name queries perfectly happily.
async function ytToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID, client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("youtube token refresh failed: " + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

console.log("\nverifying identity…");
{
  const t = await ytToken();
  const j = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
    { headers: { Authorization: `Bearer ${t}` } }).then((r) => r.json());
  const ch = j.items?.[0];
  if (ch?.snippet?.customUrl !== "@scoopfeedsnews") {
    throw new Error("wrong YouTube channel: " + JSON.stringify(ch?.snippet?.customUrl));
  }
  console.log("  YOUTUBE:", ch.snippet.title, "|", ch.snippet.customUrl, "| subs", ch.statistics?.subscriberCount);
}

// Disk cache OUTRANKS env, exactly as facebookClient._loadToken does. Reading
// only env here would gate on one token and post with another.
const FB_DISK = path.join(process.env.SCOOP_PERSISTENT_DATA_DIR || path.join(BACKEND, "data"), "facebook-token.json");
let fbToken = process.env.FACEBOOK_PAGE_TOKEN, fbPage = process.env.FACEBOOK_PAGE_ID, fbSrc = "env";
if (existsSync(FB_DISK)) {
  const j = JSON.parse(readFileSync(FB_DISK, "utf8"));
  if (j?.pageToken) { fbToken = j.pageToken; fbPage = j.pageId || fbPage; fbSrc = "disk cache"; }
}
{
  const me = await fetch(`https://graph.facebook.com/v26.0/me?fields=id,name&access_token=${encodeURIComponent(fbToken || "")}`)
    .then((r) => r.json()).catch((e) => ({ error: { message: e.message } }));
  if (me.error) throw new Error("facebook token invalid: " + me.error.message);
  if (me.id !== fbPage) throw new Error(`facebook identity mismatch: /me is ${me.id} "${me.name}", expected ${fbPage}`);
  console.log(`  FB PAGE: ${me.name} (${me.id})  [token from ${fbSrc}]`);
}

if (!confirm) {
  console.log("\nDRY RUN — nothing scheduled. Re-run with --confirm.");
  process.exit(0);
}

// ── YouTube upload ────────────────────────────────────────────────────────
/**
 * Resumable insert with publishAt set inline.
 *
 * Written here rather than reusing youtubeClient.uploadToYouTube because that
 * function has no publishAt parameter, and the scope this token carries makes a
 * follow-up videos.update impossible — so scheduling has to happen at insert or
 * not at all.
 */
async function ytUpload({ filePath, title, description, tags, publishAt }) {
  const token = await ytToken();
  const bytes = statSync(filePath).size;
  const meta = {
    snippet: { title: title.slice(0, 100), description: description.slice(0, 5000), tags, categoryId: CFG.youtube.categoryId || "25" },
    status: { privacyStatus: "private", publishAt, selfDeclaredMadeForKids: false },
  };
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json",
      "X-Upload-Content-Length": String(bytes), "X-Upload-Content-Type": "video/mp4" },
    body: JSON.stringify(meta),
  });
  if (!init.ok) throw new Error(`insert init ${init.status}: ${(await init.text()).slice(0, 300)}`);
  const location = init.headers.get("location");
  if (!location) throw new Error("no resumable upload URL returned");

  const put = await fetch(location, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes) },
    body: createReadStream(filePath),
    duplex: "half",
  });
  const body = await put.json().catch(() => ({}));
  if (!put.ok) throw new Error(`upload ${put.status}: ${JSON.stringify(body).slice(0, 300)}`);
  if (!body.id) throw new Error("upload returned no video id: " + JSON.stringify(body).slice(0, 200));
  // Report what YouTube ACCEPTED, not what we sent — a silently-dropped
  // publishAt would otherwise read as a successful schedule.
  return { id: body.id, privacy: body.status?.privacyStatus, publishAt: body.status?.publishAt };
}

const results = { youtube: [], facebook: [], warnings: [] };

console.log("\nuploading long-form…");
const film = await ytUpload({ filePath: FILM, title: TITLE, description: DESCRIPTION,
  tags: TAGS, publishAt: CFG.youtube.publishAt });
const filmUrl = `https://www.youtube.com/watch?v=${film.id}`;
console.log(`   ${filmUrl}  privacy=${film.privacy}  publishAt=${film.publishAt}`);
if (!film.publishAt) results.warnings.push("long-form: YouTube did not echo publishAt — check Studio");
results.youtube.push({ kind: "longform", ...film, url: filmUrl });

{
  const t = await ytToken();
  const r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${film.id}&uploadType=media`,
    { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "image/png" }, body: readFileSync(THUMB) });
  if (r.ok) console.log("   thumbnail: set");
  else {
    const msg = (await r.text()).slice(0, 200);
    console.log(`   thumbnail: FAILED ${r.status} — set it by hand in Studio`);
    results.warnings.push(`thumbnail not set (${r.status}): ${msg}`);
  }
}

for (const s of SHORTS) {
  const f = path.join(SHORTS_DIR, s.file);
  const desc = `${s.desc}\n\nFull explainer: ${filmUrl}\n\nhttps://scoopfeeds.com\n\n#Shorts`;
  const up = await ytUpload({ filePath: f, title: s.title, description: desc,
    tags: TAGS.slice(0, 12), publishAt: s.publishAt });
  console.log(`   short ${s.file.slice(0, 2)} → https://youtube.com/shorts/${up.id}  publishAt=${up.publishAt}`);
  if (!up.publishAt) results.warnings.push(`${s.file}: publishAt not echoed`);
  results.youtube.push({ kind: "short", file: s.file, ...up });
}

// ── Facebook ──────────────────────────────────────────────────────────────
const epoch = (i) => Math.floor(new Date(i).getTime() / 1000);

console.log("\nscheduling Facebook page video…");
try {
  const fd = new FormData();
  fd.append("access_token", fbToken);
  fd.append("title", TITLE);
  fd.append("description", `${FB.caption}\n\nFull video: ${filmUrl}`);
  fd.append("published", "false");
  fd.append("scheduled_publish_time", String(epoch(FB.publishAt)));
  fd.append("source", new Blob([readFileSync(FILM)]), path.basename(FILM));
  const r = await fetch(`https://graph.facebook.com/v26.0/${fbPage}/videos`, { method: "POST", body: fd });
  const b = await r.json();
  if (!r.ok || b.error) throw new Error(JSON.stringify(b.error || b).slice(0, 250));
  console.log("   video id", b.id, "→ scheduled", FB.publishAt);
  results.facebook.push({ kind: "video", id: b.id, at: FB.publishAt });
} catch (e) {
  console.log("   FAILED:", e.message);
  results.warnings.push("facebook page video not scheduled: " + e.message);
}

console.log("scheduling Facebook reel…");
try {
  // Same three phases as facebookClient.postReelToFacebook, with SCHEDULED in
  // place of its hardcoded PUBLISHED.
  const reelFile = path.join(SHORTS_DIR, FB.reel.file);
  const bytes = readFileSync(reelFile);
  const q = (params) => `https://graph.facebook.com/v26.0/${fbPage}/video_reels?` +
    new URLSearchParams({ ...params, access_token: fbToken });

  const init = await fetch(q({ upload_phase: "start", file_size: String(bytes.length) }), { method: "POST" }).then((r) => r.json());
  if (!init?.video_id || !init?.upload_url) throw new Error("start: " + JSON.stringify(init).slice(0, 200));

  const up = await fetch(init.upload_url, {
    method: "POST",
    headers: { Authorization: `OAuth ${fbToken}`, offset: "0", file_size: String(bytes.length), "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  if (!up.ok) throw new Error(`upload ${up.status}: ${(await up.text()).slice(0, 200)}`);

  const fin = await fetch(q({
    upload_phase: "finish", video_id: init.video_id, video_state: "SCHEDULED",
    scheduled_publish_time: String(epoch(FB.reel.publishAt)),
    description: `${FB.reel.caption}\n\nFull explainer: ${filmUrl}`,
  }), { method: "POST" }).then((r) => r.json());
  if (fin && fin.success === false) throw new Error("finish returned success=false: " + JSON.stringify(fin).slice(0, 200));
  console.log("   reel id", init.video_id, "→ scheduled", FB.reel.publishAt);
  results.facebook.push({ kind: "reel", id: init.video_id, at: FB.reel.publishAt });
} catch (e) {
  console.log("   FAILED:", e.message);
  results.warnings.push("facebook reel not scheduled: " + e.message);
}

console.log("\n" + JSON.stringify(results, null, 1));

// THE IDS ARE THE ONLY HANDLE ON A SCHEDULED UPLOAD, AND THEY WERE PRINTED ONLY.
// Everything here goes up private with a publishAt, so until the slot the video
// id is the sole way to find, correct or cancel it — and a private upload does
// not appear in a channel's public listing. Losing them to terminal scrollback
// means recovering them by re-querying the API. Persist next to the film.
try {
  writeFileSync(P("out/publish-result.json"), JSON.stringify(
    { at: new Date().toISOString(), title: TITLE, ...results }, null, 2));
  console.log("\nids written to out/publish-result.json");
} catch (e) {
  console.log("\ncould not persist ids: " + e.message + " — COPY THEM FROM ABOVE");
}

console.log("\nLEFT FOR YOU IN YOUTUBE STUDIO:");
// Read from publish.json, NEVER assumed. This line was hardcoded to video 2's
// "5 AI environment stills are used" and printed under a film that contains no
// AI imagery at all — telling the user to make a disclosure that would itself
// have been false. A disclosure prompt has to track the actual film.
if (CFG.syntheticContent) {
  console.log(`  1. Tick 'Altered or synthetic content' on all uploads — ${CFG.syntheticContent}`);
} else {
  console.log("  1. Do NOT tick 'Altered or synthetic content' — this film uses no AI-generated imagery.");
}
console.log(`  2. Upload captions: ${SRT || "(none)"}`);
console.log("     (captions.insert needs the youtube.force-ssl scope; this token has upload+readonly only)");
if (results.warnings.length) {
  console.log("\nWARNINGS:");
  for (const w of results.warnings) console.log("  •", w);
}
