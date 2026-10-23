/**
 * contentSafety.test.js - DrJ's media rule (#218): the pre-recorded gate, the clearance, the live delay
 * gate, and the places that schedule media (airCheck, the film rotation).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertMediaSafe, checkMediaSafety, hasValidClearance, clearancePath, samplingCoverage, judge,
  MediaRefused, RULE_VERSION, THRESHOLDS,
} from "./contentSafety.js";
import { createLiveSafetyGate } from "./liveSafetyGate.js";
import { ffmpegFrameSampler, ffprobeProbe, parseShowinfoTimes } from "./mediaCheckers.js";
import { airCheck } from "../programme/airCheck.js";
import { clearedLibrary } from "../filmRotation.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "content-safety-test-"));
function fakeFile(dir, name = "clip.mp4", bytes = "not really a video") {
  const f = path.join(dir, name); fs.writeFileSync(f, bytes); return f;
}
const framesEvery = (dur, step = 1) => { const out = []; for (let t = 0; t < dur; t += step) out.push({ t: +t.toFixed(3), path: `f${t}.jpg` }); return out; };

/** A full set of checkers that say "safe" to everything; override one piece per test. */
function safeCheckers(over = {}) {
  return {
    probe: () => ({ durationSec: 10, hasVideo: true, hasAudio: true }),
    sampleFrames: () => framesEvery(10),
    vision: (frames) => frames.map((f) => ({ t: f.t, verdict: "safe", categories: [] })),
    transcribe: () => ({ text: "the council met today", segments: [{ start: 0, end: 3, text: "the council met today" }] }),
    checkTranscript: () => ({ verdict: "safe", categories: [] }),
    soundEvents: () => ({ verdict: "safe", categories: [], events: [] }),
    ...over,
  };
}

// ── verdicts ──

test("judge: only an explicit safe with no categories passes", () => {
  assert.equal(judge({ verdict: "safe", categories: [] }).pass, true);
  assert.equal(judge({ verdict: "safe" }).pass, true);
  for (const v of [null, undefined, {}, { verdict: "unsure" }, { verdict: "unsafe" }, { verdict: "SAFE" }, { verdict: "safe", categories: ["gore"] }, "safe"]) {
    assert.equal(judge(v).pass, false, `passed ${JSON.stringify(v)}`);
  }
});

// ── the pre-recorded gate ──

test("all checks safe: the item is cleared and gets a clearance bound to the file", async () => {
  const d = tmp(); const f = fakeFile(d);
  const logs = [];
  const r = await assertMediaSafe({ id: "c1", file: f }, safeCheckers(), { log: (x) => logs.push(x) });
  assert.equal(r.ok, true);
  assert.equal(r.checks.vision.frames, 10);
  assert.equal(logs[0].type, "media-cleared");
  assert.deepEqual(hasValidClearance(f).ok, true);
  const rec = JSON.parse(fs.readFileSync(clearancePath(f), "utf8"));
  assert.equal(rec.ruleVersion, RULE_VERSION);
});

test("UNMEASURED IS REFUSED: no checkers at all", async () => {
  const d = tmp(); const f = fakeFile(d);
  await assert.rejects(assertMediaSafe({ file: f }, {}), MediaRefused);
  assert.equal(hasValidClearance(f).ok, false);
});

