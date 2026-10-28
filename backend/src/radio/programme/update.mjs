#!/usr/bin/env node
/**
 * update.mjs - produce one 15-minute election update (#198) and splice it over its placeholder in an hour's
 * programme.json. Called by the rolling station a few minutes before the slot airs (rolling.mjs); runnable by hand.
 * A fresh election pack (or the rehearsal fixture), the writer (Claude, or the mechanical update when the writer is
 * busy or the cost guard is on), the poll closings due in that quarter, checks.js, voice, mix, splice. Writes into
 * --dir: update-<slot>-<tag>.json (pack, raw and checked lines, drops) and part-<slot>-<tag>.wav.
 *
 *   node src/radio/programme/update.mjs --dir ~/scoopfeeds-radio/air/2026-11-04T01 --slot update-15 \
 *        --music-dir DIR [--writer claude|headlines] [--fake-voice] [--fake-writer]
 *        [--election-fixture FILE --election-start ISO]   (the dress rehearsal)
 * Exit 0: spliced in. Exit 3: nothing survived the checks (skipped: the placeholder airs). Anything else: failed
 * (the placeholder airs).
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { assemble, fakeVoice, kokoroVoice } from "./assemble.js";
import { claudeWriter, isLimitError, writeSegments } from "./writer.js";
import { loadBeds } from "./beds.js";
import { checkSegments } from "./checks.js";
import { screenCredit } from "../musicManifest.js";
import { buildElectionPack, extractElectionPack } from "./electionPack.js";
import { addPollCloseLines, mechanicalUpdate, insertUpdate, nightWindow, fixtureArticles, UPDATE_ID } from "./electionNight.js";

const { values: v } = parseArgs({ options: {
  dir: { type: "string" }, slot: { type: "string" }, "music-dir": { type: "string" }, writer: { type: "string", default: "claude" },
  "fake-voice": { type: "boolean" }, "fake-writer": { type: "boolean" }, model: { type: "string" }, base: { type: "string" },
  "election-fixture": { type: "string" }, "election-start": { type: "string" },
} });
const log = (m) => console.log(`🗳 update: ${m}`);
const die = (m, code = 2) => { console.error(`🗳 update: ${m}`); process.exit(code); };
const home = (p) => path.resolve(String(p).replace(/^~/, process.env.HOME));

if (!v.dir || !UPDATE_ID.test(v.slot || "")) die("--dir and --slot update-00|15|30|45 are required");
const dir = home(v.dir);
const prog0 = JSON.parse(fs.readFileSync(path.join(dir, "programme.json"), "utf8"));
const H = prog0.hourStart;
const ps = (prog0.slots || []).find((s) => s.id === v.slot);
if (!ps) die(`no slot ${v.slot} in this programme`);
if (Date.now() > ps.start - 5_000) die(`too late: ${v.slot} airs at ${new Date(ps.start).toISOString()}`, 4);
const night = nightWindow(v["election-start"] ? { startAt: Date.parse(v["election-start"]) } : {});
const sec = (ms) => Math.round((ms - H) / 1000);
const slot = { id: v.slot, kind: "spoken", segment: "update", title: "Election update", sting: v.slot !== "update-00", daypart: "evening",
  startSec: sec(ps.start), endSec: sec(ps.end), lenSec: sec(ps.end) - sec(ps.start), start: ps.start, end: ps.end };
const tag = `${v.slot}-${Date.now().toString(36)}`;

// ── facts: a fresh election pack, nothing else ──
const now = Date.now();
const election = v["election-fixture"] ? extractElectionPack(fixtureArticles(home(v["election-fixture"]), night), { now })
  : await buildElectionPack({ base: v.base || "https://scoopfeeds.com", log, now });
const pack = { builtAt: now, state: null, top: [], desks: { midterms: election.stories }, markets: [], weather: [], dropped: [], election };
log(`election pack: ${election.items.length} attributed item(s), ${election.races.filter((r) => r.status === "conflict").length} conflict(s), ${election.refused.length} refused`);

// ── words ──
const useClaude = v.writer === "claude" && !v["fake-writer"];
const run = { at: now, from: slot.id, to: null, kind: "election-update", writer: useClaude ? "claude" : "headlines", calls: 0, failures: 0, limitHit: false, errors: [] };
let raw = null;
if (useClaude) {
  const write = claudeWriter({ model: v.model || "sonnet", timeoutMs: 120_000, log });
  try { run.calls++; raw = await writeSegments(pack, [slot], { hourLabel: "", cityTimes: "", marketsAsOf: {} }, { write, log }); }
  catch (e) { run.failures++; run.limitHit ||= isLimitError(e.message); run.errors.push(String(e.message).slice(0, 200)); log(`writer failed (${e.message}); the mechanical update reads it instead`); raw = null; }
}
{
  const f = path.join(dir, "writer.json");
  let w = { runs: [] };
  try { w = JSON.parse(fs.readFileSync(f, "utf8")); if (!Array.isArray(w.runs)) w = { runs: [] }; } catch { /* first run */ }
  w.runs.push(run);
  w.calls = w.runs.reduce((n, r) => n + (r.calls || 0), 0);
  w.failures = w.runs.reduce((n, r) => n + (r.failures || 0), 0);
  w.limitHit = w.runs.some((r) => r.limitHit);
  fs.writeFileSync(f, JSON.stringify(w, null, 1));
}
if (!raw?.[slot.id]) { raw = { [slot.id]: mechanicalUpdate(election, slot, night) }; run.writer = useClaude ? "claude-failed-mechanical" : "mechanical"; }
const closings = addPollCloseLines(raw, slot, night);
const { segments, report } = checkSegments(raw, [slot], pack, { log });
const kept = segments[slot.id]?.lines || [];
const record = { slot, at: now, writer: run.writer, closings, pack: { election }, raw: raw[slot.id], checked: segments[slot.id] || null, drops: report };
fs.writeFileSync(path.join(dir, `update-${tag}.json`), JSON.stringify(record, null, 1));
for (const d of report) log(`✂ ${d.line || ""}: ${d.drop}`);
// an update with nothing beyond its opening line is not an update: skip it, the placeholder airs
if (kept.filter((l) => l.id !== "open").length === 0) die("nothing survived the checks: skipped (the placeholder airs)", 3);

