/**
 * shotDigest.js — the daily digest of published shot-engine shorts (brief,
 * Phase 6): one email to DrJ per UTC day with each short's metrics, the bars it
 * missed, and its 12-frame contact sheet embedded inline.
 *
 * Modelled on xPostDigest.js: DIGEST_RECIPIENT_EMAIL + the shared SMTP mailer,
 * and it SKIPS cleanly — no recipient, no SMTP, or no short published that day.
 * A short that missed a bar still published; the digest is where that shows.
 */

import { logger } from "../logger.js";
import { sendMail, getTransport } from "../mailer.js";
import { publishedOn, BARS } from "./shotMetrics.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (x) => `${Math.round((Number(x) || 0) * 100)}%`;
export const yesterdayUtc = (now = Date.now()) => new Date(now - 86_400_000).toISOString().slice(0, 10);

export function renderShotDigest(records, day) {
  const flagged = records.filter((r) => !r.bars?.pass);
  const subject = `Scoop shorts digest — ${day} — ${records.length} published${flagged.length ? ` · ${flagged.length} missed a bar` : ""}`;
  const attachments = [];
  const cards = records.map((r, i) => {
    const m = r.metrics || {};
    const cid = `sheet-${i}@scoopfeeds`;
    if (r.sheetPath) attachments.push({ filename: `${r.articleId}.jpg`, path: r.sheetPath, cid });
    const bars = r.bars?.pass
      ? `<div style="color:#1a7f37;font-weight:600">Meets every bar</div>`
      : `<div style="color:#b42318;font-weight:700">MISSED: ${esc((r.bars?.misses || []).join(" · "))}</div>`;
    return `
      <div style="border:1px solid #e5e5e5;border-radius:8px;padding:14px;margin:0 0 18px">
        <div style="font-weight:700;font-size:15px">${esc(r.title)}</div>
        <div style="font-size:12px;color:#666;margin:2px 0 8px">${esc(r.source)} · ${new Date(r.publishedAt).toISOString().slice(11, 16)} UTC
          ${r.youtubeId ? ` · <a href="https://youtube.com/shorts/${esc(r.youtubeId)}">youtube.com/shorts/${esc(r.youtubeId)}</a>` : ""}</div>
        ${bars}
        <table style="font-size:13px;margin:8px 0;border-collapse:collapse">
          <tr><td style="padding:2px 12px 2px 0">Real imagery</td><td><b>${pct(m.realShare)}</b> (bar ≥ ${pct(BARS.realShareMin)})</td></tr>
          <tr><td style="padding:2px 12px 2px 0">Real video</td><td><b>${pct(m.videoShare)}</b>${r.videoFound ? ` (bar ≥ ${pct(BARS.videoShareMin)})` : " (no video found — bar n/a)"}</td></tr>
          <tr><td style="padding:2px 12px 2px 0">Average shot</td><td><b>${esc(m.avgShotSecs)} s</b> (bar ≤ ${BARS.avgShotMax} s) · ${esc(m.shots)} shots</td></tr>
          <tr><td style="padding:2px 12px 2px 0">Card fallbacks</td><td>${esc(m.cardFallbacks ?? 0)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0">Outlets shown</td><td>${esc(m.outlets ?? 0)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0">Sound</td><td>${esc(r.sound?.tone)} → ${esc(r.sound?.bed)} · ${esc(r.sound?.I)} LUFS · TP ${esc(r.sound?.TP)} dBTP</td></tr>
        </table>
        ${r.sheetPath ? `<img src="cid:${cid}" alt="12-frame contact sheet" style="width:100%;max-width:612px;border-radius:4px">` : `<div style="color:#999">(no contact sheet)</div>`}
      </div>`;
  }).join("");
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:660px;margin:auto;padding:24px;color:#111">
      <div style="font-size:22px;font-weight:800">Scoop shorts digest</div>
      <div style="font-size:13px;color:#666;margin-bottom:14px">${day} · ${records.length} published by the shot engine${flagged.length ? ` · <b style="color:#b42318">${flagged.length} missed a bar</b>` : ""}</div>
      ${cards}
      <div style="font-size:11px;color:#888;border-top:1px solid #eee;padding-top:12px">Bars from the approved Greenland sample (brief §0). A short that misses a bar still publishes; this digest is where it shows.</div>
    </div>`;
  const text = `Scoop shorts digest — ${day}\n${records.length} published${flagged.length ? `, ${flagged.length} missed a bar` : ""}\n\n` +
    records.map((r) => `- ${r.title} (${r.source}) ${r.youtubeId ? `https://youtube.com/shorts/${r.youtubeId}` : ""}\n  real ${pct(r.metrics?.realShare)} · video ${pct(r.metrics?.videoShare)} · avg shot ${r.metrics?.avgShotSecs}s · ${r.bars?.pass ? "meets every bar" : `MISSED: ${(r.bars?.misses || []).join("; ")}`}`).join("\n") + "\n";
  return { subject, html, text, attachments, count: records.length, flagged: flagged.length };
}

export async function sendShotDigest({ day = yesterdayUtc(), deps = {} } = {}) {
  const recipient = process.env.DIGEST_RECIPIENT_EMAIL;
  if (!recipient) { logger.info("📊 shorts digest: skipped (DIGEST_RECIPIENT_EMAIL unset)"); return { sent: false, reason: "no_recipient" }; }
  if (!(deps.getTransport || getTransport)()) { logger.info("📊 shorts digest: skipped (no SMTP)"); return { sent: false, reason: "no_smtp" }; }
  const records = (deps.publishedOn || publishedOn)(day);
  if (!records.length) { logger.info(`📊 shorts digest: skipped (no shot-engine short published on ${day})`); return { sent: false, reason: "empty", day }; }
  const d = renderShotDigest(records, day);
  try {
    await (deps.sendMail || sendMail)({ to: recipient, subject: d.subject, html: d.html, text: d.text, attachments: d.attachments });
  } catch (err) {
    logger.error(`📊 shorts digest: send failed — ${err.message}`);
    return { sent: false, reason: "send_failed", error: err.message };
  }
  logger.info(`📬 shorts digest sent for ${day}: ${d.count} short(s), ${d.flagged} flagged, to ${recipient}`);
  return { sent: true, day, count: d.count, flagged: d.flagged };
}
