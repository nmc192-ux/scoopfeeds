/**
 * radio.js — ScoopFeeds Radio (R2) routes. Both are 404 unless RADIO_ENABLED=true.
 *
 *   GET /api/radio/state.json   the state the worker builds every ~5 minutes
 *                               (radio/radioState.js). Cache-Control: no-store.
 *                               A stale file is STILL served: the screen shows
 *                               "Feed delayed" itself when updatedAt is >20 min old,
 *                               which is more honest than a 404 that looks like "off".
 *   GET /radio/screen           the R1 1920×1080 template, served as-is from
 *                               radio/screen/scoopfeeds-radio-screen.html.
 *                               Point it at the feed with ?state=/api/radio/state.json.
 *
 * Mounted above the SPA catch-all in server.js, or the catch-all answers both
 * with index.html.
 */
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { radioEnabled, statePath } from "../radio/radioState.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCREEN_FILE = path.join(HERE, "../radio/screen/scoopfeeds-radio-screen.html");

const gate = (req, res, next) => (radioEnabled() ? next() : res.status(404).json({ error: "not found" }));

export const radioApiRouter = express.Router();
radioApiRouter.use(gate);
radioApiRouter.get("/state.json", (req, res) => {
  res.set("Cache-Control", "no-store");
  let body;
  try {
    body = fs.readFileSync(statePath(), "utf8");
  } catch {
    return res.status(503).json({ error: "radio state not built yet" });
  }
  res.type("application/json").send(body);
});

export const radioScreenRouter = express.Router();
radioScreenRouter.use(gate);
radioScreenRouter.get("/screen", (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!fs.existsSync(SCREEN_FILE)) {
    return res.status(503).type("text/plain").send("Radio screen template is not installed (backend/src/radio/screen/scoopfeeds-radio-screen.html).");
  }
  res.sendFile(SCREEN_FILE);
});
