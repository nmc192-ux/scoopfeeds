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
import { marketOddsEnabled } from "../config/marketOdds.js";
import { topEventsByProminence } from "../realityIndex/dal/eventsDao.js";

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

/** Same switch the site reads at /api/site-config (one definition: config/marketOdds.js, #205). */
export { marketOddsEnabled };

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
export function buildDigestPreview({ db = getDb(), v2 = null, edition = "rest", topics = [], now = Date.now() } = {}) {
  // #263: ?v2=1 on the ops preview shows the v2 edition whatever the flag says, so DrJ
  // can eyeball both before the flip. v2 === null follows MORNING_SCOOP_V2.
  if (v2 ?? morningScoopV2Enabled()) {
    const top = pickTopEvents(db, now);
    if (top) {
      const blocks = buildBlocks();
      const unsubUrl = `${SITE_URL}/api/newsletter/unsubscribe?token=preview`;
      const mine = pickTopicEvents(db, topics, top, now);
      const camp = EDITIONS.includes(edition) ? edition : "rest";
      return {
        subject: digestSubject(top),
        html: renderDigestHtmlV2({ top, mine, campaign: camp, unsubUrl, ...blocks }),
        text: digestTextV2({ top, mine, campaign: camp, unsubUrl, ...blocks }),
        v2: true,
      };
    }
  }
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

  // #263 v2: the day's top events are the same for every subscriber in this send.
  // Fewer than V2_MIN_EVENTS eligible events → today's article list, logged.
  let top = null;
  if (morningScoopV2Enabled()) {
    top = pickTopEvents(db, now);
    if (!top) logger.info("digest: v2 fallback to the article list (fewer than 3 eligible events)");
  }

  let sent = 0;
  for (const sub of subs) {
    let topics = [];
    try { topics = JSON.parse(sub.topics || "[]"); } catch { /* ignore */ }
    if (!Array.isArray(topics)) topics = [];

    const unsubUrl = `${SITE_URL}/api/newsletter/unsubscribe?token=${sub.token}`;
    const referralUrl = `${SITE_URL}/?ref=${sub.token}`;
    let mail;
    if (top) {
      const mine = pickTopicEvents(db, topics, top, now);
      const campaign = edition || editionForCountry(sub.country_code);
      const referralCount = referralCountFor(db, sub.token);
      const parts = { top, mine, campaign, unsubUrl, referralUrl, referralCount, sponsor, realityIndex };
      mail = { subject: digestSubject(top), html: renderDigestHtmlV2(parts), text: digestTextV2(parts) };
    } else {
      const articles = pickTopArticles(topics.length ? topics : null, db);
      if (!articles.length) continue;
      const referralCount = referralCountFor(db, sub.token);
      mail = {
        subject: digestSubject(articles),
        html: renderDigestHtml(articles, unsubUrl, { referralUrl, referralCount, sponsor, realityIndex }),
        text: digestText(articles, { sponsor, realityIndex, referralUrl }),
      };
    }
    try {
      await sendMail({ to: sub.email, ...mail });
      db.prepare(`UPDATE subscribers SET last_sent_at = ? WHERE id = ?`).run(Date.now(), sub.id);
      sent++;
    } catch (err) {
      logger.warn(`digest: send failed for ${sub.email}: ${err.message}`);
    }
  }
  logger.info(`📬 Morning Scoop${edition ? ` (${edition})` : ""} sent: ${sent}/${subs.length}`);
  return { sent, total: subs.length, edition };
}

// ── Morning Scoop v2 (#263) ──────────────────────────────────────────────────
// An edition built from the day's dossiers instead of a list of articles:
//   Top stories  — the 6 most prominent reader-eligible events active in the last
//                  24 h (one prominence definition: eventsDao.topEventsByProminence);
//   Your topics  — only for subscribers who picked topics: up to 3 more events in
//                  those categories that are not already in Top stories. Earn-render:
//                  no matches, no block, no heading.
// Everything in it is MECHANICAL: event titles, counts, the newest member headline.
// No AI-written text, so the AI-disclosure chain is untouched.
// Dark: on only when MORNING_SCOOP_V2 is literally "1" (read at call time). Off, the
// code above runs exactly as before (pinned by morningScoop.v1.golden.json).

const V2_TOP = 6;
const V2_TOPICS = 3;
const V2_MIN_EVENTS = 3;

