#!/usr/bin/env node
/**
 * youtube-auth.mjs — one-time OAuth2 authorisation to get a refresh token.
 *
 * Run this locally (on your machine, not on the server):
 *   YOUTUBE_CLIENT_ID=xxx YOUTUBE_CLIENT_SECRET=yyy node scripts/youtube-auth.mjs
 *
 * It will:
 *   1. Print an authorisation URL — open it in a browser and approve access.
 *   2. Prompt you to paste the authorisation code back.
 *   3. Exchange the code for tokens and print the refresh token.
 *   4. Set YOUTUBE_REFRESH_TOKEN in Hostinger env vars, then redeploy.
 *
 * Required scope: https://www.googleapis.com/auth/youtube.upload
 * (also requests youtube.readonly to let getChannelInfo() work)
 */

import * as readline from "readline";
import * as https from "https";

const CLIENT_ID     = process.env.YOUTUBE_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET?.trim();

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌  Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET first:");
  console.error("    YOUTUBE_CLIENT_ID=xxx YOUTUBE_CLIENT_SECRET=yyy node scripts/youtube-auth.mjs");
  process.exit(1);
}

const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob"; // out-of-band = copy-paste flow
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +
  `&prompt=consent`; // force refresh_token to always be returned

console.log("\n1️⃣   Open this URL in a browser (must be signed into the YouTube channel):\n");
console.log("    " + authUrl);
console.log("\n2️⃣   Grant access, then copy the authorisation code from the page.\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Paste the code here: ", async (code) => {
  rl.close();
  code = code.trim();
  if (!code) { console.error("No code provided."); process.exit(1); }

  // Exchange code for tokens
  const body = new URLSearchParams({
    code,
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri:  REDIRECT_URI,
    grant_type:    "authorization_code",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });
  const json = await res.json();

  if (!res.ok || !json.refresh_token) {
    console.error("❌  Token exchange failed:", JSON.stringify(json, null, 2));
    process.exit(1);
  }

  console.log("\n✅  Success! Set these in Hostinger → Hosting → Node.js → Environment variables:\n");
  console.log(`   YOUTUBE_CLIENT_ID     = ${CLIENT_ID}`);
  console.log(`   YOUTUBE_CLIENT_SECRET = ${CLIENT_SECRET}`);
  console.log(`   YOUTUBE_REFRESH_TOKEN = ${json.refresh_token}`);
  console.log(`\n   (optional) YOUTUBE_PRIVACY = public  # public | unlisted | private`);
  console.log("\nThen redeploy the app. Videos will be uploaded to YouTube Shorts automatically.\n");
});
