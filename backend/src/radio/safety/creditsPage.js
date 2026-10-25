/**
 * creditsPage.js — the full music credits page for ScoopFeeds Radio (#208, DrJ 25 Oct 2026).
 *
 * CC BY 4.0 §3(a)(2) allows attribution by a link to a resource that holds the required information. The
 * 24/7 description and the X text link here instead of listing every track, so a growing library never pushes
 * a credit past YouTube's 5000-character limit. Each credit is printed verbatim from manifest.json, never
 * shortened. A static page (served from frontend/public, readable without JavaScript), noindex.
 *
 * Dark until used: nothing links to it until RADIO_MUSIC_CREDITS_URL is set on the playout host.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" rel="noopener">${u}</a>`);

/** @param {Array<{title?:string, artist?:string, licence?:string, credit:string}>} tracks manifest entries (cleared) */
export function creditsPageHtml(tracks, { generatedAt = new Date() } = {}) {
  const seen = new Set();
  const items = (tracks || []).filter((t) => { const c = String(t?.credit || "").trim(); if (!c || seen.has(c)) return false; seen.add(c); return true; });
  const rows = items.map((t) => `  <li>
    <h2>${esc(t.title || "Untitled")}${t.artist ? ` <span>${esc(t.artist)}</span>` : ""}</h2>
    <pre>${linkify(String(t.credit).trim())}</pre>
  </li>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>ScoopFeeds Radio · Music credits</title>
<style>
  :root { --paper:#F4EFE6; --ink:#0F2238; --red:#D7261E; --muted:#5a6573; }
  body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.5 Georgia, "Times New Roman", serif; }
  main { max-width:760px; margin:0 auto; padding:32px 16px 64px; }
  h1 { font-size:28px; margin:0 0 4px; } p.lede { color:var(--muted); margin:0 0 24px; }
  ol { list-style:none; padding:0; margin:0; } li { border-top:1px solid #d9d1c3; padding:16px 0; }
  h2 { font-size:18px; margin:0 0 6px; } h2 span { color:var(--muted); font-weight:normal; }
  pre { white-space:pre-wrap; word-break:break-word; font:14px/1.5 ui-monospace, Menlo, Consolas, monospace; margin:0; }
  a { color:var(--red); }
</style>
</head>
<body>
<main>
<h1>ScoopFeeds Radio · Music credits</h1>
<p class="lede">Every music track that may air on ScoopFeeds Radio, with its credit exactly as the YouTube Audio Library gives it. ${items.length} track${items.length === 1 ? "" : "s"}, updated ${esc(generatedAt.toISOString().slice(0, 10))}. <a href="https://scoopfeeds.com">scoopfeeds.com</a></p>
<ol>
${rows}
</ol>
</main>
</body>
</html>
`;
}
