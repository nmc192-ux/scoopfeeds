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
  buildFilterChain, coolGrade, COOL_BLUE_MIDS, COOL_BLUE_SHADOWS, DELIVERY, GRAIN_CHAINS,
  isDeliveryAspect, LIBRARY_CRF, LIBRARY_GRADE, resolveFfmpeg, treatFile,
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
    "-i", `testsrc=size=216x384:rate=10:duration=${seconds}`,
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

// ─── Grain (removed everywhere, 2026-09-03) ─────────────────────────────────

test("grain is absent, and there is no option that puts it back", () => {
  assert.deepEqual(Object.keys(GRAIN_CHAINS), ["none"], "static14 was deleted, not defaulted away");
  assert.equal(GRAIN_CHAINS.none, "");
  assert.ok(!buildFilterChain().includes("noise="), "the library master is grade-only");
  assert.ok(!buildFilterChain("none").includes("noise="));
});

test("the retired grain option is refused by name, not silently dropped", () => {
  // Named explicitly: someone reading the old brief or an old shell history
  // will type this, and a loud refusal is how they learn it was decided against
  // rather than mislaid.
  assert.throws(() => buildFilterChain("static14"), /unknown grain option/);
  assert.throws(() => buildFilterChain("heavy"), /unknown grain option/);
});

test("the chain ends in a pixel format ffmpeg and every player agree on", () => {
  assert.ok(buildFilterChain().endsWith("format=yuv420p"));
  assert.ok(buildFilterChain("none").endsWith("format=yuv420p"));
});

// ─── Delivery resolution and the encode ─────────────────────────────────────

test("the chain scales to the delivery frame, and scales BEFORE it grades", () => {
  // Grading fewer pixels is identical in result and cheaper, and it keeps the
  // vignette sized to the frame that ships rather than to the master's.
  const chain = buildFilterChain();
  assert.match(chain, /^scale=1080:1920:flags=lanczos,/);
  assert.ok(chain.indexOf("scale=") < chain.indexOf("eq=saturation"), "scale precedes the grade");
  assert.equal(DELIVERY.width, 1080);
  assert.equal(DELIVERY.height, 1920);
});

test("the downscale is ONE pass — the grade and the resize share an encode", () => {
  // A second encode to resize would decode and re-encode the graded output,
  // paying quality for nothing.
  const chain = buildFilterChain();
  assert.equal((chain.match(/scale=/g) || []).length, 1, "exactly one scale in the chain");
});

test("the encode quality is the measured value, not the original 18", () => {
  // crf 18 is finer than a typical provider delivery encode, so re-encoding an
  // already-compressed clip spent bits on its artefacts — ships-0008 GREW on
  // treatment, 160.5 MB -> 192.0 MB. The value and its measurement are recorded
  // beside LIBRARY_CRF; this pins that a future edit is deliberate.
  assert.equal(LIBRARY_CRF, "20");
  assert.notEqual(LIBRARY_CRF, "18", "the growth case is the whole reason this moved");
});

test("only the delivery aspect is a straight scale", () => {
  assert.equal(isDeliveryAspect(2160, 3840), true, "the library's own master shape");
  assert.equal(isDeliveryAspect(1080, 1920), true);
  for (const [w, h] of [[1920, 1080], [1080, 1080], [3840, 2160], [0, 0], [1080, 0]]) {
    assert.equal(isDeliveryAspect(w, h), false, `${w}x${h} is not 9:16`);
  }
});

test("a non-portrait source is REFUSED, never stretched or cropped", async () => {
  // Scaling it would distort the picture and cropping it would silently reframe
  // somebody else's shot. Reframing is a curation decision, not one to make here.
  const dir = tmpDir();
  const src = makeClip(dir);
  await assert.rejects(
    () => treatFile({
      sourcePath: src, outputPath: path.join(dir, "out.mp4"), ffmpegPath: FFMPEG,
      sourceWidth: 1920, sourceHeight: 1080,
    }),
    /not the 1080x1920 delivery aspect/
  );
});

test("a 4K portrait master comes out at the delivery frame, and much smaller", async () => {
  const dir = tmpDir();
  const master = path.join(dir, "master4k.mp4");
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "lavfi",
    "-i", "testsrc2=size=2160x3840:rate=25:duration=1", "-c:v", "libx264",
    "-crf", "23", "-pix_fmt", "yuv420p", master]);
  const out = path.join(dir, "treated.mp4");

  const { bytes } = await treatFile({
    sourcePath: master, outputPath: out, ffmpegPath: FFMPEG,
    sourceWidth: 2160, sourceHeight: 3840,
  });

  assert.match(probeVideoLine(out), /1080x1920/);
  assert.ok(bytes < statSync(master).size,
    `the treated file must be smaller than its master: ${bytes} vs ${statSync(master).size}`);
  assert.ok(existsSync(master), "and the master is untouched — it is the re-treat source");
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
  assert.match(probeVideoLine(out), /1080x1920/,
    "treatment now writes the delivery frame, not the master's resolution");
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

test("a treated master carries no grain, whatever it was asked for", async () => {
  const dir = tmpDir();
  const src = makeClip(dir);
  const plain = path.join(dir, "plain.mp4");
  await treatFile({ sourcePath: src, outputPath: plain, grain: "none", ffmpegPath: FFMPEG });
  assert.ok(statSync(plain).size > 0);
  await assert.rejects(
    treatFile({ sourcePath: src, outputPath: path.join(dir, "grainy.mp4"), grain: "static14", ffmpegPath: FFMPEG }),
    /unknown grain option/,
    "the retired option must fail before ffmpeg runs, not produce a grained master"
  );
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
