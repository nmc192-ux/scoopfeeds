/**
 * videoStockLibrary.js — reading the curated cutaway library, and choosing from it.
 *
 * WHAT THIS IS NOT. It never searches a provider, and it never reaches into the
 * operator toolchain that builds the library. It reads one JSON file as DATA and
 * one directory of files from disk. Acquisition, curation and grading are
 * Mac-side operator work and are deliberately unreachable from any process that
 * boots on the VPS — a guard test asserts exactly that, and this module is on
 * the runtime side of that line.
 *
 * WHY LOOKUP AND NOT SEARCH. Live keyword search is what put a globe on a gold
 * story and a bar chart on a displacement story. Every frame that reaches the
 * channel has been looked at by a person first: an asset is only selectable once
 * a human has marked it kept and it has been graded. The consequence is that an
 * unmatched noun yields NOTHING — never a near-miss, never a fallback. The log
 * line naming that noun is the useful output, because it says which subject
 * class to go and acquire next.
 *
 * THE EDITORIAL RULE THE SELECTION SERVES: stock illustrates the SUBJECT, never
 * the EVENT. That judgement was made by a human at curation time and cannot be
 * re-derived here, which is the reason selection is a lookup against what they
 * approved rather than a matcher over what exists.
 */

import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Dark until switched on, in the established shape. */
export const stockCutawaysEnabled = () => process.env.VIDEO_STOCK_CUTAWAYS_ENABLED === "1";

/**
 * Where the synced library lives.
 *
 * SCOOP_PERSISTENT_DATA_DIR, NOT backend/data. On the VPS the deploy directory
 * is replaced on every release and the image bakes its own copy of the source
 * tree, so a library under backend/data would be destroyed by a redeploy and
 * silently replaced by whatever was in the image. That is the same trap the
 * database is kept out of. The operator toolchain writes to backend/data on the
 * Mac, where nothing redeploys over it; the sync targets this path instead.
 */
export function libraryRoot() {
  const base = process.env.SCOOP_PERSISTENT_DATA_DIR
    ? path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR)
    : path.join(BACKEND_ROOT, "data");
  return path.join(base, "stock-library");
}

export const manifestPath = () => path.join(libraryRoot(), "manifest.json");

/**
 * The shape this reader expects. Bumped when the library's record shape changes
 * in a way this module must notice — the same discipline videoFootage.js applies
 * to its cache. The manifest is a bare JSON array and cannot carry a version of
 * its own, so the expectation is versioned HERE, at the reader.
 */
export const MANIFEST_READER_VERSION = 1;

/** Fields this module cannot select without. A row missing any is skipped, loudly. */
const REQUIRED = ["id", "subjectClass", "provider", "creator", "sourceUrl", "license", "treatedPath", "status"];

/**
 * Load the selectable assets: treated, and carrying everything selection and
 * attribution need. Never throws — a missing or malformed library means no
 * cutaways, which is a correct video, not a failed one.
 */
export function loadLibrary({ root = libraryRoot() } = {}) {
  const file = path.join(root, "manifest.json");
  if (!existsSync(file)) return { assets: [], root, reason: "no-manifest" };

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    logger.warn(`🎞 stock library: manifest unreadable (${err.message.slice(0, 120)}) — no cutaways this render`);
    return { assets: [], root, reason: "unreadable" };
  }
  if (!Array.isArray(parsed)) {
    logger.warn("🎞 stock library: manifest is not a JSON array — no cutaways this render");
    return { assets: [], root, reason: "wrong-shape" };
  }

  const assets = [];
  let skipped = 0;
  for (const row of parsed) {
    if (!row || typeof row !== "object") { skipped++; continue; }
    // Only what a human kept AND that has been graded. An ungraded file is the
    // provider's own look, which is not the house look.
    if (row.status !== "treated" || !row.treatedPath) continue;
    if (REQUIRED.some((f) => !row[f])) { skipped++; continue; }
    const abs = path.join(root, row.treatedPath);
    if (!existsSync(abs)) { skipped++; continue; }
    assets.push({ ...row, absPath: abs, tags: Array.isArray(row.tags) ? row.tags : [] });
  }
  if (skipped) {
    logger.warn(`🎞 stock library: ${skipped} manifest row(s) skipped — incomplete provenance or missing file`);
  }
  return { assets, root, reason: null };
}

// ─── Matching ───────────────────────────────────────────────────────────────

const norm = (s) => String(s || "").toLowerCase().trim().replace(/\s+/g, " ");

/**
 * Assets whose class or tags name this noun. EXACT ONLY — no fuzzy matching, no
 * embedding similarity, no model re-ranking. A near-miss is how a clip that is
 * merely adjacent to the subject gets on screen, and the whole architecture
 * exists to stop that. An unmatched noun is a signal about what to acquire, and
 * that feedback is worth more than a matcher that always finds something.
 */
export function matchAssets(assets, visual) {
  const want = norm(visual);
  if (!want) return [];
  return assets.filter((a) => norm(a.subjectClass) === want || a.tags.some((t) => norm(t) === want));
}

// ─── Selection ──────────────────────────────────────────────────────────────

/** Hard ceiling per video. Rhythm, not wallpaper. */
export const MAX_CUTAWAYS = 2;

/**
 * Choose cutaways for a spec's slides.
 *
 * `slides` are the validated content slides in render order. `lastUsed` maps
 * asset id → epoch ms, so the same clip does not open two videos in a row.
 *
 * Returns { picks, unresolved } where picks is [{ slideIndex, asset }] and
 * unresolved names the nouns nothing matched — the acquisition backlog.
 */
export function selectCutaways(slides = [], { assets = [], lastUsed = {}, max = MAX_CUTAWAYS } = {}) {
  const picks = [];
  const unresolved = [];
  const usedCreators = new Set();

  for (let i = 0; i < slides.length; i++) {
    if (picks.length >= max) break;
    const visual = slides[i]?.visual;
    if (!visual) continue;                       // no field, no cutaway — never a fallback

    // Never on consecutive beats: two cutaways back to back reads as a montage,
    // which is the wallpaper this is meant not to be.
    if (picks.length && i - picks[picks.length - 1].slideIndex < 2) continue;

    const matched = matchAssets(assets, visual);
    if (!matched.length) {
      unresolved.push(visual);
      continue;
    }

    // One contributor may not supply two cutaways in one video. Six of one
    // film's eight clips once came from a single contributor's shoot — all
    // on-topic, all visually the same.
    const eligible = matched.filter((a) => !usedCreators.has(norm(a.creator)));
    if (!eligible.length) continue;

    // Least-recently-used first, so the library rotates rather than favouring
    // whatever sorts first. Never-used assets (undefined) sort ahead of all.
    const chosen = [...eligible].sort((a, b) => {
      const ua = lastUsed[a.id] ?? 0;
      const ub = lastUsed[b.id] ?? 0;
      return ua - ub || String(a.id).localeCompare(String(b.id));
    })[0];

    usedCreators.add(norm(chosen.creator));
    picks.push({ slideIndex: i, asset: chosen });
  }

  for (const noun of unresolved) {
    // THIS LOG LINE IS THE POINT of an unresolvable visual: it names a subject
    // the writer wanted and the library could not serve, which is the acquisition
    // backlog stated in the only place it can be observed.
    logger.info(`🎞 stock cutaway: no asset for visual "${noun}" — nothing rendered; consider acquiring this class`);
  }
  return { picks, unresolved };
}
