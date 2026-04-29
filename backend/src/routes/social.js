// Admin preview for the auto-generated social captions. Not linked from the
// public site — access by typing the URL directly. Optionally gated by the
// ADMIN_KEY env var: if set, requires `?key=<value>` on each request.
//
// Two endpoints:
//   GET /admin/social-queue.json  — machine-readable, for future cron/API posting
//   GET /admin/social-queue       — human-readable HTML, copy-paste friendly

import { Router } from "express";
import express from "express";
import { getDb, socialPostStats } from "../models/database.js";
import { composeAllPlatforms } from "../services/socialComposer.js";
import { runPlatformCycle, listEnabledPlatforms, runAllPlatformsCycle } from "../services/socialPublisher.js";

const SITE_URL = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");

const router = Router();

const ADMIN_KEY = process.env.ADMIN_KEY || "";

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return next();
  if (req.query.key === ADMIN_KEY) return next();
  res.status(404).type("html").send(
    `<!doctype html><html><head><title>Not found</title></head><body><h1>404</h1></body></html>`
  );
}

// Pick the day's top N articles — same logic the frontend uses for the
// featured rail, but capped at 12 so the admin page stays scannable.
function pickArticles(limit = 12) {
  const db = getDb();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return db.prepare(`
    SELECT id, title, description, url, image_url, source_name, category, published_at
    FROM articles
    WHERE credibility >= 7 AND published_at > ?
    ORDER BY
      (published_at / 10800000) DESC,
      CASE category
        WHEN 'top'           THEN 1
        WHEN 'politics'      THEN 2
        WHEN 'pakistan'      THEN 3
        WHEN 'international' THEN 4
        WHEN 'science'       THEN 5
        WHEN 'ai'            THEN 6
        ELSE 7
      END ASC,
      credibility DESC, published_at DESC
    LIMIT ?
  `).all(cutoff, limit);
}

router.get("/social-queue.json", requireAdmin, (_req, res) => {
  const articles = pickArticles(12);
  const composed = articles.map((a) => {
    try { return composeAllPlatforms(a); } catch { return null; }
  }).filter(Boolean);
  res.json({ generatedAt: new Date().toISOString(), count: composed.length, items: composed });
});

router.get("/social-queue", requireAdmin, (_req, res) => {
  const articles = pickArticles(12);
  const composed = articles.map((a) => {
    try { return composeAllPlatforms(a); } catch { return null; }
  }).filter(Boolean);

  res.type("html").send(renderPage(composed));
});

// ── Auto-poster admin endpoints ────────────────────────────────────────
// JSON middleware needed for POST bodies; the queue routes above are GETs.
const jsonParser = express.json({ limit: "8kb" });

router.get("/auto-status", requireAdmin, (_req, res) => {
  res.json({
    ok: true,
    enabled: listEnabledPlatforms(),
    last24h: socialPostStats({ withinMs: 24 * 60 * 60 * 1000 }),
    env: {
      FACEBOOK_PAGE_ID:    Boolean(process.env.FACEBOOK_PAGE_ID),
      FACEBOOK_PAGE_TOKEN: Boolean(process.env.FACEBOOK_PAGE_TOKEN),
      BLUESKY_HANDLE:      Boolean(process.env.BLUESKY_HANDLE),
      BLUESKY_APP_PASSWORD:Boolean(process.env.BLUESKY_APP_PASSWORD),
      THREADS_USER_ID:     Boolean(process.env.THREADS_USER_ID),
      THREADS_ACCESS_TOKEN:Boolean(process.env.THREADS_ACCESS_TOKEN),
      INSTAGRAM_USER_ID:    Boolean(process.env.INSTAGRAM_USER_ID),
      INSTAGRAM_ACCESS_TOKEN_OR_FB: Boolean(process.env.INSTAGRAM_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_TOKEN),
      LINKEDIN_ORGANIZATION_ID: Boolean(process.env.LINKEDIN_ORGANIZATION_ID),
      LINKEDIN_ACCESS_TOKEN:    Boolean(process.env.LINKEDIN_ACCESS_TOKEN),
      PINTEREST_ACCESS_TOKEN:Boolean(process.env.PINTEREST_ACCESS_TOKEN),
      PINTEREST_BOARD_ID:    Boolean(process.env.PINTEREST_BOARD_ID),
      PEXELS_API_KEY:        Boolean(process.env.PEXELS_API_KEY),
    },
    blueskyHandle: process.env.BLUESKY_HANDLE || "",
    facebookPageId: process.env.FACEBOOK_PAGE_ID || "",
  });
});

