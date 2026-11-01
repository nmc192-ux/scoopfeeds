import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  longReadOn, reviewOn, longReadHours, DEFAULT_HOURS_ET, candidateEvents, buildStory, checkLongread, frameLines,
  addLongReadToClock, pickForAir, airVerdict, isLongReadHour, sectionCards, slotWords, wordCount, SECTIONS, SLOT_ID, SLOT_SEC,
  STORY_ID, MAX_AGE_MS, buildPrompt, fetchLongreadPack,
} from "./longread.js";
import { savePiece, listPieces, loadPiece, setReview, recordAiring, recentSlugs, longReadDir } from "./store.js";
import { buildClock, checkClock, musicSecs, V15_MUSIC_HOUR_MAX_SEC } from "../programme/clock.js";
import { storyIndex } from "../programme/factPack.js";

const H = Date.parse("2026-11-05T17:00:00Z");   // 12 noon in New York (EST)
const NOW = Date.parse("2026-11-05T15:00:00Z");
const OUTLETS = ["Reuters", "BBC News", "Al Jazeera", "The Guardian", "AP News"];

const article = (i, over = {}) => ({
  title: `Central bank raises interest rates to 4.5 percent as inflation stays high (${i})`,
  summary: `The central bank raised its main rate by 0.25 points to 4.5 percent on Thursday, its third rise this year, citing inflation of 3.2 percent. Governor Maria Lopez said "we will do what it takes to bring prices down" in a statement (${i}).`,
  source_name: OUTLETS[i % OUTLETS.length], url: `https://example.com/news/${i}`, published_at: NOW - i * 3600_000, category: "business", ...over,
});
const ARTICLES = Array.from({ length: 10 }, (_, i) => article(i));
const OCC = [
  { ts: Date.parse("2026-10-28T12:00:00Z"), headline: "Central bank signals further rate rises ahead", source_name: "Reuters", outlets: ["Reuters", "BBC News"] },
  { ts: Date.parse("2026-11-05T12:00:00Z"), headline: "Central bank raises interest rates to 4.5 percent", source_name: "AP News", outlets: ["AP News", "The Guardian", "Al Jazeera"] },
];
const EVENT = { slug: "central-bank-raises-rates", title: "Central bank raises interest rates", status: "active", article_count: 10, source_count: 5, last_activity_at: NOW - 3600_000, category: "business" };
const story = () => buildStory(EVENT, ARTICLES, OCC).story;

/** A piece that passes: five sections, two paragraphs each, every paragraph attributed. */
function goodPiece({ words = 90, extra = {} } = {}) {
  const filler = (n) => Array.from({ length: n }, () => "the decision weighs on households and lenders across the economy").join(" ").split(" ").slice(0, n).join(" ");
  const lines = [];
  SECTIONS.forEach(([section], k) => {
    for (let j = 0; j < 2; j++) {
      const src = OUTLETS[(k * 2 + j) % OUTLETS.length];
      lines.push({ section, sources: [src], text: `${src} reports that the central bank raised its main rate to 4.5 percent. ${filler(words - 14)}.` });
    }
  });
  return { lines, ...extra };
}

// ─── flags ─────────────────────────────────────────────────────────────────────
test("flags: the long read is on only when literally 1; review is on unless literally 0", () => {
  assert.equal(longReadOn({}), false);
  assert.equal(longReadOn({ RADIO_LONGREAD_ENABLED: "true" }), false);
  assert.equal(longReadOn({ RADIO_LONGREAD_ENABLED: "1" }), true);
  assert.equal(reviewOn({}), true);
  assert.equal(reviewOn({ RADIO_LONGREAD_REVIEW: "no" }), true);
  assert.equal(reviewOn({ RADIO_LONGREAD_REVIEW: "0" }), false);
  assert.deepEqual(longReadHours({}), DEFAULT_HOURS_ET);
  assert.deepEqual(longReadHours({ RADIO_LONGREAD_HOURS_ET: "6, 18,99,x" }), [6, 18]);
  assert.deepEqual(longReadHours({ RADIO_LONGREAD_HOURS_ET: "nonsense" }), DEFAULT_HOURS_ET);
});

