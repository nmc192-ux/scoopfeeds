/**
 * GET /events/:slug — page-level 301 for a retired dossier slug (#179).
 *
 * The SPA serves /events/:slug from index.html, so without this a reader or a
 * crawler on an old slug would get a 200 shell that then 404s in the app. This
 * answers only when the slug is NOT a live event and IS a known alias; every
 * other request falls through untouched to the routes after it.
 */
import express from "express";
import { getDb } from "../models/database.js";
import { resolveSlugAlias } from "../realityIndex/dal/slugAliases.js";

const router = express.Router();

router.get("/events/:slug", (req, res, next) => {
  try {
    const db = getDb();
    if (db.prepare("SELECT 1 FROM events WHERE slug = ?").get(req.params.slug)) return next();
    const current = resolveSlugAlias(db, req.params.slug);
    if (!current) return next();
    const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    return res.redirect(301, `/events/${encodeURIComponent(current)}${qs}`);
  } catch {
    return next();
  }
});

export default router;
