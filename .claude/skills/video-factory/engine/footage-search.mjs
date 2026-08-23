// Footage search across open-licence sources.
//
//   node footage-search.mjs "strait of hormuz" "persian gulf tanker"
//   node footage-search.mjs --json "iran navy"        # machine-readable
//
// WHY THIS IS NOT "SEARCH YOUTUBE FOR CLIPS"
// YouTube's Data API has a videoLicense=creativeCommon filter, and it works.
// Run it against a breaking-news topic and it returns news aggregators —
// re-uploads of Reuters/AP/AFP footage with the CC box ticked by someone who
// does not own it. A licence you cannot grant is not a licence. Reusing that is
// infringement wearing a badge, and Content ID matches it anyway.
//
// So sources are RANKED BY PROVENANCE, not by relevance:
//
//   verified  — the publisher is the rights holder by construction.
//               US federal works (DVIDS, NASA/USGS) are public domain because
//               they are US government works, full stop.
//   declared  — an explicit licence attached by an uploader whose ownership is
//               plausible (Wikimedia Commons, Internet Archive). Still needs a
//               human to look at it.
//   unverified— YouTube CC. LEAD GENERATION ONLY. Never downloaded by this
//               tool: it tells you a clip exists so a human can find out who
//               actually owns it. Downloading also breaks YouTube's ToS
//               regardless of what the licence field claims.
//
// Nothing here downloads anything. It writes a candidate manifest for review,
// because the decision "may we use this" is not one a search tool can make.

import { writeFileSync } from "fs";
import { P, ENV_FILES } from "./_deps.mjs";
import { readFileSync, existsSync } from "fs";

for (const f of ENV_FILES) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const JSON_OUT = process.argv.includes("--json");
const QUERIES = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!QUERIES.length) {
  console.error(`usage: node footage-search.mjs "<query>" ["<query>" …] [--json]`);
  process.exit(1);
}

const results = [];
const add = (r) => results.push(r);
const iso = (d) => (d ? String(d).slice(0, 10) : null);

// ── verified: US federal public domain ────────────────────────────────────
async function dvids(q) {
  const key = process.env.DVIDS_API_KEY;
  if (!key) {
    add({ source: "DVIDS", provenance: "verified", licence: "US Government work — public domain",
          title: "(needs DVIDS_API_KEY — free at dvidshub.net/api)", url: "https://www.dvidshub.net/search?q=" + encodeURIComponent(q),
          date: null, attribution: "US DoD / DVIDS", note: "browse manually until a key is set", query: q });
    return;
  }
  try {
    const u = `https://api.dvidshub.net/search?q=${encodeURIComponent(q)}&type=video&max_results=15&api_key=${key}`;
    const j = await (await fetch(u)).json();
    for (const it of j.results || []) {
      add({ source: "DVIDS", provenance: "verified",
            licence: "US Government work — public domain (17 U.S.C. §105)",
            title: it.title, url: it.url, date: iso(it.date_published || it.date),
            attribution: `${it.branch || "US DoD"} / DVIDS${it.credit ? " · " + it.credit : ""}`,
            query: q });
    }
  } catch (e) { add({ source: "DVIDS", provenance: "verified", error: e.message, query: q }); }
}

async function nasa(q) {
  try {
    const j = await (await fetch(`https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image,video`)).json();
    for (const it of (j.collection?.items || []).slice(0, 12)) {
      const d = it.data?.[0] || {};
      add({ source: "NASA", provenance: "verified",
            licence: "NASA media — public domain, no attribution required",
            title: d.title, url: it.href, date: iso(d.date_created),
            attribution: d.center ? `NASA / ${d.center}` : "NASA", query: q });
    }
  } catch (e) { add({ source: "NASA", provenance: "verified", error: e.message, query: q }); }
}

