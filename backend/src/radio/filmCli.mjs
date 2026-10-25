#!/usr/bin/env node
/**
 * filmCli.mjs — the radio's ScoopFeeds film library, day plan and rehearsal (#203).
 *
 *   node filmCli.mjs import --file <published.mp4> --series the-invisible-hand --title "..." --published 2026-10-18 [--copy]
 *   node filmCli.mjs import --file <short.mp4> --series a-eye --parent a-eye/ep03 --title "..." --published 2026-10-19
 *                                                           # a Short cut from a long-form film (#216): --parent is required for it to air
 *   node filmCli.mjs list                                   # what the library holds, and what it skipped and why
 *   node filmCli.mjs plan [--day 2026-10-24] [--recent recent.json] [--out plan.json]   # cleared items only (#218)
 *   node filmCli.mjs rehearse --out rehearsal.mp4 [--film <id>] [--short <id> --short <id>]
 *   node filmCli.mjs rehearse --selftest --out selftest.mp4 # synthetic clips with flash+beep markers; measures A/V offset
 *
 * The library root is $RADIO_FILMS_DIR (see filmLibrary.js). Rehearsal writes a FILE only; it never streams.
 * Needs ffmpeg + ffprobe on PATH (FFMPEG_PATH / FFPROBE_PATH override) for import and rehearse.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { execFileSync, spawnSync } from "node:child_process";
import { loadLibrary, importFilm, filmsDir } from "./filmLibrary.js";
import { planDay, defaultSlots, clearedLibrary } from "./filmRotation.js";
import { hasValidClearance } from "./safety/contentSafety.js";
import { buildRehearsalArgs, rehearsalBoundaries, pairMarkers } from "./filmPlayout.js";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

const { positionals, values: v } = parseArgs({
  allowPositionals: true,
  options: {
    file: { type: "string" }, series: { type: "string" }, title: { type: "string" }, published: { type: "string" },
    name: { type: "string" }, copy: { type: "boolean" }, day: { type: "string" }, recent: { type: "string" },
    out: { type: "string" }, film: { type: "string" }, short: { type: "string", multiple: true },
    selftest: { type: "boolean" }, dir: { type: "string" }, parent: { type: "string" },
  },
});
const dir = v.dir || filmsDir();
const cmd = positionals[0];

function probeStreams(file) {
  const out = execFileSync(FFPROBE, ["-v", "error", "-show_entries", "stream=codec_type,duration:format=duration", "-of", "json", file], { encoding: "utf8" });
  const j = JSON.parse(out);
  const vs = j.streams.find((s) => s.codec_type === "video");
  const as = j.streams.find((s) => s.codec_type === "audio");
  const videoSec = Number(vs?.duration ?? j.format?.duration);
  return { videoSec, audioSec: as ? Number(as.duration) : null, hasAudio: !!as };
}

function easternToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function ff(args) {
  const r = spawnSync(FFMPEG, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status}): ${(r.stderr || "").slice(-2000)}`);
  return r.stderr || "";
}

/** Synthetic clips: picture flashes white and a 1 kHz beep sounds at the same instants. Odd shapes on purpose. */
function makeSelftestClips(tmp) {
  const specs = [
    // a 16:9 film, 30 fps, sound exactly as long as picture
    { name: "film.mp4", w: 1920, h: 1080, r: 30, vSec: 30, aSec: 30, ar: 44100, ac: 2, marks: [1, 15, 28] },
    // a vertical Short, 25 fps, sound 0.7 s LONGER than picture (must be trimmed, not carried into the next item)
    { name: "short1.mp4", w: 720, h: 1280, r: 25, vSec: 12, aSec: 12.7, ar: 48000, ac: 2, marks: [1, 10] },
    // a vertical Short, 24 fps, mono 22 kHz sound 0.5 s SHORTER than picture (must be padded with silence)
    { name: "short2.mp4", w: 1080, h: 1920, r: 24, vSec: 10, aSec: 9.5, ar: 22050, ac: 1, marks: [2, 8] },
  ];
  return specs.map((s) => {
    const file = path.join(tmp, s.name);
    const on = s.marks.map((m) => `between(t,${m},${m + 0.1})`).join("+");
    // picture and sound made separately and muxed as-is, so their lengths really differ where the spec says so.
    // asetnsamples: volume is evaluated per audio frame; default frames (1024 samples = 46 ms at 22 kHz) would
    // put the beep up to a frame late in the SOURCE and read as a false playout offset.
    const v2 = file.replace(".mp4", ".v.mp4");
    const a2 = file.replace(".mp4", ".a.m4a");
    ff(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=black:s=${s.w}x${s.h}:r=${s.r}:d=${s.vSec}`,
      "-vf", `drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='${on}'`, "-c:v", "libx264", "-pix_fmt", "yuv420p", v2]);
    ff(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=f=1000:r=${s.ar}:d=${s.aSec}`,
      "-af", `asetnsamples=n=64,volume='if(${on},0.5,0)':eval=frame,aformat=channel_layouts=${s.ac === 1 ? "mono" : "stereo"}`, "-c:a", "aac", a2]);
    ff(["-hide_banner", "-loglevel", "error", "-y", "-i", v2, "-i", a2, "-map", "0:v", "-map", "1:a", "-c", "copy", file]);
    return { id: `selftest/${s.name}`, file, marks: s.marks };
  });
}

