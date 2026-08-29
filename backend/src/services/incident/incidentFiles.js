/**
 * incidentFiles.js — quarantine, treatment, and the sweeper that empties it.
 *
 * WHERE (grounding Q4). SCOOP_PERSISTENT_DATA_DIR, never backend/data. On the
 * VPS the deploy directory is replaced on every release and the image bakes its
 * own copy of the source tree, so anything under backend/data is destroyed by a
 * redeploy — the trap the database is kept out of, and the one
 * videoStockLibrary.libraryRoot() and videoArtifacts.VIDEOS_DIR both avoid the
 * same way.
 *
 * THE SWEEPER SHIPS WITH THE DIRECTORY, not after it. cardSweep.js's header
 * records what the alternative costs: 36,000 files and 34GB in about a month,
 * because every design-version bump orphaned a generation and nothing removed
 * any of it. Its four safety properties are copied here deliberately — a cap per
 * run, unparseable names skipped rather than guessed at, count AND bytes both
 * reported so "it ran" and "it did something" are distinguishable, and a single
 * readdir rather than a recursive glob.
 *
 * BUT THE RETENTION RULE IS DIFFERENT, and this is the part worth reading. A
 * card is a CACHE: deleting a live one costs one cold render and nothing else,
 * which is what makes an mtime rule safe there. A quarantined candidate is
 * EVIDENCE. Deleting the file behind a cleared or verified candidate destroys
 * something that cannot be regenerated — the poster may have deleted the post,
 * and our copy may be the only one. So retention keys on LEDGER STATE:
 *
 *   killed / uncleared  → swept promptly. The decision is made and terminal;
 *                         the ROW survives (it is the record of why), the bytes
 *                         do not. This mirrors the stock library's treatment of
 *                         rejected assets, and for the same reason.
 *   candidate/verifying → swept on a timer. Undecided and going stale.
 *   verified / clearing → held. A decision is in progress.
 *   cleared             → held indefinitely while anything can still use it.
 *   constructed         → held. It is in a published video; this is the file
 *                         that answers a challenge.
 */

import { createHash } from "crypto";
import {
  existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, readFileSync,
} from "fs";
import path from "path";
import { spawn } from "child_process";
import { getFFmpegPath } from "../videoGenerator.js";
import { INCIDENT_GRADE } from "../videoHouseGrade.js";
import { logger } from "../logger.js";

const BACKEND_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");

/** Where quarantined media lives. See the header for why not backend/data. */
export function quarantineRoot() {
  const base = process.env.SCOOP_PERSISTENT_DATA_DIR
    ? path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR)
    : path.join(BACKEND_ROOT, "data");
  return path.join(base, "incident-quarantine");
}

/** How long an undecided candidate's file is kept. */
export const UNDECIDED_RETENTION_MS =
  Number.parseInt(process.env.INCIDENT_QUARANTINE_RETENTION_HOURS || "168", 10) * 60 * 60 * 1000;

/** Most files this sweep may delete in one pass. A bug cannot empty the dir. */
export const SWEEP_CAP = 200;

/** Statuses whose bytes are swept as soon as they are seen. */
const SWEEP_IMMEDIATELY = new Set(["killed", "uncleared"]);
/** Statuses whose bytes are swept once stale. */
const SWEEP_WHEN_STALE = new Set(["candidate", "verifying"]);

export class IncidentFileError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "IncidentFileError";
    this.code = code;
  }
}

/**
 * Filenames are `<candidateId>.<ext>` and `<candidateId>-treated.mp4`.
 *
 * The candidate id in the name is what lets the sweeper decide by ledger state
 * without a join per file, and what makes an unparseable name recognisably
 * somebody else's — the property cardSweep relies on for its orphan rule.
 */
const NAME_RE = /^([0-9a-f-]{36})(-treated)?\.([a-z0-9]{2,5})$/i;
export const parseQuarantineName = (name) => {
  const m = NAME_RE.exec(name);
  return m ? { candidateId: m[1], treated: Boolean(m[2]), ext: m[3].toLowerCase() } : null;
};

/** Extensions we will accept. Anything else is refused rather than stored. */
export const ALLOWED_EXTS = Object.freeze(["mp4", "mov", "m4v", "webm", "jpg", "jpeg", "png", "webp"]);

/**
 * Take a file the operator supplied into quarantine.
 *
 * COPIES BY READ+WRITE rather than moving, so the operator's own copy is never
 * consumed by handing it to us. Returns paths RELATIVE to the quarantine root —
 * see migration 035 on why absolute paths do not belong in the database.
 */
