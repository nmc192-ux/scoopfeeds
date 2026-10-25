/**
 * credit.js - make the copy of a clip that can air, with its credit burned into every frame (#219).
 *
 * Acceptance criterion 2: "Every aired clip shows its credit on screen for the whole time it plays."
 * We do not rely on the playout or the screen to draw the credit: the credit is part of the picture of
 * the air copy itself, drawn by a drawtext filter with NO enable window, on a copy cut to at most
 * MAX_CLIP_SECONDS. Whatever part of the air copy plays, the credit is in it.
 *
 * The air copy is what the content-safety gate (#218) checks and clears, so the clearance covers the
 * exact bytes that go to air. A sidecar <air>.credit.json binds the credit text to the file's SHA-256;
 * the insert queue refuses an air copy whose sidecar is missing or does not match.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileFingerprint } from "../safety/contentSafety.js";
import { MAX_CLIP_SECONDS } from "../live/socialClips.js";

const FFMPEG = () => process.env.FFMPEG_PATH || "ffmpeg";

export const creditSidecarPath = (file) => `${file}.credit.json`;

/** drawtext reads the credit from a file, so no character in it needs escaping or can break the filter. */
export function creditFilter(textFile, { fontFile = process.env.RADIO_CREDIT_FONT || null } = {}) {
  const esc = (p) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const font = fontFile ? `fontfile='${esc(fontFile)}':` : "";
  // Scale first so the text size is the same on every source; pad to 16:9 1280x720.
  return [
    "scale=1280:720:force_original_aspect_ratio=decrease",
    "pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black",
    "setsar=1",
    `drawtext=${font}textfile='${esc(textFile)}':fontsize=30:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=12:x=36:y=h-th-48`,
  ].join(",");
}

export function buildAirCopyArgs(src, out, textFile, { playSec, startSec = 0, hasAudio = true, fontFile } = {}) {
  const sec = Math.min(Number(playSec) || MAX_CLIP_SECONDS, MAX_CLIP_SECONDS);
  return [
    "-hide_banner", "-nostats", "-y",
    "-ss", String(Math.max(0, startSec)), "-t", String(sec), "-i", src,
    "-vf", creditFilter(textFile, { fontFile }),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
    ...(hasAudio ? ["-c:a", "aac", "-b:a", "160k", "-ar", "48000"] : ["-an"]),
    "-t", String(sec),
    "-movflags", "+faststart",
    "-map_metadata", "-1",
    out,
  ];
}

/**
 * Render the air copy. Returns the sidecar record. Throws if ffmpeg fails or the credit is empty.
 * `-map_metadata -1` drops the sender's location and device tags from the copy that airs (privacy);
 * the original keeps them for verification only.
 */
export function renderAirCopy(src, out, credit, { playSec, startSec = 0, hasAudio = true, fontFile } = {}) {
  const text = String(credit || "").trim();
  if (!text) throw new Error("an air copy needs a credit");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "credit-"));
  const textFile = path.join(tmpDir, "credit.txt");
  fs.writeFileSync(textFile, text);
  try {
    fs.rmSync(creditSidecarPath(out), { force: true });
    const r = spawnSync(FFMPEG(), buildAirCopyArgs(src, out, textFile, { playSec, startSec, hasAudio, fontFile }), { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`ffmpeg air copy failed: ${(r.stderr || "").slice(-400)}`);
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
  const rec = { credit: text, burnedIn: true, wholeDuration: true, capSec: MAX_CLIP_SECONDS, ...fileFingerprint(out) };
  fs.writeFileSync(creditSidecarPath(out), JSON.stringify(rec, null, 1) + "\n");
  return rec;
}

/** Does the air copy carry a burned-in credit that matches its bytes? { ok, why, credit } */
export function hasBurnedCredit(file) {
  if (!file || !fs.existsSync(file)) return { ok: false, why: "air copy missing" };
  const p = creditSidecarPath(file);
  if (!fs.existsSync(p)) return { ok: false, why: "no burned-in credit record" };
  let rec;
  try { rec = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return { ok: false, why: `credit record unreadable: ${e.message}` }; }
  if (rec.burnedIn !== true || rec.wholeDuration !== true || !String(rec.credit || "").trim()) return { ok: false, why: "credit record incomplete" };
  const fp = fileFingerprint(file);
  if (fp.size !== rec.size || fp.sha256 !== rec.sha256) return { ok: false, why: "air copy changed since the credit was burned in" };
  return { ok: true, why: null, credit: rec.credit };
}
