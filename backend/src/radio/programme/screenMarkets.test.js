// #282: the programme screen's market rows carry `closed` for the time they are SHOWN, in a fresh hour and in a
// repeated one, so the board never shows the last session's close as live.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { labelScreenMarkets, labelRows } from "./marketsClock.js";
import { prepareRepeat } from "./repeat.js";

const utc = (s) => Date.parse(s);
const MIN = 60_000;

// Friday 30 Oct 2026: US close 16:00 EDT (20:00Z), London/Frankfurt 16:30Z, futures settle 21:00Z
const FRI = { us: utc("2026-10-30T20:00:00Z"), eu: utc("2026-10-30T16:30:00Z"), fut: utc("2026-10-30T21:00:00Z") };
export const fridayRows = (btcTime) => [
  { key: "S&P 500", sym: "^GSPC", group: "US", price: 6800.5, pct: 0.31, time: FRI.us },
  { key: "Dow", sym: "^DJI", group: "US", price: 47100.2, pct: 0.42, time: FRI.us },
  { key: "Nasdaq", sym: "^IXIC", group: "US", price: 23000.1, pct: -0.25, time: FRI.us },
  { key: "FTSE 100", sym: "^FTSE", group: "Europe", price: 9700.3, pct: -0.21, time: FRI.eu },
  { key: "DAX", sym: "^GDAXI", group: "Europe", price: 24100.9, pct: 0.12, time: FRI.eu },
  { key: "Brent", sym: "BZ=F", group: "Commodities", price: 64.8, pct: -1.1, time: FRI.fut },
  { key: "Gold", sym: "GC=F", group: "Commodities", price: 4100, pct: -0.6, time: FRI.fut },
  { key: "Bitcoin", sym: "BTC", group: "Crypto", price: 98450.12, pct: 1.84, time: btcTime },
];

// Sunday 1 Nov 2026, 12:00 New York (EST from 2 am that day) = 17:00Z
const SUN_NOON = utc("2026-11-01T17:00:00Z");
// Tuesday 27 Oct 2026, 11:00 New York (EDT) = 15:00Z: NYSE and London in session, Tokyo shut (midnight there)
const TUE_11 = utc("2026-10-27T15:00:00Z");
const tuesdayRows = () => [
  { key: "S&P 500", sym: "^GSPC", group: "US", price: 6810, pct: 0.2, time: TUE_11 - 2 * MIN },
  { key: "Dow", sym: "^DJI", group: "US", price: 47150, pct: 0.1, time: TUE_11 - 2 * MIN },
  { key: "FTSE 100", sym: "^FTSE", group: "Europe", price: 9710, pct: 0.3, time: TUE_11 - 2 * MIN },
  { key: "Nikkei 225", sym: "^N225", group: "Asia", price: 50100, pct: 0.9, time: utc("2026-10-27T06:00:00Z") },   // Tokyo's 15:00 close
  { key: "Bitcoin", sym: "BTC", group: "Crypto", price: 98000, pct: -0.4, time: TUE_11 - MIN },
];

function hour(H, rows) {
  return {
    version: 1, hourStart: H, endsAt: H + 60 * MIN,
    cues: [
      { at: H + 6 * MIN, scene: "sting", overlay: true, data: {} },
      { at: H + 6 * MIN + 2600, scene: "markets", data: { title: "Markets Now", rows, asOf: H - 10 * MIN } },
      { at: H + 10 * MIN, scene: "music", data: {} },
      { at: H + 40 * MIN, scene: "markets", data: { title: "Crypto", rows: rows.filter((r) => r.group === "Crypto"), asOf: H - 10 * MIN, note: "Prices from CoinGecko. 24-hour change." } },
      { at: H + 44 * MIN, scene: "music", data: {} },
    ],
    slots: [],
    rail: { markets: rows, weather: [] },
  };
}
const marketsCue = (p) => p.cues.find((c) => c.scene === "markets" && c.data.title === "Markets Now");

