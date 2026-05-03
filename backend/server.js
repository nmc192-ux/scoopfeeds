import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import { logger } from "./src/services/logger.js";
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
import meterRouter       from "./src/routes/meter.js";
import analysisRouter    from "./src/routes/analysis.js";
import predictionsRouter from "./src/routes/predictions.js";
import eventsRouter      from "./src/routes/events.js";
import realityIndexRouter from "./src/routes/realityIndex.js";
import { initRealityIndex } from "./src/realityIndex/schema.js";
import { detectCountry } from "./src/services/geolocation.js";
import { skimlinksPublisherId, amazonInfoForCountry } from "./src/config/affiliates.js";
import { isStripeConfigured } from "./src/routes/tips.js";
import { cacheMiddleware } from "./src/middleware/cache.js";
import { getDb } from "./src/models/database.js";
import { RSS_SOURCES, YOUTUBE_SOURCES } from "./src/config/sources.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load backend/.env into process.env (won't override vars already set) ──
{
  const envFile = path.join(__dirname, ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 1) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !(key in process.env)) process.env[key] = val;
    }
  }
}

const PORT = Number.parseInt(process.env.PORT || "", 10) || 3000;
const app  = express();
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

app.set("trust proxy", 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || [
    PRIMARY_SITE_URL,
    `https://www.${PRIMARY_SITE_HOST}`,
    ...REDIRECT_FROM_HOSTS,
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
  ].join(","))
    .split(",").map(o => o.trim()),
  methods: ["GET","POST"],
  allowedHeaders: ["Content-Type"],
}));
// Stripe webhook needs raw body for signature verification — must be before express.json().
app.use("/api/tips/webhook", express.raw({ type: "application/json" }));
// Ko-fi webhook sends application/x-www-form-urlencoded with a `data` JSON field.
app.use("/api/tips/kofi-webhook", express.urlencoded({ extended: false }));
app.use(express.json({ limit: "1mb" }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 500,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, error: "Too many requests 🐢" },
});
app.use("/api/", limiter);

app.use((req, res, next) => {
  const host = getRequestHost(req);
  if (shouldRedirectHost(host)) {
    return res.redirect(301, `${PRIMARY_SITE_URL}${req.originalUrl}`);
  }

  const t = Date.now();
  res.on("finish", () => {
    if (!req.path.includes("health") && !req.path.includes("events"))
      logger.info(`${req.method} ${req.path} ${res.statusCode} ${Date.now()-t}ms`);
  });
  next();
});

// Routes
app.use("/api/news",      cacheMiddleware("medium"), newsRouter);
app.use("/api/videos",   cacheMiddleware("short"),  videosRouter);
app.use("/api/translate", translateRouter);
app.use("/api/market",   marketRouter);  // live FX, stocks, metals — has its own 15-min cache
app.use("/api/weather",     weatherRouter);    // OpenWeatherMap proxy — 15-min cache per location
app.use("/api/live-stream", liveStreamRouter); // YouTube RSS → current live video IDs — 10-min cache
app.use("/api/geo",         geoRouter);        // IP → country / currency / timezone — 6h cache
app.use("/api/reader",      readerRouter);     // Readability-powered article extraction — 12h cache
app.use("/api/newsletter",  newsletterRouter); // subscribe / unsubscribe / daily digest
app.use("/api/live-events", liveEventsRouter); // "Live" tab dossiers (AI-synthesized briefs + metrics)
app.use("/api/track",       trackRouter);      // frontend event beacons (page_view, share, save, dwell, etc.)
app.use("/api/affiliate",   affiliateRouter);  // geo-aware affiliate program picker + paywall CTA resolver
app.use("/api/cards",       cardsRouter);      // branded OG/IG/Story PNG cards — disk-cached, 1-week public cache
app.use("/api/push",        pushRouter);       // web push: VAPID public key, subscribe/unsubscribe, admin broadcast
app.use("/api/auth",        authRouter);       // magic-link auth: /request, /verify, /me, /logout, /saves
app.use("/api/tips",        tipsRouter);       // Stripe tip jar: /create-session, /webhook, /stats
app.use("/api/meter",       meterRouter);      // metered paywall: /open (gate check + record), /status
app.use("/api/analysis",   cacheMiddleware("short"), analysisRouter); // AI-powered news analysis: stories, trends, deep-dive, explained
app.use("/api/predictions", cacheMiddleware("short"), predictionsRouter); // Reality Index: Polymarket markets bound to news clusters
app.use("/api/ri/events",  cacheMiddleware("short"), eventsRouter);      // Reality Index Phase 2: event tracker (dossier, timeline, actors)
app.use("/api/ri",         cacheMiddleware("short"), realityIndexRouter); // Reality Index Phase 3: /truth-gap, /anomalies
app.use("/scoop-ops",       socialRouter);     // /scoop-ops/social-queue — preview auto-generated social captions (renamed from /admin to bypass host WAF)
app.use("/scoop-ops/videos-gen", videoGenRouter); // video generation queue: /queue, /run, /approve/:id, /reject/:id
app.use("/scoop-ops/newsletter", newsletterOpsRouter); // newsletter ops: /status, /welcome/run, /welcome/test

// Health
app.get("/api/health", (req, res) => {
  const scheduler = getSchedulerStatus();
  const db = getDb();
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    articles: db.prepare("SELECT COUNT(*) as n FROM articles").get().n,
    videos:   db.prepare("SELECT COUNT(*) as n FROM videos").get().n,
    scheduler,
    memory: {
      used:  Math.floor(process.memoryUsage().heapUsed  / 1024 / 1024) + "MB",
      total: Math.floor(process.memoryUsage().heapTotal / 1024 / 1024) + "MB",
    },
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
const distDir = path.join(__dirname, "../frontend/dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA catch-all — serve index.html for any non-/api route
  app.get(/^(?!\/api)/, (req, res) => res.sendFile(path.join(distDir, "index.html")));
}
// API 404
app.use((req, res) => res.status(404).json({ success: false, error: `Route ${req.path} not found 🤷` }));
app.use((err, req, res, next) => {
  logger.error("Unhandled error", { error: err.message });
  res.status(500).json({ success: false, error: "Internal server error" });
});

app.listen(PORT, () => {
  logger.info(`🚀 NewsFlow API → http://localhost:${PORT}`);
  logger.info(`📰 RSS sources: ${RSS_SOURCES.length}  |  📺 YouTube channels: ${YOUTUBE_SOURCES.length}`);
  logger.info(`⏰ Refresh: news every 30 min, videos every 60 min`);

  // Reality Index Phase 1 — schema + sqlite-vec extension. Idempotent.
  // Safe to call before scheduler starts; only initializes new tables.
  try { initRealityIndex(getDb()); }
  catch (err) { logger.warn(`Reality Index init failed: ${err.message}`); }

  if (String(process.env.ENABLE_SCHEDULER ?? "true").toLowerCase() !== "false") {
    startScheduler();
  } else {
    logger.info("⏸️ Scheduler disabled via ENABLE_SCHEDULER=false");
  }
});

process.on("SIGTERM", () => { logger.info("Shutting down..."); process.exit(0); });
process.on("SIGINT",  () => { logger.info("Shutting down..."); process.exit(0); });
