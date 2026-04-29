#!/usr/bin/env node
/**
 * linkedin-auth.mjs  —  One-time OAuth2 setup for LinkedIn Company Page posting.
 *
 * Prerequisites (do this in the LinkedIn Developer portal first):
 *   1. Go to https://www.linkedin.com/developers/apps → Create App
 *      - App name: "Scoopfeeds Publisher"
 *      - Company page: link your Scoopfeeds LinkedIn page (create one at
 *        linkedin.com/company/setup/new if you haven't already)
 *      - Logo + privacy policy URL (required for review)
 *   2. Under "Products", request:
 *        • "Share on LinkedIn"          → instant approval
 *        • "Sign In with LinkedIn using OpenID Connect" → instant approval
 *      These give you w_member_social + openid scopes.
 *      For company-page posting you also need:
 *        • "Community Management API"  → apply (usually approved within 1-3 days)
 *      Until "Community Management API" is approved, the token will only have
 *      w_member_social (personal posts). Add it once approved and re-run.
 *   3. Under "Auth" → OAuth 2.0 settings:
 *        - Redirect URL: http://localhost:8086/callback
 *   4. Note your Client ID and Client Secret from the "Auth" tab.
 *   5. Find your Organization ID:
 *        - Go to your LinkedIn Company Page
 *        - The URL will be linkedin.com/company/<orgId>/
 *        - Copy the numeric ID
 *   6. Set env vars and run:
 *        export LINKEDIN_CLIENT_ID=...
 *        export LINKEDIN_CLIENT_SECRET=...
 *        export LINKEDIN_ORG_ID=...           # numeric org ID from company page URL
 *        node backend/scripts/linkedin-auth.mjs
 *   7. Add to Hostinger env vars and redeploy:
 *        LINKEDIN_ACCESS_TOKEN   = (printed by this script)
 *        LINKEDIN_ORGANIZATION_ID = (your org ID)
 *
 * Token lifetime: LinkedIn access tokens expire in 60 days. Re-run this script
 * when posting starts failing with 401 errors.
 */

import http from "http";
import { exec } from "child_process";
import { URL } from "url";

const CLIENT_ID     = process.env.LINKEDIN_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET?.trim();
const ORG_ID        = process.env.LINKEDIN_ORG_ID?.trim();

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(`
❌  Missing environment variables.

Set them first:
  export LINKEDIN_CLIENT_ID=your_client_id
  export LINKEDIN_CLIENT_SECRET=your_client_secret
  export LINKEDIN_ORG_ID=your_numeric_org_id

Then re-run: node backend/scripts/linkedin-auth.mjs
`);
  process.exit(1);
}

const PORT         = 8086;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

// w_organization_social requires Community Management API product approval.
// w_member_social is available immediately with "Share on LinkedIn" product.
// Request both — whichever is approved will be granted.
const SCOPES = [
  "openid",
  "profile",
  "w_member_social",
  "w_organization_social",
  "r_organization_social",
].join(" ");

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization?" + new URLSearchParams({
  response_type: "code",
  client_id:     CLIENT_ID,
  redirect_uri:  REDIRECT_URI,
  scope:         SCOPES,
  state:         Math.random().toString(36).slice(2),
}).toString();

let resolveCode, rejectCode;
const codePromise = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
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
  console.log(`\n🔑  LinkedIn OAuth — one-time setup\n`);
  console.log(`Opening browser for LinkedIn login…`);
  const open = process.platform === "darwin" ? "open"
             : process.platform === "win32"  ? "start"
             : "xdg-open";
  exec(`${open} "${AUTH_URL}"`);
  console.log(`\nAuth URL:\n${AUTH_URL}\n`);
});

try {
  const code = await codePromise;
  server.close();
  console.log("✅  Auth code received — exchanging for tokens…");

  const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      code,
      redirect_uri:  REDIRECT_URI,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }).toString(),
  });

  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.access_token) {
    console.error("❌  Token exchange failed:", JSON.stringify(tokens, null, 2));
    process.exit(1);
  }

  // Verify the token works by fetching the authorized scopes
  const meRes  = await fetch("https://api.linkedin.com/v2/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const me = await meRes.json();
  const name = `${me.localizedFirstName || ""} ${me.localizedLastName || ""}`.trim();

  const orgId = ORG_ID || "(set LINKEDIN_ORG_ID env var)";
  const expiresIn = tokens.expires_in ? `${Math.round(tokens.expires_in / 86400)} days` : "60 days";

  console.log(`
╔══════════════════════════════════════════════════════════╗
║        LinkedIn OAuth — COMPLETE  ✅                     ║
╚══════════════════════════════════════════════════════════╝

Authorized as: ${name}
Scopes granted: ${tokens.scope || "(check LinkedIn app dashboard)"}
Token expires:  ${expiresIn}

Add these env vars to Hostinger → Settings and redeploy:

  LINKEDIN_ACCESS_TOKEN    = ${tokens.access_token}
  LINKEDIN_ORGANIZATION_ID = ${orgId}

Note: Token expires in ~${expiresIn}. Re-run this script to refresh.
Note: Company-page posting requires "Community Management API" product
      approval in your LinkedIn app. Apply at developers.linkedin.com.
      Until approved, the token will only post to your personal profile.

Done! LinkedIn auto-posting is now enabled.
`);

} catch (err) {
  server.close();
  console.error("❌  Error:", err.message);
  process.exit(1);
}
