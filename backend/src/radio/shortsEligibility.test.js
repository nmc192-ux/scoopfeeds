// #216 (DrJ, 23 Oct 2026): until the ScoopFeeds 60 question is resolved, the radio airs only Shorts cut from a
// published long-form film, in the rotation's breaks and in the hourly programme's film slot.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadLibrary, importFilm, resolveHourShort, allowSf60, shortIneligibility } from "./filmLibrary.js";
import { planDay, defaultSlots } from "./filmRotation.js";
import { buildClock, checkClock } from "./programme/clock.js";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const OFF = {};   // an env with no RADIO_ALLOW_SF60: the default

function lib() {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "s216-src-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s216-lib-"));
  const files = {};
  const add = (series, name, publishedAt, durationSec, parentFilm) => {
    const f = path.join(src, `${series}-${name}.mp4`);
    fs.writeFileSync(f, "");
    files[`${series}/${name}`] = f;
    return importFilm({ file: f, series, title: `${series} ${name}`, publishedAt, name, dir, probe: () => durationSec, parentFilm });
  };
  // a hand-written sidecar, as the publish step (or a person) might leave it
  const raw = (series, name, meta) => {
    fs.mkdirSync(path.join(dir, series), { recursive: true });
    const f = path.join(dir, series, `${name}.mp4`);
    fs.writeFileSync(f, "");
    fs.writeFileSync(f.replace(/\.mp4$/, ".json"), JSON.stringify(meta));
    files[`${series}/${name}`] = f;
    return f;
  };
  return { src, dir, add, raw, files };
}
const reasonFor = (l, id) => l.skipped.find((s) => s.file.includes(`${id.replace("/", path.sep)}.`))?.reason;

test("the kill switch is off unless RADIO_ALLOW_SF60 is literally 1", () => {
  assert.equal(allowSf60({}), false);
  for (const v of ["0", "true", "yes", " 1", ""]) assert.equal(allowSf60({ RADIO_ALLOW_SF60: v }), false, v);
  assert.equal(allowSf60({ RADIO_ALLOW_SF60: "1" }), true);
});

test("a scoopfeeds-60 item is skipped from the library with a reason, never selected by the rotation", () => {
  const L = lib();
  L.add("a-eye", "ep3", "2026-10-20", 540);
  L.add("scoopfeeds-60", "s1", "2026-10-21", 45);
  L.add("scoopfeeds-60", "s2", "2026-10-21", 95);
  const l = loadLibrary(L.dir, { now: NOW, env: OFF });
  assert.deepEqual(l.items.map((i) => i.id), ["a-eye/ep3"]);
  assert.match(reasonFor(l, "scoopfeeds-60/s1"), /ScoopFeeds 60 may not air.*RADIO_ALLOW_SF60/);
  assert.match(reasonFor(l, "scoopfeeds-60/s2"), /ScoopFeeds 60 may not air/);
  const { plan } = planDay(l, { slots: defaultSlots("2026-10-23"), now: NOW, env: OFF });
  assert.ok(!plan.some((p) => String(p.id).startsWith("scoopfeeds-60/")));
});

test("the rotation re-checks: a hand-built library cannot slip ScoopFeeds 60 or an unlinked clip into a break", () => {
  const f = { id: "a-eye/ep3", series: "a-eye", seriesName: "A-Eye", title: "t", durationSec: 540, publishedAt: NOW - 86_400_000, file: "/x/f.mp4", kind: "film" };
  const sh = (id, extra) => ({ id, series: id.split("/")[0], seriesName: "x", title: id, durationSec: 40, publishedAt: NOW - 3600_000, file: `/x/${id}.mp4`, kind: "short", ...extra });
  const items = [f, sh("scoopfeeds-60/a"), sh("scoopfeeds-60/b", { parentFilm: "a-eye/ep3" }), sh("a-eye/teaser"), sh("a-eye/orphan", { parentFilm: "a-eye/ep9" }), sh("a-eye/ok", { parentFilm: "a-eye/ep3" })];
  const { plan } = planDay({ items }, { slots: defaultSlots("2026-10-23"), now: NOW, env: OFF });
  const shorts = plan.filter((p) => p.type === "short").map((p) => p.id);
  assert.ok(shorts.length > 0);
  assert.deepEqual([...new Set(shorts)], ["a-eye/ok"]);
});

