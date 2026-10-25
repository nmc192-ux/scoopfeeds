// #245: a closed market's last close is never presented as today's move.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { labelMarkets, closedFor, staleMarketLine, stripCloseDates, marketsShutAt } from "./marketsClock.js";
import { packText, buildPrompt } from "./writer.js";
import { checkSegments } from "./checks.js";
import { airCheck, marketsProblems } from "./airCheck.js";
import { parseCnbc } from "./factPack.js";

const utc = (s) => Date.parse(s);
// Sunday 25 Oct 2026, 15:00 New York (EDT, UTC-4). The previous session is Friday 23 Oct, closing 16:00 New York.
const SUN_15_ET = utc("2026-10-25T19:00:00Z");
const FRI_16_ET = utc("2026-10-23T20:00:00Z");
const FRI_LON = utc("2026-10-23T15:30:00Z"), FRI_FRA = utc("2026-10-23T15:30:00Z");
// Tuesday 27 Oct 2026, 11:00 New York (still EDT): every exchange open, rows a minute old.
const TUE_11_ET = utc("2026-10-27T15:00:00Z");

const rows = (t, tl = t, tf = t) => [
  { key: "S&P 500", sym: "^GSPC", group: "US", price: 6800.5, pct: 0.31, time: t },
  { key: "Dow", sym: "^DJI", group: "US", price: 47100.2, pct: 0.42, time: t },
  { key: "Nasdaq", sym: "^IXIC", group: "US", price: 23000.1, pct: -0.25, time: t },
  { key: "FTSE 100", sym: "^FTSE", group: "Europe", price: 9600, pct: 0.12, time: tl },
  { key: "DAX", sym: "^GDAXI", group: "Europe", price: 24200, pct: -0.4, time: tf },
  { key: "Brent", sym: "BZ=F", group: "Commodities", price: 66.2, pct: 1.1, time: t },
  { key: "Gold", sym: "GC=F", group: "Commodities", price: 4100, pct: -0.6, time: t },
  { key: "Bitcoin", sym: "BTC", group: "Crypto", price: 98450.12, pct: 1.84, time: SUN_15_ET },
];
const pack = (markets) => ({ builtAt: 1, top: [], desks: {}, markets, weather: [] });
const slots = [{ id: "markets-1", segment: "markets", title: "Markets Now", lenSec: 120 }];