test("UNMEASURED IS REFUSED: each missing or failing check refuses on its own", async () => {
  const d = tmp(); const f = fakeFile(d);
  const cases = {
    "vision missing": { vision: undefined },
    "sampler missing": { sampleFrames: undefined },
    "transcriber missing": { transcribe: undefined },
    "transcript check missing": { checkTranscript: undefined },
    "sound events missing": { soundEvents: undefined },
    "vision throws": { vision: () => { throw new Error("model down"); } },
    "vision skips a frame": { vision: (fr) => fr.slice(1).map((x) => ({ t: x.t, verdict: "safe" })) },
    "vision unsure on one frame": { vision: (fr) => fr.map((x, i) => ({ t: x.t, verdict: i === 4 ? "unsure" : "safe" })) },
    "transcription throws": { transcribe: () => { throw new Error("whisper not runnable"); } },
    "transcript unsure": { checkTranscript: () => ({ verdict: "unsure" }) },
    "transcript returns nothing": { checkTranscript: () => null },
    "sound events unsure": { soundEvents: () => ({ verdict: "unsure" }) },
    "probe without a duration": { probe: () => ({ hasVideo: true, hasAudio: false }) },
    "probe throws": { probe: () => { throw new Error("ffprobe missing"); } },
    "sampler returns no frames": { sampleFrames: () => [] },
  };
  for (const [name, over] of Object.entries(cases)) {
    const c = safeCheckers(over);
    for (const k of Object.keys(over)) if (over[k] === undefined) delete c[k];
    const { ok, report } = await checkMediaSafety({ file: f }, c);
    assert.equal(ok, false, `${name}: passed`);
    assert.ok(report.reasons.length > 0, `${name}: no reason recorded`);
  }
});

test("UNMEASURED IS REFUSED: a check that times out", async () => {
  const d = tmp(); const f = fakeFile(d);
  const { ok, report } = await checkMediaSafety({ file: f }, safeCheckers({ vision: () => new Promise(() => {}) }), { thresholds: { ...THRESHOLDS, checkTimeoutMs: 50 } });
  assert.equal(ok, false);
  assert.match(report.reasons.map((r) => r.reason).join(), /timed out/);
});

test("ONE FLAGGED FRAME REFUSES THE WHOLE CLIP, with its timestamp and category logged", async () => {
  const d = tmp(); const f = fakeFile(d);
  const logs = [];
  const vision = (fr) => fr.map((x) => ({ t: x.t, verdict: x.t === 7 ? "unsafe" : "safe", categories: x.t === 7 ? ["violence"] : [] }));
  const err = await assertMediaSafe({ id: "c2", file: f }, safeCheckers({ vision }), { log: (x) => logs.push(x) }).catch((e) => e);
  assert.ok(err instanceof MediaRefused);
  const pic = err.report.reasons.filter((r) => r.check === "pictures");
  assert.equal(pic.length, 1);
  assert.equal(pic[0].at, 7);
  assert.deepEqual(pic[0].categories, ["violence"]);
  assert.equal(logs[0].type, "media-refused");
  assert.equal(logs[0].reasons[0].at, 7);
  assert.equal(fs.existsSync(clearancePath(f)), false);
});

test("a refusal removes an older clearance for the same file", async () => {
  const d = tmp(); const f = fakeFile(d);
  await assertMediaSafe({ file: f }, safeCheckers());
  assert.equal(hasValidClearance(f).ok, true);
  await assert.rejects(assertMediaSafe({ file: f }, safeCheckers({ checkTranscript: () => ({ verdict: "unsafe", categories: ["abuse"], at: 4 }) })));
  assert.equal(hasValidClearance(f).ok, false);
});

test("sampling must really be >= 1 frame per second: a gap refuses", async () => {
  const d = tmp(); const f = fakeFile(d);
  const sparse = () => [0, 1, 2, 4.5, 5, 6, 7, 8, 9].map((t) => ({ t, path: `${t}.jpg` }));
  const { ok, report } = await checkMediaSafety({ file: f }, safeCheckers({ sampleFrames: sparse }));
  assert.equal(ok, false);
  assert.match(report.reasons.map((r) => r.reason).join(), /2\.50 s apart from 2\.00 s/);
  assert.equal(samplingCoverage([0, 1, 2, 3], 3.9).ok, true);
  assert.equal(samplingCoverage([0.5, 1.5], 3).ok, false, "the tail after the last frame counts");
  assert.equal(samplingCoverage([1.2, 2], 2.5).ok, false, "the head before the first frame counts");
});

