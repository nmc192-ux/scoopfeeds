#!/usr/bin/env node
/**
 * bulletin.mjs - produce one "Developing" bulletin (#201) and splice it into an hour's programme.json.
 * Called by the rolling station (rolling.mjs) when developingDesk.js finds a boundary; runnable by hand for a
 * rehearsal. Writes into --dir: developing-<tag>.json (the event, raw and checked lines, drops) and
 * part-developing-<tag>.wav, then splices programme.json under its lock. The playout re-reads programme.json and
 * swaps its feeder onto the bulletin at the boundary, then back to the hour's own audio at the next segment.
 *
 *   node src/radio/programme/bulletin.mjs --dir ~/scoopfeeds-radio/air/2026-10-27T18 --event ev.json \
 *        --cut <ms> --end <ms> --resume <ms> [--next-title T --next-at <ms>] [--slot <id>] --music-dir DIR \
 *        [--writer claude|headlines] [--fake-voice] [--fake-writer]
 * Exit 0: inserted. Exit 3: nothing survived the checks (no bulletin airs). Anything else: failed.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { assemble, fakeVoice, kokoroVoice } from "./assemble.js";
import { wordBudget } from "./clock.js";
import { claudeWriter, isLimitError } from "./writer.js";
import { loadBeds } from "./beds.js";
import { loadPresenters, castSegments } from "./presenters.js";
import { screenCredit } from "../musicManifest.js";
import { daypartAt } from "../musicLibrary.js";
import { bulletinPack, bulletinPrompt, BULLETIN_SYSTEM, mechanicalBulletin, checkBulletin, insertBulletin } from "./developingDesk.js";

const { values: v } = parseArgs({ options: {
  dir: { type: "string" }, event: { type: "string" }, cut: { type: "string" }, end: { type: "string" }, resume: { type: "string" },
  "next-title": { type: "string" }, "next-at": { type: "string" }, slot: { type: "string" }, "music-dir": { type: "string" },
  writer: { type: "string", default: "claude" }, "fake-voice": { type: "boolean" }, "fake-writer": { type: "boolean" }, model: { type: "string" },
} });
const log = (m) => console.log(`🚨 bulletin: ${m}`);
const die = (m, code = 2) => { console.error(`🚨 bulletin: ${m}`); process.exit(code); };
const home = (p) => path.resolve(String(p).replace(/^~/, process.env.HOME));

if (!v.dir || !v.event) die("--dir and --event are required");
const dir = home(v.dir);
const ev = JSON.parse(fs.readFileSync(home(v.event), "utf8"));
const cut = Number(v.cut), end = Number(v.end), resumeAt = Number(v.resume);
if (![cut, end, resumeAt].every(Number.isFinite) || !(cut < end && end <= resumeAt)) die("--cut < --end <= --resume (epoch ms) are required");
const prog0 = JSON.parse(fs.readFileSync(path.join(dir, "programme.json"), "utf8"));
const H = prog0.hourStart;
const tag = `${new Date(cut).toISOString().slice(11, 16).replace(":", "")}-${Date.now().toString(36)}`;
const sec = (ms) => Math.round((ms - H) / 1000);
const sensitive = !!ev.sensitive;
const daypart = daypartAt(new Date(cut));
const slot = { id: `developing-${tag}`, kind: "spoken", segment: "developing", title: "Developing story", banner: "Breaking",
  sting: !sensitive, noBed: sensitive, daypart, startSec: sec(cut), endSec: sec(end), lenSec: sec(end) - sec(cut), start: cut, end };
const slots = [slot];
if (end < resumeAt) slots.push({ id: `developing-${tag}-resume`, kind: "music", daypart, startSec: sec(end), endSec: sec(resumeAt), lenSec: sec(resumeAt) - sec(end), start: end, end: resumeAt,
  ...(v["next-title"] ? { nextTitle: v["next-title"], nextAt: sec(Number(v["next-at"])) } : {}) });

// ── words ──
const pack = bulletinPack(ev, Date.now());
const useClaude = v.writer === "claude" && !v["fake-writer"];
const run = { at: Date.now(), from: slot.id, to: null, kind: "developing", writer: useClaude ? "claude" : "headlines", calls: 0, failures: 0, limitHit: false, errors: [] };
const saveWriterLog = () => {
  const f = path.join(dir, "writer.json");
  let w = { runs: [] };
  try { w = JSON.parse(fs.readFileSync(f, "utf8")); if (!Array.isArray(w.runs)) w = { runs: [] }; } catch { /* first run */ }
  w.runs.push(run);
  w.calls = w.runs.reduce((n, r) => n + (r.calls || 0), 0);
  w.failures = w.runs.reduce((n, r) => n + (r.failures || 0), 0);
  w.limitHit = w.runs.some((r) => r.limitHit);
  fs.writeFileSync(f, JSON.stringify(w, null, 1));
};
let raw = null;
if (useClaude) {
  const write = claudeWriter({ model: v.model || "sonnet", timeoutMs: 120_000, log });
  // the open and close lines are ours (~16 words); the model gets the rest of the slot
  const budget = Math.max(30, wordBudget(slot) - 16);
  try { run.calls++; raw = await write(BULLETIN_SYSTEM, bulletinPrompt(pack, budget)); }
  catch (e) { run.failures++; run.limitHit ||= isLimitError(e.message); run.errors.push(String(e.message).slice(0, 200)); log(`writer failed (${e.message}); the headline writer reads it instead`); }
}
saveWriterLog();
if (!raw) { raw = mechanicalBulletin(pack); run.writer = useClaude ? "claude-failed-headlines" : "headlines"; }
const checked = checkBulletin(raw, slot, pack);
const record = { event: ev, slot, raw, checked: checked.segment, drops: checked.report, writer: run.writer, at: Date.now() };
fs.writeFileSync(path.join(dir, `developing-${tag}.json`), JSON.stringify(record, null, 1));
for (const d of checked.report) log(`✂ ${d.line || ""}: ${d.drop}`);
if (!checked.ok) die("nothing survived the checks: no bulletin airs (the story goes to the headlines)", 3);

