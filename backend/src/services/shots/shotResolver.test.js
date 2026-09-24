import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as m038 from "../../db/migrations/038_shot_assets.js";

// A BARE DB WITH ONLY shot_assets — a deliberate exception to "use makeTestDb()".
// That rule exists so tests never build a HALF schema that migrations then
// trip over; shot_assets depends on no other table, so there is no half here.
// And makeTestDb() is the measured trigger of the known SIGABRT (I5): one
// makeTestDb() followed by one forced GC aborts 4/4 on Node 24.19 +
// better-sqlite3 11.10 (native frame Statement::~Statement()), while a bare
// DB with thousands of discarded statements survives 5/5. The incident rung,
// which needs media_candidates, simply reports no candidates here.
const freshDb = () => { const db = new Database(":memory:"); m038.up(db); return db; };
import { resolveShot, resolveSpecShots, contextFor, ladderFor, isPublisherImage, isCrimeStory, rule0Blocks, namedCore } from "./shotResolver.js";
import { transcodeUrl, licenceUsable, sniff, creditLine } from "./commons.js";
import { cropFor } from "./bannerCrops.js";
import { findRecords, upsertRecord, isRejected, subjectKey, importAssetManifest } from "./shotAssets.js";
import { sampleTimes, MAX_FRAMES } from "./media.js";
import { pickInPoints, judgePhoto } from "./vision.js";

const ARTICLE = { id: "a1", title: "Greenland pact signed at UN", description: "", url: "https://www.dw.com/en/greenland/a-1",
  image_url: "https://static.dw.com/image/12345_6.jpg" };
const CAP = "The pact was signed at the United Nations in New York on Tuesday.";

// A fake world. Every dependency the resolver can reach is here, so no test
// touches the network, ffmpeg or a model.
function fakes(over = {}) {
  const calls = { vision: 0, judge: 0, web: 0 };
  const deps = {
    searchFiles: async (q, { mime }) => (mime === "video/webm" ? ["File:Signing ceremony.webm"] : []),
    fileInfo: async (titles) => titles.map((t) => ({ title: t, licence: "Public domain", author: "The White House", credit: "",
      width: 1920, height: 1080, duration: 120, descUrl: `https://commons.wikimedia.org/wiki/${t}` })),
    probeVideo: async () => ({ ok: true, duration: 120 }),
    sampleFrames: async () => ({ frames: [{ t: 1, jpeg: Buffer.alloc(10) }, { t: 9, jpeg: Buffer.alloc(10) }], coveredSecs: 120 }),
    pickInPoints: async () => { calls.vision++; return { ok: true, picks: [{ t: 9, score: 8, note: "leaders sign" }], sensitive: false, bannerAt: 9 }; },
    judgePhoto: async () => { calls.judge++; return { ok: true, usable: true, matches: true }; },
    wikidataSearch: async () => null,
    wikidataFacts: async () => ({}),
    webSearch: null,
    fetchImage: async () => ({ buf: Buffer.alloc(3000) }),
    ...over,
  };
  return { deps, calls };
}

test("transcode URLs follow Commons' md5 layout (the documented Example.jpg case)", () => {
  // md5("Example.jpg") starts "a9" — Commons stores it under /a/a9/.
  assert.match(transcodeUrl("File:Example.jpg", 480), /\/transcoded\/a\/a9\/Example\.jpg\/Example\.jpg\.480p\.vp9\.webm$/);
  assert.match(transcodeUrl("Foo bar.webm"), /\/Foo_bar\.webm\/Foo_bar\.webm\.1080p\.vp9\.webm$/);
});

test("licences: PD, CC0, CC BY and BY-SA pass; NC, ND, fair use and unreadable refuse", () => {
  for (const l of ["Public domain", "CC0", "CC BY 4.0", "CC BY-SA 4.0", "PD-USGov"]) assert.equal(licenceUsable(l), true, l);
  for (const l of ["CC BY-NC 4.0", "CC BY-ND 2.0", "Fair use", "", null, "All rights reserved"]) assert.equal(licenceUsable(l), false, String(l));
  assert.equal(creditLine({ author: "Giles Laurent", licence: "CC BY-SA 4.0" }), "Video: Giles Laurent, CC BY-SA 4.0");
});

