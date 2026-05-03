import "./env.js";
import crypto from "crypto";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { insertApiSlowLog } from "../models/database.js";
import { logger } from "../services/logger.js";

const DEFAULT_SLOW_API_THRESHOLD_MS = 1000;
let sentryInitialized = false;

function parseSampleRate(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback;
  return parsed;
}

function getSentryDsn() {
  return String(process.env.SENTRY_DSN || "").trim();
}

export function getProcessRole() {
  return process.env.SCOOP_PROCESS_ROLE || "unknown";
}

export function getSlowApiThresholdMs() {
  const parsed = Number.parseInt(String(process.env.SLOW_API_THRESHOLD_MS || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SLOW_API_THRESHOLD_MS;
}

export function isSentryEnabled() {
  return Boolean(getSentryDsn());
}

export function initObservability({ role = "process" } = {}) {
  process.env.SCOOP_PROCESS_ROLE = role;

  if (!sentryInitialized && isSentryEnabled()) {
    Sentry.init({
      dsn: getSentryDsn(),
      environment: String(process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development"),
      tracesSampleRate: parseSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0),
      profilesSampleRate: parseSampleRate(process.env.SENTRY_PROFILES_SAMPLE_RATE, 0),
      integrations: [nodeProfilingIntegration()],
    });
    sentryInitialized = true;
  }

  logger.info("[observability] initialized", {
    role,
    sentryEnabled: isSentryEnabled(),
    slowApiThresholdMs: getSlowApiThresholdMs(),
  });
}

export async function flushObservability(timeoutMs = 2000) {
  if (!isSentryEnabled()) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // Ignore flush failures during shutdown.
  }
}

export function requestIdMiddleware(req, res, next) {
  const inboundRequestId = String(req.get("x-request-id") || "").trim();
  const requestId = inboundRequestId || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
}

function sanitizePath(input) {
  return String(input || "").split("?")[0] || "/";
}

export function apiRequestLoggingMiddleware({ role = getProcessRole() } = {}) {
  const slowThresholdMs = getSlowApiThresholdMs();

  return function apiRequestLogger(req, res, next) {
    const startedAt = Date.now();

    res.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      const path = sanitizePath(req.originalUrl || req.path);
      if (!path.startsWith("/api") && !path.startsWith("/scoop-ops")) return;

      const payload = {
        type: "api_request",
        role,
        method: req.method,
        path,
        status: res.statusCode,
        duration_ms: durationMs,
        request_id: req.requestId || null,
      };

      const isSlow = durationMs >= slowThresholdMs;
      const level = res.statusCode >= 500 ? "error" : isSlow ? "warn" : "info";
      logger.log(level, "API request completed", payload);

      if (isSlow) {
        try {
          insertApiSlowLog({
            method: req.method,
            path,
            status: res.statusCode,
            durationMs,
            requestId: req.requestId || "unknown",
            processRole: role,
            createdAt: Date.now(),
          });
        } catch (error) {
          logger.warn("Failed to persist slow API log", {
            request_id: req.requestId || null,
            error: error.message,
          });
        }
      }
    });

    next();
  };
}

export function captureException(error, context = {}) {
  if (!error) return;

  logger.error(context.message || "Captured exception", {
    ...context,
    error: error.message,
    stack: error.stack,
  });

  if (!isSentryEnabled()) return;

  Sentry.withScope((scope) => {
    const tags = context.tags || {};
    const extras = context.extras || {};

    Object.entries(tags).forEach(([key, value]) => {
      if (value !== undefined && value !== null) scope.setTag(key, String(value));
    });
    Object.entries(extras).forEach(([key, value]) => {
      if (value !== undefined) scope.setExtra(key, value);
    });

    if (context.requestId) scope.setTag("request_id", String(context.requestId));
    if (context.role) scope.setTag("process_role", String(context.role));
    if (context.level) scope.setLevel(context.level);

    Sentry.captureException(error);
  });
}

export function captureWorkerFailure(error, {
  queue,
  jobName,
  jobId,
  attempts,
  role = getProcessRole(),
} = {}) {
  captureException(error, {
    role,
    level: "error",
    message: "Background job failed",
    tags: {
      queue,
      job_name: jobName,
      job_id: jobId,
      process_role: role,
    },
    extras: {
      queue,
      jobName,
      jobId,
      attempts,
    },
  });
}

export function getProcessMemoryUsage() {
  const usage = process.memoryUsage();
  const toMb = (value) => Number((value / 1024 / 1024).toFixed(2));

  return {
    rss_mb: toMb(usage.rss),
    heap_used_mb: toMb(usage.heapUsed),
    heap_total_mb: toMb(usage.heapTotal),
    external_mb: toMb(usage.external),
  };
}
