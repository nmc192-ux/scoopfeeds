// TikTok Content Posting API — direct post of a film's Shorts.
//
//   node tiktok-publish.mjs                    # dry run: verifies auth, creator
//                                              # info and privacy options, posts nothing
//   node tiktok-publish.mjs --confirm          # posts
//   node tiktok-publish.mjs --confirm --require-live   # …only once the film is public
//
// TWO API FACTS THIS FILE IS BUILT AROUND, BOTH VERIFIED AGAINST TIKTOK'S DOCS:
//
//   1. THERE IS NO SCHEDULING. The Content Posting API has no publish_at or
//      schedule_time on any endpoint — a post happens when you call it. So
//      "scheduled TikTok posting" is always a process that wakes up and posts,
//      the same shape as Instagram. tiktok-setup.sh installs that poller.
//
//   2. AN UNAUDITED CLIENT CAN ONLY POST SELF_ONLY. TikTok restricts every post
//      from an un-audited app to private viewing. The audit is what lifts it.
//      This script therefore READS creator_info and refuses to post unless the
//      privacy level it was asked for is actually offered — rather than posting
//      five videos nobody can see and reporting success.
//
// Bytes go up by FILE_UPLOAD, not PULL_FROM_URL: PULL_FROM_URL requires a
// verified domain, and these files exist only on this Mac.

import { readFileSync, existsSync, statSync } from "fs";
import path from "path";
import { P, ENV_FILES } from "./_deps.mjs";

const API = "https://open.tiktokapis.com/v2";
const CONFIRM = process.argv.includes("--confirm");

for (const f of ENV_FILES) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const CFG_PATH = P("tiktok.json");
if (!existsSync(CFG_PATH)) {
  console.error(`no tiktok.json in ${P(".")} — nothing to post.`);
  console.error(`It needs: { "filmId": "<youtube id>", "privacy": "PUBLIC_TO_EVERYONE",`);
  console.error(`            "posts": [{ "file": "01_x.mp4", "title": "caption text" }] }`);
  process.exit(1);
}
const CFG = JSON.parse(readFileSync(CFG_PATH, "utf8"));
if (!CFG.filmId || !Array.isArray(CFG.posts) || !CFG.posts.length) {
  console.error("tiktok.json needs \"filmId\" and a non-empty \"posts\" array.");
  process.exit(1);
}
const WANT_PRIVACY = CFG.privacy || "PUBLIC_TO_EVERYONE";

// ── auth ──────────────────────────────────────────────────────────────────
async function accessToken() {
  for (const k of ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REFRESH_TOKEN"]) {
    if (!process.env[k]) throw new Error(`${k} not set — see references/platform-apis.md`);
  }
  const r = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: process.env.TIKTOK_REFRESH_TOKEN,
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("tiktok token refresh failed: " + JSON.stringify(j).slice(0, 300));
  return j.access_token;
}

