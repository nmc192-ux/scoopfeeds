/**
 * playout.js - capture the radio screen and mix it with the daypart's music bed into one H.264/AAC stream.
 *
 *   headless Chromium --CDP screencast (JPEG)--> pacing writer (30 Hz) --stdin--> ffmpeg --> file | RTMP
 *                                                              music bed (looped, -16 LUFS) --^
 *
 * One "unit" = Chromium + ffmpeg. If either dies, or the screen stops producing frames, the whole unit is
 * torn down and the watchdog starts a fresh one (watchdog.js). A stale state.json needs no handling here:
 * the screen itself shows "Feed delayed" when updatedAt is >20 min old.
 *
 * The pacing writer repeats the latest frame at 30 Hz, because a screencast only emits on change and
 * ffmpeg would otherwise starve (and a live RTMP session with it) while the page is still. If ffmpeg
 * falls behind, repeats are skipped (counted in `slotsSkippedBackpressure`) rather than queued.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pickBed, daypartAt, easternMinutes, listBeds, musicDir, DAYPARTS } from "../musicLibrary.js";
import { buildFfmpegArgs, buildFeederArgs, buildLiveFeederArgs, VIDEO } from "./ffmpegArgs.js";
import { measureIntegrated } from "./loudness.js";
import { resolveTarget, redact } from "./outputTarget.js";
import { startScreenServer, screenUrl } from "./screenServer.js";
import { supervise } from "./watchdog.js";
import { startPictureHub } from "../live/pictureHub.js";
import { createLiveDesk, liveEnabled, TICK_MS } from "../live/liveDesk.js";
import { loadManualEvents, fetchPublisherEvents, mergeCalendar, eventsFile, validateEvent } from "../live/eventsCalendar.js";
import { probeFeed } from "../live/feedProbe.js";
import { createLiveLog, liveLogDir } from "../live/liveLog.js";

export const STALL_MS = 30_000;          // no new screencast frame for this long => the screen is dead
export const DAYPART_CHECK_MS = 30_000;
const DEMO_SCENES = ["news", "markets", "explains", "weather", "next", "music"];

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const name of ["playwright-core", "playwright"]) {
    try { return require(name); } catch { /* try next */ }
  }
  throw new Error("playwright-core is not installed; use the playout image (see Dockerfile.dev)");
}

/** Today's bed for `now`; if that daypart's folder is empty, any other daypart's bed, flagged as a fallback. */
export function chooseBed(now = new Date(), { dir = musicDir(), random = Math.random } = {}) {
  const daypart = daypartAt(now);
  const bed = pickBed(now, { dir, random });
  if (bed) return { bed, daypart, fallback: false };
  for (const other of DAYPARTS) {
    const beds = listBeds(other, dir);
    if (beds.length) return { bed: beds[Math.floor(random() * beds.length) % beds.length], daypart, fallback: true };
  }
  throw new Error(`no music bed found under ${dir}`);
}

