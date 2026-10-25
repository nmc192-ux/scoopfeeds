// grid.test.js - the channel grid (#200): the doc and the data agree, each daypart's rehearsal hour has the right
// segments and screen elements, overrides resume cleanly, and the Crypto segment is held to its fact pack.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DAYPARTS, SEGMENTS, ELEMENTS, FIXED, planHour, applyOverride, elementsOnAir, sessionsAt, nextFeature, etHour } from "./grid.js";
import { buildClock, buildGridClock, checkClock } from "./clock.js";
import { checkSegments } from "./checks.js";
import { buildPrompt, packText } from "./writer.js";
import { parseCrypto } from "./factPack.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DOC = fs.readFileSync(path.resolve(here, "../../../../docs/radio/channel-grid.md"), "utf8");

/** Rows of the first markdown table after `heading`, as arrays of trimmed cells. */
function table(heading) {
  const at = DOC.indexOf(heading);
  assert.ok(at >= 0, `doc has a "${heading}" section`);
  const lines = DOC.slice(at).split("\n");
  const start = lines.findIndex((l) => l.startsWith("|"));
  const rows = [];
  for (const l of lines.slice(start + 2)) { if (!l.startsWith("|")) break; rows.push(l.slice(1, -1).split("|").map((c) => c.trim())); }
  return rows;
}

const ET_MIDNIGHT_SUMMER = Date.parse("2026-10-27T04:00:00Z");   // Tue 27 Oct 2026, 00:00 New York (EDT)
const ET_MIDNIGHT_WINTER = Date.parse("2026-11-10T05:00:00Z");   // Tue 10 Nov 2026, 00:00 New York (EST)
const hourAt = (midnight, h) => midnight + h * 3_600_000;
const yn = (b) => (b ? "yes" : "no");

test("grid doc and grid.js agree on every hour, in summer and in winter time", () => {
  const rows = table("## The 24 hours");
  assert.equal(rows.length, 24, "the doc lists 24 hours");
  for (const midnight of [ET_MIDNIGHT_SUMMER, ET_MIDNIGHT_WINTER]) {
    rows.forEach(([hh, name, format, audience, weather, crypto, film], h) => {
      const p = planHour(hourAt(midnight, h));
      assert.equal(hh, `${String(h).padStart(2, "0")}:00`);
      assert.equal(p.etHour, h);
      const d = DAYPARTS.find((x) => x.id === p.daypart);
      assert.deepEqual([name, format, audience, weather, crypto, film], [d.name, p.format, p.audience, yn(p.weather), yn(p.crypto), yn(Boolean(p.feature))], `${hh} ET`);
    });
  }
});

test("doc's local-time columns are New York + the zone offset on the summer reference day", () => {
  const local = (ms, tz) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  table("## The 24 hours").forEach((r, h) => {
    const t = hourAt(ET_MIDNIGHT_SUMMER, h);
    assert.deepEqual(r.slice(7), [local(t, "Europe/London"), local(t, "Asia/Dubai"), local(t, "Asia/Karachi")], r[0]);
  });
});

test("doc's segment catalogue is grid.js SEGMENTS", () => {
  const rows = table("## The segment catalogue");
  assert.deepEqual(rows.map(([name, id, kind, every, status]) => ({ name, id, kind, every, status })),
    SEGMENTS.map(({ name, id, kind, every, status }) => ({ name, id, kind, every, status })));
});

test("doc's screen elements are grid.js ELEMENTS", () => {
  const rows = table("## Screen elements");
  assert.deepEqual(rows.map(([name, id]) => ({ name, id })), ELEMENTS.map(({ name, id }) => ({ name, id })));
});

test("the dayparts cover 0-24 ET with no gap or overlap", () => {
  let h = 0;
  for (const d of DAYPARTS) { assert.equal(d.fromEt, h, d.id); assert.ok(d.toEt > d.fromEt); h = d.toEt; }
  assert.equal(h, 24);
});

