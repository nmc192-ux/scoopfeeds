import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { airCheck } from "./airCheck.js";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nextHour, newestVideo, isPaused, autoairLive } from "./autoair.mjs";
import { parseCnbc } from "./factPack.js";

const H = Date.UTC(2026, 9, 14, 16);
function produced({ hourStart = H, kept = 10, written = 12, hourStories = 5, partBytes = 2_000_000 } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "air-"));
  fs.writeFileSync(path.join(d, "part-the-hour.wav"), Buffer.alloc(partBytes));
  fs.writeFileSync(path.join(d, "programme.json"), JSON.stringify({ hourStart, cues: Array(30).fill({}), audio: [{ file: "part-the-hour.wav", from: H }], headlines: [] }));
  const lines = (n, story) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, story }));
  fs.writeFileSync(path.join(d, "segments.raw.json"), JSON.stringify({ "the-hour": { lines: lines(written, "t1") } }));
  fs.writeFileSync(path.join(d, "segments.json"), JSON.stringify({ "the-hour": { lines: [].concat(lines(Math.min(kept, hourStories), "t1"), lines(Math.max(0, kept - hourStories), null)) } }));
  return d;
}

test("air check: a good hour passes", () => {
  const r = airCheck(produced(), { hourStart: H });
  assert.equal(r.ok, true, r.problems.join("; "));
});
test("air check: wrong hour, short audio, heavy fact-check losses and a thin Hour all fail", () => {
  assert.match(airCheck(produced({ hourStart: H - 3600_000 }), { hourStart: H }).problems.join(), /not 2026/);
  assert.match(airCheck(produced({ partBytes: 10 }), { hourStart: H }).problems.join(), /only 10 bytes/);
  assert.match(airCheck(produced({ kept: 5, written: 12 }), { hourStart: H }).problems.join(), /passed the fact checks/);
  assert.match(airCheck(produced({ hourStories: 2 }), { hourStart: H }).problems.join(), /only 2 checked stories/);
});
test("air check: 7 of 12 lines kept (58 %) is under the 60 % bar; there is no spoken disclosure line any more (DrJ, 23 Oct 2026)", () => {
  assert.equal(airCheck(produced(), { hourStart: H }).problems.some((p) => /disclosure|station-ID/i.test(p)), false);
  assert.match(airCheck(produced({ kept: 7, written: 12 }), { hourStart: H }).problems.join(), /passed the fact checks/);
  assert.equal(airCheck(produced({ kept: 7, written: 12 }), { hourStart: H }).stats.linesKept, 7);
});
test("air check: an empty directory is a failure, not a pass", () => {
  const r = airCheck(fs.mkdtempSync(path.join(os.tmpdir(), "air-")), { hourStart: H });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /programme.json missing/.test(p)));
});

test("next hour: a run at 8:14 pm is for 9 pm; at 8:40 pm, for 10 pm", () => {
  assert.equal(nextHour(Date.UTC(2026, 9, 14, 15, 14)), H);
  assert.equal(nextHour(Date.UTC(2026, 9, 14, 15, 40)), H + 3600_000);
  assert.equal(nextHour(Date.UTC(2026, 9, 14, 15, 35)), H);
});
test("newest video in a folder", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vid-"));
  fs.writeFileSync(path.join(d, "a.mp4"), "a"); fs.writeFileSync(path.join(d, "notes.txt"), "x");
  fs.writeFileSync(path.join(d, "b.mp4"), "b"); fs.utimesSync(path.join(d, "a.mp4"), new Date(1e12), new Date(1e12));
  assert.equal(path.basename(newestVideo(d)), "b.mp4");
  assert.equal(newestVideo(path.join(d, "none")), null);
});

test("CNBC quotes: prices, percent, UNCH as zero, unknown symbols ignored", () => {
  const q = parseCnbc({ FormattedQuoteResult: { FormattedQuote: [
    { symbol: ".SPX", last: "7,805.45", change_pct: "-0.02%", last_time: "2026-10-13" },
    { symbol: ".GDAXI", last: "25,259.90", change_pct: "UNCH" },
    { symbol: "@LCO.1", last: "106.28", change_pct: "+0.56%" },
    { symbol: ".NOPE", last: "1" }] } });
  assert.deepEqual([q["^GSPC"].price, q["^GSPC"].pct], [7805.45, -0.02]);
  assert.equal(q["^GDAXI"].pct, 0);
  assert.equal(q["BZ=F"].pct, 0.56);
  assert.equal(Object.keys(q).length, 3);
});