const api = async (token, endpoint, body) => {
  const r = await fetch(`${API}${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json();
  if (j.error && j.error.code && j.error.code !== "ok") {
    throw new Error(`${endpoint} → ${j.error.code}: ${j.error.message || ""} (log_id ${j.error.log_id || "?"})`);
  }
  return j.data;
};

const token = await accessToken();

// ── who are we posting as, and what may we post? ──────────────────────────
const info = await api(token, "/post/publish/creator_info/query/");
const opts = info.privacy_level_options || [];
console.log(`creator     : @${info.creator_username || "?"}  (${info.creator_nickname || ""})`);
console.log(`privacy opts: ${opts.join(", ") || "(none returned)"}`);
console.log(`max duration: ${info.max_video_post_duration_sec ?? "?"}s`);

// THE AUDIT GATE. An unaudited client is handed SELF_ONLY and nothing else.
// Posting anyway would put five videos on the account that only the account
// holder can see, and report success — the exact failure this file exists to
// avoid. Fail loudly and name the cause instead.
if (!opts.includes(WANT_PRIVACY)) {
  console.log(`\nTikTok will not accept ${WANT_PRIVACY} for this client.`);
  console.log(`Offered: ${opts.join(", ") || "nothing"}.`);
  console.log(`This is the un-audited restriction: every post from a client that has not`);
  console.log(`passed TikTok's Content Posting API audit is forced to private viewing.`);
  console.log(`Nothing posted. Re-run once the audit is approved.`);
  process.exit(3);
}

// ── the film-is-live gate ─────────────────────────────────────────────────
// The captions point at the YouTube film. If YouTube's scheduled publish
// slipped or the video was held for review, every caption points at something
// nobody can open. Verify, don't assume.
if (process.argv.includes("--require-live")) {
  const t = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID, client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN, grant_type: "refresh_token" }),
  }).then((r) => r.json()).then((j) => j.access_token);
  const v = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status&id=${CFG.filmId}`,
    { headers: { Authorization: `Bearer ${t}` } }).then((r) => r.json());
  const st = v.items?.[0]?.status;
  console.log(`film gate   : privacy=${st?.privacyStatus} publishAt=${st?.publishAt || "—"}`);
  if (st?.privacyStatus !== "public") {
    console.log("FILM IS NOT PUBLIC YET — refusing to post captions that point at it.");
    process.exit(2);
  }
}

// ── preflight ─────────────────────────────────────────────────────────────
const SHORTS = P("out/shorts");
const posts = CFG.posts.map((p) => {
  const file = path.join(SHORTS, p.file);
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  return { ...p, file, size: statSync(file).size };
});
console.log();
for (const p of posts) {
  console.log(`  ${path.basename(p.file).padEnd(34)} ${(p.size / 1048576).toFixed(2)} MB  "${p.title.slice(0, 60)}"`);
}
if (!CONFIRM) {
  console.log("\nDRY RUN — nothing posted. Re-run with --confirm.");
  process.exit(0);
}

// ── post ──────────────────────────────────────────────────────────────────
// Single chunk: TikTok requires 5-64 MB chunks, and every file here is well
// under 64 MB, so chunking would only add failure modes.
const out = [];
for (const p of posts) {
  console.log(`\n${path.basename(p.file)}`);
  const init = await api(token, "/post/publish/video/init/", {
    post_info: {
      title: p.title,
      privacy_level: WANT_PRIVACY,
      disable_comment: false, disable_duet: false, disable_stitch: false,
      // AIGC DISCLOSURE IS PER-PLATFORM, NOT ONE GLOBAL BOOLEAN. This used to
      // read publish.json's `syntheticContent`, which is the YouTube
      // "altered or synthetic content" answer — and the two thresholds differ.
      // The Ebola film contains no AI imagery, so YouTube's flag is false, but
      // its narration is a synthesised voice, which TikTok's AIGC label covers.
      // Sharing one field would have under-declared on TikTok.
      is_aigc: CFG.isAigc === true,
    },
    source_info: {
      source: "FILE_UPLOAD",
      video_size: p.size,
      chunk_size: p.size,
      total_chunk_count: 1,
    },
  });
  console.log(`  publish_id : ${init.publish_id}`);

  const put = await fetch(init.upload_url, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(p.size),
      "Content-Range": `bytes 0-${p.size - 1}/${p.size}`,
    },
    body: readFileSync(p.file),
  });
  if (!put.ok) throw new Error(`upload failed ${put.status}: ${(await put.text()).slice(0, 200)}`);
  console.log(`  uploaded   : ${put.status}`);

  // TikTok processes asynchronously and can reject a file AFTER accepting it.
  let status = "PROCESSING_UPLOAD";
  for (let i = 0; i < 20 && !/PUBLISH_COMPLETE|FAILED/.test(status); i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await api(token, "/post/publish/status/fetch/", { publish_id: init.publish_id });
    status = s.status;
    if (s.fail_reason) console.log(`  fail_reason: ${s.fail_reason}`);
  }
  console.log(`  status     : ${status}`);
  out.push({ file: path.basename(p.file), publish_id: init.publish_id, status });
}

console.log("\n" + JSON.stringify(out, null, 1));
const done = out.filter((o) => o.status === "PUBLISH_COMPLETE").length;
console.log(`\nposted ${done}/${out.length}`);
process.exit(done === out.length ? 0 : 1);
