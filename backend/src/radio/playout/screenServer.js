/**
 * screenServer.js - a loopback-only HTTP server that gives the headless browser the same two URLs
 * production serves (routes/radio.js), without importing the app (no DB, no Express, no RADIO_ENABLED):
 *   GET /radio/screen           the R1 template, as-is
 *   GET /api/radio/state.json   the file at `stateFile` (re-read every request), 503 if it is missing
 * Used when the playout is not pointed at a real site with --base-url.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCREEN_FILE = path.join(HERE, "../screen/scoopfeeds-radio-screen.html");

export const PROGRAMME_FILE = path.join(HERE, "../screen/scoopfeeds-radio-programme.html");
const TYPES = { ".json": "application/json", ".webm": "video/webm", ".mp4": "video/mp4", ".png": "image/png", ".jpg": "image/jpeg" };

/** A file from the programme folder, with byte ranges (the film's <video> seeks). Only plain names: no paths. */
function serveProgrammeFile(dir, name, req, res) {
  if (!dir || !/^[\w.-]+$/.test(name) || !TYPES[path.extname(name)]) { res.statusCode = 404; return res.end("not found"); }
  const f = path.join(dir, name);
  let size;
  try { size = fs.statSync(f).size; } catch { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("Content-Type", TYPES[path.extname(name)]);
  res.setHeader("Accept-Ranges", "bytes");
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
  if (m) {
    const start = m[1] ? Number(m[1]) : 0, end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    res.statusCode = 206; res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`); res.setHeader("Content-Length", end - start + 1);
    return fs.createReadStream(f, { start, end }).pipe(res);
  }
  res.setHeader("Content-Length", size);
  return fs.createReadStream(f).pipe(res);
}

export function startScreenServer({ stateFile, programmeDir = null }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/radio/programme") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return fs.createReadStream(PROGRAMME_FILE).on("error", () => { res.statusCode = 503; res.end("programme screen missing"); }).pipe(res);
    }
    if (url.pathname.startsWith("/programme/")) return serveProgrammeFile(programmeDir, url.pathname.slice("/programme/".length), req, res);
    if (url.pathname === "/radio/screen") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return fs.createReadStream(SCREEN_FILE).on("error", () => { res.statusCode = 503; res.end("screen template missing"); }).pipe(res);
    }
    if (url.pathname === "/api/radio/state.json") {
      try {
        const body = fs.readFileSync(stateFile, "utf8");
        res.setHeader("Content-Type", "application/json");
        return res.end(body);
      } catch {
        res.statusCode = 503;
        return res.end(JSON.stringify({ error: "radio state not built yet" }));
      }
    }
    res.statusCode = 404; res.end("not found");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

export function screenUrl(origin, stateUrl) {
  return `${origin}/radio/screen?broadcast=1&state=${encodeURIComponent(stateUrl)}`;
}

export function programmeUrl(origin) {
  return `${origin}/radio/programme?programme=${encodeURIComponent("/programme/programme.json")}`;
}