// ── declared: an explicit licence, plausible owner ────────────────────────
async function commons(q) {
  // api.wikimedia.org, NOT commons.wikimedia.org/w/api.php. The classic endpoint
  // is reset at the connection level from some networks (ECONNRESET, which reads
  // like a transient network fault rather than a blocked host — en.wikipedia.org
  // answers fine from the same machine). The unified REST endpoint works and is
  // the one Wikimedia now points integrators at.
  const UA = { "User-Agent": "ScoopFeeds-FootageSearch/1.0 (https://scoopfeeds.com; hello@scoopfeeds.com)" };
  try {
    const s = await (await fetch(
      `https://api.wikimedia.org/core/v1/commons/search/page?q=${encodeURIComponent(q)}&limit=15`,
      { headers: UA })).json();
    for (const pg of (s.pages || [])) {
      const isFile = /^File:/.test(pg.title || pg.key || "");
      if (!isFile) continue;
      let licence = "see file page", attribution = "see file page", date = null;
      try {
        const f = await (await fetch(
          `https://api.wikimedia.org/core/v1/commons/file/${encodeURIComponent(pg.key)}`,
          { headers: UA })).json();
        licence = f.latest?.license?.title || f.license?.title || licence;
        attribution = f.latest?.user?.name || attribution;
        date = iso(f.latest?.timestamp);
      } catch { /* keep the placeholders — a missing detail is not a missing result */ }
      add({ source: "Wikimedia Commons", provenance: "declared", licence,
            title: String(pg.title).replace(/^File:/, ""),
            url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(pg.key)}`,
            date, attribution,
            note: /public domain|cc0|cc by/i.test(licence) ? null
                : "check the licence permits commercial reuse",
            query: q });
    }
  } catch (e) { add({ source: "Wikimedia Commons", provenance: "declared", error: e.message, query: q }); }
}

async function archive(q) {
  try {
    const u = "https://archive.org/advancedsearch.php?" + new URLSearchParams({
      q: `${q} AND mediatype:(movies)`, rows: "15", output: "json",
      "fl[]": "identifier", "sort[]": "publicdate desc",
    }) + "&fl[]=title&fl[]=licenseurl&fl[]=date&fl[]=creator";
    const j = await (await fetch(u)).json();
    for (const d of j.response?.docs || []) {
      add({ source: "Internet Archive", provenance: "declared",
            licence: d.licenseurl || "NO LICENCE DECLARED — do not use without checking",
            title: d.title, url: `https://archive.org/details/${d.identifier}`,
            date: iso(d.date), attribution: d.creator || "see item page",
            note: d.licenseurl ? null : "no licence field — treat as all rights reserved",
            query: q });
    }
  } catch (e) { add({ source: "Internet Archive", provenance: "declared", error: e.message, query: q }); }
}

// ── unverified: leads only, never downloaded ──────────────────────────────
async function youtubeCC(q) {
  const need = ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"];
  if (need.some((k) => !process.env[k])) return;
  try {
    const tr = await (await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: process.env.YOUTUBE_CLIENT_ID,
        client_secret: process.env.YOUTUBE_CLIENT_SECRET,
        refresh_token: process.env.YOUTUBE_REFRESH_TOKEN, grant_type: "refresh_token" }),
    })).json();
    const s = new URLSearchParams({ part: "snippet", q, type: "video",
      videoLicense: "creativeCommon", order: "date", maxResults: "10" });
    const j = await (await fetch(`https://www.googleapis.com/youtube/v3/search?${s}`,
      { headers: { Authorization: `Bearer ${tr.access_token}` } })).json();
    for (const it of j.items || []) {
      add({ source: "YouTube (CC-marked)", provenance: "unverified",
            licence: "uploader-declared Creative Commons — OWNERSHIP NOT ESTABLISHED",
            title: it.snippet.title, url: `https://www.youtube.com/watch?v=${it.id.videoId}`,
            date: iso(it.snippet.publishedAt), attribution: it.snippet.channelTitle,
            note: "LEAD ONLY. News re-uploaders routinely mark agency footage CC. Verify the channel actually shot it before considering use; downloading also breaches YouTube ToS.",
            query: q });
    }
  } catch (e) { add({ source: "YouTube (CC-marked)", provenance: "unverified", error: e.message, query: q }); }
}

for (const q of QUERIES) {
  await Promise.all([dvids(q), nasa(q), commons(q), archive(q), youtubeCC(q)]);
}

const RANK = { verified: 0, declared: 1, unverified: 2 };
results.sort((a, b) => (RANK[a.provenance] - RANK[b.provenance]) || String(b.date).localeCompare(String(a.date)));

const out = P("out/footage-candidates.json");
writeFileSync(out, JSON.stringify({ queries: QUERIES, searchedAt: new Date().toISOString(), results }, null, 2));

if (JSON_OUT) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }

let last = null;
for (const r of results) {
  if (r.provenance !== last) {
    const head = { verified: "VERIFIED — rights holder by construction, usable",
                   declared: "DECLARED — explicit licence, check it covers commercial reuse",
                   unverified: "UNVERIFIED — leads only, NOT usable as found" }[r.provenance];
    console.log(`\n${head}\n${"─".repeat(head.length)}`);
    last = r.provenance;
  }
  if (r.error) { console.log(`  ${r.source}: error — ${r.error}`); continue; }
  console.log(`  ${(r.date || "—").padEnd(11)} ${r.source.padEnd(20)} ${String(r.title).slice(0, 58)}`);
  console.log(`              ${r.licence}`);
  if (r.note) console.log(`              ⚠ ${r.note}`);
}
const n = (p) => results.filter((r) => r.provenance === p && !r.error).length;
console.log(`\n${results.length} candidates — verified ${n("verified")}, declared ${n("declared")}, unverified ${n("unverified")}`);
console.log(`written to ${out}`);
console.log(`\nNothing was downloaded. Provenance is a human decision; this only assembles the evidence.`);
