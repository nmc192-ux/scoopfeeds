#!/usr/bin/env node
/**
 * render-queue.mjs — GitHub Actions render worker.
 *
 * Pulls a batch of queued video jobs from scoopfeeds.com, renders each one
 * locally using the in-repo videoGenerator pipeline (full ffmpeg + satori),
 * and uploads the resulting MP4 back to the production server.
 *
 * Required env:
 *   SITE_URL  — origin (default https://scoopfeeds.com)
 *   OPS_KEY   — value of ADMIN_KEY on the production server
 *
 * Optional env:
 *   BATCH_SIZE         — how many jobs to render this run (default 5, max 10)
 *   DRY_RUN=true       — render but don't upload (debug)
 *   OPENAI_API_KEY / ELEVENLABS_API_KEY / GOOGLE_TTS_KEY — enables TTS (optional)
 *
 * Exit codes: 0 on success (any number processed, including zero), 1 on
 * unrecoverable errors (auth, network, all renders failed).
 */

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dns from "node:dns";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Prefer IPv4 for all outbound DNS resolution.
//
// scoopfeeds.com has both A and AAAA records (Hostinger dual-stacks every
// VPS). Node 20's resolver returns IPv6 first by default, but a non-trivial
// slice of GitHub Actions runner subnets cannot route to Hostinger's IPv6
// pool — the connection silently times out as "TypeError: fetch failed"
// before the first byte. Confirmed via run 25189005214 logs: 4× retry on
// the first fetch, all 4 hit the same IPv6 failure mode. Switching the
// default resolution order to ipv4first makes fetch() pick the routable
// A record and the request succeeds.
dns.setDefaultResultOrder("ipv4first");

// ─── Config ────────────────────────────────────────────────────────────────
const SITE_URL  = (process.env.SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");
const OPS_KEY   = process.env.OPS_KEY || "";
const BATCH     = Math.min(parseInt(process.env.BATCH_SIZE || "5", 10), 10);
const DRY_RUN   = String(process.env.DRY_RUN || "").toLowerCase() === "true";

if (!OPS_KEY) {
  console.error("❌ OPS_KEY env var required (set as a repository secret matching the server's ADMIN_KEY).");
  process.exit(1);
}

const authQS = `key=${encodeURIComponent(OPS_KEY)}`;

// ─── HTTP helpers ──────────────────────────────────────────────────────────
//
// Wraps fetch() with bounded retry + exponential backoff on transient
// network errors (TCP RST, TLS handshake fail, DNS hiccup — Node surfaces
// these all as "TypeError: fetch failed"). 2026-04 saw the 12:00 UTC cron
// crash on its first fetch every day for a week with no useful diagnostic;
// without retry, one flaky packet = an entire batch blocked until next cron.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, init, { attempts = 4, baseDelay = 1500 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      // Only retry on network-layer failures (which Node throws as TypeError).
      // HTTP 4xx/5xx come back as a Response, never as a thrown error.
      const transient =
        err?.name === "TypeError" || /fetch failed|network|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(String(err?.message || err));
      if (!transient || i === attempts - 1) throw err;
      const wait = baseDelay * Math.pow(2, i);
      console.warn(`   ⚠️  fetch failed (attempt ${i + 1}/${attempts}): ${err.message} — retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function getJson(p) {
  const url = `${SITE_URL}${p}${p.includes("?") ? "&" : "?"}${authQS}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`GET ${p} → ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

async function postJson(p, body = {}) {
  const url = `${SITE_URL}${p}${p.includes("?") ? "&" : "?"}${authQS}`;
  const res = await fetchWithRetry(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${p} → ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

async function uploadMp4({ jobId, mp4Bytes, durationSecs, hasAudio }) {
  const qs = new URLSearchParams({
    jobId:        String(jobId),
    durationSecs: String(durationSecs),
    hasAudio:     String(hasAudio),
  });
  const url = `${SITE_URL}/scoop-ops/videos-gen/upload?${qs}&${authQS}`;
  const res = await fetchWithRetry(url, {
    method:  "POST",
    headers: { "Content-Type": "video/mp4" },
    body:    mp4Bytes,
  });
  if (!res.ok) throw new Error(`upload → ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`📡 Render worker starting — site=${SITE_URL}, batch=${BATCH}, dryRun=${DRY_RUN}`);

  // 1. Atomically seed + claim a batch of jobs from the queue.
  const next = await postJson(`/scoop-ops/videos-gen/next-batch?size=${BATCH}`);
  const jobs = next.jobs || [];
  console.log(`📋 Got ${jobs.length} job(s) to render`);

  if (jobs.length === 0) {
    console.log("✅ Nothing to render — exiting cleanly.");
    return;
  }

  // 2. Lazy-import the generator (uses the bundled @ffmpeg-installer/ffmpeg)
  const { generateVideo } = await import("../backend/src/services/videoGenerator.js");

  // 3. Render each job + upload the MP4.
  const results = [];
  for (const { jobId, articleId, article } of jobs) {
    const start = Date.now();
    console.log(`\n🎬 [${jobId}] rendering ${articleId} — "${(article.title || "").slice(0, 70)}"`);
    try {
      const result = await generateVideo(article);
      if (!result?.outputPath) throw new Error("generateVideo returned null");
      const mp4 = readFileSync(result.outputPath);
      console.log(`   ✓ rendered ${(mp4.length / 1024).toFixed(0)} KB in ${Date.now() - start}ms`);

      if (DRY_RUN) {
        console.log("   (dry run — skipping upload)");
        results.push({ jobId, articleId, ok: true, sizeBytes: mp4.length, dryRun: true });
        continue;
      }

      const up = await uploadMp4({
        jobId,
        mp4Bytes:     mp4,
        durationSecs: result.durationSecs,
        hasAudio:     Boolean(result.hasAudio),
      });
      console.log(`   ☁️  uploaded → ${up.outputPath}`);
      results.push({ jobId, articleId, ok: true, sizeBytes: mp4.length });
    } catch (err) {
      console.error(`   ✗ FAILED: ${err.message}`);
      results.push({ jobId, articleId, ok: false, error: err.message });
      if (!DRY_RUN) {
        try {
          await postJson(`/scoop-ops/videos-gen/mark-failed?jobId=${jobId}`, {
            reason: `render-queue worker: ${err.message}`.slice(0, 280),
          });
          console.error(`   ↳ marked job ${jobId} as failed on the server`);
        } catch (markErr) {
          console.error(`   ↳ also failed to mark-failed: ${markErr.message}`);
        }
      }
    }
  }

  // 4. Summarize.
  const okCount   = results.filter(r => r.ok).length;
  const failCount = results.filter(r => !r.ok).length;
  console.log(`\n📊 Summary — ok=${okCount}, failed=${failCount}, total=${results.length}`);
  if (okCount === 0 && failCount > 0) {
    console.error("❌ All renders failed — exiting 1 so the workflow run is marked failed.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`💥 Worker crashed: ${err.stack || err.message}`);
  process.exit(1);
});
