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
import { buildFfmpegArgs, VIDEO } from "./ffmpegArgs.js";
import { measureIntegrated } from "./loudness.js";
import { resolveTarget, redact } from "./outputTarget.js";
import { startScreenServer, screenUrl } from "./screenServer.js";
import { supervise } from "./watchdog.js";

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
  const args = buildFfmpegArgs({ target, bed, bedLufs, seconds });
  const ff = spawn(opts.ffmpeg || "ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
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

  let lastWritten = null, browser = null, timer = null, stallTimer = null, demoTimer = null, latest = null, lastFrameAt = Date.now();
  const stop = async () => {
    clearInterval(timer); clearInterval(stallTimer); clearInterval(demoTimer);
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
    const page = await browser.newPage({ viewport: { width: VIDEO.width, height: VIDEO.height }, deviceScaleFactor: 1 });
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
    return { exited, stop, page };
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
  const live = target.kind !== "file";
  const stats = { framesCaptured: 0, framesWritten: 0, framesRepeated: 0, slotsSkippedBackpressure: 0, slotsSkippedLate: 0 };

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

  const start = async () => {
    const { bed, daypart, fallback } = chooseBed(clock(), { dir });
    const bedLufs = await measureIntegrated(bed, { ffmpeg: o.ffmpeg });
    log(`daypart=${daypart}${fallback ? " (EMPTY - fell back to another daypart's bed)" : ""} bed=${path.basename(bed)} bedLufs=${bedLufs ?? "unmeasured (loudnorm fallback)"} target=${target.kind}`);
    current = { daypart };
    return startUnit({ target, bed, bedLufs, seconds: o.seconds, pageUrl, log, demoCycleSec: o.demoCycleSec, env, stats, ffmpeg: o.ffmpeg });
  };

  const ac = new AbortController();
  o.signal?.addEventListener("abort", () => ac.abort(), { once: true });
  // Live mode: the bed is fixed per unit, so a daypart change is a planned restart onto the new bed.
  const dp = live ? setInterval(() => {
    if (daypartAt(clock()) !== current.daypart) { log("daypart changed; restarting onto the new bed"); current.unit?.stop(); }
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
    clearInterval(dp); clearInterval(statsTimer);
    await server?.close();
  }
}
