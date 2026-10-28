// clockV15.test.js - #285 (DrJ's rehearsal notes, #281 note 1): the v1.5 clock behind RADIO_CLOCK_V15. Longer
// bulletins (The Hour: 7 stories, world, business, sport, each the headline plus 3-4 sentences), a Sport slot that
// earn-renders, a half-hour that reads only stories The Hour did not read, music blocks of 90 s at most (6 minutes an
// hour at most), "Coming up" instead of headline cards during music, and with the flag off the clock is today's.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildClock, buildGridClock, checkClock, clockV15, dropSport, musicSecs, wordBudget, FEATURE_AT, FEATURE_MAX, V15_MUSIC_MAX_SEC, V15_MUSIC_HOUR_MAX_SEC } from "./clock.js";
import { checkSegments, freshHalf, sameStoryAs, NO_CHANGE } from "./checks.js";
import { buildPrompt } from "./writer.js";
import { addDeskToClock } from "./electionDesk.js";
import { addCountingDesk } from "./electionNight.js";
import { airCheck, v15Report } from "./airCheck.js";
import { musicDonor, cutSlotToMusic, cutRepeatCrypto } from "./repeat.js";
import { writeHourAudio } from "../../testing/radioWav.js";

const H = Date.parse("2026-10-27T14:00:00Z");   // Tue 10:00 New York
const ids = (c) => c.map((s) => s.id);
const when = { hourLabel: "ten in the morning in New York", cityTimes: "seven in the evening in Karachi", marketsAsOf: {} };

// Today's running order, written out: with the flag off the hour must be exactly this.
const TODAY = [
  ["countdown", -900, -4], ["ident-top", -4, 6], ["the-hour", 6, 360], ["markets-1", 360, 480], ["compared-1", 480, 840],
  ["music-1", 840, 1200], ["desk-me", 1200, 1380], ["desk-us", 1380, 1560], ["film", 1560, 1620], ["series", 1620, 1710],
  ["music-2", 1710, 1792], ["ident-half", 1792, 1800], ["half", 1800, 1980], ["weather", 1980, 2070], ["desk-tech", 2070, 2250],
  ["music-3", 2250, 2640], ["desk-biz", 2640, 2820], ["compared-2", 2820, 3060], ["markets-2", 3060, 3150], ["music-4", 3150, 3480],
  ["signoff", 3480, 3525], ["ident-end", 3525, 3533], ["endcard", 3533, 3630],
];

test("the flag: on only when RADIO_CLOCK_V15 is literally \"1\"", () => {
  for (const v of [undefined, "", "0", "true", "yes", " 1"]) assert.equal(clockV15(v === undefined ? {} : { RADIO_CLOCK_V15: v }), false, String(v));
  assert.equal(clockV15({ RADIO_CLOCK_V15: "1" }), true);
});

test("flag off: the clock is exactly today's, with and without the grid, a feature, the film or the weather", () => {
  assert.deepEqual(buildClock(H).map((s) => [s.id, s.startSec, s.endSec]), TODAY);
  for (const o of [{}, { film: false }, { weather: false }, { featureSec: 756, featureTitle: "A-Eye" }]) {
    assert.deepEqual(buildClock(H, { ...o, v15: false }), buildClock(H, o), JSON.stringify(o));
    assert.deepEqual(buildGridClock(H, { ...o, v15: false }), buildGridClock(H, o), JSON.stringify(o));
  }
  assert.ok(buildClock(H).every((s) => !("cryptoDonor" in s) && !("electionDonor" in s) && !s.fresh && !s.long));
  assert.equal(buildClock(H).find((s) => s.id === "desk-tech").title, "Tech and AI desk");
});

const COMBOS = [];
for (const film of [true, false]) for (const weather of [true, false]) for (const featureSec of [0, 300, 700, FEATURE_MAX]) COMBOS.push({ film, weather, featureSec });