// ── a rehearsal hour in each daypart ─────────────────────────────────────────

const REHEARSAL = { "overnight-me": 1, "overnight-eu": 3, "us-morning": 8, "us-day": 10, "us-evening": 17, primetime: 21, "south-asia": 22 };

for (const [daypart, h] of Object.entries(REHEARSAL)) {
  test(`rehearsal hour, ${daypart} (${h}:00 ET): right segments, contiguous clock, right elements`, () => {
    const H = hourAt(ET_MIDNIGHT_SUMMER, h);
    const { plan, slots } = buildGridClock(H, { featureSec: 700, featureTitle: "A-Eye #003", film: true });
    assert.equal(plan.daypart, daypart);
    assert.deepEqual(checkClock(slots), [], "slots contiguous, -15:00 to 60:30");
    const ids = slots.map((s) => s.id);
    // every hour: the top ident on :00:00, The Hour, half-hour headlines
    const top = slots.find((s) => s.id === "ident-top");
    assert.equal(top.endSec > 0 && top.startSec < 0, true, "the ident straddles :00:00 (ping on the hour)");
    assert.ok(ids.includes("the-hour") && ids.includes("half"));
    // weather every two hours
    assert.equal(ids.includes("weather"), h % 2 === 0, "weather on even ET hours only");
    if (h % 2) assert.equal(slots.find((s) => s.id === "half").stories, 7, "weather's time goes to the half-hour headlines");
    // Crypto in produced hours
    assert.equal(ids.includes("crypto"), plan.format === "produced");
    if (plan.format === "produced") {
      const c = slots.find((s) => s.id === "crypto");
      assert.deepEqual([c.kind, c.segment, c.lenSec], ["spoken", "crypto", 90]);
    }
    // the film only in its fixed slot
    assert.equal(ids.includes("feature"), h === 21, "feature airs only at 9 pm ET");
    assert.equal(plan.featureDropped, h !== 21);
    // markets titled by the exchanges in session
    for (const m of slots.filter((s) => s.segment === "markets")) {
      const open = sessionsAt(m.start).map((x) => x.id);
      assert.deepEqual(m.sessions, open, `${m.id} sessions`);
      assert.match(m.title, /^Markets Now/);
    }
    // elements
    const byId = Object.fromEntries(slots.map((s) => [s.id, s.elements]));
    assert.deepEqual(byId["ident-top"], ["live-bug"]);
    assert.ok(byId["the-hour"].includes("lower-third") && byId["the-hour"].includes("coming-up"));
    assert.ok(byId["music-1"].includes("weather-scroller") && byId["music-1"].includes("markets-ticker"));
    for (const s of slots.filter((x) => !["ident", "feature", "countdown", "endcard"].includes(x.kind))) {
      assert.ok(["live-bug", "clocks", "headline-ticker"].every((e) => s.elements.includes(e)), `${s.id} has the persistent frame`);
    }
  });
}

test("10:00 ET on a weekday: Markets Now names New York, London and Frankfurt and leads with US and Europe", () => {
  const { slots } = buildGridClock(hourAt(ET_MIDNIGHT_SUMMER, 10));
  const m = slots.find((s) => s.id === "markets-1");
  assert.equal(m.title, "Markets Now: New York, London and Frankfurt trading");
  assert.deepEqual(m.marketsLead, ["US", "Europe"]);
});

test("weekend: no exchange is open, Markets Now has no session in its title", () => {
  const sat = Date.parse("2026-10-31T14:00:00Z");   // Sat 10:00 ET
  const { slots } = buildGridClock(sat);
  assert.equal(slots.find((s) => s.id === "markets-1").title, "Markets Now");
  assert.deepEqual(slots.find((s) => s.id === "markets-1").sessions, []);
});