test("an HTML error page under a media name is caught by content", () => {
  assert.equal(sniff(Buffer.from("<!DOCTYPE html><html><body>429 Too Many Requests</body></html>")), "html");
  assert.equal(sniff(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])), "webm");
  assert.equal(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), "jpeg");
});

test("banner crops: White House is capped at 0.80; an unknown bannered source is provisional", () => {
  assert.deepEqual(cropFor({ author: "The White House" }), { ymax: 0.8, source: "white-house" });
  assert.equal(cropFor({ author: "NASA" }), null);
  assert.equal(cropFor({ author: "NASA" }, { bannerSeen: true }).provisional, true);
});

test("frames are sampled 1 per 3–12 s, and a long clip's coverage is stated, not hidden", () => {
  const short = sampleTimes(30);
  assert.ok(short.spacing >= 3 && short.spacing <= 12);
  const long = sampleTimes(3600);
  assert.equal(long.spacing, 12);
  assert.equal(long.times.length, MAX_FRAMES);
  assert.ok(long.coveredSecs < 3600, "coverage of a long clip is reported as partial");
});

test("vision fails CLOSED with no key — unverified is a refusal", async () => {
  const saved = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
  try {
    const v = await pickInPoints({ frames: [{ t: 1, jpeg: Buffer.alloc(4) }], subject: "x", caption: "y", clipTitle: "z" });
    assert.equal(v.ok, false); assert.equal(v.sensitive, true); assert.deepEqual(v.picks, []);
    const p = await judgePhoto({ jpeg: Buffer.alloc(4), subject: "x" });
    assert.equal(p.ok, false); assert.equal(p.usable, false);
  } finally { if (saved !== undefined) process.env.GEMINI_API_KEY = saved; }
});

test("the ladder: type kinds never search; maps and satellite skip the photo rungs", () => {
  assert.deepEqual(ladderFor({ kind: "punch" }), ["card"]);
  assert.deepEqual(ladderFor({ kind: "map" }), ["reuse", "natural-earth", "card"]);
  assert.deepEqual(ladderFor({ kind: "satellite" }), ["reuse", "esri", "natural-earth", "card"]);
  assert.equal(ladderFor({ kind: "photo" })[2], "commons-video", "real video outranks a photo");
});

test("the publisher's own photo is recognised by identity AND by domain", () => {
  const ctx = contextFor(ARTICLE, {});
  assert.ok(isPublisherImage("https://static.dw.com/image/12345_6.jpg", null, ctx));
  assert.ok(isPublisherImage("https://img.example.com/x.jpg", "https://www.dw.com/en/other/a-2", ctx));
  assert.equal(isPublisherImage("https://upload.wikimedia.org/x.jpg", "https://commons.wikimedia.org/wiki/File:X.jpg", ctx), null);
});

test("crime stories are recognised from headline and summary", () => {
  assert.equal(isCrimeStory({ title: "Man posing as 49ers player arrested over fraud" }), true);
  assert.equal(isCrimeStory({ title: "Inside the sea cucumber smuggling boom" }), true);
  assert.equal(isCrimeStory({ title: "Greenland pact signed at UN" }), false);
});

test("a Commons clip is found, in-pointed by vision, cropped for its banner, and stored for reuse", async () => {
  const db = freshDb();
  const { deps, calls } = fakes();
  const ctx = contextFor(ARTICLE, { db, deps });
  const r = await resolveShot({ anchor: "The pact", kind: "clip", subject: "Greenland pact signing", source_intent: "footage" }, CAP, ctx);
  assert.equal(r.rung, "commons-video");
  assert.equal(r.record.licence, "Public domain");
  assert.equal(r.record.credit, "Video: The White House, Public domain");
  assert.deepEqual(r.record.in_points.map((p) => p.t), [9]);
  assert.equal(r.record.crop.ymax, 0.8);
  assert.match(r.record.media_url, /\.1080p\.vp9\.webm$/);
  assert.equal(calls.vision, 1);
  // Second short, same subject: the table answers and nothing is searched or judged.
  const ctx2 = contextFor({ ...ARTICLE, id: "a2" }, { db, deps });
  const r2 = await resolveShot({ anchor: "The pact", kind: "clip", subject: "greenland PACT signing", source_intent: "footage" }, CAP, ctx2);
  assert.equal(r2.rung, "reuse:commons-video");
  assert.equal(calls.vision, 1, "reuse costs no vision call");
});