test("flag on: checkClock passes and no hour carries more than 6 minutes of music, no block over 90 s", () => {
  for (const o of COMBOS) {
    const c = buildClock(H, { ...o, v15: true });
    assert.deepEqual(checkClock(c), [], JSON.stringify(o));
    assert.ok(musicSecs(c) <= V15_MUSIC_HOUR_MAX_SEC, `${JSON.stringify(o)}: ${musicSecs(c)} s of music`);
    for (const m of c.filter((s) => s.kind === "music" && s.startSec >= 0)) assert.ok(m.lenSec <= V15_MUSIC_MAX_SEC, `${JSON.stringify(o)}: ${m.id} is ${m.lenSec} s`);
  }
  // across the 24 grid hours (feature at 9 pm ET, weather every 2 hours, Crypto everywhere)
  for (let h = 0; h < 24; h++) {
    for (const film of [true, false]) {
      const { slots } = buildGridClock(H - 10 * 3600_000 + h * 3600_000, { v15: true, film, featureSec: 700 });
      assert.deepEqual(checkClock(slots), [], `${h}:00 ET`);
      assert.ok(musicSecs(slots) <= V15_MUSIC_HOUR_MAX_SEC, `${h}:00 ET: ${musicSecs(slots)} s`);
      assert.ok(slots.some((s) => s.id === "crypto" && s.kind === "spoken" && s.lenSec === 90), `${h}:00 ET: Crypto`);
    }
  }
  // the numbers DrJ asked for: about 6 minutes, down from about 19
  assert.equal(musicSecs(buildClock(H, { v15: true })), 270);
  assert.equal(musicSecs(buildClock(H, { v15: true, film: false })), 330);
  assert.equal(musicSecs(buildGridClock(H, { v15: true }).slots), 180);
  assert.equal(musicSecs(buildClock(H)), 1162);
});

test("flag on: The Hour is 7 long stories, Sport follows it, then Markets Now; the desk is Science, Tech and AI", () => {
  const c = buildClock(H, { v15: true });
  assert.deepEqual(ids(c).slice(0, 5), ["countdown", "ident-top", "the-hour", "sport", "markets-1"]);
  const hour = c.find((s) => s.id === "the-hour");
  assert.deepEqual([hour.stories, hour.long, hour.lenSec], [7, true, 600]);
  assert.ok(wordBudget(hour) >= 7 * 140 + 40, "room for 7 stories of 140-190 words and the open");
  const sp = c.find((s) => s.id === "sport");
  assert.deepEqual([sp.kind, sp.segment, sp.lenSec], ["spoken", "sport", 180]);
  assert.equal(c.find((s) => s.id === "desk-tech").title, "Science, Tech and AI");
  assert.deepEqual([c.find((s) => s.id === "half").fresh, c.find((s) => s.id === "half").stories], [true, 3]);
  // the second half's head is today's, so the feature still starts at FEATURE_AT and the same FEATURE_MAX fits
  assert.equal(c.find((s) => s.id === "desk-tech").endSec, FEATURE_AT);
  const f = buildClock(H, { v15: true, featureSec: FEATURE_MAX });
  assert.deepEqual(ids(f).slice(-6), ["feature", "desk-biz", "markets-2", "signoff", "ident-end", "endcard"]);
  assert.throws(() => buildClock(H, { v15: true, featureSec: FEATURE_MAX + 1 }));
  // the repeat's top splice (--from the-hour --to markets-1) still finds both slots
  assert.ok(ids(c).indexOf("markets-1") > ids(c).indexOf("the-hour"));
});

test("Sport earn-renders: no sport stories, The Hour runs on to the Sport slot's end and reads two more stories", () => {
  const c = buildClock(H, { v15: true });
  assert.equal(dropSport(c), true);
  assert.deepEqual(checkClock(c), []);
  assert.ok(!ids(c).includes("sport"));
  const hour = c.find((s) => s.id === "the-hour");
  assert.deepEqual([hour.startSec, hour.endSec, hour.stories, hour.sportDropped], [6, 786, 9, true]);
  assert.equal(ids(c)[ids(c).indexOf("the-hour") + 1], "markets-1");
  assert.equal(dropSport(c), false, "nothing to drop twice");
  assert.equal(dropSport(buildClock(H)), false, "the old clock has no Sport slot");
  // the prompt does not ask for a sport story once the slot is gone
  const p = buildPrompt({ top: [], desks: { sport: [] }, markets: [], weather: [] }, [hour], when);
  assert.match(p, /exactly 9 story lines/);
  assert.doesNotMatch(p, /sport story/);
});

