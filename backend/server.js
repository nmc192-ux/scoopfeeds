import "./src/config/env.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { logger } from "./src/services/logger.js";
import { collectIntegrationStatus, countIntegrations } from "./src/config/integrations.js";
import { CSP_HEADER_VALUE, REPORTING_ENDPOINTS_HEADER } from "./src/config/csp.js";
import cspReportRouter from "./src/routes/csp-report.js";
import { startScheduler, getSchedulerStatus } from "./src/services/scheduler.js";
import newsRouter      from "./src/routes/news.js";
import videosRouter    from "./src/routes/videos.js";
import translateRouter from "./src/routes/translate.js";
import marketRouter    from "./src/routes/market.js";
import weatherRouter    from "./src/routes/weather.js";
import liveStreamRouter from "./src/routes/liveStream.js";
import seoRouter         from "./src/routes/seo.js";
import geoRouter         from "./src/routes/geo.js";
import readerRouter      from "./src/routes/reader.js";
import newsletterRouter  from "./src/routes/newsletter.js";
import liveEventsRouter  from "./src/routes/liveEvents.js";
import trackRouter       from "./src/routes/track.js";
import affiliateRouter   from "./src/routes/affiliate.js";
import socialRouter      from "./src/routes/social.js";
import cardsRouter       from "./src/routes/cards.js";
import pushRouter        from "./src/routes/push.js";
import authRouter        from "./src/routes/auth.js";
import tipsRouter        from "./src/routes/tips.js";
import videoGenRouter    from "./src/routes/videos-gen.js";
import newsletterOpsRouter from "./src/routes/newsletter-ops.js";
import xDigestOpsRouter   from "./src/routes/x-digest-ops.js";
import queueOpsRouter    from "./src/routes/queue-ops.js";
import diagnosticsOpsRouter from "./src/routes/diagnostics-ops.js";
import meterRouter       from "./src/routes/meter.js";
import analysisRouter    from "./src/routes/analysis.js";
import predictionsRouter from "./src/routes/predictions.js";
import eventsRouter      from "./src/routes/events.js";
import realityIndexRouter from "./src/routes/realityIndex.js";
import watchlistsRouter  from "./src/routes/watchlists.js";
import riOpsRouter       from "./src/routes/ri-ops.js";
import articlesOpsRouter from "./src/routes/articles-ops.js";
import metricsOpsRouter  from "./src/routes/metrics-ops.js";
import briefsRouter      from "./src/routes/briefs.js";
import embedRouter       from "./src/routes/embed.js";
import macroRouter       from "./src/routes/macro.js";
import syntheticMarketsRouter from "./src/routes/syntheticMarkets.js";
import v1Router            from "./src/routes/v1.js";
import { initRealityIndex } from "./src/realityIndex/schema.js";
import { detectCountry } from "./src/services/geolocation.js";
import { skimlinksPublisherId, amazonInfoForCountry } from "./src/config/affiliates.js";
import { isStripeConfigured } from "./src/routes/tips.js";
import { cacheMiddleware } from "./src/middleware/cache.js";
import { adminAuth, adminAuditLogger } from "./src/middleware/adminAuth.js";
import {
  adminRouteLimiter,
  analysisLimiter,
  apiGlobalLimiter,
  highFreqLimiter,
  mutationLimiter,
  predictionsLimiter,
  publicV1EdgeLimiter,
  readerLimiter,
  standardReadLimiter,
} from "./src/middleware/rateLimits.js";
import {
  apiRequestLoggingMiddleware,
  captureException,
  flushObservability,
  getProcessMemoryUsage,
  initObservability,
  requestIdMiddleware,
} from "./src/config/observability.js";
import { getDb, getDbStatus } from "./src/models/database.js";
import { RSS_SOURCES, YOUTUBE_SOURCES } from "./src/config/sources.js";
import { assertRedisStartup, getRedisStatus } from "./src/jobs/redis.js";
import { sendError, sendInternalError, sendNotFound } from "./src/utils/apiResponse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number.parseInt(process.env.PORT || "", 10) || 3000;
const app  = express();
const PROCESS_ROLE = "web";

initObservability({ role: PROCESS_ROLE });
assertRedisStartup({ role: PROCESS_ROLE });