test("isLongReadHour reads the New York hour", () => {
  assert.equal(isLongReadHour(H, [12]), true);
  assert.equal(isLongReadHour(H, [7, 20]), false);
  assert.equal(isLongReadHour(Date.parse("2026-07-01T16:00:00Z"), [12]), true);   // EDT
});

// ─── pick ──────────────────────────────────────────────────────────────────────
test("candidateEvents: enough outlets and articles, active, recent, not repeated, Rule 0", () => {
  const evs = [
    { ...EVENT, slug: "thin", source_count: 3 },
    { ...EVENT, slug: "few-articles", article_count: 5 },
    { ...EVENT, slug: "machine", article_count: 0, source_count: 0 },
    { ...EVENT, slug: "stale", last_activity_at: NOW - 49 * 3600_000 },
    { ...EVENT, slug: "closed", status: "resolved" },
    { ...EVENT, slug: "done-last-week" },
    { ...EVENT, slug: "pk-politics", title: "Imran Khan's party plans protest march" },
    { ...EVENT, slug: "ok" },
  ];
  assert.deepEqual(candidateEvents(evs, { now: NOW, recentSlugs: new Set(["done-last-week"]) }).map((e) => e.slug), ["ok"]);
});

test("buildStory: Rule 0 and opinion pieces are dropped; the headline is an outlet's own title; timeline items are dated", () => {
  const arts = [...ARTICLES, article(11, { url: "https://example.com/opinion/x" }), article(12, { title: "Imran Khan party wins court case", summary: "" })];
  const r = buildStory(EVENT, arts, OCC);
  assert.equal(r.articles.length, 10);
  assert.equal(r.dropped.length, 2);
  assert.ok(ARTICLES.some((a) => a.title === r.story.headline));
  assert.equal(r.story.id, STORY_ID);
  assert.equal(r.sources.length, 5);
  const tl = r.story.outlets.find((o) => o.timeline);
  assert.match(tl.description, /^On 28 October 2026: /);
});

test("buildStory refuses thin coverage after Rule 0", () => {
  const r = buildStory(EVENT, ARTICLES.slice(0, 5), OCC);
  assert.match(r.refused, /5 article\(s\)/);
  const one = buildStory(EVENT, ARTICLES.map((a) => ({ ...a, source_name: "Reuters" })), OCC);
  assert.match(one.refused, /1 outlet/);
});

test("fetchLongreadPack: tries candidates in order and returns the first that survives", async () => {
  const thin = { ...EVENT, slug: "thin-after-rule0" };
  const routes = {
    "/api/ri/events?sort=prominence&limit=40": { events: [thin, EVENT] },
    [`/api/ri/events/${thin.slug}/articles?limit=100`]: { articles: ARTICLES.slice(0, 3) },
    [`/api/ri/events/${EVENT.slug}/articles?limit=100`]: { articles: ARTICLES },
    [`/api/ri/events/${EVENT.slug}/timeline-log`]: { occurrences: OCC },
  };
  const fetchImpl = async (url) => {
    const p = url.replace("https://x.test", "");
    return p in routes ? { ok: true, json: async () => routes[p] } : { ok: false, status: 404 };
  };
  const pk = await fetchLongreadPack({ base: "https://x.test", fetchImpl, now: NOW });
  assert.equal(pk.event.slug, EVENT.slug);
  assert.equal(pk.tried.length, 1);
  assert.equal(pk.timeline.length, 2);
  assert.match(buildPrompt(pk), /OUTLETS IN THE MATERIAL: /);
});