test("Crypto in a v1.5 grid hour takes the whole of music-1; music-3 and music-4 stay as repeat donors (#249)", () => {
  const { slots } = buildGridClock(H, { v15: true });
  assert.ok(!ids(slots).includes("music-1"));
  const c = slots.find((s) => s.id === "crypto");
  assert.deepEqual([c.startSec, c.endSec, c.segment, c.sting], [1296, 1386, "crypto", true]);
  assert.ok(!("cryptoDonor" in c));
  const music = slots.filter((s) => s.kind === "music" && s.startSec >= 0);
  assert.deepEqual(music.map((s) => [s.id, s.lenSec]), [["music-3", 90], ["music-4", 90]]);
  assert.ok(music.some((s) => s.lenSec >= 60), "at least one music slot of 60 s or more");
});

test("the Midterms desk and the counting desk take the US desk's slot in the v1.5 clock; old clock unchanged", () => {
  for (const add of [addDeskToClock, addCountingDesk]) {
    const c = buildGridClock(H, { v15: true }).slots;
    const us = c.find((s) => s.id === "desk-us");
    const d = add(c, H);
    assert.ok(d, add.name);
    assert.deepEqual([d.startSec, d.endSec, d.lenSec], [us.startSec, us.endSec, 180]);
    assert.ok(!ids(c).includes("desk-us"));
    assert.deepEqual(checkClock(c), []);
    assert.ok(musicSecs(c) <= V15_MUSIC_HOUR_MAX_SEC);
    const old = buildClock(H);
    assert.deepEqual([add(old, H).startSec, old.find((s) => s.id === "music-1").startSec], [840, 1020], `${add.name}: old clock`);
  }
});

// ── a fixture hour ───────────────────────────────────────────────────────────

const outlet = (source, title, description = "") => ({ source, title, description });
const story = (id, headline, outlets) => ({ id, headline, outlets, count: outlets.length });
const PACK = {
  builtAt: H, markets: [], weather: [],
  top: [
    story("t1", "Ceasefire talks resume in Cairo", [outlet("Reuters", "Ceasefire talks resume in Cairo", "Negotiators met for 6 hours on Tuesday."), outlet("BBC News", "Cairo hosts new round of truce talks", "")]),
    story("t2", "UN warns of food shortages in Sudan", [outlet("Al Jazeera", "UN warns of food shortages in Sudan", "The World Food Programme said 25 million people need aid.")]),
    story("t3", "European leaders meet on energy prices", [outlet("Financial Times", "European leaders meet on energy prices", "")]),
    story("t4", "Japan's prime minister calls snap election", [outlet("Nikkei Asia", "Japan's prime minister calls snap election", "")]),
    story("t5", "Central bank holds rates steady", [outlet("Bloomberg", "Central bank holds rates steady", "")]),
    story("t6", "Carmaker recalls electric vans", [outlet("CNBC", "Carmaker recalls electric vans", "")]),
    story("t7", "Wildfire forces evacuations in Greece", [outlet("AP", "Wildfire forces evacuations in Greece", "")]),
    story("t8", "Mexico opens new rail line", [outlet("Reuters", "Mexico opens new rail line", "")]),
    story("t9", "Climate summit names new host city", [outlet("The Guardian", "Climate summit names new host city", "")]),
  ],
  desks: {
    business: [story("bu1", "Central bank keeps rates on hold", [outlet("Bloomberg", "Central bank holds rates steady", "")])],   // t5 under another id
    sport: [story("sp1", "Champions League: holders win away", [outlet("ESPN", "Champions League: holders win away", "")]),
      story("sp2", "Marathon record falls in Berlin", [outlet("BBC Sport", "Marathon record falls in Berlin", "")])],
  },
};
const long = (id, st, src) => ({ id, story: st, text: `${PACK.top.find((s) => s.id === st)?.headline || PACK.desks.sport.find((s) => s.id === st).headline}. ${src} reports that officials met on Tuesday. Officials said the talks were constructive. ${src} notes that both sides want a deal. It matters because millions of people are affected.` });
const sentences = (t) => t.split(/(?<=[.!?])\s+/).filter(Boolean).length;
const HOUR_SEGMENT = { lines: [{ id: "open", text: "It's ten in the morning in New York. This is ScoopFeeds Radio, the news, compared." },
  long("s1", "t1", "Reuters"), long("s2", "t2", "Al Jazeera"), long("s3", "t3", "The Financial Times"), long("s4", "t4", "Nikkei Asia"),
  long("s5", "t5", "Bloomberg"), long("s6", "t6", "CNBC"), long("s7", "sp1", "ESPN"), { id: "close", text: "Now the sport." }] };

