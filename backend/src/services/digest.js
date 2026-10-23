/**
 * The Morning Scoop — daily newsletter digest.
 *
 * Two editions, each fired by its own cron in the reader's own morning (the
 * crons carry a `timezone`, so daylight saving is node-cron's problem, not ours):
 *   - "americas": 06:30 America/New_York, subscribers whose country_code is in
 *     the Americas.
 *   - "rest":     07:00 Europe/London, everyone else, including unknown.
 * Each picks the top articles from the last 24h and sends a per-subscriber
 * email, optionally filtered by that subscriber's preferred topics.
 *
 * One email per subscriber per day: `last_sent_at` is the guard, so a re-run, a
 * manual trigger or a subscriber whose country changed between the crons cannot
 * get a second copy.
 *
 * The Reality Index block is market-odds data, so it follows SITE_MARKET_ODDS
 * exactly like the site does: off (the default) means it is not built at all.
 *
 * No-ops gracefully if SMTP is not configured (mailer returns null) or if
 * there are no verified, non-unsubscribed subscribers.
 */
import { getDb } from "../models/database.js";
import { getTransport, sendMail } from "./mailer.js";
import { logger } from "./logger.js";
import { buildRealityIndexBlock } from "../realityIndex/generation/newsletterEnricher.js";

const SITE_URL = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");
const PER_DIGEST = 8;
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
// Longer than any gap between the two editions, shorter than a day minus the
// worst daylight-saving drift of a cron that fires at the same local time.
const ONE_PER_DAY_MS = 20 * 60 * 60 * 1000;
const SUBJECT_PREFIX = "The Morning Scoop —";

export const EDITIONS = ["americas", "rest"];

// ISO 3166-1 alpha-2: North, Central and South America and the Caribbean.
const AMERICAS = new Set([
  "AG", "AI", "AR", "AW", "BB", "BL", "BM", "BO", "BQ", "BR", "BS", "BZ", "CA", "CL", "CO", "CR",
  "CU", "CW", "DM", "DO", "EC", "FK", "GD", "GF", "GL", "GP", "GT", "GY", "HN", "HT", "JM", "KN",
  "KY", "LC", "MF", "MQ", "MS", "MX", "NI", "PA", "PE", "PM", "PR", "PY", "SR", "SV", "SX", "TC",
  "TT", "US", "UY", "VC", "VE", "VG", "VI",
]);

/** Which edition a subscriber belongs to. Unknown or unparseable → "rest". */
export function editionForCountry(countryCode) {
  return AMERICAS.has(String(countryCode || "").trim().toUpperCase()) ? "americas" : "rest";
}

/** Same switch the site reads at /api/site-config. */
export function marketOddsEnabled() {
  return process.env.SITE_MARKET_ODDS === "true";
}

// ── Sponsor slot ─────────────────────────────────────────────────────────────
// To activate: set these env vars in your Hostinger panel. Leave blank to hide.
//   NEWSLETTER_SPONSOR_NAME    — brand name, e.g. "Acme Corp"
//   NEWSLETTER_SPONSOR_TAGLINE — one-line description, e.g. "The best widget maker"
//   NEWSLETTER_SPONSOR_URL     — UTM-tagged click-through URL
//   NEWSLETTER_SPONSOR_CTA     — button label, e.g. "Learn more →" (defaults to "Learn more →")
function getSponsorBlock() {
  const name     = (process.env.NEWSLETTER_SPONSOR_NAME    || "").trim();
  const tagline  = (process.env.NEWSLETTER_SPONSOR_TAGLINE || "").trim();
  const url      = (process.env.NEWSLETTER_SPONSOR_URL     || "").trim();
  const cta      = (process.env.NEWSLETTER_SPONSOR_CTA     || "Learn more →").trim();
  if (!name || !url) return { html: "", text: "" };
  return {
    html: `
      <div style="margin:18px 0 22px;padding:14px 18px;background:#fffbeb;border-radius:10px;border:1px solid #fde68a">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#92400e;margin-bottom:6px;font-weight:700">
          Presented by
        </div>
        <div style="font-weight:700;font-size:15px;color:#111;margin-bottom:4px">${escapeHtml(name)}</div>
        ${tagline ? `<div style="font-size:13px;color:#555;margin-bottom:10px;line-height:1.5">${escapeHtml(tagline)}</div>` : ""}
        <a href="${escapeHtml(url)}" style="display:inline-block;background:#d97706;color:#fff;padding:8px 18px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">${escapeHtml(cta)}</a>
      </div>
    `,
    text: `\n─ Presented by ${name}${tagline ? " — " + tagline : ""}\n${url}\n`,
  };
}

