/**
 * longformCycle.js — the gates that decide whether a film run may start (#80).
 *
 * The cycle's expensive work (render, TTS, upload) is orchestrated elsewhere;
 * this file owns the CHEAP REFUSALS that must happen before any of it, and the
 * record-keeping that makes a crashed run safe to re-enter.
 *
 * Each gate below exists because its absence has cost this project something,
 * in the shorts loop or in the audit that produced this programme:
 *
 *   KILL SWITCH        the only thing between built and live. Literal "1".
 *   RATE (rolling)     a calendar reset lets a quiet week burst; the shorts
 *                      loop learned this the expensive way.
 *   SPACING            slack so a failure costs time rather than a film.
 *   QUOTA PREFLIGHT    a bundle is ~10,000 units. Discovering that AFTER an
 *                      hour of CPU and an ElevenLabs bill is the wrong order.
 *   CONTENTION         long-form must never starve the shorts loop, which is
 *                      the proven channel. GROUND measured render cost on an
 *                      IDLE box, so this guard is required, not optional.
 *   RE-ENTRY           insert pending → publish → update. A crash between
 *                      upload and insert would otherwise orphan a published
 *                      film, and for long-form a second copy is a subscriber
 *                      notification that cannot be recalled.
 *
 * Everything is injected, so the whole gate stack is testable without a
 * database, a queue, or a network.
 */

import { logger } from "../logger.js";

/** The master switch. Literal "1" — the same contract as VIDEO_AUTOPOST_ENABLED. */
export const isLongformAutopostEnabled = () =>
  process.env.LONGFORM_AUTOPOST_ENABLED === "1";

/**
 * ZERO MEANS ZERO, NOT UNSET.
 *
 * `parseInt("0") || 3` is 3 — so the obvious spelling of this would turn
 * "pause the channel" into "three films a week", which is the opposite of
 * what the operator asked for. docs/reference/env_reference.md records the
 * same trap on VIDEO_INSTAGRAM_MAX_PER_DAY, VIDEO_THREADS_MAX_PER_DAY and
 * VIDEO_FACEBOOK_MAX_PER_DAY; this is the fourth flag it would have caught.
 */
export const MAX_PER_WEEK = () => {
  const raw = process.env.LONGFORM_MAX_PER_WEEK;
  if (raw === undefined || String(raw).trim() === "") return 3;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(0, n) : 3;
};

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Minimum spacing between films, with slack.
 *
 * WEEK / max * 0.8 — the same 0.8 the shorts loop uses, and for the same
 * reason: it yields more slots than films, so one failure costs time rather
 * than that week's film.
 */
export const minIntervalMs = () => {
  const max = MAX_PER_WEEK();
  return max > 0 ? Math.floor((WEEK_MS / max) * 0.8) : Infinity;
};

/** A full bundle: film + 5 Shorts at 1,600 units each, plus a caption track. */
export const BUNDLE_UNITS = 6 * 1600 + 400;

/**
 * The rolling-window rate gate.
 *
 * ROLLING, NOT CALENDAR. `published_at` timestamps within the last 7×24h are
 * counted; a calendar week would let a quiet Sunday-to-Saturday burst three
 * films into one afternoon.
 *
 * @returns {null|string} null to proceed, or the reason to skip
 */
export function rateGate({ recentPublishedAt = [], now = Date.now() } = {}) {
  const max = MAX_PER_WEEK();
  if (max === 0) return "LONGFORM_MAX_PER_WEEK is 0 — the channel is paused";

  const within = recentPublishedAt.filter((t) => Number.isFinite(t) && now - t < WEEK_MS);
  if (within.length >= max) {
    return `${within.length} film(s) in the last 7 days (max ${max})`;
  }
  const newest = within.length ? Math.max(...within) : null;
  if (newest !== null) {
    const since = now - newest;
    const need = minIntervalMs();
    if (since < need) {
      return `last film was ${Math.round(since / 3600000)}h ago (need ${Math.round(need / 3600000)}h spacing)`;
    }
  }
  return null;
}

/**
 * Quota preflight — refuse BEFORE spending an hour of CPU.
 *
 * `unitsUsedToday` and `dailyCeiling` come from the caller (GROUND measured a
 * floor of >=19,200/day; the exact ceiling is a Console read). When the
 * ceiling is unknown, this gate does NOT block — an unknown ceiling is not
 * evidence of exhaustion, and blocking on it would stop the loop forever. It
 * says so in the log instead, which is the honest position.
 */
export function quotaGate({ unitsUsedToday = null, dailyCeiling = null, need = BUNDLE_UNITS } = {}) {
  if (dailyCeiling == null) {
    return { ok: true, note: `quota ceiling unknown — proceeding; a bundle needs ~${need} units` };
  }
  if (unitsUsedToday == null) {
    return { ok: false, reason: "quota usage could not be measured — unmeasured is not a pass" };
  }
  const remaining = dailyCeiling - unitsUsedToday;
  if (remaining < need) {
    return { ok: false, reason: `only ${remaining} quota units left today, a bundle needs ${need}` };
  }
  return { ok: true, note: `${remaining} units remain; bundle needs ${need}` };
}

/**
 * Contention guard: never render long-form while a shorts cycle is active.
 *
 * The 2-core host renders a bundle in ~10 min measured ON AN IDLE BOX. The
 * shorts loop is the proven channel and must not be starved by a job that can
 * always wait an hour.
 */