// #193: DrJ's standing approval covers airing only when RADIO_AUTOAIR_ENABLED is literally "1",
// and ~/scoopfeeds-radio/PAUSE stops it. Both gates are asserted here.
const AUTOAIR = fileURLToPath(new URL("./autoair.mjs", import.meta.url));

test("gate: only a literal RADIO_AUTOAIR_ENABLED=1 airs; anything else is a rehearsal", () => {
  assert.equal(autoairLive({ RADIO_AUTOAIR_ENABLED: "1" }), true);
  for (const v of [undefined, "", "0", "true", "TRUE", "yes", " 1", "1 ", "01", "on"]) {
    assert.equal(autoairLive({ RADIO_AUTOAIR_ENABLED: v }), false, `value ${JSON.stringify(v)} must not air`);
  }
  assert.equal(autoairLive({}), false);
});

test("gate: the PAUSE file is detected under the radio base dir", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "radio-base-"));
  assert.equal(isPaused(base), false);
  fs.writeFileSync(path.join(base, "PAUSE"), "");
  assert.equal(isPaused(base), true);
});

test("gate: with PAUSE present, a run stops before producing even when RADIO_AUTOAIR_ENABLED=1", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "radio-base-"));
  fs.writeFileSync(path.join(base, "PAUSE"), "");
  const out = path.join(base, "air", "t");
  const r = spawnSync(process.execPath, [AUTOAIR, "--hour", new Date(H).toISOString(), "--out", out], {
    env: { ...process.env, RADIO_BASE_DIR: base, RADIO_AUTOAIR_ENABLED: "1", RADIO_YT_CLIENT_ID: "", YOUTUBE_CLIENT_ID: "" },
    encoding: "utf8", timeout: 20_000,
  });
  assert.equal(r.status, 0, r.stderr);
  const status = JSON.parse(fs.readFileSync(path.join(out, "status.json"), "utf8"));
  assert.equal(status.stage, "paused");
  assert.doesNotMatch(r.stdout, /producing|youtube|LIVE run/);
  assert.equal(fs.existsSync(path.join(base, "autoair.lock")), false, "a paused run must not take the lock");
});

test("gate: the rehearsal return comes before any YouTube or playout step in the run", () => {
  const src = fs.readFileSync(AUTOAIR, "utf8");
  const body = src.slice(src.indexOf("async function main()"));
  const rehearsal = body.indexOf("if (!live) {");
  assert.ok(rehearsal > 0, "rehearsal gate not found");
  // #208: a read-only YouTube client (ytApi) is built before the gate for the film clearance status check
  // (videos.list); every write (createBroadcast, bind, transition) and the playout still come after it.
  for (const later of ['stage("youtube-setup")', "createBroadcast(", "yt = ytApi", 'stage("waiting")', "launchctl"]) {
    const at = body.indexOf(later);
    assert.ok(at > rehearsal, `${later} must come after the rehearsal gate`);
  }
  assert.ok(body.indexOf("isPaused(BASE)") < body.indexOf('stage("producing")'), "PAUSE must be checked before producing");
});

test("#216+#208: sourceFileFor maps a library Short (symlink) back to its file in the film folder", async () => {
  const { sourceFileFor } = await import("./autoair.mjs");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "srcfor-"));
  const pub = path.join(d, "pub"); const lib = path.join(d, "lib");
  fs.mkdirSync(pub); fs.mkdirSync(lib);
  fs.writeFileSync(path.join(pub, "s1.mp4"), "x"); fs.writeFileSync(path.join(pub, "other.mp4"), "y");
  fs.symlinkSync(path.join(pub, "s1.mp4"), path.join(lib, "s1.mp4"));
  assert.equal(sourceFileFor(pub, path.join(lib, "s1.mp4")), path.join(pub, "s1.mp4"));
  assert.equal(sourceFileFor(path.join(pub, "s1.mp4"), path.join(lib, "s1.mp4")), path.join(pub, "s1.mp4"));
  assert.equal(sourceFileFor(path.join(pub, "other.mp4"), path.join(lib, "s1.mp4")), null);
  assert.equal(sourceFileFor(path.join(d, "missing"), path.join(lib, "s1.mp4")), null);
});
