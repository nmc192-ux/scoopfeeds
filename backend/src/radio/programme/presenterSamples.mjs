#!/usr/bin/env node
/**
 * presenterSamples.mjs - #284: a ~20 s sample of each presenter pair, to pick RADIO_VOICE_A / RADIO_VOICE_B by ear.
 * Runs on the Mac against the local Kokoro (VIDEO_TTS_PROVIDER=kokoro, VIDEO_TTS_KOKORO_URL=http://127.0.0.1:8880):
 *
 *   node src/radio/programme/presenterSamples.mjs --out ~/scoopfeeds-radio/duo-samples \
 *        [--pairs am_michael+af_heart,bm_george+bf_emma,bm_george+af_heart,am_michael+bf_emma]
 *
 * Writes <out>/<A>+<B>.wav per pair: the same short bulletin, cast exactly as an hour is (castLines), so the
 * handover and the alternation are what DrJ will hear on air. Nothing is published.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { castLines } from "./presenters.js";
import { kokoroVoice } from "./assemble.js";

const { values: v } = parseArgs({ options: { out: { type: "string" }, pairs: { type: "string" } } });
if (!v.out) { console.error("--out is required"); process.exit(2); }
const out = path.resolve(v.out.replace(/^~/, process.env.HOME));
fs.mkdirSync(out, { recursive: true });
const pairs = (v.pairs || "am_michael+af_heart,bm_george+bf_emma,bm_george+af_heart,am_michael+bf_emma").split(",").map((p) => p.split("+"));
const names = JSON.parse(fs.readFileSync(new URL("./presenters.json", import.meta.url), "utf8"));
const LINES = [
  { id: "open", text: "It's nine in the evening in New York. This is ScoopFeeds Radio, the news, compared." },
  { id: "s1", story: "a", text: "Central banks in Europe held interest rates steady today, and said they will watch energy prices closely over the winter." },
  { id: "s2", story: "b", text: "In Asia, shipping companies report longer delays at two of the region's busiest ports, after a week of heavy storms." },
  { id: "s3", story: "c", text: "And in sport, the final of the cricket series has been moved to Sunday because of rain." },
  { id: "close", text: "Markets Now, after this." },
];
const voice = await kokoroVoice();
for (const [a, b] of pairs) {
  const cast = { A: { key: "A", name: names.A.name, voice: a }, B: { key: "B", name: names.B.name, voice: b } };
  const files = [];
  for (const l of castLines(LINES, cast)) files.push((await voice(l.text, { voice: l.voice })).path);
  const list = path.join(out, `${a}+${b}.txt`);
  fs.writeFileSync(list, files.map((f) => `file '${f}'`).join("\n"));
  const wav = path.join(out, `${a}+${b}.wav`);
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-ac", "2", "-ar", "44100", wav]);
  if (r.status !== 0) { console.error(`${a}+${b}: ffmpeg failed: ${String(r.stderr).slice(-200)}`); continue; }
  fs.rmSync(list);
  console.log(`🎙 ${wav}`);
}