function isTruthyEnv(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function shouldStartEmbeddedScheduler() {
  return isTruthyEnv(process.env.ENABLE_SCHEDULER);
}

function normalizeSiteUrl(input, fallback) {
  const raw = String(input || fallback).trim().replace(/\/+$/, "");
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    return new URL(candidate).toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

const PRIMARY_SITE_URL = normalizeSiteUrl(process.env.PRIMARY_SITE_URL, "https://scoopfeeds.com");
const PRIMARY_SITE_HOST = new URL(PRIMARY_SITE_URL).hostname.toLowerCase();
const REDIRECT_FROM_HOSTS = new Set(
  (process.env.REDIRECT_FROM_HOSTS || "scoop.urbenofficial.com,www.scoop.urbenofficial.com")
    .split(",")
    .map(host => host.trim().toLowerCase())
    .filter(Boolean)
);

function getRequestHost(req) {
  return (req.hostname || req.get("host") || "").toLowerCase().split(":")[0];
}

function shouldRedirectHost(host) {
  return Boolean(host) && REDIRECT_FROM_HOSTS.has(host) && host !== PRIMARY_SITE_HOST;
}

const isProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const configuredOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || [
    PRIMARY_SITE_URL,
    `https://www.${PRIMARY_SITE_HOST}`,
    ...REDIRECT_FROM_HOSTS,
  ].join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

function isLocalOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  if (configuredOrigins.has(origin)) return callback(null, true);
  if (!isProduction && isLocalOrigin(origin)) return callback(null, true);
  return callback(null, false);
}

app.set("trust proxy", 1);

app.use(helmet({ contentSecurityPolicy: false }));

// CSP report-only mode (Sprint 2 Issue 2.2 — Stage 1 of two-stage rollout).
// Helmet's CSP stays disabled; we set the policy here ourselves so we
// control the directive list and reporting endpoint without fighting
// helmet's defaults. Applied to non-/api/ responses only — /api/* is
// JSON, where CSP is meaningless, and the report endpoint must not
// receive CSP itself. Stage 2 will switch the header name to
// Content-Security-Policy (enforcement); the policy stays the same.
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) {
    res.setHeader("Content-Security-Policy-Report-Only", CSP_HEADER_VALUE);
    res.setHeader("Reporting-Endpoints", REPORTING_ENDPOINTS_HEADER);
  }
  next();
});

app.use(compression());
app.use(cors({
  origin: corsOrigin,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
}));
// Stripe webhook needs raw body for signature verification — must be before express.json().
app.use("/api/tips/webhook", express.raw({ type: "application/json" }));
// Ko-fi webhook sends application/x-www-form-urlencoded with a `data` JSON field.
app.use("/api/tips/kofi-webhook", express.urlencoded({ extended: false }));
app.use(express.json({ limit: "256kb" }));
app.use(requestIdMiddleware);
app.use(apiRequestLoggingMiddleware({ role: PROCESS_ROLE }));
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400 && body && typeof body === "object" && !Array.isArray(body)) {
      if (!("request_id" in body)) {
        body = { ...body, request_id: req.requestId || null };
      }
    }
    return originalJson(body);
  };
  next();
});
app.use((req, res, next) => {
  const host = getRequestHost(req);
  if (shouldRedirectHost(host)) {
    return res.redirect(301, `${PRIMARY_SITE_URL}${req.originalUrl}`);
  }
  next();
});

// ─── Phase S3 per-route rate limiters ────────────────────────────────────
// Tier-based limits calibrated to actual usage patterns (finding #56, #61).
// Mounted BEFORE the route routers so they fire first for matching paths;
// the apiGlobalLimiter safety net is mounted AFTER all routes below (it
// only matters for paths without a per-route tier mount). See
// src/middleware/rateLimits.js for tier definitions.

// HIGH-FREQUENCY tier (200/5min): polled endpoints + fire-and-forget beacons.
app.use("/api/health",       highFreqLimiter);
app.use("/api/healthz",      highFreqLimiter);
app.use("/api/track",        highFreqLimiter);
app.use("/api/auth/me",      highFreqLimiter); // useAuth polls on every component mount

