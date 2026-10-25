// weatherMap.test.js - #247 (DrJ, 25 Oct 2026): one unit for every city (°C big, °F small) on both radio screens,
// and the programme screen's weather scene is an animated map that moves city to city in the order the lines are
// read. The rendered tests need a Chromium; where none can be launched (the CI runner has none) they are SKIPPED,
// which is not a pass. The static checks run everywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { SCREEN_247, SCREEN_PROG, launch } from "./fontFloor.mjs";
import { sampleProgramme } from "./fixtures/sampleProgramme.mjs";

test("static: no US special case and no °F-first temperature on either screen", () => {
  for (const f of [SCREEN_247, SCREEN_PROG]) {
    const html = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(html, /new Set\(\['New York', ?'Washington'\]\)/, `${f}: US cities special-cased`);
    assert.doesNotMatch(html, /\$\{[^}]*\.f\}°F<small>/, `${f}: °F as the main number`);
    assert.doesNotMatch(html, /class="p">\$\{c\.f\}°F/, `${f}: °F first in the ticker`);
  }
  const prog = fs.readFileSync(SCREEN_PROG, "utf8");
  assert.match(prog, /\$\{w\.c\}°C<small>\$\{w\.f\}°F<\/small>/, "map pins: °C big, °F small");
  assert.match(prog, /\$\{w\.c\}°C <i class="f">\$\{w\.f\}°F<\/i>/, "rail: °C first, °F beside it");
  assert.doesNotMatch(prog, /id="wGrid"/, "the card grid is gone");
});

let browser = null, why = null;
try { browser = await launch(); } catch (e) { why = `no Chromium here (${e.message.split("\n")[0]}): the map is UNVERIFIED on this machine`; }

async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });   // 720p: the floor DrJ reads on
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(SCREEN_PROG).href);
  await page.waitForFunction(() => !!window.ScoopProgramme);
  return { page, errors };
}
const at = (page, t) => page.evaluate((t) => { window.ScoopProgramme.renderAt(t); window.ScoopProgramme.renderAt(t); }, t);
const state = (page) => page.evaluate(() => ({
  scene: document.querySelector(".scene.on")?.dataset.scene,
  viewBox: document.getElementById("wMap").getAttribute("viewBox"),
  act: document.querySelector(".pin.act")?.dataset.city || null,
  shown: [...document.querySelectorAll(".pin.in")].map((e) => e.dataset.city),
  actShown: !!document.querySelector(".pin.act.in"),
  inFrame: (() => { const m = document.getElementById("main").getBoundingClientRect();
    return [...document.querySelectorAll(".pin.in .lab")].every((l) => { const r = l.getBoundingClientRect(); return r.left >= m.left && r.right <= m.right && r.top >= m.top && r.bottom <= m.bottom; }); })(),
  overlap: (() => { const rs = [...document.querySelectorAll(".pin.in .lab")].map((l) => l.getBoundingClientRect());
    return rs.some((a, i) => rs.some((b, j) => i < j && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)); })(),
}));

test("rendered: the map moves city to city in reading order, the city being read is highlighted and on screen", { skip: why || false }, async () => {
  const { page, errors } = await open();
  try {
    const { programme, scenes } = sampleProgramme();
    await page.evaluate((p) => window.ScoopProgramme.set(p), programme);
    const focus = scenes.weather.data.focus;
    assert.equal(focus.length, 10, "the fixture reads all ten cities");
    await at(page, scenes.weather.at);
    const first = await state(page);
    assert.equal(first.scene, "weather");
    assert.equal(first.act, null, "before the first line: the whole map, nothing highlighted");
    const seen = [], boxes = [];
    for (const f of focus) {
      await at(page, f.at + 2500);   // the camera has arrived (1.8 s move)
      const s = await state(page);
      assert.equal(s.scene, "weather");
      assert.equal(s.act, f.city, `at ${f.city}'s line, ${f.city} is highlighted`);
      assert.ok(s.actShown, `${f.city}: its pin is drawn`);
      assert.ok(s.inFrame, `${f.city}: every drawn pin is whole inside the frame`);
      assert.ok(!s.overlap, `${f.city}: no two drawn pins overlap`);
      seen.push(s.act); boxes.push(s.viewBox);
    }
    assert.deepEqual(seen, focus.map((f) => f.city));
    assert.ok(new Set(boxes).size >= 5, "the camera framed at least five different places (US, Europe, Gulf, South Asia, Tokyo)");
    // mid-move: between two regions the camera is between them (it animates, it does not cut)
    const xOf = (vb) => Number(vb.split(" ")[0]);
    await at(page, focus[2].at - 100); const before = xOf((await state(page)).viewBox);
    await at(page, focus[2].at + 900); const mid = xOf((await state(page)).viewBox);
    await at(page, focus[2].at + 2500); const after = xOf((await state(page)).viewBox);
    assert.ok(before < mid && mid < after, `US → Europe pans east (${before} → ${mid} → ${after})`);
    // within a region the camera keeps pushing in slowly
    const w = (vb) => Number(vb.split(" ")[2]);
    await at(page, focus[4].at + 2500); const g1 = w((await state(page)).viewBox);
    await at(page, focus[6].at + 2500); const g2 = w((await state(page)).viewBox);
    assert.ok(g2 < g1, "a slow zoom while the Gulf is read");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("rendered: an older programme with no per-line timing still tours the cities in reading order", { skip: why || false }, async () => {
  const { page, errors } = await open();
  try {
    const { programme, scenes } = sampleProgramme();
    const cue = programme.cues.find((c) => c.scene === "weather");
    delete cue.data.focus;
    programme.cues = programme.cues.filter((c) => c.scene !== "weather" || c === cue);
    await page.evaluate((p) => window.ScoopProgramme.set(p), programme);
    const slot = programme.slots.find((s) => s.id === "weather");
    const order = [];
    for (let t = cue.at + 3000; t < slot.end - 1000; t += 2000) { await at(page, t); const s = await state(page); if (s.act && order.at(-1) !== s.act) order.push(s.act); }
    assert.deepEqual(order, scenes.weather.data.cities.map((w) => w.city));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("rendered: under five cities the map is never drawn part-empty: the scene is music", { skip: why || false }, async () => {
  const { page, errors } = await open();
  try {
    const { programme, scenes } = sampleProgramme();
    const cue = programme.cues.find((c) => c.scene === "weather");
    cue.data = { ...cue.data, cities: cue.data.cities.slice(0, 4) };
    programme.cues = programme.cues.filter((c) => c.scene !== "weather" || c === cue);
    await page.evaluate((p) => window.ScoopProgramme.set(p), programme);
    await at(page, scenes.weather.at + 10000);
    assert.equal((await state(page)).scene, "music");
    assert.ok(await page.evaluate(() => !!document.querySelector("#hcards .hcard")), "the music scene carries its headline cards");
    assert.deepEqual(errors, []);
  } finally { await page.close(); await browser.close(); }
});