test("Tokyo open at 9 pm ET: in `sessions`, but not promised in the title (no Tokyo rows in the pack)", () => {
  const { slots } = buildGridClock(hourAt(ET_MIDNIGHT_SUMMER, 21));
  const m = slots.find((s) => s.id === "markets-1");
  assert.ok(m.sessions.includes("TSE"));
  assert.equal(m.title, "Markets Now");
});

test("without the grid the running order is unchanged", () => {
  const H = hourAt(ET_MIDNIGHT_SUMMER, 10);
  const ids = buildClock(H).map((s) => s.id);
  assert.ok(!ids.includes("crypto"));
  assert.ok(ids.includes("weather"));
  assert.ok(buildClock(H).every((s) => !("elements" in s)));
});

test("fixed feature slot and its promo", () => {
  assert.deepEqual(FIXED.map((f) => [f.etHour, f.promo]), [[21, "tonight at 9 ET"]]);
  const at3pm = hourAt(ET_MIDNIGHT_SUMMER, 15) + 20 * 60_000;
  const n = nextFeature(at3pm);
  assert.equal(etHour(n.at), 21);
  assert.equal(n.at, hourAt(ET_MIDNIGHT_SUMMER, 21));
  assert.equal(nextFeature(hourAt(ET_MIDNIGHT_SUMMER, 21) + 20 * 60_000).at, hourAt(ET_MIDNIGHT_SUMMER, 21), "during the film, the film is now");
  assert.equal(nextFeature(hourAt(ET_MIDNIGHT_SUMMER, 22)).at, hourAt(ET_MIDNIGHT_SUMMER, 24 + 21), "after it, tomorrow's");
});

// ── earn-render ──────────────────────────────────────────────────────────────

test("earn-render: an element with no data is not on air", () => {
  const { slots } = buildGridClock(hourAt(ET_MIDNIGHT_SUMMER, 10));
  const music = slots.find((s) => s.id === "music-1");
  assert.deepEqual(elementsOnAir(music, {}), ["live-bug", "clocks"], "no title, no headlines, no figures: just the bug and clocks");
  assert.deepEqual(elementsOnAir(music, { headlines: [{ h: "x" }], markets: [{}], weather: [], next: { title: "Middle East desk" } }),
    ["live-bug", "clocks", "headline-ticker", "coming-up", "markets-ticker"]);
  const story = slots.find((s) => s.id === "the-hour");
  assert.ok(elementsOnAir(story, { story: true }).includes("lower-third"));
  assert.ok(!elementsOnAir(story, {}).includes("lower-third"));
});

// ── overrides ────────────────────────────────────────────────────────────────

const H10 = hourAt(ET_MIDNIGHT_SUMMER, 10);
const at = (min, sec = 0) => H10 + (min * 60 + sec) * 1000;

test("breaking news inside a segment: cut there, resume at the next segment's own start", () => {
  const { slots } = buildGridClock(H10);
  const out = applyOverride(slots, { kind: "breaking", title: "Breaking: test", start: at(3), end: at(7) });
  assert.deepEqual(checkClock(out), []);
  const hour = out.find((s) => s.id === "the-hour");
  assert.equal(hour.endSec, 180, "The Hour cut at 3:00");
  const ov = out.find((s) => s.override);
  assert.deepEqual([ov.kind, ov.startSec, ov.endSec], ["breaking", 180, 420]);
  // the override ended at 7:00, inside markets-1 (6:00-8:00): headlines and music until compared-1 at 8:00
  assert.ok(!out.some((s) => s.id === "markets-1"), "the segment the override ran into is not resumed half way");
  const gap = out.find((s) => s.id === "override-resume");
  assert.deepEqual([gap.kind, gap.startSec, gap.endSec, gap.nextTitle], ["music", 420, 480, "The News, Compared"]);
  const resumed = out.find((s) => s.id === "compared-1");
  assert.equal(resumed.startSec, 480);
  assert.deepEqual(out.slice(out.indexOf(resumed)).map((s) => s.id), slots.slice(slots.findIndex((s) => s.id === "compared-1")).map((s) => s.id), "the rest of the grid is untouched");
});