export function contentionGate({ shortsCycleActive = false } = {}) {
  return shortsCycleActive
    ? "a shorts cycle is running — long-form yields to the proven channel"
    : null;
}

/**
 * All the cheap refusals, in cost order. Returns null to proceed, or
 * { skipped, reason } describing why not.
 */
export function preflight({
  recentPublishedAt = [], shortsCycleActive = false,
  unitsUsedToday = null, dailyCeiling = null, now = Date.now(),
} = {}) {
  if (!isLongformAutopostEnabled()) {
    return { skipped: "disabled", reason: "LONGFORM_AUTOPOST_ENABLED != 1" };
  }
  const contention = contentionGate({ shortsCycleActive });
  if (contention) return { skipped: "contention", reason: contention };

  const rate = rateGate({ recentPublishedAt, now });
  if (rate) return { skipped: "rate", reason: rate };

  const quota = quotaGate({ unitsUsedToday, dailyCeiling });
  if (!quota.ok) return { skipped: "quota", reason: quota.reason };

  return null;
}

// ── Record keeping ──────────────────────────────────────────────────────────

/**
 * Claim an event for filming: INSERT PENDING BEFORE ANY WORK.
 *
 * The order is the point. A crash between upload and insert would otherwise
 * orphan a published film — nothing would record that the event was filmed,
 * and the next cycle would film it again. For a 60-second clip a duplicate is
 * embarrassing; for a film it is a second subscriber notification that cannot
 * be recalled.
 *
 * The UNIQUE(event_id) index makes the claim atomic: a concurrent run loses
 * the insert and skips, rather than both proceeding.
 *
 * @returns {boolean} true when this run owns the event
 */
export function claimEvent(db, { eventId, slug, title, topicPhrase, demandBreadth, now = Date.now() }) {
  try {
    db.prepare(`
      INSERT INTO longform_posts
        (event_id, slug, title, topic_phrase, demand_breadth, status, stage, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', 'claimed', ?, ?)
    `).run(eventId, slug, title ?? null, topicPhrase ?? null, demandBreadth ?? null, now, now);
    return true;
  } catch {
    // UNIQUE violation — another run owns it, or it is already filmed.
    return false;
  }
}

/**
 * Films published within the window, newest first — the rate gate's input.
 * Reads published_at, NOT created_at: a claimed-but-abandoned row must not
 * consume a slot, or a run of failures would pause the channel.
 */
export function recentPublishTimes(db, { now = Date.now(), windowMs = WEEK_MS } = {}) {
  return db.prepare(`
    SELECT published_at FROM longform_posts
    WHERE published_at IS NOT NULL AND published_at >= ?
    ORDER BY published_at DESC
  `).all(now - windowMs).map((r) => r.published_at);
}

/** Event ids already filmed or in flight — the selector's exclusion set. */
export function filmedEventIds(db) {
  return new Set(
    db.prepare(`SELECT event_id FROM longform_posts WHERE status IN ('pending','published')`)
      .all().map((r) => String(r.event_id)));
}

/**
 * The stale-pending rule, inherited from the shorts loop: ONE failure leaves
 * the topic selectable, TWO retire it. Without it a single transient failure
 * permanently burns a good story.
 */
export function recordFailure(db, { eventId, stage, error, now = Date.now(), retireAt = 2 }) {
  const row = db.prepare("SELECT attempts FROM longform_posts WHERE event_id = ?").get(eventId);
  const attempts = (row?.attempts ?? 0) + 1;
  const status = attempts >= retireAt ? "failed" : "retry";
  db.prepare(`
    UPDATE longform_posts SET attempts = ?, status = ?, stage = ?, error = ?, updated_at = ?
    WHERE event_id = ?
  `).run(attempts, status, stage ?? null, String(error ?? "").slice(0, 500), now, eventId);
  if (status === "retry") {
    // Selectable again: the row is cleared from the exclusion set by
    // filmedEventIds, which counts only 'pending' and 'published'.
    logger.warn(`🎬 ${eventId}: attempt ${attempts} failed at ${stage} — selectable again`);
  } else {
    logger.error(`🎬 ${eventId}: retired after ${attempts} attempts (last stage ${stage})`);
  }
  return { attempts, status };
}

/** Mark a film published. Called only after a verified upload. */
export function recordPublished(db, { eventId, youtubeId, privacyStatus, publishAt, shorts, qc, now = Date.now() }) {
  db.prepare(`
    UPDATE longform_posts
       SET status='published', stage='published', youtube_id=?, privacy_status=?,
           publish_at=?, shorts_json=?, qc_json=?, published_at=?, updated_at=?
     WHERE event_id = ?
  `).run(youtubeId, privacyStatus ?? null, publishAt ?? null,
         shorts ? JSON.stringify(shorts) : null, qc ? JSON.stringify(qc) : null,
         now, now, eventId);
}

/** Health surface — a cycle that has not run must be visibly not-running. */
export function getLongformHealth(db, { now = Date.now() } = {}) {
  const published = recentPublishTimes(db, { now });
  const last = db.prepare(
    "SELECT event_id, slug, status, stage, updated_at FROM longform_posts ORDER BY updated_at DESC LIMIT 1").get();
  return {
    enabled: isLongformAutopostEnabled(),
    publishedLast7d: published.length,
    maxPerWeek: MAX_PER_WEEK(),
    lastPublishedAt: published[0] ?? null,
    hoursSinceLastPublish: published[0] ? Math.round((now - published[0]) / 3600000) : null,
    lastRow: last ?? null,
  };
}
