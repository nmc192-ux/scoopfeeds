#!/usr/bin/env node
/**
 * threads-auth-http.mjs — Same as threads-auth.mjs but uses plain HTTP
 * (avoids self-signed TLS cert browser warnings on localhost).
 * Redirect URI: http://localhost:8087/callback
 */
import http from "http";
import { exec } from "child_process";
import { URL } from "url";

const APP_ID     = process.env.THREADS_APP_ID?.trim()     || "1931953940773402";
const APP_SECRET = process.env.THREADS_APP_SECRET?.trim();

if (!APP_SECRET) {
  console.error("Missing THREADS_APP_SECRET"); process.exit(1);
}

const PORT         = 8087;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPE        = "threads_basic,threads_content_publish";

const AUTH_URL =
  "https://threads.net/oauth/authorize?" +
  new URLSearchParams({
    client_id:     APP_ID,
    redirect_uri:  REDIRECT_URI,
    scope:         SCOPE,
    response_type: "code",
  }).toString();

let resolveCode, rejectCode;
const codePromise = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/callback") { res.writeHead(404); res.end("Not found"); return; }

  const code  = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  res.writeHead(200, { "Content-Type": "text/html" });
  if (error) {
    res.end(`<h2>Auth error: ${error}</h2>`);
    rejectCode(new Error(`OAuth error: ${error}`));
    return;
  }
  res.end(`<h2>Authorised! You can close this tab.</h2><script>window.close();</script>`);
  resolveCode(code);
});

server.listen(PORT, () => {
  console.log(`\n🔑  Threads OAuth — one-time setup (HTTP)\n`);
  console.log(`Opening browser for Threads login…`);
  const open = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${open} "${AUTH_URL}"`);
  console.log(`\nAuth URL (open manually if browser didn't open):\n${AUTH_URL}\n`);
});

try {
  const code = await codePromise;
  server.close();
  console.log("\n✅  Auth code received — exchanging for short-lived token…");

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

  const meRes = await fetch(
    `https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(longData.access_token)}`
  );
  const me = await meRes.json();
  if (!meRes.ok || !me.id) {
    console.error("❌  /me call failed:", JSON.stringify(me, null, 2));
    process.exit(1);
  }

  const expiresInDays = longData.expires_in ? Math.round(Number(longData.expires_in) / 86400) : 60;

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

Done! Threads auto-posting is now enabled.
`);

} catch (err) {
  server.close();
  console.error("❌  Error:", err.message);
  process.exit(1);
}
