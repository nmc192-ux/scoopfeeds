import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadLibrary, importFilm } from "./filmLibrary.js";
import { planDay, defaultSlots, easternInstant, promoText, MIN_GAP_MS, PROMO_LEAD_MS } from "./filmRotation.js";
import { planToCues, cueAt, buildFilmFrameArgs, buildFilmAudioArgs, buildRehearsalArgs, rehearsalBoundaries, pairMarkers } from "./filmPlayout.js";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const DAY = 86_400_000;

function film(series, n, ageDays, durationSec = 480, kind = "film") {
  return {
    id: `${series}/${n}`, series, seriesName: series, title: `${series} ${n}`, durationSec,
    publishedAt: NOW - ageDays * DAY, file: `/x/${series}/${n}.mp4`, kind,
  };
}

test("library: reads sidecars, reports unusable files instead of guessing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "films-"));
  fs.mkdirSync(path.join(dir, "a-eye"));
  fs.writeFileSync(path.join(dir, "a-eye", "e1.mp4"), "");
  fs.writeFileSync(path.join(dir, "a-eye", "e1.json"), JSON.stringify({ title: "One", publishedAt: "2026-10-01", durationSec: 500 }));
  fs.writeFileSync(path.join(dir, "a-eye", "e2.mp4"), "");
  fs.writeFileSync(path.join(dir, "a-eye", "e3.mp4"), "");
  fs.writeFileSync(path.join(dir, "a-eye", "e3.json"), JSON.stringify({ title: "Three", publishedAt: "2026-10-02" }));
  const { items, skipped } = loadLibrary(dir);
  assert.equal(items.length, 1);
  assert.equal(items[0].seriesName, "A-Eye");
  assert.equal(skipped.length, 2);
  assert.deepEqual(loadLibrary(path.join(dir, "missing")), { items: [], skipped: [] });
});

test("easternInstant handles EDT and EST", () => {
  assert.equal(easternInstant("2026-10-23", 20).toISOString(), "2026-10-24T00:00:00.000Z");
  assert.equal(easternInstant("2026-12-01", 20).toISOString(), "2026-12-02T01:00:00.000Z");
});

