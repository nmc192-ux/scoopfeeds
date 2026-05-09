/**
 * /scoop-ops/articles — operator endpoints for individual-article remediation.
 *
 *   POST /scoop-ops/articles/:id/set-published-at
 *     Body: { "published_at_ms": <number> }
 *     Updates an article's published_at to the supplied timestamp.
 *     Used to correct misparsed publication dates (e.g., RSS ingest
 *     misreading a future date string from article content).
 *
 *     Rejects future dates and dates older than 1 year — the misparsed
 *     futures are exactly the bug pattern this endpoint addresses, and
 *     the 1-year backstop guards against fat-finger errors.
 *
 *     Returns { ok, id, before, after } so the caller can verify the
 *     state transition without a separate read.
 *
 * Routes are protected by the global /scoop-ops/* admin auth boundary
 * (adminAuth + adminAuditLogger) mounted in backend/server.js. Bearer
 * token auth via Authorization header; ADMIN_BEARER_TOKEN env var.
 * Routes here MUST be mounted only under /scoop-ops to inherit this
 * protection.
 */

import { Router } from "express";
import { getDb } from "../models/database.js";
import { logger } from "../services/logger.js";

const router = Router();

const MAX_ID_LENGTH = 128;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

router.post("/:id/set-published-at", (req, res) => {
  try {
    // ── Validate :id ───────────────────────────────────────────────────
    const id = typeof req.params.id === "string" ? req.params.id : "";
    if (!id || id.length > MAX_ID_LENGTH) {
      return res.status(400).json({
        ok: false,
        error: `id must be a non-empty string of at most ${MAX_ID_LENGTH} chars`,
      });
    }

    // ── Validate published_at_ms ───────────────────────────────────────
    const ms = req.body?.published_at_ms;
    if (!Number.isInteger(ms) || ms <= 0) {
      return res.status(400).json({
        ok: false,
        error: "published_at_ms must be a positive integer",
      });
    }
    const now = Date.now();
    if (ms > now) {
      return res.status(400).json({
        ok: false,
        error: "published_at_ms must not be in the future",
      });
    }
    if (ms < now - ONE_YEAR_MS) {
      return res.status(400).json({
        ok: false,
        error: "published_at_ms must not be more than 1 year in the past",
      });
    }

    // ── Read current ───────────────────────────────────────────────────
    const db = getDb();
    const before = db
      .prepare("SELECT id, title, published_at FROM articles WHERE id = ?")
      .get(id);
    if (!before) {
      return res.status(404).json({ ok: false, error: "article not found" });
    }

    // ── Update ─────────────────────────────────────────────────────────
    db.prepare("UPDATE articles SET published_at = ? WHERE id = ?").run(ms, id);

    // ── Read after ─────────────────────────────────────────────────────
    const after = db
      .prepare("SELECT id, title, published_at FROM articles WHERE id = ?")
      .get(id);

    logger.info("articles-ops: set published_at", {
      article_id: id,
      title: typeof before.title === "string" ? before.title.slice(0, 80) : null,
      before_ms: before.published_at,
      after_ms: after.published_at,
    });

    return res.json({
      ok: true,
      id,
      before: {
        published_at: before.published_at,
        pub_iso: new Date(before.published_at).toISOString(),
      },
      after: {
        published_at: after.published_at,
        pub_iso: new Date(after.published_at).toISOString(),
      },
    });
  } catch (err) {
    logger.error(`articles-ops set-published-at failed: ${err.message}`);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