test("the render transcode is the largest VERIFIED height at or below the source's", async () => {
  const probed = [];
  const { deps } = fakes({
    fileInfo: async (titles) => titles.map((t) => ({ title: t, licence: "CC BY 4.0", author: "A", width: 1024, height: 576, duration: 60, descUrl: "u" })),
    probeVideo: async (u) => { probed.push(u.match(/\.(\d+)p\.vp9/)[1]); return u.includes(".480p.") || u.includes(".360p.") ? { ok: true, duration: 60 } : { ok: false, reason: "404" }; },
  });
  const ctx = contextFor(ARTICLE, { deps });
  const r = await resolveShot({ anchor: "The pact", kind: "clip", subject: "sea cucumber", source_intent: "footage" }, CAP, ctx);
  assert.equal(r.rung, "commons-video");
  assert.match(r.record.media_url, /\.480p\.vp9\.webm$/, "576p source: 1080/720 do not exist, 480 does");
  assert.deepEqual(probed, ["480"], "never probes a height above the source");
});

test("sensitive frames reject the clip, record the rejection, and never re-judge it", async () => {
  const db = freshDb();
  const { deps, calls } = fakes({ pickInPoints: async () => { return { ok: true, picks: [], sensitive: true, bannerAt: null, reason: "injured people" }; } });
  const ctx = contextFor(ARTICLE, { db, deps });
  const r = await resolveShot({ anchor: "The pact", kind: "clip", subject: "Flood rescue", source_intent: "footage" }, CAP, ctx);
  assert.notEqual(r.rung, "commons-video");
  assert.ok(isRejected(db, transcodeUrl("File:Signing ceremony.webm", 1080)));
  assert.equal(calls.vision, 0);
});

test("the web rung skips the publisher's own photo and social hosts", async () => {
  const db = freshDb();
  const { deps, calls } = fakes({
    searchFiles: async () => [],
    webSearch: async () => [
      { imageUrl: "https://static.dw.com/image/12345_6.jpg", pageUrl: "https://www.dw.com/en/x", host: "dw.com", title: "Greenland", confidence: "high" },
      { imageUrl: "https://i.ig.com/p.jpg", pageUrl: "https://instagram.com/p/1", host: "instagram.com", title: "Greenland", confidence: "high" },
      { imageUrl: "https://ichef.bbci.co.uk/g.jpg", pageUrl: "https://www.bbc.com/news/g", host: "bbc.com", title: "Greenland pact", confidence: "high" },
    ],
  });
  const ctx = contextFor(ARTICLE, { db, deps });
  const r = await resolveShot({ anchor: "The pact", kind: "photo", subject: "Greenland pact ceremony", source_intent: "photo" }, CAP, ctx);
  assert.equal(r.rung, "web-photo");
  assert.equal(r.record.media_url, "https://ichef.bbci.co.uk/g.jpg");
  assert.equal(r.record.credit, "Photo: bbc.com");
  assert.equal(calls.judge, 1, "only the eligible photo reached the vision check");
});

test("crime story + a person: no open-web photo, whatever the search returns", async () => {
  const db = freshDb();
  const crime = { ...ARTICLE, title: "Man arrested over fraud posing as NFL player" };
  const { deps, calls } = fakes({
    searchFiles: async () => [],
    wikidataSearch: async () => null,
    webSearch: async () => { calls.web++; return [{ imageUrl: "https://x.com/p.jpg", pageUrl: "https://news.example/p", host: "news.example", title: "Daejon Love", confidence: "high" }]; },
  });
  const ctx = contextFor(crime, { db, deps });
  const r = await resolveShot({ anchor: "Daejon Love", kind: "photo", subject: "Daejon Love", source_intent: "photo" }, "Daejon Love was arrested in Idaho this August.", ctx);
  assert.notEqual(r.rung, "web-photo");
  assert.ok(r.trail.some((t) => t.rung === "web-photo" && /crime story, person subject/.test(t.outcome)), JSON.stringify(r.trail));
  assert.equal(calls.web, 0);
});

