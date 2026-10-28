// #283: crypto in every hour, the overnight repeats included, and the hour says why when it has none.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { planHour } from "./grid.js";
import { buildGridClock, checkClock } from "./clock.js";
import { prepareRepeat, spliceProgramme, spliceSlots, cutRepeatCrypto } from "./repeat.js";
import { airCheck, cryptoReport } from "./airCheck.js";
import { cryptoForRun, cryptoUnavailable, railMarkets, fetchCrypto, buildFactPack, RAIL_MARKET_ROWS } from "./factPack.js";
import { writeHourAudio, writeWav, renderProgramme, linesFor } from "../../testing/radioWav.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOUR = 3_600_000;
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const slim = (slots) => slots.map(({ id, kind, start, end, title, elements }) => ({ id, kind, start, end, title: title || null, ...(elements ? { elements } : {}) }));
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

// the fixture day: Thu 29 Oct 2026, New York (EDT); the produced hour the night repeats is 23:00 ET on the 28th
const ET_MIDNIGHT = Date.parse("2026-10-29T04:00:00Z");
const SOURCE_H = ET_MIDNIGHT - HOUR;
const COINS = [
  { key: "Bitcoin", sym: "BTC", group: "Crypto", price: 81454, pct: 0.98, time: null },
  { key: "Ethereum", sym: "ETH", group: "Crypto", price: 2374.11, pct: 1.27, time: null },
  { key: "Solana", sym: "SOL", group: "Crypto", price: 103.19, pct: 2.11, time: null },
  { key: "XRP", sym: "XRP", group: "Crypto", price: 1.34, pct: 0.97, time: null },
  { key: "Dogecoin", sym: "DOGE", group: "Crypto", price: 0.08, pct: -2.66, time: null },
];
const MARKETS = [
  { key: "S&P 500", sym: "^GSPC", group: "US", price: 6800.5, pct: 0.31 }, { key: "Dow", sym: "^DJI", group: "US", price: 47100.2, pct: 0.42 },
  { key: "Nasdaq", sym: "^IXIC", group: "US", price: 23000.1, pct: -0.25 }, { key: "FTSE 100", sym: "^FTSE", group: "Europe", price: 9700, pct: 0.1 },
  { key: "Gold", sym: "GC=F", group: "Commodities", price: 4100, pct: -0.6 }, { key: "Bitcoin", sym: "BTC", group: "Crypto", price: 81450, pct: 0.9 },
];

test("fixture day: every hour's grid clock carries a 90 s Crypto segment, 00-06 ET repeats included (summer and winter)", () => {
  for (const midnight of [ET_MIDNIGHT, Date.parse("2026-11-10T05:00:00Z")]) {
    for (let h = 0; h < 24; h++) {
      const H = midnight + h * HOUR;
      assert.equal(planHour(H).crypto, true, `${h}:00 ET plan`);
      const { slots } = buildGridClock(H);
      assert.deepEqual(checkClock(slots), [], `${h}:00 ET clock`);
      const i = slots.findIndex((s) => s.id === "crypto");
      assert.ok(i > 0, `${h}:00 ET has a Crypto slot`);
      assert.deepEqual([slots[i].kind, slots[i].segment, slots[i].lenSec, slots[i].startSec, slots[i + 1].id], ["spoken", "crypto", 90, 840, "music-1"], `${h}:00 ET`);
    }
  }
});

// ── the overnight repeats, end to end (prepareRepeat, then the two splice runs as produce.mjs does them) ──

/** A produced grid hour on disk, with a spoken Crypto slot and mixed audio the listen-back passes. */
function seedSource(H) {
  const dir = tmp("crypto-src-");
  const slots = slim(buildGridClock(H).slots);
  const { audio, lines, endsAt } = writeHourAudio(dir, H, { slots });
  const crypto = slots.find((s) => s.id === "crypto");
  const cues = slots.map((s) => (s.kind === "music" ? { at: s.start, scene: "music", data: { credit: "Music: Test Artist – Bed" } } : { at: s.start, scene: "title", data: { title: s.title } }));
  cues.push({ at: crypto.start + 2600, scene: "markets", data: { title: "Crypto", rows: COINS, asOf: H - 600e3 } });
  fs.writeFileSync(path.join(dir, "programme.json"), JSON.stringify({ version: 1, hourStart: H, endsAt, audio, lines, slots, cues: cues.sort((a, b) => a.at - b.at), crypto: { status: "on air", rows: 5 } }));
  fs.writeFileSync(path.join(dir, "segments.json"), JSON.stringify({ "the-hour": { lines: [{ id: "open", text: "It's eleven." }] }, crypto: { lines: [{ id: "c1", text: "Bitcoin at 81454 dollars." }] } }));
  fs.writeFileSync(path.join(dir, "pack.json"), JSON.stringify({ builtAt: H - 600e3, top: [], desks: {}, markets: [], weather: [], crypto: COINS, marketsCheckedAt: H }));
  return dir;
}

