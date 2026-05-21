/**
 * X-Posting Queue digest — Phase B Sprint 2.x.2.
 *
 * Daily email to the DIGEST_RECIPIENT_EMAIL address listing X-ready posts
 * queued by Sprint 2.x.1's xPostGenerator. The recipient (DrJ in production)
 * copy-pastes from the digest to @scoop_feeds on X, then Sprint 2.x.3 will
 * provide a mark-posted endpoint to advance status: sent_in_digest →
 * marked_posted.
 *
 * Scheduled at 09:00 UTC daily from scheduler.js. No-op when:
 *   - DIGEST_RECIPIENT_EMAIL unset
 *   - SMTP unset (mailer returns null transport)
 *   - Queue has nothing pending digest delivery
 *
 * On successful send, advances rows to status='sent_in_digest' and stamps
 * sent_in_digest_at — both per Migration 004's designed lifecycle.
 */
import { listPostsForDigest, markDigestSent } from "../models/database.js";
import { getTransport, sendMail } from "./mailer.js";
import { logger } from "./logger.js";

const SITE_URL = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function todayUtcISODate() {
  return new Date().toISOString().slice(0, 10);
}

// Group rows by thread_group_id. Singletons (thread_group_id IS NULL) each
// get their own synthetic group key. Rows within a group are already ordered
// by thread_position ASC from the DAO.
export function groupRowsByThread(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.thread_group_id || `single:${row.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Array.from(groups.values());
}

function renderHtmlGroup(group, groupIndex) {
  const isThread = group.length > 1 || group[0].post_type === "thread";
  const article = group[0];
  const headerLabel = isThread ? `Thread ${groupIndex + 1} — ${group.length} parts` : `Post ${groupIndex + 1}`;
  const articleLine = article.article_title
    ? `${escapeHtml(article.article_title)}${article.article_category ? ` · ${escapeHtml(article.article_category)}` : ""}`
    : "(article missing)";
  const articleLink = article.article_url
    ? `<a href="${escapeHtml(article.article_url)}" style="color:#007AFF;text-decoration:none;font-size:12px">Open source ↗</a>`
    : "";

  const posts = group.map((row) => {
    const seqLabel = isThread
      ? `Tweet ${row.thread_position}/${row.thread_total} · ${row.post_text.length} chars`
      : `Single · ${row.post_text.length} chars`;
    return `
      <div style="margin:10px 0;padding:12px 14px;background:#f7f9fc;border:1px solid #e1e6ee;border-radius:8px">
        <div style="font-size:11px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">${seqLabel}</div>
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.5;white-space:pre-wrap;color:#111">${escapeHtml(row.post_text)}</div>
      </div>
    `;
  }).join("");

  return `
    <div style="margin:0 0 22px;padding:14px 16px;border-left:3px solid #007AFF;background:#fff">
      <div style="font-size:11px;color:#666;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px">${headerLabel}</div>
      <div style="font-weight:700;font-size:14px;color:#111;margin-bottom:6px">${articleLine}</div>
      ${articleLink ? `<div style="margin-bottom:8px">${articleLink}</div>` : ""}
      ${posts}
    </div>
  `;
}

function renderTextGroup(group, groupIndex) {
  const isThread = group.length > 1 || group[0].post_type === "thread";
  const article = group[0];
  const header = isThread
    ? `Thread ${groupIndex + 1} (${group.length} parts) — ${article.article_title || "(article missing)"}`
    : `Post ${groupIndex + 1} — ${article.article_title || "(article missing)"}`;
  const category = article.article_category ? ` [${article.article_category}]` : "";
  const sourceLine = article.article_url ? `  Source: ${article.article_url}\n` : "";

  const posts = group.map((row) => {
    const seq = isThread ? `Tweet ${row.thread_position}/${row.thread_total}` : "Single";
    return `\n  ── ${seq} (${row.post_text.length} chars) ──\n${row.post_text}\n`;
  }).join("");

  return `\n${"═".repeat(60)}\n${header}${category}\n${sourceLine}${posts}\n`;
}

export function renderDigest(rows) {
  const groups = groupRowsByThread(rows);
  const threadCount = groups.filter((g) => g.length > 1 || g[0].post_type === "thread").length;
  const singletonCount = groups.length - threadCount;
  const date = todayUtcISODate();
  const postsLabel = `${rows.length} ${rows.length === 1 ? "post" : "posts"}`;
  const threadsLabel = `${threadCount} ${threadCount === 1 ? "thread" : "threads"}`;
  const singletonsLabel = `${singletonCount} ${singletonCount === 1 ? "singleton" : "singletons"}`;
  const subject = `Scoop X-Digest — ${date} — ${postsLabel} (${threadsLabel})`;

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:auto;padding:24px;color:#111">
      <div style="font-size:22px;font-weight:800;margin-bottom:2px">Scoop X-Digest</div>
      <div style="font-size:13px;color:#666;margin-bottom:4px">${date}</div>
      <div style="font-size:13px;color:#444;margin-bottom:20px">
        <strong>${rows.length}</strong> ${rows.length === 1 ? "post" : "posts"} queued
        ${threadCount > 0 ? ` · ${threadsLabel}` : ""}
        ${singletonCount > 0 ? ` · ${singletonsLabel}` : ""}
      </div>
      <div style="font-size:12px;color:#666;padding:10px 12px;background:#f0f7ff;border-radius:6px;margin-bottom:20px">
        Copy each block to <a href="https://x.com/scoop_feeds" style="color:#007AFF">@scoop_feeds</a> on X.
        For threads, post the first tweet then reply with subsequent parts.
      </div>
      ${groups.map((g, i) => renderHtmlGroup(g, i)).join("")}
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#888">
        Generated by Scoopfeeds X-digest cron · Sprint 2.x.2 · <a href="${SITE_URL}" style="color:#888">scoopfeeds.com</a>
      </div>
    </div>
  `;

  const text = `Scoop X-Digest — ${date}\n${postsLabel} queued (${threadsLabel}, ${singletonsLabel})\n\nCopy each block to @scoop_feeds on X. For threads: post the first tweet, then reply with the subsequent parts.\n` +
    groups.map((g, i) => renderTextGroup(g, i)).join("") +
    `\n${"═".repeat(60)}\nGenerated by Scoopfeeds X-digest cron (Sprint 2.x.2)\n`;

  return { subject, html, text, threadCount, singletonCount, groupCount: groups.length };
}

export async function sendXPostDigest() {
  const recipient = process.env.DIGEST_RECIPIENT_EMAIL;
  if (!recipient) {
    logger.info("x-digest: skipped (DIGEST_RECIPIENT_EMAIL unset)");
    return { sent: false, reason: "no_recipient", count: 0 };
  }
  if (!getTransport()) {
    logger.info("x-digest: skipped (no SMTP configured)");
    return { sent: false, reason: "no_smtp", count: 0 };
  }

  const rows = listPostsForDigest({ limit: 200 });
  if (rows.length === 0) {
    logger.info("x-digest: skipped (queue empty)");
    return { sent: false, reason: "empty", count: 0 };
  }

  const { subject, html, text } = renderDigest(rows);

  try {
    await sendMail({ to: recipient, subject, html, text });
  } catch (err) {
    logger.error(`x-digest: send failed: ${err.message}`);
    return { sent: false, reason: "send_failed", error: err.message, count: rows.length };
  }

  const marked = markDigestSent(rows.map((r) => r.id), Date.now());
  logger.info(`📬 X-digest sent: ${rows.length} posts to ${recipient}; marked ${marked} rows`);
  return { sent: true, count: rows.length, marked, recipient };
}
