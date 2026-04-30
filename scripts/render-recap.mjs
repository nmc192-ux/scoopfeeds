#!/usr/bin/env node
/**
 * render-recap.mjs — GitHub Actions worker for the daily Top-5 recap video.
 *
 * Fetches the top 5 articles from scoopfeeds.com, renders a ~60s vertical
 * MP4 locally (using @ffmpeg-installer/ffmpeg on the runner), and uploads
 * the result back to the server via POST /scoop-ops/videos-gen/upload-recap.
 *
 * Required env:
 *   SITE_URL  — origin (default https://scoopfeeds.com)
 *   OPS_KEY   — value of ADMIN_KEY on the production server
 *
 * Optional env:
 *   RECAP_KIND    — "daily" (default) | "weekly"
 *   RECAP_CATEGORY — category slug to filter (omit for "all categories")
 *   OPENAI_API_KEY / ELEVENLABS_API_KEY / GOOGLE_TTS_KEY — enables TTS
 */

import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dns from "node:dns";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Prefer IPv4 — see scripts/render-queue.mjs for context. Node 20's
// resolver picks IPv6 first by default, but Hostinger's IPv6 pool isn't
// reachable from a chunk of GitHub Actions runner subnets, so fetch()
// silently fails as "TypeError: fetch failed" before the first byte.
dns.setDefaultResultOrder("ipv4first");

const SITE_URL = (process.env.SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");
const OPS_KEY  = process.env.OPS_KEY || "";
const KIND     = (process.env.RECAP_KIND === "weekly") ? "weekly" : "daily";
const CATEGORY = process.env.RECAP_CATEGORY || null;

if (!OPS_KEY) {
  console.error("❌ OPS_KEY env var required.");
  process.exit(1);
}

const authQS = `key=${encodeURIComponent(OPS_KEY)}`;

async function getJson(p) {
  const sep = p.includes("?") ? "&" : "?";
  const res = await fetch(`${SITE_URL}${p}${sep}${authQS}`);
  if (!res.ok) throw new Error(`GET ${p} → ${res.status}`);
  return res.json();
}

async function main() {
  const windowMs = KIND === "weekly" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const dateStamp = new Date().toISOString().slice(0, 10);
  const slug = `${KIND}-${CATEGORY || "all"}-${dateStamp}`;
  const label = CATEGORY
    ? (KIND === "weekly" ? `This week in ${CATEGORY}` : `Top in ${CATEGORY} today`)
    : (KIND === "weekly" ? "This week's top stories" : "Top 5 today");

  console.log(`📡 Recap worker — kind=${KIND}, category=${CATEGORY || "all"}, slug=${slug}`);

  // 1. Fetch top articles from the server.
  const cutoff = Date.now() - windowMs;
  const catParam = CATEGORY ? `&category=${encodeURIComponent(CATEGORY)}` : "";
  const newsRes  = await fetch(
    `${SITE_URL}/api/news?limit=10&credibility=7${catParam}`,
    { headers: { "Accept": "application/json" } }
  );
  if (!newsRes.ok) throw new Error(`/api/news fetch failed: ${newsRes.status}`);
  const newsData = await newsRes.json();
  const articles = (newsData.articles || newsData.data || [])
    .filter(a => a.published_at > cutoff || a.publishedAt > cutoff)
    .slice(0, 5);

  if (articles.length < 3) {
    console.log(`✅ Not enough articles (${articles.length}); skipping recap.`);
    return;
  }

  console.log(`📋 Got ${articles.length} articles for recap`);

  // 2. Render locally using the videoGenerator pipeline.
  const { generateRecapVideo } = await import("../backend/src/services/videoGenerator.js");

  console.log("🎬 Rendering recap video…");
  const start  = Date.now();
  const result = await generateRecapVideo({ articles, label, slug });

  if (!result?.outputPath) throw new Error("generateRecapVideo returned null");
  console.log(`✓ Rendered in ${Date.now() - start}ms → ${result.outputPath}`);

  if (!existsSync(result.outputPath)) throw new Error(`Output file missing: ${result.outputPath}`);
  const mp4 = readFileSync(result.outputPath);
  console.log(`   size: ${(mp4.length / 1024).toFixed(0)} KB, ${result.durationSecs}s, audio=${result.hasAudio}`);

  // 3. Upload to the server.
  const qs = new URLSearchParams({
    slug,
    durationSecs: String(result.durationSecs || 60),
    hasAudio:     String(Boolean(result.hasAudio)),
    kind:         KIND,
    ...(CATEGORY ? { category: CATEGORY } : {}),
  });
  const url = `${SITE_URL}/scoop-ops/videos-gen/upload-recap?${qs}&${authQS}`;
  const upRes = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "video/mp4" },
    body:    mp4,
  });
  if (!upRes.ok) throw new Error(`upload-recap → ${upRes.status} ${await upRes.text().catch(() => "")}`);
  const upData = await upRes.json();
  console.log(`☁️  Uploaded — job ${upData.jobId} at ${upData.outputPath}`);
  console.log(`✅ Recap done. Visit /scoop-ops/videos-gen/queue to review.`);
}

main().catch(err => {
  console.error(`💥 Recap worker crashed: ${err.stack || err.message}`);
  process.exit(1);
});