/** One splice run as produce.mjs leaves it: its part, its line timings and slots in programme.json, merged segments. */
function spliceRun(dir, H, { from, to, pack, writeLines = true }) {
  const clock = buildGridClock(H).slots;
  const a = clock.findIndex((s) => s.id === from);
  const b = to === "next" ? a + 1 : clock.findIndex((s) => s.id === to);
  const slots = clock.slice(a, b);
  const note = cryptoForRun(slots, pack, { useGrid: true, fullRun: false });
  const spoken = slots.filter((s) => s.kind === "spoken");
  const lines = spoken.flatMap((s) => linesFor(s));
  const cut = slots[0].start, resumeAt = clock[b].start;
  const part = `part-${from}-new.wav`;
  const rate = Math.ceil(1_100_000 / (4 * (resumeAt - cut) / 1000));   // over airCheck's 1 MB part floor
  writeWav(path.join(dir, part), renderProgramme({ slots, lines, from: cut, to: resumeAt, rate }), { rate });
  const segs = Object.fromEntries(spoken.map((s) => [s.id, { lines: linesFor(s).map((l, i) => ({ id: s.segment === "the-hour" ? `s${i + 1}` : `c${i + 1}`, story: s.segment === "the-hour" ? "t1" : null, text: "x" })) }]));
  for (const f of ["segments.raw.json", "segments.json"]) {
    let old = {}; try { old = read(path.join(dir, f)); } catch { /* first splice */ }
    if (writeLines) fs.writeFileSync(path.join(dir, f), JSON.stringify({ ...old, ...segs }));
  }
  const cues = slots.flatMap((s) => (s.segment === "crypto" ? [{ at: s.start + 2600, scene: "markets", data: { title: "Crypto", rows: pack.crypto, asOf: H - 300e3 } }]
    : s.kind === "music" ? [{ at: s.start, scene: "music", data: {} }] : [{ at: s.start, scene: "title", data: { title: s.title } }]));
  const pf = path.join(dir, "programme.json");
  let prog = spliceProgramme(read(pf), { cut, resumeAt, partFile: part, cues, lines, slots: slim(slots) });
  if (note) prog = { ...prog, crypto: { ...note, at: H - 300e3 } };
  fs.writeFileSync(pf, JSON.stringify(prog));
  return prog;
}

const freshPack = (H, crypto = COINS) => ({ builtAt: H - 300e3, top: [], desks: {}, markets: [], weather: [], crypto, marketsCheckedAt: H });

