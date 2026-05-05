#!/usr/bin/env node
/**
 * pinterest-auth.mjs  —  One-time OAuth2 setup for Pinterest auto-posting.
 *
 * Creates a Pinterest Developer App, authorizes it against the scoopfeeds
 * Pinterest Business account, and prints the access + refresh tokens.
 *
 * Prerequisites:
 *   1. Go to https://developers.pinterest.com/ → Create App
 *      - App name: "Scoopfeeds Autoposter"
 *      - Add redirect URI: http://localhost:8088/callback
 *   2. Connect a Pinterest Business account to the app
 *      (Apps → your app → Auth → "Connect account")
 *   3. Set env vars and run:
 *        export PINTEREST_APP_ID=<your app ID / client ID>
 *        export PINTEREST_APP_SECRET=<your app secret>
 *        node backend/scripts/pinterest-auth.mjs
 *   4. After running, note the board IDs printed and pick the one to post to.
 *   5. Add to Hostinger env vars and redeploy:
 *        PINTEREST_ACCESS_TOKEN  = (printed by this script)
 *        PINTEREST_REFRESH_TOKEN = (printed by this script — keep for renewal)
 *        PINTEREST_BOARD_ID      = (pick from board list printed below)
 *
 * Token lifetime: Access tokens expire in 30 days; refresh tokens in 1 year.
 * Re-run this script (or exchange the refresh token) before expiry.
 *
 * API reference:
 *   https://developers.pinterest.com/docs/getting-started/authentication/
 *   https://developers.pinterest.com/docs/api/v5/oauth-token/
 */

import http from "http";
import { exec } from "child_process";
import { URL } from "url";

const APP_ID     = process.env.PINTEREST_APP_ID?.trim();
const APP_SECRET = process.env.PINTEREST_APP_SECRET?.trim();

if (!APP_ID || !APP_SECRET) {
  console.error(`
❌  Missing environment variables.

Create a Pinterest app at https://developers.pinterest.com/ then run:
  export PINTEREST_APP_ID=<your_app_id>
  export PINTEREST_APP_SECRET=<your_app_secret>
  node backend/scripts/pinterest-auth.mjs
`);
  process.exit(1);
}

const PORT         = 8088;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

// Scopes: read user + read/write boards + read/write pins.
const SCOPE = [
  "user_accounts:read",
  "boards:read",
  "boards:write",
  "pins:read",
  "pins:write",
].join(",");

const STATE = Math.random().toString(36).slice(2);

const AUTH_URL =
  "https://www.pinterest.com/oauth/?" +
  new URLSearchParams({
    client_id:     APP_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: "code",
    scope:         SCOPE,
    state:         STATE,
  }).toString();

// ─── Local callback server ────────────────────────────────────────────────────

let resolveCode, rejectCode;
const codePromise = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/callback") { res.writeHead(404); res.end("Not found"); return; }

  const code  = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  res.writeHead(200, { "Content-Type": "text/html" });
  if (error) {
    res.end(`<h2>❌ Auth error: ${error}</h2><p>You can close this tab.</p>`);
    rejectCode(new Error(`OAuth error: ${error}`));
    return;
  }
  res.end(`<h2>✅ Authorised!</h2><p>You can close this tab and return to the terminal.</p><script>window.close();</script>`);
  resolveCode(code);
});

server.listen(PORT, () => {
  console.log(`\n🔑  Pinterest OAuth — one-time setup\n`);
  console.log(`Opening browser for Pinterest login…`);

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
  console.log("\n✅  Auth code received — exchanging for tokens…");

  const credentials = Buffer.from(`${APP_ID}:${APP_SECRET}`).toString("base64");

  const tokenRes = await fetch("https://api.pinterest.com/v5/oauth/token", {
    method:  "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type":  "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type:   "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });

  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.access_token) {
    console.error("❌  Token exchange failed:", JSON.stringify(tokens, null, 2));
    process.exit(1);
  }
  console.log("✅  Tokens obtained — fetching user info and boards…");

  // Fetch user info.
  const userRes = await fetch("https://api.pinterest.com/v5/user_account", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const user = await userRes.json();

  // Fetch boards so the user can pick the right board ID.
  const boardsRes = await fetch(
    "https://api.pinterest.com/v5/boards?page_size=25&privacy=PUBLIC",
    { headers: { Authorization: `Bearer ${tokens.access_token}` } }
  );
  const boardsData = await boardsRes.json();
  const boards = boardsData.items || [];

  const boardList = boards.length
    ? boards.map(b => `  ${b.id}  →  ${b.name}`).join("\n")
    : "  (no public boards found — create one on pinterest.com first)";

  const accessExpiry = tokens.expires_in
    ? `${Math.round(tokens.expires_in / 86400)} days`
    : "30 days";
  const refreshExpiry = tokens.refresh_token_expires_in
    ? `${Math.round(tokens.refresh_token_expires_in / 86400)} days`
    : "1 year";

  console.log(`
╔══════════════════════════════════════════════════════════╗
║        Pinterest OAuth — COMPLETE  ✅                    ║
╚══════════════════════════════════════════════════════════╝

Authorized as: ${user.username || "(unknown)"} (${user.account_type || "business"})
Access token expires:  ~${accessExpiry}
Refresh token expires: ~${refreshExpiry}

Your boards:
${boardList}

Add these env vars to Hostinger → Settings and redeploy:

  PINTEREST_ACCESS_TOKEN   = ${tokens.access_token}
  PINTEREST_REFRESH_TOKEN  = ${tokens.refresh_token || "(none — re-run script to refresh)"}
  PINTEREST_BOARD_ID       = <pick a board ID from the list above>

Note: Access token expires in ~${accessExpiry}. Use PINTEREST_REFRESH_TOKEN
      with the /v5/oauth/token (grant_type=refresh_token) flow to renew,
      or just re-run this script.

Done! Pinterest auto-posting is now enabled.
`);

} catch (err) {
  server.close();
  console.error("❌  Error:", err.message);
  process.exit(1);
}
