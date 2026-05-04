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

export const apiGlobalLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 500,
});

export const authMagicLinkLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
});

export const adminRouteLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
});

export const readerLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
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