// ─── checks ────────────────────────────────────────────────────────────────────
test("checkLongread: a whole, attributed piece passes, with a mechanical open and close", () => {
  const r = checkLongread(goodPiece(), story());
  assert.deepEqual(r.reasons, []);
  assert.equal(r.ok, true);
  assert.equal(r.segment.lines[0].id, "open");
  assert.equal(r.segment.lines.at(-1).id, "close");
  assert.match(r.segment.lines.at(-1).text, /put together by ScoopFeeds from the reporting of /);
  assert.ok(r.segment.lines.every((l) => l.story === STORY_ID));
  assert.equal(r.credited.length, 5);
  assert.ok(r.words >= 600 && r.words <= slotWords());
});

test("checkLongread: an unbacked figure drops the line; too many drops refuse the piece", () => {
  const p = goodPiece();
  p.lines[0].text = p.lines[0].text.replace("4.5 percent", "7.9 percent");
  const r = checkLongread(p, story());
  assert.ok(r.report.some((x) => /unbacked figure/.test(x.drop)));
  assert.equal(r.ok, true);   // one paragraph of ten: under 15 %
  const q = goodPiece();
  for (const i of [0, 2, 4]) q.lines[i].text = q.lines[i].text.replace("4.5 percent", "7.9 percent");
  const r2 = checkLongread(q, story());
  assert.equal(r2.ok, false);
  assert.ok(r2.reasons.some((x) => /% of the words were dropped/.test(x)));
});

test("checkLongread: attribution, sources and sections", () => {
  const p = goodPiece();
  p.lines[1].text = p.lines[1].text.replace(/^\S+( \S+)? reports/, "It was reported");
  p.lines[1].text = "It was reported that the central bank raised its main rate to 4.5 percent and the decision weighs on households and lenders.";
  p.lines[3].sources = ["The Daily Imaginary"];
  p.lines[5].sources = [];
  const r = checkLongread(p, story());
  const drops = r.report.map((x) => x.drop);
  assert.ok(drops.includes("attribution: the paragraph names none of its sources"));
  assert.ok(drops.some((d) => /not in the material: The Daily Imaginary/.test(d)));
  assert.ok(drops.includes("no sources listed"));
  const lost = goodPiece();
  lost.lines = lost.lines.filter((l) => l.section !== "next");
  const r2 = checkLongread(lost, story());
  assert.equal(r2.ok, false);
  assert.ok(r2.reasons.some((x) => /section\(s\) lost: What to watch/.test(x)));
  const bad = goodPiece();
  bad.lines[0].section = "opinion";
  assert.ok(checkLongread(bad, story()).report.some((x) => /section "opinion"/.test(x.drop)));
});

test("checkLongread: quotes are verbatim, short, and at most two from one outlet", () => {
  const s = story();
  const long = goodPiece();
  long.lines[0].text = `Reuters quotes the statement: "The central bank raised its main rate by 0.25 points to 4.5 percent on Thursday, its third rise this year, citing inflation of 3.2 percent. Governor Maria Lopez said" ${long.lines[0].text}`;
  assert.ok(checkLongread(long, s).report.some((x) => /quote over 25 words/.test(x.drop)));
  const invented = goodPiece();
  invented.lines[0].text = `Reuters reports the governor said "rates will fall next month". ${invented.lines[0].text}`;
  assert.ok(checkLongread(invented, s).report.some((x) => /quote not in pack/.test(x.drop)));
  const many = goodPiece();
  for (const i of [0, 5, 6]) { many.lines[i].sources = ["Reuters"]; many.lines[i].text = `Reuters quotes the governor: "we will do what it takes to bring prices down". ${many.lines[i].text.replace(/^[^.]*reports/, "Reuters reports")}`; }
  // the quote is in every outlet's summary in this fixture, so it belongs to all five: the third use is over the cap
  const r = checkLongread(many, s);
  assert.equal(r.report.filter((x) => /more than 2 quotes from/.test(x.drop)).length, 1);
});

