#!/usr/bin/env node
/**
 * tiktok-auth.mjs — obtain a TikTok refresh token for ScoopFeeds Publisher.
 *
 *   TIKTOK_CLIENT_KEY=xxx TIKTOK_CLIENT_SECRET=yyy node scripts/tiktok-auth.mjs
 *
 * FLOW — deliberately manual, in two halves that never touch each other:
 *
 *   1. This script prints an authorise URL and waits.
 *   2. You open it, sign in as ScoopFeeds and approve. TikTok redirects to
 *      https://scoopfeeds.com/tiktok/callback, which renders the `code`.
 *   3. You paste the code back here. The exchange runs on THIS machine.
 *
 * WHY NOT THE OLD LOCALHOST LISTENER
 * The previous version ran a server on :8788 and used http://localhost:8788/
 * as the redirect URI. That works, but it cannot be shown in an app-review
 * recording: a reviewer has to see the redirect land on the declared domain,
 * and localhost is not the declared domain. Redirecting to scoopfeeds.com puts
 * the real site on screen at the moment of authorisation, which is exactly what
 * TikTok's guidelines ask for.
 *
 * THE CLIENT SECRET NEVER LEAVES THIS MACHINE. The callback page receives only
 * the authorisation code, which is single-use, short-lived, and useless without
 * the secret. The exchange below is a direct call from here to TikTok.
 *
 * PORTAL SETUP
 *   Redirect URI must be exactly: https://scoopfeeds.com/tiktok/callback
 *   Products: Login Kit + Content Posting API
 *   Scopes:   user.info.basic, video.publish, video.upload
 */

import * as crypto from "crypto";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

const CLIENT_KEY    = process.env.TIKTOK_CLIENT_KEY?.trim();
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET?.trim();
const REDIRECT_URI  = process.env.TIKTOK_REDIRECT_URI?.trim()
                   || "https://scoopfeeds.com/tiktok/callback";
const SCOPES        = process.env.TIKTOK_SCOPES?.trim()
                   || "user.info.basic,video.publish,video.upload";

if (!CLIENT_KEY || !CLIENT_SECRET) {
  console.error("Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET.\n");
  console.error("  TIKTOK_CLIENT_KEY=xxx TIKTOK_CLIENT_SECRET=yyy node scripts/tiktok-auth.mjs");
  process.exit(1);
}

// PKCE. TikTok requires S256 for the web flow.
const verifier  = crypto.randomBytes(48).toString("hex");
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
const state     = crypto.randomBytes(12).toString("base64url");

const authUrl = "https://www.tiktok.com/v2/auth/authorize/?" + new URLSearchParams({
  client_key: CLIENT_KEY,
  scope: SCOPES,
  response_type: "code",
  redirect_uri: REDIRECT_URI,
  state,
  code_challenge: challenge,
  code_challenge_method: "S256",
});

console.log("\n─── 1. OPEN THIS AND APPROVE AS ScoopFeeds ───────────────────────\n");
console.log(authUrl);
console.log(`\n    redirect_uri : ${REDIRECT_URI}`);
console.log(`    scopes       : ${SCOPES}`);
console.log(`    state        : ${state}`);
console.log("\n─── 2. PASTE THE CODE FROM THE CALLBACK PAGE ─────────────────────\n");

const rl = readline.createInterface({ input, output });
let code = (await rl.question("code: ")).trim();
const returnedState = (await rl.question("state shown on the page (enter to skip): ")).trim();
rl.close();

// Paste-tolerance: people paste the whole URL as often as the bare code.
if (code.includes("code=")) {
  try { code = new URL(code).searchParams.get("code") || code; } catch { /* not a URL */ }
}
code = decodeURIComponent(code.replace(/\*$/, ""));   // TikTok appends a trailing *

if (returnedState && returnedState !== state) {
  console.error(`\nSTATE MISMATCH — expected ${state}, got ${returnedState}.`);
  console.error("Someone else's redirect, or a stale tab. Start again.");
  process.exit(1);
}

console.log("\nexchanging…");
const r = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_key: CLIENT_KEY,
    client_secret: CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  }),
});
const j = await r.json();

if (!j.access_token) {
  console.error("\nEXCHANGE FAILED:\n" + JSON.stringify(j, null, 2));
  console.error("\nCommon causes: the code was already used, it expired (minutes),");
  console.error("or the redirect_uri here does not byte-match the portal setting.");
  process.exit(1);
}

console.log("\n─── 3. TOKENS ───────────────────────────────────────────────────\n");
console.log(`  open_id       : ${j.open_id}`);
console.log(`  scopes        : ${j.scope}`);
console.log(`  access  expires in : ${j.expires_in}s`);
console.log(`  refresh expires in : ${j.refresh_expires_in}s`);
console.log("\nAppend to ~/.scoopfeeds.env:\n");
console.log(`TIKTOK_CLIENT_KEY=${CLIENT_KEY}`);
console.log(`TIKTOK_CLIENT_SECRET=${CLIENT_SECRET}`);
console.log(`TIKTOK_REFRESH_TOKEN=${j.refresh_token}`);

const granted = (j.scope || "").split(",").map((s) => s.trim()).filter(Boolean);
const missing = SCOPES.split(",").map((s) => s.trim()).filter((s) => !granted.includes(s));
if (missing.length) {
  console.log(`\nWARNING — requested but NOT granted: ${missing.join(", ")}`);
  console.log("TikTok's consent screen lets scopes be declined individually, and the");
  console.log("flow still succeeds. Publishing will fail later with error 40131.");
}