test("fixture hour: The Hour keeps 7 stories, each the headline and 3-4 sentences, attributed; the half drops what :00 read", () => {
  const v15 = buildClock(H, { v15: true });
  const spoken = v15.filter((s) => ["the-hour", "half"].includes(s.id));
  const raw = { "the-hour": HOUR_SEGMENT, half: { lines: [{ id: "open", text: "Headlines at the half hour." },
    { id: "h1", story: "t1", text: "Ceasefire talks resume in Cairo. Reuters reports the talks went on." },        // read at :00
    { id: "h2", story: "bu1", text: "Central bank keeps rates on hold. Bloomberg reports the decision." },        // read at :00 as t5
    { id: "h3", story: "t7", text: "Wildfire forces evacuations in Greece. AP reports villages were cleared." },
    { id: "h4", story: "t8", text: "Mexico opens new rail line. Reuters reports the line opened on Tuesday." },
    { id: "h5", story: "t9", text: "Climate summit names new host city. The Guardian reports the choice." },
    { id: "close", text: "Science, Tech and AI is next." }] } };
  const { segments, report } = checkSegments(raw, spoken, PACK);
  const stories = segments["the-hour"].lines.filter((l) => /^s\d$/.test(l.id));
  assert.equal(stories.length, 7, JSON.stringify(report));
  for (const l of stories) {
    const st = [...PACK.top, ...PACK.desks.sport].find((s) => s.id === l.story);
    assert.ok(sentences(l.text) >= 4 && sentences(l.text) <= 5, `${l.id}: headline + 3-4 sentences (${sentences(l.text)})`);
    assert.ok(st.outlets.some((o) => l.text.includes(o.source.replace(/ News$/, "").replace(/^The /, ""))), `${l.id} is attributed`);
  }
  assert.equal(stories.at(-1).story, "sp1", "sport last");
  assert.deepEqual(segments.half.lines.map((l) => l.id), ["open", "h3", "h4", "h5", "close"]);
  assert.deepEqual(report.filter((r) => r.slot === "half").map((r) => [r.line, r.drop]), [["h1", "fresh: a story The Hour read"], ["h2", "fresh: a story The Hour read"]]);
  const read = new Set(stories.map((l) => l.story));
  assert.ok(segments.half.lines.every((l) => !read.has(l.story)), "no story read at :00 airs at :30");
});

test("the half with fewer than 3 new stories says so in one line and moves on", () => {
  const slot = buildClock(H, { v15: true }).find((s) => s.id === "half");
  const idx = new Map([...PACK.top, ...PACK.desks.business].map((s) => [s.id, s]));
  const report = [];
  const out = freshHalf({ lines: [{ id: "open", text: "Headlines at the half hour." }, { id: "h1", story: "t1", text: "x" }, { id: "h2", story: "t8", text: "y" }, { id: "h3", story: "t9", text: "z" }, { id: "close", text: "Next." }] },
    slot, HOUR_SEGMENT, idx, report);
  assert.deepEqual(out.lines.map((l) => [l.id, l.text]), [["open", "Headlines at the half hour."], ["nochange", NO_CHANGE], ["close", "Next."]]);
  assert.equal(out.lines[1].mechanical, true);
  assert.deepEqual(report.map((r) => r.line), ["h1", "h2", "h3"]);
  // the writer's own "nochange" line is kept as written
  const own = freshHalf({ lines: [{ id: "open", text: "Headlines at the half hour." }, { id: "nochange", text: NO_CHANGE }] }, slot, HOUR_SEGMENT, idx, []);
  assert.deepEqual(own.lines.map((l) => [l.id, !!l.mechanical]), [["open", false], ["nochange", false]]);
  // no The Hour in the run (a refresh from later in the hour): left as written
  const seg = { lines: [{ id: "h1", story: "t1", text: "x" }] };
  assert.equal(freshHalf(seg, slot, undefined, idx, []), seg);
  assert.ok(sameStoryAs(idx.get("t5"), idx.get("bu1")) && !sameStoryAs(idx.get("t7"), idx.get("t8")));
});

