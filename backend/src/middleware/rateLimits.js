import rateLimit from "express-rate-limit";
import { sendTooManyRequests } from "../utils/apiResponse.js";

function createLimiter({ windowMs, max, keyGenerator, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    keyGenerator,
    handler: (req, res) => sendTooManyRequests(res, req),
  });
}

// ─── Phase S3: tiered per-route limiters ──────────────────────────────────
// Per finding #56 (cascade root cause) and finding #61 (S2b verification),
// the prior single 500/15min global was structurally too aggressive for
// Scoopfeeds' call-heavy frontend (~30 API calls per page load). These
// three tiers are calibrated for 3-5x typical single-user load with buffer
// for shared-IP scenarios (NAT, household). 5-minute windows give fast
// recovery after legitimate burst patterns (e.g., page-reload sequences).
//
// Mounted on specific routes in server.js BEFORE the apiGlobalLimiter
// fallback. See server.js for the route-to-tier map.

// HIGH-FREQUENCY tier — endpoints polled frequently or fire-and-forget
// beacons (e.g., /api/health at 30s poll, /api/track per-event). Typical
// single user: ~10-15 calls/5min. Limit absorbs ~10 active users sharing
// one IP without false positives.
export const highFreqLimiter = createLimiter({
  windowMs: 5 * 60 * 1000,
  max: 200,
});

// STANDARD READ tier — page-load reads + infrequent polled endpoints
// (news, market, weather, geo, etc.). Typical single user: 1-4 calls per
// route per 5min (most are cached for 10-15 min). Limit gives ~30x typical
// headroom for any single endpoint.
export const standardReadLimiter = createLimiter({
  windowMs: 5 * 60 * 1000,
  max: 120,
});

// MUTATION tier — user-action POST/PUT/DELETE (newsletter signup, push
// subscribe, tip jar, watchlists, meter, csp-report). Tighter than reads
// to deter abuse; covers both reads and writes on routes with mixed
// shapes (watchlists, meter) — typical use produces 0-3 calls/5min.
export const mutationLimiter = createLimiter({
  windowMs: 5 * 60 * 1000,
  max: 60,
});

// ─── Safety net + legacy per-route limiters ───────────────────────────────

// Raised from 500/15min to 3000/15min as part of Phase S3. Now a safety
// net for unmounted routes rather than the binding constraint for normal
// traffic. Per-route tier limiters above are the primary protection.
export const apiGlobalLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 3000,
});

export const authMagicLinkLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
});

export const adminRouteLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
});

// Raised from 30/15min to 60/15min in Phase S3 per finding #65 (reader
// extraction intermittency). 30 was tight for heavy readers; 60 is still
// modest given /api/reader has a 12h server cache (each unique article
// only consumes budget once per 12h).
export const readerLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
});

export const analysisLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
});

export const predictionsLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 240,
});

export const publicV1EdgeLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 600,
});
