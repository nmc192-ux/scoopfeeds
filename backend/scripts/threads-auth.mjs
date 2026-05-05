#!/usr/bin/env node
/**
 * threads-auth.mjs  —  One-time OAuth2 setup for Threads auto-posting.
 *
 * App: "Scoopfeeds" (Threads App ID: 1931953940773402  /  FB App: 936089979063323)
 *   https://developers.facebook.com/apps/936089979063323/use_cases/customize/settings/?use_case_enum=THREADS_API
 *
 * Prerequisites (all one-time steps in the Meta developer portal):
 *   1. Meta for Developers → App → Threads API → Settings
 *      Add "https://localhost:8087/callback" to Redirect Callback URLs → Save
 *   2. App Roles → Roles → Add Testers → search "scoop_feeds" → send invite
 *   3. The scoop_feeds Threads account must accept the invite:
 *      instagram.com → Settings → Apps and Websites → Tester invites → Accept
 *   4. Set env vars and run:
 *        export THREADS_APP_ID=1931953940773402
 *        export THREADS_APP_SECRET=<secret from Threads API Settings page>
 *        node backend/scripts/threads-auth.mjs
 *   5. Add to Hostinger env vars and redeploy:
 *        THREADS_ACCESS_TOKEN  = (printed by this script)
 *        THREADS_USER_ID       = (printed by this script)
 *        THREADS_HANDLE        = scoop_feeds
 *
 * Token lifetime: ~60 days. threadsClient.js auto-refreshes when < 7 days remain.
 * Re-run this script if a refresh cycle is missed and the token expires.
 */

import https from "https";
import fs from "fs";
import { exec } from "child_process";
import { URL } from "url";

const APP_ID     = process.env.THREADS_APP_ID?.trim()     || "1931953940773402";
const APP_SECRET = process.env.THREADS_APP_SECRET?.trim();

if (!APP_SECRET) {
  console.error(`
❌  Missing THREADS_APP_SECRET.

Get it from:
  https://developers.facebook.com/apps/936089979063323/use_cases/customize/settings/?use_case_enum=THREADS_API
  (Threads API → Settings → "App secret" field — click "Show")

Then run:
  export THREADS_APP_ID=1931953940773402
  export THREADS_APP_SECRET=<your_secret>
  node backend/scripts/threads-auth.mjs
`);
  process.exit(1);
}

// TLS cert paths — generated once via:
//   openssl req -x509 -newkey rsa:2048 -keyout /tmp/threads-local.key \
//     -out /tmp/threads-local.crt -days 7 -nodes -subj "/CN=localhost"
const TLS_KEY  = process.env.TLS_KEY  || "/tmp/threads-local.key";
const TLS_CERT = process.env.TLS_CERT || "/tmp/threads-local.crt";

const PORT         = 8087;
const REDIRECT_URI = `https://localhost:${PORT}/callback`;

// Scopes needed for reading profile + publishing content.
const SCOPE = "threads_basic,threads_content_publish";

const AUTH_URL =
  "https://threads.net/oauth/authorize?" +
  new URLSearchParams({
    client_id:     APP_ID,
    redirect_uri:  REDIRECT_URI,
    scope:         SCOPE,
    response_type: "code",
  }).toString();

// ─── Local callback server ────────────────────────────────────────────────────

let resolveCode, rejectCode;
const codePromise = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });

const tlsOptions = {
  key:  fs.readFileSync(TLS_KEY),
  cert: fs.readFileSync(TLS_CERT),
};

const server = https.createServer(tlsOptions, (req, res) => {
  const url = new URL(req.url, `https://localhost:${PORT}`);
  if (url.pathname !== "/callback") { res.writeHead(404); res.end("Not found"); return; }

  const code  = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  res.writeHead(200, { "Content-Type": "text/html" });
  if (error) {
    res.end(`<h2>❌ Auth error: ${error}</h2><p>${url.searchParams.get("error_description") || ""}</p><p>You can close this tab.</p>`);
    rejectCode(new Error(`OAuth error: ${error} — ${url.searchParams.get("error_description") || ""}`));
    return;
  }
  res.end(`<h2>✅ Authorised!</h2><p>You can close this tab and return to the terminal.</p><script>window.close();</script>`);
  resolveCode(code);
});

server.listen(PORT, () => {
  console.log(`\n🔑  Threads OAuth — one-time setup\n`);
  console.log(`Opening browser for Threads login…`);

  const open =
    process.platform === "darwin" ? "open" :
    process.platform === "win32"  ? "start" : "xdg-open";
  exec(`${open} "${AUTH_URL}"`);

  console.log(`\nAuth URL (open manually if browser didn't open):\n${AUTH_URL}\n`);
});

// ─── Token exchange ───────────────────────────────────────────────────────────

try {
  const code = await codePromise;
  server.close();
  console.log("\n✅  Auth code received — exchanging for short-lived token…");

  // Step 1 — short-lived token (valid 1 hour).
  const shortRes = await fetch("https://graph.threads.net/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     APP_ID,
      client_secret: APP_SECRET,
      grant_type:    "authorization_code",
      redirect_uri:  REDIRECT_URI,
      code,
    }).toString(),
  });

  const shortData = await shortRes.json();
  if (!shortRes.ok || !shortData.access_token) {
    console.error("❌  Short-lived token exchange failed:", JSON.stringify(shortData, null, 2));
    process.exit(1);
  }
  console.log("✅  Short-lived token obtained — exchanging for long-lived token (~60 days)…");

  // Step 2 — exchange for long-lived token (~60 days).
  const longRes = await fetch(
    `https://graph.threads.net/access_token?` +
    new URLSearchParams({
      grant_type:    "th_exchange_token",
      client_secret: APP_SECRET,
      access_token:  shortData.access_token,
    }).toString()
  );

  const longData = await longRes.json();
  if (!longRes.ok || !longData.access_token) {
    console.error("❌  Long-lived token exchange failed:", JSON.stringify(longData, null, 2));
    process.exit(1);
  }
  console.log("✅  Long-lived token obtained — fetching user ID…");

  // Step 3 — resolve Threads user ID via /me.
  const meRes = await fetch(
    `https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(longData.access_token)}`
  );
  const me = await meRes.json();
  if (!meRes.ok || !me.id) {
    console.error("❌  /me call failed:", JSON.stringify(me, null, 2));
    process.exit(1);
  }

  const expiresInDays = longData.expires_in
    ? Math.round(Number(longData.expires_in) / 86400)
    : 60;

  console.log(`
╔══════════════════════════════════════════════════════════╗
║        Threads OAuth — COMPLETE  ✅                      ║
╚══════════════════════════════════════════════════════════╝

Authorized as: @${me.username} (ID: ${me.id})
Token expires: ~${expiresInDays} days

Add these env vars to Hostinger → Settings and redeploy:

  THREADS_ACCESS_TOKEN  = ${longData.access_token}
  THREADS_USER_ID       = ${me.id}
  THREADS_HANDLE        = ${me.username}

Note: threadsClient.js auto-refreshes when < 7 days remain.
      Re-run this script if the token ever fully expires (401 errors).

Done! Threads auto-posting is now enabled.
`);

} catch (err) {
  server.close();
  console.error("❌  Error:", err.message);
  process.exit(1);
}
