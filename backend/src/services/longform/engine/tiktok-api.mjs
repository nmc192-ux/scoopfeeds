// The TikTok Content Posting flow, as steps.
//
// Shared by tiktok-publish.mjs (CLI) and console.mjs (UI) so the two cannot
// drift. Every stage reports through `onStep`, which is what lets the console
// show creator_info → init → upload → polling as they actually happen rather
// than as a spinner and a result.

import { readFileSync, statSync } from "fs";

export const API = "https://open.tiktokapis.com/v2";

export async function accessToken(env = process.env) {
  for (const k of ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REFRESH_TOKEN"]) {
    if (!env[k]) throw new Error(`${k} not set — run scripts/tiktok-auth.mjs`);
  }
  const r = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY,
      client_secret: env.TIKTOK_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: env.TIKTOK_REFRESH_TOKEN,
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("token refresh failed: " + JSON.stringify(j).slice(0, 300));
  return { token: j.access_token, scopes: (j.scope || "").split(",").filter(Boolean) };
}

export async function call(token, endpoint, body) {
  const r = await fetch(`${API}${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json();
  if (j.error && j.error.code && j.error.code !== "ok") {
    throw new Error(`${endpoint} → ${j.error.code}: ${j.error.message || ""}`);
  }
  return j.data;
}

export const creatorInfo = (token) => call(token, "/post/publish/creator_info/query/");

/**
 * One video, end to end. `onStep(name, state, detail)` fires for every stage:
 * state is "run" | "ok" | "fail".
 */
export async function publishVideo({ token, file, title, privacy, isAigc, onStep = () => {} }) {
  const step = (n, s, d) => onStep(n, s, d);

  step("creator_info", "run", "querying account and permitted privacy levels");
  const info = await creatorInfo(token);
  const opts = info.privacy_level_options || [];
  step("creator_info", "ok",
    `@${info.creator_username || "?"} · options: ${opts.join(", ") || "none"}`);

  // THE AUDIT GATE. An un-audited client is offered SELF_ONLY and nothing else,
  // and TikTok does not reject a public request — it silently downgrades it.
  // Refuse rather than post something the account holder believes is public.
  if (!opts.includes(privacy)) {
    const msg = `${privacy} not offered — this client may only post: ${opts.join(", ") || "nothing"}`;
    step("creator_info", "fail", msg);
    const e = new Error(msg); e.code = "PRIVACY_NOT_ALLOWED"; throw e;
  }

  const size = statSync(file).size;
  step("video_init", "run", `${(size / 1048576).toFixed(2)} MB, single chunk`);
  const init = await call(token, "/post/publish/video/init/", {
    post_info: {
      title,
      privacy_level: privacy,
      disable_comment: false, disable_duet: false, disable_stitch: false,
      is_aigc: isAigc === true,
    },
    source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 },
  });
  step("video_init", "ok", `publish_id ${init.publish_id}`);

  step("upload", "run", "PUT bytes to the signed upload URL");
  const put = await fetch(init.upload_url, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Content-Range": `bytes 0-${size - 1}/${size}`,
    },
    body: readFileSync(file),
  });
  if (!put.ok) {
    const t = (await put.text()).slice(0, 200);
    step("upload", "fail", `HTTP ${put.status} ${t}`);
    throw new Error(`upload failed ${put.status}: ${t}`);
  }
  step("upload", "ok", `HTTP ${put.status}`);

  // TikTok accepts the bytes and can still reject the video afterwards, so a
  // 200 on the PUT is not a published post.
  step("status", "run", "polling until PUBLISH_COMPLETE");
  let status = "PROCESSING_UPLOAD", fail = null;
  for (let i = 0; i < 30 && !/PUBLISH_COMPLETE|FAILED/.test(status); i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await call(token, "/post/publish/status/fetch/", { publish_id: init.publish_id });
    status = s.status; fail = s.fail_reason || null;
    step("status", "run", `${status}${fail ? " — " + fail : ""}`);
  }
  if (status !== "PUBLISH_COMPLETE") {
    step("status", "fail", `${status}${fail ? " — " + fail : ""}`);
    throw new Error(`publish ended ${status}${fail ? ": " + fail : ""}`);
  }
  step("status", "ok", status);
  return { publish_id: init.publish_id, status, privacy };
}