test("Sunday 15:00 ET, rows from Friday's close: every index row is marked Friday's close, the prompt says closed", () => {
  const p = labelMarkets(pack(rows(FRI_16_ET, FRI_LON, FRI_FRA)), SUN_15_ET + 60_000);
  for (const r of p.markets.filter((m) => m.group !== "Crypto")) assert.equal(r.closed?.label, "closed: at Friday's close, 23 Oct", r.key);
  const txt = packText(p);
  assert.match(txt, /a row marked closed is NOT today's move/);
  assert.match(txt, /Dow \(US\): 47100\.2 \+0\.42% \(closed: at Friday's close, 23 Oct\)/);
  assert.equal(marketsShutAt(SUN_15_ET + 60_000), "weekend");
  const prompt = buildPrompt(p, slots, { hourLabel: "x", cityTimes: "y", marketsAsOf: { "markets-1": "3:00 PM in New York" }, marketsClosed: { "markets-1": "weekend" } });
  assert.match(prompt, /exchanges are closed now for the weekend/);
  assert.match(prompt, /Markets are closed for the weekend\./);
  assert.match(prompt, /Rows marked closed are from their last session/);
  assert.match(prompt, /Do not say "as of" a time today/);
  assert.doesNotMatch(prompt, /3:00 PM in New York/);   // the pack build time is not the "as of" for closed rows
});

test("Bitcoin is unchanged: never marked closed, same text as before", () => {
  const p = labelMarkets(pack(rows(FRI_16_ET)), SUN_15_ET);
  const btc = p.markets.find((m) => m.sym === "BTC");
  assert.equal(btc.closed, undefined);
  assert.deepEqual(btc, rows(FRI_16_ET).at(-1));
  assert.match(packText(p), /\n {4}Bitcoin \(Crypto\): 98450\.12 \+1\.84%\n/);
});

test("Tuesday 11:00 ET with live rows: no label, and the text and prompt are byte-identical to an unlabelled pack", () => {
  const live = rows(TUE_11_ET - 60_000);
  const before = pack(live.map((r) => ({ ...r })));
  const after = labelMarkets(pack(live.map((r) => ({ ...r }))), TUE_11_ET + 60_000);
  assert.equal(after.markets.filter((m) => m.closed).length, 0);
  assert.equal(marketsShutAt(TUE_11_ET + 60_000), null);
  assert.equal(packText(after), packText(before));
  const when = { hourLabel: "x", cityTimes: "y", marketsAsOf: { "markets-1": "11:00 AM in New York" } };
  assert.equal(buildPrompt(after, slots, { ...when, marketsClosed: { "markets-1": null } }), buildPrompt(before, slots, when));
  assert.match(packText(after), /MARKETS \(price, % change on the day\)\n/);
});

test("Tuesday 18:00 ET (after the close): today's close is today's, not stale", () => {
  const at = utc("2026-10-27T22:00:00Z");
  assert.equal(closedFor({ sym: "^DJI", group: "US", time: utc("2026-10-27T20:00:00Z") }, at), null);
  assert.equal(marketsShutAt(at), "overnight");
});

test("before the open, a holiday, or no trade time: the row is closed", () => {
  const tue8 = utc("2026-10-27T12:00:00Z");
  assert.equal(closedFor({ sym: "^DJI", group: "US", time: utc("2026-10-26T20:00:00Z") }, tue8).label, "closed: at Monday's close, 26 Oct");
  for (const time of [null, 0, undefined, NaN]) assert.match(closedFor({ sym: "^DJI", group: "US", time }, tue8).label, /unknown/);
  assert.match(closedFor({ sym: "^DJI", group: "US", time: tue8 + 3_600_000 }, tue8).label, /unknown/);   // a trade in the future is not usable
  // London's day, not New York's: 23:30 London Friday is still Friday there
  assert.equal(closedFor({ sym: "^FTSE", group: "Europe", time: utc("2026-10-23T15:30:00Z") }, utc("2026-10-23T22:30:00Z")), null);
});

test("CNBC and Yahoo: a quote with no usable time is null, never now", () => {
  const q = parseCnbc({ FormattedQuoteResult: { FormattedQuote: [
    { symbol: ".DJI", last: "47,100.2", change_pct: "+0.42%", last_time: "2026-10-23T16:00:00.000-0400" },
    { symbol: ".SPX", last: "6,800.5", change_pct: "+0.31%" }] } });
  assert.equal(q["^DJI"].time, FRI_16_ET);
  assert.equal(q["^GSPC"].time, null);
});

test("line check: a stale row read as today's fails; the close wording passes", () => {
  const m = labelMarkets(pack(rows(FRI_16_ET)), SUN_15_ET).markets;
  assert.match(staleMarketLine("The Dow is up 0.4 percent today.", m), /presents it as today's move|does not say it is a close/);
  assert.match(staleMarketLine("Markets are closed for the weekend. The Dow is up 0.4 percent.", m), /today's move/);
  assert.match(staleMarketLine("The Dow 47,100, up 0.4 percent.", m), /does not say it is a close/);
  assert.match(staleMarketLine("As of 3:30 in New York, the Dow closed up 0.4 percent.", m), /as of/);
  assert.match(staleMarketLine("Oil is trading at 66 dollars this afternoon after Friday's close.", m), /today's move/);
  assert.equal(staleMarketLine("On Friday the Dow closed up 0.4 percent.", m), null);
  assert.equal(staleMarketLine("Markets are closed for the weekend. On Friday, the Dow closed up 0.4 percent, and the S&P 500 ended up 0.3 percent.", m), null);
  assert.equal(staleMarketLine("Bitcoin is up 1.8 percent at 98,450 dollars.", m), null);
  // live rows: the old wording is fine
  const live = labelMarkets(pack(rows(TUE_11_ET - 60_000)), TUE_11_ET).markets;
  assert.equal(staleMarketLine("The Dow is up 0.4 percent today.", live), null);
});

test("checkSegments drops a stale row read as today's and keeps the close (its date is not a figure)", () => {
  const p = labelMarkets(pack(rows(FRI_16_ET)), SUN_15_ET);
  const r = checkSegments({ "markets-1": { lines: [
    { id: "m1", text: "The Dow is up 0.4 percent today." },
    { id: "m2", text: "On Friday, 23 October, the Dow closed up 0.4 percent at 47,100." },
  ] } }, slots, p);
  assert.deepEqual(r.segments["markets-1"].lines.map((l) => l.id), ["m2"]);
  assert.match(r.report[0].drop, /^markets:/);
  assert.equal(stripCloseDates("On Friday, 23 October, up 24 percent", p.markets).includes("23"), false);
  assert.equal(stripCloseDates("up 24 percent", p.markets), "up 24 percent");
});

function producedDir({ text, withPack = true, checked = true }) {
  const H = utc("2026-10-25T19:00:00Z");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "air245-"));
  fs.writeFileSync(path.join(d, "part.wav"), Buffer.alloc(2_000_000));
  fs.writeFileSync(path.join(d, "programme.json"), JSON.stringify({ hourStart: H, cues: Array(30).fill({}), audio: [{ file: "part.wav", from: H }], headlines: [] }));
  const hour = { lines: Array.from({ length: 5 }, (_, i) => ({ id: `s${i + 1}`, story: "t1" })) };
  const segs = { "the-hour": hour, "markets-1": { lines: [{ id: "m1", text }] } };
  fs.writeFileSync(path.join(d, "segments.raw.json"), JSON.stringify(segs));
  fs.writeFileSync(path.join(d, "segments.json"), JSON.stringify(segs));
  if (withPack) {
    const p = pack(rows(FRI_16_ET));
    fs.writeFileSync(path.join(d, "pack.json"), JSON.stringify(checked ? labelMarkets(p, SUN_15_ET) : p));
  }
  return { d, H };
}

test("airCheck fails the hour on a stale row read as today's, passes the close wording", () => {
  let { d, H } = producedDir({ text: "The Dow is up 0.4 percent today." });
  assert.match(airCheck(d, { hourStart: H }).problems.join(), /markets-1\/m1: markets: Dow/);
  ({ d, H } = producedDir({ text: "On Friday the Dow closed up 0.4 percent." }));
  assert.deepEqual(airCheck(d, { hourStart: H }).problems, []);
});

test("airCheck: Markets lines without a checked pack are unmeasured, so a failure", () => {
  let { d, H } = producedDir({ text: "On Friday the Dow closed up 0.4 percent.", withPack: false });
  assert.match(airCheck(d, { hourStart: H }).problems.join(), /pack\.json/);
  ({ d, H } = producedDir({ text: "On Friday the Dow closed up 0.4 percent.", checked: false }));
  assert.match(airCheck(d, { hourStart: H }).problems.join(), /never checked for closed markets/);
  assert.deepEqual(marketsProblems({ "the-hour": { lines: [{ id: "s1" }] } }, () => { throw new Error("not read"); }), []);
});
