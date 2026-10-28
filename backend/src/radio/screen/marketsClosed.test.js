// marketsClosed.test.js - #282 (DrJ note 10): on a weekend or overnight the programme screen's market board and
// rail never show the last session's close as live. Rows are labelled by programme/marketsClock.labelScreenMarkets;
// the screen reads `closed`. The rendered tests need a Chromium; where none can be launched (the CI runner has
// none) they are SKIPPED, which is not a pass. The static checks run everywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { SCREEN_PROG, launch } from "./fontFloor.mjs";
import { sampleProgramme } from "./fixtures/sampleProgramme.mjs";
import { labelScreenMarkets } from "../programme/marketsClock.js";

const utc = (s) => Date.parse(s);
const MIN = 60_000;

test("static: the markets heading is not a fixed \"as of\" sentence, and closed rows are styled", () => {
  const html = fs.readFileSync(SCREEN_PROG, "utf8");
  assert.doesNotMatch(html, /The markets, as of <span/, "the heading no longer hard-codes \"as of <time>\"");
  assert.match(html, /function marketsHeading\(/);
  assert.match(html, /\.tile\.closed/);
  assert.match(html, /\.rb \.r\.closed/);
});

// Friday 30 Oct 2026 closes; aired Sunday 1 Nov 2026 12:00 New York (17:00Z)
const FRI_US = utc("2026-10-30T20:00:00Z"), FRI_EU = utc("2026-10-30T16:30:00Z"), FRI_FUT = utc("2026-10-30T21:00:00Z");
const SUN_NOON = utc("2026-11-01T17:00:00Z");
const TUE_11 = utc("2026-10-27T15:00:00Z");
const sundayRows = () => [
  { key: "S&P 500", sym: "^GSPC", group: "US", price: 6800.5, pct: 0.31, time: FRI_US },
  { key: "Dow", sym: "^DJI", group: "US", price: 47100.2, pct: 0.42, time: FRI_US },
  { key: "Nasdaq", sym: "^IXIC", group: "US", price: 23000.1, pct: -0.25, time: FRI_US },
  { key: "FTSE 100", sym: "^FTSE", group: "Europe", price: 9700.3, pct: -0.21, time: FRI_EU },
  { key: "Brent", sym: "BZ=F", group: "Commodities", price: 64.8, pct: -1.1, time: FRI_FUT },
  { key: "Gold", sym: "GC=F", group: "Commodities", price: 4100, pct: -0.6, time: FRI_FUT },
  { key: "Bitcoin", sym: "BTC", group: "Crypto", price: 98450, pct: 1.84, time: SUN_NOON - MIN },
];
const weekdayRows = () => [
  { key: "S&P 500", sym: "^GSPC", group: "US", price: 6810, pct: 0.2, time: TUE_11 - 2 * MIN },
  { key: "Dow", sym: "^DJI", group: "US", price: 47150, pct: 0.1, time: TUE_11 - 2 * MIN },
  { key: "Nasdaq", sym: "^IXIC", group: "US", price: 23010, pct: 0.1, time: TUE_11 - 2 * MIN },
  { key: "Nikkei 225", sym: "^N225", group: "Asia", price: 50100, pct: 0.9, time: utc("2026-10-27T06:00:00Z") },
  { key: "Bitcoin", sym: "BTC", group: "Crypto", price: 98000, pct: -0.4, time: TUE_11 - MIN },
];

/** The sample programme moved to `hourStart`, its Markets scene and rail carrying `rows`, labelled as produce.mjs does. */
function programmeWith(hourStart, rows) {
  const { programme, scenes } = sampleProgramme(hourStart);
  const mk = { ...scenes.markets, data: { ...scenes.markets.data, rows, asOf: hourStart - 10 * MIN } };
  const p = labelScreenMarkets({ ...programme, cues: programme.cues.map((c) => (c.at === mk.at && c.scene === "markets" ? mk : c)), rail: { ...programme.rail, markets: rows } });
  return { programme: p, scenes: { ...scenes, markets: mk } };
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
const board = (page) => page.evaluate(() => ({
  scene: document.querySelector(".scene.on")?.dataset.scene,
  head: document.getElementById("mHead").textContent,
  sceneText: document.querySelector('[data-scene="markets"]').innerText,
  tiles: [...document.querySelectorAll("#mBoard .tile")].map((t) => ({ key: t.querySelector(".n").textContent, closed: t.classList.contains("closed"), chip: t.querySelector(".cl")?.textContent || null })),
}));
const rail = (page) => page.evaluate(() => ({
  shown: !document.getElementById("rMk").hidden,
  head: document.querySelector("#rMk h4")?.textContent,
  rows: [...document.querySelectorAll("#rMk .r")].map((r) => ({ key: r.firstElementChild.firstChild.textContent, closed: r.classList.contains("closed"), chip: r.querySelector(".cl")?.textContent || null,
    fits: r.scrollWidth <= r.clientWidth + 1 && r.getBoundingClientRect().height < 26 * 1.3 * 1.5 + 8 })),   // no overflow, one line
}));

test("rendered: Sunday 12:00 ET, heading and every index row say Friday's close; nothing says \"as of 12:00\"", { skip: why || false }, async () => {
  const { page, errors } = await open();
  try {
    const { programme, scenes } = programmeWith(SUN_NOON, sundayRows());
    await page.evaluate((p) => window.ScoopProgramme.set(p), programme);
    await at(page, scenes.markets.at);
    const b = await board(page);
    assert.equal(b.scene, "markets");
    assert.equal(b.head, "Markets closed: Friday's close, 30 Oct");
    assert.doesNotMatch(b.sceneText, /as of \d|live at/i, "nothing on the board reads as live");
    for (const t of b.tiles) {
      if (t.key === "Bitcoin") { assert.equal(t.closed, false); assert.equal(t.chip, null); continue; }
      assert.equal(t.closed, true, t.key); assert.equal(t.chip?.toLowerCase(), "closed · fri", t.key);
    }
    await at(page, scenes.story.at);   // the rail shows on story scenes
    const r = await rail(page);
    assert.ok(r.shown);
    assert.equal(r.head, "Markets closed");
    for (const x of r.rows) {
      assert.ok(x.fits, `${x.key}: the rail row overflows or wraps`);
      if (x.key === "Bitcoin") assert.equal(x.closed, false); else { assert.equal(x.closed, true, x.key); assert.equal(x.chip, "Fri close", x.key); }
    }
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("rendered: weekday 11:00 ET, NYSE rows are live and the Tokyo row says closed", { skip: why || false }, async () => {
  const { page, errors } = await open();
  try {
    const { programme, scenes } = programmeWith(TUE_11 - 6 * MIN, weekdayRows());
    await page.evaluate((p) => window.ScoopProgramme.set(p), programme);
    await at(page, scenes.markets.at);
    const b = await board(page);
    assert.match(b.head, /^Markets, live at 10:\d\d AM New York$/);
    const by = Object.fromEntries(b.tiles.map((t) => [t.key, t]));
    for (const k of ["S&P 500", "Dow", "Nasdaq"]) assert.equal(by[k].closed, false, k);
    assert.equal(by["Nikkei 225"].closed, true);
    assert.equal(by["Nikkei 225"].chip.toLowerCase(), "closed · tue");
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("rendered: a row with no trade time shows closed, never live", { skip: why || false }, async () => {
  const { page } = await open();
  try {
    const rows = weekdayRows().map((r) => (r.key === "Dow" ? { ...r, time: undefined } : r));
    const { programme, scenes } = programmeWith(TUE_11 - 6 * MIN, rows);
    await page.evaluate((p) => window.ScoopProgramme.set(p), programme);
    await at(page, scenes.markets.at);
    const dow = (await board(page)).tiles.find((t) => t.key === "Dow");
    assert.equal(dow.closed, true); assert.equal(dow.chip.toLowerCase(), "closed");
  } finally { await page.close(); }
});

test.after(async () => { if (browser) await browser.close(); });