/** Read at call time, so a flip needs no rebuild. */
export function morningScoopV2Enabled(env = process.env) {
  return String(env.MORNING_SCOOP_V2 ?? "") === "1";
}

// The Intern's sign-off. Text only. The character art arrives with the paused
// pencil-layer item: drop its <img> into INTERN_ART_HTML, the one named slot.
// Characters never sit beside a story, so the slot lives in the footer only.
export const INTERN_SIGNOFF = "That's the morning. — the Intern, ScoopFeeds";
const INTERN_ART_HTML = "";

// Shared design tokens (frontend/src/styles/tokens.css), inlined for email.
const T = {
  ink: "#090706", paper: "#F4EFE6", lime: "#DDE706", live: "#D7261E", muted: "#5b5650", rule: "#d9d2c5",
  serif: "'Newsreader', Georgia, 'Times New Roman', serif",
  sans: "'Schibsted Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif",
};

/** Per-event numbers for the email, all from the last 24 h. */
function eventDigestFacts(db, ev, now) {
  const since = now - LOOKBACK_MS;
  const c = db.prepare(`
    SELECT COUNT(DISTINCT CASE WHEN a.source_name <> '' THEN a.source_name END) AS outlets, COUNT(*) AS articles
    FROM event_articles ea JOIN articles a ON a.id = ea.article_id
    WHERE ea.event_id = ? AND a.published_at >= ?
  `).get(ev.id, since);
  const latest = db.prepare(`
    SELECT a.title, a.source_name FROM event_articles ea JOIN articles a ON a.id = ea.article_id
    WHERE ea.event_id = ? ORDER BY a.published_at DESC LIMIT 1
  `).get(ev.id);
  return {
    id: ev.id,
    slug: ev.slug,
    title: ev.title,
    outlets24: c?.outlets || 0,
    articles24: c?.articles || 0,
    latest: latest ? { title: latest.title, source: latest.source_name || "" } : null,
    // "Developing": the story itself began inside the last 24 h (mechanical, from started_at).
    developing: Number(ev.started_at) >= since,
  };
}

/** Top stories, or null when fewer than V2_MIN_EVENTS eligible events exist (caller falls back). */
function pickTopEvents(db, now) {
  const rows = topEventsByProminence(db, { limit: V2_TOP, activeWithinMs: LOOKBACK_MS, now });
  if (rows.length < V2_MIN_EVENTS) return null;
  return rows.map((ev) => eventDigestFacts(db, ev, now));
}

/** "Your topics": [] when the subscriber picked none or nothing matches. */
function pickTopicEvents(db, topics, top, now) {
  if (!topics?.length) return [];
  const rows = topEventsByProminence(db, {
    limit: V2_TOPICS, categories: topics, activeWithinMs: LOOKBACK_MS, excludeIds: top.map((e) => e.id), now,
  });
  return rows.map((ev) => eventDigestFacts(db, ev, now));
}

function eventUrl(slug, campaign) {
  return `${SITE_URL}/events/${encodeURIComponent(slug)}?utm_source=morning-scoop&utm_medium=email&utm_campaign=${encodeURIComponent(campaign)}`;
}

function countsLine(e) {
  if (!e.articles24) return "";
  return `${e.outlets24} outlet${e.outlets24 === 1 ? "" : "s"} · ${e.articles24} article${e.articles24 === 1 ? "" : "s"} in the last 24 hours`;
}

function eventRowHtml(e, campaign) {
  const counts = countsLine(e);
  return `
          <tr><td style="padding:16px 0;border-bottom:1px solid ${T.rule}">
            ${e.developing ? `<div style="font-family:${T.sans};font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${T.live};margin-bottom:4px">Developing</div>` : ""}
            <a href="${escapeHtml(eventUrl(e.slug, campaign))}" style="font-family:${T.serif};font-size:20px;line-height:1.3;font-weight:600;color:${T.ink};text-decoration:none">${escapeHtml(e.title)}</a>
            ${counts ? `<div style="font-family:${T.sans};font-size:12px;color:${T.muted};margin-top:6px">${escapeHtml(counts)}</div>` : ""}
            ${e.latest ? `<div style="font-family:${T.serif};font-size:15px;line-height:1.45;color:${T.ink};margin-top:6px"><span style="font-family:${T.sans};font-size:12px;font-weight:700">Latest:</span> ${escapeHtml(e.latest.title)}${e.latest.source ? ` <span style="font-family:${T.sans};font-size:12px;color:${T.muted}">(${escapeHtml(e.latest.source)})</span>` : ""}</div>` : ""}
          </td></tr>`;
}

