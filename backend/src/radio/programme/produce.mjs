#!/usr/bin/env node
/**
 * produce.mjs - build one hour of ScoopFeeds Radio: fact pack -> scripts -> checks -> voice ->
 * mix -> cue sheet. Writes into --out:
 *   pack.json, segments.raw.json, segments.json (checked), checks.json,
 *   part-<slot>.wav (programme audio from the first produced slot on), programme.json
 *
 *   node src/radio/programme/produce.mjs --hour 2026-10-13T16:00:00Z --out ~/scoopfeeds-radio/programme \
 *        --music-dir ~/scoopfeeds-radio/music [--film ~/path/film.mp4] [--from half] [--fake-voice] [--fake-writer]
 *
 * --from <slot id>  re-produce from that slot on (the 9:20 pm refresh): keeps earlier cues, adds a new
 *                   audio part that the playout switches to at that slot's start. Pick a music slot.
 * --to <slot id>    with --from: stop before that slot and switch back to the audio that was there (the 24/7
 *                   overnight repeat: a fresh The Hour over a repeated hour, --from the-hour --to markets-1).
 * --weather 0|1     0: no weather this hour, the half-hour headlines take its time (the 24/7 day, dayClock.js). Default 1.
 * --headline-writer reads headlines verbatim instead of calling Claude (the cost-guard fallback; same as --fake-writer).
 * Every Claude call is counted in <out>/writer.json (calls, failures, whether a usage limit was hit).
 * Voice: Kokoro (VIDEO_TTS_PROVIDER=kokoro, VIDEO_TTS_KOKORO_URL=http://127.0.0.1:8880) unless --fake-voice.
 * Writer: `claude -p --model sonnet` on DrJ's subscription unless --fake-writer.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildClock, checkClock } from "./clock.js";
import { buildFactPack } from "./factPack.js";
import { writeSegments, claudeWriter, isLimitError } from "./writer.js";
import { sessionsAt } from "./dayClock.js";
import { spliceProgramme } from "./repeat.js";
import { checkSegments } from "./checks.js";
import { assemble, fakeVoice, kokoroVoice, durationSecs } from "./assemble.js";
import { listBeds, listFiles, bedEntry, DAYPARTS } from "../musicLibrary.js";
import { loadManifest, screenCredit } from "../musicManifest.js";
import { ensureProceduralBed } from "../proceduralBed.js";
import { measureIntegrated } from "../playout/loudness.js";

const { values: v } = parseArgs({ options: {
  hour: { type: "string" }, out: { type: "string" }, "music-dir": { type: "string" }, film: { type: "string" },
  from: { type: "string" }, base: { type: "string" }, "fake-voice": { type: "boolean" }, "fake-writer": { type: "boolean" },
  model: { type: "string" }, feature: { type: "string" }, "feature-title": { type: "string" },
  to: { type: "string" }, weather: { type: "string", default: "1" }, "headline-writer": { type: "boolean" },
} });
const log = (m) => console.log(`🎙 produce: ${m}`);
const die = (m) => { console.error(`🎙 produce: ${m}`); process.exit(2); };

const hourStart = Date.parse(v.hour || "");
if (!Number.isFinite(hourStart)) die("--hour must be an ISO time, e.g. 2026-10-13T16:00:00Z (9 pm PKT)");
if (!v.out) die("--out is required");
const out = path.resolve(v.out.replace(/^~/, process.env.HOME));
fs.mkdirSync(out, { recursive: true });
const musicDir = path.resolve((v["music-dir"] || path.join(process.env.HOME, "scoopfeeds-radio/music")).replace(/^~/, process.env.HOME));
const film = v.film ? path.resolve(v.film.replace(/^~/, process.env.HOME)) : null;
if (film && !fs.existsSync(film)) die(`film not found: ${film}`);

const feature = v.feature ? path.resolve(v.feature.replace(/^~/, process.env.HOME)) : null;
if (feature && !fs.existsSync(feature)) die(`feature not found: ${feature}`);
const featureSec = feature ? durationSecs(feature) + 2.6 + 1.0 : 0;   // sting + the episode + a breath
const clock = buildClock(hourStart, { featureSec, featureTitle: v["feature-title"] || (feature ? path.basename(feature).replace(/\.[^.]+$/, "") : null), weather: v.weather !== "0" });
const problems = checkClock(clock);
if (problems.length) die(`clock is broken: ${problems.join("; ")}`);
const fromIdx = v.from ? clock.findIndex((s) => s.id === v.from) : 0;
if (fromIdx < 0) die(`--from: no slot "${v.from}" (slots: ${clock.map((s) => s.id).join(", ")})`);
const toIdx = v.to ? clock.findIndex((s) => s.id === v.to) : clock.length;
if (toIdx < 0) die(`--to: no slot "${v.to}"`);
if (v.to && (!v.from || toIdx <= fromIdx)) die("--to needs --from, and must come after it");
const slots = clock.slice(fromIdx, toIdx);
const t0 = Date.now();

// ── beds (measured once) ── only beds the manifest clears (#208); with none, the procedural bed
const manifest = loadManifest(musicDir);
const beds = {};
for (const d of DAYPARTS) {
  const f = listBeds(d, musicDir, { manifest, onRefused: (why) => log(`music refused: ${why}`) })[0];
  if (f) beds[d] = { file: f, lufs: (await measureIntegrated(f)) ?? -16, len: durationSecs(f), entry: bedEntry(f, musicDir, manifest) };
}
if (!Object.keys(beds).length) {
  const refused = DAYPARTS.reduce((n, d) => n + listFiles(d, musicDir).length, 0);
  let f; try { f = ensureProceduralBed(musicDir); } catch (e) { die(`no cleared music bed under ${musicDir} and ${e.message}`); }
  beds.procedural = { file: f, lufs: (await measureIntegrated(f)) ?? -16, len: durationSecs(f), entry: null };
  log(`no cleared music bed (${refused} file(s) without a complete manifest entry): the procedural bed carries the hour`);
}
const anyBed = Object.values(beds)[0];
const bedFor = (d) => beds[d] || anyBed;
log(`beds: ${Object.entries(beds).map(([d, b]) => `${d}=${path.basename(b.file)} ${b.lufs} LUFS`).join(", ")}`);

// ── facts ──
const pack = await buildFactPack({ base: v.base || "https://scoopfeeds.com", log });
fs.writeFileSync(path.join(out, "pack.json"), JSON.stringify(pack, null, 1));
log(`fact pack: ${pack.top.length} top stories, desks ${Object.entries(pack.desks).map(([k, l]) => `${k}:${l.length}`).join(" ")}, ${pack.markets.length} market rows, ${pack.weather.length} cities, ${pack.dropped.length} articles dropped by Rule 0`);
if (pack.top.length < 5) log(`WARNING: only ${pack.top.length} top stories`);

// No market figures, no Markets Now: those slots become headlines and music rather than air an empty segment.
if (pack.markets.length < 3) {
  for (const s of slots) if (s.segment === "markets") { s.kind = "music"; s.segment = null; s.title = null; }
  log(`WARNING: only ${pack.markets.length} market rows; Markets Now slots turned into headlines and music`);
}
if (pack.weather.length < 5) {
  for (const s of slots) if (s.segment === "weather") { s.kind = "music"; s.segment = null; s.title = null; }
  log(`WARNING: only ${pack.weather.length} cities; the weather slot turned into headlines and music`);
}

// ── words ──
const fmt = (ms, tz, opts) => new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(new Date(ms));
const SPOKEN_HOUR = ["midnight", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "noon"];
const spokenHour = (ms, tz) => {
  const h = Number(fmt(ms, tz, { hour: "numeric", hourCycle: "h23" }));
  if (h === 0) return "midnight"; if (h === 12) return "noon";
  const part = h < 12 ? "in the morning" : h < 17 ? "in the afternoon" : "in the evening";
  return `${SPOKEN_HOUR[h % 12]} ${part}`;
};
const asOf = `${fmt(pack.builtAt, "America/New_York", { hour: "numeric", minute: "2-digit" })} in New York`;
const when = {
  hourLabel: `${spokenHour(hourStart, "America/New_York")} in New York`.replace(/^noon in/, "noon in"),
  cityTimes: `${spokenHour(hourStart, "Asia/Karachi")} in Karachi`,
  marketsAsOf: Object.fromEntries(slots.filter((s) => s.segment === "markets").map((s) => [s.id, asOf])),
  // Markets Now by exchange session: the market groups whose exchange is trading when the slot airs
  marketsLead: Object.fromEntries(slots.filter((s) => s.segment === "markets").map((s) => [s.id, [...new Set(sessionsAt(s.start + 60_000).flatMap((x) => x.groups))]])),
};
const spoken = slots.filter((s) => s.kind === "spoken");
const usesClaude = !(v["fake-writer"] || v["headline-writer"]);
const write = usesClaude ? claudeWriter({ model: v.model || "sonnet", log }) : fakeWriter;
// Cost guard (#195): every Claude call and failure is counted, per run, in writer.json; the rolling orchestrator
// adds them to the day's ledger and falls back to repeat hours when the day's budget or a usage limit is hit.
const run = { at: Date.now(), from: slots[0].id, to: v.to || null, writer: usesClaude ? "claude" : "headlines", calls: 0, failures: 0, limitHit: false, errors: [] };
const counted = async (system, prompt) => {
  if (usesClaude) run.calls++;
  try { return await write(system, prompt); }
  catch (e) { if (usesClaude) { run.failures++; run.limitHit ||= isLimitError(e.message); run.errors.push(String(e.message).slice(0, 200)); } throw e; }
};
const saveWriterLog = () => {
  const f = path.join(out, "writer.json");
  let w = { runs: [] };
  try { w = JSON.parse(fs.readFileSync(f, "utf8")); if (!Array.isArray(w.runs)) w = { runs: [] }; } catch { /* first run */ }
  w.runs.push(run);
  w.calls = w.runs.reduce((n, r) => n + (r.calls || 0), 0);
  w.failures = w.runs.reduce((n, r) => n + (r.failures || 0), 0);
  w.limitHit = w.runs.some((r) => r.limitHit);
  fs.writeFileSync(f, JSON.stringify(w, null, 1));
  log(`writer: ${run.calls} Claude call(s), ${run.failures} failure(s)${run.limitHit ? ", USAGE LIMIT hit" : ""}`);
};
let raw;
try { raw = await writeSegments(pack, spoken, when, { write: counted, log }); }
finally { saveWriterLog(); }
fs.writeFileSync(path.join(out, "segments.raw.json"), JSON.stringify(raw, null, 1));
const checked = checkSegments(raw, spoken, pack, { log });
const report = checked.report;
const segments = checked.segments;
fs.writeFileSync(path.join(out, "segments.json"), JSON.stringify(segments, null, 1));
fs.writeFileSync(path.join(out, "checks.json"), JSON.stringify(report, null, 1));
log(`checks: ${report.length} line(s) dropped`);

