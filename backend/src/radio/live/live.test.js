/**
 * live.test.js - #202 live events desk: allow-list gate, pre-air check, calendar, switch, social clips.
 * No network, no yt-dlp, no ffmpeg: commands are injected. The 5-minute NASA/UN rehearsal is a Mac check.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OFFICIAL_FEEDS, entryForUrl, assertCanAir, isNeverAirHost, youtubeHandleOf } from "./officialFeeds.js";
import { interpretYtDlp, interpretFfprobe, probeFeed, ytDlpArgs } from "./feedProbe.js";
import { validateEvent, loadManualEvents, parseUpcoming, mergeCalendar, airsAutomatically } from "./eventsCalendar.js";
import { createLiveDesk, decide, DROP_MS, liveEnabled } from "./liveDesk.js";
import { prepareClip, recordClipPlayed, trimArgs, creditLine, auditClipLog, MAX_CLIP_SECONDS } from "./socialClips.js";
import { createLiveLog } from "./liveLog.js";
import { createJpegSplitter } from "./pictureHub.js";
import { buildLiveFeederArgs } from "../playout/ffmpegArgs.js";

const PASS = { ok: true, reason: "live, public, plays without a login", mediaUrl: "https://media.example/x.m3u8", httpHeaders: {} };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

// ── allow-list ───────────────────────────────────────────────────────────────
test("allow-list entries each name a publisher and a reason", () => {
  const ids = new Set();
  for (const f of OFFICIAL_FEEDS) {
    assert.ok(f.id && !ids.has(f.id), `unique id ${f.id}`); ids.add(f.id);
    assert.ok(f.publisher && f.why && f.addedBy, `${f.id} has publisher, why, addedBy`);
  }
});

test("URLs resolve to their own official entry", () => {
  assert.equal(entryForUrl("https://www.youtube.com/@NASA/live")?.id, "nasa");
  assert.equal(entryForUrl("https://youtube.com/@nasa")?.id, "nasa");
  assert.equal(entryForUrl("https://webtv.un.org/en/schedule")?.id, "un-webtv");
  assert.equal(entryForUrl("https://www.whitehouse.gov/live/")?.id, "white-house");
  assert.equal(entryForUrl("https://live.house.gov/")?.id, "us-house");
});

test("a feed not on the allow-list cannot go to air", () => {
  const refused = [
    ["nasa", "https://www.youtube.com/@CNN/live"],                 // another broadcaster's channel
    ["nasa", "https://edition.cnn.com/live-tv"],
    ["nasa", "https://www.aljazeera.com/live/"],
    ["nasa", "https://www.bbc.co.uk/news/live"],
    ["nasa", "https://nasa.gov.evil.example/live"],                 // look-alike host
    ["nasa", "http://www.nasa.gov/live"],                           // not https
    ["white-house", "https://www.whitehouse.gov/briefings/"],      // official host, path not on the entry
    ["cnn", "https://www.youtube.com/@CNN/live"],                  // entry that does not exist
    ["nasa", "https://webtv.un.org/en"],                           // allowed URL, wrong entry
  ];
  for (const [entryId, url] of refused) {
    assert.throws(() => assertCanAir({ entryId, url, probe: PASS }), /live feed refused/, `${entryId} ${url}`);
  }
  assert.equal(isNeverAirHost("https://edition.cnn.com/live-tv"), true);
});

test("a watch?v= URL airs only when the probe ties it to the entry's channel", () => {
  const url = "https://www.youtube.com/watch?v=abc123";
  assert.equal(entryForUrl(url), null);
  assert.throws(() => assertCanAir({ entryId: "nasa", url, probe: PASS }), /not on the official-feeds allow-list/);
  assert.equal(assertCanAir({ entryId: "nasa", url, probe: { ...PASS, uploaderHandle: "@NASA" } }).id, "nasa");
  assert.throws(() => assertCanAir({ entryId: "nasa", url, probe: { ...PASS, uploaderHandle: "@SomeoneElse" } }), /refused/);
  // URL path says NASA, the probe says another channel: refused
  assert.throws(() => assertCanAir({ entryId: "nasa", url: "https://www.youtube.com/@NASA/live", probe: { ...PASS, uploaderHandle: "@CNN" } }), /refused/);
  assert.equal(youtubeHandleOf("https://www.youtube.com/@UnitedNations/streams"), "@unitednations");
});

test("an official page embedding someone else's YouTube stream is refused", () => {
  assert.throws(() => assertCanAir({ entryId: "us-house", url: "https://live.house.gov/", probe: { ...PASS, uploaderHandle: "@CSPAN" } }), /not on "us-house"/);
});

test("no pre-air check, or a failed one, means no air", () => {
  assert.throws(() => assertCanAir({ entryId: "nasa", url: "https://www.youtube.com/@NASA/live", probe: null }), /did not run/);
  assert.throws(() => assertCanAir({ entryId: "nasa", url: "https://www.youtube.com/@NASA/live", probe: { ok: false, reason: "needs a login or is gated" } }), /needs a login/);
});

// ── pre-air check ────────────────────────────────────────────────────────────
test("yt-dlp is run without cookies or a user config", () => {
  const a = ytDlpArgs("https://www.youtube.com/@NASA/live");
  for (const f of ["--ignore-config", "--no-cookies", "--no-cookies-from-browser"]) assert.ok(a.includes(f), f);
  assert.ok(!a.some((x) => /^--cookies(=|$)/.test(x)));
});

test("probe refuses login, members-only, private, not-live; accepts public live", () => {
  assert.match(interpretYtDlp({ code: 1, stdout: "", stderr: "ERROR: Sign in to confirm your age" }).reason, /login/);
  assert.match(interpretYtDlp({ code: 1, stdout: "", stderr: "ERROR: Join this channel to get access to members-only content" }).reason, /login/);
  const j = (o) => ({ code: 0, stdout: JSON.stringify(o), stderr: "" });
  assert.equal(interpretYtDlp(j({ is_live: true, availability: "subscriber_only", url: "u" })).ok, false);
  assert.equal(interpretYtDlp(j({ is_live: false, live_status: "was_live", availability: "public", url: "u" })).ok, false);
  assert.equal(interpretYtDlp(j({ is_live: true, availability: "public", age_limit: 18, url: "u" })).ok, false);
  const ok = interpretYtDlp(j({ is_live: true, live_status: "is_live", availability: "public", url: "https://m/x.m3u8", title: "Launch", uploader_id: "@NASA", channel_url: "https://www.youtube.com/channel/UCx" }));
  assert.equal(ok.ok, true); assert.equal(ok.uploaderHandle, "@NASA"); assert.equal(ok.mediaUrl, "https://m/x.m3u8");
  assert.equal(interpretFfprobe({ code: 0, stdout: JSON.stringify({ streams: [{ codec_type: "video" }] }) }).ok, false);
  assert.equal(interpretFfprobe({ code: 0, stdout: JSON.stringify({ streams: [{ codec_type: "video" }, { codec_type: "audio" }] }) }).ok, true);
});

test("probeFeed runs yt-dlp then ffprobe on the resolved stream", async () => {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push(cmd);
    if (cmd === "yt-dlp") return { code: 0, stdout: JSON.stringify({ is_live: true, availability: "public", url: "https://m/x.m3u8", uploader_id: "@NASA" }), stderr: "" };
    return { code: 0, stdout: JSON.stringify({ streams: [{ codec_type: "video" }, { codec_type: "audio" }] }), stderr: "" };
  };
  const p = await probeFeed("https://www.youtube.com/@NASA/live", { run });
  assert.deepEqual(calls, ["yt-dlp", "ffprobe"]);
  assert.equal(p.ok, true);
  const bad = await probeFeed("https://www.youtube.com/@NASA/live", { run: async () => ({ code: -1, stdout: "", stderr: "spawn yt-dlp ENOENT" }) });
  assert.equal(bad.ok, false);
});

// ── calendar ─────────────────────────────────────────────────────────────────
test("manual events are validated against the allow-list; broken entries are reported, not guessed", () => {
  const dir = tmp("live-cal-");
  const file = path.join(dir, "events.json");
  fs.writeFileSync(file, JSON.stringify([
    { feed: "nasa", url: "https://www.youtube.com/@NASA/live", title: "Crew launch", start: "2026-11-02T14:00:00Z", end: "2026-11-02T15:00:00Z" },
    { feed: "nasa", url: "https://www.youtube.com/@CNN/live", title: "Not NASA", start: "2026-11-02T14:00:00Z" },
    { feed: "cnn", url: "https://edition.cnn.com/live-tv", title: "x", start: "2026-11-02T14:00:00Z" },
    { feed: "un-webtv", url: "https://webtv.un.org/en", title: "", start: "2026-11-02T14:00:00Z" },
    { feed: "un-webtv", url: "https://webtv.un.org/en", title: "GA", start: "not a date" },
    { feed: "white-house", url: "https://www.youtube.com/watch?v=abc", title: "Remarks", start: "2026-11-02T20:00:00Z" },
  ]));
  const { events, rejected } = loadManualEvents(file);
  assert.equal(events.length, 2);
  assert.equal(rejected.length, 4);
  assert.equal(events[0].end - events[0].start, 3600_000);
  assert.equal(events[1].end - events[1].start, 120 * 60_000, "default length when no end is given");
  assert.deepEqual(loadManualEvents(path.join(dir, "missing.json")), { events: [], rejected: [] });
  fs.writeFileSync(file, "{oops");
  assert.equal(loadManualEvents(file).rejected.length, 1);
});

test("events are capped at 6 hours", () => {
  const r = validateEvent({ feed: "nasa", url: "https://www.youtube.com/@NASA/live", title: "Spacewalk", start: "2026-11-02T10:00:00Z", end: "2026-11-03T10:00:00Z" });
  assert.equal(r.event.end - r.event.start, 6 * 3600_000);
});

test("publisher schedules: only announced upcoming streams, listed (not aired) unless the feed is set to auto", () => {
  const nasa = OFFICIAL_FEEDS.find((f) => f.id === "nasa");
  const now = Date.parse("2026-11-01T00:00:00Z");
  const evs = parseUpcoming({ entries: [
    { id: "up1", title: "Launch coverage", live_status: "is_upcoming", release_timestamp: Date.parse("2026-11-02T14:00:00Z") / 1000 },
    { id: "live247", title: "Earth from space 24/7", live_status: "is_live" },
    { id: "up2", title: "No time", live_status: "is_upcoming" },
  ] }, nasa, { now });
  assert.equal(evs.length, 1);
  assert.equal(evs[0].url, "https://www.youtube.com/watch?v=up1");
  assert.equal(evs[0].source, "publisher");
  assert.equal(airsAutomatically(evs[0]), false);
  assert.equal(airsAutomatically(evs[0], [{ ...nasa, schedule: "auto" }]), true);
  const man = { ...evs[0], id: "m", source: "manual" };
  assert.equal(mergeCalendar(evs, [man]).length, 1);
  assert.equal(mergeCalendar(evs, [man])[0].source, "manual");
});

// ── switch to live and back ──────────────────────────────────────────────────
const event = (o = {}) => ({ id: "e1", feed: "nasa", publisher: "NASA", url: "https://www.youtube.com/@NASA/live", title: "Launch", start: 1000, end: 1000 + 5 * 60_000, source: "manual", ...o });

test("decide: start time, scheduled end, 30 s drop", () => {
  assert.equal(decide({ now: 999, events: [event()], state: { mode: "grid" } }).action, "stay");
  assert.equal(decide({ now: 1000, events: [event()], state: { mode: "grid" } }).action, "go-live");
  assert.equal(decide({ now: 1000, events: [event()], state: { mode: "grid" }, done: new Set(["e1"]) }).action, "stay");
  const live = { mode: "live", event: event(), startedAt: 1000, lastMediaAt: 50_000 };
  assert.equal(decide({ now: 50_000 + DROP_MS - 1, events: [], state: live }).action, "stay");
  assert.deepEqual(decide({ now: 50_000 + DROP_MS, events: [], state: live }), { action: "end", reason: "feed-dropped" });
  assert.deepEqual(decide({ now: 1000 + 5 * 60_000, events: [], state: { ...live, lastMediaAt: 1000 + 5 * 60_000 } }), { action: "end", reason: "scheduled-end" });
});

function fakeUnit() {
  const calls = [];
  return { calls, goLive: async (o) => { calls.push(["goLive", o]); }, endLive: async (r) => { calls.push(["endLive", r]); } };
}

test("desk: an off-list feed in the calendar never reaches the playout, and the refusal is logged", async () => {
  const dir = tmp("live-log-");
  const log = createLiveLog({ dir });
  const u = fakeUnit();
  // An event that slipped past the calendar check (e.g. a hand-built list): the air gate still refuses it.
  const bad = event({ id: "bad", url: "https://www.youtube.com/@CNN/live" });
  const desk = createLiveDesk({ unit: () => u, calendar: async () => [bad], probe: async () => PASS, log, now: () => 2000 });
  await desk.tick(); await desk.tick();
  assert.equal(u.calls.length, 0, "goLive never called");
  assert.equal(desk.state.mode, "grid");
  const recs = log.readAll();
  assert.equal(recs.length, 1, "refused once, not every tick");
  assert.equal(recs[0].type, "live-skip");
  assert.match(recs[0].reason, /not on the official-feeds allow-list/);
});

test("desk: a feed that needs a login is refused", async () => {
  const u = fakeUnit();
  const log = createLiveLog({ dir: tmp("live-log-") });
  const desk = createLiveDesk({ unit: () => u, calendar: async () => [event()], probe: async () => ({ ok: false, reason: "needs a login or is gated" }), log, now: () => 2000 });
  await desk.tick();
  assert.equal(u.calls.length, 0);
  assert.match(log.readAll()[0].reason, /needs a login/);
});

test("desk: carries an allowed feed with credit, returns to the grid on a 30 s drop, logs both", async () => {
  let t = 2000;
  const u = fakeUnit();
  const log = createLiveLog({ dir: tmp("live-log-") });
  const desk = createLiveDesk({ unit: () => u, calendar: async () => [event()], probe: async () => PASS, log, now: () => t });
  await desk.tick();
  assert.equal(desk.state.mode, "live");
  const [, o] = u.calls[0];
  assert.equal(o.overlay.publisher, "NASA");
  assert.equal(o.overlay.credit, "Live feed: NASA");
  assert.equal(o.mediaUrl, PASS.mediaUrl);
  t += 20_000; o.onMedia();            // media keeps arriving
  t += DROP_MS - 1; await desk.tick();
  assert.equal(desk.state.mode, "live");
  t += 1; await desk.tick();
  assert.equal(desk.state.mode, "grid");
  assert.deepEqual(u.calls.map((c) => c[0]), ["goLive", "endLive"]);
  const recs = log.readAll();
  assert.deepEqual(recs.map((r) => r.type), ["live-start", "live-end"]);
  assert.equal(recs[1].reason, "feed-dropped");
  await desk.tick();
  assert.equal(u.calls.length, 2, "a dropped event is not re-joined automatically");
});

test("desk: scheduled end returns to the grid; a failed switch stays on the grid", async () => {
  let t = 2000;
  const u = fakeUnit();
  const log = createLiveLog({ dir: tmp("live-log-") });
  const desk = createLiveDesk({ unit: () => u, calendar: async () => [event()], probe: async () => PASS, log, now: () => t });
  await desk.tick();
  t = 1000 + 5 * 60_000; u.calls[0][1].onMedia(); await desk.tick();
  assert.equal(log.readAll().at(-1).reason, "scheduled-end");

  const broken = { goLive: async () => { throw new Error("live feed produced no audio in 20 s"); }, endLive: async () => {} };
  const log2 = createLiveLog({ dir: tmp("live-log-") });
  const d2 = createLiveDesk({ unit: () => broken, calendar: async () => [event()], probe: async () => PASS, log: log2, now: () => 2000 });
  await d2.tick();
  assert.equal(d2.state.mode, "grid");
  assert.match(log2.readAll()[0].reason, /switch failed/);
});

test("the live desk is dark unless RADIO_LIVE_ENABLED is literally true", () => {
  assert.equal(liveEnabled({}), false);
  assert.equal(liveEnabled({ RADIO_LIVE_ENABLED: "1" }), false);
  assert.equal(liveEnabled({ RADIO_LIVE_ENABLED: "true" }), true);
});

// ── social clips ─────────────────────────────────────────────────────────────
test("clips: at most 30 s, credited, only when the post is the story", () => {
  const base = { url: "https://x.com/someone/status/1", handle: "someone", platform: "x", durationSec: 12, isTheStory: true };
  const ok = prepareClip(base);
  assert.equal(ok.ok, true);
  assert.equal(ok.clip.credit, "via @someone on X");
  assert.equal(creditLine("@user", "instagram"), "via @user on Instagram");
  assert.equal(prepareClip({ ...base, durationSec: 30.5 }).ok, false);
  assert.equal(prepareClip({ ...base, durationSec: 30 }).ok, true);
  assert.equal(prepareClip({ ...base, isTheStory: false }).ok, false);
  assert.equal(prepareClip({ ...base, handle: "" }).ok, false);
  assert.equal(prepareClip({ ...base, url: "http://x.com/a" }).ok, false);
  assert.equal(prepareClip({ ...base, durationSec: undefined }).ok, false);
  assert.equal(prepareClip({ ...base, platform: "myspace" }).ok, false);
  assert.deepEqual(trimArgs({ playSec: 999 }), ["-ss", "0", "-t", String(MAX_CLIP_SECONDS)], "the cap is physical");
});

test("clips: every clip played is logged with URL, handle and duration; the audit catches gaps", () => {
  const log = createLiveLog({ dir: tmp("live-log-") });
  const { clip } = prepareClip({ url: "https://x.com/someone/status/1", handle: "someone", platform: "x", durationSec: 12, isTheStory: true, storyId: "s1" });
  const rec = recordClipPlayed(log, clip, { playedSec: 12.04, segment: "news" });
  assert.equal(rec.url, clip.url); assert.equal(rec.handle, "@someone"); assert.equal(rec.durationSec, 12);
  assert.throws(() => recordClipPlayed(log, { url: clip.url }, { playedSec: 5 }), /needs url, handle and platform/);
  assert.throws(() => recordClipPlayed(log, clip, { playedSec: 41 }), /over the 30 s cap/);
  const a = auditClipLog(log.readAll());
  assert.equal(a.clips, 2);
  assert.equal(a.problems.length, 1, "the over-long play is flagged");
});

// ── picture path ─────────────────────────────────────────────────────────────
test("the JPEG splitter rebuilds frames across chunk boundaries", () => {
  const frames = [];
  const push = createJpegSplitter((f) => frames.push(f));
  const f1 = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const f2 = Buffer.from([0xff, 0xd8, 4, 5, 0xff, 0xd9]);
  const all = Buffer.concat([Buffer.from([9, 9]), f1, f2]);
  push(all.subarray(0, 5)); push(all.subarray(5, 10)); push(all.subarray(10));
  assert.deepEqual(frames.map((f) => [...f]), [[...f1], [...f2]]);
});

test("live feeder: one reader, PCM in the bed's format on stdout, JPEG frames on fd 3, nothing to disk", () => {
  const a = buildLiveFeederArgs({ mediaUrl: "https://m/x.m3u8", httpHeaders: { "User-Agent": "UA", Cookie: "nope" } });
  assert.equal(a.filter((x) => x === "-i").length, 1);
  assert.ok(a.includes("-re"));
  const joined = a.join(" ");
  assert.match(joined, /-f s16le -ar 44100 -ac 2 pipe:1/);
  assert.match(joined, /-f image2pipe pipe:3/);
  assert.doesNotMatch(joined, /Cookie/i, "only UA/referer/origin headers are passed");
  assert.ok(!a.some((x) => /\.(mp4|ts|mkv|flv)$/.test(x)), "no file output");
});