// STANDARD READ tier (120/5min): page-load reads + infrequent polled endpoints.
app.use("/api/news",         standardReadLimiter);
app.use("/api/videos",       standardReadLimiter);
app.use("/api/market",       standardReadLimiter);
app.use("/api/weather",      standardReadLimiter);
app.use("/api/geo",          standardReadLimiter);
app.use("/api/public-config", standardReadLimiter);
app.use("/api/live-events",  standardReadLimiter);
app.use("/api/affiliate",    standardReadLimiter);
app.use("/api/cards",        standardReadLimiter);
app.use("/api/translate",    standardReadLimiter);
app.use("/api/macro",        standardReadLimiter);
app.use("/api/synthetic-markets", standardReadLimiter);
app.use("/api/briefs",       standardReadLimiter);
app.use("/api/live-stream",  standardReadLimiter);

// MUTATION tier (60/5min): user-action POST/PUT/DELETE. Covers both reads
// and writes on routes with mixed shapes (watchlists, meter) for simplicity.
app.use("/api/newsletter",   mutationLimiter);
app.use("/api/push",         mutationLimiter);
app.use("/api/tips",         mutationLimiter);
app.use("/api/watchlists",   mutationLimiter);
app.use("/api/meter",        mutationLimiter);
app.use("/api/csp-report",   mutationLimiter);

// Routes
app.use("/api/news",      cacheMiddleware("medium"), newsRouter);
app.use("/api/videos",   cacheMiddleware("short"),  videosRouter);
app.use("/api/translate", translateRouter);
app.use("/api/market",   marketRouter);  // live FX, stocks, metals — has its own 15-min cache
app.use("/api/weather",     weatherRouter);    // OpenWeatherMap proxy — 15-min cache per location
app.use("/api/live-stream", liveStreamRouter); // YouTube RSS → current live video IDs — 10-min cache
app.use("/api/geo",         geoRouter);        // IP → country / currency / timezone — 6h cache
app.use("/api/reader",      readerLimiter, readerRouter);     // Readability-powered article extraction — 12h cache
app.use("/api/newsletter",  newsletterRouter); // subscribe / unsubscribe / daily digest
app.use("/api/live-events", liveEventsRouter); // "Live" tab dossiers (AI-synthesized briefs + metrics)
app.use("/api/track",       trackRouter);      // frontend event beacons (page_view, share, save, dwell, etc.)
app.use("/api/csp-report",  cspReportRouter);  // CSP violation reports (Sprint 2 Issue 2.2 — Stage 1 report-only)
app.use("/api/affiliate",   affiliateRouter);  // geo-aware affiliate program picker + paywall CTA resolver
app.use("/api/cards",       cardsRouter);      // branded OG/IG/Story PNG cards — disk-cached, 1-week public cache
app.use("/api/push",        pushRouter);       // web push: VAPID public key, subscribe/unsubscribe, admin broadcast
app.use("/api/auth",        authRouter);       // magic-link auth: /request, /verify, /me, /logout, /saves
app.use("/api/tips",        tipsRouter);       // Stripe tip jar: /create-session, /webhook, /stats
app.use("/api/meter",       meterRouter);      // metered paywall: /open (gate check + record), /status
app.use("/api/analysis",   analysisLimiter, cacheMiddleware("short"), analysisRouter); // AI-powered news analysis: stories, trends, deep-dive, explained
app.use("/api/predictions", predictionsLimiter, cacheMiddleware("short"), predictionsRouter); // Reality Index: Polymarket markets bound to news clusters
app.use("/api/ri/events",  predictionsLimiter, cacheMiddleware("short"), eventsRouter);      // Reality Index Phase 2: event tracker (dossier, timeline, actors)
app.use("/api/ri",         predictionsLimiter, cacheMiddleware("short"), realityIndexRouter); // Reality Index Phase 3: /truth-gap, /anomalies
app.use("/api/watchlists", watchlistsRouter);                            // Reality Index Phase 4: per-user follow lists (auth-gated; no caching)
app.use("/api/briefs",     cacheMiddleware("short"), briefsRouter);      // Reality Index Phase 4: published analyst briefs (drafts in /scoop-ops)
app.use("/embed",          embedRouter);                                 // Phase 5: public iframe embeds for blogs/Substacks (no auth, frame-ancestors *)
app.use("/api/macro",      cacheMiddleware("medium"), macroRouter);     // Phase 5: macro indicators (FRED today; WB/IMF later)
app.use("/api/synthetic-markets", syntheticMarketsRouter);              // Phase 6 foundation: x*y=k AMM markets (no caching — trades mutate)
app.use("/api/v1",         publicV1EdgeLimiter, cacheMiddleware("medium"), v1Router);        // Phase 7: public read-only API, key-authed + per-key rate-limited