test("a file with no audio track skips the sound checks (measured by probe); one with sound needs them all", async () => {
  const d = tmp(); const f = fakeFile(d);
  const silent = safeCheckers({ probe: () => ({ durationSec: 10, hasVideo: true, hasAudio: false }) });
  delete silent.transcribe; delete silent.checkTranscript; delete silent.soundEvents;
  assert.equal((await checkMediaSafety({ file: f }, silent)).ok, true);
  const withSound = safeCheckers();
  delete withSound.soundEvents;
  const r = await checkMediaSafety({ file: f }, withSound);
  assert.equal(r.ok, false);
  assert.match(r.report.reasons[0].reason, /sound-event/);
});

test("clearance stops counting when the file changes or the rule version moves on", async () => {
  const d = tmp(); const f = fakeFile(d, "a.mp4", "AAAA");
  await assertMediaSafe({ file: f }, safeCheckers());
  assert.equal(hasValidClearance(f).ok, true);
  fs.writeFileSync(f, "BBBB");   // same size, different bytes
  assert.match(hasValidClearance(f).why, /hash/);
  fs.writeFileSync(f, "AAAA");
  const rec = JSON.parse(fs.readFileSync(clearancePath(f), "utf8"));
  fs.writeFileSync(clearancePath(f), JSON.stringify({ ...rec, ruleVersion: "2020-01-01" }));
  assert.match(hasValidClearance(f).why, /rule 2020-01-01/);
  fs.writeFileSync(clearancePath(f), "{not json");
  assert.match(hasValidClearance(f).why, /unreadable/);
  fs.rmSync(clearancePath(f));
  assert.match(hasValidClearance(f).why, /no content-safety clearance/);
});

// ── where media gets scheduled ──

test("airCheck refuses an hour whose film has no clearance, and passes once it is cleared", async () => {
  const d = tmp();
  const H = Date.parse("2026-10-24T16:00:00Z");
  const film = fakeFile(d, "film.mp4");
  const part = path.join(d, "part.wav"); fs.writeFileSync(part, Buffer.alloc(1_100_000));
  fs.writeFileSync(path.join(d, "programme.json"), JSON.stringify({ hourStart: H, cues: Array.from({ length: 25 }, (_, i) => ({ i })), audio: [{ file: "part.wav" }], film: "film.mp4", filmPath: film }));
  const hour = { lines: [1, 2, 3].map((i) => ({ id: `s${i}`, story: `story ${i}` })) };
  fs.writeFileSync(path.join(d, "segments.raw.json"), JSON.stringify({ segments: { "the-hour": hour } }));
  fs.writeFileSync(path.join(d, "segments.json"), JSON.stringify({ "the-hour": hour }));
  const before = airCheck(d, { hourStart: H });
  assert.equal(before.ok, false);
  assert.match(before.problems.join(), /film film\.mp4: no content-safety clearance/);
  await assertMediaSafe({ file: film }, safeCheckers());
  assert.deepEqual(airCheck(d, { hourStart: H }).problems, []);
});

test("the film rotation plans only cleared items and reports the rest", () => {
  const lib = { items: [{ id: "a", file: "/a.mp4" }, { id: "b", file: "/b.mp4" }, { id: "c", file: "/c.mp4" }], skipped: [] };
  const r = clearedLibrary(lib, (f) => (f === "/b.mp4" ? { ok: true } : f === "/c.mp4" ? { ok: false, why: "file changed" } : null));
  assert.deepEqual(r.items.map((i) => i.id), ["b"]);
  assert.deepEqual(r.notCleared, [{ id: "a", why: "not cleared" }, { id: "c", why: "file changed" }]);
  assert.throws(() => clearedLibrary(lib));
});

// ── live feeds ──