test("a photo the vision check calls a screenshot or a private individual is refused and recorded", async () => {
  const db = freshDb();
  const { deps } = fakes({
    searchFiles: async () => [],
    webSearch: async () => [{ imageUrl: "https://news.example/a.jpg", pageUrl: "https://news.example/a", host: "news.example", title: "Greenland", confidence: "high" }],
    judgePhoto: async () => ({ ok: true, usable: false, matches: true, screenshot: true, privatePerson: false, sensitive: false }),
  });
  const ctx = contextFor(ARTICLE, { db, deps });
  const r = await resolveShot({ anchor: "The pact", kind: "photo", subject: "Greenland pact table", source_intent: "photo" }, CAP, ctx);
  assert.notEqual(r.rung, "web-photo");
  assert.ok(isRejected(db, "https://news.example/a.jpg"));
});

test("explicit-harm headline: no third-party pictures, but maps still draw", async () => {
  const db = freshDb();
  const { deps, calls } = fakes();
  const ctx = contextFor({ ...ARTICLE, title: "Dozens killed as floods hit Nepal" }, { db, deps });
  const r = await resolveShot({ anchor: "The pact", kind: "clip", subject: "Nepal", source_intent: "footage" }, CAP, ctx);
  assert.equal(calls.vision, 0);
  assert.equal(r.rung, "natural-earth", JSON.stringify(r.trail));
  assert.deepEqual(r.record.coords.codes, ["NPL"]);
});

test("satellite resolves an atlas city to coordinates with the Esri credit", async () => {
  const { deps } = fakes();
  const ctx = contextFor(ARTICLE, { deps });
  const r = await resolveShot({ anchor: "The pact", kind: "satellite", subject: "Kabul", source_intent: "satellite" }, CAP, ctx);
  assert.equal(r.rung, "esri");
  assert.ok(Math.abs(r.record.coords.lat - 34.5186) < 0.01);
  assert.match(r.record.credit, /Esri World Imagery/);
});

test("stock is refused for a named subject", async () => {
  const { deps } = fakes({ searchFiles: async () => [], stockImage: async () => ({ url: "https://pexels/x.jpg", credit: "A / Pexels" }) });
  const ctx = contextFor(ARTICLE, { deps });
  const r = await resolveShot({ anchor: "The pact", kind: "photo", subject: "Mette Frederiksen", source_intent: "stock" }, CAP, ctx);
  assert.notEqual(r.rung, "stock");
  assert.ok(r.trail.some((t) => t.rung === "stock" && /named subject/.test(t.outcome)));
});

test("a stored record that is THIS article's publisher photo is not reused", async () => {
  const db = freshDb();
  upsertRecord(db, { subject: "Nuuk harbour", kind: "photo", rung: "web-photo", media_url: "https://static.dw.com/image/12345_6.jpg" });
  const { deps } = fakes({ searchFiles: async () => [] });
  const ctx = contextFor(ARTICLE, { db, deps });
  const r = await resolveShot({ anchor: "The pact", kind: "photo", subject: "Nuuk harbour", source_intent: "photo" }, CAP, ctx);
  assert.notEqual(r.rung, "reuse:web-photo");
});

test("resolveSpecShots reports real-imagery and real-video shares", async () => {
  const db = freshDb();
  const { deps } = fakes();
  const spec = { slides: [
    { t: "title", caption: CAP, shots: [{ anchor: "The pact", kind: "clip", subject: "UN General Assembly hall", source_intent: "footage" }] },
    { t: "turn", caption: "Not a sale.", shots: [{ anchor: "Not a", kind: "punch", subject: "NOT A SALE", source_intent: "card" }] },
  ] };
  const r = await resolveSpecShots(spec, ARTICLE, { db, deps });
  assert.equal(r.stats.shots, 2);
  assert.equal(r.stats.realShare, 0.5);
  assert.equal(r.stats.videoShare, 0.5);
});

test("the manifest importer skips and counts entries it cannot map, never guesses", () => {
  const db = freshDb();
  const r = importAssetManifest(db, { assets: [
    { subject: "Pituffik Space Base", type: "image", url: "https://x/p.jpg", licence: "Public domain" },
    { title: "no url here", type: "video" },
  ] });
  assert.equal(r.imported, 1);
  assert.equal(r.skipped.length, 1);
  assert.equal(findRecords(db, "pituffik space base", "photo").length, 1);
  assert.equal(subjectKey("  Pituffik  SPACE base! "), "pituffik space base");
});

