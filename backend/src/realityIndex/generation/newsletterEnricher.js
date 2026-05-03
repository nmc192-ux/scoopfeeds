/**
 * newsletterEnricher — builds a "Reality Index — top movers" block to inject
 * into the daily digest.
 *
 * Picks the top truth-gap events in the last 24h, hydrates with their market
 * probability + composite + a one-line summary, and returns `{ html, text }`
 * mirroring the sponsor block's interface so digest.js can drop it in
 * without touching the rendering pipeline.
 *
 * Returns `{ html: "", text: "" }` when there's nothing worth surfacing
 * (no events meet the confidence floor, or no truth-gap divergence beyond
 * the threshold). digest.js renders nothing in that case.
 */

import { topTruthGap } from "../dal/realityIndexDao.js";
import { getDb } from "../../models/database.js";
import { logger } from "../../services/logger.js";

const SITE_URL = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");
const MAX_ITEMS = 3;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MIN_GAP   = 0.20;          // skip near-aligned items — they're not "movers"

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function pct(v) { return Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—"; }

function gapStyle(gap) {
  if (gap > 0)  return { bg: "#fef3c7", text: "#92400e", arrow: "↑M", label: "Markets > Media" };
  if (gap < 0)  return { bg: "#ede9fe", text: "#5b21b6", arrow: "↑N", label: "Media > Markets" };
  return         { bg: "#f3f4f6", text: "#374151", arrow: "≈",  label: "Aligned" };
}

function pickItems() {
  try {
    const all = topTruthGap({ windowMs: WINDOW_MS, limit: 12, direction: "both", scope: "event" });
    const filtered = all.filter(r => Math.abs(r.truth_gap ?? 0) >= MIN_GAP).slice(0, MAX_ITEMS);
    if (!filtered.length) return [];

    // Hydrate event title + slug — topTruthGap returns raw snapshot rows.
    const ids = filtered.map(r => r.scope_id);
    const meta = new Map(
      getDb().prepare(
        `SELECT id, slug, title FROM events WHERE id IN (${ids.map(() => "?").join(",")})`
      ).all(...ids).map(e => [e.id, e])
    );
    return filtered
      .map(r => {
        const m = meta.get(r.scope_id);
        return m ? { ...r, slug: m.slug, title: m.title } : null;
      })
      .filter(Boolean);
  } catch (err) {
    logger.warn(`newsletterEnricher: pickItems failed: ${err.message}`);
    return [];
  }
}

/** Returns { html, text } — both '' when nothing to surface. */
export function buildRealityIndexBlock() {
  const items = pickItems();
  if (!items.length) return { html: "", text: "" };

  const rows = items.map(it => {
    const url   = `${SITE_URL}/events/${encodeURIComponent(it.slug || "")}`;
    const gap   = it.truth_gap ?? 0;
    const style = gapStyle(gap);
    const gapTxt = `${gap > 0 ? "+" : ""}${gap.toFixed(2)}`;
    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f4f9">
          <a href="${escapeHtml(url)}" style="color:#111;text-decoration:none">
            <div style="font-weight:600;font-size:14px;line-height:1.4;margin-bottom:6px">
              ${escapeHtml(it.title || "")}
            </div>
          </a>
          <div style="font-size:11px;color:#555;display:flex;gap:8px;align-items:center">
            <span style="background:${style.bg};color:${style.text};padding:2px 7px;border-radius:999px;font-weight:700;font-size:10px;letter-spacing:0.4px">
              ${style.arrow} TRUTH GAP ${gapTxt}
            </span>
            <span>Market <strong>${pct(it.market_probability)}</strong></span>
            <span>Composite <strong>${pct(it.reality_score)}</strong></span>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  const html = `
    <div style="margin:18px 0 22px;padding:16px 18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#475569;font-weight:700;margin-bottom:10px">
        📊 Reality Index — top movers
      </div>
      <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      <div style="font-size:11px;color:#64748b;margin-top:10px;line-height:1.5">
        Difference between media tone and market-implied probability.
        <a href="${SITE_URL}/truth-gap" style="color:#475569;text-decoration:underline">See full ranking →</a>
      </div>
      <div style="font-size:10px;color:#94a3b8;margin-top:6px;font-style:italic">
        A data-backed estimate, not a certainty.
      </div>
    </div>
  `;

  const textRows = items.map(it => {
    const url = `${SITE_URL}/events/${it.slug || ""}`;
    const gap = it.truth_gap ?? 0;
    const sign = gap > 0 ? "Markets ↑" : gap < 0 ? "Media ↑" : "Aligned";
    return `• ${it.title}\n  Truth gap ${gap > 0 ? "+" : ""}${gap.toFixed(2)} (${sign}) · Market ${pct(it.market_probability)} · Composite ${pct(it.reality_score)}\n  ${url}`;
  }).join("\n\n");

  const text = `
─ Reality Index — top movers ─
${textRows}

Full ranking: ${SITE_URL}/truth-gap
A data-backed estimate, not a certainty.

`;

  return { html, text };
}
