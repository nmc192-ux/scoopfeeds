#!/usr/bin/env node
/**
 * youtube-auth.mjs  —  One-time OAuth2 setup for YouTube Shorts uploads.
 *
 * Run this locally (NOT on the server) after creating your Google Cloud credentials:
 *   1. Go to https://console.cloud.google.com/
 *   2. Create / select a project → Enable "YouTube Data API v3"
 *   3. APIs & Services → Credentials → Create OAuth Client ID → Desktop App
 *   4. Set env vars:
 *        export YOUTUBE_CLIENT_ID=...
 *        export YOUTUBE_CLIENT_SECRET=...
 *   5. Run:  node backend/scripts/youtube-auth.mjs
 *   6. A browser tab opens — grant access → the refresh token is printed.
 *   7. Add these three env vars in Hostinger → Save and redeploy:
 *        YOUTUBE_CLIENT_ID
 *        YOUTUBE_CLIENT_SECRET
 *        YOUTUBE_REFRESH_TOKEN
 */

import http from "http";
import { exec } from "child_process";
import { promisify } from "util";
import { URL } from "url";

const execAsync = promisify(exec);

const CLIENT_ID     = process.env.YOUTUBE_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET?.trim();

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(`
❌  Missing environment variables.

Set them first:
  export YOUTUBE_CLIENT_ID=your_client_id
  export YOUTUBE_CLIENT_SECRET=your_client_secret

Then re-run: node backend/scripts/youtube-auth.mjs
`);
  process.exit(1);
}

const PORT         = 8085;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES       = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id:              CLIENT_ID,
  redirect_uri:           REDIRECT_URI,
  response_type:          "code",
  scope:                  SCOPES,
  access_type:            "offline",
  prompt:                 "consent",   // always ask so we always get a refresh token
}).toString();

// ─── Local callback server ────────────────────────────────────────────────────

let resolveCode, rejectCode;
const codePromise = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/callback") {
    res.writeHead(404); res.end("Not found"); return;
  }
  const code  = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (error) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<h2>❌ Auth error: ${error}</h2><p>You can close this tab.</p>`);
    rejectCode(new Error(`OAuth error: ${error}`));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`
    <h2>✅ Authorised!</h2>
    <p>You can close this tab and return to the terminal.</p>
    <script>window.close();</script>
  `);
  resolveCode(code);
});

server.listen(PORT, () => {
  console.log(`\n🔑  YouTube OAuth — one-time setup\n`);
  console.log(`Opening browser for Google login…`);
  console.log(`Auth URL:\n${AUTH_URL}\n`);

  // Try to open the browser automatically
  const open = process.platform === "darwin" ? "open"
             : process.platform === "win32"  ? "start"
             : "xdg-open";
  exec(`${open} "${AUTH_URL}"`);
});

// ─── Token exchange ───────────────────────────────────────────────────────────

try {
  const code = await codePromise;
  server.close();

  console.log("✅  Auth code received — exchanging for tokens…");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    "authorization_code",
    }).toString(),
  });

  const tokens = await tokenRes.json();

  if (!tokenRes.ok || !tokens.refresh_token) {
    console.error("❌  Token exchange failed:", JSON.stringify(tokens, null, 2));
    process.exit(1);
  }

  console.log(`
╔══════════════════════════════════════════════════════════╗
║        YouTube OAuth — COMPLETE  ✅                      ║
╚══════════════════════════════════════════════════════════╝

Add these THREE env vars to Hostinger → Settings and redeploy:

  YOUTUBE_CLIENT_ID      = ${CLIENT_ID}
  YOUTUBE_CLIENT_SECRET  = ${CLIENT_SECRET}
  YOUTUBE_REFRESH_TOKEN  = ${tokens.refresh_token}

Access token (expires in ~1h, auto-refreshed by server):
  ${tokens.access_token?.slice(0, 40)}…

Done! YouTube Shorts auto-posting is now enabled.
`);

} catch (err) {
  server.close();
  console.error("❌  Error:", err.message);
  process.exit(1);
}
