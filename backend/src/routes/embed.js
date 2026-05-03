/**
 * /embed — public, no-auth iframe embeds for blogs and Substacks.
 *
 *   GET /embed/event/:slug    — single event mini-dossier (plan §5M)
 *   GET /embed/market/:id     — single Polymarket card with sparkline (plan §5M)
 *
 * Self-contained HTML document with inline CSS — embedders don't need to
 * load any external assets. Cached at the CDN layer for 5 min. CORS open.
 * X-Frame-Options stripped on this route so any site can iframe us
 * (the whole point — drives organic backlinks).
 */

import { Router } from "express";
import { getDb } from "../models/database.js";
import { logger } from "../services/logger.js";

const router = Router();
const SITE = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
function fmtPct(v) { return Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—"; }
function relTime(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 3600_000)  return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} h ago`;
  return `${Math.floor(diff / 86_400_000)} d ago`;
}
function severityColor(s) {
  if (s == null) return "#6b7280";
  if (s >= 0.7)  return "#dc2626";
  if (s >= 0.4)  return "#f59e0b";
  return "#10b981";
}
function gapBadge(gap) {
  if (gap == null || Math.abs(gap) < 0.15) return "";
  const positive = gap > 0;
  const bg    = positive ? "#fef3c7" : "#ede9fe";
  const text  = positive ? "#92400e" : "#5b21b6";
  const arrow = positive ? "↑M" : "↑N";
  const label = positive ? "Markets > Media" : "Media > Markets";
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;background:${bg};color:${text};font-size:10px;font-weight:700;letter-spacing:0.5px">
    <span style="font-family:monospace">${arrow}</span> TRUTH GAP ${gap > 0 ? "+" : ""}${gap.toFixed(2)} <span style="opacity:0.7;font-weight:400">— ${label}</span>
  </span>`;
}