test("a 45-second video in a long-form series folder with no parent link is skipped, with a reason", () => {
  const L = lib();
  L.add("the-record", "ep1", "2026-10-20", 600);
  L.add("the-record", "clip", "2026-10-21", 45);
  const l = loadLibrary(L.dir, { now: NOW, env: OFF });
  assert.deepEqual(l.items.map((i) => i.id), ["the-record/ep1"]);
  assert.match(reasonFor(l, "the-record/clip"), /no parentFilm link/);
});

test("a Short whose parent film is published is selected; unpublished or missing parents are skipped", () => {
  const L = lib();
  L.add("a-eye", "ep3", "2026-10-20", 540);
  L.add("a-eye", "ep4", "2026-10-30", 540);              // scheduled, not out yet
  L.add("a-eye", "ep3-s1", "2026-10-21", 50, "a-eye/ep3");
  L.add("a-eye", "ep4-s1", "2026-10-21", 50, "a-eye/ep4");
  L.add("people", "gone-s1", "2026-10-21", 50, "people/ep9");
  L.add("a-eye", "s-of-s", "2026-10-21", 50, "a-eye/ep3-s1");  // a Short is not a film: no chains
  const l = loadLibrary(L.dir, { now: NOW, env: OFF });
  assert.deepEqual(l.items.map((i) => i.id).sort(), ["a-eye/ep3", "a-eye/ep3-s1"]);
  assert.equal(l.items.find((i) => i.id === "a-eye/ep3-s1").kind, "short");
  assert.equal(l.items.find((i) => i.id === "a-eye/ep3-s1").parentFilm, "a-eye/ep3");
  assert.match(reasonFor(l, "a-eye/ep4-s1"), /parent film a-eye\/ep4 is not published yet/);
  assert.match(reasonFor(l, "people/gone-s1"), /parent film people\/ep9 is not a film in the library/);
  assert.match(reasonFor(l, "a-eye/s-of-s"), /not a film in the library/);
  const { plan } = planDay(l, { slots: defaultSlots("2026-10-23"), now: NOW, env: OFF });
  assert.ok(plan.some((p) => p.type === "short" && p.id === "a-eye/ep3-s1"));
  assert.ok(plan.filter((p) => p.type === "short").every((p) => p.id === "a-eye/ep3-s1"));
});

test("a parentFilm Short over 60 s is still a Short, never a grid film; full episodes still air", () => {
  const L = lib();
  L.add("people", "ep1", "2026-10-20", 480);
  L.add("people", "ep1-long", "2026-10-21", 90, "people/ep1");
  const l = loadLibrary(L.dir, { now: NOW, env: OFF });
  assert.deepEqual(Object.fromEntries(l.items.map((i) => [i.id, i.kind])), { "people/ep1": "film", "people/ep1-long": "short" });
  const { plan } = planDay(l, { slots: defaultSlots("2026-10-23"), now: NOW, env: OFF });
  assert.ok(plan.filter((p) => p.type === "film").every((p) => p.id === "people/ep1"));
  assert.ok(plan.some((p) => p.type === "film"));
});

test("import: --parent is validated and written to the sidecar; never under scoopfeeds-60", () => {
  const L = lib();
  const r = L.add("a-eye", "ep3-s1", "2026-10-21", 50, "a-eye/ep3");
  assert.equal(JSON.parse(fs.readFileSync(r.target.replace(/\.mp4$/, ".json"), "utf8")).parentFilm, "a-eye/ep3");
  assert.throws(() => L.add("a-eye", "bad", "2026-10-21", 50, "ep3"), /not a library id/);
  assert.throws(() => L.add("scoopfeeds-60", "x", "2026-10-21", 50, "a-eye/ep3"), /not scoopfeeds-60/);
});

test("RADIO_ALLOW_SF60=1 lifts the ScoopFeeds 60 block only; unlinked teasers stay out", () => {
  const L = lib();
  L.add("a-eye", "ep3", "2026-10-20", 540);
  L.add("scoopfeeds-60", "s1", "2026-10-21", 45);
  L.add("a-eye", "teaser", "2026-10-21", 40);
  const l = loadLibrary(L.dir, { now: NOW, env: { RADIO_ALLOW_SF60: "1" } });
  assert.deepEqual(l.items.map((i) => i.id).sort(), ["a-eye/ep3", "scoopfeeds-60/s1"]);
  assert.equal(shortIneligibility({ series: "scoopfeeds-60" }, { filmIds: new Set(), env: { RADIO_ALLOW_SF60: "1" } }), null);
});

