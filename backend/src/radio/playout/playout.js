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
import { pickBed, daypartAt, easternMinutes, listBeds, listFiles, musicDir, bedCredit, DAYPARTS } from "../musicLibrary.js";
import { ensureProceduralBed } from "../proceduralBed.js";
import { buildFfmpegArgs, buildFeederArgs, buildMediaFrameArgs, splitJpegs, VIDEO } from "./ffmpegArgs.js";
import { measureIntegrated } from "./loudness.js";
import { resolveTarget, redact } from "./outputTarget.js";
import { startScreenServer, screenUrl, programmeUrl } from "./screenServer.js";
import { supervise } from "./watchdog.js";

export const STALL_MS = 30_000;
const AUDIO_TARGET = -16;
const MEDIA_LEAD_MS = 150;  // a file's frames reach the encoder sooner than the screen capture's: start them this much later in the file   // produced programme audio is mastered at the target: the feeder applies 0 dB and the limiter          // no new screencast frame for this long => the screen is dead
export const DAYPART_CHECK_MS = 30_000;
const DEMO_SCENES = ["news", "markets", "explains", "weather", "next", "music"];

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const name of ["playwright-core", "playwright"]) {
    try { return require(name); } catch { /* try next */ }
  }
  throw new Error("playwright-core is not installed; use the playout image (see Dockerfile.dev)");
}

/**
 * Today's bed for `now`; if that daypart has no CLEARED bed, any other daypart's, flagged as a fallback; with
 * none cleared anywhere, the procedural bed (#208: unmanifested files never air, not even as a last resort).
 */
export function chooseBed(now = new Date(), { dir = musicDir(), random = Math.random, procedural = ensureProceduralBed } = {}) {
  const daypart = daypartAt(now);
  const bed = pickBed(now, { dir, random });
  if (bed) return { bed, daypart, fallback: false };
  for (const other of DAYPARTS) {
    const beds = listBeds(other, dir);
    if (beds.length) return { bed: beds[Math.floor(random() * beds.length) % beds.length], daypart, fallback: true };
  }
  if (!procedural) throw new Error(`no cleared music bed under ${dir}`);
  const refused = DAYPARTS.reduce((n, d) => n + listFiles(d, dir).length, 0);
  return { bed: procedural(dir), daypart, fallback: true, procedural: true, refused };
}

/** Put the airing bed's "Music: Artist – Track" credit on the screen's music scene (none for the procedural bed). */
export async function showBedCredit(page, bed, dir) {
  const credit = bed ? bedCredit(bed, dir) : null;
  try { await page?.evaluate((c) => window.setMusicCredit?.(c), credit); } catch { /* the page is reloading; the next swap sets it */ }
  return credit;
}

/** RADIO_PROGRAMME_AV_DELAY_MS: how far programme sound is held back to meet the picture (default 300, measured per host). */
export const avDelayMs = (env = process.env) => { const n = Number(env.RADIO_PROGRAMME_AV_DELAY_MS); return Number.isFinite(n) && n >= 0 && n <= 5000 ? n : 300; };

/** ffmpeg prints this when the output can no longer be written (dead RTMP socket, full disk). */
export const isFatalMuxError = (text) => /Error (submitting a packet to the muxer|muxing a packet)/.test(String(text));

