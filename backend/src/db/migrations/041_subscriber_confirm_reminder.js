/**
 * 041 — subscribers.confirm_reminder_sent_at.
 *
 * The Morning Scoop sends ONE reminder, 48 hours after sign-up, to a subscriber
 * who has not confirmed. The column is the guard that makes "once" true: it is
 * NULL until the reminder goes out and never reset, so a re-run, a second
 * process or a re-subscribe cannot send a second one.
 *
 * Additive and nullable. Idempotent: skips the ALTER when the column exists.
 */

export const id = "041_subscriber_confirm_reminder";

export function up(db) {
  const existing = new Set(db.prepare("PRAGMA table_info(subscribers)").all().map((c) => c.name));
  if (!existing.has("confirm_reminder_sent_at")) {
    db.exec("ALTER TABLE subscribers ADD COLUMN confirm_reminder_sent_at INTEGER;");
  }
}