// Phase S3 safety net — generous global limit catches /api/* paths that
// don't have a per-route tier mount above. Order matters: must come AFTER
// the per-route mounts so it doesn't pre-empt them. Raised from 500/15min
// to 3000/15min to absorb shared-IP traffic patterns (NAT, household).
app.use("/api/", apiGlobalLimiter);
// Global admin auth boundary for all /scoop-ops/* routers. All sub-routers
// (riOpsRouter, push, social, newsletter, videos-gen, etc.) inherit
// adminAuth + adminAuditLogger from this single mount point.
app.use("/scoop-ops",      adminRouteLimiter, adminAuth, adminAuditLogger);
app.use("/scoop-ops",       socialRouter);     // /scoop-ops/social-queue — preview auto-generated social captions (renamed from /admin to bypass host WAF)
app.use("/scoop-ops/videos-gen", videoGenRouter); // video generation queue: /queue, /run, /approve/:id, /reject/:id
app.use("/scoop-ops/newsletter", newsletterOpsRouter); // newsletter ops: /status, /welcome/run, /welcome/test
app.use("/scoop-ops/x-digest",   xDigestOpsRouter);    // X-posting queue digest ops (Sprint 2.x.2): /status, /preview, /send-now
app.use("/scoop-ops/queues", queueOpsRouter); // BullMQ / Redis queue diagnostics
app.use("/scoop-ops/diagnostics", diagnosticsOpsRouter); // prod-safe DB/Redis/process diagnostics
app.use("/scoop-ops/ri-ops",     riOpsRouter);          // Reality Index live provider/queue diag: /provider
app.use("/scoop-ops/articles",   articlesOpsRouter);    // per-article remediation: /:id/set-published-at
app.use("/scoop-ops/metrics-ops", metricsOpsRouter);    // Phase A baseline metrics dashboard (Sprint 3.4) — distinct from SPA route at /scoop-ops/metrics

// Health
app.get("/api/health", (req, res) => {
  const scheduler = getSchedulerStatus();
  const db = getDb();
  const dbStatus = getDbStatus();
  const embeddedSchedulerEnabled = shouldStartEmbeddedScheduler();
  res.json({
    status: "ok",
    processRole: PROCESS_ROLE,
    schedulerEnabled: embeddedSchedulerEnabled,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    db: dbStatus,
    articles: db.prepare("SELECT COUNT(*) as n FROM articles").get().n,
    videos:   db.prepare("SELECT COUNT(*) as n FROM videos").get().n,
    scheduler,
    memory: {
      used:  Math.floor(process.memoryUsage().heapUsed  / 1024 / 1024) + "MB",
      total: Math.floor(process.memoryUsage().heapTotal / 1024 / 1024) + "MB",
    },
  });
});

