/**
 * treat.test.mjs — the house grade, the cooling fix, and the source file's safety.
 *
 * Run: cd backend && node --test "scripts/lib/stock/*.test.mjs"
 *
 * The tests that matter here are the two that cost something if they fail:
 * the treated rendition must never be written over the source download (the
 * provider clip is the only untreated copy we hold, and re-acquiring means
 * spending free-tier quota on a clip a human already approved), and the library
 * grade must remain the house grade plus one documented change rather than
 * drifting into a second, private palette.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { GRADES } from "../../../src/services/longform/storyboardInterpreter.js";
import {
  buildFilterChain, coolGrade, COOL_BLUE_MIDS, COOL_BLUE_SHADOWS, GRAIN_CHAINS, LIBRARY_GRADE,
  resolveFfmpeg, treatFile,
} from "./treat.mjs";

const dirs = [];
const tmpDir = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "stocktreat-"));
  dirs.push(d);
  return d;
};
test.after(() => {
  for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

const FFMPEG = resolveFfmpeg();

/** A tiny real clip, so the treatment is exercised rather than described. */
function makeClip(dir, name = "source.mp4", seconds = 1) {
  const file = path.join(dir, name);
  execFileSync(FFMPEG, [
    "-y", "-loglevel", "error", "-f", "lavfi",
    "-i", `testsrc=size=320x240:rate=10:duration=${seconds}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", file,
  ]);
  return file;
}

// ─── The cooling fix ────────────────────────────────────────────────────────

test("the library grade is the HOUSE grade — it differs only in the blue terms", () => {
  // If this fails, either the house palette moved (and the library should follow)
  // or someone has started a second palette here. Both are worth stopping for.
  const house = GRADES.default;
  const normalise = (chain) => chain.replace(/\bbs=-?[\d.]+/, "bs=X").replace(/\bbm=-?[\d.]+/, "bm=X");
  assert.equal(normalise(LIBRARY_GRADE), normalise(house),
    "saturation, contrast, gamma and vignette must be untouched — the fix is one line");
  assert.notEqual(LIBRARY_GRADE, house, "but the blue terms must actually have changed");
});

test("the olive cast is corrected by taking blue positive in shadows and midtones", () => {
  // The house default pulls blue DOWN in both bands while lifting green, which is
  // arithmetically an olive cast. `marine` in the same file is already the cool
  // version of this chain, and supplies the coefficients.
  assert.match(GRADES.default, /bs=-0\.08/, "the house default pulls shadow blue down");
  assert.match(GRADES.default, /bm=-0\.06/, "and midtone blue too");
  assert.match(LIBRARY_GRADE, new RegExp(`bs=${COOL_BLUE_SHADOWS}`));
  assert.match(LIBRARY_GRADE, new RegExp(`bm=${COOL_BLUE_MIDS}`));
  assert.ok(Number(COOL_BLUE_SHADOWS) > 0 && Number(COOL_BLUE_MIDS) > 0, "both must be lifts, not smaller cuts");
});

test("cooling a chain touches nothing but the two blue coefficients", () => {
  const before = "eq=saturation=0.5,colorbalance=rs=-0.06:gs=0.02:bs=-0.08:rm=-0.03:gm=0.03:bm=-0.06,vignette=PI/4";
  const after = coolGrade(before);
  assert.match(after, /rs=-0\.06/);
  assert.match(after, /gs=0\.02/);
  assert.match(after, /gm=0\.03/);
  assert.match(after, /vignette=PI\/4/);
  assert.match(after, /eq=saturation=0\.5/);
});

// ─── Grain (Q1: off by default) ─────────────────────────────────────────────

test("grain is absent unless asked for", () => {
  assert.equal(GRAIN_CHAINS.none, "");
  assert.ok(!buildFilterChain().includes("noise="), "the default library master is grade-only");
  assert.ok(!buildFilterChain("none").includes("noise="));
});

test("static-14 grain is the measured treatment, and stays static", () => {
  const chain = buildFilterChain("static14");
  assert.match(chain, /noise=alls=14:allf=u:all_seed=20260814/);
  assert.ok(!chain.includes("allf=t"), "temporal grain cost 4x the encode time — never substitute it");
});

test("an unknown grain option is refused rather than silently dropped", () => {
  assert.throws(() => buildFilterChain("heavy"), /unknown grain option/);
});

test("the chain ends in a pixel format ffmpeg and every player agree on", () => {
  assert.ok(buildFilterChain("static14").endsWith("format=yuv420p"));
});

// ─── The source download is never overwritten ───────────────────────────────

test("treating a file onto itself is refused", async () => {
  const dir = tmpDir();
  const src = makeClip(dir);
  await assert.rejects(
    () => treatFile({ sourcePath: src, outputPath: src, ffmpegPath: FFMPEG }),
    /never overwritten/
  );
});

test("a missing source is named, not silently skipped", async () => {
  const dir = tmpDir();
  await assert.rejects(
    () => treatFile({ sourcePath: path.join(dir, "nope.mp4"), outputPath: path.join(dir, "out.mp4"), ffmpegPath: FFMPEG }),
    /source missing/
  );
});

test("the source download survives treatment byte for byte", async () => {
  const dir = tmpDir();
  const src = makeClip(dir);
  const before = readFileSync(src);
  const out = path.join(dir, "treated.mp4");

  const result = await treatFile({ sourcePath: src, outputPath: out, ffmpegPath: FFMPEG });

  assert.equal(result.treated, true);
  assert.ok(result.bytes > 0);
  assert.ok(existsSync(out), "a treated file must actually exist");
  assert.deepEqual(readFileSync(src), before, "the untreated original is the only one we hold");
});

test("the treated rendition is a real, different video — not a copy", async () => {
  const dir = tmpDir();
  const src = makeClip(dir);
  const out = path.join(dir, "treated.mp4");
  await treatFile({ sourcePath: src, outputPath: out, ffmpegPath: FFMPEG });

  assert.notDeepEqual(readFileSync(out), readFileSync(src), "the grade must have been applied");
  // It must still be a decodable video, not merely a non-empty file. `ffmpeg -i`
  // with no output exits non-zero and prints to stderr, so the output is read
  // rather than the exit code — the same handling longformMeasure.js uses.
  assert.match(probeVideoLine(out), /320x240/, "the grade must not have resized anything");
});

/** The `Video:` line ffmpeg prints for a file, however it chooses to exit. */
function probeVideoLine(file) {
  try {
    const { stderr } = execFileSync(FFMPEG, ["-hide_banner", "-i", file], { encoding: "utf8" });
    return String(stderr || "");
  } catch (e) {
    return String(e.stderr || e.stdout || "");
  }
}

test("treatment is repeatable — running it twice lands in the same place", async () => {
  // stock-treat skips entries that already have a treatedPath; --only re-runs
  // them. Either way a second pass must not fail or damage anything.
  const dir = tmpDir();
  const src = makeClip(dir);
  const out = path.join(dir, "treated.mp4");
  const first = await treatFile({ sourcePath: src, outputPath: out, ffmpegPath: FFMPEG });
  const second = await treatFile({ sourcePath: src, outputPath: out, ffmpegPath: FFMPEG });
  assert.equal(second.treated, true);
  assert.equal(second.bytes, first.bytes, "the same input and grade must produce the same output size");
  assert.ok(existsSync(src), "and the source is still there");
});

test("a grain run produces a different master from a grade-only run", async () => {
  const dir = tmpDir();
  const src = makeClip(dir);
  const plain = path.join(dir, "plain.mp4");
  const grainy = path.join(dir, "grainy.mp4");
  await treatFile({ sourcePath: src, outputPath: plain, grain: "none", ffmpegPath: FFMPEG });
  const g = await treatFile({ sourcePath: src, outputPath: grainy, grain: "static14", ffmpegPath: FFMPEG });
  assert.ok(g.bytes > statSync(plain).size,
    "grain is detail: it costs bytes, which is the Q1 argument for leaving it to render time");
});

// ─── ffmpeg resolution ──────────────────────────────────────────────────────

test("ffmpeg is resolvable without adding a dependency", () => {
  assert.ok(FFMPEG, "@ffmpeg-installer/ffmpeg is already a backend dependency");
  assert.ok(existsSync(FFMPEG), `resolved to a real binary: ${FFMPEG}`);
});

test("FFMPEG_PATH wins when it is set", () => {
  const real = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = "/custom/ffmpeg";
  try {
    assert.equal(resolveFfmpeg(), "/custom/ffmpeg");
  } finally {
    if (real === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = real;
  }
});
