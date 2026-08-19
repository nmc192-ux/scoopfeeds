// Instagram Reels + Stories publisher.
//
//   node ig-publish.mjs --base https://host/path        # dry run
//   node ig-publish.mjs --base https://host/path --only 1 --confirm
//
// TWO THINGS THIS SCRIPT CANNOT DO, BOTH BY META'S DESIGN
//
// 1. IT CANNOT SCHEDULE. The Instagram Content Publishing API has no
//    publish_time / scheduled_publish_time parameter — Meta's own docs say an
//    app "allows app users to schedule posts" as an APP-side concern, i.e. the
//    caller must be running at post time. Worse, containers expire after
//    exactly 24 hours, so you cannot even pre-build containers for a slot four
//    days out. Anything calling itself "scheduled IG posting" is a process that
//    wakes up and posts. Hence --only: something external picks the day.
//
// 2. IT CANNOT UPLOAD BYTES. IG fetches media from a public URL; there is no
//    multipart path (unlike YouTube and Facebook). --base must be an HTTPS
//    origin Meta's crawler can reach, serving <base>/<file>.mp4.
//
// Reels and Stories are published as SEPARATE media objects from the same file:
// a Story is not a reshare of the Reel, it is its own container.

import { readFileSync, existsSync } from "fs";
import { P } from "./_deps.mjs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = "/Users/jahanzebhussain/Downloads/scoop-news/backend";
for (const f of [path.join(REPO, ".env"), `${process.env.HOME}/.scoopfeeds.env`]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const confirm = process.argv.includes("--confirm");
const BASE = (arg("--base") || "").replace(/\/+$/, "");
const ONLY = arg("--only");
const SKIP_STORY = process.argv.includes("--no-story");

const IG_USER = process.env.INSTAGRAM_USER_ID || "17841429776015289";  // scoop.feeds
const FB_DISK = path.join(process.env.SCOOP_PERSISTENT_DATA_DIR || path.join(REPO, "data"), "facebook-token.json");
let TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_TOKEN;
if (!process.env.INSTAGRAM_ACCESS_TOKEN && existsSync(FB_DISK)) {
  const d = JSON.parse(readFileSync(FB_DISK, "utf8"));
  if (d?.pageToken) TOKEN = d.pageToken;   // disk cache outranks env, as the prod client does
}

// ── per-film config lives in the PROJECT ─────────────────────────────────
// This file shipped with one film's YouTube id, five filenames and five
// captions baked in. Copying it for the next film produced a job that crashed
// on startup pointing at files that no longer existed — and had it not crashed,
// it would have posted the previous film's captions. Same class as
// publish-all.mjs and capture-measured.mjs: per-film data belongs in the
// project, never the engine.
const IG_CFG = P("ig.json");
if (!existsSync(IG_CFG)) {
  console.error(`no ig.json in ${P(".")} — nothing to post.`);
  console.error(`It needs: { "filmId": "<youtube id>", "posts": [{ "file", "caption", "tags" }] }`);
  process.exit(1);
}
const CFG = JSON.parse(readFileSync(IG_CFG, "utf8"));
if (!CFG.filmId || !Array.isArray(CFG.posts) || !CFG.posts.length) {
  console.error(`ig.json in ${P(".")} needs "filmId" and a non-empty "posts" array.`);
  console.error(`filmId is the YouTube id the poller waits on before posting.`);
  process.exit(1);
}
const FILM_ID = CFG.filmId;
const YT_FILM = `https://www.youtube.com/watch?v=${FILM_ID}`;
const POSTS = CFG.posts.map((x, i) => ({ n: i + 1, ...x }));
const TAGS = Object.fromEntries(POSTS.map((x) => [x.n, x.tags || ""]));

const api = async (p, params, method = "POST") => {
  const sep = p.includes("?") ? "&" : "?";
  const url = `https://graph.facebook.com/v23.0/${p}${sep}` + new URLSearchParams({ ...params, access_token: TOKEN });
  const r = await fetch(url, { method, signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  if (!r.ok || j.error) {
    // Meta echoes the offending query string back on syntax errors, token and
    // all. Redact before anything reaches a log or a transcript.
    const msg = JSON.stringify(j.error || j).split(TOKEN).join("<token>");
    throw new Error(`${p}: ${msg.slice(0, 260)}`);
  }
  return j;
};

// A container is not a post. Poll until FINISHED — publishing an IN_PROGRESS
// container fails, and publishing an ERROR one fails silently-looking.
async function waitReady(id, label) {
  for (let i = 0; i < 40; i++) {
    const s = await api(`${id}?fields=status_code,status`, {}, "GET");
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
      throw new Error(`${label} container ${s.status_code}: ${s.status || ""}`);
    }
    await new Promise((r) => setTimeout(r, 6000));
  }
  throw new Error(`${label} container never became FINISHED`);
}

async function publish({ videoUrl, caption, kind }) {
  const params = kind === "STORIES"
    ? { media_type: "STORIES", video_url: videoUrl }
    : { media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "true" };
  const c = await api(`${IG_USER}/media`, params);
  await waitReady(c.id, kind);
  const pub = await api(`${IG_USER}/media_publish`, { creation_id: c.id });
  return pub.id;
}

// ── the film-is-live gate ─────────────────────────────────────────────────
// These captions all say "full explainer on YouTube". If the film is still
// private — YouTube's scheduled publish slipped, or it got held for review —
// then every one of them points at a video nobody can open. Verify, don't
// assume: a scheduled publishAt is an intention, not an outcome.
if (process.argv.includes("--require-live")) {
  const t = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID, client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN, grant_type: "refresh_token" }),
  }).then((r) => r.json()).then((j) => j.access_token);
  const v = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status&id=${FILM_ID}`,
    { headers: { Authorization: `Bearer ${t}` } }).then((r) => r.json());
  const st = v.items?.[0]?.status;
  console.log(`film gate  : privacy=${st?.privacyStatus} publishAt=${st?.publishAt || "—"}`);
  if (st?.privacyStatus !== "public") {
    console.log("FILM IS NOT PUBLIC YET — refusing to post Instagram captions that point at it.");
    process.exit(2);
  }
}

// ── preflight ─────────────────────────────────────────────────────────────
const me = await api(`${IG_USER}?fields=id,username,media_count`, {}, "GET");
console.log(`IG account : ${me.username} (${me.id}) — ${me.media_count} posts`);
const q = await api(`${IG_USER}/content_publishing_limit?fields=quota_usage,config`, {}, "GET");
const used = q.data?.[0]?.quota_usage ?? "?", total = q.data?.[0]?.config?.quota_total ?? "?";
console.log(`quota      : ${used}/${total} in the last 24h`);

const chosen = ONLY ? POSTS.filter((p) => String(p.n) === String(ONLY)) : POSTS;
if (!chosen.length) throw new Error(`--only ${ONLY} matched nothing (1-5)`);

console.log(`\nwill post ${chosen.length} item(s), each as a REEL${SKIP_STORY ? "" : " + a STORY"}:`);
for (const p of chosen) {
  const local = path.join(HERE, "out/shorts", p.file);
  if (!existsSync(local)) throw new Error("missing local file: " + local);
  console.log(`  ${p.n}. ${p.file}`);
  console.log(`     url     ${BASE ? BASE + "/" + p.file : "*** --base NOT SET ***"}`);
  console.log(`     caption ${(p.caption + TAGS[p.n]).length} chars`);
}

if (!BASE) {
  console.log("\nNO --base GIVEN. Instagram fetches media from a public URL; it has no");
  console.log("upload endpoint. Point --base at an HTTPS origin serving these files.");
  process.exit(1);
}

// Prove Meta can actually fetch the URL before creating a container. A container
// built on a 404 fails minutes later with a generic media error.
console.log("\nchecking the public URLs are reachable…");
for (const p of chosen) {
  const u = `${BASE}/${p.file}`;
  try {
    const r = await fetch(u, { method: "HEAD", signal: AbortSignal.timeout(15000) });
    const len = r.headers.get("content-length");
    console.log(`  ${r.ok ? "ok " : "FAIL"} ${r.status}  ${len ? (len / 1048576).toFixed(1) + "MB" : "?"}  ${u}`);
    if (!r.ok) process.exitCode = 1;
  } catch (e) { console.log(`  FAIL  ${u} — ${e.message}`); process.exitCode = 1; }
}
if (process.exitCode) { console.log("\nat least one URL is not fetchable — refusing to continue."); process.exit(1); }

if (!confirm) { console.log("\nDRY RUN — nothing posted. Add --confirm."); process.exit(0); }

const out = [];
for (const p of chosen) {
  const videoUrl = `${BASE}/${p.file}`;
  const reel = await publish({ videoUrl, caption: p.caption + TAGS[p.n], kind: "REELS" });
  console.log(`REEL  ${p.file} → ${reel}`);
  out.push({ file: p.file, kind: "reel", id: reel });

  // STORIES IS BEST-EFFORT, DELIBERATELY.
  // Container probes on 2026-08-18 showed REELS reaching FINISHED and STORIES
  // failing with error 2207077 on the identical file — at 34s and again at 14s,
  // so it is not duration, and 2207077 appears in no public error reference.
  // Until that is understood, a Story failure must not take the Reels with it:
  // the loop used to abort on the first throw, which would have published one
  // Reel and silently dropped the other four.
  if (!SKIP_STORY) {
    try {
      const story = await publish({ videoUrl, kind: "STORIES" });
      console.log(`STORY ${p.file} → ${story}`);
      out.push({ file: p.file, kind: "story", id: story });
    } catch (e) {
      console.log(`STORY ${p.file} → SKIPPED: ${e.message.slice(0, 160)}`);
      out.push({ file: p.file, kind: "story", id: null, error: e.message.slice(0, 200) });
    }
  }
}
const reels = out.filter((o) => o.kind === "reel" && o.id).length;
const stories = out.filter((o) => o.kind === "story" && o.id).length;
console.log(`\nposted ${reels} reel(s), ${stories} story/stories`);
if (!reels) { console.log("NO REELS POSTED — treating this run as failed so it retries."); process.exitCode = 1; }
console.log("\n" + JSON.stringify(out, null, 1));
