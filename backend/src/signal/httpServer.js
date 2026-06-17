/**
 * httpServer — standalone READ-ONLY HTTP/JSON data-plane for the Signal Service.
 *
 * A separate Express app (not mounted in the public API) bound to localhost by default, so
 * the internal contract stays decoupled from the public site. Every route is a thin wrapper
 * over service.js. JSON only; GET only; no writes.
 */
import "../config/env.js"; // load .env the same way the main app does
import express from "express";
import { fileURLToPath } from "url";
import { SIGNAL } from "./config.js";
import * as service from "./service.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  app.get("/health", (_req, res) => res.json(service.getHealth()));

  app.get("/sources", (_req, res) => res.json(service.getSources()));

  app.get("/articles", (req, res) => {
    const { window, limit, offset, min_published, max_published } = req.query;
    res.json(service.getArticles({ window, limit, offset, min_published, max_published }));
  });

  app.get("/articles/:id", (req, res) => {
    const article = service.getArticleById(req.params.id);
    if (!article) return res.status(404).json({ error: "not_found", article_id: req.params.id });
    res.json(article);
  });

  return app;
}

// Start only when executed directly (e.g. `node src/signal/httpServer.js`).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createApp().listen(SIGNAL.port, SIGNAL.bindHost, () => {
    console.log(`[signal] read-only HTTP API on http://${SIGNAL.bindHost}:${SIGNAL.port}`);
  });
}
