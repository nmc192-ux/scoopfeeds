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
//   platform  — a stock library whose LICENSE IS THE PLATFORM'S OWN and is
//               curated by it (Pexels). Unlike YouTube CC, the grant does not
//               depend on an uploader's tick-box claim: the platform vouches
//               for the catalogue it serves through its API. Approved for
//               unattended use by DrJ 2026-08-27, as its own tier — never by
//               widening `declared`.
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

const results = [];
const add = (r) => results.push(r);
const iso = (d) => (d ? String(d).slice(0, 10) : null);

// ── verified: US federal public domain ────────────────────────────────────
async function dvids(q) {
  const key = process.env.DVIDS_API_KEY;
  if (!key) {
    add({ source: "DVIDS", provenance: "verified", licence: "US Government works — public domain; per-asset credit still applies",
          title: "(needs DVIDS_API_KEY — free self-signup at api.dvidshub.net)", url: "https://www.dvidshub.net/search?q=" + encodeURIComponent(q) + "&filter[type]=video",
          date: null, attribution: "US DoD / DVIDS", note: "browse manually until a key is set", query: q });
    return;
  }
  try {
    const u = `https://api.dvidshub.net/search?q=${encodeURIComponent(q)}&type=video&max_results=15&api_key=${key}`;
    const j = await (await fetch(u)).json();
    for (const it of j.results || []) {
      // NOT every DVIDS asset is a US Government work. DVIDS also carries
      // allied-military and contractor material, which is not automatically
      // public domain. The branch field is the tell: a US service branch means
      // 17 U.S.C. §105 applies; anything else needs the asset's own credit line
      // read before use.
      const usGov = /^(Army|Navy|Air Force|Marines|Marine Corps|Coast Guard|Space Force|DoD)/i
        .test(it.branch || "");
      add({ source: "DVIDS", provenance: usGov ? "verified" : "declared",
            licence: usGov
              ? "US Government work — public domain (17 U.S.C. §105)"
              : `credited to "${it.branch || "unknown"}" — NOT automatically public domain, read the asset credit`,
            title: it.title, url: it.url, assetId: it.id, durationSec: it.duration,
            date: iso(it.date_published || it.date),
            durationSec: it.duration ?? null,
            attribution: `${it.branch || "unknown"} / DVIDS${it.credit ? " · " + it.credit : ""}`,
            note: usGov ? null : "allied or contractor material can appear on DVIDS; verify before use",
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
// ── platform: stock libraries with platform-curated licences ──────────────
async function pexels(q) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return;   // dark until a key is set; the tier simply contributes nothing
  try {
    const u = `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=10`;
    const j = await (await fetch(u, { headers: { Authorization: key } })).json();
    for (const v of j.videos || []) {
      // Direct file now, not at resolve time: the API answer carries the
      // rendition list, so pick the smallest file that still meets 1080.
      const mp4s = (v.video_files || [])
        .filter((f) => f.file_type === "video/mp4" && f.width >= 1920)
        .sort((a, b) => (a.width * a.height) - (b.width * b.height));
      if (!mp4s.length) continue;
      add({
        source: "Pexels", provenance: "platform",
        licence: "Pexels License — free to use, modification allowed, no attribution required",
        title: `${q} — ${v.user?.name || "Pexels"} #${v.id}`,
        url: v.url, download: mp4s[0].link,
        durationSec: v.duration, date: null,
        attribution: `${v.user?.name || "Pexels contributor"} / Pexels`,
        query: q,
      });
    }
  } catch (e) {
    add({ source: "Pexels", provenance: "platform", error: e.message, query: q });
  }
}

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

/**
 * Resolve a DVIDS search hit to a direct MP4 url.
 *
 * THE SEARCH RESULT'S `url` IS A WEB PAGE. The first real acquisition run
 * downloaded fifteen HTML documents named .mp4 and probed them all as
 * "no video dimensions" — the direct files live behind the asset-detail
 * endpoint's `files[]`. Prefers the 1920x1080 variant over the 4K master:
 * the render normalises to 1080 anyway, and the master runs to hundreds of
 * megabytes per clip.
 */
export async function resolveDvidsDownload(assetId) {
  const key = process.env.DVIDS_API_KEY;
  if (!key || !assetId) return null;
  const r = await fetch(`https://api.dvidshub.net/asset?id=${encodeURIComponent(assetId)}&api_key=${key}`);
  if (!r.ok) return null;
  const files = (await r.json())?.results?.files || [];
  const mp4s = files.filter((f) => f.type === "video/mp4" && f.width >= 1920);
  if (!mp4s.length) return null;
  // Smallest file that still meets the floor — the 1080 variant, not the master.
  mp4s.sort((a, b) => (a.size || Infinity) - (b.size || Infinity));
  return { src: mp4s[0].src, width: mp4s[0].width, height: mp4s[0].height, size: mp4s[0].size };
}

/**
 * Search every source for the given queries; returns candidates ranked by
 * provenance (verified → declared → unverified).
 *
 * EXPORTED — this used to be CLI-only, with the driver running at module top
 * level, so `import { searchFootage }` was impossible: the same CLI-on-import
 * class demand.mjs had. The unattended acquirer (longformAcquire) is the
 * consumer this export exists for.
 */
export async function searchFootage(queries = []) {
  results.length = 0;
  for (const q of queries) {
    await Promise.all([dvids(q), nasa(q), pexels(q), commons(q), archive(q), youtubeCC(q)]);
  }
  const RANK = { verified: 0, platform: 1, declared: 2, unverified: 3 };
  results.sort((a, b) => (RANK[a.provenance] - RANK[b.provenance]) || String(b.date).localeCompare(String(a.date)));
  return [...results];
}

async function main() {
  const JSON_OUT = process.argv.includes("--json");
  const QUERIES = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!QUERIES.length) {
    console.error(`usage: node footage-search.mjs "<query>" ["<query>" …] [--json]`);
    process.exit(1);
  }
  await searchFootage(QUERIES);

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
    const dur = r.durationSec ? ` [${r.durationSec}s]` : "";
    console.log(`  ${(r.date || "—").padEnd(11)} ${r.source.padEnd(20)} ${String(r.title).slice(0, 52)}${dur}`);
    console.log(`              ${r.licence}`);
    if (r.note) console.log(`              ⚠ ${r.note}`);
  }
  const n = (p) => results.filter((r) => r.provenance === p && !r.error).length;
  console.log(`\n${results.length} candidates — verified ${n("verified")}, declared ${n("declared")}, unverified ${n("unverified")}`);
  console.log(`written to ${out}`);
  console.log(`\nNothing was downloaded. Provenance is a human decision; this only assembles the evidence.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