test("fixture day end to end: each repeat hour (00-05 ET) cuts the repeated Crypto, splices a fresh one at its own air time, and passes airCheck", () => {
  const src = seedSource(SOURCE_H);
  let crypto = 0;
  for (let h = 0; h < 24; h++) {
    const H = ET_MIDNIGHT + h * HOUR;
    if (planHour(H).format === "produced") { crypto += buildGridClock(H).slots.some((s) => s.segment === "crypto") ? 1 : 0; continue; }
    const dir = path.join(tmp("crypto-rep-"), String(h));
    const p0 = prepareRepeat(src, dir, H, { now: H - 40 * 60e3 });
    const cut = p0.slots.find((s) => s.id === "crypto");
    assert.deepEqual([cut.kind, p0.crypto.status], ["music", "cut"], `${h}:00 ET: the repeated Crypto is cut`);
    assert.match(cut.cut, /#283 the repeated hour's Crypto prices are stale/);
    assert.ok(!p0.lines.some((l) => l.slot === "crypto"), "its old line timings go with it");
    for (const f of ["segments.json", "segments.raw.json", "checks.json"]) assert.ok(!fs.existsSync(path.join(dir, f)), `${f} is the splice runs' own, not copied`);

    spliceRun(dir, H, { from: "the-hour", to: "markets-1", pack: freshPack(H) });
    const p = spliceRun(dir, H, { from: "crypto", to: "next", pack: freshPack(H) });
    const slot = p.slots.find((s) => s.id === "crypto");
    assert.deepEqual([slot.kind, slot.start, slot.end], ["spoken", H + 840e3, H + 930e3], `${h}:00 ET: a fresh Crypto at the repeat's own :14`);
    assert.ok(p.cues.some((c) => c.scene === "markets" && c.data?.title === "Crypto" && c.at > H + 840e3 && c.at < H + 930e3));
    assert.ok(p.audio.some((a) => a.file === "part-crypto-new.wav" && a.from === H + 840e3));
    assert.deepEqual(Object.keys(read(path.join(dir, "segments.json"))).sort(), ["crypto", "the-hour"], "both splices' segments are kept");
    const check = airCheck(dir, { hourStart: H });
    assert.deepEqual(check.problems, [], `${h}:00 ET air check`);
    assert.equal(check.stats.crypto, "on air");
    assert.deepEqual(check.notes, []);
    crypto++;
  }
  assert.equal(crypto, 24, "a Crypto segment in all 24 hours");
});

test("feed stubbed to fail: the repeat still airs, with no crypto scene, and says 'crypto: feed unavailable' in its air check", () => {
  const src = seedSource(SOURCE_H);
  const H = ET_MIDNIGHT + 3 * HOUR;
  const dir = path.join(tmp("crypto-down-"), "3");
  prepareRepeat(src, dir, H, { now: H - 40 * 60e3 });
  spliceRun(dir, H, { from: "the-hour", to: "markets-1", pack: freshPack(H) });
  const p = spliceRun(dir, H, { from: "crypto", to: "next", pack: { ...freshPack(H, []), cryptoError: "http://127.0.0.1/api/market -> HTTP 503" } });
  assert.equal(p.slots.find((s) => s.id === "crypto").kind, "music");
  assert.ok(!p.cues.some((c) => c.scene === "markets" && c.data?.title === "Crypto"), "no crypto scene, no placeholder");
  const check = airCheck(dir, { hourStart: H });
  assert.deepEqual(check.problems, [], "the hour still airs");
  assert.equal(check.stats.crypto, "feed unavailable");
  assert.deepEqual(check.notes, ["crypto: feed unavailable (/api/market: http://127.0.0.1/api/market -> HTTP 503)"]);
});

test("the fresh Crypto run fails outright: the cut stays, the hour airs with music there, and the note says why", () => {
  const src = seedSource(SOURCE_H);
  const H = ET_MIDNIGHT + HOUR;
  const dir = path.join(tmp("crypto-fail-"), "1");
  prepareRepeat(src, dir, H, { now: H - 40 * 60e3 });
  spliceRun(dir, H, { from: "the-hour", to: "markets-1", pack: freshPack(H) });
  const check = airCheck(dir, { hourStart: H });
  assert.deepEqual(check.problems, []);
  assert.equal(check.stats.crypto, "cut");
  assert.match(check.notes[0], /^crypto: the repeated hour's Crypto prices are stale at the repeat's air time; cut to music/);
});

test("a stale Crypto that cannot be cut (no music in the hour) refuses the repeat unless a fresh one replaces it", () => {
  const H = ET_MIDNIGHT + 2 * HOUR;
  const slots = slim(buildGridClock(H).slots).map((s) => (s.kind === "music" ? { ...s, kind: "series" } : s));
  const p = cutRepeatCrypto({ hourStart: H, audio: [{ file: "a.wav", from: H - 900e3 }], cues: [], slots }, { now: 1 });
  assert.equal(p.crypto.status, "stale");
  assert.match(cryptoReport(p).problem, /^repeat: crypto: the repeated hour's Crypto prices are stale .*could not be cut to music \(the hour has no music slot to cut to\)/);
  assert.equal(cryptoReport({ ...p, crypto: { status: "on air", rows: 5 } }).problem, undefined);
});

test("cryptoReport: every state is reported; a grid hour without a record is unmeasured, never a pass", () => {
  assert.deepEqual(cryptoReport({ crypto: { status: "on air", rows: 6 } }), { status: "on air", note: null });
  assert.deepEqual(cryptoReport({ crypto: { status: "grid off", why: "crypto: the grid is off (RADIO_GRID_ENABLED is not 1), so the hour has no Crypto segment" } }),
    { status: "grid off", note: "crypto: the grid is off (RADIO_GRID_ENABLED is not 1), so the hour has no Crypto segment" });
  assert.deepEqual(cryptoReport({ grid: { crypto: true } }), { status: "unmeasured", note: "crypto: unmeasured (programme.json has no crypto record)" });
  assert.deepEqual(cryptoReport({}), { status: "unmeasured", note: null });
});

test("cryptoForRun: rows -> on air; too few -> music with the reason; full runs without a slot say why; partial runs say nothing", () => {
  const slot = () => [{ id: "crypto", kind: "spoken", segment: "crypto", title: "Crypto" }];
  assert.deepEqual(cryptoForRun(slot(), { crypto: COINS }, { useGrid: true, fullRun: true }), { status: "on air", rows: 5 });
  const down = slot();
  assert.deepEqual(cryptoForRun(down, { crypto: [], cryptoError: "The operation was aborted due to timeout" }, { useGrid: true, fullRun: true }),
    { status: "feed unavailable", why: "crypto: feed unavailable (/api/market: The operation was aborted due to timeout)" });
  assert.deepEqual([down[0].kind, down[0].segment, down[0].title], ["music", null, null]);
  assert.equal(cryptoUnavailable({ crypto: [COINS[0]] }), "feed unavailable (only 1 crypto row from /api/market)");
  assert.equal(cryptoForRun([], {}, { useGrid: false, fullRun: true }).status, "grid off");
  assert.equal(cryptoForRun([], {}, { useGrid: true, special: true, fullRun: true }).status, "not in the special");
  assert.equal(cryptoForRun([], {}, { useGrid: true, fullRun: true }).status, "no slot");
  assert.equal(cryptoForRun([], {}, { useGrid: true, fullRun: false }), null);
});

test("fetchCrypto retries once; buildFactPack keeps the reason when both tries fail", async () => {
  let n = 0;
  const flaky = async () => (++n === 1 ? { ok: false, status: 504 } : { ok: true, json: async () => ({ data: { crypto: [{ symbol: "BTC", name: "Bitcoin", price: 81454, changePct: 0.98 }, { symbol: "ETH", name: "Ethereum", price: 2374.11, changePct: 1.27 }] } }) });
  assert.deepEqual((await fetchCrypto("http://x", { fetchImpl: flaky, retryMs: 0 })).map((c) => c.sym), ["BTC", "ETH"]);
  assert.equal(n, 2);

  const down = async (url) => {
    const u = String(url);
    if (u.includes("/api/radio/state.json")) return { ok: true, json: async () => ({ headline: null, alsoThisHour: [], music: [] }) };
    if (u.includes("/api/market")) return { ok: false, status: 503 };
    if (u.includes("/api/news")) return { ok: true, json: async () => ({ data: [] }) };
    return { ok: false, status: 404 };
  };
  const pack = await buildFactPack({ base: "http://stub", fetchImpl: down, crypto: true, cryptoRetryMs: 0 });
  assert.deepEqual(pack.crypto, []);
  assert.equal(pack.cryptoError, "http://stub/api/market -> HTTP 503");
  assert.equal(cryptoUnavailable(pack), "feed unavailable (/api/market: http://stub/api/market -> HTTP 503)");
});

test("railMarkets: market rows (in-session first), then Bitcoin, Ether and the top mover; five rows; feed down = markets only", () => {
  const rows = railMarkets({ markets: MARKETS, crypto: COINS }, { lead: ["Europe"] });
  assert.equal(RAIL_MARKET_ROWS, 5);
  assert.deepEqual(rows.map((r) => r.key), ["FTSE 100", "S&P 500", "Bitcoin", "Ethereum", "Dogecoin"]);
  assert.equal(rows[2].price, 81454, "the CoinGecko row, verbatim, not the markets fetch's Bitcoin");
  assert.deepEqual(railMarkets({ markets: MARKETS, crypto: [] }).map((r) => r.key), ["S&P 500", "Dow", "Nasdaq", "FTSE 100", "Bitcoin"], "feed down: the markets fetch's own Bitcoin row, if it has one");
  assert.deepEqual(railMarkets({ markets: MARKETS.slice(0, 5), crypto: [] }).map((r) => r.key), ["S&P 500", "Dow", "Nasdaq", "FTSE 100", "Gold"]);
  assert.deepEqual(railMarkets({ markets: [], crypto: [] }), [], "no rows, no block (earn-render)");
});

test("spliceSlots: the stretch takes the new run's slots; a slot straddling an edge keeps its outside part", () => {
  const old = [{ id: "a", start: 0, end: 10 }, { id: "music-1", start: 10, end: 40 }, { id: "b", start: 40, end: 50 }];
  assert.deepEqual(spliceSlots(old, [{ id: "crypto", kind: "spoken", start: 10, end: 19 }], 10, 19),
    [{ id: "a", start: 0, end: 10 }, { id: "crypto", kind: "spoken", start: 10, end: 19 }, { id: "music-1", start: 19, end: 40 }, { id: "b", start: 40, end: 50 }]);
});

test("produce.mjs: --from crypto --to next with the grid off splices nothing, exits 0, and says why", () => {
  const out = tmp("crypto-off-");
  const env = { ...process.env }; delete env.RADIO_GRID_ENABLED;
  const r = spawnSync(process.execPath, [path.join(HERE, "produce.mjs"), "--hour", new Date(ET_MIDNIGHT + 2 * HOUR).toISOString(), "--out", out, "--from", "crypto", "--to", "next", "--fake-voice", "--fake-writer"], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /crypto: this hour's clock has no Crypto slot \(the grid is off: RADIO_GRID_ENABLED is not 1\); nothing to splice/);
  assert.deepEqual(fs.readdirSync(out), [], "nothing written");
});
