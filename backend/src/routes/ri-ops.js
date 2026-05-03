/**
 * /scoop-ops/ri-ops — Reality Index operator diagnostics.
 *
 * Routes (all gated by ADMIN_KEY in prod via the same `?key=` pattern as
 * /scoop-ops/social-queue):
 *   GET /scoop-ops/ri-ops/provider   — which LLM/embed provider is live,
 *                                       request-per-minute counters, and the
 *                                       resolved model names so you can verify
 *                                       a Hostinger env-var change took effect
 *                                       without grepping logs.
 *
 * This is intentionally a single endpoint — anything beyond live state
 * belongs in /api/health or a dedicated admin UI.
 */

import { Router } from "express";
import { getQueueStatus } from "../realityIndex/llmQueue.js";

const router = Router();
const ADMIN_KEY = process.env.ADMIN_KEY || "";

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return next();           // dev mode: open
  if (req.query.key === ADMIN_KEY) return next();
  return res.status(404).json({ ok: false, error: "not found" });
}

router.get("/provider", requireAdmin, (_req, res) => {
  // getQueueStatus is the canonical view — same shape as /api/health embeds.
  // Adds a one-line "summary" so a curl can see the answer at a glance.
  const s = getQueueStatus();
  res.json({
    ok:      true,
    summary: `LLM=${s.provider} (${s.genModel}) · Embed=${s.embedProvider} (${s.embedModel}) · Premium=${s.premiumProvider} (${s.premiumModel})`,
    ...s,
  });
});

export default router;