/** Drive a live gate with a fake clock: one video frame every 200 ms and 1 s audio chunks. */
async function runLive({ check, seconds = 90, delayMs = 60_000, tracks = ["video", "audio"], startCheckAt = 0, ...o }) {
  const aired = [];
  const cuts = [];
  const logs = [];
  const g = createLiveSafetyGate({ check, tracks, delayMs, onCut: (c) => cuts.push(c), log: (x) => logs.push(x), ...o });
  for (let now = 0; now <= seconds * 1000; now += 200) {
    g.push("video", now, { frame: now });
    if (tracks.includes("audio") && now % 1000 === 0) g.push("audio", now, { pcm: now }, { endTs: now + 1000 });
    await g.drain();
    if (now >= startCheckAt) aired.push(...g.release(now));
  }
  return { g, aired, cuts, logs };
}

const allSafe = async () => ({ verdict: "safe", categories: [] });

test("LIVE: nothing airs before the delay; with checks all safe the feed airs about 60 s behind", async () => {
  const { g, aired, cuts } = await runLive({ check: allSafe });
  assert.equal(cuts.length, 0);
  assert.ok(aired.length > 0);
  const s = g.stats();
  assert.ok(s.measuredDelayMs.min >= 60_000, `aired after only ${s.measuredDelayMs.min} ms`);
  assert.ok(s.measuredDelayMs.max <= 60_000 + 6_000, `delay grew to ${s.measuredDelayMs.max} ms`);
  // order is kept
  const ts = aired.map((a) => a.ts);
  for (let i = 1; i < ts.length; i++) if (aired[i].track === aired[i - 1].track) assert.ok(ts[i] >= ts[i - 1]);
});

test("LIVE HIT: the cut happens before the flagged timestamp reaches the output, and the feed stays off", async () => {
  const FLAG = 100_000;   // after the first frames have already aired
  const check = async ({ track, ts }) => (track === "video" && ts === FLAG ? { verdict: "unsafe", categories: ["violence"] } : { verdict: "safe" });
  const { g, aired, cuts, logs } = await runLive({ check, seconds: 150 });
  assert.ok(aired.length > 0, "the feed never aired before the hit");
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0].flaggedAt, FLAG);
  assert.equal(cuts[0].kind, "hit");
  assert.ok(cuts[0].discarded > 0, "the buffer was not emptied");
  assert.equal(aired.some((a) => (a.endTs ?? a.ts) >= FLAG), false, "something at or after the flagged frame aired");
  assert.equal(g.onAir, false);
  assert.equal(g.push("video", 999_999, {}), false, "pushes after the cut are dropped");
  assert.equal(logs[0].type, "live-cut");
  // only DrJ resumes it, and nothing from before the cut can air afterwards
  assert.equal(g.resume({ by: "DrJ" }), true);
  assert.equal(g.onAir, true);
  assert.deepEqual(g.release(10_000_000), []);
});

test("LIVE SLOW CHECKER: a frame waits for its verdict even past the delay; a late hit still cuts first", async () => {
  // Every verdict arrives LAG ms of feed time after the sample (longer than the 60 s delay, inside maxBehind).
  const LAG = 65_000, FLAG = 40_000;
  const due = [];
  let clock = 0;
  const check = ({ track, ts }) => new Promise((resolve) => due.push({ at: ts + LAG, resolve,
    v: track === "video" && ts === FLAG ? { verdict: "unsafe", categories: ["gore"] } : { verdict: "safe" } }));
  const aired = [], cuts = [];
  const g = createLiveSafetyGate({ check, tracks: ["video"], onCut: (c) => cuts.push(c) });
  for (clock = 0; clock <= 140_000; clock += 200) {
    g.push("video", clock, {});
    for (const d of due.splice(0).filter((d) => (d.at <= clock ? (d.resolve(d.v), false) : true))) due.push(d);
    await new Promise((r) => setImmediate(r));   // let resolved verdicts land (drain() would wait on the unresolved ones)
    aired.push(...g.release(clock).map((a) => ({ ...a, airedAt: clock })));
  }
  assert.ok(aired.length > 0, "nothing aired before the hit");
  assert.ok(aired.every((a) => a.airedAt - a.ts >= LAG - 1000), "a frame aired before the checker had seen a sample at or after it");
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0].flaggedAt, FLAG);
  assert.equal(aired.some((a) => a.ts >= FLAG), false, "the flagged frame (or one after it) aired");
});