// GET /scoop-ops/auto-errors — recent failed social posts with error messages.
// Used to diagnose why a platform stopped posting (token expiry, API error, etc).
router.get("/auto-errors", requireAdmin, async (_req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT article_id, platform, status, error, posted_at
      FROM social_posts
      WHERE status = 'failed'
      ORDER BY posted_at DESC
      LIMIT 20
    `).all();

    // Bluesky cooldown + session state. Read from SCOOP_PERSISTENT_DATA_DIR
    // when set (must match blueskyClient's PERSIST_DIR or we'd be peeking at
    // a stale empty file in the deploy dir).
    let blueskyCooldown = null;
    let blueskySession = null;
    try {
      const fs = await import("fs");
      const path = await import("path");
      const url = await import("url");
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const persistDir = process.env.SCOOP_PERSISTENT_DATA_DIR
        ? path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR)
        : path.resolve(here, "../../data");

      const cooldownPath = path.join(persistDir, "bluesky-cooldown.json");
      if (fs.existsSync(cooldownPath)) {
        const raw = JSON.parse(fs.readFileSync(cooldownPath, "utf8"));
        const remainingMs = (raw?.until || 0) - Date.now();
        blueskyCooldown = remainingMs > 0
          ? { active: true, remainingSecs: Math.ceil(remainingMs / 1000), until: raw.until }
          : { active: false, until: raw?.until || 0 };
      } else {
        blueskyCooldown = { active: false, present: false };
      }

      const sessionPath = path.join(persistDir, "bluesky-session.json");
      if (fs.existsSync(sessionPath)) {
        const raw = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
        blueskySession = {
          present: true,
          handle: raw?.handle || null,
          did: raw?.did ? raw.did.slice(0, 24) + "…" : null,
          createdAt: raw?.createdAt || null,
          ageHours: raw?.createdAt ? Math.round((Date.now() - raw.createdAt) / 3600000) : null,
          // never echo the JWTs themselves
          hasAccessJwt: Boolean(raw?.accessJwt),
          hasRefreshJwt: Boolean(raw?.refreshJwt),
        };
      } else {
        blueskySession = { present: false };
      }
    } catch (e) { blueskyCooldown = { error: e.message }; }

    res.json({ count: rows.length, rows, blueskyCooldown, blueskySession });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /admin/auto-post?platform=bluesky&dry=1
router.post("/auto-post", requireAdmin, jsonParser, async (req, res) => {
  const platform = (req.query.platform || req.body?.platform || "").toString();
  const dryRun = req.query.dry === "1" || req.body?.dry === true;
  try {
    if (platform) {
      const out = await runPlatformCycle(platform, { dryRun });
      return res.json({ ok: true, ...out });
    }
    const out = await runAllPlatformsCycle({ dryRun });
    res.json({ ok: true, results: out });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /scoop-ops/bluesky-reset[?cooldownHours=N&failCount=N]
// One-shot ops escape hatch when Bluesky posting is wedged: clears the
// 429 cooldown file + cached session so the next attempt runs a fresh
// createSession with current env credentials.
//
// Optional query params:
//   cooldownHours  — immediately seed a new cooldown of N hours so the
//                    next createSession attempt doesn't fire until after
//                    that window (useful when Bluesky's rate-limit is
//                    known to need a long clear period).
//   failCount      — seed the new cooldown's fail counter so the
//                    exponential backoff picks the right step.
router.get("/bluesky-reset", requireAdmin, async (req, res) => {
  try {
    const fs = await import("fs");
    const path = await import("path");
    const url = await import("url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));

    // The persist dir is the same one cardRenderer / blueskyClient use.
    const persistDir = process.env.SCOOP_PERSISTENT_DATA_DIR
      ? path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR)
      : path.resolve(here, "../../data");

    const cleared = {};
    for (const [name, file] of [
      ["cooldown", path.join(persistDir, "bluesky-cooldown.json")],
      ["session",  path.join(persistDir, "bluesky-session.json")],
    ]) {
      if (fs.existsSync(file)) {
        try { fs.unlinkSync(file); cleared[name] = "deleted"; }
        catch (e) { cleared[name] = `error: ${e.message}`; }
      } else {
        cleared[name] = "absent";
      }
    }

    // Optionally pre-seed a new cooldown so the first retry doesn't fire
    // immediately (useful when the account is known to be rate-limited).
    let preCooldown = null;
    const cooldownHours = parseFloat(req.query.cooldownHours);
    if (cooldownHours > 0 && cooldownHours <= 24) {
      const failCount = parseInt(req.query.failCount, 10) || 3;
      const untilMs = Date.now() + cooldownHours * 60 * 60 * 1000;
      try {
        fs.writeFileSync(
          path.join(persistDir, "bluesky-cooldown.json"),
          JSON.stringify({ until: untilMs, failCount, setAt: Date.now() })
        );
        preCooldown = { cooldownHours, failCount, until: untilMs };
      } catch (e) {
        preCooldown = { error: e.message };
      }
    }

    res.json({ ok: true, cleared, preCooldown, persistDir });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Instagram user-ID discovery ───────────────────────────────────────────
// GET /scoop-ops/ig-discover
//
// Queries the Meta Graph API to find the Instagram Business account ID
// connected to the configured Facebook Page. Requires:
//   - FACEBOOK_PAGE_ID env var
//   - FACEBOOK_PAGE_TOKEN env var
//
// Returns the IG User ID (and handle) ready to be pasted into Hostinger
// as INSTAGRAM_USER_ID. Also shows whether INSTAGRAM_USER_ID is already set.
router.get("/ig-discover", requireAdmin, async (req, res) => {
  const pageId    = (process.env.FACEBOOK_PAGE_ID    || "").trim();
  const pageToken = (process.env.FACEBOOK_PAGE_TOKEN || "").trim();
  const currentId = (process.env.INSTAGRAM_USER_ID   || "").trim();

  if (!pageId || !pageToken) {
    return res.status(400).json({
      ok: false,
      error: "FACEBOOK_PAGE_ID and FACEBOOK_PAGE_TOKEN env vars are required",
    });
  }

  try {
    const url = `https://graph.facebook.com/v19.0/${pageId}?fields=connected_instagram_account&access_token=${pageToken}`;
    const r = await fetch(url);
    const body = await r.json();

    if (!r.ok) {
      return res.status(502).json({
        ok: false,
        graphStatus: r.status,
        error: body?.error?.message || JSON.stringify(body).slice(0, 300),
      });
    }

    const igAcct = body?.connected_instagram_account;
    if (!igAcct?.id) {
      return res.json({
        ok: false,
        alreadySet: Boolean(currentId),
        currentId: currentId || null,
        message: "No Instagram account is connected to this Facebook Page. " +
          "In the Instagram app: Profile → Edit Profile → Switch to Professional account. " +
          "Then in Meta Business Suite (business.facebook.com): Settings → Accounts → " +
          "Instagram accounts → Add → connect @drjahanzebhussain.",
      });
    }

    // Fetch the IG username too
    const igUrl = `https://graph.facebook.com/v19.0/${igAcct.id}?fields=username,name&access_token=${pageToken}`;
    const igR = await fetch(igUrl);
    const igBody = igR.ok ? await igR.json() : {};

    res.json({
      ok: true,
      igUserId:    igAcct.id,
      igUsername:  igBody.username || null,
      igName:      igBody.name     || null,
      alreadySet:  Boolean(currentId),
      currentId:   currentId || null,
      action: currentId === igAcct.id
        ? "INSTAGRAM_USER_ID already matches — nothing to do."
        : `Set INSTAGRAM_USER_ID=${igAcct.id} in Hostinger env panel, then redeploy.`,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Attribution dashboard ─────────────────────────────────────────────────
// GET /scoop-ops/attribution  — per-article stats: social posts, video job,
//   analytics events (views/saves/shares last 7d), meter opens, credibility.
//   Helps understand which article types/topics drive the most engagement.
router.get("/attribution", requireAdmin, (_req, res) => {
  const db = getDb();

  // Top 60 articles from the last 7 days
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const articles = db.prepare(`
    SELECT id, title, source_name, category, published_at, credibility, url
    FROM articles
    WHERE published_at > ?
    ORDER BY credibility DESC, published_at DESC
    LIMIT 60
  `).all(weekAgo);

  if (!articles.length) {
    return res.type("html").send("<html><body><h2>No recent articles found.</h2></body></html>");
  }

  const ids = articles.map(a => a.id);
  const ph  = ids.map(() => "?").join(",");

  // Social posts per article
  const socialRows = db.prepare(`
    SELECT article_id, platform, status, url, posted_at
    FROM social_posts WHERE article_id IN (${ph})
    ORDER BY posted_at DESC
  `).all(...ids);
  const socialByArticle = {};
  for (const r of socialRows) {
    if (!socialByArticle[r.article_id]) socialByArticle[r.article_id] = [];
    socialByArticle[r.article_id].push(r);
  }

  // Video jobs per article
  const videoRows = db.prepare(`
    SELECT article_id, id AS job_id, status, has_audio, duration_secs, output_path
    FROM video_jobs WHERE article_id IN (${ph})
    ORDER BY created_at DESC
  `).all(...ids);
  const videoByArticle = {};
  for (const r of videoRows) {
    if (!videoByArticle[r.article_id]) videoByArticle[r.article_id] = r;
  }

  // Analytics events per article (last 7 days)
  const analyticsRows = db.prepare(`
    SELECT article_id,
      SUM(CASE WHEN event_type = 'article_view'            THEN 1 ELSE 0 END) AS views,
      SUM(CASE WHEN event_type = 'save_article'            THEN 1 ELSE 0 END) AS saves,
      SUM(CASE WHEN event_type = 'article_click_outbound'  THEN 1 ELSE 0 END) AS clicks,
      SUM(CASE WHEN event_type = 'share_click'             THEN 1 ELSE 0 END) AS shares,
      SUM(CASE WHEN event_type = 'reader_open'             THEN 1 ELSE 0 END) AS reader_opens
    FROM analytics
    WHERE article_id IN (${ph}) AND created_at > ?
    GROUP BY article_id
  `).all(...ids, weekAgo);
  const analyticsByArticle = {};
  for (const r of analyticsRows) analyticsByArticle[r.article_id] = r;

  // Meter opens per article (last 30 days)
  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const meterRows = db.prepare(`
    SELECT article_id, COUNT(*) AS opens
    FROM meter_events WHERE article_id IN (${ph}) AND created_at > ?
    GROUP BY article_id
  `).all(...ids, monthAgo);
  const meterByArticle = {};
  for (const r of meterRows) meterByArticle[r.article_id] = r.opens;

  res.type("html").send(renderAttributionPage(articles, { socialByArticle, videoByArticle, analyticsByArticle, meterByArticle }));
});

const PLATFORM_ICONS = {
  bluesky: "🦋", threads: "🧵", facebook: "📘", linkedin: "💼",
  pinterest: "📌", instagram: "📸", x: "✕",
};

function renderAttributionPage(articles, { socialByArticle, videoByArticle, analyticsByArticle, meterByArticle }) {
  const now = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const rows = articles.map(a => {
    const social   = socialByArticle[a.id] || [];
    const video    = videoByArticle[a.id] || null;
    const stats    = analyticsByArticle[a.id] || {};
    const meterN   = meterByArticle[a.id] || 0;
    const age      = Math.round((Date.now() - a.published_at) / 3600000);
    const ageStr   = age < 24 ? `${age}h ago` : `${Math.round(age/24)}d ago`;

    const platformCells = social.map(s =>
      `<a href="${xmlEscape(s.url || "#")}" target="_blank" rel="noopener" title="${xmlEscape(s.platform)} · ${xmlEscape(s.status)}" style="opacity:${s.status==="posted"?1:0.4}">${PLATFORM_ICONS[s.platform] || "📢"}</a>`
    ).join(" ");

    const videoCell = video
      ? `<span title="Job #${video.job_id}: ${video.status}${video.duration_secs ? ` · ${video.duration_secs}s` : ""}">
           ${video.status==="published"?"🎬✓":video.status==="review_approved"?"🎬⏳":video.status==="ready"?"🎬👁️":video.status==="failed"?"🎬✗":"🎬⏳"}
         </span>`
      : "<span style='color:#ccc'>—</span>";

    return `
      <tr>
        <td style="max-width:320px">
          <a href="${xmlEscape(SITE_URL)}/article/${encodeURIComponent(a.id)}" target="_blank" rel="noopener"
             style="font-weight:600;font-size:13px;color:inherit;text-decoration:none;display:block;line-height:1.3">
            ${xmlEscape(a.title.slice(0, 90))}${a.title.length > 90 ? "…" : ""}
          </a>
          <div style="font-size:11px;color:#888;margin-top:2px">${xmlEscape(a.source_name)} · ${xmlEscape(a.category)} · ${ageStr}</div>
        </td>
        <td class="num">${a.credibility}</td>
        <td class="num">${stats.views || 0}</td>
        <td class="num">${stats.reader_opens || 0}</td>
        <td class="num">${stats.saves || 0}</td>
        <td class="num">${stats.clicks || 0}</td>
        <td class="num">${stats.shares || 0}</td>
        <td class="num">${meterN}</td>
        <td style="font-size:16px;white-space:nowrap">${platformCells || "<span style='color:#ccc'>—</span>"}</td>
        <td style="font-size:16px">${videoCell}</td>
      </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Scoop · Attribution</title>
<style>
  :root{color-scheme:light dark}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;margin:0;background:#f8f8fa;color:#111;font-size:13px}
  @media(prefers-color-scheme:dark){body{background:#0b0b0d;color:#e5e5e5}table{border-color:#23232a!important}th{background:#141418!important;border-color:#23232a!important}tr:hover td{background:#141418!important}}
  .wrap{max-width:1400px;margin:0 auto;padding:20px 16px 60px}
  h1{font-size:22px;margin:0 0 4px}
  .meta{font-size:12px;color:#888;margin-bottom:18px}
  table{width:100%;border-collapse:collapse;border:1px solid #e5e5e8;border-radius:10px;overflow:hidden;background:#fff}
  th{background:#f3f3f5;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;padding:8px 12px;text-align:left;border-bottom:1px solid #e5e5e8;white-space:nowrap}
  td{padding:8px 12px;border-bottom:1px solid #f0f0f2;vertical-align:top}
  tr:last-child td{border-bottom:0}
  tr:hover td{background:#fafafa}
  .num{text-align:right;font-variant-numeric:tabular-nums;color:#555}
  .legend{margin-top:12px;font-size:11px;color:#888;display:flex;gap:16px;flex-wrap:wrap}
  .nav{display:flex;gap:16px;margin-bottom:20px;font-size:13px}
  .nav a{color:#007AFF;text-decoration:none;padding:6px 14px;border:1px solid #007AFF;border-radius:20px}
  .nav a:hover{background:#007AFF;color:#fff}
</style>
</head>
<body>
<div class="wrap">
  <h1>Scoop · Attribution Dashboard</h1>
  <div class="meta">Top ${articles.length} articles · last 7 days · generated ${xmlEscape(now)}</div>
  <div class="nav">
    <a href="social-queue">Social Queue</a>
    <a href="attribution">Attribution ←</a>
    <a href="videos-gen/queue">Video Queue</a>
  </div>
  <table>
    <thead>
      <tr>
        <th>Article</th>
        <th>Cred</th>
        <th>Views</th>
        <th>Reader</th>
        <th>Saves</th>
        <th>Clicks</th>
        <th>Shares</th>
        <th>Meter</th>
        <th>Social</th>
        <th>Video</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="legend">
    <span>📊 Views/Reader/Saves/Clicks/Shares = analytics events (7d)</span>
    <span>🔢 Meter = unique article opens (30d)</span>
    <span>🎬✓ Published · 🎬👁️ Ready for review · 🎬✗ Failed</span>
    <span>Platform icons link to the posted URL</span>
  </div>
</div>
</body>
</html>`;
}

function xmlEscape(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderPage(composed) {
  const now = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const cards = composed.map((item, idx) => renderCard(item, idx)).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Scoop · Social Queue</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; margin: 0; background: #f8f8fa; color: #111; line-height: 1.5; }
  @media (prefers-color-scheme: dark) { body { background: #0b0b0d; color: #e5e5e5; } .card, .platform { background: #141418 !important; border-color: #23232a !important; } textarea { background: #0b0b0d !important; color: #e5e5e5 !important; border-color: #2a2a33 !important; } }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 20px 16px 60px; }
  h1 { font-size: 24px; margin: 0 0 6px; }
  .meta { font-size: 13px; color: #888; margin-bottom: 24px; }
  .card { background: #fff; border: 1px solid #e5e5e8; border-radius: 14px; padding: 16px; margin-bottom: 18px; }
  .hdr { display: flex; gap: 12px; margin-bottom: 12px; align-items: flex-start; }
  .hdr img { width: 80px; height: 80px; object-fit: cover; border-radius: 8px; flex-shrink: 0; background: #eee; }
  .hdr h2 { font-size: 16px; line-height: 1.3; margin: 0 0 6px; }
  .hdr .tag { display: inline-block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 6px; border-radius: 4px; background: #DC2626; color: #fff; font-weight: 700; margin-right: 6px; }
  .hdr .src { font-size: 12px; color: #666; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px; }
  .platform { border: 1px solid #e5e5e8; border-radius: 10px; padding: 10px 12px; background: #fafafa; }
  .platform .label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #DC2626; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; }
  .platform textarea { width: 100%; min-height: 90px; font-family: ui-monospace, Menlo, monospace; font-size: 12px; padding: 6px 8px; border: 1px solid #e0e0e5; border-radius: 6px; resize: vertical; background: #fff; color: #111; box-sizing: border-box; }
  .platform .footer { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 11px; color: #888; }
  .platform button { font-size: 11px; background: #DC2626; color: #fff; border: 0; padding: 3px 10px; border-radius: 999px; font-weight: 600; cursor: pointer; }
  .platform button:hover { opacity: 0.9; }
  .platform button.copied { background: #22c55e; }
  .platform .warn { color: #DC2626; font-weight: 600; }
  .note { font-size: 11px; color: #888; margin-top: 4px; font-style: italic; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Scoop · Social Queue</h1>
    <div class="meta">${composed.length} articles · generated ${xmlEscape(now)} · copy the caption you want, paste it on the platform.</div>
    ${cards}
  </div>
  <script>
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-copy]");
      if (!btn) return;
      const ta = document.getElementById(btn.dataset.copy);
      if (!ta) return;
      ta.select();
      navigator.clipboard.writeText(ta.value).then(() => {
        const old = btn.textContent;
        btn.textContent = "Copied ✓";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = old;
          btn.classList.remove("copied");
          window.getSelection()?.removeAllRanges();
        }, 1500);
      });
    });
  </script>
</body>
</html>`;
}

const PLATFORM_LIMITS = {
  x: 280,
  threads: 500,
  facebook: 63206,
  linkedin: 3000,
  instagram_feed: 2200,
  pinterest: 500,
  bluesky: 300,
};

function renderCard(item, idx) {
  const a = item.article;
  const platforms = Object.entries(item.platforms).map(([name, p]) => {
    const limit = PLATFORM_LIMITS[name] || 0;
    const over = limit && p.characterCount > limit;
    const id = `ta-${idx}-${name}`;
    return `
    <div class="platform">
      <div class="label">
        ${name.replace("_", " ")}
        <button data-copy="${id}">Copy</button>
      </div>
      <textarea id="${id}" readonly>${xmlEscape(p.caption)}</textarea>
      <div class="footer">
        <span ${over ? 'class="warn"' : ""}>${p.characterCount}${limit ? ` / ${limit}` : ""} chars</span>
        <a href="${xmlEscape(p.url)}" target="_blank" rel="noopener">open url →</a>
      </div>
      ${p.meta?.note ? `<div class="note">${xmlEscape(p.meta.note)}</div>` : ""}
    </div>`;
  }).join("");

  return `
  <section class="card">
    <div class="hdr">
      ${a.image_url ? `<img src="${xmlEscape(a.image_url)}" alt="" onerror="this.style.display='none'">` : ""}
      <div>
        <h2>${xmlEscape(a.title)}</h2>
        <span class="tag">${xmlEscape(a.category || "news")}</span>
        <span class="src">${xmlEscape(a.source_name || "")}</span>
      </div>
    </div>
    <div class="grid">${platforms}</div>
  </section>`;
}

export default router;