// ── voice, mix, cues ──
const voice = v["fake-voice"] ? fakeVoice(path.join(out, "fake-voice")) : await kokoroVoice();
// A partial run gets a fresh file name, so it never overwrites a part the playout may be reading.
const partFile = fromIdx > 0 ? `part-${slots[0].id}-${Date.now().toString(36)}.wav` : `part-${slots[0].id}.wav`;
const SERIES = [
  { series: "Peace & War", day: "Mondays" }, { series: "People", day: "Tuesdays" }, { series: "The Body Politic", day: "Wednesdays" },
  { series: "The Record", day: "Fridays" }, { series: "A-Eye", day: "Saturdays" }, { series: "The Invisible Hand", day: "Sundays" },
];
// The screen's Chromium has no H.264 decoder (Playwright build): the film plays as a silent VP8 WebM; its sound is in the mix.
const fresh = (f) => { try { return fs.statSync(path.join(out, f)).size > 0; } catch { return false; } };
if (film && slots.some((s) => s.kind === "film") && !fresh("film.webm")) {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", film, "-t", "60", "-an", "-vf", "scale=-2:1280,fps=30",
    "-c:v", "libvpx", "-b:v", "4M", "-deadline", "good", "-cpu-used", "4", path.join(out, "film.webm")]);
  if (r.status !== 0) die(`film transcode failed: ${String(r.stderr).slice(-300)}`);
  log("film transcoded to film.webm");
}
if (feature && slots.some((s) => s.kind === "feature") && !fresh("feature.webm")) {
  const { spawnSync } = await import("node:child_process");
  log(`transcoding the feature (${Math.round(featureSec)} s) to feature.webm…`);
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", feature, "-an", "-vf", "scale=1920:-2,fps=30",
    "-c:v", "libvpx", "-b:v", "6M", "-deadline", "realtime", "-cpu-used", "6", "-threads", "8", path.join(out, "feature.webm")], { maxBuffer: 1 << 26 });
  if (r.status !== 0) die(`feature transcode failed: ${String(r.stderr).slice(-300)}`);
  log("feature transcoded");
}
const { cues, report: mixReport } = await assemble({
  slots, segments, pack, hourStart, bedFor, film, filmUrl: "/programme/film.webm", feature, voice, outWav: path.join(out, partFile + ".tmp"), log, seriesCards: SERIES,
  creditFor: (file) => screenCredit(Object.values(beds).find((b) => b.file === file)?.entry || null),
});
// atomic: a part is never rewritten in place (the playout may be reading it, and a repeat hour may hard-link it)
fs.renameSync(path.join(out, partFile + ".tmp"), path.join(out, partFile));