// ── the hourly programme's film slot ────────────────────────────────────────────────────────

test("hour slot: a ScoopFeeds 60 file (RADIO_AUTOAIR_FILM) gives no film, with the reason", () => {
  const L = lib();
  L.add("a-eye", "ep3", "2026-10-20", 540);
  L.add("scoopfeeds-60", "s1", "2026-10-21", 45);
  // the env points at the PUBLISH file; the library holds a symlink to it
  const r = resolveHourShort(L.files["scoopfeeds-60/s1"], { dir: L.dir, now: NOW, env: OFF });
  assert.equal(r.item, null);
  assert.match(r.reason, /ScoopFeeds 60 may not air/);
  // and the library copy itself
  assert.match(resolveHourShort(path.join(L.dir, "scoopfeeds-60", "s1.mp4"), { dir: L.dir, now: NOW, env: OFF }).reason, /ScoopFeeds 60/);
});

test("hour slot: only an eligible long-form-derived Short; a folder gives its newest eligible one", () => {
  const L = lib();
  L.add("a-eye", "ep3", "2026-10-20", 540);
  L.add("a-eye", "ep3-s1", "2026-10-21", 50, "a-eye/ep3");
  L.add("a-eye", "ep3-s2", "2026-10-22", 50, "a-eye/ep3");
  L.add("a-eye", "teaser", "2026-10-22T06:00:00Z", 40);
  L.add("scoopfeeds-60", "s9", "2026-10-23", 45);          // newest in the publish folder, and refused
  assert.equal(resolveHourShort(L.files["a-eye/ep3-s1"], { dir: L.dir, now: NOW, env: OFF }).item.id, "a-eye/ep3-s1");
  assert.equal(resolveHourShort(L.src, { dir: L.dir, now: NOW, env: OFF }).item.id, "a-eye/ep3-s2");
  assert.match(resolveHourShort(L.files["a-eye/ep3"], { dir: L.dir, now: NOW, env: OFF }).reason, /full film, not a Short/);
  assert.match(resolveHourShort(L.files["a-eye/teaser"], { dir: L.dir, now: NOW, env: OFF }).reason, /no parentFilm link/);
  const stray = path.join(L.src, "stray.mp4"); fs.writeFileSync(stray, "");
  assert.match(resolveHourShort(stray, { dir: L.dir, now: NOW, env: OFF }).reason, /not in the film library/);
  assert.match(resolveHourShort(path.join(L.src, "nope.mp4"), { dir: L.dir, now: NOW, env: OFF }).reason, /does not exist/);
  const onlySf60 = fs.mkdtempSync(path.join(os.tmpdir(), "s216-only-"));
  fs.symlinkSync(L.files["scoopfeeds-60/s9"], path.join(onlySf60, "s9.mp4"));
  fs.symlinkSync(L.files["a-eye/teaser"], path.join(onlySf60, "teaser.mp4"));
  assert.match(resolveHourShort(onlySf60, { dir: L.dir, now: NOW, env: OFF }).reason, /no eligible Short among 2/);
});

test("clock: the film slot is never titled ScoopFeeds 60; with no Short it is music, and the clock stays whole", () => {
  const H = Date.UTC(2026, 9, 28, 16);
  for (const opts of [{}, { film: true, filmTitle: "From A-Eye: x" }, { film: false }, { film: false, featureSec: 600, featureTitle: "Ep" }]) {
    const c = buildClock(H, opts);
    assert.deepEqual(checkClock(c), []);
    assert.ok(!c.some((s) => /ScoopFeeds 60/.test(s.title || "")), JSON.stringify(opts));
  }
  assert.equal(buildClock(H, { film: false }).find((s) => s.id === "film").kind, "music");
  assert.ok(!buildClock(H, { film: false }).some((s) => s.kind === "film"));
  assert.equal(buildClock(H, { filmTitle: "From A-Eye: x" }).find((s) => s.id === "film").title, "From A-Eye: x");
});
