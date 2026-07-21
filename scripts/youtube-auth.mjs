#!/usr/bin/env node
/**
 * youtube-auth.mjs — one-time OAuth2 authorisation to get a refresh token.
 *
 * Uses the LOOPBACK-IP redirect flow Google recommends for Desktop OAuth
 * clients. The previous out-of-band flow (urn:ietf:wg:oauth:2.0:oob) was
 * blocked for new clients in Feb 2022 and fully deprecated in Jan 2023, so it
 * fails with `invalid_request` on any recently-created client.
 *
 * Run this locally (on your machine, NOT on the server):
 *   YOUTUBE_CLIENT_ID=xxx YOUTUBE_CLIENT_SECRET=yyy node scripts/youtube-auth.mjs
 *
 * It will:
 *   1. Start a throwaway HTTP server on 127.0.0.1 at an ephemeral port.
 *   2. Print an authorisation URL — open it, pick the RIGHT Google account,
 *      and approve access.
 *   3. Capture the ?code= on the loopback callback automatically (no paste).
 *   4. Exchange the code for tokens, print the refresh token, then shut down.
 *
 * Redirect URI: http://127.0.0.1:<ephemeral-port>
 *   For a *Desktop-app* OAuth client, Google accepts any loopback port
 *   automatically — there is nothing to register, and Desktop clients have no
 *   editable redirect-URI field. If (and only if) the client is a *Web
 *   application* client, register exactly:  http://127.0.0.1
 *   (host only, no port, no trailing slash) — but Desktop is the correct type.
 *
 * Required scope: https://www.googleapis.com/auth/youtube.upload
 * (also requests youtube.readonly so getChannelInfo() can resolve the channel)
 */

import http from "node:http";
import { randomUUID } from "node:crypto";

const CLIENT_ID     = process.env.YOUTUBE_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET?.trim();

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌  Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET first:");
  console.error("    YOUTUBE_CLIENT_ID=xxx YOUTUBE_CLIENT_SECRET=yyy node scripts/youtube-auth.mjs");
  process.exit(1);
}

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");

// Opaque value echoed back on the callback — guards against a stray/forged
// request landing on the loopback port while we're waiting.
const STATE = randomUUID();

function buildAuthUrl(redirectUri) {
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  redirectUri,
    response_type: "code",
    scope:         SCOPES,
    access_type:   "offline", // ask for a refresh token
    prompt:        "consent",  // force a refresh token to be returned every run
    state:         STATE,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCode(code, redirectUri) {
  const body = new URLSearchParams({
    code,
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri:  redirectUri, // must byte-match the auth request
    grant_type:    "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });
  const json = await res.json();
  if (!res.ok || !json.refresh_token) {
    throw new Error("Token exchange failed: " + JSON.stringify(json, null, 2));
  }
  return json;
}

function sendPage(res, message) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    `<!doctype html><meta charset="utf-8">` +
    `<body style="font-family:system-ui;max-width:34rem;margin:4rem auto;padding:0 1rem">` +
    `<p>${message}</p></body>`
  );
}

let redirectUri = null;
let done = false; // ignore favicon / duplicate callbacks after the first code

function finish(code) {
  server.close(() => process.exit(code));
  // Safety net in case a keep-alive socket lingers.
  setTimeout(() => process.exit(code), 1000).unref();
}

const server = http.createServer(async (req, res) => {
  if (!redirectUri) { res.writeHead(503); res.end(); return; }
  const url = new URL(req.url, redirectUri);
  if (url.pathname !== "/") { res.writeHead(404); res.end(); return; } // e.g. /favicon.ico
  if (done)             { sendPage(res, "Already handled — you can close this tab."); return; }

  const err   = url.searchParams.get("error");
  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (err) {
    done = true;
    sendPage(res, `Authorisation failed: <code>${err}</code>. You can close this tab.`);
    console.error(`\n❌  Google returned error: ${err}`);
    return finish(1);
  }
  if (state !== STATE) {
    // Not our request — do not consume it, do not exit.
    res.writeHead(400); res.end("state mismatch");
    return;
  }
  if (!code) {
    done = true;
    sendPage(res, "No authorisation code in the callback. You can close this tab.");
    console.error("\n❌  Callback had no ?code= parameter.");
    return finish(1);
  }

  done = true;
  try {
    const json = await exchangeCode(code, redirectUri);
    sendPage(res, "✅ ScoopFeeds YouTube authorisation complete. You can close this tab and return to the terminal.");

    console.log("\n✅  Success! Add these to ~/.scoopfeeds.env (local) AND the Hostinger panel (prod):\n");
    console.log(`   YOUTUBE_CLIENT_ID     = ${CLIENT_ID}`);
    console.log(`   YOUTUBE_CLIENT_SECRET = ${CLIENT_SECRET}`);
    console.log(`   YOUTUBE_REFRESH_TOKEN = ${json.refresh_token}`);
    console.log(`   YOUTUBE_PRIVACY       = private   # REQUIRED — the code defaults to "public" if unset`);
    console.log("\nThen run the channel-title verify command before uploading anything.\n");
    finish(0);
  } catch (e) {
    sendPage(res, "Token exchange failed — check the terminal for details.");
    console.error(`\n❌  ${e.message}`);
    finish(1);
  }
});

server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  redirectUri = `http://127.0.0.1:${port}`;
  const authUrl = buildAuthUrl(redirectUri);

  console.log(`\n🔌  Listening for the OAuth callback on ${redirectUri}`);
  console.log("\n1️⃣   Open this URL in your browser:\n");
  console.log("    " + authUrl);
  console.log("\n2️⃣   At the Google account picker, choose  info.scoopfeeds@gmail.com");
  console.log("     (NOT nmc192@gmail.com — that owns the Cloud project, not the channel).");
  console.log("\n     The code is captured automatically; nothing to paste back here.\n");
});