test("writer prompts: long Hour in world, business, sport order; Sport; fresh half; Science, Tech and AI", () => {
  const spoken = buildClock(H, { v15: true }).filter((s) => s.kind === "spoken");
  const p = buildPrompt(PACK, spoken, when);
  assert.match(p, /exactly 7 story lines .*world news first, then business, then ONE sport story from DESK: sport as the last story line/);
  assert.match(p, /3 or 4 sentences of context: what happened, who said what, attributed/);
  assert.match(p, /"the-hour".*a one-line handoff to Sport/);
  assert.match(p, /"sport" \(Sport, 180 s, max \d+ words\): the Sport desk\. Use only stories from DESK: sport/);
  assert.match(p, /"half" .*a story that The Hour did NOT read.*"nochange" = "No major changes since the top of the hour\."/);
  assert.match(p, /"desk-tech" \(Science, Tech and AI, .*include a science story/);
  assert.match(p, /DESK: sport\n\[sp1\]/);
  // the old clock's prompt is unchanged in shape
  const old = buildPrompt(PACK, buildClock(H).filter((s) => s.kind === "spoken"), when);
  assert.match(old, /then exactly 5 story lines/);
  assert.doesNotMatch(old.split("FACT PACK")[0], /sport|Science, Tech/i);
});

test("airCheck: a v1.5 fixture hour passes, reports its music, and fails a half line The Hour already read", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clockv15-"));
  const slots = buildGridClock(H, { v15: true }).slots.map(({ id, kind, start, end, title }) => ({ id, kind, start, end, title: title || null }));
  const a = writeHourAudio(dir, H, { slots });
  fs.writeFileSync(path.join(dir, "programme.json"), JSON.stringify({ hourStart: H, clock: "v15", cues: Array(30).fill({}), headlines: [], ...a }));
  const half = { lines: [{ id: "open", text: "Headlines at the half hour." }, { id: "h1", story: "t7" }, { id: "h2", story: "t8" }, { id: "h3", story: "t9" }] };
  fs.writeFileSync(path.join(dir, "segments.raw.json"), JSON.stringify({ "the-hour": HOUR_SEGMENT, half }));
  fs.writeFileSync(path.join(dir, "segments.json"), JSON.stringify({ "the-hour": HOUR_SEGMENT, half }));
  const ok = airCheck(dir, { hourStart: H });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.stats.hourStories, 7);
  assert.equal(ok.stats.musicSecs, 180);
  const bad = { ...half, lines: [...half.lines, { id: "h4", story: "t2" }] };
  fs.writeFileSync(path.join(dir, "segments.json"), JSON.stringify({ "the-hour": HOUR_SEGMENT, half: bad }));
  assert.deepEqual(airCheck(dir, { hourStart: H }).problems, ["half/h4: story t2 was read in The Hour (#285: the half reads only new stories)"]);
  // a repeat's half is not compared with the fresh The Hour: noted as unverified, never passed silently
  const r = v15Report({ hourStart: H, slots, repeatOf: { hourStart: H - 3600_000 } }, { "the-hour": HOUR_SEGMENT, half: bad });
  assert.deepEqual(r.problems, []);
  assert.match(r.notes.join(), /repeat: the half-hour is the repeated hour's, not checked against the fresh The Hour \(unverified\)/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("repeat (#249, #283): a v1.5 hour has a music donor, so a stale Markets Now and the stale Crypto can be cut", () => {
  const slots = buildGridClock(H, { v15: true }).slots.map(({ id, kind, start, end, title }) => ({ id, kind, start, end, title: title || null }));
  const prog = { hourStart: H, audio: [{ file: "part-countdown.wav", from: slots[0].start }], cues: [], slots };
  const d = musicDonor(prog);
  assert.ok(d && d.to - d.from >= 60_000 - 5_000, "a donor of about 85 s");
  const m = cutSlotToMusic(prog, "markets-1", { why: "test" });
  assert.equal(m.ok, true);
  const c = cutRepeatCrypto(prog, { now: H });
  assert.equal(c.crypto.status, "cut");
});
