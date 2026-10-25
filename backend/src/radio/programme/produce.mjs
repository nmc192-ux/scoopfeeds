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
 * Voice: Kokoro (VIDEO_TTS_PROVIDER=kokoro, VIDEO_TTS_KOKORO_URL=http://127.0.0.1:8880) unless --fake-voice.
 * Writer: `claude -p --model sonnet` on DrJ's subscription unless --fake-writer.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildClock, buildGridClock, checkClock } from "./clock.js";
import { buildFactPack } from "./factPack.js";
import { writeSegments, claudeWriter } from "./writer.js";
import { checkSegments } from "./checks.js";
import { assemble, fakeVoice, kokoroVoice, durationSecs } from "./assemble.js";
import { listBeds, listFiles, bedEntry, DAYPARTS } from "../musicLibrary.js";
import { loadManifest, screenCredit } from "../musicManifest.js";
import { ensureProceduralBed } from "../proceduralBed.js";
import { measureIntegrated } from "../playout/loudness.js";
import { resolveHourShort } from "../filmLibrary.js";

const { values: v } = parseArgs({ options: {
  hour: { type: "string" }, out: { type: "string" }, "music-dir": { type: "string" }, film: { type: "string" },
  from: { type: "string" }, base: { type: "string" }, "fake-voice": { type: "boolean" }, "fake-writer": { type: "boolean" },
  model: { type: "string" }, feature: { type: "string" }, "feature-title": { type: "string" },
  grid: { type: "boolean" },   // #200: build the hour from the channel grid (also RADIO_GRID_ENABLED=1)
} });
const log = (m) => console.log(`🎙 produce: ${m}`);
const die = (m) => { console.error(`🎙 produce: ${m}`); process.exit(2); };

const hourStart = Date.parse(v.hour || "");
if (!Number.isFinite(hourStart)) die("--hour must be an ISO time, e.g. 2026-10-13T16:00:00Z (9 pm PKT)");
if (!v.out) die("--out is required");
const out = path.resolve(v.out.replace(/^~/, process.env.HOME));
fs.mkdirSync(out, { recursive: true });
const musicDir = path.resolve((v["music-dir"] || path.join(process.env.HOME, "scoopfeeds-radio/music")).replace(/^~/, process.env.HOME));
// #216: the film slot takes only a Short cut from a published long-form film, checked against the film
// library. Anything else (ScoopFeeds 60, an unlinked clip, a file outside the library) is logged and the
// slot is filled by the normal programme.
let film = null, filmTitle = null;
if (v.film) {
  const r = resolveHourShort(path.resolve(v.film.replace(/^~/, process.env.HOME)));
  if (r.item) { film = r.item.file; filmTitle = `From ${r.item.seriesName}: ${r.item.title}`; log(`film slot: ${r.item.id} (Short from ${r.item.parentFilm})`); }
  else log(`film slot: no film this hour (${r.reason}); the slot is filled by the normal programme`);
}

const feature = v.feature ? path.resolve(v.feature.replace(/^~/, process.env.HOME)) : null;
if (feature && !fs.existsSync(feature)) die(`feature not found: ${feature}`);
const featureSec = feature ? durationSecs(feature) + 2.6 + 1.0 : 0;   // sting + the episode + a breath
const useGrid = v.grid || process.env.RADIO_GRID_ENABLED === "1";
const clockOpts = { featureSec, featureTitle: v["feature-title"] || (feature ? path.basename(feature).replace(/\.[^.]+$/, "") : null), film: !!film, filmTitle };
let gridPlan = null, clock;
if (useGrid) {
  ({ plan: gridPlan, slots: clock } = buildGridClock(hourStart, clockOpts));
  log(`grid: ${gridPlan.label}`);
  if (gridPlan.format === "repeat") log("grid: this is an overnight repeat hour; produce.mjs builds a full hour (the repeat itself is #195's rolling station)");
  if (gridPlan.featureDropped) log("grid: the feature airs only in its fixed slot (9 pm ET); this hour runs without it");
} else clock = buildClock(hourStart, clockOpts);
const problems = checkClock(clock);
if (problems.length) die(`clock is broken: ${problems.join("; ")}`);
const fromIdx = v.from ? clock.findIndex((s) => s.id === v.from) : 0;
if (fromIdx < 0) die(`--from: no slot "${v.from}" (slots: ${clock.map((s) => s.id).join(", ")})`);
const slots = clock.slice(fromIdx);
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
const pack = await buildFactPack({ base: v.base || "https://scoopfeeds.com", log, crypto: useGrid });
fs.writeFileSync(path.join(out, "pack.json"), JSON.stringify(pack, null, 1));
log(`fact pack: ${pack.top.length} top stories, desks ${Object.entries(pack.desks).map(([k, l]) => `${k}:${l.length}`).join(" ")}, ${pack.markets.length} market rows, ${pack.weather.length} cities, ${pack.dropped.length} articles dropped by Rule 0`);
if (pack.top.length < 5) log(`WARNING: only ${pack.top.length} top stories`);

// No market figures, no Markets Now: those slots become headlines and music rather than air an empty segment.
if (pack.markets.length < 3) {
  for (const s of slots) if (s.segment === "markets") { s.kind = "music"; s.segment = null; s.title = null; }
  log(`WARNING: only ${pack.markets.length} market rows; Markets Now slots turned into headlines and music`);
}
if (slots.some((s) => s.segment === "crypto") && (pack.crypto || []).length < 2) {
  for (const s of slots) if (s.segment === "crypto") { s.kind = "music"; s.segment = null; s.title = null; }
  log(`WARNING: only ${(pack.crypto || []).length} crypto rows; the Crypto slot turned into headlines and music`);
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
};
// grid hours: Markets Now leads with the exchanges in session (read by the markets prompt once #195 lands)
if (useGrid) when.marketsLead = Object.fromEntries(slots.filter((s) => s.segment === "markets").map((s) => [s.id, s.marketsLead || []]));
const spoken = slots.filter((s) => s.kind === "spoken");
const write = v["fake-writer"] ? fakeWriter : claudeWriter({ model: v.model || "sonnet", log });
const raw = await writeSegments(pack, spoken, when, { write, log });
fs.writeFileSync(path.join(out, "segments.raw.json"), JSON.stringify(raw, null, 1));
const checked = checkSegments(raw, spoken, pack, { log });
const report = checked.report;
const segments = checked.segments;
fs.writeFileSync(path.join(out, "segments.json"), JSON.stringify(segments, null, 1));
fs.writeFileSync(path.join(out, "checks.json"), JSON.stringify(report, null, 1));
log(`checks: ${report.length} line(s) dropped`);

// ── voice, mix, cues ──
const voice = v["fake-voice"] ? fakeVoice(path.join(out, "fake-voice")) : await kokoroVoice();
const partFile = `part-${slots[0].id}.wav`;
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
  slots, segments, pack, hourStart, bedFor, film, filmUrl: "/programme/film.webm", feature, voice, outWav: path.join(out, partFile), log, seriesCards: SERIES,
  creditFor: (file) => screenCredit(Object.values(beds).find((b) => b.file === file)?.entry || null),
});

