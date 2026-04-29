#!/usr/bin/env node
/**
 * tiktok-auth.mjs — one-time PKCE OAuth2 flow to get a TikTok refresh token.
 *
 * Run this locally (on your machine, not on the server):
 *   TIKTOK_CLIENT_KEY=xxx TIKTOK_CLIENT_SECRET=yyy node scripts/tiktok-auth.mjs
 *
 * It will:
 *   1. Start a temporary HTTP server on port 8788 to catch the OAuth redirect.
 *   2. Print an authorisation URL — open it in a browser and grant access.
 *   3. Exchange the code for tokens automatically.
 *   4. Print the access_token, refresh_token, and open_id.
 *   5. Instructions to set env vars in Hostinger, then redeploy.
 *
 * Required TikTok Developer Portal setup:
 *   1. Create an app at https://developers.tiktok.com
 *   2. Add "Login Kit" + "Content Posting API" products
 *   3. Submit for App Review (Content Posting API requires approval; ~1–2 weeks)
 *   4. In app settings → Redirect URIs, add: http://localhost:8788/callback
 *   5. Once approved, run this script.
 *
 * Required scopes: video.publish (+ video.upload for Direct Post).
 */

import * as http from "http";
import * as crypto from "crypto";
import * as readline from "readline";

const CLIENT_KEY    = process.env.TIKTOK_CLIENT_KEY?.trim();
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET?.trim();

if (!CLIENT_KEY || !CLIENT_SECRET) {
  console.error("❌  Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET first:");
  console.error("    TIKTOK_CLIENT_KEY=xxx TIKTOK_CLIENT_SECRET=yyy node scripts/tiktok-auth.mjs");
  process.exit(1);
}

const PORT         = 8788;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES       = "video.publish,video.upload";

// ─── PKCE helpers ─────────────────────────────────────────────────────────────
// TikTok requires PKCE (RFC 7636) for all OAuth2 flows as of v2.

function generateCodeVerifier() {
  // 96 random bytes → 128-char base64url string (well within 43-128 char range)
  return crypto.randomBytes(96).toString("base64url");
}

function generateCodeChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function generateState() {
  return crypto.randomBytes(16).toString("hex");
}

// ─── Start a one-shot local callback server ────────────────────────────────
async function listenForCallback() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url    = new URL(req.url, `http://localhost:${PORT}`);
        const code   = url.searchParams.get("code");
        const errMsg = url.searchParams.get("error_description") || url.searchParams.get("error");

        if (errMsg) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<html><body><h2>❌ Auth failed: ${errMsg}</h2><p>You can close this tab.</p></body></html>`);
          server.close();
          reject(new Error(`TikTok auth denied: ${errMsg}`));
          return;
        }

        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`<html><body><h2>✅ Authorised!</h2><p>You can close this tab and check your terminal.</p></body></html>`);
          server.close();
          resolve(code);
        }
      } catch (e) {
        // Not a well-formed URL — ignore (e.g. favicon request)
      }
    });

    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`🔌  Callback server listening on http://localhost:${PORT}/callback`);
    });

    // 5-minute timeout
    setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for callback (5 min)"));
    }, 5 * 60 * 1000);
  });
}

// ─── Token exchange ────────────────────────────────────────────────────────
async function exchangeCodeForTokens(code, codeVerifier) {
  const body = new URLSearchParams({
    client_key:    CLIENT_KEY,
    client_secret: CLIENT_SECRET,
    code,
    grant_type:    "authorization_code",
    redirect_uri:  REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });

  const json = await res.json();
  if (!res.ok || !json.data?.access_token) {
    throw new Error(`Token exchange failed (${res.status}): ${json.message || JSON.stringify(json)}`);
  }
  return json.data; // { access_token, refresh_token, open_id, expires_in, refresh_expires_in, scope, token_type }
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const codeVerifier  = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state         = generateState();

  const authUrl =
    `https://www.tiktok.com/v2/auth/authorize/?` +
    `client_key=${encodeURIComponent(CLIENT_KEY)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${state}` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256`;

  console.log("\n─────────────────────────────────────────────────────────────────");
  console.log("  TikTok Content Posting API — OAuth2 PKCE Setup");
  console.log("─────────────────────────────────────────────────────────────────\n");
  console.log("📋  BEFORE you run this, make sure:\n");
  console.log("   • Your TikTok app has Content Posting API approved");
  console.log(`   • Redirect URI  http://localhost:${PORT}/callback  is whitelisted in the app\n`);
  console.log("1️⃣   Open this URL in a browser (signed into the TikTok account):\n");
  console.log("    " + authUrl);
  console.log("\n2️⃣   Grant access — you'll be redirected automatically.\n");

  let code;
  try {
    code = await listenForCallback();
  } catch (err) {
    console.error(`\n❌  ${err.message}`);
    console.error("    Tip: if the browser showed an error, double-check that:");
    console.error(`      • http://localhost:${PORT}/callback is listed as a Redirect URI in your TikTok app`);
    console.error("      • The app's Content Posting API status is 'Approved'");
    process.exit(1);
  }

  console.log("\n🔄  Exchanging code for tokens…");
  let tok;
  try {
    tok = await exchangeCodeForTokens(code, codeVerifier);
  } catch (err) {
    console.error(`\n❌  ${err.message}`);
    process.exit(1);
  }

  const expiresInHrs    = Math.round((tok.expires_in || 86400) / 3600);
  const refreshExpsDays = Math.round((tok.refresh_expires_in || 31536000) / 86400);

  console.log("\n✅  Success! Set these in Hostinger → Hosting → Node.js → Environment variables:\n");
  console.log(`   TIKTOK_CLIENT_KEY     = ${CLIENT_KEY}`);
  console.log(`   TIKTOK_CLIENT_SECRET  = ${CLIENT_SECRET}`);
  console.log(`   TIKTOK_ACCESS_TOKEN   = ${tok.access_token}`);
  console.log(`   TIKTOK_REFRESH_TOKEN  = ${tok.refresh_token}`);
  console.log(`   TIKTOK_OPEN_ID        = ${tok.open_id}`);
  console.log(`   TIKTOK_HANDLE         = @your_handle   # optional, for building post URLs`);
  console.log(`\n   Access token expires in: ${expiresInHrs}h`);
  console.log(`   Refresh token expires in: ${refreshExpsDays} days`);
  console.log("\n   Scopes granted:", tok.scope || SCOPES);
  console.log("\nThen redeploy the app. Videos will be uploaded to TikTok automatically.");
  console.log("Note: initial uploads use SELF_ONLY privacy so you can review before going public.\n");
}

main().catch(err => {
  console.error(`\n💥 Unexpected error: ${err.stack || err.message}`);
  process.exit(1);
});
