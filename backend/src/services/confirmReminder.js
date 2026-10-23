/**
 * confirmReminder.js — one reminder to a subscriber who never confirmed.
 *
 * 48 hours after sign-up, a subscriber who is still unverified (and has not
 * unsubscribed) gets the confirmation link again. Exactly once:
 * `confirm_reminder_sent_at` is stamped after the send and never cleared.
 *
 * The upper bound (7 days) is deliberate. Without it the first run after deploy
 * would mail the whole historical backlog of long-abandoned sign-ups; a reminder
 * is only useful while the sign-up is still fresh in the reader's mind.
 *
 * Safe to run repeatedly (hourly from the scheduler). No-op without SMTP.
 */
import { getDb } from "../models/database.js";
import { getTransport, sendMail } from "./mailer.js";
import { logger } from "./logger.js";

const SITE_URL = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");
const HOUR = 60 * 60 * 1000;
export const REMINDER_AFTER_MS = 48 * HOUR;
export const REMINDER_WINDOW_MS = 7 * 24 * HOUR;

function renderReminder(token) {
  const confirmUrl = `${SITE_URL}/api/newsletter/confirm?token=${token}`;
  const unsubUrl = `${SITE_URL}/api/newsletter/unsubscribe?token=${token}`;
  return {
    subject: "One tap to start The Morning Scoop",
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:540px;margin:auto;padding:24px;color:#111">
        <h2 style="margin:0 0 12px">You're almost on the list</h2>
        <p>You signed up for The Morning Scoop but haven't confirmed your email yet, so we haven't sent you anything. Tap below and tomorrow's edition is yours:</p>
        <p><a href="${confirmUrl}" style="display:inline-block;background:#007AFF;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Confirm subscription</a></p>
        <p style="font-size:12px;color:#666;margin-top:24px">
          This is the only reminder we'll send. Didn't sign up? <a href="${unsubUrl}">Unsubscribe</a> and we'll stop immediately.
        </p>
      </div>
    `,
    text: `You signed up for The Morning Scoop but haven't confirmed yet.\nConfirm: ${confirmUrl}\n\nThis is the only reminder we'll send.\nUnsubscribe: ${unsubUrl}`,
  };
}

export async function runConfirmReminderCycle({ db = getDb(), now = Date.now(), limit = 50 } = {}) {
  if (!getTransport()) return { sent: 0, skipped: true };
  const due = db.prepare(`
    SELECT id, email, token
    FROM subscribers
    WHERE verified_at IS NULL
      AND unsubscribed_at IS NULL
      AND confirm_reminder_sent_at IS NULL
      AND created_at <= ?
      AND created_at >= ?
    ORDER BY created_at ASC
    LIMIT ?
  `).all(now - REMINDER_AFTER_MS, now - REMINDER_WINDOW_MS, limit);

  let sent = 0;
  for (const sub of due) {
    try {
      await sendMail({ to: sub.email, ...renderReminder(sub.token) });
      db.prepare(`UPDATE subscribers SET confirm_reminder_sent_at = ? WHERE id = ?`).run(Date.now(), sub.id);
      sent++;
    } catch (err) {
      logger.warn(`confirmReminder: send failed for ${sub.email}: ${err.message}`);
    }
  }
  if (sent) logger.info(`📬 Confirmation reminders sent: ${sent}/${due.length}`);
  return { sent, due: due.length };
}