test("checkLongread: length, outlets credited, and an empty or broken reply", () => {
  const short = checkLongread(goodPiece({ words: 40 }), story());
  assert.equal(short.ok, false);
  assert.ok(short.reasons.some((x) => /words survived \(needs 600\)/.test(x)));
  const long = checkLongread(goodPiece({ words: 130 }), story());
  assert.equal(long.ok, false);
  assert.ok(long.reasons.some((x) => /the slot carries/.test(x)));
  const two = goodPiece();
  two.lines.forEach((l, i) => { const src = i % 2 ? "Reuters" : "BBC News"; l.sources = [src]; l.text = l.text.replace(/^.*? reports/, `${src} reports`); });
  const r = checkLongread(two, story());
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /only 2 outlet\(s\) credited/.test(x)));
  assert.equal(checkLongread({}, story()).ok, false);
  assert.equal(checkLongread({ lines: [] }, story()).reasons[0], "the writer returned no lines");
});

test("frameLines credits every outlet in plain speech", () => {
  const f = frameLines(story(), ["Reuters", "BBC News", "AP News"]);
  assert.equal(f.close.text, "That was The Long Read, put together by ScoopFeeds from the reporting of Reuters, BBC News and AP News.");
  assert.match(f.open.text, /^This is The Long Read, on ScoopFeeds Radio\. Central bank/);
});

// ─── clock ─────────────────────────────────────────────────────────────────────
test("addLongReadToClock: The News, Compared #2 and the music after it become one 450 s slot; the clock stays whole", () => {
  const clock = buildClock(H, { v15: true });
  const before = musicSecs(clock);
  const slot = addLongReadToClock(clock);
  assert.ok(slot);
  assert.equal(slot.id, SLOT_ID);
  assert.equal(slot.lenSec, SLOT_SEC);
  assert.equal(slot.startSec, 2880);
  assert.equal(slot.mechanical, true);
  assert.deepEqual(checkClock(clock), []);
  assert.ok(!clock.some((s) => s.id === "compared-2" || s.id === "music-4"));
  assert.equal(clock[clock.indexOf(slot) + 1].id, "markets-2");
  assert.ok(musicSecs(clock) <= Math.min(before, V15_MUSIC_HOUR_MAX_SEC));
  assert.equal(slotWords(), 1065);
});

test("addLongReadToClock leaves the old clock and a feature hour unchanged", () => {
  const old = buildClock(H);
  const copy = JSON.stringify(old);
  assert.equal(addLongReadToClock(old), null);
  assert.equal(JSON.stringify(old), copy);
  const feat = buildClock(H, { v15: true, featureSec: 600, featureTitle: "A-Eye" });
  const fcopy = JSON.stringify(feat);
  assert.equal(addLongReadToClock(feat), null);
  assert.equal(JSON.stringify(feat), fcopy);
});

// ─── air ───────────────────────────────────────────────────────────────────────
const piece = (over = {}) => ({ id: "p", createdAt: NOW - 3600_000, status: "approved", story: story(), segment: { story: STORY_ID, lines: [] }, airings: [], ...over });

test("airVerdict: review, refusal, age and airings", () => {
  assert.equal(airVerdict(piece(), { now: NOW, review: true }), null);
  assert.match(airVerdict(piece({ status: "draft" }), { now: NOW, review: true }), /not approved/);
  assert.equal(airVerdict(piece({ status: "ready" }), { now: NOW, review: false }), null);
  assert.match(airVerdict(piece({ status: "draft" }), { now: NOW, review: false }), /draft/);
  assert.equal(airVerdict(piece({ status: "refused" }), { now: NOW, review: false }), "refused");
  assert.match(airVerdict(piece({ createdAt: NOW - MAX_AGE_MS - 1 }), { now: NOW, review: true }), /older than 36 h/);
  assert.match(airVerdict(piece({ airings: [1, 2, 3] }), { now: NOW, review: true }), /already aired in 3 hours/);
  assert.equal(airVerdict(piece({ airings: [1, 2, H] }), { now: NOW, review: true, hourStart: H }), null);   // a refresh of an hour that has it
  assert.equal(airVerdict(null), "not a long read");
});