// ── programme.json ──
const pf = path.join(out, "programme.json");
let prog = { version: 1, hourStart, endsAt: clock.at(-1).end, audio: [], cues: [], slots: [] };
if (fromIdx > 0 && fs.existsSync(pf)) prog = JSON.parse(fs.readFileSync(pf, "utf8"));
const cut = slots[0].start;
if (v.to) {
  // Splice [cut, resumeAt) into the existing programme. At resumeAt the playout switches back to whichever part was
  // playing there, seeking from that part's own origin (`origin`), so the rest of the hour plays as before.
  prog = spliceProgramme(prog, { cut, resumeAt: clock[toIdx].start, partFile, cues });
} else {
  prog.audio = prog.audio.filter((a) => a.from < cut).concat([{ file: partFile, from: cut }]);
  prog.cues = prog.cues.filter((c) => c.at < cut).concat(cues);
  prog.slots = clock.map(({ id, kind, start, end, title }) => ({ id, kind, start, end, title: title || null }));
}
prog.headlines = [...pack.top.map((s) => ({ h: s.headline, src: s.outlets.slice(0, 2).map((o) => o.source).join(" and ") })),
  ...Object.values(pack.desks).flat().map((s) => ({ h: s.headline, src: s.outlets.slice(0, 2).map((o) => o.source).join(" and ") }))]
  .filter((x, i, all) => all.findIndex((o) => o.h === x.h) === i).slice(0, 24);
