// Cuts vertical Shorts from the finished film.
//
// WHY SHORTS FIRST: the channel has 15 subscribers and 123 Shorts averaging ~80
// views. The first long-form got 2. At this size YouTube has no long-form
// audience to show anything to, so the Shorts ARE the distribution and the film
// is what they click through to.
//
// Each Short is titled to a DIFFERENT measured search phrase (demand.mjs), so
// they compete for separate queries instead of each other.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { ffmpegPath, P, loadStoryboard, projectSlug, ASSETS } from "./_deps.mjs";
import { existsSync } from "fs";
const { STORYBOARD, TITLE_SEGMENT } = await loadStoryboard();
const SLUG = projectSlug();

const FFMPEG = ffmpegPath;
const execFileP = promisify(execFile);

const ff = (a) => execFileP(FFMPEG, ["-y", "-nostdin", "-hide_banner", "-loglevel", "error", ...a], { maxBuffer: 1 << 26 });

const FILM = P(`out/${SLUG}-scored.mp4`);
const W = 1080, H = 1920, FPS = 30;
const WRAP = 30;

/**
 * Beat → start time in the finished film, read from the SRT that build.mjs
 * emitted alongside the render.
 *
 * This used to recompute the timeline from takes.json audio durations plus a
 * fixed gap. That was correct until build.mjs started EXTENDING shots to give
 * dense cards enough time to be read — 13 cards gained +13.1s between them, and
 * none of it was visible here. The drift was cumulative: beat 22 was cut 4.58s
 * early, beat 42 5.16s early, so every Short after the first opened on the tail
 * of the previous beat and ended mid-sentence.
 *
 * The SRT is generated from the actual shot plan, so it is the timeline. Read it
 * rather than modelling it — there is no second model to keep in sync.
 */
function beatTimes() {
  const toS = (s) => {
    const m = s.match(/(\d+):(\d+):(\d+),(\d+)/);
    return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
  };
  const cues = readFileSync(P(`out/${SLUG}.srt`), "utf8").trim().split(/\n\n+/)
    .map((b) => {
      const L = b.split("\n");
      const [a, z] = L[1].split(" --> ");
      return { start: toS(a), end: toS(z), text: L.slice(2).join(" ") };
    });
  // Bound comes from the SRT itself, not a number left over from whichever
  // film this was last run against — see build.mjs's BEAT_COUNT note.
  const beatCount = cues.length;
  const at = {};
  for (let id = 1; id <= beatCount; id++) at[id] = cues[id - 1].start;
  at[beatCount + 1] = cues[beatCount - 1].end;
  return { at };
}

// Each Short is a contiguous run of beats that stands alone as an argument.
// This is PER-VIDEO DATA — which beats form a self-contained clip is a
// judgement about this script, not something the engine can know. It used to
// be hardcoded to v2's beats, which is exactly the class of bug docs.json
// exists to prevent for capture-measured.mjs. Same fix here: read
// out/shorts.json (project-authored) instead of carrying one film's cuts.
const SHORTS_PATH = P("shorts.json");
if (!existsSync(SHORTS_PATH)) {
  console.error(`no shorts.json in ${P(".")} — nothing to cut.`);
  console.error(`Create one: [{ "name":"01_slug", "from":<beat>, "to":<beat>, "title":"…", "hook":"…" }]`);
  process.exit(1);
}
const SHORTS = JSON.parse(readFileSync(SHORTS_PATH, "utf8"));
if (!Array.isArray(SHORTS) || !SHORTS.length) {
  console.error(`shorts.json in ${P(".")} is empty — nothing to cut.`);
  console.error(`Add [{ "name":"01_slug", "from":<beat>, "to":<beat>, "title":"…", "hook":"…" }]`);
  process.exit(1);
}

function wrap(text, max = WRAP) {
  const words = text.split(/\s+/); const lines = []; let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) { lines.push(cur.trim()); cur = w; } else cur += " " + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.join("\n");
}

async function main() {
  mkdirSync(P("out/shorts"), { recursive: true });
  const { at } = beatTimes();
  const rows = [];

  const CHAPTERS = new Set(Object.entries(STORYBOARD)
    .filter(([, v]) => v.card === "chapter").map(([k]) => +k));

  for (const s of SHORTS) {
    // Enforced, not advisory: a Short that opens on a chapter divider spends
    // its only decisive second on a title card. This was written down as a
    // house rule and then violated by the very next shorts.json — rules the
    // engine doesn't check are suggestions.
    if (CHAPTERS.has(s.from)) {
      throw new Error(`${s.name} opens on beat ${s.from}, a chapter divider — start on the next beat`);
    }
    const start = at[s.from];
    const end = at[s.to + 1];        // up to the start of the next beat
    const dur = +(end - start).toFixed(2);
    if (dur > 59) { console.log(`! ${s.name} is ${dur}s — over the Shorts limit`); }

    const capFile = P(`out/shorts/${s.name}.txt`);
    writeFileSync(capFile, wrap(s.hook));
    const out = P(`out/shorts/${s.name}.mp4`);

    // FIT, do not crop. The cards are laid out for 16:9; centre-cropping them
    // sliced the type mid-word ("EMPLO…"). Letterboxing onto the brand ground
    // keeps every card readable and leaves clean space for the burned hook.
    const VW = W, VH = Math.round((W * 9) / 16);   // 1080×608
    const VY = 300;
    const vf = [
      `scale=${VW}:${VH}`,
      `pad=${W}:${H}:0:${VY}:0x090706`,
      `drawbox=x=0:y=0:w=14:h=${H}:color=0xdde706:t=fill`,
      `drawtext=fontfile=${path.join(ASSETS, "fonts/Inter-Bold.otf")}:textfile=${capFile}:`
        + `x=(w-text_w)/2:y=${VY + VH + 130}:fontsize=52:fontcolor=0xf5f2ea:line_spacing=20`,
      `drawtext=fontfile=${path.join(ASSETS, "fonts/Anton-Regular.ttf")}:text='SCOOPFEEDS':`
        + `x=(w-text_w)/2:y=${H - 130}:fontsize=40:fontcolor=0xdde706`,
      `fade=t=in:st=0:d=0.4`, `fade=t=out:st=${(dur - 0.6).toFixed(2)}:d=0.6`,
      `format=yuv420p`,
    ].join(",");

    await ff(["-ss", String(start), "-t", String(dur), "-i", FILM,
      "-vf", vf,
      "-af", `afade=t=in:st=0:d=0.3,afade=t=out:st=${(dur - 0.5).toFixed(2)}:d=0.5`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", out]);

    rows.push({ name: s.name, dur, title: s.title });
    console.log(`✓ ${s.name.padEnd(26)} ${String(dur).padStart(5)}s   ${s.title}`);
  }

  writeFileSync(P("out/shorts/TITLES.md"),
    "# Shorts — each targets a different measured search phrase\n\n" +
    rows.map((r) => `- **${r.title}**  \n  \`${r.name}.mp4\` · ${r.dur}s`).join("\n") + "\n");
}

main().catch((e) => { console.error("SHORTS FAILED:", e.message); process.exit(1); });
