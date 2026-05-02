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
import { getArticleById } from "../models/database.js";
import { ensureCard, isCardRendererReady, PRESETS } from "../services/cardRenderer.js";
import { logger } from "../services/logger.js";

const router = Router();

const ONE_WEEK = 60 * 60 * 24 * 7;

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
