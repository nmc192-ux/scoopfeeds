// The publish console — the approval gate before anything reaches a platform.
//
//   node console.mjs            # http://127.0.0.1:8790
//
// WHY THIS EXISTS, BEYOND THE APP REVIEW
// Publishing was five CLI stages with no single view of what had already gone
// out. On 2026-08-20 an Instagram run crashed mid-way, left no marker, and the
// poller replayed it — putting the same Reel on the account twice. Nothing
// showed that until someone opened Instagram. This page reads the same ledgers
// the publishers write, so "posted / not posted / posted TWICE" is visible
// before you press anything.
//
// It binds to 127.0.0.1 only. It holds no credentials of its own: tokens come
// from the same env files the CLI uses.

import { createServer } from "http";
import { randomBytes, createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import path from "path";
import { P, ENV_FILES, projectSlug } from "./_deps.mjs";
import { accessToken, creatorInfo, publishVideo } from "./tiktok-api.mjs";

const PORT = Number(process.env.CONSOLE_PORT || 8790);

for (const f of ENV_FILES) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const readJson = (rel, fb = null) => {
  try { return existsSync(P(rel)) ? JSON.parse(readFileSync(P(rel), "utf8")) : fb; }
  catch { return fb; }
};
const TT_LEDGER = "out/.tiktok-posted-items.json";
const TT_API = "https://open.tiktokapis.com/v2";
const PKCE = { verifier: null };

// Written back to the same env file the CLI publishers read, so a token minted
// in the console is immediately usable by tiktok-publish.mjs and the poller.
function persistRefreshToken(token) {
  // WRITE IT WHERE THE OTHER TIKTOK VARS ALREADY LIVE. This used to take the
  // first existing file in ENV_FILES, which is backend/.env — so a token minted
  // here landed in a different file from the client key and secret that minted
  // it. Both get loaded, so nothing breaks immediately; it breaks later, when
  // one file is edited or moved and the credentials silently disagree.
  const target =
    ENV_FILES.find((f) => existsSync(f) && /^TIKTOK_CLIENT_KEY=/m.test(readFileSync(f, "utf8")))
    || ENV_FILES.find((f) => existsSync(f));
  if (!target) throw new Error("no env file found to write the refresh token to");
  const lines = readFileSync(target, "utf8").split("\n")
    .filter((l) => !l.startsWith("TIKTOK_REFRESH_TOKEN="));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  lines.push(`TIKTOK_REFRESH_TOKEN=${token}`, "");
  writeFileSync(target, lines.join("\n"));
}

function state() {
  const pub = readJson("publish.json", {});
  const tt = readJson("tiktok.json", {});
  const igLedger = readJson("out/.ig-posted-items.json", {}) || {};
  const ttLedger = readJson(TT_LEDGER, {}) || {};
  const result = readJson("out/publish-result.json", {}) || {};
  const ytById = Object.fromEntries((result.youtube || []).map((y) => [y.file, y]));

  // Count Instagram posts per file so a double-post is visible as a number,
  // not as something you have to notice.
  const igCount = {};
  for (const k of Object.keys(igLedger)) {
    const [file, kind] = k.split(":");
    igCount[file] = igCount[file] || {};
    igCount[file][kind] = (igCount[file][kind] || 0) + 1;
  }

  const shorts = (pub.shorts || []).map((s) => {
    const f = P(`out/shorts/${s.file}`);
    return {
      file: s.file,
      title: s.title,
      exists: existsSync(f),
      sizeMB: existsSync(f) ? +(statSync(f).size / 1048576).toFixed(2) : 0,
      caption: (tt.posts || []).find((p) => p.file === s.file)?.title || "",
      youtube: ytById[s.file] || null,
      instagram: igCount[s.file] || null,
      tiktok: ttLedger[s.file] || null,
    };
  });

  return {
    project: projectSlug(),
    film: {
      title: pub.youtube?.title || "(untitled)",
      publishAt: pub.youtube?.publishAt || null,
      id: (result.youtube || []).find((y) => y.kind === "film")?.id || null,
    },
    tiktok: { privacy: tt.privacy || "(unset)", isAigc: tt.isAigc === true, configured: !!process.env.TIKTOK_REFRESH_TOKEN },
    shorts,
  };
}

const send = (res, code, type, body) => {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/") return send(res, 200, "text/html; charset=utf-8", PAGE);
  if (url.pathname === "/api/state") return send(res, 200, "application/json", JSON.stringify(state()));

  // Preview the actual file that will be uploaded — not a thumbnail of it.
  if (url.pathname.startsWith("/media/")) {
    const name = path.basename(decodeURIComponent(url.pathname.slice(7)));
    const f = P(`out/shorts/${name}`);
    if (!existsSync(f)) return send(res, 404, "text/plain", "no");
    const st = statSync(f);
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": st.size, "Accept-Ranges": "none" });
    return res.end(readFileSync(f));
  }

  // The code→token exchange runs HERE, not in a terminal. The console is a
  // local process, so the client secret stays on this machine either way — but
  // doing it in the UI is what makes connect → consent → code → publish a
  // single unbroken sequence a reviewer can watch. Sending someone to paste a
  // code into a shell breaks the take and demonstrates nothing.
  if (url.pathname === "/api/tiktok/exchange" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try {
      let { code } = JSON.parse(raw || "{}");
      if (!code) throw new Error("no code supplied");
      // People paste the whole redirect URL as often as the bare code.
      if (code.includes("code=")) {
        try { code = new URL(code).searchParams.get("code") || code; } catch { /* not a URL */ }
      }
      code = decodeURIComponent(String(code).trim().replace(/\*$/, ""));
      if (!PKCE.verifier) throw new Error("no pending authorisation — press Connect TikTok first");

      const r = await fetch(`${TT_API}/oauth/token/`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: process.env.TIKTOK_CLIENT_KEY,
          client_secret: process.env.TIKTOK_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: process.env.TIKTOK_REDIRECT_URI || "https://scoopfeeds.com/tiktok/callback",
          code_verifier: PKCE.verifier,
        }),
      });
      const j = await r.json();
      if (!j.access_token) throw new Error(j.error_description || j.error || JSON.stringify(j).slice(0, 200));

      persistRefreshToken(j.refresh_token);
      process.env.TIKTOK_REFRESH_TOKEN = j.refresh_token;
      PKCE.verifier = null;
      return send(res, 200, "application/json", JSON.stringify({
        ok: true, open_id: j.open_id, scopes: (j.scope || "").split(",").filter(Boolean),
        refresh_expires_in: j.refresh_expires_in,
      }));
    } catch (e) {
      return send(res, 200, "application/json", JSON.stringify({ error: e.message }));
    }
  }

  if (url.pathname === "/api/tiktok/connect") {
    const key = process.env.TIKTOK_CLIENT_KEY;
    if (!key) return send(res, 200, "application/json",
      JSON.stringify({ error: "TIKTOK_CLIENT_KEY not set — run scripts/tiktok-auth.mjs first" }));
    const redirect = process.env.TIKTOK_REDIRECT_URI || "https://scoopfeeds.com/tiktok/callback";
    const scopes = process.env.TIKTOK_SCOPES || "user.info.basic,video.publish,video.upload";
    PKCE.verifier = randomBytes(48).toString("hex");
    const challenge = createHash("sha256").update(PKCE.verifier).digest("base64url");
    return send(res, 200, "application/json", JSON.stringify({
      authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/?" + new URLSearchParams({
        client_key: key, scope: scopes, response_type: "code",
        redirect_uri: redirect, state: "console",
        code_challenge: challenge, code_challenge_method: "S256",
      }),
      redirect, scopes: scopes.split(","),
    }));
  }

  if (url.pathname === "/api/tiktok/whoami") {
    try {
      const { token, scopes } = await accessToken();
      const info = await creatorInfo(token);
      return send(res, 200, "application/json", JSON.stringify({
        username: info.creator_username, nickname: info.creator_nickname,
        privacyOptions: info.privacy_level_options || [],
        maxDurationSec: info.max_video_post_duration_sec, scopes,
      }));
    } catch (e) { return send(res, 200, "application/json", JSON.stringify({ error: e.message })); }
  }

  // Server-sent events: one message per stage of the real API flow.
  if (url.pathname === "/api/tiktok/publish") {
    const file = path.basename(url.searchParams.get("file") || "");
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    const emit = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    try {
      const tt = readJson("tiktok.json", {});
      const post = (tt.posts || []).find((p) => p.file === file);
      if (!post) throw new Error(`${file} is not in tiktok.json`);

      const ledger = readJson(TT_LEDGER, {}) || {};
      if (ledger[file]) {
        emit({ step: "guard", state: "fail",
               detail: `already posted ${ledger[file].at} as ${ledger[file].publish_id} — refusing to post twice` });
        return res.end();
      }

      emit({ step: "auth", state: "run", detail: "refreshing access token" });
      const { token, scopes } = await accessToken();
      emit({ step: "auth", state: "ok", detail: `granted scopes: ${scopes.join(", ")}` });

      const out = await publishVideo({
        token, file: P(`out/shorts/${file}`), title: post.title,
        privacy: tt.privacy || "SELF_ONLY", isAigc: tt.isAigc === true,
        onStep: (step, state, detail) => emit({ step, state, detail }),
      });

      ledger[file] = { ...out, at: new Date().toISOString() };
      writeFileSync(P(TT_LEDGER), JSON.stringify(ledger, null, 2));
      emit({ step: "done", state: "ok", detail: `${out.status} · ${out.privacy} · ${out.publish_id}` });
    } catch (e) {
      emit({ step: "done", state: "fail", detail: e.message });
    }
    return res.end();
  }

  send(res, 404, "text/plain", "not found");
});

const PAGE = readFileSync(new URL("./console.html", import.meta.url), "utf8");

server.listen(PORT, "127.0.0.1", () => {
  console.log(`publish console  →  http://127.0.0.1:${PORT}`);
  console.log(`project          →  ${projectSlug()}`);
  console.log(`tiktok           →  privacy ${readJson("tiktok.json", {}).privacy || "(unset)"}, ` +
              `token ${process.env.TIKTOK_REFRESH_TOKEN ? "present" : "MISSING"}`);
});