test("Rule 0 runs on every candidate's own metadata — the Khyber Pakhtunkhwa clip is refused", async () => {
  assert.match(rule0Blocks({ title: "File:Indus Nanga Parbat Himalayas from Khyber Pakhtunkhwa.webm" }), /Rule 0/);
  assert.equal(rule0Blocks({ title: "File:Everest from Kala Patthar.webm" }), null);
  const { deps, calls } = fakes({
    searchFiles: async (q, { mime }) => (mime === "video/webm" ? ["File:Indus Nanga Parbat Himalayas from Khyber Pakhtunkhwa.webm"] : []),
    fileInfo: async (titles) => titles.map((t) => ({ title: t, licence: "CC BY-SA 4.0", author: "A", width: 1920, height: 1080, duration: 60, descUrl: "u" })),
  });
  const ctx = contextFor(ARTICLE, { deps });
  const r = await resolveShot({ anchor: "The pact", kind: "clip", subject: "Himalayas", source_intent: "footage" }, CAP, ctx);
  assert.notEqual(r.rung, "commons-video");
  assert.equal(calls.vision, 0, "a Rule 0 candidate never even reaches the vision check");
  assert.ok(r.trail.some((t) => /1 Rule 0/.test(t.outcome)), JSON.stringify(r.trail));
});

test("the named core lets a descriptive subject find its place", async () => {
  assert.equal(namedCore("Andaman Islands coastline"), "Andaman Islands");
  assert.equal(namedCore("Joint Base Andrews tarmac"), "Joint Base Andrews");
  assert.equal(namedCore("sea cucumber"), null);
  assert.equal(namedCore("Kabul"), null, "the core that IS the subject is not a variant");
  const { deps } = fakes();
  const r = await resolveShot({ anchor: "The pact", kind: "satellite", subject: "Kabul airport tarmac", source_intent: "satellite" }, CAP, contextFor(ARTICLE, { deps }));
  assert.equal(r.rung, "esri", JSON.stringify(r.trail));
});

test("past the resolve budget the Commons video rung is skipped, cheaper rungs still run", async () => {
  const { deps, calls } = fakes();
  const ctx = contextFor(ARTICLE, { deps });
  ctx.deadline = Date.now() - 1;
  const r = await resolveShot({ anchor: "The pact", kind: "clip", subject: "Kabul", source_intent: "footage" }, CAP, ctx);
  assert.equal(calls.vision, 0);
  assert.ok(r.trail.some((t) => t.rung === "commons-video" && /budget spent/.test(t.outcome)));
  assert.equal(r.rung, "esri");
});