router.get("/event/:slug", (req, res) => {
  try {
    const db = getDb();
    const ev = db.prepare(`
      SELECT e.id, e.slug, e.title, e.summary, e.category, e.status, e.severity,
             e.last_activity_at,
        (SELECT COUNT(*) FROM event_articles ea WHERE ea.event_id = e.id) AS article_count,
        (SELECT pm.yes_price FROM event_market_links eml
          JOIN prediction_markets pm ON pm.id = eml.market_id
          WHERE eml.event_id = e.id ORDER BY eml.rank LIMIT 1) AS top_yes,
        (SELECT pm.source    FROM event_market_links eml
          JOIN prediction_markets pm ON pm.id = eml.market_id
          WHERE eml.event_id = e.id ORDER BY eml.rank LIMIT 1) AS source,
        (SELECT pm.question  FROM event_market_links eml
          JOIN prediction_markets pm ON pm.id = eml.market_id
          WHERE eml.event_id = e.id ORDER BY eml.rank LIMIT 1) AS question,
        (SELECT r.truth_gap     FROM reality_index_snapshots r
          WHERE r.scope='event' AND r.scope_id = e.id ORDER BY r.ts DESC LIMIT 1) AS truth_gap,
        (SELECT r.reality_score FROM reality_index_snapshots r
          WHERE r.scope='event' AND r.scope_id = e.id ORDER BY r.ts DESC LIMIT 1) AS reality_score
      FROM events e WHERE e.slug = ?
    `).get(req.params.slug);

    // CORS / framing — let any site embed us.
    res.removeHeader("X-Frame-Options");
    res.setHeader("Content-Security-Policy", "frame-ancestors *");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");

    if (!ev) {
      res.status(404).send(`<!doctype html><meta charset="utf-8"><body style="font:13px system-ui;padding:16px;color:#666">Event not found. <a href="${SITE}/events">Browse events</a></body>`);
      return;
    }

    const sevColor = severityColor(ev.severity);
    const yesPct   = ev.top_yes != null ? Math.round(ev.top_yes * 100) : null;
    const fullUrl  = `${SITE}/events/${encodeURIComponent(ev.slug)}`;

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(ev.title)} — Scoopfeeds Reality Index</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer-when-downgrade">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#111;line-height:1.4;font-size:14px}
    body{padding:16px;border:1px solid #e5e7eb;border-radius:12px;max-width:540px;margin:auto}
    .meta{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
    .badge{font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;background:#eff6ff;color:#2563eb;text-transform:capitalize}
    .live{display:inline-flex;align-items:center;gap:4px;font-size:9px;font-weight:700;color:#15803d}
    .live::before{content:"";width:6px;height:6px;border-radius:50%;background:#22c55e;display:inline-block;animation:p 2s infinite}
    @keyframes p{0%,100%{opacity:1}50%{opacity:0.4}}
    h1{font-size:18px;line-height:1.25;margin-bottom:8px;font-weight:700}
    .summary{font-size:13px;color:#444;margin-bottom:14px}
    .sev{display:flex;align-items:center;gap:8px;font-size:11px;color:#666;margin-bottom:14px}
    .sev-bar{flex:1;height:5px;background:#e5e7eb;border-radius:999px;overflow:hidden;max-width:140px}
    .sev-bar > div{height:100%;border-radius:999px;background:${sevColor}}
    .market{background:#f9fafb;padding:12px;border-radius:8px;margin-bottom:12px}
    .market-q{font-size:12px;color:#666;margin-bottom:6px}
    .prob-row{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;font-size:12px;font-weight:600}
    .prob-yes{color:${sevColor}}
    .prob-no{color:#999}
    .prob-bar{height:8px;background:#e5e7eb;border-radius:999px;overflow:hidden}
    .prob-bar > div{height:100%;border-radius:999px;background:${sevColor};transition:width 400ms}
    .source{font-size:10px;color:#999;margin-top:6px}
    .footer{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:#888;border-top:1px solid #f3f4f6;padding-top:10px}
    .footer a{color:#2563eb;text-decoration:none;font-weight:600}
    .footer a:hover{text-decoration:underline}
    .disclaimer{font-size:10px;color:#aaa;font-style:italic;margin-top:6px;text-align:center}
  </style>
</head>
<body>
  <div class="meta">
    <span class="badge">${escapeHtml(ev.category || "general")}</span>
    ${ev.status === "active" ? '<span class="live">LIVE</span>' : ""}
    ${gapBadge(ev.truth_gap)}
  </div>
  <h1><a href="${fullUrl}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${escapeHtml(ev.title)}</a></h1>
  ${ev.summary ? `<p class="summary">${escapeHtml(ev.summary)}</p>` : ""}
  <div class="sev">
    <span>Signal strength</span>
    <div class="sev-bar"><div style="width:${Math.round((ev.severity || 0) * 100)}%"></div></div>
    <span>${Math.round((ev.severity || 0) * 100)}%</span>
  </div>
  ${yesPct != null ? `
  <div class="market">
    <div class="market-q">${escapeHtml(ev.question || "Top market")}</div>
    <div class="prob-row">
      <span class="prob-yes">YES ${yesPct}%</span>
      <span class="prob-no">NO ${100 - yesPct}%</span>
    </div>
    <div class="prob-bar"><div style="width:${yesPct}%"></div></div>
    <div class="source">Source: ${escapeHtml(ev.source || "Polymarket")} · Market-implied probability, not a prediction guarantee.</div>
  </div>` : ""}
  <div class="footer">
    <span>${ev.article_count} article${ev.article_count === 1 ? "" : "s"} · updated ${relTime(ev.last_activity_at)}</span>
    <a href="${fullUrl}" target="_blank" rel="noopener">Full dossier on Scoopfeeds →</a>
  </div>
  <p class="disclaimer">A data-backed estimate, not a certainty.</p>
</body>
</html>`;

    res.send(html);
  } catch (err) {
    logger.error(`embed/event error: ${err.message}`);
    res.status(500).send("<!doctype html><body>Internal server error</body>");
  }
});

// ─── /embed/market/:id ─────────────────────────────────────────────────
router.get("/market/:id", (req, res) => {
  try {
    const db = getDb();
    const m = db.prepare(`
      SELECT id, source, source_market_id, question, description, url, slug,
             yes_price, no_price, volume_24h, liquidity, end_date, active,
             category
      FROM prediction_markets WHERE id = ?
    `).get(req.params.id);

    // 24h sparkline points (hot tier).
    const points = m
      ? db.prepare(`
          SELECT yes_price, ts FROM prediction_market_snapshots
          WHERE market_id = ? AND tier = 'hot' AND ts >= ?
          ORDER BY ts ASC
        `).all(req.params.id, Date.now() - 24 * 60 * 60 * 1000)
      : [];

    res.removeHeader("X-Frame-Options");
    res.setHeader("Content-Security-Policy", "frame-ancestors *");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");

    if (!m) {
      res.status(404).send(`<!doctype html><meta charset="utf-8"><body style="font:13px system-ui;padding:16px;color:#666">Market not found. <a href="${SITE}/predictions">Browse markets</a></body>`);
      return;
    }

    const yesPct = Math.round((m.yes_price || 0) * 100);
    const fullUrl = m.url || `${SITE}/predictions`;
    const ends = m.end_date ? new Date(m.end_date).toISOString().slice(0, 10) : null;
    // Inline SVG sparkline. Width 200, height 30. Y-axis 0..1.
    let sparkline = "";
    if (points.length >= 2) {
      const W = 200, H = 30, pad = 2;
      const xs = points.map((_, i) => pad + (i / (points.length - 1)) * (W - 2 * pad));
      const ys = points.map(p => H - pad - (p.yes_price ?? 0) * (H - 2 * pad));
      const path = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ");
      const fill = severityColor(m.yes_price);
      sparkline = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:30px;display:block">
        <line x1="0" y1="${H/2}" x2="${W}" y2="${H/2}" stroke="#e5e7eb" stroke-dasharray="2 3" stroke-width="0.5"/>
        <path d="${path}" fill="none" stroke="${fill}" stroke-width="1.5"/>
      </svg>`;
    }

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(m.question)} — Scoopfeeds Reality Index</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer-when-downgrade">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#111;line-height:1.4;font-size:14px}
    body{padding:16px;border:1px solid #e5e7eb;border-radius:12px;max-width:480px;margin:auto}
    .src{font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;font-weight:600}
    h1{font-size:16px;line-height:1.3;margin-bottom:10px;font-weight:700}
    .prob-row{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;font-size:13px;font-weight:600}
    .prob-yes{color:${severityColor(m.yes_price)}}
    .prob-no{color:#999}
    .prob-bar{height:8px;background:#e5e7eb;border-radius:999px;overflow:hidden;margin-bottom:6px}
    .prob-bar > div{height:100%;border-radius:999px;background:${severityColor(m.yes_price)}}
    .meta{font-size:11px;color:#666;display:flex;gap:10px;margin-top:10px;flex-wrap:wrap}
    .meta b{color:#111}
    .footer{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:#888;border-top:1px solid #f3f4f6;padding-top:10px;margin-top:10px}
    .footer a{color:#2563eb;text-decoration:none;font-weight:600}
    .disclaimer{font-size:10px;color:#aaa;font-style:italic;margin-top:6px;text-align:center}
  </style>
</head>
<body>
  <div class="src">${escapeHtml(m.source || "Polymarket")}${m.category ? " · " + escapeHtml(m.category) : ""}</div>
  <h1><a href="${escapeHtml(fullUrl)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${escapeHtml(m.question)}</a></h1>
  <div class="prob-row">
    <span class="prob-yes">YES ${yesPct}%</span>
    <span class="prob-no">NO ${100 - yesPct}%</span>
  </div>
  <div class="prob-bar"><div style="width:${yesPct}%"></div></div>
  ${sparkline}
  <div class="meta">
    ${m.volume_24h ? `<span>Vol 24h <b>$${Math.round(m.volume_24h).toLocaleString()}</b></span>` : ""}
    ${m.liquidity ? `<span>Liq <b>$${Math.round(m.liquidity).toLocaleString()}</b></span>` : ""}
    ${ends ? `<span>Ends <b>${ends}</b></span>` : ""}
  </div>
  <div class="footer">
    <span>Source: ${escapeHtml(m.source || "Polymarket")}</span>
    <a href="${escapeHtml(fullUrl)}" target="_blank" rel="noopener">View on ${escapeHtml(m.source || "source")} →</a>
  </div>
  <p class="disclaimer">Market-implied probability. Not a prediction guarantee.</p>
</body>
</html>`;

    res.send(html);
  } catch (err) {
    logger.error(`embed/market error: ${err.message}`);
    res.status(500).send("<!doctype html><body>Internal server error</body>");
  }
});

export default router;