test("LIVE: a flagged audio window cuts too", async () => {
  const check = async ({ track, ts }) => (track === "audio" && ts === 80_000 ? { verdict: "unsafe", categories: ["abuse"] } : { verdict: "safe" });
  const { aired, cuts } = await runLive({ check, seconds: 120 });
  assert.ok(aired.length > 0);
  assert.equal(cuts.length, 1);
  assert.equal(aired.some((a) => (a.endTs ?? a.ts) > 80_000), false);
});

test("LIVE OUTAGE: a checker that is down keeps the feed off air", async () => {
  const down = async () => { throw new Error("vision service unreachable"); };
  const { aired, cuts, g } = await runLive({ check: down });
  assert.equal(aired.length, 0);
  assert.equal(cuts[0].kind, "checker-failure");
  assert.equal(g.onAir, false);
});

test("LIVE OUTAGE: a checker that never answers keeps the feed off air and is cut, not aired late", async () => {
  const hang = () => new Promise(() => {});
  const aired = [], cuts = [];
  const g = createLiveSafetyGate({ check: hang, tracks: ["video"], onCut: (c) => cuts.push(c), checkTimeoutMs: 60 * 60_000 });
  for (let now = 0; now <= 90_000; now += 200) { g.push("video", now, {}); aired.push(...g.release(now)); }
  assert.equal(aired.length, 0);
  assert.equal(cuts[0]?.kind, "checker-behind");
});

test("LIVE: an unsure verdict is a cut", async () => {
  const check = async ({ ts }) => (ts === 10_000 ? { verdict: "unsure" } : { verdict: "safe" });
  const { cuts } = await runLive({ check, tracks: ["video"], seconds: 80 });
  assert.equal(cuts[0]?.reason, "checker unsure");
});

test("LIVE: at least one frame per second goes to the checker", async () => {
  const seen = [];
  await runLive({ check: async (s) => { if (s.track === "video") seen.push(s.ts); return { verdict: "safe" }; }, tracks: ["video"], seconds: 20 });
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] - seen[i - 1] <= 1000, `gap ${seen[i] - seen[i - 1]} ms`);
  assert.ok(seen.length >= 20);
});

// ── the real ffmpeg sampler (runs only where ffmpeg is installed; says so when it is not) ──

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

test("ffmpeg sampler: >= 1 frame per second plus the scene change, times measured from showinfo", { skip: hasFfmpeg ? false : "ffmpeg/ffprobe not on PATH: sampler UNVERIFIED here" }, () => {
  const d = tmp(); const f = path.join(d, "two-scenes.mp4");
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
    "color=red:s=320x240:r=25:d=2.3[a];color=blue:s=320x240:r=25:d=3.1[b];[a][b]concat=n=2:v=1:a=0",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", f], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const probe = ffprobeProbe(f);
  assert.equal(probe.hasVideo, true); assert.equal(probe.hasAudio, false);
  const frames = ffmpegFrameSampler({ workDir: d })(f, { everySec: 1, sceneThreshold: 0.3 });
  const times = frames.map((x) => x.t);
  assert.ok(times.some((t) => Math.abs(t - 2.32) < 0.05), `scene change at 2.32 s not sampled: ${times}`);
  assert.equal(samplingCoverage(times, probe.durationSec).ok, true, JSON.stringify(times));
  for (const fr of frames) assert.ok(fs.statSync(fr.path).size > 0);
});

test("parseShowinfoTimes reads pts_time in output order", () => {
  const log = "[Parsed_showinfo_1 @ 0x1] n:   0 pts:      0 pts_time:0       duration\n[Parsed_showinfo_1 @ 0x1] n:   1 pts:  12800 pts_time:1.04 x\nother line pts_time:9";
  assert.deepEqual(parseShowinfoTimes(log), [0, 1.04]);
});
