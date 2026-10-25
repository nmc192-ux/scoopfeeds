/**
 * playout.test.js - bed/daypart selection, watchdog restarts, RTMP gating, ffmpeg arguments.
 * No browser or ffmpeg is started here; the 120 s render is a manual measurement (see the PR).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chooseBed, runPlayout, isFatalMuxError } from "./playout.js";
import { makeMusicLibrary } from "../musicTestLibrary.js";
import { resolveTarget, rtmpAllowed, rtmpBase, redact, RTMP_BASE } from "./outputTarget.js";
import { buildFfmpegArgs, buildFeederArgs, loudnessFilter, VIDEO, AUDIO, RTMP } from "./ffmpegArgs.js";
import { parseIntegrated } from "./loudness.js";
import { supervise, nextDelay, BACKOFF } from "./watchdog.js";

// beds with complete manifest entries (#208): unmanifested files never air
const makeLibrary = (dayparts) => makeMusicLibrary(Object.fromEntries(dayparts.map((d) => [d, [`${d}-a.mp3`]])), { prefix: "playout-music-" });

// ── daypart / bed selection ──────────────────────────────────────────────────
test("chooseBed picks the bed for the US-Eastern daypart", () => {
  const dir = makeLibrary(["morning", "markets", "evening", "overnight"]);
  const cases = [
    ["2026-10-09T10:00:00Z", "morning"],   // 06:00 EDT
    ["2026-10-09T15:00:00Z", "markets"],   // 11:00 EDT
    ["2026-10-09T22:00:00Z", "evening"],   // 18:00 EDT
    ["2026-10-09T06:00:00Z", "overnight"], // 02:00 EDT
    ["2026-12-09T11:00:00Z", "morning"],   // 06:00 EST (winter offset)
  ];
  for (const [iso, want] of cases) {
    const r = chooseBed(new Date(iso), { dir });
    assert.equal(r.daypart, want, iso);
    assert.equal(r.fallback, false);
    assert.ok(r.bed.includes(`${path.sep}${want}${path.sep}`), `${iso} -> ${r.bed}`);
  }
});

test("chooseBed falls back to another daypart's bed, flagged, when the daypart is empty", () => {
  const dir = makeLibrary(["evening"]);
  const r = chooseBed(new Date("2026-10-09T15:00:00Z"), { dir }); // markets: empty
  assert.equal(r.daypart, "markets");
  assert.equal(r.fallback, true);
  assert.ok(r.bed.includes("evening"));
});

test("chooseBed with no cleared bed: the procedural bed, never silence and never an unmanifested file (#208)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "playout-empty-"));
  fs.mkdirSync(path.join(dir, "evening")); fs.writeFileSync(path.join(dir, "evening", "elevenlabs-bed.mp3"), "x");   // no manifest entry
  const r = chooseBed(new Date(), { dir, procedural: (d) => path.join(d, "_procedural", "bed.wav") });
  assert.equal(r.procedural, true);
  assert.equal(r.refused, 1);
  assert.ok(r.bed.endsWith(path.join("_procedural", "bed.wav")));
  assert.throws(() => chooseBed(new Date(), { dir, procedural: null }), /no cleared music bed/);
});

// ── loudness + ffmpeg arguments ──────────────────────────────────────────────
test("loudnessFilter applies the gain that lands a bed on -16 LUFS, and falls back to loudnorm if unmeasured", () => {
  assert.match(loudnessFilter(-20), /^volume=4\.00dB,alimiter/);
  assert.match(loudnessFilter(-12.5), /^volume=-3\.50dB,alimiter/);
  assert.match(loudnessFilter(null), /^loudnorm=I=-16:/);
});

test("parseIntegrated reads the ebur128 summary, not a running line", () => {
  const out = "[Parsed_ebur128_0] t: 1 I: -40.0 LUFS\n[Parsed_ebur128_0] Summary:\n\n  Integrated loudness:\n    I:         -16.6 LUFS\n    Threshold: -26.6 LUFS";
  assert.equal(parseIntegrated(out), -16.6);
  assert.equal(parseIntegrated("nothing"), null);
});

test("ffmpeg args follow the YouTube 1080p30 recommendation: CBR ~4.5 Mbps, 2 s keyframes, AAC", () => {
  const a = buildFfmpegArgs({ target: { kind: "file", path: "/tmp/t.mp4" }, bed: "/m/b.mp3", bedLufs: -18, seconds: 120 });
  const at = (flag) => a[a.indexOf(flag) + 1];
  assert.equal(at("-b:v"), "4500k");
  assert.equal(at("-maxrate"), "4500k");
  assert.equal(at("-minrate"), "4500k");
  assert.equal(at("-g"), String(VIDEO.fps * 2));
  assert.equal(at("-sc_threshold"), "0");
  assert.equal(at("-c:a"), "aac");
  assert.equal(at("-t"), "120");
  assert.match(at("-x264-params"), /nal-hrd=cbr/);
  assert.equal(a.at(-1), "/tmp/t.mp4");
  assert.ok(!a.some((x) => /^rtmp/.test(x)), "a file target never mentions rtmp");
  assert.equal(at("-stream_loop"), "-1");
});

// ── RTMP gating ──────────────────────────────────────────────────────────────
test("the RTMP path cannot start without BOTH RADIO_PLAYOUT_ENABLED=true and RADIO_STREAM_KEY", () => {
  const none = {};
  const onlyFlag = { RADIO_PLAYOUT_ENABLED: "true" };
  const onlyKey = { RADIO_STREAM_KEY: "abcd-efgh" };
  const flagWrong = { RADIO_PLAYOUT_ENABLED: "1", RADIO_STREAM_KEY: "abcd-efgh" };
  const blankKey = { RADIO_PLAYOUT_ENABLED: "true", RADIO_STREAM_KEY: "   " };
  for (const env of [none, onlyFlag, onlyKey, flagWrong, blankKey]) {
    assert.equal(rtmpAllowed(env), false, JSON.stringify(env));
    assert.throws(() => resolveTarget({ env }), /no output target/);
  }
  const both = { RADIO_PLAYOUT_ENABLED: "true", RADIO_STREAM_KEY: "abcd-efgh" };
  assert.equal(rtmpAllowed(both), true);
  assert.deepEqual(resolveTarget({ env: both }), { kind: "rtmp", url: `${RTMP_BASE}/abcd-efgh` });
});

test("--out always wins: with a file target the stream key is not used even when both vars are set", () => {
  const env = { RADIO_PLAYOUT_ENABLED: "true", RADIO_STREAM_KEY: "abcd-efgh" };
  assert.equal(resolveTarget({ out: "/tmp/x.mp4", env }).kind, "file");
});

test("runPlayout refuses before spawning anything when no target is allowed", async () => {
  await assert.rejects(runPlayout({ env: { RADIO_PLAYOUT_ENABLED: "true" }, seconds: 1 }), /no output target/);
  await assert.rejects(runPlayout({ env: {}, out: path.join(os.tmpdir(), "x.mp4") }), /--seconds is required/);
});

test("the stream key never survives redact()", () => {
  const env = { RADIO_STREAM_KEY: "abcd-efgh" };
  const line = redact(`ffmpeg -f flv ${RTMP_BASE}/abcd-efgh failed; key abcd-efgh`, env);
  assert.ok(!line.includes("abcd-efgh"), line);
  assert.ok(!redact(`${RTMP_BASE}/other-key`, {}).includes("other-key"));
});

// ── watchdog ─────────────────────────────────────────────────────────────────
function fakeClock() {
  let t = 0;
  const sleeps = [];
  return { now: () => t, sleeps, sleep: async (ms) => { sleeps.push(ms); t += ms; }, advance: (ms) => { t += ms; } };
}

test("backoff doubles from 1 s and is capped at 60 s", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((n) => nextDelay(n)), [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
});

test("watchdog restarts a unit that dies, with growing backoff, and stops when it completes", async () => {
  const clock = fakeClock();
  let starts = 0;
  const start = async () => {
    starts++;
    const reason = starts < 4 ? "ffmpeg-exited code=1" : "completed";
    return { exited: Promise.resolve({ reason }), stop: async () => {} };
  };
  const res = await supervise(start, { sleep: clock.sleep, now: clock.now });
  assert.equal(starts, 4);
  assert.equal(res.restarts, 3);
  assert.deepEqual(clock.sleeps, [1000, 2000, 4000]);
});

test("watchdog restarts when the browser dies too, and tears the old unit down first", async () => {
  const clock = fakeClock();
  const events = [];
  let n = 0;
  const start = async () => {
    const id = ++n;
    return {
      exited: Promise.resolve({ reason: id === 1 ? "browser-disconnected" : "completed" }),
      stop: async () => { events.push(`stop${id}`); },
    };
  };
  await supervise(start, { sleep: clock.sleep, now: clock.now, log: (m) => events.push(m) });
  assert.equal(events[0], "stop1", "unit 1 is stopped (ffmpeg killed) before unit 2 starts");
  assert.ok(events.some((e) => /browser-disconnected/.test(e)));
  assert.equal(n, 2);
});

test("watchdog resets the backoff after a unit stays up for the healthy period", async () => {
  const clock = fakeClock();
  let n = 0;
  const start = async () => {
    n++;
    if (n === 3) clock.advance(BACKOFF.healthyMs + 1);   // unit 3 ran for a minute before dying
    return { exited: Promise.resolve({ reason: n < 5 ? "page-crashed" : "completed" }), stop: async () => {} };
  };
  await supervise(start, { sleep: clock.sleep, now: clock.now });
  assert.deepEqual(clock.sleeps, [1000, 2000, 1000, 2000]);
});

test("watchdog survives a start() that throws, and honours maxRestarts", async () => {
  const clock = fakeClock();
  let n = 0;
  const res = await supervise(async () => { n++; throw new Error("chromium missing"); }, { sleep: clock.sleep, now: clock.now, maxRestarts: 2 });
  assert.equal(n, 3);
  assert.equal(res.reason, "gave-up");
  assert.equal(res.restarts, 2);
});

test("watchdog stops cleanly on abort without restarting", async () => {
  const clock = fakeClock();
  const ac = new AbortController();
  let stopped = 0, n = 0;
  const start = async () => {
    n++;
    let resolve;
    const exited = new Promise((r) => { resolve = r; });
    return { exited, stop: async () => { stopped++; resolve({ reason: "stopped" }); } };
  };
  const p = supervise(start, { sleep: clock.sleep, now: clock.now, signal: ac.signal });
  await new Promise((r) => setImmediate(r));
  ac.abort();
  const res = await p;
  assert.equal(res.reason, "stopped");
  assert.equal(n, 1);
  assert.ok(stopped >= 1);
});

// ── always-on dry run: rolling segments ──────────────────────────────────────
test("--segments-dir resolves to a bounded ring and is never RTMP; --out still wins", () => {
  const t = resolveTarget({ segmentsDir: "/tmp/ring", env: { RADIO_PLAYOUT_ENABLED: "true", RADIO_STREAM_KEY: "abcd-efgh" } });
  assert.deepEqual(t, { kind: "segments", dir: "/tmp/ring", segmentSec: 60, keep: 10 });
  assert.equal(resolveTarget({ out: "/tmp/x.mp4", segmentsDir: "/tmp/ring", env: {} }).kind, "file");
});

test("segment ffmpeg args wrap a fixed number of files and keep the encode settings", () => {
  const a = buildFfmpegArgs({ target: { kind: "segments", dir: "/tmp/ring", segmentSec: 60, keep: 10 }, bed: "/m/b.mp3", bedLufs: -18 });
  const at = (flag) => a[a.indexOf(flag) + 1];
  assert.equal(at("-f"), "image2pipe");
  assert.equal(a[a.lastIndexOf("-f") + 1], "segment");
  assert.equal(at("-segment_wrap"), "10");
  assert.equal(at("-segment_time"), "60");
  assert.equal(at("-b:v"), "4500k");
  assert.equal(a.at(-1), "/tmp/ring/seg-%02d.ts");
  assert.ok(!a.includes("-t"), "live segments run until stopped");
  assert.ok(!a.some((x) => /^rtmp/.test(x)));
});

test("the forced daypart cycle is refused on RTMP", async () => {
  await assert.rejects(
    runPlayout({ env: { RADIO_PLAYOUT_ENABLED: "true", RADIO_STREAM_KEY: "abcd-efgh" }, forceDaypartCycleSec: 5 }),
    /cannot be used with RTMP/,
  );
});

// ── live bed swap, planned restarts, limiter ceiling ─────────────────────────
test("a planned restart skips the crash backoff and does not count as a give-up", async () => {
  const clock = fakeClock();
  let starts = 0;
  const reasons = ["planned-restart", "planned-restart", "ffmpeg-exited code=1", "completed"];
  const start = async () => ({ exited: Promise.resolve({ reason: reasons[starts++] }), stop: async () => {} });
  const res = await supervise(start, { sleep: clock.sleep, now: clock.now, maxRestarts: 1 });
  assert.equal(res.reason, "completed");
  assert.deepEqual(clock.sleeps, [1000], "only the real crash waited, and at the first backoff step");
});

test("live targets read the bed as PCM on fd 3 (no -re/-stream_loop/-af in the encoder), file targets keep the looped bed", () => {
  const seg = { kind: "segments", dir: "/tmp/ring", segmentSec: 60, keep: 10 };
  const live = buildFfmpegArgs({ target: seg, bed: "/m/b.mp3", bedLufs: -18, audioPipe: true });
  assert.ok(live.includes("pipe:3"));
  for (const flag of ["-re", "-stream_loop", "-af"]) assert.ok(!live.includes(flag), flag);
  assert.equal(live[live.indexOf("-b:v") + 1], "4500k");
  assert.ok(!live.includes("/m/b.mp3"));
  const file = buildFfmpegArgs({ target: { kind: "file", path: "/tmp/t.mp4" }, bed: "/m/b.mp3", bedLufs: -18, seconds: 5 });
  assert.ok(file.includes("-stream_loop") && file.includes("-af") && !file.includes("pipe:3"));
});

test("the feeder loops the bed in real time through the loudness filter into s16le PCM", () => {
  const a = buildFeederArgs({ bed: "/m/b.mp3", bedLufs: -18 });
  assert.ok(a.includes("-re") && a.includes("-stream_loop"));
  assert.equal(a[a.indexOf("-af") + 1], loudnessFilter(-18));
  assert.deepEqual(a.slice(a.indexOf("-f"), a.indexOf("-f") + 2), ["-f", "s16le"]);
  assert.equal(a.at(-1), "pipe:1");
});

test("limiter ceiling leaves room for AAC overshoot (measured +1.1 dB on the markets bed)", () => {
  assert.equal(AUDIO.truePeakDb, -3);
  assert.match(loudnessFilter(-16.3), /alimiter=limit=0\.7079:/);
});

// ── RTMP dead-connection timeout, loopback-only test hook ────────────────────
test("RTMP output carries an I/O timeout before the URL; file and segment outputs do not", () => {
  const rtmp = buildFfmpegArgs({ target: { kind: "rtmp", url: `${RTMP_BASE}/abcd` }, bed: "/m/b.mp3", bedLufs: -18, audioPipe: true });
  const i = rtmp.indexOf("-rw_timeout");
  assert.ok(i > 0, "rw_timeout present");
  assert.equal(rtmp[i + 1], String(RTMP.rwTimeoutMs * 1000), "microseconds");
  assert.deepEqual(rtmp.slice(i + 2), ["-f", "flv", `${RTMP_BASE}/abcd`], "an output option, directly before the URL");
  assert.ok(RTMP.rwTimeoutMs <= 8000, "detection budget is 10 s including socket-buffer fill");
  for (const target of [{ kind: "file", path: "/tmp/t.mp4" }, { kind: "segments", dir: "/tmp/r", segmentSec: 60, keep: 10 }]) {
    assert.ok(!buildFfmpegArgs({ target, bed: "/m/b.mp3", bedLufs: -18 }).includes("-rw_timeout"), target.kind);
  }
});

test("RADIO_PLAYOUT_RTMP_BASE only accepts loopback rtmp:// and never bypasses the two gates", () => {
  assert.equal(rtmpBase({}), RTMP_BASE);
  assert.equal(rtmpBase({ RADIO_PLAYOUT_RTMP_BASE: "rtmp://127.0.0.1:19350/live/" }), "rtmp://127.0.0.1:19350/live");
  for (const bad of ["rtmp://a.rtmp.youtube.com/live2", "rtmp://example.com/live", "rtmp://127.0.0.1.evil.com/live", "http://127.0.0.1/live", "nonsense"]) {
    assert.throws(() => rtmpBase({ RADIO_PLAYOUT_RTMP_BASE: bad }), /RADIO_PLAYOUT_RTMP_BASE/, bad);
  }
  const hook = { RADIO_PLAYOUT_RTMP_BASE: "rtmp://127.0.0.1:19350/live" };
  assert.throws(() => resolveTarget({ env: hook }), /no output target/);
  assert.throws(() => resolveTarget({ env: { ...hook, RADIO_PLAYOUT_ENABLED: "true" } }), /no output target/);
  assert.deepEqual(resolveTarget({ env: { ...hook, RADIO_PLAYOUT_ENABLED: "true", RADIO_STREAM_KEY: "testkey" } }),
    { kind: "rtmp", url: "rtmp://127.0.0.1:19350/live/testkey" });
});

test("a muxer write error from ffmpeg is fatal at once; ordinary warnings are not", () => {
  for (const line of [
    "[vost#0:0/libx264 @ 0xc1b04c000] Error submitting a packet to the muxer: Operation timed out",
    "[out#0/flv @ 0xc1b02c480] Error muxing a packet",
    "[out#0/flv @ 0x1] Error muxing a packet\n[out#0/flv @ 0x1] Task finished with error code: -60",
  ]) assert.equal(isFatalMuxError(line), true, line);
  for (const line of [
    "[swscaler @ 0x85c894000] deprecated pixel format used, make sure you did set range correctly",
    "[aist#1:0/pcm_s16le @ 0xb9cc08480] Guessed Channel Layout: stereo",
    "[flv @ 0x9c1028500] Failed to update header with correct filesize.",
    "",
  ]) assert.equal(isFatalMuxError(line), false, line);
});
