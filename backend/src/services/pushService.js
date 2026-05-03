// Web-push VAPID setup + send helpers. VAPID keys are loaded from env vars
// (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) when present; otherwise we generate
// a keypair on first boot and persist to data/vapid.json so the keys survive
// restarts. Once the file exists, it's authoritative — we never regenerate
// silently because that would invalidate every subscription in the database.

import webpush from "web-push";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";
import {
  disablePushSubscription,
  listActivePushSubscriptions,
  markPushSent,
} from "../models/database.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");
// Prefer SCOOP_PERSISTENT_DATA_DIR (lives outside the deploy tree on Hostinger,
// survives git clean -fd redeploys). Without it, VAPID keys live inside
// backend/data/ and get wiped on every redeploy — invaliding all subscriptions.
const DATA_DIR = process.env.SCOOP_PERSISTENT_DATA_DIR
  ? path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR)
  : path.join(BACKEND_ROOT, "data");
const VAPID_PATH = path.join(DATA_DIR, "vapid.json");

const CONTACT = process.env.VAPID_CONTACT || "mailto:hi@scoopfeeds.com";

let publicKey = "";
let privateKey = "";
let configured = false;

function loadOrGenerateKeys() {
  // 1. Env vars win (preferred for prod where you want keys outside disk).
  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPub && envPriv) {
    return { publicKey: envPub, privateKey: envPriv, source: "env" };
  }

  // 2. On-disk keys (auto-generated previously).
  if (existsSync(VAPID_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(VAPID_PATH, "utf8"));
      if (raw.publicKey && raw.privateKey) {
        return { publicKey: raw.publicKey, privateKey: raw.privateKey, source: "disk" };
      }
    } catch (e) {
      logger.warn(`pushService: vapid.json unreadable: ${e.message}`);
    }
  }

  // 3. Generate fresh + persist. This only runs once per environment.
  const fresh = webpush.generateVAPIDKeys();
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(VAPID_PATH, JSON.stringify(fresh, null, 2), { mode: 0o600 });
  logger.info(`pushService: generated new VAPID keys → ${VAPID_PATH} (keep this file safe)`);
  return { ...fresh, source: "generated" };
}

export function ensurePushReady() {
  if (configured) return true;
  const keys = loadOrGenerateKeys();
  publicKey = keys.publicKey;
  privateKey = keys.privateKey;
  webpush.setVapidDetails(CONTACT, publicKey, privateKey);
  configured = true;
  logger.info(`pushService: ready (vapid keys from ${keys.source})`);
  return true;
}

export function getPublicKey() {
  ensurePushReady();
  return publicKey;
}

// Send a payload to a single subscription. Errors get classified: 404/410
// means the subscription is permanently dead (browser unsubbed or expired)
// → drop it. Anything else → bump failure count and retry next cycle.
async function sendToOne(sub, payload) {
  ensurePushReady();
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24 } // 24h: stale breaking news isn't worth waking the device
    );
    markPushSent(sub.endpoint, true);
    return { ok: true, endpoint: sub.endpoint };
  } catch (err) {
    const code = err.statusCode || 0;
    markPushSent(sub.endpoint, false);
    if (code === 404 || code === 410) {
      disablePushSubscription(sub.endpoint);
      return { ok: false, endpoint: sub.endpoint, reason: "expired", statusCode: code };
    }
    return { ok: false, endpoint: sub.endpoint, reason: err.message, statusCode: code };
  }
}

// Broadcast to every active subscription (filtered by topic if provided).
// Concurrency is capped so we don't hammer browser push gateways and
// trigger rate limits.
export async function broadcastPush(payload, { topic, concurrency = 10 } = {}) {
  ensurePushReady();
  const subs = listActivePushSubscriptions({ topic });
  if (!subs.length) return { sent: 0, failed: 0, expired: 0, total: 0 };

  let sent = 0, failed = 0, expired = 0;
  for (let i = 0; i < subs.length; i += concurrency) {
    const slice = subs.slice(i, i + concurrency);
    const results = await Promise.all(slice.map((s) => sendToOne(s, payload)));
    for (const r of results) {
      if (r.ok) sent += 1;
      else if (r.reason === "expired") expired += 1;
      else failed += 1;
    }
  }
  logger.info(`pushService: broadcast → sent=${sent} failed=${failed} expired=${expired} total=${subs.length}`);
  return { sent, failed, expired, total: subs.length };
}

export async function sendTestPush(endpoint, payload) {
  ensurePushReady();
  const subs = listActivePushSubscriptions();
  const sub = subs.find((s) => s.endpoint === endpoint);
  if (!sub) return { ok: false, reason: "subscription not found" };
  return sendToOne(sub, payload);
}

/**
 * Send the same payload to a specific list of subscriptions (e.g. all push
 * endpoints belonging to a single watchlisted user). Used by the watchlist
 * push dispatcher; broadcastPush handles the global feed.
 *
 * Concurrency-bounded so a user with many devices doesn't ratelimit us.
 */
export async function sendToSubscriptions(subs, payload, { concurrency = 5 } = {}) {
  ensurePushReady();
  if (!Array.isArray(subs) || subs.length === 0) return { sent: 0, failed: 0, expired: 0, total: 0 };
  let sent = 0, failed = 0, expired = 0;
  for (let i = 0; i < subs.length; i += concurrency) {
    const slice = subs.slice(i, i + concurrency);
    const results = await Promise.all(slice.map((s) => sendToOne(s, payload)));
    for (const r of results) {
      if (r.ok) sent += 1;
      else if (r.reason === "expired") expired += 1;
      else failed += 1;
    }
  }
  return { sent, failed, expired, total: subs.length };
}