test("Sunday noon: every index, commodity and the rail row is Friday's close; crypto is untouched", () => {
  const p = labelScreenMarkets(hour(SUN_NOON, fridayRows(SUN_NOON - MIN)));
  for (const rows of [marketsCue(p).data.rows, p.rail.markets]) {
    for (const r of rows.filter((x) => x.group !== "Crypto")) {
      assert.ok(r.closed, `${r.key} must be closed`);
      assert.equal(r.closed.weekday, "Friday", r.key);
      assert.equal(r.closed.day, 30, r.key);
      assert.equal(r.closed.month, "Oct", r.key);
    }
    assert.equal(rows.find((x) => x.key === "Bitcoin").closed, undefined, "crypto is never closed");
  }
  assert.equal(p.cues.find((c) => c.data?.title === "Crypto").data.rows[0].closed, undefined);
});

test("weekday 11:00 ET: NYSE and London rows are live, the Tokyo row is closed", () => {
  const p = labelScreenMarkets(hour(TUE_11 - 6 * MIN, tuesdayRows()));
  for (const rows of [marketsCue(p).data.rows, p.rail.markets]) {
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    assert.equal(by["S&P 500"].closed, undefined);
    assert.equal(by.Dow.closed, undefined);
    assert.equal(by["FTSE 100"].closed, undefined);
    assert.ok(by["Nikkei 225"].closed, "Tokyo is shut at midnight Tokyo time");
    assert.equal(by["Nikkei 225"].closed.weekday, "Tuesday");
  }
});

test("a row with no trade time is closed, never live", () => {
  for (const time of [undefined, null, 0, NaN, "soon"]) {
    const [r] = labelRows([{ key: "Dow", sym: "^DJI", group: "US", price: 1, pct: 0, time }], TUE_11);
    assert.ok(r.closed, `time=${String(time)}`);
    assert.equal(r.closed.weekday, null);
  }
});

test("a stale `closed` from an earlier label is replaced, and the label is made at the END of the showing", () => {
  // 23:30-00:30 ET: Friday's 16:00 close is "today" at 23:59 but not at 00:01 Saturday; the rail spans both
  const H = utc("2026-10-31T03:30:00Z");   // Fri 23:30 EDT
  const rows = fridayRows(H).map((r) => ({ ...r, closed: r.group === "Crypto" ? undefined : { label: "stale", weekday: "Monday" } }));
  const p = labelScreenMarkets(hour(H, rows));
  const dow = p.rail.markets.find((r) => r.key === "Dow");
  assert.equal(dow.closed.weekday, "Friday", "labelled at the hour's end (Saturday), not left as the old stamp");
  const cueDow = marketsCue(p).data.rows.find((r) => r.key === "Dow");
  assert.equal(cueDow.closed, undefined, "the Markets scene (23:36-23:40 Friday) shows Friday's figure as Friday's");
});

test("repeat: a Friday-afternoon hour repeated on Sunday is relabelled against the repeat's air time (#249 path)", () => {
  const FRI_15 = utc("2026-10-30T19:00:00Z");   // Fri 15:00 EDT: every row live
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "rep282-src-")), dst = fs.mkdtempSync(path.join(os.tmpdir(), "rep282-dst-"));
  try {
    const rows = fridayRows(FRI_15).map((r) => ({ ...r, time: Math.min(r.time, FRI_15 - 5 * MIN) }));
    const fresh = labelScreenMarkets(hour(FRI_15, rows));
    assert.ok(marketsCue(fresh).data.rows.every((r) => !r.closed), "live on Friday afternoon");
    fs.writeFileSync(path.join(src, "programme.json"), JSON.stringify(fresh));
    const moved = prepareRepeat(src, dst, SUN_NOON, { now: SUN_NOON - 30 * MIN });
    for (const rowsShown of [marketsCue(moved).data.rows, moved.rail.markets]) {
      for (const r of rowsShown.filter((x) => x.group !== "Crypto")) assert.equal(r.closed?.weekday, "Friday", `${r.key} in the repeat`);
    }
    const onDisk = JSON.parse(fs.readFileSync(path.join(dst, "programme.json"), "utf8"));
    assert.ok(marketsCue(onDisk).data.rows.find((r) => r.key === "Dow").closed, "programme.json on disk carries the label");
  } finally {
    fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(dst, { recursive: true, force: true });
  }
});
