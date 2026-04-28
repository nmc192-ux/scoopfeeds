/**
 * /api/tips — Stripe Checkout tip jar.
 *
 * Routes:
 *   POST /api/tips/create-session  { amount }
 *       → creates a Stripe Checkout session, returns { url }.
 *       `amount` is one of: 3, 5, 10 (USD dollars).
 *
 *   POST /api/tips/webhook
 *       → Stripe webhook endpoint (raw body required for signature verification).
 *         Handles checkout.session.completed → marks tip as completed in DB.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY     — sk_live_... or sk_test_...
 *   STRIPE_PUBLISHABLE_KEY — pk_live_... or pk_test_... (optional, exposed to frontend via /api/public-config)
 *   STRIPE_WEBHOOK_SECRET — whsec_... (set in Stripe Dashboard → Webhooks)
 *   PRIMARY_SITE_URL      — used for success/cancel redirect URLs
 *
 * No Stripe account → endpoints return { configured: false }; the frontend
 * hides the tip button entirely via /api/public-config.
 */

import { Router } from "express";
import {
  createTipRecord, completeTip, getTipStats,
  getUserBySession, upgradeTier, setStripeCustomer, getUserByStripeCustomer,
  getUserByEmail, recordKofiPayment,
} from "../models/database.js";
import { logger } from "../services/logger.js";

const router = Router();

const SITE_URL = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");

const getSecretKey = () => process.env.STRIPE_SECRET_KEY || "";
const getWebhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET || "";

export function isStripeConfigured() {
  return Boolean(getSecretKey());
}

// Allowed tip amounts in cents.
const ALLOWED_AMOUNTS = { 3: 300, 5: 500, 10: 1000 };

// Lazy-load stripe to avoid crashing the server when not installed yet.
let _stripe = null;
async function getStripe() {
  if (_stripe) return _stripe;
  try {
    const { default: Stripe } = await import("stripe");
    _stripe = new Stripe(getSecretKey(), { apiVersion: "2024-04-10" });
    return _stripe;
  } catch (err) {
    logger.warn(`tips: failed to load stripe: ${err.message}`);
    return null;
  }
}

// ─── POST /api/tips/create-session ──────────────────────────────────────────
router.post("/create-session", async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ success: false, error: "Stripe not configured" });
  }

  const rawAmount = Number(req.body?.amount) || 5;
  const amountCents = ALLOWED_AMOUNTS[rawAmount] || 500;

  const stripe = await getStripe();
  if (!stripe) return res.status(503).json({ success: false, error: "Stripe unavailable" });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: "Support Scoop ☕",
              description: "Help keep independent news aggregation free. One-time tip.",
              images: [`${SITE_URL}/api/cards/og/scoop-tip.png`],
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${SITE_URL}/?payment=success`,
      cancel_url:  `${SITE_URL}/?payment=cancelled`,
      // Allow customer to enter their email (shown in Stripe dashboard).
      customer_creation: "if_required",
      // Store amount in metadata so the webhook can record it.
      metadata: { amount_cents: String(amountCents), source: "tip_jar" },
    });

    // Create a pending tip record so we can track even abandoned sessions.
    createTipRecord({ id: session.id, amountCents, currency: "usd" });

    res.json({ success: true, url: session.url });
  } catch (err) {
    logger.error(`tips: create-session failed: ${err.message}`);
    res.status(500).json({ success: false, error: "Failed to create payment session" });
  }
});

// ─── POST /api/tips/subscribe ────────────────────────────────────────────────
// Creates a Stripe Checkout session in subscription mode ($5/mo).
// Requires the user to be signed in (reads scoop_session cookie).
router.post("/subscribe", async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ success: false, error: "Stripe not configured" });
  }

  // Resolve user from session cookie (same pattern as auth.js / news.js).
  const raw = req.headers.cookie || "";
  const match = raw.match(/(?:^|;\s*)scoop_session=([^;]+)/);
  const sessionToken = match ? decodeURIComponent(match[1]) : null;
  const user = sessionToken ? getUserBySession(sessionToken) : null;

  if (!user) {
    return res.status(401).json({ success: false, error: "Sign in first to upgrade to premium" });
  }
  if (user.tier === "premium") {
    return res.json({ success: true, alreadyPremium: true });
  }

  const stripe = await getStripe();
  if (!stripe) return res.status(503).json({ success: false, error: "Stripe unavailable" });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: 500, // $5.00 / month
            recurring: { interval: "month" },
            product_data: {
              name: "Scoop Premium ⭐",
              description: "Ad-free reading, unlimited article saves, and early breaking-news push alerts.",
            },
          },
          quantity: 1,
        },
      ],
      // Carry the user ID so the webhook can upgrade the tier immediately.
      client_reference_id: user.id,
      success_url: `${SITE_URL}/?payment=success`,
      cancel_url:  `${SITE_URL}/`,
    });

    res.json({ success: true, url: session.url });
  } catch (err) {
    logger.error(`tips: subscribe session failed: ${err.message}`);
    res.status(500).json({ success: false, error: "Failed to create subscription session" });
  }
});

// ─── POST /api/tips/webhook ──────────────────────────────────────────────────
// IMPORTANT: must receive raw body — express.json() must be skipped for this route.
// Registered in server.js BEFORE the express.json() middleware using express.raw().
router.post(
  "/webhook",
  (req, _res, next) => {
    // If the request already has raw buffer (from express.raw middleware), skip.
    // Otherwise fall through (will fail sig verification; we log and return 400).
    next();
  },
  async (req, res) => {
    const secret = getWebhookSecret();
    const sig = req.headers["stripe-signature"];

    if (!isStripeConfigured()) return res.sendStatus(503);

    const stripe = await getStripe();
    if (!stripe) return res.sendStatus(503);

    let event;
    try {
      if (secret && sig) {
        event = stripe.webhooks.constructEvent(req.body, sig, secret);
      } else {
        // Dev mode: no signature verification.
        event = typeof req.body === "string" || Buffer.isBuffer(req.body)
          ? JSON.parse(req.body.toString())
          : req.body;
      }
    } catch (err) {
      logger.warn(`tips: webhook signature error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.mode === "subscription") {
        // Premium subscription created via Checkout.
        const userId         = session.client_reference_id;
        const stripeCustomerId = session.customer;
        if (userId) {
          upgradeTier(userId, "premium");
          if (stripeCustomerId) setStripeCustomer(userId, stripeCustomerId);
          logger.info(`⭐ Premium activated: user ${userId}`);
        }
      } else {
        // One-time tip payment.
        completeTip(session.id, {
          stripePaymentIntent: session.payment_intent,
          email: session.customer_details?.email || null,
        });
        logger.info(`💰 Tip completed: ${session.id} $${(session.amount_total || 0) / 100}`);
      }
    }

    // Subscription cancelled / expired — downgrade back to free.
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const stripeCustomerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
      if (stripeCustomerId) {
        const user = getUserByStripeCustomer(stripeCustomerId);
        if (user) {
          upgradeTier(user.id, "free");
          logger.info(`📉 Premium cancelled: user ${user.id}`);
        }
      }
    }

    res.json({ received: true });
  }
);

