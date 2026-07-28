// Branded image cards for social/OG previews. Each article gets a typographic
// card rendered on demand and cached on disk. Available presets:
//
//   GET /api/cards/og/:id.png        — 1200×630  (Open Graph + Twitter)
//   GET /api/cards/square/:id.png    — 1080×1080 (Instagram feed)
//   GET /api/cards/story/:id.png     — 1080×1920 (Stories / Shorts thumbnail)
//   GET /api/cards/carousel1/:id.png — 1080×1080 carousel slide 1 (cover)
//   GET /api/cards/carousel2/:id.png — 1080×1080 carousel slide 2 (key points)
//   GET /api/cards/carousel3/:id.png — 1080×1080 carousel slide 3 (CTA)
//
// Cards are deterministic: same article → same bytes. We send long cache
// headers and a content-hash ETag so CDNs and crawlers cache aggressively.

import { Router } from "express";
import { getArticleById, getDb } from "../models/database.js";
import { ensureCard, ensureEventCard, isCardRendererReady, PRESETS } from "../services/cardRenderer.js";
import { logger } from "../services/logger.js";

const router = Router();

const ONE_WEEK = 60 * 60 * 24 * 7;

// Event-carousel reads. Intentionally inline for now: the eventsDao that will
// own these lands in the next commit, and duplicating three small queries is
// cheaper than making this commit depend on one that does not exist yet.
function loadEventCardContext(slug) {
  const db = getDb();
  const event = db.prepare(
    "SELECT id, slug, title, summary, category FROM events WHERE slug = ?"
  ).get(slug);
  if (!event) return null;

  const coverage = db.prepare(`
    SELECT COUNT(*) AS articles, COUNT(DISTINCT a.source_name) AS sources
    FROM event_articles ea JOIN articles a ON a.id = ea.article_id
    WHERE ea.event_id = ?
  `).get(event.id) || { articles: 0, sources: 0 };

  // Copy is READ ONLY — never generated here. A missing or unsuccessful row
  // means the carousel is not ready; the route says so rather than inventing
  // slide content.
  const row = db.prepare(
    "SELECT details_json, figures_json, why_it_matters FROM event_carousel_copy WHERE event_id = ? AND succeeded_at IS NOT NULL"
  ).get(event.id);

  let copy = null;
  if (row) {
    try {
      copy = {
        details: JSON.parse(row.details_json || "[]"),
        figures: JSON.parse(row.figures_json || "[]"),
        why_it_matters: row.why_it_matters || "",
      };
    } catch { copy = null; }
  }
  return { event, coverage, copy };
}

// GET /api/cards/:preset/event/:slug.png — 7-slide event carousel.
// Declared BEFORE the article route so "event" is never parsed as an id.
router.get("/:preset/event/:slug.png", async (req, res) => {
  if (!isCardRendererReady()) {
    res.status(503).type("text/plain").send("card renderer unavailable");
    return;
  }
  const preset = String(req.params.preset || "").toLowerCase();
  if (!PRESETS[preset]) {
    res.status(400).type("text/plain").send("unknown preset");
    return;
  }
  const slug = String(req.params.slug || "").trim();
  if (!slug) {
    res.status(400).type("text/plain").send("missing slug");
    return;
  }

  const ctx = loadEventCardContext(slug);
  if (!ctx) {
    res.status(404).type("text/plain").send("event not found");
    return;
  }

  try {
    const card = await ensureEventCard(ctx, preset);
    res.setHeader("Content-Type", card.contentType);
    res.setHeader("Cache-Control", `public, max-age=${ONE_WEEK}, s-maxage=${ONE_WEEK}, immutable`);
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("X-Card-Cache", card.hit ? "hit" : "miss");
    const etag = `"${card.path.split("-").slice(-1)[0].replace(/\.png$/, "")}"`;
    res.setHeader("ETag", etag);
    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }
    res.send(card.buffer);
  } catch (err) {
    // 422 (not 500): the usual cause is "copy not generated yet", which is a
    // state problem, not a server fault. Distinguishable in logs and by Meta.
    logger.warn(`event card unavailable for ${slug}/${preset}: ${err.message}`);
    res.status(422).type("text/plain").send("event card not ready");
  }
});

router.get("/:preset/:id.png", async (req, res) => {
  if (!isCardRendererReady()) {
    res.status(503).type("text/plain").send("card renderer unavailable");
    return;
  }

  const preset = String(req.params.preset || "").toLowerCase();
  if (!PRESETS[preset]) {
    res.status(400).type("text/plain").send("unknown preset");
    return;
  }

  // Strip any extra extension noise just in case.
  const id = String(req.params.id || "").trim();
  if (!id) {
    res.status(400).type("text/plain").send("missing id");
    return;
  }

  const article = getArticleById(id);
  if (!article) {
    res.status(404).type("text/plain").send("not found");
    return;
  }

  try {
    const card = await ensureCard(article, preset);
    res.setHeader("Content-Type", card.contentType);
    res.setHeader("Cache-Control", `public, max-age=${ONE_WEEK}, s-maxage=${ONE_WEEK}, immutable`);
    // Allow external CDN crawlers (Meta, Pinterest, etc.) to fetch card images.
    // Helmet sets CORP: same-origin globally; override it here so social
    // platforms can download these assets server-side for post previews.
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    // Diagnostic headers — let us tell at a glance from `curl -I` whether the
    // photo fetch succeeded for this card and whether it was a fresh render
    // or a cache hit.
    res.setHeader("X-Card-Photo", card.withPhoto ? "embedded" : "absent");
    res.setHeader("X-Card-Cache", card.hit ? "hit" : "miss");
    if (card.photoSource) res.setHeader("X-Card-Photo-Source", card.photoSource);
    // Use the cache filename's hash chunk as the etag — invalidates when
    // headline/category/source changes.
    const etag = `"${card.path.split("-").slice(-1)[0].replace(/\.png$/, "")}"`;
    res.setHeader("ETag", etag);
    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }
    res.send(card.buffer);
  } catch (err) {
    logger.error(`card render failed for ${id}/${preset}: ${err.message}`);
    res.status(500).type("text/plain").send("render failed");
  }
});

export default router;