test("pickForAir: the newest piece that may air; an hour that already carries one keeps it", () => {
  const a = piece({ id: "a", createdAt: NOW - 7200_000 }), b = piece({ id: "b", createdAt: NOW - 3600_000 }), d = piece({ id: "d", createdAt: NOW, status: "draft" });
  assert.equal(pickForAir([a, b, d], { now: NOW, review: true }).id, "b");
  assert.equal(pickForAir([a, b, d], { now: NOW, review: true, hourStart: H }).id, "b");
  const aHas = { ...a, airings: [H] };
  assert.equal(pickForAir([aHas, b], { now: NOW, review: true, hourStart: H }).id, "a");
  assert.equal(pickForAir([d], { now: NOW, review: true }), null);
  assert.equal(pickForAir([], { now: NOW }), null);
});

test("the hour's storyIndex and the screen read the long read's story", () => {
  const s = story();
  assert.equal(storyIndex({ top: [], desks: {}, longread: { story: s } }).get(STORY_ID), s);
  assert.equal(storyIndex({ top: [], desks: {} }).has(STORY_ID), false);
  const r = checkLongread(goodPiece(), s);
  const cards = sectionCards(r.segment.lines);
  assert.deepEqual(cards.map((c) => c.label), SECTIONS.map(([, l]) => l));
  assert.match(cards[0].text, /^Drawing on /);
});