if (!v.to) {   // a spliced run keeps the repeated hour's film and feature
  prog.film = film ? path.basename(film) : null;
  prog.feature = feature ? path.basename(feature) : null;
  prog.featurePath = feature;
  prog.filmPath = film;
}
// #208: every track this hour airs, with the library's exact credit, for the broadcast description and X text.
// A spliced run (#195 repeat) keeps the repeated hour's tracks too: the rest of that hour still airs them.
const runMusic = Object.values(beds).filter((b) => b.entry).map((b) => ({ file: b.entry.file, title: b.entry.title, artist: b.entry.artist, licence: b.entry.licence, credit: b.entry.credit }));
prog.music = (v.to ? [...(prog.music || []), ...runMusic] : runMusic)
  .filter((m, i, all) => all.findIndex((x) => x.file === m.file) === i);
prog.proceduralBed = Boolean(beds.procedural) || Boolean(v.to && prog.proceduralBed);
prog.builtAt = Date.now();
fs.writeFileSync(pf + ".tmp", JSON.stringify(prog, null, 1));
fs.renameSync(pf + ".tmp", pf);   // atomic: the screen and playout never read half a file
log(`done in ${Math.round((Date.now() - t0) / 1000)} s: ${cues.length} cues, ${Math.round(mixReport.voicedSecs)} s of speech, dropped for time ${JSON.stringify(mixReport.dropped)}; audio ${partFile} from ${new Date(cut).toISOString()}`);

/** Mechanical writer for dry runs: reads headlines, no Claude. */
async function fakeWriter() {
  const s = {};
  const top = pack.top.slice(0, 5);
  const line = (st, id) => ({ id, story: st.id, text: `${st.outlets[0].source} reports: ${st.headline}.` });
  for (const slot of spoken) {
    const L = [];
    if (slot.segment === "the-hour") { L.push({ id: "open", text: `It's ${when.hourLabel}, ${when.cityTimes}. This is ScoopFeeds Radio, the news, compared.` }); top.forEach((st, i) => L.push(line(st, `s${i + 1}`))); L.push({ id: "close", text: "Markets Now, after this." }); }
    else if (slot.segment === "half") { L.push({ id: "open", text: "Headlines at the half hour." }); top.forEach((st, i) => L.push(line(st, `h${i + 1}`))); }
    else if (slot.segment === "desk") { const d = pack.desks[slot.desk] || []; L.push({ id: "open", text: `On the ${slot.title}.` }); d.slice(0, 3).forEach((st, i) => L.push(line(st, `d${i + 1}`))); L.push({ id: "close", text: "That's the desk." }); }
    else if (slot.segment === "markets") pack.markets.forEach((m, i) => L.push({ id: `m${i + 1}`, story: null, text: `${m.key} at ${Math.round(m.price)}, ${m.pct >= 0 ? "up" : "down"} ${Math.abs(m.pct).toFixed(1)} percent.` }));
    else if (slot.segment === "weather") pack.weather.forEach((w, i) => L.push({ id: `w${i + 1}`, story: null, text: `${w.city}, ${w.c} degrees, ${w.condition}.` }));
    else if (slot.segment === "signoff") L.push({ id: "s1", text: "That was the first hour of ScoopFeeds Radio. Every newsroom, one stream." });
    else if (slot.segment === "compared") {
      const st = [...pack.top, ...Object.values(pack.desks).flat()].filter((x) => x.count >= 3)[slot.id === "compared-2" ? 1 : 0] || pack.top[0];
      const outs = st.outlets.slice(0, 4);
      s[slot.id] = { story: st.id, outlets: outs.map((o) => o.source), lines: [{ id: "intro", text: st.headline }, ...outs.map((o, i) => ({ id: `o${i + 1}`, outlet: o.source, text: `${o.source} leads with: ${o.title}.` })), { id: "agree", text: "Every outlet agrees on the basic facts." }, { id: "close", text: "That was the news, compared." }] };
      continue;
    }
    s[slot.id] = { lines: L };
  }
  return { segments: s };
}
