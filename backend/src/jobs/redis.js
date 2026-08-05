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

/**
 * Is Redis CONFIGURED? Synchronous, and it performs NO I/O WHATSOEVER.
 *
 * READ THAT AGAIN BEFORE BLAMING IT FOR A HANG. This function opens no socket,
 * sends no PING, and never touches a connection object. It is `Boolean(REDIS_URL)`
 * plus a throw when REQUIRE_REDIS is set. It cannot block, cannot time out, is
 * unaffected by `enableOfflineQueue`, and its answer cannot change at runtime.
 *
 * The `maxRetriesPerRequest: 1` connection a few lines below belongs to
 * getRedisStatus(), a DIFFERENT function that really does ping. The two sit
 * adjacent in this file and have been conflated once already, in a live outage
 * post-mortem, costing a round of debugging aimed at the wrong layer: the
 * ingestion dispatch path calls THIS function, not that one.
 *
 * "Available" here means configured, not reachable. Reachability is
 * getRedisStatus(); if you need it in a hot path, you are asking for I/O and
 * should bound it.
 */
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

/**
 * @param {string} name
 * @param {object} [opts]
 * @param {number|null} [opts.maxRetriesPerRequest]
 * @param {boolean} [opts.enableOfflineQueue] — buffer commands while the socket
 *   is down (ioredis default true). Leave it TRUE for BullMQ *worker*
 *   connections: they hold blocking reads across reconnects and disabling it
 *   makes them throw during ordinary blips. Set it FALSE for producers, where a
 *   command buffered against a dead socket is a failure pretending to be
 *   latency — it neither resolves nor rejects, so the caller waits forever.
 */
export function createRedisConnection(name, { maxRetriesPerRequest = null, enableOfflineQueue = true } = {}) {
  const redisUrl = getRedisUrl();
  if (!redisUrl) return null;

  const existing = connections.get(name);
  if (existing) return existing;

  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest,
    enableOfflineQueue,
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
