// GET /tiktok/callback — the OAuth redirect target for the ScoopFeeds Publisher
// TikTok app.
//
// WHY A SERVER ROUTE AND NOT A STATIC PAGE
// It has to read the `code` query parameter and show it. A static file would
// need JavaScript to do that, and this page is looked at during an app review
// where "works without JavaScript" is the standard the legal pages were written
// to meet. Server-rendered keeps it consistent.
//
// WHY THE CODE IS SHOWN AT ALL
// The client secret never leaves the operator's machine, so the code→token
// exchange happens locally. This page's only job is to get the authorisation
// code off TikTok's redirect and onto the clipboard. The code is single-use,
// expires in minutes, and is worthless without the secret.
//
// It is deliberately noindex, and the code is never written to server logs.
import express from "express";

const router = express.Router();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const page = (title, bodyHtml) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} — ScoopFeeds Publisher</title>
<style>
 :root{--ink:#111827;--muted:#4b5563;--line:#e5e7eb;--accent:#F97316;--bg:#fff}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--ink);
  font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
 .wrap{max-width:680px;margin:0 auto;padding:48px 20px}
 .brand{font-weight:700;color:var(--accent);text-decoration:none;font-size:15px}
 h1{font-size:26px;margin:20px 0 6px}
 p{color:#1f2937}
 code,.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
 .code{display:block;word-break:break-all;background:#f3f4f6;border:1px solid var(--line);
   border-radius:8px;padding:16px;font-size:15px;margin:18px 0;color:#111827}
 .muted{color:var(--muted);font-size:14px}
 .bad{border-left:3px solid #dc2626;padding-left:14px}
 @media (prefers-color-scheme:dark){
  :root{--ink:#e5e7eb;--muted:#9ca3af;--line:#374151;--bg:#0b0f19}
  p{color:#d1d5db} .code{background:#111827;color:#e5e7eb}
 }
</style></head><body><div class="wrap">
<a class="brand" href="https://scoopfeeds.com">ScoopFeeds</a>
${bodyHtml}
</div></body></html>`;

router.get("/tiktok/callback", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const { code, state, error, error_description: desc } = req.query;

  if (error) {
    return res.status(400).send(page("Authorisation failed", `
      <h1>Authorisation failed</h1>
      <div class="bad"><p><strong>${esc(error)}</strong></p>
      ${desc ? `<p class="muted">${esc(desc)}</p>` : ""}</div>
      <p class="muted">Nothing was granted. Close this tab and start the flow again.</p>`));
  }

  if (!code) {
    return res.status(400).send(page("Nothing to show", `
      <h1>Nothing to show</h1>
      <p>This page is the OAuth redirect target for ScoopFeeds Publisher. It only
         does something when TikTok sends an authorisation code to it.</p>
      <p class="muted">Opened directly, there is nothing here.</p>`));
  }

  res.send(page("Authorisation code", `
    <h1>Authorisation code</h1>
    <p>Copy this and paste it into the waiting <code>tiktok-auth.mjs</code> prompt.
       It is single-use and expires within minutes.</p>
    <div class="code">${esc(code)}</div>
    ${state ? `<p class="muted">state: <code>${esc(state)}</code></p>` : ""}
    <p class="muted">The token exchange happens on the operator's machine — the client
       secret is never sent to this server, and this code is not logged here.</p>`));
});

export default router;