/** Start one Chromium + ffmpeg unit. Resolves once both are running. */
export async function startUnit(opts) {
  const { target, bed, bedLufs, seconds, pageUrl, log = () => {}, demoCycleSec = 0, env = process.env, stats } = opts;
  const audioPipe = target.kind !== "file";   // live units take the bed through a swappable feeder (see buildFfmpegArgs)
  const args = buildFfmpegArgs({ target, bed, bedLufs, seconds, audioPipe });
  const ff = spawn(opts.ffmpeg || "ffmpeg", args, { stdio: audioPipe ? ["pipe", "ignore", "pipe", "pipe"] : ["pipe", "ignore", "pipe"] });
  let ffErr = "";
  ff.stderr.on("data", (d) => { ffErr = (ffErr + d).slice(-4000); });
  ff.stdin.on("error", () => { /* ffmpeg ended first; the exit handler reports it */ });

  let settle;
  const exited = new Promise((r) => { settle = r; });
  let done = false;
  const finish = (reason) => { if (!done) { done = true; settle({ reason }); } };
  ff.on("error", (e) => finish(`ffmpeg-spawn-failed: ${e.message}`));
  ff.on("exit", (code, sig) => {
    if (code === 0 && seconds) return finish("completed");
    log(`ffmpeg stderr tail: ${redact(ffErr.trim().split("\n").slice(-3).join(" | "), env)}`);
    finish(`ffmpeg-exited code=${code} signal=${sig}`);
  });

  // ── live audio: feeder ffmpeg -> this process -> encoder fd 3 ──
  let feeder = null, gateOpen = false, stopping = false;
  const pcmOut = audioPipe ? ff.stdio[3] : null;
  pcmOut?.on("error", () => { /* encoder ended first; the exit handler reports it */ });
  const retire = (f) => { if (!f) return; f.retired = true; try { f.proc.kill("SIGKILL"); } catch { /* gone */ } };
  let lastPcmAt = Date.now();
  /** A feeder writes PCM on stdout. A live feeder (#202) also writes JPEG frames on fd 3 and may end without killing the unit. */
  const spawnFeeder = ({ args, bed: bedPath = null, live = null }) => {
    const proc = spawn(opts.ffmpeg || "ffmpeg", args, { stdio: live ? ["ignore", "pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"] });
    const f = { proc, bed: bedPath, live, retired: false };
    f.firstData = new Promise((resolve) => { f.onFirst = resolve; });
    proc.stderr.on("data", (d) => { if (live) live.errTail = (live.errTail + d).slice(-2000); });
    proc.stdout.on("data", (chunk) => {
      f.onFirst?.(); f.onFirst = null;
      // only the active feeder is forwarded, and only once video is flowing (so audio and video start together)
      if (f === feeder && gateOpen && pcmOut?.writable) {
        pcmOut.write(chunk); lastPcmAt = Date.now();
        if (stats) stats.pcmBytes = (stats.pcmBytes || 0) + chunk.length;
        if (live) live.onMedia?.();
      }
    });
    if (live) {
      proc.stdio[3]?.on("data", (chunk) => { if (f === feeder) live.hub.push(chunk); });
      proc.stdio[3]?.on("error", () => {});
    }
    proc.on("error", (e) => { if (f === feeder && !live) finish(`audio-feeder-spawn-failed: ${e.message}`); });
    proc.on("exit", (code, sig) => {
      if (f !== feeder || f.retired || stopping) return;
      // A live feed ending is not a crash: the silence pump covers the gap and the live desk returns to the grid after 30 s.
      if (live) { log(`live feeder ended code=${code} signal=${sig} ${redact(live.errTail.trim().split("\n").pop() || "", env)}`); return; }
      finish(`audio-feeder-exited code=${code} signal=${sig}`);
    });
    return f;
  };
  let bedNow = { bed, lufs: bedLufs };
  if (audioPipe) feeder = spawnFeeder({ args: buildFeederArgs({ bed, bedLufs }), bed });
  // Silence pump (live feeds only): if the feed stalls, keep the encoder fed with silence so the picture and the RTMP session keep moving.
  const SILENCE_CHUNK_MS = 100;
  const silence = Buffer.alloc(Math.round(44100 * SILENCE_CHUNK_MS / 1000) * 4);
  const pump = audioPipe ? setInterval(() => {
    if (!feeder?.live || !gateOpen || !pcmOut?.writable) return;
    if (Date.now() - lastPcmAt > 1000 && pcmOut.writableLength < silence.length * 4) { pcmOut.write(silence); if (stats) stats.silenceChunks = (stats.silenceChunks || 0) + 1; }
  }, SILENCE_CHUNK_MS) : null;
  /** Hand the encoder's audio to a new feeder once it has warmed up (its -re start-up burst is discarded), at a chunk boundary. */
  const takeOver = async (f, { what, firstMs = 10_000 }) => {
    try {
      await Promise.race([f.firstData, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} produced no audio in ${firstMs / 1000} s`)), firstMs))]);
      await new Promise((r) => setTimeout(r, 1500));
      if (f.proc.exitCode !== null || f.proc.signalCode) throw new Error(`${what}'s feeder exited during warm-up`);
      if (done || stopping) throw new Error("unit is stopping");
    } catch (err) { retire(f); throw err; }
    const old = feeder; feeder = f; retire(old);
  };
  /** Swap the bed under a running encoder. While a live feed is on air, only remember the bed to return to. */
  const swapBed = async (bedPath, lufs) => {
    if (!audioPipe) throw new Error("swapBed needs a live unit");
    if (feeder?.live) { bedNow = { bed: bedPath, lufs }; return; }
    await takeOver(spawnFeeder({ args: buildFeederArgs({ bed: bedPath, bedLufs: lufs }), bed: bedPath }), { what: "new bed" });
    bedNow = { bed: bedPath, lufs };
  };
  /** #202: put an official feed on air (call only after officialFeeds.assertCanAir passed). Encoder and connection untouched. */
  const goLive = async ({ mediaUrl, httpHeaders, overlay, onMedia }) => {
    if (!audioPipe || !opts.pictureHub) throw new Error("goLive needs a live unit with a picture hub");
    const live = { hub: opts.pictureHub, onMedia, errTail: "" };
    opts.pictureHub.clear();
    await takeOver(spawnFeeder({ args: buildLiveFeederArgs({ mediaUrl, httpHeaders }), live }), { what: "live feed", firstMs: 20_000 });
    await page.evaluate((o) => window.ScoopRadio?.goLive?.(o), { ...overlay, picture: opts.pictureHub.url });
  };
  /** Back to the grid: our screen first, then the bed takes the audio back. */
  const endLive = async () => {
    await page?.evaluate(() => window.ScoopRadio?.endLive?.()).catch(() => {});
    opts.pictureHub?.clear();
    if (!feeder?.live || done || stopping) return;
    try { await takeOver(spawnFeeder({ args: buildFeederArgs({ bed: bedNow.bed, bedLufs: bedNow.lufs }), bed: bedNow.bed }), { what: "bed" }); }
    catch (err) { finish(`planned-restart`); throw err; }   // the restarted unit starts on the grid
  };

  let page = null, lastWritten = null, browser = null, timer = null, stallTimer = null, demoTimer = null, latest = null, lastFrameAt = Date.now();
  const stop = async (reason) => {
    if (reason) finish(reason);
    stopping = true; retire(feeder);
    clearInterval(pump); clearInterval(timer); clearInterval(stallTimer); clearInterval(demoTimer);
    try { ff.stdin.end(); } catch { /* already closed */ }
    // The looped bed never ends, so EOF on stdin alone leaves ffmpeg running: ask it to finish (SIGINT = clean trailer), SIGKILL after 5 s.
    try { if (ff.exitCode === null && !ff.signalCode) ff.kill("SIGINT"); } catch { /* gone */ }
    await new Promise((resolve) => {
      if (ff.exitCode !== null || ff.signalCode) return resolve();
      const kill = setTimeout(() => { try { ff.kill("SIGKILL"); } catch { /* gone */ } }, 5000);
      ff.once("exit", () => { clearTimeout(kill); resolve(); });
    });
    try { await browser?.close(); } catch { /* already gone */ }
    finish("stopped");
  };

  try {
    const { chromium } = loadPlaywright();
    const flags = ["--hide-scrollbars", "--mute-audio", "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding", "--force-device-scale-factor=1"];
    if (process.getuid?.() === 0) flags.push("--no-sandbox");
    // RADIO_PLAYOUT_CHROME=system uses the installed Google Chrome; a path uses that executable; unset = Playwright's Chromium.
    const chromeEnv = env.RADIO_PLAYOUT_CHROME;
    const browserOpts = { headless: true, args: flags };
    if (chromeEnv === "system") browserOpts.channel = "chrome";
    else if (chromeEnv) browserOpts.executablePath = chromeEnv;
    browser = await chromium.launch(browserOpts);
    browser.on("disconnected", () => finish("browser-disconnected"));
    page = await browser.newPage({ viewport: { width: VIDEO.width, height: VIDEO.height }, deviceScaleFactor: 1 });
    page.on("crash", () => finish("page-crashed"));
    const cdp = await page.context().newCDPSession(page);
    cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
      latest = Buffer.from(data, "base64");
      lastFrameAt = Date.now();
      if (stats) stats.framesCaptured++;
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
    await page.goto(pageUrl, { waitUntil: "load" });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: VIDEO.width, maxHeight: VIDEO.height, everyNthFrame: 1 });

    // Pacing writer. setInterval drifts, so schedule against an absolute 30 Hz grid.
    const period = 1000 / VIDEO.fps;
    let next = Date.now();
    timer = setInterval(() => {
      if (!latest || ff.stdin.destroyed || !ff.stdin.writable) return;
      let due = 0;
      while (next <= Date.now()) { next += period; due++; }
      if (!due) return;
      // ffmpeg is behind: skip the repeats instead of queueing them (queued frames would add latency).
      if (ff.stdin.writableLength > latest.length * 3) { if (stats) stats.slotsSkippedBackpressure += due; return; }
      ff.stdin.write(latest);
      gateOpen = true;
      if (stats && latest === lastWritten) stats.framesRepeated++;   // no new Chromium frame since the last slot
      lastWritten = latest;
      // due > 1 means the event loop itself was late; ffmpeg's fps filter re-fills those slots from wallclock stamps.
      if (stats) { stats.framesWritten++; stats.slotsSkippedLate += due - 1; }
    }, 5);

    stallTimer = setInterval(() => {
      if (Date.now() - lastFrameAt > STALL_MS) finish(`screen-stalled (no frame for ${STALL_MS} ms)`);
    }, 5000);

    if (demoCycleSec > 0) {
      let i = 0;
      demoTimer = setInterval(() => {
        page.evaluate((s) => window.ScoopRadio?.scene(s), DEMO_SCENES[++i % DEMO_SCENES.length]).catch(() => {});
      }, demoCycleSec * 1000);
    }
    return { exited, stop, page, swapBed: audioPipe ? swapBed : undefined, goLive: audioPipe ? goLive : undefined, endLive: audioPipe ? endLive : undefined,
      get bed() { return feeder?.bed ?? bedNow.bed; }, get live() { return !!feeder?.live; } };
  } catch (err) {
    await stop();
    throw err;
  }
}