function detectMarkers(file) {
  const log = ff(["-hide_banner", "-nostats", "-i", file,
    "-vf", "blackdetect=d=0.02:pix_th=0.10", "-af", "silencedetect=n=-30dB:d=0.05", "-f", "null", "-"]);
  const video = [...log.matchAll(/black_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const audio = [...log.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  // the last black/silence run ends at end-of-file, which is not a marker
  const total = probeStreams(file).videoSec;
  return { video: video.filter((t) => t < total - 0.05), audio: audio.filter((t) => t < total - 0.05) };
}

async function rehearse() {
  if (!v.out) throw new Error("--out <file.mp4> is required (rehearsal never streams)");
  let picks;
  let tmp = null;
  if (v.selftest) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "radio-film-selftest-"));
    picks = makeSelftestClips(tmp);
  } else {
    const { items } = loadLibrary(dir);
    const film = v.film ? items.find((i) => i.id === v.film) : items.find((i) => i.kind === "film");
    const shortIds = v.short || [];
    const shorts = shortIds.length ? shortIds.map((id) => items.find((i) => i.id === id)) : items.filter((i) => i.kind === "short").slice(0, 2);
    if (!film) throw new Error(`no film in the library at ${dir}${v.film ? ` with id ${v.film}` : ""}`);
    if (shorts.length < 2 || shorts.some((s) => !s)) throw new Error(`need two Shorts in the library at ${dir}`);
    picks = [film, ...shorts].map((i) => ({ id: i.id, file: i.file }));
  }
  const items = picks.map((p) => ({ ...p, ...probeStreams(p.file) }));
  const started = Date.now();
  ff(buildRehearsalArgs({ items, out: v.out }));
  const wallSec = (Date.now() - started) / 1000;
  const outStreams = probeStreams(v.out);
  const { starts, totalSec } = rehearsalBoundaries(items);
  const report = {
    out: v.out, wallSec,
    items: items.map((it, i) => ({ id: it.id, startSec: +starts[i].toFixed(3), videoSec: it.videoSec, audioSec: it.audioSec, hasAudio: it.hasAudio })),
    expectedSec: +totalSec.toFixed(3), outVideoSec: outStreams.videoSec, outAudioSec: outStreams.audioSec,
    endDriftSec: outStreams.audioSec == null ? null : +(outStreams.audioSec - outStreams.videoSec).toFixed(3),
  };
  if (v.selftest) {
    const found = detectMarkers(v.out);
    const expected = picks.flatMap((p, i) => p.marks.map((m) => +(starts[i] + m).toFixed(3)));
    const m = pairMarkers(found.video, found.audio);
    const placement = pairMarkers(expected, found.video, { windowSec: 0.2 });
    report.selftest = {
      expectedMarkersSec: expected, videoMarkersSec: found.video, audioMarkersSec: found.audio,
      worstAvOffsetMs: Math.round(m.worstSec * 1000), unmatchedAv: m.unmatched,
      worstPlacementMs: Math.round(placement.worstSec * 1000), unmatchedPlacement: placement.unmatched,
      // one frame at 30 fps is 33 ms; anything inside 45 ms is lip-sync clean
      verdict: m.unmatched.length || placement.unmatched.length ? "FAIL (unmatched markers)" : m.worstSec <= 0.045 && placement.worstSec <= 0.045 ? "PASS" : "FAIL (offset)",
    };
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.selftest && report.selftest.verdict !== "PASS") process.exit(1);
}

try {
  if (cmd === "import") {
    const r = importFilm({ file: v.file, series: v.series, title: v.title, publishedAt: v.published, name: v.name, copy: !!v.copy, dir, parentFilm: v.parent });
    console.log(`🎬 imported ${r.target} (${r.sidecar.durationSec}s, measured)`);
  } else if (cmd === "list") {
    const lib = loadLibrary(dir);
    console.log(JSON.stringify({ dir, items: lib.items.map(({ id, kind, title, durationSec, publishedAt, parentFilm }) => ({ id, kind, title, durationSec, publishedAt: new Date(publishedAt).toISOString(), ...(parentFilm ? { parentFilm } : {}) })), skipped: lib.skipped }, null, 2));
  } else if (cmd === "plan") {
    // DrJ's media rule (#218): only content-safety-cleared films and Shorts are planned.
    const lib = clearedLibrary(loadLibrary(dir), (f) => hasValidClearance(f));
    const day = v.day || easternToday();
    // --recent takes either [{id, at}] or yesterday's `plan --out` file as written
    const raw = v.recent ? JSON.parse(fs.readFileSync(v.recent, "utf8")) : [];
    const recent = Array.isArray(raw) ? raw : (raw.plan || []).filter((p) => p.type !== "promo").map((p) => ({ id: p.id, at: p.at }));
    const res = planDay(lib, { slots: defaultSlots(day), recent });
    const out = { day, dir, libraryItems: lib.items.length, skipped: lib.skipped, notCleared: lib.notCleared, ...res,
      plan: res.plan.map((p) => ({ ...p, atIso: new Date(p.at).toISOString() })), empty: res.empty.map((e) => ({ ...e, atIso: new Date(e.at).toISOString() })) };
    const text = JSON.stringify(out, null, 2);
    if (v.out) fs.writeFileSync(v.out, text + "\n"); else console.log(text);
  } else if (cmd === "rehearse") {
    await rehearse();
  } else {
    console.error("usage: filmCli.mjs import|list|plan|rehearse (see the header of this file)");
    process.exit(2);
  }
} catch (err) {
  console.error(`🎬 film: ${err.message}`);
  process.exit(2);
}
