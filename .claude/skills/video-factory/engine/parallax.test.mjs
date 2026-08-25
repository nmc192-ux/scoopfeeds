// parallax.test.mjs — the two-layer parallax shot, tested against real ffmpeg.
//
// Run:  node --test .claude/skills/video-factory/engine/parallax.test.mjs
//
// Not a string test: fixture images (background + alpha cutout) are rendered
// with resvg, composited through the ACTUAL filter graph by the ACTUAL ffmpeg,
// and the output is probed. The motion assertion extracts the first and last
// frames and requires them to differ — a filter that "works" but produces a
// static composite is a failure, because motion is the entire point.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { dep, ffmpegPath } from "./_deps.mjs";
import { parallaxFilter, validateParallax, DX_DEFAULT } from "./parallax.mjs";

const { Resvg } = dep("@resvg/resvg-js");
const execFileP = promisify(execFile);
const TMP = mkdtempSync(path.join(os.tmpdir(), "parallax-"));
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 16);
const ff = (args) => execFileP(ffmpegPath, ["-y", "-nostdin", "-hide_banner", "-loglevel", "error", ...args]);

const png = (name, svg) => {
  const f = path.join(TMP, name);
  writeFileSync(f, new Resvg(svg).render().asPng());
  return f;
};

// Background: a gradient with a landmark stripe, so zoom is visible.
const BG = png("bg.png", `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#12222c"/><stop offset="1" stop-color="#090706"/></linearGradient></defs>
<rect width="640" height="360" fill="url(#g)"/>
<rect x="300" y="0" width="8" height="360" fill="#dde706"/></svg>`);

// Foreground: a cutout WITH ALPHA — the transparent ground is the point.
const FG = png("fg.png", `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300">
<circle cx="100" cy="80" r="60" fill="#f5f2ea"/>
<rect x="60" y="140" width="80" height="160" fill="#f5f2ea"/></svg>`);

const FPS = 12, SECONDS = 2, FRAMES = FPS * SECONDS;
// A miniature of the house chain: cover-scale, slow zoom, normalise. The real
// build passes kenFilter(...) verbatim — parallaxFilter treats it as opaque.
const KEN = `scale=2560:1440:force_original_aspect_ratio=increase,crop=2560:1440,`
  + `zoompan=z='min(1.0+(0.16/${FRAMES})*on,1.16)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`
  + `:d=${FRAMES}:s=1920x1080:fps=${FPS},format=yuv420p`;

test("a parallax shot renders, is the right shape, and actually moves", async () => {
  const out = path.join(TMP, "shot.mp4");
  const filter = parallaxFilter({ kenChain: KEN, frames: FRAMES, seconds: SECONDS });
  await ff([
    "-loop", "1", "-framerate", String(FPS), "-i", BG,
    "-loop", "1", "-framerate", String(FPS), "-i", FG,
    "-filter_complex", filter, "-map", "[v]", "-an", "-t", String(SECONDS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-r", String(FPS), out,
  ]);

  // Shape: 1920x1080, ~2s.
  const probe = await execFileP(ffmpegPath, ["-hide_banner", "-i", out]).catch((e) => e);
  const meta = String(probe.stderr || "");
  assert.match(meta, /1920x1080/, "output must be full-frame 1920x1080");
  const dur = /Duration: 00:00:0(\d\.\d+)/.exec(meta);
  assert.ok(dur && Math.abs(parseFloat(dur[1]) - SECONDS) < 0.3, `duration ~${SECONDS}s, got: ${dur?.[1]}`);

  // Motion: first and last frames must differ — bg zooms, fg drifts.
  const f0 = path.join(TMP, "f0.png"), f1 = path.join(TMP, "f1.png");
  await ff(["-i", out, "-vf", "select=eq(n\\,0)", "-frames:v", "1", f0]);
  await ff(["-i", out, "-vf", `select=eq(n\\,${FRAMES - 2})`, "-frames:v", "1", f1]);
  assert.notEqual(sha(f0), sha(f1), "first and last frames identical — the parallax is static");
});

test("dx direction and anchor land in the filter graph", () => {
  const f = parallaxFilter({ kenChain: KEN, frames: 24, seconds: 2, dx: -120, anchor: "center" });
  assert.match(f, /-?\(W-w\)\/2-−?-60\.0|\(W-w\)\/2--60\.0/, "centred drift offset for dx=-120");
  assert.match(f, /y='\(H-h\)\/2'/, "center anchor");
  const g = parallaxFilter({ kenChain: KEN, frames: 24, seconds: 2 });
  assert.match(g, new RegExp(`\\+${DX_DEFAULT}\\*n/24`), "default drift rate");
  assert.match(g, /y='H-h'/, "default bottom anchor");
});

test("validateParallax rejects the beats that would fail an hour into a render", () => {
  assert.deepEqual(validateParallax({ photo: "P_X", parallax: { fg: "P_CUT" } }), []);
  assert.match(validateParallax({ parallax: { fg: "P_CUT" } }).join(";"), /needs a `photo`/);
  assert.match(validateParallax({ photo: "P_X", footage: "F_Y", parallax: { fg: "P_CUT" } }).join(";"), /cannot run over footage/);
  assert.match(validateParallax({ photo: "P_X", parallax: {} }).join(";"), /fg .* required/);
  assert.match(validateParallax({ photo: "P_X", parallax: { fg: "P_CUT", anchor: "top" } }).join(";"), /anchor/);
});