// ── voice, mix, cues ──
let bedFor, beds;
try { ({ beds, bedFor } = await loadBeds(home(v["music-dir"] || "~/scoopfeeds-radio/music"), { log })); } catch (e) { die(e.message); }
const voice = v["fake-voice"] ? fakeVoice(path.join(dir, "fake-voice")) : await kokoroVoice();
const partFile = `part-${tag}.wav`;
const { cues, report: mix, lines } = await assemble({
  slots: [slot], segments, pack, hourStart: H, bedFor, defaultDaypart: "evening", voice, outWav: path.join(dir, `${partFile}.tmp`), log,
  creditFor: (file) => screenCredit(Object.values(beds).find((b) => b.file === file)?.entry || null),
});
if (!(mix.voicedSecs > 0)) die("no line could be voiced: skipped (the placeholder airs)", 3);
fs.renameSync(path.join(dir, `${partFile}.tmp`), path.join(dir, partFile));

// ── splice ──
try { insertUpdate(dir, { id: slot.id, cut: slot.start, end: slot.end, resumeAt: slot.end, partFile, cues, lines, at: Date.now(), writer: run.writer, kept: kept.length, dropped: report.length }); }
catch (e) { die(`not spliced: ${e.message}`, 4); }
log(`spliced ${slot.id} at ${new Date(slot.start).toISOString()} (${Math.round(mix.voicedSecs)} s of speech, ${kept.length} lines, ${report.length} dropped, ${closings.length} poll closing(s), ${run.writer} writer) in ${Math.round((Date.now() - now) / 1000)} s`);
