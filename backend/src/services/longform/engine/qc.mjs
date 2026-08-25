// Quality gates. Measures the film and the Shorts, prints PASS/FAIL per gate.
//
//   node engine/qc.mjs out/film-scored.mp4
//
// EVERY NUMBER HERE IS MEASURED FROM THE ARTIFACT. Nothing is inferred from the
// build plan, because the point of this script is to catch the case where the
// plan and the artifact disagree. A gate we could not measure prints UNVERIFIED
// and counts as a failure to report, never as a pass — unmeasured is not
// passing (docs/agentic-workflow.md §5).
//
// Thresholds and their provenance are in references/quality-gates.md.

import { readFileSync, existsSync, readdirSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { createRequire } from "module";
import path from "path";
import { ffmpegPath } from "./_deps.mjs";

const FFMPEG = ffmpegPath;
const execFileP = promisify(execFile);

const FILM = process.argv[2];
if (!FILM || !existsSync(FILM)) {
  console.error("usage: node engine/qc.mjs <film.mp4>   (path must exist)");
  process.exit(1);
}
const DIR = path.dirname(FILM);

const ff = async (args) => {
  // -nostdin is not optional: ffmpeg consumes stdin and silently eats lines
  // from any surrounding read loop, which once produced a completely false
  // diagnosis of out-of-order segments.
  try {
    const { stdout, stderr } = await execFileP(FFMPEG, ["-nostdin", "-hide_banner", ...args],
      { maxBuffer: 1 << 28 });
    return stdout + stderr;
  } catch (e) { return (e.stdout || "") + (e.stderr || ""); }
};

const rows = [];
const info = [];
const gate = (name, ok, actual, target) =>
  rows.push({ name, ok, actual: String(actual), target });
const UNVERIFIED = Symbol("unverified");

// ── audio: loudness, true peak, clipping ─────────────────────────────────
{
  const out = await ff(["-i", FILM, "-af", "loudnorm=print_format=json", "-f", "null", "-"]);
  const m = out.match(/\{[\s\S]*?"input_tp"[\s\S]*?\}/);
  if (m) {
    const j = JSON.parse(m[0]);
    const lufs = parseFloat(j.input_i), tp = parseFloat(j.input_tp);
    gate("integrated loudness", Math.abs(lufs + 14) <= 1.5, `${lufs.toFixed(2)} LUFS`, "-14 ±1.5");
    // Informational, NOT a gate. This measures the DECODED AAC, and lossy
    // decode legitimately overshoots the encoder's input peak — a correctly
    // mastered file (pre-encode peak -0.588 dB) read +2.09 dBTP here and failed
    // a gate it should never have been subject to. Clipping is judged by flat
    // factor below; this line is context, not a verdict.
    info.push(["true peak (decoded AAC — overshoot is normal)", `${tp.toFixed(2)} dBTP`]);
  } else {
    gate("integrated loudness", false, "UNVERIFIED", "-14 ±1.5");
  }

  const astats = await ff(["-i", FILM, "-af", "astats=metadata=1:reset=0", "-f", "null", "-"]);
  const flat = [...astats.matchAll(/Flat factor:\s*([\d.]+)/g)].map((x) => parseFloat(x[1]));
  const worstFlat = flat.length ? Math.max(...flat) : null;
  // THIS is the real clipping gate. Flat factor counts consecutive samples
  // pinned at the same extreme value, i.e. actual clipping in the decoded
  // audio. It is the number to trust.
  gate("clipping (flat factor)", worstFlat !== null && worstFlat === 0,
    worstFlat === null ? "UNVERIFIED" : worstFlat.toFixed(3), "0.000");

  // Stereo width: a mono bed measured -91 dB on the side channel and sounded
  // dead. Side = (L-R)/2, so we can measure it directly.
  const side = await ff(["-i", FILM, "-af",
    "aeval=val(0)-val(1)|val(0)-val(1),volumedetect", "-f", "null", "-"]);
  const mean = side.match(/mean_volume:\s*(-?[\d.]+) dB/);
  gate("stereo side channel", mean ? parseFloat(mean[1]) > -60 : false,
    mean ? `${mean[1]} dB` : "UNVERIFIED", "> -60 dB");
}

// ── shot rhythm, from the shot list build.mjs emitted ───────────────────
{
  const shotsFile = path.join(DIR, "shots.json");
  if (!existsSync(shotsFile)) {
    // Deliberately UNVERIFIED, not FAIL. Inferring shots from SRT cue spacing
    // measures beats and produces a confidently wrong number.
    gate("median shot length", false, "UNVERIFIED (no out/shots.json — rebuild)", "<= 6s");
    gate("shots under 2s", false, "UNVERIFIED (no out/shots.json — rebuild)", ">= 8%");
  } else {
    const lens = JSON.parse(readFileSync(shotsFile, "utf8"))
      .map((s) => s.seconds).filter((x) => x > 0).sort((a, b) => a - b);
    const med = lens[Math.floor(lens.length / 2)];
    const under2 = lens.filter((x) => x < 2).length / lens.length;
    gate("median shot length", med <= 6, `${med.toFixed(2)}s (${lens.length} shots)`, "<= 6s");
    gate("shots under 2s", under2 >= 0.08, `${(under2 * 100).toFixed(1)}%`, ">= 8%");
  }
}

// ── Shorts ───────────────────────────────────────────────────────────────
{
  const sd = path.join(DIR, "shorts");
  if (!existsSync(sd)) {
    gate("shorts duration", false, "UNVERIFIED (no shorts/)", "< 59s");
  } else {
    // GATE WHAT WILL BE PUBLISHED, NOT WHAT IS LYING IN THE DIRECTORY.
    // This used to glob shorts/*.mp4, so Shorts from an earlier cut — renamed
    // or dropped since — were still counted and still measured. A run that cut
    // 5 reported 8, and "longest 42.5s" described a file that no longer
    // belonged to the film. Stale cuts are also reported, because a leftover
    // named like a current one is how the wrong video gets uploaded.
    const declared = existsSync(path.join(DIR, "..", "shorts.json"))
      ? JSON.parse(readFileSync(path.join(DIR, "..", "shorts.json"), "utf8")).map((x) => `${x.name}.mp4`)
      : null;
    const present = readdirSync(sd).filter((f) => /^\d.*\.mp4$/.test(f));
    const files = declared ? declared.filter((f) => present.includes(f)) : present;
    const missing = declared ? declared.filter((f) => !present.includes(f)) : [];
    const stale = declared ? present.filter((f) => !declared.includes(f)) : [];
    let worst = 0, bad = [];
    for (const f of missing) bad.push(`${f} DECLARED BUT NOT CUT`);
    for (const f of files) {
      const o = await ff(["-i", path.join(sd, f)]);
      const m = o.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      const d = m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : 0;
      if (d > worst) worst = d;
      if (d >= 59 || d === 0) bad.push(`${f}=${d}s`);
      const dim = o.match(/,\s*(\d+)x(\d+)/);
      if (dim && !(dim[1] === "1080" && dim[2] === "1920")) bad.push(`${f} is ${dim[1]}x${dim[2]}`);
    }
    gate("shorts count", files.length >= 3 && missing.length === 0,
      declared ? `${files.length} of ${declared.length} declared` : String(files.length), ">= 3");
    if (stale.length) {
      console.log(`        note: ${stale.length} file(s) in shorts/ are not in shorts.json and were ignored — ${stale.join(", ")}`);
    }
    gate("shorts duration + 1080x1920", bad.length === 0,
      bad.length ? bad.join(", ") : `longest ${worst.toFixed(1)}s`, "< 59s, 9:16");
  }
}

// ── report ───────────────────────────────────────────────────────────────
const w = Math.max(...rows.map((r) => r.name.length));
console.log(`\nQC — ${path.basename(FILM)}\n`);
for (const r of rows) {
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(w)}  ${r.actual.padEnd(22)} target ${r.target}`);
}
if (info.length) {
  console.log("\n  context (not gates):");
  for (const [k, v] of info) console.log(`        ${k}: ${v}`);
}
const failed = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} gates pass`);
if (failed.length) {
  console.log("\nNOT SHIPPABLE until these are resolved or explicitly waived by DrJ:");
  for (const f of failed) console.log(`  • ${f.name}: ${f.actual} (want ${f.target})`);
  process.exitCode = 1;
}
console.log("\nNOT MEASURED HERE — check by eye or by the build log:");
console.log("  • unreadable cards and text-card interruptions (build.mjs reports both)");
console.log("  • thumbnail legibility at 168px (render it small and look)");
console.log("  • whether the opening 15 seconds actually earn the next 15");