/** Start one Chromium + ffmpeg unit. Resolves once both are running. */
export async function startUnit(opts) {
  const { target, bed, bedLufs, seconds, pageUrl, log = () => {}, demoCycleSec = 0, env = process.env, stats } = opts;
  const audioPipe = target.kind !== "file";   // live units take the bed through a swappable feeder (see buildFfmpegArgs)
  const args = buildFfmpegArgs({ target, bed, bedLufs, seconds, audioPipe });
  const ff = spawn(opts.ffmpeg || "ffmpeg", args, { stdio: audioPipe ? ["pipe", "ignore", "pipe", "pipe"] : ["pipe", "ignore", "pipe"] });
  let ffErr = "";
  ff.stderr.on("data", (d) => {
    ffErr = (ffErr + d).slice(-4000);
    // Do not wait for ffmpeg to exit: against a dead socket it retries the trailer and close for ~10 s more. Kill it now and let the watchdog reconnect.
    if (!done && isFatalMuxError(d)) {
      log(`ffmpeg output failed: ${redact(String(d).trim().split("\n")[0], env)}; killing it so the watchdog can reconnect`);
      try { ff.kill("SIGKILL"); } catch { /* gone */ }
      finish("ffmpeg-output-error");
    }
  });
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
  // fromMs: a programme part that starts at that instant; the feeder seeks to "now" in it, so wherever it starts it is in step with the clock
  const spawnFeeder = (bedPath, lufs, fromMs = null) => {
    // The captured picture reaches the encoder later than the feeder's sound (screencast + pacing); delay the programme sound to match.
    const ssSec = fromMs == null ? null : (Date.now() - fromMs - avDelayMs(env)) / 1000;
    const proc = spawn(opts.ffmpeg || "ffmpeg", buildFeederArgs({ bed: bedPath, bedLufs: lufs, ssSec }), { stdio: ["ignore", "pipe", "pipe"] });
    const f = { proc, bed: bedPath, retired: false };
    f.firstData = new Promise((resolve) => { f.onFirst = resolve; });
    proc.stderr.on("data", () => {});
    proc.stdout.on("data", (chunk) => {
      f.onFirst?.(); f.onFirst = null;
      // only the active feeder is forwarded, and only once video is flowing (so audio and video start together)
      if (f === feeder && gateOpen && pcmOut?.writable) { pcmOut.write(chunk); if (stats) stats.pcmBytes = (stats.pcmBytes || 0) + chunk.length; }
    });
    proc.on("error", (e) => { if (f === feeder) finish(`audio-feeder-spawn-failed: ${e.message}`); });
    proc.on("exit", (code, sig) => { if (f === feeder && !f.retired && !stopping) finish(`audio-feeder-exited code=${code} signal=${sig}`); });
    return f;
  };
  if (audioPipe) feeder = opts.feed ? spawnFeeder(opts.feed.file, opts.feed.lufs, opts.feed.from) : spawnFeeder(bed, bedLufs);
  /** Swap the bed under a running encoder. The new feeder warms up (its -re start-up burst is discarded), then takes over at a chunk boundary. */
  const swapBed = async (bedPath, lufs, fromMs = null) => {
    if (!audioPipe) throw new Error("swapBed needs a live unit");
    const f = spawnFeeder(bedPath, lufs, fromMs);
    try {
      await Promise.race([f.firstData, new Promise((_, rej) => setTimeout(() => rej(new Error("new bed produced no audio in 10 s")), 10_000))]);
      await new Promise((r) => setTimeout(r, 1500));
      if (f.proc.exitCode !== null || f.proc.signalCode) throw new Error("new bed's feeder exited during warm-up");
      if (done || stopping) throw new Error("unit is stopping");
    } catch (err) { retire(f); throw err; }
    const old = feeder; feeder = f; retire(old);
  };

  let lastWritten = null, browser = null, timer = null, stallTimer = null, demoTimer = null, latest = null, lastFrameAt = Date.now();
  // ── encoder-played media (films, episodes): its frames replace the screen capture while it runs ──
  let media = null;   // { proc, tag, frame }
  const clearMedia = () => { const m = media; media = null; if (m) { try { m.proc.kill("SIGKILL"); } catch { /* gone */ } } };
  const setMedia = ({ file, ssSec, tag }) => {
    clearMedia();
    const proc = spawn(opts.ffmpeg || "ffmpeg", buildMediaFrameArgs({ file, ssSec }), { stdio: ["ignore", "pipe", "pipe"] });
    const m = { proc, tag, frame: null };
    let buf = Buffer.alloc(0), err = "";
    proc.stdout.on("data", (d) => { if (media !== m) return; const r = splitJpegs(Buffer.concat([buf, d])); buf = r.rest; if (r.frames.length) m.frame = Buffer.from(r.frames.at(-1)); });
    proc.stderr.on("data", (d) => { err = (err + d).slice(-500); });
    proc.on("exit", (code) => { if (media === m) { media = null; if (code) log(`media ${tag} ended (exit ${code}): ${err.trim().split("\n").pop() || ""}`); } });
    proc.on("error", (e) => { if (media === m) { media = null; log(`media ${tag} failed: ${e.message}`); } });
    media = m;
  };
  const stop = async (reason) => {
    if (reason) finish(reason);
    stopping = true; retire(feeder); clearMedia();
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
      const frame = media?.frame || latest;   // encoder-played media wins while it has frames
      if (!frame || ff.stdin.destroyed || !ff.stdin.writable) return;
      let due = 0;
      while (next <= Date.now()) { next += period; due++; }
      if (!due) return;
      // ffmpeg is behind: skip the repeats instead of queueing them (queued frames would add latency).
      if (ff.stdin.writableLength > frame.length * 3) { if (stats) stats.slotsSkippedBackpressure += due; return; }
      ff.stdin.write(frame);
      gateOpen = true;
      if (stats && frame === lastWritten) stats.framesRepeated++;   // no new frame since the last slot
      lastWritten = frame;
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
    return { exited, stop, page, swapBed: audioPipe ? swapBed : undefined, setMedia, clearMedia, get mediaTag() { return media?.tag ?? null; }, get bed() { return feeder?.bed ?? bed; } };
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
  const target = resolveTarget({ out: o.out, segmentsDir: o.segmentsDir, segmentKeep: o.segmentKeep || 10, env });          // throws before anything is spawned
  if (target.kind === "file" && !o.seconds) throw new Error("--seconds is required with --out");
  if (target.kind === "segments") fs.mkdirSync(target.dir, { recursive: true });
  if (o.forceDaypartCycleSec && target.kind === "rtmp") throw new Error("--force-daypart-cycle is a test option and cannot be used with RTMP");
  const live = target.kind !== "file";
  const stats = { framesCaptured: 0, framesWritten: 0, framesRepeated: 0, pcmBytes: 0, slotsSkippedBackpressure: 0, slotsSkippedLate: 0 };

  const progDir = o.programmeDir ? path.resolve(o.programmeDir) : null;
  if (progDir && !live) throw new Error("--programme needs a live target (RTMP or --segments-dir): its audio is swapped in through the feeder");
  let server = null, origin = progDir ? null : o.baseUrl, stateUrl = "/api/radio/state.json";
  if (!origin) {
    server = await startScreenServer({ stateFile: o.stateFile, programmeDir: progDir });
    origin = server.origin;
  }
  const pageUrl = progDir ? programmeUrl(origin) : screenUrl(origin, new URL(stateUrl, origin).toString());

  // ── programme mode: which produced audio part should be on air now ──
  let progCache = { mtime: 0, prog: null };
  const readProgramme = () => {
    try {
      const f = path.join(progDir, "programme.json");
      const m = fs.statSync(f).mtimeMs;
      if (m !== progCache.mtime) progCache = { mtime: m, prog: JSON.parse(fs.readFileSync(f, "utf8")) };
    } catch { /* not produced yet, or mid-write: keep the last good copy */ }
    return progCache.prog;
  };
  const partNow = (t = Date.now()) => {
    const p = progDir && readProgramme();
    if (!p || !Array.isArray(p.audio) || t >= p.endsAt) return null;
    const part = p.audio.filter((a) => a.from <= t).at(-1);
    return part ? { file: path.join(progDir, part.file), lufs: AUDIO_TARGET, from: part.from } : null;
  };
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
    const { bed, daypart, fallback, procedural, refused } = chooseBed(clock(), { dir });
    const bedLufs = await measureIntegrated(bed, { ffmpeg: o.ffmpeg });
    log(`daypart=${daypart}${procedural ? ` (NO CLEARED BED: procedural fallback; ${refused} file(s) refused for want of a manifest entry, see docs/radio/music.md)` : fallback ? " (EMPTY - fell back to another daypart's bed)" : ""} bed=${path.basename(bed)} bedLufs=${bedLufs ?? "unmeasured (loudnorm fallback)"} target=${target.kind}`);
    const feed = partNow();
    current = { daypart, feedFile: feed?.file || null };
    if (feed) log(`programme audio on air: ${path.basename(feed.file)} from ${((Date.now() - feed.from) / 1000).toFixed(1)} s`);
    return startUnit({ target, bed, bedLufs, feed, seconds: o.seconds, pageUrl, log, demoCycleSec: o.demoCycleSec, env, stats, ffmpeg: o.ffmpeg });
  };

  const ac = new AbortController();
  o.signal?.addEventListener("abort", () => ac.abort(), { once: true });
  // Live mode: the bed is fixed per unit, so a daypart change is a planned restart onto the new bed.
  let swapping = false;
  // Programme: swap the feeder onto each produced part at its start, and end the run when the programme ends.
  let progSwapping = false;
  const progTimer = progDir ? setInterval(async () => {
    const p = readProgramme();
    if (p && Date.now() >= p.endsAt) { log("programme ended; stopping"); ac.abort(); return; }
    // films and episodes: played by the encoder from the file, in step with the programme clock
    if (p && current.unit?.setMedia) {
      const now = Date.now();
      let cue = null, nextAt = Infinity;
      for (const c of p.cues || []) { if (c.overlay) continue; if (c.at <= now) cue = c; else { nextAt = c.at; break; } }
      const want = cue && (cue.scene === "film" || cue.scene === "feature") && cue.data?.t0 ? cue : null;
      const tag = want ? `${want.scene}@${want.at}` : null;
      if (want && current.unit.mediaTag !== tag) {
        const src = want.scene === "feature" ? (p.featurePath || path.join(progDir, "feature.webm")) : (p.filmPath || path.join(progDir, "film.webm"));
        const file = fs.existsSync(src) ? src : path.join(progDir, `${want.scene}.webm`);
        const ssSec = (now - want.data.t0 - avDelayMs(env) + MEDIA_LEAD_MS) / 1000;
        if (fs.existsSync(file) && now < nextAt - 500) { current.unit.setMedia({ file, ssSec, tag }); log(`media on air: ${path.basename(file)} from ${ssSec.toFixed(1)} s`); }
      } else if (!want && current.unit.mediaTag) { current.unit.clearMedia(); log("media off air; back to the screen"); }
    }
    const feed = partNow();
    if (!feed || progSwapping || !current.unit?.swapBed || feed.file === current.feedFile) return;
    progSwapping = true;
    try {
      await current.unit.swapBed(feed.file, feed.lufs, feed.from);
      current.feedFile = feed.file;
      log(`programme audio switched to ${path.basename(feed.file)} (part started ${((Date.now() - feed.from) / 1000).toFixed(1)} s ago)`);
    } catch (err) { log(`programme audio swap failed (${redact(err.message, env)}); retrying`); }
    finally { progSwapping = false; }
  }, 250) : null;

  const dp = live ? setInterval(async () => {
    if (current.feedFile) return;   // programme audio carries its own beds
    if (swapping || daypartAt(clock()) === current.daypart) return;
    swapping = true;
    try {
      const next = chooseBed(clock(), { dir });
      const bedLufs = await measureIntegrated(next.bed, { ffmpeg: o.ffmpeg });
      if (!current.unit?.swapBed) throw new Error("unit cannot swap live");
      await current.unit.swapBed(next.bed, bedLufs);
      current.daypart = next.daypart;
      showBedCredit(current.unit.page, next.bed, dir);
      log(`daypart changed to ${next.daypart}${next.fallback ? " (EMPTY - fallback bed)" : ""}: bed swapped to ${path.basename(next.bed)} bedLufs=${bedLufs ?? "unmeasured"} (encoder and connection untouched)`);
    } catch (err) {
      log(`daypart changed; live bed swap failed (${redact(err.message, env)}); doing a planned restart`);
      current.unit?.stop("planned-restart");
    } finally { swapping = false; }
  }, DAYPART_CHECK_MS) : null;
  const statsTimer = live ? setInterval(() => log(`stats ${JSON.stringify(stats)} rssMB=${Math.round(process.memoryUsage().rss / 1048576)}`), 60_000) : null;
  const wrapped = async () => { const u = await start(); current.unit = u; if (!current.feedFile) showBedCredit(u.page, u.bed, dir); return u; };

  try {
    const res = await supervise(wrapped, {
      maxRestarts: o.maxRestarts ?? (live ? Infinity : 0),
      signal: ac.signal, log: (m) => log(m),
    });
    return { ...res, stats, target: target.kind === "file" ? target.path : target.kind === "segments" ? target.dir : "rtmp" };
  } finally {
    clearInterval(dp); clearInterval(statsTimer); clearInterval(progTimer);
    await server?.close();
  }
}