app.get("/api/healthz", (_req, res) => {
  res.json({
    ok: true,
    status: "alive",
    processRole: PROCESS_ROLE,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/readyz", async (_req, res) => {
  const db = getDbStatus();
  const redis = await getRedisStatus({ connectionName: "readyz" });
  const ready = db.ok && (!redis.enabled || redis.ok);

  res.status(ready ? 200 : 503).json({
    ok: ready,
    status: ready ? "ready" : "degraded",
    processRole: PROCESS_ROLE,
    db: { ok: db.ok, type: "sqlite" },
    redis,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/public-config", (req, res) => {
  const clientId = process.env.ADSENSE_CLIENT_ID?.trim() || process.env.VITE_ADSENSE_CLIENT_ID?.trim() || "";
  const publisherId = process.env.ADSENSE_PUBLISHER_ID?.trim()
    || (clientId.startsWith("ca-pub-") ? clientId.replace(/^ca-/, "") : "");
  const testMode = String(process.env.ADSENSE_TEST_MODE || process.env.VITE_ADSENSE_TEST_MODE || "").toLowerCase() === "true";

  const country = detectCountry(req);
  const skim = skimlinksPublisherId();
  const amazon = amazonInfoForCountry(country);

  res.json({
    country,
    affiliate: {
      skimlinksId: skim || "",
      amazon: amazon || null,
    },
    adsense: {
      enabled: Boolean(clientId),
      clientId,
      publisherId,
      testMode,
      slots: {
        banner: process.env.ADSENSE_SLOT_BANNER?.trim() || process.env.VITE_ADSENSE_SLOT_BANNER?.trim() || "",
        sidebar: process.env.ADSENSE_SLOT_SIDEBAR?.trim() || process.env.VITE_ADSENSE_SLOT_SIDEBAR?.trim() || "",
        inline: process.env.ADSENSE_SLOT_INLINE?.trim() || process.env.VITE_ADSENSE_SLOT_INLINE?.trim() || "",
      },
    },
    stripe: {
      configured: isStripeConfigured(),
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY?.trim() || "",
      premiumPriceUsd: 5,
    },
    // Ko-fi tip jar — set KO_FI_URL=https://ko-fi.com/<handle> in env to enable.
    // Falls back to the known handle so the button always shows after first deploy.
    // membershipUrl: optional — set KO_FI_MEMBERSHIP_URL when you want to surface
    // a "Go Premium" CTA pointing at a Ko-fi monthly membership tier. Until
    // it's set the AuthModal hides the upgrade button entirely (Stripe is
    // intentionally not used: account activation requires US tax info).
    kofi: {
      url:           (process.env.KO_FI_URL || "https://ko-fi.com/scoopfeeds").trim(),
      membershipUrl: (process.env.KO_FI_MEMBERSHIP_URL || "").trim() || null,
    },
    meter: {
      // Meter is OFF by default — set METER_ENABLED=true to re-enable.
      enabled: String(process.env.METER_ENABLED ?? "false").toLowerCase() === "true",
      freeLimit: parseInt(process.env.METER_FREE_LIMIT || "10", 10),
    },
    // ─── Native in-feed sponsor slot (Phase 4) ─────────────────────────
    // When SITE_SPONSOR_NAME is set, the frontend renders a "Presented by"
    // card in the news grid (position 3). Empty values = slot hidden,
    // so unsold inventory doesn't render an awkward placeholder.
    sponsor: {
      enabled: Boolean(process.env.SITE_SPONSOR_NAME?.trim()),
      name:    process.env.SITE_SPONSOR_NAME?.trim()    || "",
      tagline: process.env.SITE_SPONSOR_TAGLINE?.trim() || "",
      url:     process.env.SITE_SPONSOR_URL?.trim()     || "",
      cta:     process.env.SITE_SPONSOR_CTA?.trim()     || "Learn more",
      imageUrl: process.env.SITE_SPONSOR_IMAGE?.trim()  || "",
    },
  });
});

// SSE live stream
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  send("connected", { message: "📡 Connected to NewsFlow stream" });
  const hb = setInterval(() => send("heartbeat", { time: new Date().toISOString(), scheduler: getSchedulerStatus() }), 30000);
  req.on("close", () => clearInterval(hb));
});

// AdSense requires an ads.txt file on the site root.
app.get("/ads.txt", (req, res, next) => {
  const clientId = process.env.ADSENSE_CLIENT_ID?.trim() || process.env.VITE_ADSENSE_CLIENT_ID?.trim() || "";
  const publisherId = process.env.ADSENSE_PUBLISHER_ID?.trim()
    || (clientId.startsWith("ca-pub-") ? clientId.replace(/^ca-/, "") : "");

  if (!publisherId) {
    return next(); // fall through to static file (frontend/dist/ads.txt)
  }

  res.type("text/plain").send(`google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`);
});

// ── SEO routes (sitemaps, robots.txt, article detail SSR) ───────────────
// Must be mounted BEFORE the SPA catch-all so crawlers get XML/HTML, not index.html.
app.use("/", seoRouter);

// ── Serve frontend (production) ──────────────────────────────────────────
// Cache-Control strategy (Phase B Track 3 Sprint 0):
//   • /assets/* (Vite-emitted, content-hashed) → cache forever + immutable.
//     A content change produces a new filename, so it's always safe.
//   • sw.js (service worker)                   → no-cache (canonical for SW
//     update lifecycle; functionally equivalent to max-age=0 but is what
//     browser SW update logic expects to see).
//   • everything else under dist/ root (index.html, manifest.json, robots.txt,
//     ads.txt, the un-fingerprinted images) → express.static's default
//     (public, max-age=0), forcing revalidation. CRITICAL: index.html MUST
//     NEVER get immutable — that would freeze returning users on a stale app
//     because the HTML referencing newly-deployed asset hashes never updates.
//     The /assets/ predicate is the safety boundary; Vite never puts
//     non-hashed files there.
const distDir = path.join(__dirname, "../frontend/dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir, {
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        return;
      }
      if (path.basename(filePath) === "sw.js") {
        res.setHeader("Cache-Control", "no-cache");
        return;
      }
      // index.html when served directly (e.g., GET / via static's index
      // behavior, or GET /index.html). The SPA catch-all below covers the
      // virtual-route case (/article/..., /category/..., etc.) where this
      // setHeaders callback never fires because the file isn't on disk at
      // that path. Both surfaces need must-revalidate to prevent stale-HTML
      // freeze for returning users.
      if (path.basename(filePath) === "index.html") {
        res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
        return;
      }
      // Else: fall through to express.static default (max-age=0).
    },
  }));
  // SPA catch-all — serve index.html for any non-/api route. Explicit
  // must-revalidate so LiteSpeed / CDNs / browsers never freeze on a stale
  // entry HTML for SPA routes (/article/..., /category/..., etc.).
  app.get(/^(?!\/api)/, (req, res) => {
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    res.sendFile(path.join(distDir, "index.html"));
  });
}
// API 404
app.use((req, res) => sendNotFound(res, req, `Route ${req.path} not found 🤷`));
app.use((err, req, res, next) => {
  captureException(err, {
    role: PROCESS_ROLE,
    requestId: req.requestId || null,
    message: "Unhandled Express error",
    tags: {
      method: req.method,
      path: req.originalUrl || req.path,
      status_code: 500,
    },
  });
  if (err?.type === "entity.too.large") {
    return sendError(res, req, {
      status: 413,
      error: "Request body too large",
      code: "payload_too_large",
    });
  }
  return sendInternalError(res, req, "Internal server error", err);
});