// ── voice, mix, cues ──
let bedFor, beds;
try { ({ beds, bedFor } = await loadBeds(home(v["music-dir"] || "~/scoopfeeds-radio/music"), { log })); } catch (e) { die(e.message); }
const voice = v["fake-voice"] ? fakeVoice(path.join(dir, "fake-voice")) : await kokoroVoice();
const partFile = `part-developing-${tag}.wav`;
const { cues, report, lines } = await assemble({
  // #284: castSegments casts the lines for two presenters with RADIO_DUO=1, else returns them unchanged
  slots, segments: castSegments({ [slot.id]: checked.segment }, slots, loadPresenters(), { log }), pack, hourStart: H, bedFor, defaultDaypart: daypart, voice, outWav: path.join(dir, `${partFile}.tmp`), log,
  creditFor: (file) => screenCredit(Object.values(beds).find((b) => b.file === file)?.entry || null),
});
if (!(report.voicedSecs > 0)) die("no line could be voiced: no bulletin airs");
fs.renameSync(path.join(dir, `${partFile}.tmp`), path.join(dir, partFile));

// ── splice ──
try {
  insertBulletin(dir, { id: slot.id, eventId: ev.id, title: slot.title, cut, end, resumeAt, partFile, cues, lines, sensitive, headline: ev.headline, slot: v.slot || null, at: Date.now() });
} catch (e) { die(`not inserted: ${e.message}`, 4); }
log(`inserted "${ev.headline}" at ${new Date(cut).toISOString()} for ${Math.round((end - cut) / 1000)} s (${Math.round(report.voicedSecs)} s of speech, ${checked.segment.lines.length} lines, ${checked.report.length} dropped${sensitive ? ", no bed: sensitive" : ""}); the grid resumes at ${new Date(resumeAt).toISOString()}`);
