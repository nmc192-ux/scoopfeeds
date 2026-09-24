/**
 * Mailer — lazy nodemailer transport.
 *
 * Uses SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS.
 * If not configured, getTransport() returns null and callers skip sending.
 */
import nodemailer from "nodemailer";
import { logger } from "./logger.js";

let transport = null;
let initialized = false;

export function getTransport() {
  if (initialized) return transport;
  initialized = true;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    logger.info("mailer: SMTP not configured — emails will be skipped");
    return null;
  }

  transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    pool: true,
    maxConnections: 3,
  });
  logger.info(`mailer: SMTP ready at ${host}:${port}`);
  return transport;
}

export async function sendMail({ to, subject, html, text, attachments }) {
  const t = getTransport();
  if (!t) return { skipped: true };
  const from = process.env.NEWSLETTER_FROM || "Scoop <no-reply@scoopfeeds.com>";
  // `attachments` is passed through untouched (nodemailer's shape). Inline
  // images use `cid:` — the video digest embeds each short's contact sheet.
  return t.sendMail({ from, to, subject, html, text, ...(attachments?.length ? { attachments } : {}) });
}
