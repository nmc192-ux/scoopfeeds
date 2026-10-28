// comingUp.test.js - #285 (DrJ note 1): in the v1.5 clock the music scene shows what is coming up, with a countdown,
// beside the markets and weather rail, instead of looping the headline cards just read. Without the v1.5 clock the
// music scene is unchanged (headline cards). The rendered tests need a Chromium; where none can be launched (the CI
// runner has none) they are SKIPPED, which is not a pass. The static check runs everywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { SCREEN_PROG, launch, FLOOR_PX } from "./fontFloor.mjs";
import { sampleProgramme } from "./fixtures/sampleProgramme.mjs";
import { buildGridClock } from "../programme/clock.js";

const H = Date.parse("2026-10-27T14:00:00Z");   // Tue 10:00 New York

test("static: the music scene has a Coming up card for the v1.5 clock, and keeps the headline cards otherwise", () => {
  const html = fs.readFileSync(SCREEN_PROG, "utf8");
  assert.match(html, /function comingUpCard\(t\)/);
  assert.match(html, /if \(PROG\.clock === 'v15'\) return comingUpCard\(t\);/);
  assert.match(html, /<div class="kicker caps">Headlines<\/div>/);
});

/** The sample programme on the v1.5 grid clock: a music cue in music-3 (37:30-39:00), the Business desk next. */
function v15Programme() {
  const { programme } = sampleProgramme(H);
  const { slots } = buildGridClock(H, { v15: true });
  const m3 = slots.find((s) => s.id === "music-3");
  const cues = [...programme.cues.filter((c) => c.at < m3.start), { at: m3.start, scene: "music", data: { next: { title: "Business desk", at: m3.end } } }];
  return { programme: { ...programme, clock: "v15", cues, slots: slots.map(({ id, kind, start, end, title }) => ({ id, kind, start, end, title: title || null })) }, m3 };
}

let browser = null, why = null;
try { browser = await launch(); } catch (e) { why = `no Chromium here (${e.message.split("\n")[0]}): the screen is UNVERIFIED on this machine`; }

async function open() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(SCREEN_PROG).href);
  await page.waitForFunction(() => !!window.ScoopProgramme);
  return { page, errors };
}
const at = (page, t) => page.evaluate((t) => { window.ScoopProgramme.renderAt(t); window.ScoopProgramme.renderAt(t); }, t);
const card = (page) => page.evaluate(() => {
  const c = document.querySelector("#hcards .hcard");
  return { scene: document.querySelector(".scene.on")?.dataset.scene, kicker: c?.querySelector(".kicker")?.textContent || null, title: c?.querySelector("p")?.textContent || null,
    src: c?.querySelector(".src")?.textContent || null, px: c ? Math.min(...[...c.querySelectorAll("*")].filter((e) => e.textContent.trim()).map((e) => parseFloat(getComputedStyle(e).fontSize))) : null,
    rail: !document.getElementById("rMk").hidden || !document.getElementById("rWx").hidden };
});

test("rendered: v1.5 music shows Coming up, the next segment and a countdown, never a headline card", { skip: why || false }, async () => {
  const { page, errors } = await open();
  try {
    const { programme, m3 } = v15Programme();
    await page.evaluate((p) => window.ScoopProgramme.set(p), programme);
    await at(page, m3.start + 30_000);
    const c = await card(page);
    assert.equal(c.scene, "music");
    assert.equal(c.kicker, "Coming up");
    assert.equal(c.title, "Business desk: New York, London and Frankfurt trading");
    assert.match(c.src, /^in 1:00 · 10:39 New York$/);
    assert.ok(c.rail, "the markets and weather rail is beside it");
    assert.ok(c.px >= FLOOR_PX, `card text at least ${FLOOR_PX} px (${c.px})`);
    assert.ok(!programme.headlines.some((h) => c.title === h.h), "no headline card");
    await at(page, m3.start + 75_000);
    assert.match((await card(page)).src, /^in 0:15 /, "the countdown runs");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("rendered: without the v1.5 clock the music scene still rotates the headline cards", { skip: why || false }, async () => {
  const { page, errors } = await open();
  try {
    const { programme, scenes } = sampleProgramme(H);
    await page.evaluate((p) => window.ScoopProgramme.set(p), programme);
    await at(page, scenes.music.at);
    const c = await card(page);
    assert.equal(c.kicker, "Headlines");
    assert.ok(programme.headlines.some((h) => h.h === c.title));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test.after(async () => { if (browser) await browser.close(); });
