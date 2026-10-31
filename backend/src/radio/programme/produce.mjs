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
 *                   `--to next` stops at the slot after --from (#283: a fresh Crypto for a repeat, --from crypto --to next).
 *                   A splice run merges its segments into the ones already in --out (earlier splices of the same hour).
 * --weather 0|1     0: no weather this hour, the half-hour headlines take its time (the 24/7 day, dayClock.js). Default 1.
 * --developing <file>  #201: the developing desk's followups.json; those stories lead the headlines while they grow.
 * --election-night special|day-after  #198: the election night special's clock (electionNight.js), or a day-after hour
 *                   with the "Counting continues" desk. The rolling station passes it from stationPlan(); with
 *                   --election-fixture FILE the projections come from fixture articles (the dress rehearsal), and
 *                   --election-start ISO moves the night so the special starts at that hour (poll closings move too).
 * --headline-writer reads headlines verbatim instead of calling Claude (the cost-guard fallback; same as --fake-writer).
 * Every Claude call is counted in <out>/writer.json (calls, failures, whether a usage limit was hit).
 * Voice: Kokoro (VIDEO_TTS_PROVIDER=kokoro, VIDEO_TTS_KOKORO_URL=http://127.0.0.1:8880) unless --fake-voice.
 * Writer: `claude -p --model sonnet` on DrJ's subscription unless --fake-writer.
 * #285: RADIO_CLOCK_V15=1 builds the v1.5 clock (clock.js ORDER_V15: longer bulletins, a Sport slot, a fresh-only
 * half-hour, music blocks of 90 s at most). A partial run (--from) follows the clock of the programme.json already in
 * --out for this hour, so a refresh or a repeat's splice never mixes the two clocks; programme.json says `clock: "v15"`.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildClock, buildGridClock, checkClock, clockV15, dropSport, musicSecs } from "./clock.js";
import { buildFactPack, cryptoForRun, railMarkets } from "./factPack.js";
import { writeSegments, claudeWriter, isLimitError } from "./writer.js";
import { sessionsAt } from "./dayClock.js";
import { labelMarkets, labelScreenMarkets, marketsShutAt } from "./marketsClock.js";
import { spliceProgramme } from "./repeat.js";
import { withProgrammeLock, reapplyInserts, addDevelopingStories } from "./developingDesk.js";
import { checkSegments } from "./checks.js";
import { loadPresenters, castSegments } from "./presenters.js";
import { buildElectionPack, extractElectionPack } from "./electionPack.js";
import { buildSpecialClock, addCountingDesk, addPollCloseLines, mechanicalUpdate, mechanicalCounting, projectionLines, nightWindow, fixtureArticles, UPDATE_ID, electionContext } from "./electionNight.js";
import { deskOn, addDeskToClock, addBallotLines, boardData, windowData } from "./electionDesk.js";
import { assemble, fakeVoice, kokoroVoice, durationSecs } from "./assemble.js";
import { screenCredit } from "../musicManifest.js";
import { loadBeds } from "./beds.js";
import { resolveHourShort } from "../filmLibrary.js";
import { longReadOn, isLongReadHour, pickForAir, addLongReadToClock, SLOT_ID as LONGREAD_SLOT } from "../longread/longread.js";
import { listPieces, recordAiring } from "../longread/store.js";

const { values: v } = parseArgs({ options: {
  hour: { type: "string" }, out: { type: "string" }, "music-dir": { type: "string" }, film: { type: "string" },
  from: { type: "string" }, base: { type: "string" }, "fake-voice": { type: "boolean" }, "fake-writer": { type: "boolean" },
  model: { type: "string" }, feature: { type: "string" }, "feature-title": { type: "string" },
  to: { type: "string" }, weather: { type: "string", default: "1" }, "headline-writer": { type: "boolean" },
  developing: { type: "string" },   // #201: followups.json from the developing desk (aired stories still growing)
  grid: { type: "boolean" },   // #200: build the hour from the channel grid (also RADIO_GRID_ENABLED=1)
  "election-night": { type: "string" }, "election-fixture": { type: "string" }, "election-start": { type: "string" },   // #198
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

let feature = v.feature ? path.resolve(v.feature.replace(/^~/, process.env.HOME)) : null;
if (feature && !fs.existsSync(feature)) die(`feature not found: ${feature}`);
const featureSec = feature ? durationSecs(feature) + 2.6 + 1.0 : 0;   // sting + the episode + a breath
const night = v["election-night"] || null;   // #198
if (night && !["special", "day-after"].includes(night)) die("--election-night must be special or day-after");
const nightWin = nightWindow(v["election-start"] ? { startAt: Date.parse(v["election-start"]) } : {});
const elFixture = v["election-fixture"] ? path.resolve(v["election-fixture"].replace(/^~/, process.env.HOME)) : null;
const useGrid = night !== "special" && (v.grid || process.env.RADIO_GRID_ENABLED === "1");
// #285: a partial run keeps the clock the hour was built with (a repeat's programme.json is the repeated hour's, retimed)
const existingProg = (() => { if (!v.from) return null; try { const p = JSON.parse(fs.readFileSync(path.join(out, "programme.json"), "utf8")); return p?.hourStart === hourStart ? p : null; } catch { return null; } })();
const v15 = night !== "special" && (existingProg ? existingProg.clock === "v15" : clockV15());
if (v15) log(`clock: v1.5 (#285)${existingProg ? ", as this hour was built" : ", RADIO_CLOCK_V15=1"}`);
else if (existingProg && clockV15() && night !== "special") log("clock: RADIO_CLOCK_V15=1, but this hour was built on the old clock: the partial run keeps it");
const clockOpts = { featureSec, featureTitle: v["feature-title"] || (feature ? path.basename(feature).replace(/\.[^.]+$/, "") : null), film: !!film, filmTitle, ...(v15 ? { v15 } : {}) };
let gridPlan = null, clock;
if (night === "special") {
  clock = buildSpecialClock(hourStart);   // replaces the normal clock: no film, feature, markets or weather
  if (film || feature) log("election night special: the film and the feature do not air this hour");
  film = null; filmTitle = null; feature = null;
  log(`election night special${nightWin.rehearsal ? " (dress rehearsal)" : ""}: updates at :00, :15, :30, :45; poll closings from the race list`);
} else if (useGrid) {
  ({ plan: gridPlan, slots: clock } = buildGridClock(hourStart, clockOpts));
  log(`grid: ${gridPlan.label}`);
  if (gridPlan.format === "repeat") log("grid: this is an overnight repeat hour; produce.mjs builds a full hour (the repeat itself is #195's rolling station)");
  if (gridPlan.featureDropped) log("grid: the feature airs only in its fixed slot (9 pm ET); this hour runs without it");
} else clock = buildClock(hourStart, { ...clockOpts, weather: v.weather !== "0" });   // #195: the grid decides weather itself
const problems = checkClock(clock);
if (problems.length) die(`clock is broken: ${problems.join("; ")}`);
// The Midterms desk (#197): dark unless RADIO_ELECTION_DESK=1; hours from 26 Oct to 6 Nov (New York)
// #198: on election night and the days after, the counting desk takes the Midterms desk's place
const midterms = !night && deskOn(hourStart) ? addDeskToClock(clock, hourStart) : null;
const counting = night === "day-after" ? addCountingDesk(clock, hourStart) : null;
if (night === "day-after" && !counting) log("day after: no music-1 slot long enough for the counting desk this hour");
if (counting && checkClock(clock).length) die(`clock is broken after adding the counting desk: ${checkClock(clock).join("; ")}`);
if (midterms && checkClock(clock).length) die(`clock is broken after adding the Midterms desk: ${checkClock(clock).join("; ")}`);
// #304: The Long Read (RADIO_LONGREAD_ENABLED=1, dark by default). In a long-read hour of the v1.5 clock, The News,
// Compared #2 and the music block after it become one piece ScoopFeeds wrote and checked earlier (longread/cli.mjs
// make). No piece that may air, or no such slots (a feature hour): the hour is unchanged. Never in a repeat splice.
let longRead = null;
if (longReadOn() && v15 && night !== "special" && !v.to && isLongReadHour(hourStart)) {
  const pieces = listPieces();
  const piece = pickForAir(pieces, { hourStart });
  if (!piece) log(`long read: no piece may air this hour (${pieces.length} on file; longread/cli.mjs list says why); The News, Compared as usual`);
  else {
    const slot = addLongReadToClock(clock);
    if (!slot) log("long read: this hour has no News, Compared #2 + music pair to give it (a feature hour?); The News, Compared as usual");
    else {
      longRead = { piece, slot };
      log(`long read: ${piece.id} (${piece.verdict?.words ?? "?"} words, ${piece.status}) at ${Math.floor(slot.startSec / 60)}:${String(slot.startSec % 60).padStart(2, "0")}`);
      if (checkClock(clock).length) die(`clock is broken after adding the Long Read: ${checkClock(clock).join("; ")}`);
    }
  }
}
// #283: a repeat asks for a fresh Crypto in every hour; an hour whose clock has none (grid off) has nothing to splice
if (v.from === "crypto" && !clock.some((s) => s.id === "crypto")) {
  log(`crypto: this hour's clock has no Crypto slot (${night === "special" ? "the election night special" : useGrid ? "no music break long enough" : "the grid is off: RADIO_GRID_ENABLED is not 1"}); nothing to splice`);
  process.exit(0);
}
const runSlots = () => {
  const fromIdx = v.from ? clock.findIndex((s) => s.id === v.from) : 0;
  if (fromIdx < 0) die(`--from: no slot "${v.from}" (slots: ${clock.map((s) => s.id).join(", ")})`);
  const toIdx = v.to === "next" ? fromIdx + 1 : v.to ? clock.findIndex((s) => s.id === v.to) : clock.length;
  if (v.to && (toIdx < 0 || toIdx >= clock.length)) die(`--to: no slot "${v.to}"`);
  if (v.to && (!v.from || toIdx <= fromIdx)) die("--to needs --from, and must come after it");
  return { fromIdx, toIdx, slots: clock.slice(fromIdx, toIdx) };
};
let { fromIdx, toIdx, slots } = runSlots();
const t0 = Date.now();

// ── beds (measured once) ── only beds the manifest clears (#208); with none, the procedural bed (beds.js)
let beds, bedFor;
try { ({ beds, bedFor } = await loadBeds(musicDir, { log })); } catch (e) { die(e.message); }

// ── facts ──
const pack = await buildFactPack({ base: v.base || "https://scoopfeeds.com", log, crypto: useGrid, ...(v15 ? { v15 } : {}) });
// #285 earn-render: no Sport slot without sport stories; its time goes back to The Hour (two more stories)
if (v15 && slots.some((s) => s.id === "sport") && (pack.desks.sport || []).length < 2) {
  if (dropSport(clock)) {
    ({ fromIdx, toIdx, slots } = runSlots());
    log(`sport: ${(pack.desks.sport || []).length} sport stor${(pack.desks.sport || []).length === 1 ? "y" : "ies"}; no Sport slot this hour, its time goes to The Hour`);
    if (checkClock(clock).length) die(`clock is broken after dropping the Sport slot: ${checkClock(clock).join("; ")}`);
  }
}
if (v15) log(`clock: ${musicSecs(clock)} s of music blocks this hour`);
if (midterms || night) {
  pack.election = elFixture ? extractElectionPack(fixtureArticles(elFixture, nightWin), { now: pack.builtAt })
    : await buildElectionPack({ base: v.base || "https://scoopfeeds.com", log, now: pack.builtAt });
  if (elFixture) log(`election pack from the fixture ${path.basename(elFixture)} (rehearsal)`);
  pack.desks.midterms = pack.election.stories;
  log(`election pack: ${pack.election.items.length} attributed item(s), ${pack.election.races.filter((r) => r.status === "conflict").length} conflict(s), ${pack.election.refused.length} refused, ${pack.election.stories.length} stories`);
}
// #201: developing stories aired in the last hours and still growing lead the headlines
if (v.developing) {
  try { addDevelopingStories(pack, JSON.parse(fs.readFileSync(path.resolve(v.developing.replace(/^~/, process.env.HOME)), "utf8")).stories, { log }); }
  catch (e) { log(`developing follow-ups unreadable (${e.message}); none carried`); }
}
// #245: mark every market row whose last trade is not from the day the first Markets Now airs (weekend, holiday,
// before the open). The writer is told, checkSegments drops a closed row read as today's, airCheck re-checks.
labelMarkets(pack, (slots.find((s) => s.segment === "markets")?.start ?? hourStart) + 60_000);
// #304: the Long Read's own fact base, so the hour's checks and the screen read its story (factPack.storyIndex)
if (longRead) pack.longread = { id: longRead.piece.id, story: longRead.piece.story };
fs.writeFileSync(path.join(out, "pack.json"), JSON.stringify(pack, null, 1));
log(`fact pack: ${pack.top.length} top stories, desks ${Object.entries(pack.desks).map(([k, l]) => `${k}:${l.length}`).join(" ")}, ${pack.markets.length} market rows, ${pack.weather.length} cities, ${pack.dropped.length} articles dropped by Rule 0`);
if (pack.top.length < 5) log(`WARNING: only ${pack.top.length} top stories`);

// No market figures, no Markets Now: those slots become headlines and music rather than air an empty segment.
if (pack.markets.length < 3) {
  for (const s of slots) if (s.segment === "markets") { s.kind = "music"; s.segment = null; s.title = null; }
  log(`WARNING: only ${pack.markets.length} market rows; Markets Now slots turned into headlines and music`);
}
// #283: the Crypto segment's state is recorded in programme.json (`crypto`) and reported by airCheck; never silent
const cryptoNote = cryptoForRun(slots, pack, { useGrid, special: night === "special", fullRun: !v.to && fromIdx === 0 });
if (cryptoNote?.status === "on air") log(`crypto: ${pack.crypto.length} rows (${pack.crypto.map((c) => c.sym).join(" ")}) for the Crypto segment`);
else if (cryptoNote?.status === "feed unavailable") log(`WARNING: ${cryptoNote.why}; the Crypto slot turned into headlines and music`);
else if (cryptoNote) log(cryptoNote.why);
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
  // #245: no exchange in session when the slot airs -> the markets prompt says the markets are closed
  marketsClosed: Object.fromEntries(slots.filter((s) => s.segment === "markets").map((s) => [s.id, marketsShutAt(s.start + 60_000)])),
};
// grid hours: Markets Now leads with the exchanges in session (read by the markets prompt once #195 lands)
if (useGrid) when.marketsLead = Object.fromEntries(slots.filter((s) => s.segment === "markets").map((s) => [s.id, s.marketsLead || []]));
const spoken = slots.filter((s) => s.kind === "spoken");
// #284: two presenters (RADIO_DUO=1, dark by default); null leaves every line on the one voice, as before
const cast = loadPresenters();
if (cast) when.duo = true;
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
// #198: the update slots of the special are mechanical placeholders here (update.mjs re-produces each before it airs)
// nothing to write (a Crypto splice whose feed is down is music only): no Claude call
try { raw = spoken.some((s) => !s.mechanical) ? await writeSegments(pack, spoken.filter((s) => !s.mechanical), when, { write: counted, log }) : {}; }
finally { saveWriterLog(); }
if (night === "special") {
  for (const s of spoken.filter((x) => UPDATE_ID.test(x.id))) {
    raw[s.id] = mechanicalUpdate(pack.election, s, nightWin);
    const g = addPollCloseLines(raw, s, nightWin);
    if (g.length) log(`${s.id}: poll closings ${g.map((x) => `${new Date(x.at).toISOString().slice(11, 16)} UTC (${x.states.join(" ")})`).join("; ")}`);
  }
}
// #304: the Long Read was written and checked when it was made; it is checked again below, with the rest of the hour
if (longRead && spoken.some((s) => s.id === LONGREAD_SLOT)) raw[LONGREAD_SLOT] = longRead.piece.segment;
// #283: a splice run (--to) adds its segments to those of earlier splices of the same hour (a repeat's fresh The Hour,
// then its fresh Crypto); prepareRepeat leaves the repeated hour's own segments out, as repeat-source-segments.json
const earlier = (f, empty) => { if (!v.to) return empty; try { return JSON.parse(fs.readFileSync(path.join(out, f), "utf8")) ?? empty; } catch { return empty; } };
const merged = (f, now) => (Array.isArray(now) ? [...[earlier(f, [])].flat(), ...now] : { ...earlier(f, {}), ...now });
fs.writeFileSync(path.join(out, "segments.raw.json"), JSON.stringify(merged("segments.raw.json", raw), null, 1));
if (midterms) addBallotLines(raw, hourStart);   // mechanical "what's on the ballot" lines, checked like the rest
const { segments: checked, report } = checkSegments(raw, spoken, pack, { log });
const segments = castSegments(checked, spoken, cast, { log });   // #284: RADIO_DUO, else returned unchanged
fs.writeFileSync(path.join(out, "segments.json"), JSON.stringify(merged("segments.json", segments), null, 1));
fs.writeFileSync(path.join(out, "checks.json"), JSON.stringify(merged("checks.json", report), null, 1));
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
// 1 Nov (DrJ): the election screens' clock (poll closings ahead) and the election window on the rail. The window runs
// on election day (from 24 h before the special), through the special and the counting days; never before.
const electionCtx = pack.election ? electionContext(Math.max(hourStart, pack.builtAt || 0), nightWin) : null;
const windowOn = !!pack.election && (night || hourStart >= nightWin.from - 24 * 3600_000) && hourStart < nightWin.dayAfterUntil;
const { cues, report: mixReport, lines } = await assemble({
  slots, segments, pack, hourStart, bedFor, film, filmUrl: "/programme/film.webm", feature, voice, outWav: path.join(out, partFile + ".tmp"), log, seriesCards: SERIES, electionCtx,
  creditFor: (file) => screenCredit(Object.values(beds).find((b) => b.file === file)?.entry || null),
});
// atomic: a part is never rewritten in place (the playout may be reading it, and a repeat hour may hard-link it)
fs.renameSync(path.join(out, partFile + ".tmp"), path.join(out, partFile));

// ── programme.json ──
const pf = path.join(out, "programme.json");
const cut = slots[0].start;
// under the programme lock: a developing bulletin (#201, bulletin.mjs) may be splicing into the same file
withProgrammeLock(out, () => {
  let prog = { version: 1, hourStart, endsAt: clock.at(-1).end, audio: [], cues: [], slots: [] };
  if (fromIdx > 0 && fs.existsSync(pf)) prog = JSON.parse(fs.readFileSync(pf, "utf8"));
  if (v.to) {
    // Splice [cut, resumeAt) into the existing programme. At resumeAt the playout switches back to whichever part was
    // playing there, seeking from that part's own origin (`origin`), so the rest of the hour plays as before.
    prog = spliceProgramme(prog, { cut, resumeAt: clock[toIdx].start, partFile, cues, lines,
      slots: slots.map(({ id, kind, start, end, title, elements }) => ({ id, kind, start, end, title: title || null, ...(elements ? { elements } : {}) })) });
  } else {
    prog.audio = prog.audio.filter((a) => a.from < cut).concat([{ file: partFile, from: cut }]);
    prog.cues = prog.cues.filter((c) => c.at < cut).concat(cues);
    // #273: where each voiced line sits, for the listen-back in airCheck
    prog.lines = (prog.lines || []).filter((l) => l.at < cut).concat(lines);
    prog.slots = clock.map(({ id, kind, start, end, title, elements }) => ({ id, kind, start, end, title: title || null, ...(elements ? { elements } : {}) }));
    // #285: a v1.5 refresh keeps the slots already aired (the Sport slot may have given its time to The Hour there)
    if (v15 && fromIdx > 0 && Array.isArray(existingProg?.slots)) prog.slots = [...existingProg.slots.filter((s) => s.end <= cut), ...prog.slots.filter((s) => s.start >= cut)];
    // #201: a refresh keeps the developing bulletins already spliced into this hour
    if (fromIdx > 0 && (prog.inserts || []).length) prog = reapplyInserts(prog, prog.inserts, cut);
  }
  if (gridPlan) prog.grid = gridPlan;
  if (v15) prog.clock = "v15";   // #285: read by the screen (music shows "Coming up", not headline cards), airCheck and later partial runs
  if (night) prog.election = night;   // #198: "special" | "day-after" (airCheck, the update desk, the rehearsal report)
  // 1 Nov: the election window on the rail (totals, newest projection, next poll closing); absent = not drawn
  if (windowOn) prog.electionWindow = windowData(boardData(pack.election), { nextClose: electionCtx?.nextClose || null }); else delete prog.electionWindow;
  if (cryptoNote) prog.crypto = { ...cryptoNote, at: pack.builtAt };   // #283: read by airCheck
  if (longRead && slots.some((s) => s.id === LONGREAD_SLOT)) {   // #304
    const kept = (segments[LONGREAD_SLOT]?.lines || []).filter((l) => !l.mechanical).length;
    prog.longread = { id: longRead.piece.id, headline: longRead.piece.story.headline, status: longRead.piece.status, lines: kept, of: (longRead.piece.segment.lines || []).filter((l) => !l.mechanical).length };
  }
  // the screen's right rail (#200): markets and weather, verbatim from the pack; each block renders only with data
  // #283: in a grid hour the markets block carries Bitcoin, Ether and the top crypto mover too (factPack.railMarkets);
  // without the grid it is the five rows the screen always showed
  prog.rail = { markets: useGrid ? railMarkets(pack, { lead: [...new Set(sessionsAt(hourStart + 60_000).flatMap((x) => x.groups))] }) : pack.markets.slice(0, 5), weather: pack.weather };
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
  // #282: every market row on screen (Markets scenes, the rail) carries `closed` for the time it is shown, so the
  // screen never shows a last session's figure as live; a spliced repeat is relabelled for its own air time
  prog = labelScreenMarkets(prog);
  prog.builtAt = Date.now();
  fs.writeFileSync(pf + ".tmp", JSON.stringify(prog, null, 1));
  fs.renameSync(pf + ".tmp", pf);   // atomic: the screen and playout never read half a file
});
// #304: a produced hour that carries the piece counts as one of its airings (a refresh of the same hour does not)
if (longRead && slots.some((s) => s.id === LONGREAD_SLOT)) {
  try { recordAiring(longRead.piece.id, hourStart); } catch (e) { log(`long read: could not record the airing (${e.message})`); }
}
log(`done in ${Math.round((Date.now() - t0) / 1000)} s: ${cues.length} cues, ${Math.round(mixReport.voicedSecs)} s of speech, dropped for time ${JSON.stringify(mixReport.dropped)}; audio ${partFile} from ${new Date(cut).toISOString()}`);

/** Mechanical writer for dry runs: reads headlines, no Claude. */
async function fakeWriter() {
  const s = {};
  const top = pack.top.slice(0, 5);
  const readAtTop = new Set();
  const line = (st, id) => ({ id, story: st.id, text: `${st.outlets[0].source} reports: ${st.headline}.` });
  for (const slot of spoken) {
    const L = [];
    if (slot.segment === "the-hour" && slot.long) {   // #285: the v1.5 hour's stories, and what it read
      L.push({ id: "open", text: `It's ${when.hourLabel}, ${when.cityTimes}. This is ScoopFeeds Radio, the news, compared.` });
      pack.top.slice(0, slot.stories).forEach((st, i) => { L.push(line(st, `s${i + 1}`)); readAtTop.add(st.id); });
      L.push({ id: "close", text: "Now the next segment." });
    }
    else if (slot.segment === "half" && slot.fresh) {
      L.push({ id: "open", text: "Headlines at the half hour." });
      [...pack.top, ...Object.values(pack.desks).flat()].filter((st) => !readAtTop.has(st.id)).slice(0, slot.stories).forEach((st, i) => L.push(line(st, `h${i + 1}`)));
      L.push({ id: "close", text: "More after this." });
    }
    else if (slot.segment === "sport") { L.push({ id: "open", text: "Now the sport." }); (pack.desks.sport || []).slice(0, 3).forEach((st, i) => L.push(line(st, `d${i + 1}`))); L.push({ id: "close", text: "That's the sport." }); }
    else if (slot.segment === "the-hour") { L.push({ id: "open", text: `It's ${when.hourLabel}, ${when.cityTimes}. This is ScoopFeeds Radio, the news, compared.` }); top.forEach((st, i) => L.push(line(st, `s${i + 1}`))); L.push({ id: "close", text: "Markets Now, after this." }); }
    else if (slot.segment === "half") { L.push({ id: "open", text: "Headlines at the half hour." }); top.forEach((st, i) => L.push(line(st, `h${i + 1}`))); }
    else if (slot.segment === "desk") { const d = pack.desks[slot.desk] || []; L.push({ id: "open", text: `On the ${slot.title}.` }); d.slice(0, 3).forEach((st, i) => L.push(line(st, `d${i + 1}`))); L.push({ id: "close", text: "That's the desk." }); }
    else if (slot.segment === "markets") pack.markets.forEach((m, i) => L.push({ id: `m${i + 1}`, story: null, text: m.closed
      ? `${m.closed.weekday ? `On ${m.closed.weekday}, ` : "At its last close, "}${m.key} closed at ${Math.round(m.price)}, ${m.pct >= 0 ? "up" : "down"} ${Math.abs(m.pct).toFixed(1)} percent.`
      : `${m.key} at ${Math.round(m.price)}, ${m.pct >= 0 ? "up" : "down"} ${Math.abs(m.pct).toFixed(1)} percent.` }));
    else if (slot.segment === "crypto") (pack.crypto || []).slice(0, 4).forEach((c, i) => L.push({ id: `c${i + 1}`, story: null, text: `${c.key} at ${Math.round(c.price)} dollars.` }));
    else if (slot.segment === "weather") pack.weather.forEach((w, i) => L.push({ id: `w${i + 1}`, story: null, text: `${w.city}, ${w.c} degrees Celsius, ${w.condition}.` }));
    else if (slot.segment === "midterms") {
      L.push({ id: "open", text: "The Midterms, on ScoopFeeds Radio." });
      (pack.desks.midterms || []).slice(0, 2).forEach((st, i) => L.push(line(st, `e${i + 1}`)));
      (pack.election?.races || []).flatMap((r) => r.calls).slice(0, 4).forEach((c, i) => L.push({ id: `p${i + 1}`, story: null, text: c.quote }));
      L.push({ id: "close", text: "That's the Midterms desk." });
    }
    else if (slot.segment === "roundup" || slot.segment === "results") {   // #198
      const ep = pack.election;
      L.push({ id: "open", text: slot.segment === "roundup" ? "This is ScoopFeeds Radio's election night special." : `${slot.title}.` });
      const proj = projectionLines(ep, { budget: 150, focus: slot.segment === "results" ? slot.focus : null });
      if (proj.length) L.push(...proj.map(({ mechanical, ...l }) => l));
      else L.push({ id: "p1", story: null, text: "No news organisation has made a projection in these races yet." });
      (pack.desks.midterms || []).slice(0, 2).forEach((st, i) => L.push(line(st, `e${i + 1}`)));
      L.push({ id: "close", text: "Counting continues." });
    }
    else if (slot.segment === "counting") { s[slot.id] = { lines: mechanicalCounting(pack.election, slot).lines.map(({ mechanical, ...l }) => l) }; continue; }
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
