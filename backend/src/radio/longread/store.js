/**
 * store.js - The Long Read's pieces on disk (#304). One folder per piece under the long-read directory:
 *   <dir>/<YYYY-MM-DD>-<slug>/longread.json   status draft | ready | approved | refused, the check report, airings
 *   <dir>/<YYYY-MM-DD>-<slug>/pack.json       the fact base the piece was written and checked from
 * The directory is RADIO_LONGREAD_DIR, else <RADIO_BASE_DIR or ~/scoopfeeds-radio>/longreads. Writes are atomic.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = (p) => String(p).replace(/^~(?=$|\/)/, os.homedir());
export const longReadDir = (env = process.env) => path.resolve(home(env.RADIO_LONGREAD_DIR || path.join(env.RADIO_BASE_DIR || "~/scoopfeeds-radio", "longreads")));

const writeJson = (f, obj) => { fs.writeFileSync(f + ".tmp", JSON.stringify(obj, null, 1)); fs.renameSync(f + ".tmp", f); };
const slugOf = (s) => String(s || "story").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "story";

export function pieceId(createdAt, slug) {
  return `${new Date(createdAt).toISOString().slice(0, 10)}-${slugOf(slug)}`;
}

/** Save a new piece (and its fact base). An id already taken gets a suffix. Returns the piece as saved. */
export function savePiece(piece, pack, { dir = longReadDir() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  let id = piece.id || pieceId(piece.createdAt, piece.event?.slug), n = 2;
  while (fs.existsSync(path.join(dir, id))) id = `${piece.id || pieceId(piece.createdAt, piece.event?.slug)}-${n++}`;
  fs.mkdirSync(path.join(dir, id));
  const saved = { ...piece, id };
  if (pack) writeJson(path.join(dir, id, "pack.json"), pack);
  writeJson(path.join(dir, id, "longread.json"), saved);
  return saved;
}

export function loadPiece(id, { dir = longReadDir() } = {}) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, id, "longread.json"), "utf8")); } catch { return null; }
}

/** Every readable piece, newest first. An unreadable folder is skipped (and listed in `skipped`). */
export function listPieces({ dir = longReadDir() } = {}) {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return Object.assign([], { skipped: [] }); }
  const skipped = [];
  const out = [];
  for (const n of names) { const p = loadPiece(n, { dir }); if (p) out.push(p); else skipped.push(n); }
  out.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  return Object.assign(out, { skipped });
}

/** Event slugs that had a piece made since `since` (refused pieces too: the story was tried). */
export function recentSlugs(since, { dir = longReadDir() } = {}) {
  return new Set(listPieces({ dir }).filter((p) => Number(p.createdAt) >= since && p.event?.slug).map((p) => p.event.slug));
}

/** Change a piece in place: `fn(piece)` returns the new piece. Returns it, or null when there is no such piece. */
export function updatePiece(id, fn, { dir = longReadDir() } = {}) {
  const p = loadPiece(id, { dir });
  if (!p) return null;
  const next = fn(p);
  writeJson(path.join(dir, id, "longread.json"), next);
  return next;
}

/** Review: approve or refuse a piece. A refused piece can never be approved. */
export function setReview(id, status, { by = os.userInfo().username, note = null, now = Date.now(), dir = longReadDir() } = {}) {
  if (!["approved", "refused"].includes(status)) throw new Error(`review status must be approved or refused, not ${status}`);
  return updatePiece(id, (p) => {
    if (status === "approved" && p.status === "refused") throw new Error(`${id} was refused by the checks (${(p.verdict?.reasons || []).join("; ")}); it cannot be approved`);
    return { ...p, status, review: { status, by, at: now, ...(note ? { note } : {}) } };
  }, { dir });
}

/** Record that hour H carries this piece (a refresh of the same hour is the same airing). */
export function recordAiring(id, hourStart, { dir = longReadDir() } = {}) {
  return updatePiece(id, (p) => ({ ...p, airings: [...new Set([...(p.airings || []), hourStart])].sort((a, b) => a - b) }), { dir });
}