// ── programme.json ──
const pf = path.join(out, "programme.json");
let prog = { version: 1, hourStart, endsAt: clock.at(-1).end, audio: [], cues: [], slots: [] };
if (fromIdx > 0 && fs.existsSync(pf)) prog = JSON.parse(fs.readFileSync(pf, "utf8"));
const cut = slots[0].start;
prog.audio = prog.audio.filter((a) => a.from < cut).concat([{ file: partFile, from: cut }]);
prog.cues = prog.cues.filter((c) => c.at < cut).concat(cues);
prog.slots = clock.map(({ id, kind, start, end, title, elements }) => ({ id, kind, start, end, title: title || null, ...(elements ? { elements } : {}) }));
if (gridPlan) prog.grid = gridPlan;
// the screen's right rail (#200): markets and weather, verbatim from the pack; each block renders only with data
prog.rail = { markets: pack.markets, weather: pack.weather };
prog.headlines = [...pack.top.map((s) => ({ h: s.headline, src: s.outlets.slice(0, 2).map((o) => o.source).join(" and ") })),
  ...Object.values(pack.desks).flat().map((s) => ({ h: s.headline, src: s.outlets.slice(0, 2).map((o) => o.source).join(" and ") }))]
  .filter((x, i, all) => all.findIndex((o) => o.h === x.h) === i).slice(0, 24);
prog.film = film ? path.basename(film) : null;
prog.feature = feature ? path.basename(feature) : null;
prog.featurePath = feature;
prog.filmPath = film;
// #208: every track this hour airs, with the library's exact credit, for the broadcast description and X text
prog.music = Object.values(beds).filter((b) => b.entry).map((b) => ({ file: b.entry.file, title: b.entry.title, artist: b.entry.artist, licence: b.entry.licence, credit: b.entry.credit }))
  .filter((m, i, all) => all.findIndex((x) => x.file === m.file) === i);
prog.proceduralBed = Boolean(beds.procedural);
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
    else if (slot.segment === "crypto") (pack.crypto || []).slice(0, 4).forEach((c, i) => L.push({ id: `c${i + 1}`, story: null, text: `${c.key} at ${Math.round(c.price)} dollars.` }));
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
