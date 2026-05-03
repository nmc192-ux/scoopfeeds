/**
 * apiKeysDao — read/write helpers for api_keys.
 * Keys are 64-char hex tokens; owner is free-text. Tier controls rate caps.
 */
import crypto from "crypto";
import { getDb } from "../../models/database.js";

const TIER_RPM = { free: 60, pro: 600, enterprise: 6000 };

export function createApiKey({ owner, tier = "free", meta = null }) {
  const key = crypto.randomBytes(32).toString("hex");
  const rpm = TIER_RPM[tier] ?? TIER_RPM.free;
  const now = Date.now();
  getDb().prepare(`
    INSERT INTO api_keys (key, owner, tier, rpm, created_at, meta)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(key, owner, tier, rpm, now, meta ? JSON.stringify(meta) : null);
  return { key, owner, tier, rpm, created_at: now };
}

export function getApiKey(key) {
  return getDb().prepare("SELECT * FROM api_keys WHERE key = ? AND revoked_at IS NULL").get(key);
}

export function touchApiKey(key) {
  getDb().prepare("UPDATE api_keys SET last_used_at = ? WHERE key = ?").run(Date.now(), key);
}

export function revokeApiKey(key) {
  return getDb().prepare("UPDATE api_keys SET revoked_at = ? WHERE key = ? AND revoked_at IS NULL")
    .run(Date.now(), key).changes;
}

export function listApiKeys() {
  return getDb().prepare(`
    SELECT key, owner, tier, rpm, created_at, last_used_at, revoked_at
    FROM api_keys ORDER BY created_at DESC
  `).all();
}