const server = app.listen(PORT, () => {
  logger.info(`🚀 NewsFlow API (${PROCESS_ROLE}) → http://localhost:${PORT}`);
  logger.info(`📰 RSS sources: ${RSS_SOURCES.length}  |  📺 YouTube channels: ${YOUTUBE_SOURCES.length}`);
  logger.info(`⏰ Refresh: news every 30 min, videos every 60 min`);

  // Integration summary — one scannable count line + one structured emit.
  // Operators can see at a glance whether this deploy picked up env vars.
  try {
    const integrations = collectIntegrationStatus({ schedulerEnabled: shouldStartEmbeddedScheduler() });
    const counts = countIntegrations(integrations);
    logger.info(`🔌 integrations summary: ${counts.configured}/${counts.total} configured`);
    logger.info("🔌 integrations", integrations);
    // Stdout fallback so Hostinger's lsnode panel sees this (lsnode captures
    // console.* but not winston.transports.Console's process.stdout.write).
    console.log(`[server.js] integrations: ${counts.configured}/${counts.total} configured ${JSON.stringify(integrations)}`);
  } catch (err) {
    logger.warn(`Integration summary log failed: ${err.message}`);
    console.error(`[server.js] integration summary log failed:`, err.message);
  }

  // Reality Index Phase 1 — schema + sqlite-vec extension. Idempotent.
  // Safe to call before scheduler starts; only initializes new tables.
  try { initRealityIndex(getDb()); }
  catch (err) { logger.warn(`Reality Index init failed: ${err.message}`); }

  logger.info("⏸️ Embedded scheduler default is OFF for web processes");
  if (shouldStartEmbeddedScheduler()) {
    logger.warn("⚠️ Embedded scheduler enabled inside web process via ENABLE_SCHEDULER");
    startScheduler();
  } else {
    logger.info("⏸️ Scheduler not started in web process (run start:scheduler for the recommended setup)");
  }
});

async function shutdown(signal) {
  logger.info(`Shutting down ${PROCESS_ROLE} process...`, {
    signal,
    memory: getProcessMemoryUsage(),
  });
  server.close(async () => {
    await flushObservability();
    process.exit(0);
  });
}

async function exitFatal(kind, error) {
  captureException(error, {
    role: PROCESS_ROLE,
    message: `${PROCESS_ROLE} ${kind}`,
  });
  await flushObservability();
  process.exit(1);
}

process.on("SIGTERM", () => { shutdown("SIGTERM"); });
process.on("SIGINT",  () => { shutdown("SIGINT"); });
process.on("uncaughtException", (error) => { exitFatal("uncaughtException", error); });
process.on("unhandledRejection", (error) => {
  const rejectionError = error instanceof Error ? error : new Error(String(error));
  exitFatal("unhandledRejection", rejectionError);
});