test("the longform evidence-asset registry imports landmarks and counts what it skips", () => {
  const db = freshDb();
  const r = importAssetManifest(db, { kind: "landmark", entries: {
    PITUFFIK: { key: "PITUFFIK", subject: "Pituffik Space Base", file: "landmarks/pituffik.jpg", license: "public-domain",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Pituffik.jpg", author: "U.S. Space Force" },
    NO_URL: { key: "NO_URL", subject: "Somewhere", file: "x.jpg", license: "cc-by" },
  } });
  assert.equal(r.imported, 1);
  assert.equal(r.skipped.length, 1);
  const rec = findRecords(db, "Pituffik Space Base", "photo")[0];
  assert.equal(rec.licence, "Public domain");
  assert.equal(rec.credit, "Photo: U.S. Space Force, Public domain");
  const cut = importAssetManifest(db, { kind: "cutout", entries: { TRUMP: { key: "TRUMP", subject: "Donald Trump", sourceUrl: "u", license: "public-domain" } } });
  assert.equal(cut.imported, 0, "cutouts are a treatment the shot engine does not use");
});

// ─── PR #149 fixes (DrJ, 24 Sep) ────────────────────────────────────────────
import { splitPlaces } from "./shotResolver.js";
import { splitJpegs, windowFor } from "./media.js";
import { MIN_MATCH } from "./vision.js";
import { loadFallbackFont, isFontData, _setFontFetch, _setFontCacheDir } from "../renderCore.js";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const geminiSays = (obj) => ({ fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }], usageMetadata: {} }) }) });
const withKey = async (fn) => { const s = process.env.GEMINI_API_KEY; process.env.GEMINI_API_KEY = "test"; try { return await fn(); } finally { if (s === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = s; } };

test(`vision refuses weak subject matches (below ${MIN_MATCH}/10) — the Dehradun-for-Himalayas case`, async () => {
  await withKey(async () => {
    const frames = [{ t: 0, jpeg: Buffer.alloc(4) }, { t: 5, jpeg: Buffer.alloc(4) }];
    const weak = await pickInPoints({ frames, subject: "Himalayas", caption: "c", clipTitle: "Chaktonwala Grant, Dehradun",
      deps: geminiSays({ frames: [{ i: 0, shows_subject: true, match: 4, score: 9, sensitive: false }, { i: 1, shows_subject: true, match: 5, score: 8 }] }) });
    assert.deepEqual(weak.picks, [], "a town with hills is not the Himalayas");
    const strong = await pickInPoints({ frames, subject: "Himalayas", caption: "c", clipTitle: "t",
      deps: geminiSays({ frames: [{ i: 0, shows_subject: true, match: 4, score: 9 }, { i: 1, shows_subject: true, match: 9, score: 6 }] }) });
    assert.deepEqual(strong.picks.map((p) => p.t), [5]);
    const photo = await judgePhoto({ jpeg: Buffer.alloc(4), subject: "Joint Base Andrews",
      deps: geminiSays({ matches: true, match: 5, sensitive: false, screenshot: false, private_person: false }) });
    assert.equal(photo.usable, false);
  });
});

test("multi-place map subjects draw every country; a name containing 'and' stays whole", async () => {
  assert.deepEqual(splitPlaces("United States and China"), ["United States", "China"]);
  assert.deepEqual(splitPlaces("Nepal, Tibet & Bhutan"), ["Nepal", "Tibet", "Bhutan"]);
  const { deps } = fakes({
    wikidataSearch: async (n) => (/tibet/i.test(n) ? { qid: "Q17252" } : null),
    wikidataFacts: async (q) => (q === "Q17252" ? { countryQid: "Q148", coords: { lat: 29.6, lon: 91.1 } } : q === "Q148" ? { iso3: "CHN" } : {}),
  });
  const ctx = contextFor(ARTICLE, { deps });
  const us = await resolveShot({ anchor: "The pact", kind: "map", subject: "United States and China", source_intent: "map" }, CAP, ctx);
  assert.equal(us.rung, "natural-earth", JSON.stringify(us.trail));
  assert.deepEqual(us.record.coords.codes, ["USA", "CHN"]);
  const nt = await resolveShot({ anchor: "The pact", kind: "map", subject: "Nepal and Tibet border region", source_intent: "map" }, CAP, ctx);
  // Tibet is PINNED, not filled as China: the map may not claim more than the caption.
  assert.deepEqual(nt.record.coords.codes, ["NPL"], JSON.stringify(nt.trail));
  assert.ok(nt.record.coords.places.some((p) => /Tibet/.test(p.name) && p.region && p.country === "CHN" && Number.isFinite(p.lat)));
  const bih = await resolveShot({ anchor: "The pact", kind: "map", subject: "Bosnia and Herzegovina", source_intent: "map" }, CAP, ctx);
  assert.deepEqual(bih.record.coords.codes, ["BIH"]);
  const pk = await resolveShot({ anchor: "The pact", kind: "map", subject: "India and Pakistan", source_intent: "map" }, CAP, ctx);
  assert.equal(pk.rung, "card", "Rule 0: no map that includes Pakistan");
});

test("real imagery counts headline clippings", async () => {
  const { deps } = fakes();
  const spec = { slides: [{ t: "title", caption: CAP, shots: [
    { anchor: "The pact", kind: "headline", subject: "CNBC headline on the Greenland deal", source_intent: "card" },
    { anchor: "signed at the", kind: "punch", subject: "SIGNED", source_intent: "card" },
  ] }] };
  const r = await resolveSpecShots(spec, ARTICLE, { deps });
  assert.equal(r.stats.realShare, 0.5);
});

test("frames come from one streamed read, split on JPEG markers; windows pad the in-point", () => {
  const j = (n) => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(n, 1), Buffer.from([0xff, 0xd9])]);
  assert.equal(splitJpegs(Buffer.concat([j(10), j(20), j(5)])).length, 3);
  assert.deepEqual(windowFor(30, 120), { start: 28, end: 42 });
  assert.deepEqual(windowFor(1, 8), { start: 0, end: 8 });
});