test("day plan: prime slots take new episodes, no film repeats within 6h", () => {
  const items = [
    film("a-eye", 5, 2), film("the-record", 9, 3), film("people", 1, 40), film("people", 2, 60),
    film("scoopfeeds-60", 1, 1, 30, "short"), film("scoopfeeds-60", 2, 1, 40, "short"),
  ];
  const slots = defaultSlots("2026-10-23");
  const { plan, empty } = planDay({ items }, { slots, now: NOW });
  const films = plan.filter((p) => p.type === "film");
  assert.equal(films.length + empty.length, 4);
  for (const p of films.filter((f) => f.prime)) assert.match(p.id, /^(a-eye|the-record)\//);
  for (let i = 0; i < films.length; i++) for (let j = i + 1; j < films.length; j++) {
    if (films[i].id === films[j].id) assert.ok(films[j].at - films[i].at >= MIN_GAP_MS);
  }
  assert.ok(plan.some((p) => p.type === "short"));
  assert.ok(plan.some((p) => p.type === "promo" && /^New episode of /.test(p.text)));
});

test("a slot with only repeats stays empty and is reported", () => {
  const { plan, empty } = planDay({ items: [film("people", 1, 40)] }, { slots: defaultSlots("2026-10-23"), now: NOW });
  assert.equal(plan.filter((p) => p.type === "film").length, 2); // 08:00 and 21:00 ET are >= 6h from each other's airing
  assert.equal(empty.length, 2);
});

test("yesterday's airings seed the gap", () => {
  const slots = defaultSlots("2026-10-23");
  const { plan } = planDay({ items: [film("people", 1, 40)] }, { slots, now: NOW, recent: [{ id: "people/1", at: slots[0].at.getTime() - 3600_000 }] });
  assert.ok(plan.filter((p) => p.type === "film").every((p) => p.at - (slots[0].at.getTime() - 3600_000) >= MIN_GAP_MS));
});

// ── #203 completion: library import, promos, overlap, cues, rehearsal arguments ──────────────

function tmpLibrary() {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "films-src-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "films-lib-"));
  const add = (series, name, title, publishedAt, durationSec) => {
    const f = path.join(src, `${series}-${name}.mp4`);
    fs.writeFileSync(f, "");
    return importFilm({ file: f, series, title, publishedAt, name, dir, probe: () => durationSec });
  };
  return { src, dir, add };
}

test("import: links the published file, writes a sidecar with the probed duration, refuses unknown series", () => {
  const { dir, add } = tmpLibrary();
  const r = add("the-invisible-hand", "ep4", "Who owns the ports", "2026-10-18T14:00:00Z", 512.4567);
  assert.ok(fs.lstatSync(r.target).isSymbolicLink());
  assert.deepEqual(JSON.parse(fs.readFileSync(r.target.replace(/\.mp4$/, ".json"), "utf8")).durationSec, 512.457);
  const { items } = loadLibrary(dir, { now: NOW });
  assert.equal(items[0].seriesName, "The Invisible Hand");
  assert.throws(() => add("not-a-series", "x", "X", "2026-10-01", 100), /unknown series/);
  assert.throws(() => importFilm({ file: "/nope.mp4", series: "people", title: "t", publishedAt: "2026-10-01", dir, probe: () => 1 }), /not a video file/);
});

test("library: a scheduled upload (publishedAt in the future) is skipped, not played", () => {
  const { dir, add } = tmpLibrary();
  add("people", "e1", "Out already", "2026-10-20", 400);
  add("people", "e2", "Goes out Sunday", "2026-10-25", 400);
  const { items, skipped } = loadLibrary(dir, { now: NOW });
  assert.deepEqual(items.map((i) => i.title), ["Out already"]);
  assert.match(skipped[0].reason, /future/);
});

test("promo names the series, the title, the day and the Eastern time", () => {
  const f = film("the-invisible-hand", 4, 1);
  f.seriesName = "The Invisible Hand";
  f.title = "Who owns the ports";
  assert.equal(promoText(f, easternInstant("2026-10-25", 21)), "New episode of The Invisible Hand: Who owns the ports. Sunday, 9 PM ET.");
});

test("ACCEPTANCE: two days planned from a real library folder, nothing (film or Short) repeats within 6 hours", () => {
  const { dir, add } = tmpLibrary();
  add("a-eye", "e7", "A-Eye 7", "2026-10-21", 540);
  add("the-record", "e3", "Record 3", "2026-10-20", 600);
  add("people", "e1", "People 1", "2026-09-01", 480);
  add("peace-and-war", "e2", "PW 2", "2026-08-15", 510);
  for (let i = 1; i <= 8; i++) add("scoopfeeds-60", `s${i}`, `Short ${i}`, "2026-10-10", 35 + i * 3);
  const lib = loadLibrary(dir, { now: NOW });
  assert.equal(lib.skipped.length, 0);
  const d1 = planDay(lib, { slots: defaultSlots("2026-10-23"), now: NOW });
  const recent = d1.plan.filter((p) => p.type !== "promo").map((p) => ({ id: p.id, at: p.at }));
  const d2 = planDay(lib, { slots: defaultSlots("2026-10-24"), now: NOW + DAY, recent });
  const airings = [...d1.plan, ...d2.plan].filter((p) => p.type !== "promo").sort((a, b) => a.at - b.at);
  const last = new Map();
  for (const p of airings) {
    if (last.has(p.id)) assert.ok(p.at - last.get(p.id) >= MIN_GAP_MS, `${p.id} repeated after ${(p.at - last.get(p.id)) / 3600_000} h`);
    last.set(p.id, p.at);
  }
  assert.equal(d1.plan.filter((p) => p.type === "film").length, 4, "four films is enough for four slots across 6 h gaps");
  assert.ok(d1.plan.filter((p) => p.type === "short").length >= 4);
  for (const p of d1.plan.filter((p) => p.type === "film" && p.prime)) assert.match(p.id, /^(a-eye|the-record)\//);
  const promo = d1.plan.find((p) => p.type === "promo");
  const filmAt = d1.plan.find((p) => p.type === "film" && p.id === promo.filmId).at;
  assert.equal(filmAt - promo.at, PROMO_LEAD_MS);
  // the plan is playable as cues: no overlaps
  const { cues } = planToCues(d1.plan);
  assert.ok(cues.length >= 8);
});

test("a slot that would start during the previous film is left empty and reported", () => {
  const long = film("people", 1, 40, 6 * 3600);
  const other = film("people", 2, 40);
  const slots = [{ at: new Date(NOW), prime: false }, { at: new Date(NOW + 3600_000), prime: false }];
  const { plan, empty } = planDay({ items: [long, other] }, { slots, now: NOW });
  assert.equal(plan.filter((p) => p.type === "film").length, 1);
  assert.match(empty[0].reason, /still on air/);
});

test("cues: what is on air at an instant and the offset into its file", () => {
  const plan = [
    { type: "promo", at: 0, filmId: "a/1", text: "x" },
    { type: "film", at: 1000, id: "a/1", file: "/f.mp4", durationSec: 10 },
    { type: "short", at: 11_000, id: "s/1", file: "/s.mp4", durationSec: 5 },
  ];
  const { cues, overlays } = planToCues(plan);
  assert.equal(overlays.length, 1);
  assert.equal(cueAt(cues, 500), null);
  assert.deepEqual(cueAt(cues, 3500), { cue: cues[0], ssSec: 2.5 });
  assert.equal(cueAt(cues, 11_000).cue.id, "s/1");
  assert.equal(cueAt(cues, 16_000), null);
  assert.throws(() => planToCues([plan[1], { ...plan[2], at: 5000 }]), /starts before/);
});

test("films go through the encoder: real-time decode to MJPEG frames + the film's own sound as PCM", () => {
  const v = buildFilmFrameArgs({ file: "/f.mp4", ssSec: 12.5 });
  assert.deepEqual(v.slice(v.indexOf("-re"), v.indexOf("-re") + 5), ["-re", "-ss", "12.500", "-i", "/f.mp4"]);
  assert.ok(v.includes("-an") && v.includes("image2pipe") && v.includes("mjpeg"));
  assert.match(v[v.indexOf("-vf") + 1], /scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080/);
  const a = buildFilmAudioArgs({ file: "/f.mp4", ssSec: -3 });
  assert.equal(a[a.indexOf("-ss") + 1], "0.000");
  assert.ok(a.includes("-vn") && a.includes("s16le") && a.includes("pipe:1"));
});

test("rehearsal args: each item's sound is padded/trimmed to its own picture; silent items get silence; playout encode settings", () => {
  const items = [
    { file: "/film.mp4", videoSec: 30, hasAudio: true },
    { file: "/s1.mp4", videoSec: 12, hasAudio: true },
    { file: "/s2.mp4", videoSec: 10, hasAudio: false },
  ];
  const a = buildRehearsalArgs({ items, out: "/o.mp4" });
  const fc = a[a.indexOf("-filter_complex") + 1];
  assert.match(fc, /\[0:a:0\][^;]*apad,atrim=duration=30\.000/);
  assert.match(fc, /\[1:a:0\][^;]*apad,atrim=duration=12\.000/);
  assert.match(fc, /\[3:a:0\]asetpts/, "the silent Short's silence is input 3");
  assert.ok(a.includes("anullsrc=r=44100:cl=stereo"));
  assert.match(fc, /concat=n=3:v=1:a=1/);
  assert.ok(a.includes("libx264") && a.includes("4500k") && a[a.length - 1] === "/o.mp4");
  assert.deepEqual(rehearsalBoundaries(items), { starts: [0, 30, 42], totalSec: 52 });
  assert.throws(() => buildRehearsalArgs({ items: [{ file: "/x.mp4", videoSec: NaN }], out: "/o.mp4" }), /measured/);
});

test("marker pairing reports the worst offset and every unmatched marker", () => {
  const r = pairMarkers([1, 15, 31], [1.002, 15.03, 52]);
  assert.equal(r.pairs.length, 2);
  assert.equal(Math.round(r.worstSec * 1000), 30);
  assert.deepEqual(r.unmatched, [{ video: 31 }, { audio: 52 }]);
});
