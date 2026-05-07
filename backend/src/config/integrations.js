/**
 * Startup integration summary.
 *
 * Builds a structured snapshot of which third-party integrations are
 * configured at boot, for emission by server.js as a one-shot startup log.
 * All values are booleans (or counts) — never secret material.
 *
 * Used by:
 *   - backend/server.js (web process startup log)
 *
 * If a future startup-summary consumer needs additional categories, add
 * them here rather than inline in server.js to keep the boot log emit
 * compact. Categories should mirror the conventions used in the
 * is*Configured() helpers across the codebase.
 */

import { isStripeConfigured } from "../routes/tips.js";
import { isBlueskyConfigured }   from "../services/blueskyClient.js";
import { isFacebookConfigured }  from "../services/facebookClient.js";
import { isInstagramConfigured } from "../services/instagramClient.js";
import { isThreadsConfigured }   from "../services/threadsClient.js";
import { isLinkedinConfigured }  from "../services/linkedinClient.js";
import { isPinterestConfigured } from "../services/pinterestClient.js";
import { isTikTokConfigured }    from "../services/tiktokClient.js";
import { isYouTubeConfigured }   from "../services/youtubeClient.js";

const AMAZON_MARKET_ENV_VARS = [
  "AMAZON_TAG_US", "AMAZON_TAG_UK", "AMAZON_TAG_IN", "AMAZON_TAG_AE",
  "AMAZON_TAG_CA", "AMAZON_TAG_DE", "AMAZON_TAG_AU", "AMAZON_TAG_JP",
];

/**
 * @param {{ schedulerEnabled: boolean }} ctx
 * @returns {object} integration status (all leaves are booleans or counts)
 */
export function collectIntegrationStatus({ schedulerEnabled }) {
  return {
    scheduler: {
      enabled: Boolean(schedulerEnabled),
      bullmq: process.env.USE_BULLMQ === "true",
    },
    realityIndex: process.env.ENABLE_REALITY_INDEX !== "false",
    payments: {
      stripe: isStripeConfigured(),
    },
    email: {
      smtp: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    },
    publishers: {
      bluesky:   isBlueskyConfigured(),
      facebook:  isFacebookConfigured(),
      instagram: isInstagramConfigured(),
      threads:   isThreadsConfigured(),
      linkedin:  isLinkedinConfigured(),
      pinterest: isPinterestConfigured(),
      tiktok:    isTikTokConfigured(),
      youtube:   isYouTubeConfigured(),
    },
    ai: {
      cerebras:   Boolean(process.env.CEREBRAS_API_KEY),
      groq:       Boolean(process.env.GROQ_API_KEY),
      cloudflare: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN),
      nvidia:     Boolean(process.env.NVIDIA_API_KEY),
      gemini:     Boolean(process.env.GEMINI_API_KEY),
      ollama:     Boolean(process.env.OLLAMA_BASE_URL),
    },
    external: {
      openweather: Boolean(process.env.OPENWEATHER_API_KEY),
      pexels:      Boolean(process.env.PEXELS_API_KEY),
    },
    ads: {
      adsense: Boolean(process.env.ADSENSE_CLIENT_ID),
    },
    affiliates: {
      amazonMarkets: AMAZON_MARKET_ENV_VARS.filter((k) => Boolean(process.env[k])).length,
      skimlinks:     Boolean(process.env.SKIMLINKS_ID),
      binance:       Boolean(process.env.BINANCE_AFFILIATE_ID),
    },
  };
}

/**
 * Recursively counts configured slots in an integration-status object.
 * Booleans count as one slot (configured if true). Numeric leaves count
 * as one slot (configured if > 0) so counts like `amazonMarkets: 5` don't
 * outweigh per-platform booleans in the summary line.
 */
export function countIntegrations(status) {
  let configured = 0;
  let total = 0;
  for (const value of Object.values(status)) {
    if (typeof value === "boolean") {
      total += 1;
      if (value) configured += 1;
    } else if (typeof value === "number") {
      total += 1;
      if (value > 0) configured += 1;
    } else if (value && typeof value === "object") {
      const nested = countIntegrations(value);
      configured += nested.configured;
      total += nested.total;
    }
  }
  return { configured, total };
}