test("fallback fonts: Han picks Noto Sans SC, an HTML error page returns nothing instead of throwing", async () => {
  const ttf = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(200)]);
  assert.equal(isFontData(ttf), true);
  assert.equal(isFontData(Buffer.from("<html>error</html>".padEnd(200))), false);
  const asked = [];
  _setFontCacheDir(mkdtempSync(join(tmpdir(), "fontcache-")));
  _setFontFetch(async (u) => { asked.push(String(u)); return u.includes("googleapis")
    ? { ok: true, text: async () => "src: url(https://fonts.gstatic.com/x) format('truetype');" }
    : { ok: true, arrayBuffer: async () => (asked.length > 2 ? Buffer.from("<html>".padEnd(300)) : ttf) }; });
  try {
    const f = await loadFallbackFont("ja-JP|zh-CN|zh-TW|zh-HK", "测试");
    assert.equal(f[0]?.name, "Noto Sans SC");
    assert.match(asked[0], /family=Noto%20Sans%20SC/);
    const bad = await loadFallbackFont("ko-KR", "한국");
    assert.deepEqual(bad, [], "an error page is not a font");
  } finally { _setFontFetch((u, o) => fetch(u, o)); }
});

test("reuse finds a picture shot's earlier answer even when it came from a lower rung", async () => {
  const db = freshDb();
  upsertRecord(db, { subject: "Joint Base Andrews", kind: "satellite", rung: "esri", media_url: "esri:38.81,-76.87", coords: { lat: 38.81, lon: -76.87 } });
  const { deps, calls } = fakes();
  const r = await resolveShot({ anchor: "The pact", kind: "photo", subject: "Joint Base Andrews", source_intent: "photo" }, CAP, contextFor(ARTICLE, { db, deps }));
  assert.equal(r.rung, "reuse:esri");
  assert.equal(calls.vision, 0);
});

test("news-critical straits and canals all resolve — the 1:10m set plus the hand-added four", async () => {
  const { deps } = fakes();   // no Wikidata: every one must come from the shipped atlas
  const want = ["Strait of Hormuz", "Bab-el-Mandeb", "Strait of Malacca", "Taiwan Strait", "Bosporus", "Dardanelles",
    "Kerch Strait", "Suez Canal", "Panama Canal", "English Channel", "Strait of Gibraltar"];
  for (const subject of want) {
    const ctx = contextFor(ARTICLE, { deps });
    const map = await resolveShot({ anchor: "The pact", kind: "map", subject, source_intent: "map" }, CAP, ctx);
    assert.equal(map.rung, "natural-earth", `${subject}: ${JSON.stringify(map.trail)}`);
    assert.ok(Number.isFinite(map.record.coords.lat) && Number.isFinite(map.record.coords.lon), subject);
    const sat = await resolveShot({ anchor: "The pact", kind: "satellite", subject, source_intent: "satellite" }, CAP, contextFor(ARTICLE, { deps }));
    assert.equal(sat.rung, "esri", `${subject} satellite: ${JSON.stringify(sat.trail)}`);
  }
  // Aliases people actually write.
  for (const alias of ["Hormuz", "Bosphorus", "Gibraltar", "Bab el-Mandeb"]) {
    const r = await resolveShot({ anchor: "The pact", kind: "map", subject: alias, source_intent: "map" }, CAP, contextFor(ARTICLE, { deps }));
    assert.equal(r.rung, "natural-earth", alias);
  }
  // A two-place subject naming a strait still draws.
  const two = await resolveShot({ anchor: "The pact", kind: "map", subject: "Iran and the Strait of Hormuz", source_intent: "map" }, CAP, contextFor(ARTICLE, { deps }));
  assert.deepEqual(two.record.coords.codes, ["IRN"]);
  assert.equal(two.record.coords.places.length, 2);
});