/**
 * Run the playout until `seconds` elapse (file mode) or `signal` aborts.
 * @param {{ out?: string, seconds?: number, musicDir?: string, stateFile?: string, baseUrl?: string,
 *           demoCycleSec?: number, env?: object, log?: Function, signal?: AbortSignal, maxRestarts?: number }} o
 */
export async function runPlayout(o = {}) {
  const env = o.env || process.env;
  const log = o.log || ((m) => console.log(`📻 playout: ${m}`));
  const target = resolveTarget({ out: o.out, segmentsDir: o.segmentsDir, env });          // throws before anything is spawned
  if (target.kind === "file" && !o.seconds) throw new Error("--seconds is required with --out");
  if (target.kind === "segments") fs.mkdirSync(target.dir, { recursive: true });
  if (o.forceDaypartCycleSec && target.kind === "rtmp") throw new Error("--force-daypart-cycle is a test option and cannot be used with RTMP");
  if (o.liveNow && target.kind === "rtmp") throw new Error("--live-now is a rehearsal option and cannot be used with RTMP");
  if (o.liveNow && target.kind === "file") throw new Error("--live-now needs --segments-dir (a live unit); --out writes a file with a fixed bed");
  let liveNowEvent = null;
  if (o.liveNow) {
    const t = Date.now();
    const r = validateEvent({ id: `rehearsal:${t}`, feed: o.liveNow.feed, url: o.liveNow.url, title: o.liveNow.title || "Live rehearsal",
      start: new Date(t).toISOString(), end: new Date(t + (o.liveNow.minutes || 5) * 60_000).toISOString() });
    if (!r.event) throw new Error(`--live-now refused: ${r.error}`);
    liveNowEvent = r.event;
  }
  const live = target.kind !== "file";
  const stats = { framesCaptured: 0, framesWritten: 0, framesRepeated: 0, pcmBytes: 0, slotsSkippedBackpressure: 0, slotsSkippedLate: 0 };

  let server = null, origin = o.baseUrl, stateUrl = "/api/radio/state.json";
  if (!origin) {
    server = await startScreenServer({ stateFile: o.stateFile });
    origin = server.origin;
  }
  const pageUrl = screenUrl(origin, new URL(stateUrl, origin).toString());
  const dir = o.musicDir || musicDir();
  let current = { daypart: null };
  // Test only (--force-daypart-cycle N): step through the four dayparts every N s by shifting the clock into each one.
  const t0 = Date.now();
  const DEMO_ET_MINUTES = { morning: 6 * 60, markets: 12 * 60, evening: 20 * 60, overnight: 2 * 60 };
  const clock = () => {
    const now = new Date();
    if (!o.forceDaypartCycleSec) return now;
    const want = DAYPARTS[Math.floor((Date.now() - t0) / (o.forceDaypartCycleSec * 1000)) % DAYPARTS.length];
    return new Date(now.getTime() + (DEMO_ET_MINUTES[want] - easternMinutes(now)) * 60_000);
  };

  // ── #202 live events desk: dark unless RADIO_LIVE_ENABLED=true (or a --live-now rehearsal) ──
  const deskOn = live && (liveEnabled(env) || !!liveNowEvent);
  const pictureHub = deskOn ? await startPictureHub() : null;
  let desk = null, deskTimer = null, calCache = { at: 0, events: [] };
  if (deskOn) {
    const liveLog = createLiveLog({ dir: liveLogDir(env) });
    const calendar = async () => {
      if (liveNowEvent) return [liveNowEvent];
      if (Date.now() - calCache.at < 60_000) return calCache.events;   // manual file re-read every minute
      const man = loadManualEvents(eventsFile(env));
      for (const r of man.rejected) log(`live calendar: rejected ${JSON.stringify(r.raw ?? "")}: ${r.error}`);
      if (Date.now() - (calCache.pubAt || 0) > 30 * 60_000) {
        calCache.pub = await fetchPublisherEvents({ log }).catch((e) => { log(`live calendar: publisher schedules failed (${e.message})`); return []; });
        calCache.pubAt = Date.now();
      }
      calCache = { ...calCache, at: Date.now(), events: mergeCalendar(man.events, calCache.pub || []) };
      return calCache.events;
    };
    desk = createLiveDesk({ unit: () => current.unit || null, calendar, probe: (u) => probeFeed(u), log: liveLog, say: log });
    deskTimer = setInterval(() => { desk.tick().catch((e) => log(`live desk: ${redact(e.message, env)}`)); }, TICK_MS);
    log(`live desk on${liveNowEvent ? ` (rehearsal: ${liveNowEvent.publisher}, ${Math.round((liveNowEvent.end - liveNowEvent.start) / 60000)} min)` : ""}; log ${liveLog.dir}`);
  }

  const start = async () => {
    await desk?.unitLost();
    const { bed, daypart, fallback } = chooseBed(clock(), { dir });
    const bedLufs = await measureIntegrated(bed, { ffmpeg: o.ffmpeg });
    log(`daypart=${daypart}${fallback ? " (EMPTY - fell back to another daypart's bed)" : ""} bed=${path.basename(bed)} bedLufs=${bedLufs ?? "unmeasured (loudnorm fallback)"} target=${target.kind}`);
    current = { daypart };
    return startUnit({ target, bed, bedLufs, seconds: o.seconds, pageUrl, log, demoCycleSec: o.demoCycleSec, env, stats, ffmpeg: o.ffmpeg, pictureHub });
  };

  const ac = new AbortController();
  o.signal?.addEventListener("abort", () => ac.abort(), { once: true });
  // Live mode: the bed is fixed per unit, so a daypart change is a planned restart onto the new bed.
  let swapping = false;
  const dp = live ? setInterval(async () => {
    if (swapping || daypartAt(clock()) === current.daypart) return;
    swapping = true;
    try {
      const next = chooseBed(clock(), { dir });
      const bedLufs = await measureIntegrated(next.bed, { ffmpeg: o.ffmpeg });
      if (!current.unit?.swapBed) throw new Error("unit cannot swap live");
      await current.unit.swapBed(next.bed, bedLufs);
      current.daypart = next.daypart;
      log(`daypart changed to ${next.daypart}${next.fallback ? " (EMPTY - fallback bed)" : ""}: bed swapped to ${path.basename(next.bed)} bedLufs=${bedLufs ?? "unmeasured"} (encoder and connection untouched)`);
    } catch (err) {
      log(`daypart changed; live bed swap failed (${redact(err.message, env)}); doing a planned restart`);
      current.unit?.stop("planned-restart");
    } finally { swapping = false; }
  }, DAYPART_CHECK_MS) : null;
  const statsTimer = live ? setInterval(() => log(`stats ${JSON.stringify(stats)} rssMB=${Math.round(process.memoryUsage().rss / 1048576)}`), 60_000) : null;
  const wrapped = async () => { const u = await start(); current.unit = u; return u; };

  try {
    const res = await supervise(wrapped, {
      maxRestarts: o.maxRestarts ?? (live ? Infinity : 0),
      signal: ac.signal, log: (m) => log(m),
    });
    return { ...res, stats, target: target.kind === "file" ? target.path : target.kind === "segments" ? target.dir : "rtmp" };
  } finally {
    clearInterval(dp); clearInterval(statsTimer); clearInterval(deskTimer);
    await desk?.stop().catch(() => {});
    await pictureHub?.close();
    await server?.close();
  }
}