function sectionHtml(heading, events, campaign) {
  return `
      <tr><td style="padding:24px 24px 0">
        <div style="font-family:${T.sans};font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${T.ink};border-bottom:3px solid ${T.lime};padding-bottom:6px">${escapeHtml(heading)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${events.map((e) => eventRowHtml(e, campaign)).join("")}
        </table>
      </td></tr>`;
}

function renderDigestHtmlV2({ top, mine = [], campaign, unsubUrl, referralUrl = null, referralCount = 0, sponsor = null, realityIndex = null }) {
  const referral = referralUrl ? `
      <tr><td style="padding:24px 24px 0;font-family:${T.sans};font-size:13px;color:${T.ink};line-height:1.5">
        <strong>Invite a friend.</strong> ${referralCount > 0 ? `You've brought ${referralCount} reader${referralCount === 1 ? "" : "s"} so far. Thank you.` : "Share your personal link:"}<br>
        <a href="${escapeHtml(referralUrl)}" style="color:${T.ink};word-break:break-all">${escapeHtml(referralUrl)}</a>
      </td></tr>` : "";
  const extras = (sponsor?.html || "") + (realityIndex?.html || "");
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.paper}">
  <tr><td align="center" style="padding:16px 8px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${T.paper};color:${T.ink}">
      <tr><td style="background:${T.ink};padding:20px 24px">
        <div style="font-family:${T.sans};font-size:26px;font-weight:800;letter-spacing:-0.5px;color:${T.paper}">The Morning Scoop</div>
        <div style="font-family:${T.sans};font-size:12px;color:${T.paper};margin-top:4px">The stories ScoopFeeds is tracking, from the last 24 hours</div>
      </td></tr>
      <tr><td style="height:4px;line-height:4px;font-size:0;background:${T.lime}">&nbsp;</td></tr>
      ${extras ? `<tr><td style="padding:16px 24px 0">${extras}</td></tr>` : ""}
      ${sectionHtml("Top stories", top, campaign)}
      ${mine.length ? sectionHtml("Your topics", mine, campaign) : ""}
      ${referral}
      <tr><td style="padding:28px 24px 24px">
        ${INTERN_ART_HTML}
        <div style="font-family:${T.serif};font-size:16px;font-style:italic;color:${T.ink}">${escapeHtml(INTERN_SIGNOFF)}</div>
        <div style="font-family:${T.sans};font-size:12px;color:${T.muted};margin-top:14px">
          <a href="${SITE_URL}" style="color:${T.ink}">Open ScoopFeeds</a> ·
          <a href="${escapeHtml(unsubUrl)}" style="color:${T.muted}">Unsubscribe</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
`;
}

function eventText(e, campaign) {
  const lines = [`${e.developing ? "[Developing] " : ""}${e.title}`];
  const counts = countsLine(e);
  if (counts) lines.push(`  ${counts}`);
  if (e.latest) lines.push(`  Latest: ${e.latest.title}${e.latest.source ? ` (${e.latest.source})` : ""}`);
  lines.push(`  ${eventUrl(e.slug, campaign)}`);
  return lines.join("\n");
}

function digestTextV2({ top, mine = [], campaign, unsubUrl, referralUrl = null, sponsor = null, realityIndex = null }) {
  const out = ["THE MORNING SCOOP", "The stories ScoopFeeds is tracking, from the last 24 hours", ""];
  const extras = (sponsor?.text || "") + (realityIndex?.text || "");
  if (extras) out.push(extras.trim(), "");
  out.push("TOP STORIES", "", top.map((e) => eventText(e, campaign)).join("\n\n"));
  if (mine.length) out.push("", "YOUR TOPICS", "", mine.map((e) => eventText(e, campaign)).join("\n\n"));
  if (referralUrl) out.push("", `Invite a friend: ${referralUrl}`);
  out.push("", "──", INTERN_SIGNOFF, `Open ScoopFeeds: ${SITE_URL}`, `Unsubscribe: ${unsubUrl}`);
  return out.join("\n");
}
