import "../config/env.js";
import IORedis from "ioredis";
import { logger } from "../services/logger.js";
import { BULLMQ_PREFIX } from "./jobOptions.js";

const warnedStates = new Set();
const connections = new Map();

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

export function getRedisUrl() {
  return String(process.env.REDIS_URL || "").trim();
}

export function isRedisConfigured() {
  return Boolean(getRedisUrl());
}

export function isRedisRequired() {
  return isTruthy(process.env.REQUIRE_REDIS);
}

export function shouldUseBullMQ() {
  return isTruthy(process.env.USE_BULLMQ);
}

export function assertRedisAvailable({ role = "process" } = {}) {
  if (isRedisConfigured()) return true;

  const message = `[${role}] REDIS_URL is not set`;
  if (isRedisRequired()) {
    throw new Error(`${message} and REQUIRE_REDIS=true`);
  }

  const warnKey = `${role}:missing-redis`;
  if (!warnedStates.has(warnKey)) {
    warnedStates.add(warnKey);
    logger.warn(`${message}; BullMQ features will stay disabled until Redis is configured`);
  }
  return false;
}

export function assertRedisStartup({ role = "process" } = {}) {
  return assertRedisAvailable({ role });
}

export async function getRedisStatus({ connectionName = "status" } = {}) {
  if (!isRedisConfigured()) {
    return {
      enabled: false,
      ok: true,
      status: "disabled",
    };
  }

  const startedAt = Date.now();

  try {
    const connection = createRedisConnection(connectionName, { maxRetriesPerRequest: 1 });
    await connection.ping();

    return {
      enabled: true,
      ok: true,
      status: "ready",
      latency_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      enabled: true,
      ok: false,
      status: "error",
      error: error.message,
    };
  }
}

export function createRedisConnection(name, { maxRetriesPerRequest = null } = {}) {
  const redisUrl = getRedisUrl();
  if (!redisUrl) return null;

  const existing = connections.get(name);
  if (existing) return existing;

  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest,
    enableReadyCheck: true,
    connectionName: `${BULLMQ_PREFIX}:${name}`,
  });

  connection.on("error", (error) => {
    logger.warn(`[redis:${name}] ${error.message}`);
  });

  connections.set(name, connection);
  return connection;
}

export async function closeRedisConnections() {
  const closing = Array.from(connections.values()).map((connection) => connection.quit().catch(() => connection.disconnect()));
  await Promise.allSettled(closing);
  connections.clear();
}