// ─── store ─────────────────────────────────────────────────────────────────────
test("store: save, list, review, airings", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "longread-"));
  try {
    const p1 = savePiece({ createdAt: NOW, status: "draft", event: { slug: EVENT.slug }, story: story(), segment: { lines: [] }, verdict: { ok: true, reasons: [] } }, { articles: [] }, { dir });
    const p2 = savePiece({ createdAt: NOW, status: "refused", event: { slug: EVENT.slug }, story: story(), segment: { lines: [] }, verdict: { ok: false, reasons: ["too short"] } }, null, { dir });
    assert.equal(p1.id, "2026-11-05-central-bank-raises-rates");
    assert.equal(p2.id, "2026-11-05-central-bank-raises-rates-2");
    assert.ok(fs.existsSync(path.join(dir, p1.id, "pack.json")));
    fs.mkdirSync(path.join(dir, "junk"));
    const ps = listPieces({ dir });
    assert.equal(ps.length, 2);
    assert.deepEqual(ps.skipped, ["junk"]);
    assert.deepEqual([...recentSlugs(NOW - 1, { dir })], [EVENT.slug]);
    assert.equal(setReview(p1.id, "approved", { by: "drj", now: NOW, dir }).status, "approved");
    assert.throws(() => setReview(p2.id, "approved", { dir }), /cannot be approved/);
    assert.throws(() => setReview(p1.id, "ready", { dir }), /approved or refused/);
    recordAiring(p1.id, H, { dir }); recordAiring(p1.id, H, { dir }); recordAiring(p1.id, H + 3600_000, { dir });
    assert.deepEqual(loadPiece(p1.id, { dir }).airings, [H, H + 3600_000]);
    assert.equal(setReview("nope", "approved", { dir }), null);
    assert.deepEqual([...listPieces({ dir: path.join(dir, "missing") })], []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("longReadDir: RADIO_LONGREAD_DIR, else under RADIO_BASE_DIR", () => {
  assert.equal(longReadDir({ RADIO_LONGREAD_DIR: "/srv/lr" }), "/srv/lr");
  assert.equal(longReadDir({ RADIO_BASE_DIR: "/srv/radio" }), "/srv/radio/longreads");
  assert.equal(longReadDir({}), path.join(os.homedir(), "scoopfeeds-radio", "longreads"));
  assert.equal(wordCount("  one two  three "), 3);
});

// ─── the hour: checks, casting and the screen ──────────────────────────────────
test("in the hour: re-checked unchanged, read by one presenter, a story card then one card per section", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const { checkSegments } = await import("../programme/checks.js");
  const { assemble, fakeVoice } = await import("../programme/assemble.js");
  const { castSegments } = await import("../programme/presenters.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "longread-air-"));
  try {
    const s = story();
    const made = checkLongread(goodPiece(), s);
    assert.equal(made.ok, true);
    const clock = buildClock(H, { v15: true });
    const slot = addLongReadToClock(clock);
    const pack = { top: [], desks: {}, longread: { id: "p", story: s }, markets: [], weather: [] };
    const { segments, report } = checkSegments({ [SLOT_ID]: made.segment }, [slot], pack);
    assert.deepEqual(report, []);   // what passed when it was made passes at air time
    const cast = { A: { key: "A", name: "Alex", voice: "am_michael" }, B: { key: "B", name: "Bea", voice: "af_heart" } };
    const voiced = castSegments(segments, [slot], cast);
    assert.deepEqual([...new Set(voiced[SLOT_ID].lines.map((l) => l.speaker))], ["A"]);   // one story: one presenter, no handover
    const bed = path.join(dir, "bed.wav");
    spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=30", "-ac", "2", "-ar", "44100", bed]);
    if (!fs.existsSync(bed)) { t.skip("no ffmpeg: the screen cues are UNMEASURED on this machine"); return; }
    const { cues } = await assemble({ slots: [slot], segments, pack, hourStart: H, bedFor: () => ({ file: bed, lufs: -16, len: 30 }), voice: fakeVoice(path.join(dir, "v")), outWav: path.join(dir, "part.wav") });
    const mine = cues.filter((c) => c.scene !== "sting");
    assert.equal(mine[0].scene, "story");
    assert.equal(mine[0].data.headline, s.headline);
    assert.equal(mine[0].data.kicker, "The Long Read");
    assert.equal(new Set(mine[0].data.outlets).size, mine[0].data.outlets.length);
    const known = mine.filter((c) => c.scene === "known");
    assert.deepEqual(known.map((c) => c.data.label), SECTIONS.map(([, l]) => l));
    assert.ok(known[0].at >= H + (slot.startSec + 2.6 + 12) * 1000);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("buildStory: the headline is the article the event is titled after, else a straight one from the lead outlet", () => {
  const titled = buildStory({ ...EVENT, title: ARTICLES[7].title }, ARTICLES, OCC);
  assert.equal(titled.story.headline, ARTICLES[7].title);
  const q = ARTICLES.map((a, i) => (a.source_name === "AP News" && i === 4 ? { ...a, title: "Is this the end of cheap money?" } : a));
  const r = buildStory({ ...EVENT, title: "no article has this title" }, q, OCC);
  assert.ok(!r.story.headline.includes("?"));
});

test("1 Nov: one repair round — dropped paragraphs go back with their reason, come back in place, and are checked again", async () => {
  const { revisionPrompt, applyRevision } = await import("./longread.js");
  const written = { lines: [
    { section: "happened", sources: ["A"], text: "A reports one." },
    { section: "background", sources: ["B"], text: 'B says "made up words".' },
    { section: "who", sources: ["C"], text: "C reports three." },
  ] };
  const report = [{ slot: "longread", line: "p2", drop: 'quote not in pack: "made up words"' }];
  const p = revisionPrompt(written, report);
  assert.match(p, /- p2 \(section "background"\): FAILED because quote not in pack/);
  assert.match(p, /TEXT: B says "made up words"\./);
  assert.ok(!/- p1|- p3/.test(p), "only the failed paragraph is sent back");
  assert.equal(revisionPrompt(written, []), null);
  const { written: w2, replaced } = applyRevision(written, { lines: [{ id: "p2", section: "background", sources: ["B"], text: "B reports the deal was signed." }, { id: "p9", text: "out of range" }, { id: "p1", text: "" }] });
  assert.equal(replaced, 1);
  assert.equal(w2.lines[1].text, "B reports the deal was signed.");
  assert.equal(w2.lines[0].text, "A reports one.", "untouched paragraphs stay as written");
  assert.equal(written.lines[1].text, 'B says "made up words".', "the first draft is not mutated");
});