test("live event ending exactly on a boundary: no filler, the grid resumes at once", () => {
  const { slots } = buildGridClock(H10);
  const out = applyOverride(slots, { kind: "live", title: "LIVE · White House briefing", start: at(20), end: at(26) });
  assert.deepEqual(checkClock(out), []);
  assert.ok(!out.some((s) => s.id === "override-resume"));
  assert.equal(out[out.findIndex((s) => s.override) + 1].startSec, 26 * 60);
});

test("an override that runs past the end of the hour ends with the programme", () => {
  const { slots } = buildGridClock(H10);
  const out = applyOverride(slots, { kind: "live", title: "LIVE", start: at(50), end: at(90) });
  assert.deepEqual(checkClock(out), []);
  assert.equal(out.at(-1).override, true);
});

test("overrides refuse nonsense", () => {
  const { slots } = buildGridClock(H10);
  assert.throws(() => applyOverride(slots, { kind: "live", start: at(5), end: at(5) }));
  assert.throws(() => applyOverride(slots, { kind: "film", start: at(5), end: at(6) }));
});

// ── the Crypto segment: fact pack, writer prompt, checks ─────────────────────

const PACK = {
  builtAt: H10, top: [], desks: {}, weather: [],
  markets: [{ key: "S&P 500", group: "US", price: 6512.4, pct: 0.42 }],
  crypto: parseCrypto({ data: { crypto: [
    { symbol: "btc", name: "Bitcoin", price: 98450.12, changePct: 1.8412 },
    { symbol: "eth", name: "Ethereum", price: 3420.5, changePct: -0.73 },
    { symbol: "ada", name: "Cardano", price: 0.71, changePct: 2 },   // not kept
    { symbol: "sol", name: "Solana", price: null, changePct: 1 },    // no price: dropped
  ] } }),
};

test("parseCrypto keeps the listed coins with a real price, Bitcoin first", () => {
  assert.deepEqual(PACK.crypto.map((c) => [c.sym, c.price, c.pct]), [["BTC", 98450.12, 1.84], ["ETH", 3420.5, -0.73]]);
});

test("writer: the CRYPTO section and the crypto prompt appear only with crypto rows", () => {
  assert.match(packText(PACK), /CRYPTO .*\n\s+Bitcoin \(BTC\): 98450\.12 \+1\.84%/);
  assert.doesNotMatch(packText({ ...PACK, crypto: undefined }), /CRYPTO/);
  const { slots } = buildGridClock(H10);
  const p = buildPrompt(PACK, slots.filter((s) => s.kind === "spoken"), { hourLabel: "ten in the morning in New York", cityTimes: "seven in the evening in Karachi", marketsAsOf: {} });
  assert.match(p, /"crypto" \(Crypto, 90 s, max \d+ words\): lines "c1".. using only CRYPTO rows/);
  assert.match(p, /Never predict prices/);
});

test("checks: a crypto line with a figure not in the CRYPTO rows is dropped; backed figures air", () => {
  const slot = { id: "crypto", kind: "spoken", segment: "crypto" };
  const segments = { crypto: { lines: [
    { id: "c1", text: "Bitcoin is at 98,450 dollars, up 1.8 percent in a day." },
    { id: "c2", text: "Ether is at 3,420 dollars, down 0.7 percent." },
    { id: "c3", text: "Bitcoin could reach 150,000 dollars." },
    { id: "c4", text: "The S&P 500 is at 6512." },   // a stock figure is not a crypto row
  ] } };
  const { segments: kept, report } = checkSegments(segments, [slot], PACK);
  assert.deepEqual(kept.crypto.lines.map((l) => l.id), ["c1", "c2"]);
  assert.deepEqual(report.map((r) => r.line), ["c3", "c4"]);
  assert.ok(report.every((r) => /unbacked figure/.test(r.drop)));
});