// ─── POST /api/tips/kofi-webhook ────────────────────────────────────────────
// Ko-fi POSTs a form-urlencoded body with a single `data` field containing
// a JSON-encoded payment object. We verify the payload using the
// KOFI_WEBHOOK_TOKEN env var (set this to the "Verification Token" shown in
// Ko-fi Settings → API → Ko-fi Button / Webhooks). If the token is not set
// we skip verification (useful during initial setup / local dev).
//
// On a successful donation we record it in the `tips` table.
// On a successful subscription (type === "Subscription") we additionally look
// up the user by email and upgrade their tier to "premium" — this wires the
// Ko-fi monthly membership directly to the ad-free tier gate.
//
// Ko-fi requires a 200 response; any non-200 triggers a retry, so we always
// return 200 (with an `ok: false` body on validation failures to help debug).
router.post("/kofi-webhook", (req, res) => {
  // 1. Parse — Ko-fi sends application/x-www-form-urlencoded with a `data` key.
  let payload;
  try {
    const raw = req.body?.data;
    if (!raw) return res.status(200).json({ ok: false, error: "missing data field" });
    payload = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    logger.warn(`kofi-webhook: JSON parse failed — ${err.message}`);
    return res.status(200).json({ ok: false, error: "invalid json" });
  }

  // 2. Verify the token if KOFI_WEBHOOK_TOKEN is set.
  const expectedToken = process.env.KOFI_WEBHOOK_TOKEN?.trim();
  if (expectedToken && payload.verification_token !== expectedToken) {
    logger.warn(`kofi-webhook: bad verification_token — rejecting`);
    return res.status(200).json({ ok: false, error: "invalid token" });
  }

  const {
    kofi_transaction_id: txId,
    type = "Donation",
    amount = "0",
    currency = "USD",
    email,
    from_name: fromName,
    message,
    is_subscription_payment: isSubPayment,
    tier_name: tierName,
  } = payload;

  if (!txId) {
    return res.status(200).json({ ok: false, error: "missing kofi_transaction_id" });
  }

  const amountCents = Math.round(parseFloat(amount || 0) * 100);
  const paymentType = String(type).toLowerCase();
  const tipMessage  = [fromName, message].filter(Boolean).join(" — ").slice(0, 500) || null;

  // 3. Record in tips table (INSERT OR IGNORE = idempotent).
  try {
    recordKofiPayment({
      kofiTransactionId: txId,
      amountCents,
      currency,
      email: email || null,
      message: tipMessage,
      type: paymentType,
    });
  } catch (err) {
    logger.warn(`kofi-webhook: failed to record payment ${txId}: ${err.message}`);
  }

  // 4. On subscription payment — upgrade the user's tier if we can match their email.
  if (paymentType === "subscription" && isSubPayment && email) {
    try {
      const user = getUserByEmail(email);
      if (user && user.tier !== "premium") {
        upgradeTier(user.id, "premium");
        logger.info(`⭐ Ko-fi premium activated: ${email} (tier: ${tierName || "unknown"})`);
      } else if (!user) {
        // User hasn't created a Scoop account yet — store the intent so when
        // they do sign up with the same email their tier is pre-upgraded.
        // We store this as a special "kofi_sub" tip row that auth.js reads
        // on first login to auto-upgrade. (Handled in auth.js upsertUser path.)
        logger.info(`kofi-webhook: subscription from ${email} — no matching user yet; tip recorded`);
      }
    } catch (err) {
      logger.warn(`kofi-webhook: tier upgrade failed for ${email}: ${err.message}`);
    }
  }

  logger.info(`💛 Ko-fi ${paymentType}: ${amount} ${currency} from ${fromName || email || "anonymous"}`);
  res.status(200).json({ ok: true });
});

// ─── GET /api/tips/stats ─────────────────────────────────────────────────────
router.get("/stats", (_req, res) => {
  const stats = getTipStats();
  res.json({
    success: true,
    totalTips: stats.completed_count,
    totalAmountUsd: ((stats.completed_cents || 0) / 100).toFixed(2),
  });
});

export default router;