export function ingestFile(candidateId, sourcePath, { root = quarantineRoot() } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(String(candidateId || ""))) {
    throw new IncidentFileError(`"${candidateId}" is not a candidate id`, { code: "bad-id" });
  }
  if (!existsSync(sourcePath)) {
    throw new IncidentFileError(`no such file: ${sourcePath}`, { code: "no-file" });
  }
  const ext = path.extname(sourcePath).replace(/^\./, "").toLowerCase();
  if (!ALLOWED_EXTS.includes(ext)) {
    throw new IncidentFileError(
      `".${ext}" is not an accepted media extension (${ALLOWED_EXTS.join(", ")}). ` +
      "Foreign files are parsed by ffmpeg; the accepted set is deliberately small.",
      { code: "bad-ext" }
    );
  }

  mkdirSync(root, { recursive: true });
  const rel = `${candidateId}.${ext}`;
  const abs = path.join(root, rel);
  const bytes = readFileSync(sourcePath);
  writeFileSync(abs, bytes);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  logger.info(`🎥 incident: quarantined ${rel} (${bytes.length} bytes, sha256 ${sha256.slice(0, 12)}…)`);
  return { relPath: rel, absPath: abs, bytes: bytes.length, sha256 };
}

/**
 * The sha256 of a file on disk.
 *
 * Own material is identified by its own bytes (`incidentLedger.createOwnCandidate`)
 * and the candidate id is not known until after that row exists — so the hash has
 * to be computable BEFORE `ingestFile`, which names its output after the candidate.
 * Same algorithm and same encoding as `ingestFile`'s, deliberately: the two are
 * compared as an integrity check on the pair.
 */
export function sha256OfFile(sourcePath) {
  if (!existsSync(sourcePath)) {
    throw new IncidentFileError(`no such file: ${sourcePath}`, { code: "no-file" });
  }
  return createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
}

/** Absolute path for a stored relative path. */
export const resolveQuarantined = (rel, { root = quarantineRoot() } = {}) =>
  rel ? path.join(root, rel) : null;

// ─── Treatment ──────────────────────────────────────────────────────────────

/**
 * Grade a quarantined file to the house palette.
 *
 * THIS IS STYLE. It makes a clip look like ours and it has no bearing on whether
 * we may use it. Nothing here is an input to that decision, and the comment
 * exists because the opposite reasoning ("we graded it, so it's ours now") is
 * exactly the reasoning this engine forbids.
 *
 * CORRECTED 2026-08-28. This header used to say the clearance decision "was
 * decided in incidentClearance.js before this function could be reached". That
 * was false: nothing in this function reads `status`, and treatment is reachable
 * on a candidate at any point in the machine, including one that has not been
 * verified. A comment asserting an ordering the code does not enforce is exactly
 * the kind of claim this engine must not make about rights.
 *
 * The ordering is NOT enforced here, deliberately. Treating a file while a grant
 * is still pending is legitimate — the operator wants to see how it will look
 * before deciding whether to chase the poster — and gating treatment on
 * clearance would forbid that for no gain. What IS enforced, and what makes the
 * gap harmless, sits one layer down: `toRenderable` calls `assertRenderable`, so
 * a treated file belonging to an uncleared, untapped or revoked candidate cannot
 * reach the assembler. Treatment produces bytes; only that gate produces pixels
 * in a video.
 *
 * NO GENERATIVE MOTION, EVER. See buildIncidentFilter below.
 */
export async function treatFile(candidateId, relPath, { root = quarantineRoot(), ffmpegPath = null, timeoutMs = 120_000 } = {}) {
  const src = path.join(root, relPath);
  if (!existsSync(src)) throw new IncidentFileError(`no such file: ${src}`, { code: "no-file" });

  const ff = ffmpegPath || getFFmpegPath();
  if (!ff) throw new IncidentFileError("ffmpeg not available", { code: "no-ffmpeg" });

  const outRel = `${candidateId}-treated.mp4`;
  const out = path.join(root, outRel);

  const args = [
    "-y", "-loglevel", "error", "-i", src,
    "-vf", buildIncidentFilter(),
    "-an",                                  // audio is never used: the narration is ours
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    out,
  ];

  await new Promise((resolve, reject) => {
    const proc = spawn(ff, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => { proc.kill("SIGKILL"); reject(new IncidentFileError(`treat timed out after ${timeoutMs}ms`, { code: "timeout" })); }, timeoutMs);
    proc.stderr.on("data", (d) => { stderr += d.toString().slice(0, 2000); });
    proc.on("error", (e) => { clearTimeout(timer); reject(new IncidentFileError(e.message, { code: "spawn-failed" })); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new IncidentFileError(`ffmpeg exited ${code}: ${stderr.trim().slice(0, 300)}`, { code: "ffmpeg-failed" }));
      resolve();
    });
  });

  if (!existsSync(out) || statSync(out).size < 1000) {
    throw new IncidentFileError("treated output is missing or implausibly small", { code: "bad-output" });
  }
  // The source is never overwritten — migration 035's header explains why.
  logger.info(`🎥 incident: treated ${relPath} → ${outRel} (style only; treatment does not affect rights)`);
  return { relPath: outRel, absPath: out, bytes: statSync(out).size };
}