function pickTopArticles(categories, db = getDb()) {
  const since = Date.now() - LOOKBACK_MS;
  if (categories && categories.length) {
    const ph = categories.map(() => "?").join(",");
    return db.prepare(`
      SELECT id, title, description, url, image_url, source_name, category, published_at
      FROM articles
      WHERE published_at >= ? AND category IN (${ph})
      ORDER BY credibility DESC, published_at DESC
      LIMIT ?
    `).all(since, ...categories, PER_DIGEST);
  }
  return db.prepare(`
    SELECT id, title, description, url, image_url, source_name, category, published_at
    FROM articles
    WHERE published_at >= ?
    ORDER BY credibility DESC, published_at DESC
    LIMIT ?
  `).all(since, PER_DIGEST);
}

function renderDigestHtml(articles, unsubUrl, { referralUrl = null, referralCount = 0, sponsor = null, realityIndex = null } = {}) {
  const items = articles.map((a) => `
    <tr><td style="padding:12px 0;border-bottom:1px solid #eee">
      <a href="${a.url}" style="color:#111;text-decoration:none">
        <div style="font-weight:700;font-size:15px;line-height:1.35;margin-bottom:4px">${escapeHtml(a.title)}</div>
      </a>
      <div style="font-size:12px;color:#666">${escapeHtml(a.source_name || "")} · ${escapeHtml(a.category || "")}</div>
      ${a.description ? `<div style="font-size:13px;color:#333;margin-top:6px;line-height:1.5">${escapeHtml(trim(a.description, 220))}</div>` : ""}
    </td></tr>
  `).join("");

  const referralBlock = referralUrl ? `
    <div style="margin-top:24px;padding:16px;background:#f0f7ff;border-radius:10px;border:1px solid #cce0ff">
      <div style="font-weight:700;font-size:14px;margin-bottom:6px">📬 Invite friends to Scoop</div>
      ${referralCount > 0
        ? `<div style="font-size:13px;color:#444;margin-bottom:8px">You've referred <strong>${referralCount}</strong> reader${referralCount === 1 ? "" : "s"} so far — thank you!</div>`
        : `<div style="font-size:13px;color:#444;margin-bottom:8px">Know someone who'd love Scoop? Share your personal invite link.</div>`}
      <div style="font-size:12px;background:#fff;border:1px solid #cce0ff;border-radius:6px;padding:8px 10px;word-break:break-all;color:#007AFF">
        <a href="${referralUrl}" style="color:#007AFF;text-decoration:none">${referralUrl}</a>
      </div>
    </div>
  ` : "";

  const sponsorHtml = sponsor?.html || "";
  const riHtml      = realityIndex?.html || "";

  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:auto;padding:24px;color:#111">
      <div style="font-size:22px;font-weight:800;margin-bottom:4px">The Morning Scoop</div>
      <div style="font-size:12px;color:#666;margin-bottom:18px">Top stories from the last 24 hours</div>
      ${sponsorHtml}
      ${riHtml}
      <table width="100%" cellpadding="0" cellspacing="0">${items}</table>
      ${referralBlock}
      <div style="margin-top:28px;font-size:12px;color:#888">
        <a href="${SITE_URL}" style="color:#007AFF">Open Scoop</a> ·
        <a href="${unsubUrl}" style="color:#888">Unsubscribe</a>
      </div>
    </div>
  `;
}

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function trim(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

// getReferralCount() reads the process-wide connection; the digest takes `db`.
function referralCountFor(db, token) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM subscribers
    WHERE referred_by_token = ? AND verified_at IS NOT NULL AND unsubscribed_at IS NULL
  `).get(token).n;
}

function digestSubject(articles) {
  return `${SUBJECT_PREFIX} ${articles[0].title.slice(0, 60)}`;
}

function digestText(articles, { sponsor, realityIndex, referralUrl }) {
  return (sponsor?.text || "") + (realityIndex?.text || "") +
    articles.map((a) => `• ${a.title}\n  ${a.url}`).join("\n\n") +
    (referralUrl ? `\n\n──\nInvite friends: ${referralUrl}` : "");
}

function buildBlocks() {
  return {
    sponsor: getSponsorBlock(),
    realityIndex: marketOddsEnabled() ? buildRealityIndexBlock() : { html: "", text: "" },
  };
}

/**
 * The email as it would render for a subscriber with no topic filter. The
 * unsubscribe link is a placeholder — nothing here reads or writes a subscriber
 * row. Returns null when there is nothing to send.
 */
export function buildDigestPreview({ db = getDb() } = {}) {
  const articles = pickTopArticles(null, db);
  if (!articles.length) return null;
  const blocks = buildBlocks();
  const unsubUrl = `${SITE_URL}/api/newsletter/unsubscribe?token=preview`;
  return {
    subject: digestSubject(articles),
    html: renderDigestHtml(articles, unsubUrl, blocks),
    text: digestText(articles, blocks),
  };
}

export async function sendDailyDigest({ edition = null, db = getDb(), now = Date.now() } = {}) {
  if (edition !== null && !EDITIONS.includes(edition)) {
    throw new Error(`digest: unknown edition "${edition}"`);
  }
  if (!getTransport()) {
    logger.info("digest: skipped (no SMTP configured)");
    return { sent: 0, skipped: true };
  }
  // Already sent today (either edition, or an earlier run of this one) → skip.
  const due = db.prepare(`
    SELECT id, email, topics, token, country_code
    FROM subscribers
    WHERE verified_at IS NOT NULL AND unsubscribed_at IS NULL
      AND (last_sent_at IS NULL OR last_sent_at < ?)
  `).all(now - ONE_PER_DAY_MS);
  const subs = edition ? due.filter((s) => editionForCountry(s.country_code) === edition) : due;

  if (!subs.length) {
    logger.info(`digest: no verified subscribers due${edition ? ` for the ${edition} edition` : ""}`);
    return { sent: 0, edition };
  }

  // Sponsor + Reality Index blocks are the same for every subscriber in this send.
  const { sponsor, realityIndex } = buildBlocks();

  let sent = 0;
  for (const sub of subs) {
    let topics = [];
    try { topics = JSON.parse(sub.topics || "[]"); } catch { /* ignore */ }
    const articles = pickTopArticles(topics.length ? topics : null, db);
    if (!articles.length) continue;

    const unsubUrl = `${SITE_URL}/api/newsletter/unsubscribe?token=${sub.token}`;
    const referralUrl = `${SITE_URL}/?ref=${sub.token}`;
    const referralCount = referralCountFor(db, sub.token);
    try {
      await sendMail({
        to: sub.email,
        subject: digestSubject(articles),
        html: renderDigestHtml(articles, unsubUrl, { referralUrl, referralCount, sponsor, realityIndex }),
        text: digestText(articles, { sponsor, realityIndex, referralUrl }),
      });
      db.prepare(`UPDATE subscribers SET last_sent_at = ? WHERE id = ?`).run(Date.now(), sub.id);
      sent++;
    } catch (err) {
      logger.warn(`digest: send failed for ${sub.email}: ${err.message}`);
    }
  }
  logger.info(`📬 Morning Scoop${edition ? ` (${edition})` : ""} sent: ${sent}/${subs.length}`);
  return { sent, total: subs.length, edition };
}