/**
 * The filter chain for incident media.
 *
 * NO GENERATIVE MOTION ON REAL NEWS IMAGERY — enforced here, and this comment is
 * the enforcement's explanation rather than decoration.
 *
 * What is permitted is grading, which changes how a real frame LOOKS. What is
 * forbidden is anything that manufactures movement or content that was not in
 * the original: frame interpolation (`minterpolate`), optical flow, AI upscalers,
 * and any synthesis filter. A Ken Burns pan across a real photograph is a camera
 * move over a real image and is fine — it shows the viewer part of something
 * that was actually photographed. Fabricated motion attached to a real event is
 * a different claim: it puts movement on screen that never happened, in a
 * context where the viewer has every reason to read it as footage.
 *
 * The chain is built here, in one place, so there is exactly one filter string
 * for incident media and a reviewer can read all of it at once.
 */
export function buildIncidentFilter() {
  return [
    // Deinterlace only if the source is interlaced; a no-op otherwise.
    "yadif=deint=interlaced",
    // INCIDENT_GRADE, not LIBRARY_GRADE. Eyewitness footage is graded lighter
    // than curated stock — see videoHouseGrade.js for why, and for the fact that
    // these numbers have not yet been validated against real footage.
    INCIDENT_GRADE,
    "format=yuv420p",
  ].join(",");
}

/** Filters that fabricate motion or content. None may appear in the chain. */
export const FORBIDDEN_FILTERS = Object.freeze([
  "minterpolate", "framerate=", "tblend", "mix=", "deflicker",
  "sr=", "dnn_processing", "vidstab", "nlmeans",
]);

/**
 * Prove the chain fabricates nothing.
 *
 * A comment saying "no generative motion" is a comment. This is the check, and
 * it is called by the test suite against the real chain — so adding an
 * interpolating filter fails the build rather than shipping quietly.
 */
export function assertNoFabricatedMotion(chain = buildIncidentFilter()) {
  const found = FORBIDDEN_FILTERS.filter((f) => String(chain).includes(f));
  if (found.length) {
    throw new IncidentFileError(
      `the incident filter chain contains ${found.join(", ")}, which fabricate motion or content not present in ` +
      "the original. Ken Burns over a real photograph is a camera move over a real image; interpolated or " +
      "synthesised motion attached to a real event puts something on screen that never happened.",
      { code: "fabricated-motion" }
    );
  }
  return true;
}

// ─── The sweeper ────────────────────────────────────────────────────────────

/**
 * Delete quarantined bytes that are no longer needed.
 *
 * Returns { deleted, bytes, kept, skipped } — count AND bytes, so "it ran" and
 * "it did something" are distinguishable, which is cardSweep's third safety
 * property and the one that makes a silent sweep detectable.
 */
export function sweep(db, { root = quarantineRoot(), now = Date.now(), cap = SWEEP_CAP, dryRun = false } = {}) {
  if (!existsSync(root)) return { deleted: 0, bytes: 0, kept: 0, skipped: 0, unparseable: 0 };

  let deleted = 0, bytes = 0, kept = 0, skipped = 0, unparseable = 0;

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (deleted >= cap) { skipped++; continue; }

    const parsed = parseQuarantineName(entry.name);
    if (!parsed) {
      // Somebody else's file. Counted, never guessed at.
      unparseable++;
      continue;
    }

    const row = db.prepare("SELECT status, updated_at FROM media_candidates WHERE id = ?").get(parsed.candidateId);
    const abs = path.join(root, entry.name);

    // ORPHANED: no row at all. Provably dead — nothing can ever reference it.
    let doomed = !row;
    if (row && SWEEP_IMMEDIATELY.has(row.status)) doomed = true;
    if (row && SWEEP_WHEN_STALE.has(row.status)) {
      doomed = (now - (row.updated_at || 0)) > UNDECIDED_RETENTION_MS;
    }

    if (!doomed) { kept++; continue; }

    let size = 0;
    try { size = statSync(abs).size; } catch { /* vanished under us; fine */ }
    if (!dryRun) {
      try { rmSync(abs, { force: true }); } catch (err) {
        logger.warn(`🎥 incident sweep: could not delete ${entry.name} (${err.message.slice(0, 80)})`);
        continue;
      }
    }
    deleted++; bytes += size;
  }

  const verb = dryRun ? "would delete" : "deleted";
  logger.info(
    `🎥 incident sweep: ${verb} ${deleted} file(s), ${(bytes / 1e6).toFixed(1)} MB; ` +
    `kept ${kept}, skipped ${skipped} (cap ${cap}), ${unparseable} unrecognised file(s) left alone`
  );
  return { deleted, bytes, kept, skipped, unparseable };
}
