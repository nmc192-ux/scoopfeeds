#!/usr/bin/env node
/**
 * autoair.mjs - put one produced hour on air with nobody at the desk.
 *
 *   produce  ->  air check  ->  YouTube broadcast (create, bind, thumbnail)  ->  at H-16 min: pause the 24/7
 *   radio, start the programme playout  ->  take the broadcast live once the signal arrives  ->  watch the
 *   stream until the end  ->  complete the broadcast, bring the 24/7 radio back.
 *
 * Gates, in order (any one stops the run before anything is public):
 *   ~/scoopfeeds-radio/PAUSE exists          -> skip this hour (DrJ's kill switch: `touch` it / `rm` it)
 *   the producer fails or the air check fails -> nothing airs; the 24/7 radio keeps the channel
 *   RADIO_AUTOAIR_ENABLED is not exactly "1" -> REHEARSAL: produce and check only, then stop
 *   the playout's own RTMP gates               -> RADIO_PLAYOUT_ENABLED=true and RADIO_STREAM_KEY (never printed)
 * The scope of this unattended loop is DrJ's standing approval: see docs/radio/autonomous-newsroom.md.
 * Platform safety (#208, docs/radio/safety.md): films and episodes air only when cleared (filmClearance.js);
 * every broadcast description carries the music credits, whole or linked; the X text is written beside it;
 * PAUSE appearing mid-hour (the standing watchdog) ends the hour and keeps the 24/7 radio off.
 *
 *   node src/radio/programme/autoair.mjs --hour next --out ~/scoopfeeds-radio/air/auto \
 *     --music-dir ~/scoopfeeds-radio/music [--film <file|dir>] [--feature <file>] [--feature-title "..."] [--thumbnail <jpg>]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { airCheck } from "./airCheck.js";
import { makeYouTubeLive, liveConfigured, goLiveWhenActive } from "../live/youtubeLive.js";
import { pickClearedFilm } from "../safety/filmClearance.js";
import { factualTitle, xBroadcastText, withCredits } from "../safety/broadcastCopy.js";
import { creditLines } from "../musicManifest.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, "../../..");
const HOME = os.homedir();
const tilde = (p) => (p ? path.resolve(String(p).replace(/^~/, HOME)) : p);

const { values: v } = parseArgs({ options: {
  hour: { type: "string", default: "next" }, out: { type: "string" }, "music-dir": { type: "string" },
  film: { type: "string" }, feature: { type: "string" }, "feature-title": { type: "string" }, thumbnail: { type: "string" },
  title: { type: "string" }, "lead-min": { type: "string", default: "16" }, "fake-voice": { type: "boolean" }, "fake-writer": { type: "boolean" },
} });

const env = process.env;
const BASE = tilde(env.RADIO_BASE_DIR || "~/scoopfeeds-radio");
const LIVE_AGENT = env.RADIO_AUTOAIR_247_LABEL || "com.scoopfeeds.radio";
const UID = process.getuid?.() ?? 501;

/** The next top of the hour at least 25 minutes away: a run started at 8:15 pm is for 9 pm. */
export function nextHour(nowMs, minLeadMin = 25) {
  const h = new Date(nowMs + minLeadMin * 60_000);
  if (h.getUTCMinutes() || h.getUTCSeconds() || h.getUTCMilliseconds()) h.setUTCHours(h.getUTCHours() + 1, 0, 0, 0);
  return h.getTime();
}
/** DrJ's kill switch: `~/scoopfeeds-radio/PAUSE` (under RADIO_BASE_DIR) stops every run while it exists. */
export function isPaused(baseDir) {
  return fs.existsSync(path.join(baseDir, "PAUSE"));
}
/** Airing (anything public) needs RADIO_AUTOAIR_ENABLED to be literally "1"; everything else is a rehearsal. */
export function autoairLive(e = process.env) {
  return e.RADIO_AUTOAIR_ENABLED === "1";
}
/** A file, or the newest video in a directory. */
export function newestVideo(p) {
  if (!p || !fs.existsSync(p)) return null;
  if (!fs.statSync(p).isDirectory()) return p;
  const vids = fs.readdirSync(p).filter((f) => /\.(mp4|mov|m4v|webm)$/i.test(f)).map((f) => path.join(p, f));
  return vids.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
}

async function main() {
  const hourStart = v.hour === "next" ? nextHour(Date.now()) : Date.parse(v.hour);
  if (!Number.isFinite(hourStart)) { console.error("--hour must be 'next' or an ISO time"); process.exit(2); }
  const stamp = new Date(hourStart).toISOString().slice(0, 13).replace(/[:]/g, "");
  const out = tilde(v.out || path.join(BASE, "air", stamp));
  fs.mkdirSync(out, { recursive: true });
  const logFile = path.join(out, "autoair.log");
  const status = { hourStart, hour: new Date(hourStart).toISOString(), startedAt: Date.now(), stage: "start", alerts: [] };
  const saveStatus = () => { try { fs.writeFileSync(path.join(out, "status.json"), JSON.stringify(status, null, 1)); } catch { /* best effort */ } };
  const log = (m) => { const line = `${new Date().toISOString()} 📡 autoair: ${m}`; console.log(line); try { fs.appendFileSync(logFile, line + "\n"); } catch { /* */ } };
  const alert = makeAlert({ log, status, saveStatus });
  const stage = (s) => { status.stage = s; saveStatus(); log(`— ${s}`); };

  // ── gate 0: kill switch, single run ──
  if (isPaused(BASE)) { log(`${path.join(BASE, "PAUSE")} exists: this hour is skipped`); stage("paused"); return; }
  const lock = path.join(BASE, "autoair.lock");
  try { fs.writeFileSync(lock, String(process.pid), { flag: "wx" }); }
  catch {
    const pid = Number(fs.readFileSync(lock, "utf8"));
    let alive = false; try { process.kill(pid, 0); alive = true; } catch { /* stale */ }
    if (alive) { log(`another auto-air run (pid ${pid}) is in progress; exiting`); return; }
    fs.writeFileSync(lock, String(process.pid));
  }
  const unlock = () => { try { fs.unlinkSync(lock); } catch { /* */ } };
  process.on("exit", unlock);

  const live = autoairLive(env);
  log(`hour ${status.hour} (${fmtPkt(hourStart)} Karachi) -> ${out}; ${live ? "LIVE run" : "REHEARSAL (RADIO_AUTOAIR_ENABLED is not 1: nothing goes out)"}`);

  // ── 1. produce ── films and episodes only when their copyright clearance is known (#208)
  stage("producing");
  const ytApi = liveConfigured(env) ? makeYouTubeLive({ env }) : null;
  const film = await pickClearedFilm(tilde(v.film || env.RADIO_AUTOAIR_FILM), { yt: ytApi, log });
  const feature = await pickClearedFilm(tilde(v.feature || env.RADIO_AUTOAIR_FEATURE), { yt: ytApi, log });
  status.film = film ? path.basename(film) : null; status.feature = feature ? path.basename(feature) : null;
  const ft = factualTitle(v["feature-title"] || env.RADIO_AUTOAIR_FEATURE_TITLE || null, null);
  if (ft.replaced) log(`feature title dropped (${ft.why.join(", ")})`);
  const featureTitle = ft.title;
  const pargs = [path.join(HERE, "produce.mjs"), "--hour", new Date(hourStart).toISOString(), "--out", out,
    "--music-dir", tilde(v["music-dir"] || env.RADIO_MUSIC_DIR || path.join(BASE, "music"))];
  if (film) pargs.push("--film", film);
  if (feature) pargs.push("--feature", feature, ...(featureTitle ? ["--feature-title", featureTitle] : []));
  if (v["fake-voice"]) pargs.push("--fake-voice");
  if (v["fake-writer"]) pargs.push("--fake-writer");
  const leadMs = Number(v["lead-min"]) * 60_000;
  const produceBy = hourStart - leadMs - 60_000;
  const code = await runLogged(process.execPath, pargs, { cwd: BACKEND, logFile, killAt: produceBy, log });
  if (code !== 0) { await alert(`the producer failed (exit ${code}) for the ${fmtPkt(hourStart)} hour. Nothing aired; the 24/7 radio stays on. Log: ${logFile}`); stage("produce-failed"); process.exitCode = 1; return; }

  // ── 2. air check ──
  stage("checking");
  const check = airCheck(out, { hourStart });
  status.check = check; saveStatus();
  log(`air check: ${check.ok ? "PASS" : "FAIL"} ${JSON.stringify(check.stats)}${check.problems.length ? ` problems: ${check.problems.join("; ")}` : ""}`);
  if (!check.ok) { await alert(`the ${fmtPkt(hourStart)} hour failed its air check and did not air: ${check.problems.join("; ")}`); stage("check-failed"); process.exitCode = 1; return; }

  function prog0() { try { return JSON.parse(fs.readFileSync(path.join(out, "programme.json"), "utf8")); } catch { return {}; } }
  if (!live) { stage("rehearsal-done"); log("rehearsal complete: the hour is produced and passed its check. Set RADIO_AUTOAIR_ENABLED=1 to air it."); return; }

  // ── 3. YouTube broadcast ──
  let yt = null, broadcastId = null, streamId = null;
  // #208: factual titles; the exact music credits (whole, or a link to the full list) on YouTube and on X
  const defaultTitle = `ScoopFeeds Radio LIVE · The news, compared · ${fmtDate(hourStart)}`;
  const tt = factualTitle(v.title || env.RADIO_AUTOAIR_TITLE || defaultTitle, defaultTitle);
  if (tt.replaced) log(`title replaced with the default (${tt.why.join(", ")})`);
  const title = tt.title;
  const credits = creditLines(prog0().music || []);
  const body = ([`One hour of world news, compared across outlets. ${fmtPkt(hourStart)} Karachi · ${fmtNy(hourStart)} New York.`,
    feature && featureTitle ? `Also this hour: ${featureTitle}.` : "", "Every newsroom, one stream. https://scoopfeeds.com"].filter(Boolean).join("\n\n"));
  const creditsUrl = String(env.RADIO_MUSIC_CREDITS_URL || "").trim() || null;
  try { status.description = withCredits(body, credits, { creditsUrl }); }   // exactly what broadcastBody() sends
  catch (e) { await alert(`the ${fmtPkt(hourStart)} hour did not air: ${e.message}`); stage("credits-failed"); process.exitCode = 1; return; }
  if (liveConfigured(env)) {
    stage("youtube-setup");
    try {
      yt = ytApi;
      await yt.checkScope();
      const stream = await yt.findStream(); streamId = stream.id;
      const b = await yt.createBroadcast({ title, description: body, startMs: hourStart, privacy: env.RADIO_AUTOAIR_PRIVACY || "public", credits, creditsUrl });
      broadcastId = b.id; status.broadcastId = broadcastId; status.watch = `https://www.youtube.com/watch?v=${broadcastId}`; saveStatus();
      await yt.bind(broadcastId, streamId);
      const thumb = tilde(v.thumbnail || env.RADIO_AUTOAIR_THUMBNAIL || path.join(BASE, "scoopfeeds-radio-live-thumbnail.jpg"));
      if (thumb && fs.existsSync(thumb)) await yt.setThumbnail(broadcastId, thumb).catch((e) => log(`thumbnail not set: ${e.message}`));
      log(`youtube: broadcast ${broadcastId} scheduled for ${status.hour}, bound to stream ${streamId}`);
    } catch (e) {
      yt = null;
      await alert(`YouTube setup failed (${e.message}). The programme will still stream at ${fmtPkt(hourStart - leadMs)}: go live by hand in YouTube Studio.`);
    }
  } else log("youtube: no API credentials (RADIO_YT_*); the stream goes out and YouTube Studio must be used to go live");
  const xText = xBroadcastText({ title, credits, creditsUrl });
  for (const f of [path.join(out, "x-broadcast.txt"), path.join(BASE, "x-broadcast.txt")]) { try { fs.writeFileSync(f, xText + "\n"); } catch { /* best effort */ } }
  status.xText = path.join(BASE, "x-broadcast.txt"); saveStatus();

  // ── 4. wait for the slot, hand over from the 24/7 radio, start the playout ──
  stage("waiting");
  await sleepUntil(hourStart - leadMs);
  if (isPaused(BASE)) { log("PAUSE appeared before air: stopping"); if (yt && broadcastId) await yt.transition(broadcastId, "complete").catch(() => {}); stage("paused"); return; }
  const was247 = spawnSync("launchctl", ["print", `gui/${UID}/${LIVE_AGENT}`], { stdio: "ignore" }).status === 0;
  if (was247) { spawnSync("launchctl", ["bootout", `gui/${UID}/${LIVE_AGENT}`], { stdio: "ignore" }); log(`paused the 24/7 radio (${LIVE_AGENT})`); }
  for (const label of String(env.RADIO_AUTOAIR_PAUSE_AGENTS || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    spawnSync("launchctl", ["bootout", `gui/${UID}/${label}`], { stdio: "ignore" }); log(`paused ${label} for the hour`);
  }
  status.paused247 = was247;

  stage("on-air");
  const prog = JSON.parse(fs.readFileSync(path.join(out, "programme.json"), "utf8"));
  const outputsFile = path.join(out, "outputs.json");   // per-destination status from the fan-out (#207); only written with more than one destination
  const playArgs = [path.join(BACKEND, "src/radio/playout/cli.js"), "--programme", out, "--music-dir", tilde(v["music-dir"] || env.RADIO_MUSIC_DIR || path.join(BASE, "music")),
    "--status-file", outputsFile, "--alerts", "off"];
  let playExit = null, playChild = null, pausedOnAir = false;
  const playing = runLogged(process.execPath, playArgs, { cwd: BACKEND, logFile: path.join(out, "playout.log"), log: () => {}, onSpawn: (ch) => { playChild = ch; }, env: { ...env, RADIO_PLAYOUT_CHROME: env.RADIO_PLAYOUT_CHROME || "system" } })
    .then((c) => { playExit = c; return c; });
  status.playoutStartedAt = Date.now(); saveStatus();
  log("playout started");

  if (yt && broadcastId) {
    goLiveWhenActive(yt, { broadcastId, streamId, timeoutMs: 4 * 60_000, log })
      .then(() => { status.liveAt = Date.now(); saveStatus(); return alert(`ScoopFeeds Radio is LIVE: ${status.watch}`, { quiet: true }); })
      .catch((e) => alert(`the broadcast did not go live by itself (${e.message}). Click Go live in YouTube Studio.`));
  }

  // ── 5. watch until the end ──
  let badSince = null, lastWarn = 0;
  const downSince = {}, warned = {};
  while (playExit === null) {
    await Promise.race([playing, sleep(30_000)]);
    // #208: the standing watchdog (or DrJ) wrote PAUSE mid-hour: end the hour now, cleanly
    if (playExit === null && !pausedOnAir && fs.existsSync(path.join(BASE, "PAUSE"))) {
      pausedOnAir = true; status.pausedOnAir = Date.now(); saveStatus();
      log("PAUSE appeared on air: stopping the playout and ending the broadcast");
      try { playChild?.kill("SIGINT"); } catch { /* gone */ }
      setTimeout(() => { try { playChild?.kill("SIGKILL"); } catch { /* gone */ } }, 10_000).unref();
      continue;
    }
    // #207: each destination's state goes into this hour's status.json; alert only for a primary down over 5 min
    const outs = readOutputs(outputsFile);
    if (outs) {
      status.outputs = outs.summary; saveStatus();
      for (const x of outs.outputs) {
        if (x.state === "live") { downSince[x.id] = null; warned[x.id] = false; continue; }
        downSince[x.id] ??= Date.now();
        if (x.priority === "primary" && !warned[x.id] && Date.now() - downSince[x.id] > 5 * 60_000) {
          warned[x.id] = true;
          await alert(`${x.label} has been off air for over 5 minutes (${x.state}${x.lastError ? `: ${x.lastError}` : ""}). The other outputs are unaffected.`);
        }
      }
    }
    if (playExit !== null || !yt || !streamId || !status.liveAt) continue;
    const st = await yt.streamState(streamId).catch(() => null);
    const bad = !st || st.streamStatus !== "active" || st.health === "bad" || st.health === "noData";
    if (bad) { badSince ??= Date.now(); if (Date.now() - badSince > 60_000 && Date.now() - lastWarn > 10 * 60_000) { lastWarn = Date.now(); await alert(`stream unhealthy for over a minute: ${st ? `${st.streamStatus}, ${st.health}` : "status unavailable"}`); } }
    else badSince = null;
  }
  const early = Date.now() < prog.endsAt - 5_000;
  status.playoutExit = playExit; status.endedAt = Date.now();
  if (early && !pausedOnAir) await alert(`the playout stopped early (exit ${playExit}) at ${fmtPkt(Date.now())}, ${Math.round((prog.endsAt - Date.now()) / 60_000)} min before the end.`);

  // ── 6. wrap up ──
  stage("wrapping");
  if (yt && broadcastId) await yt.transition(broadcastId, "complete").then(() => log("youtube: broadcast complete")).catch((e) => log(`youtube: complete failed (auto-stop will end it): ${e.message}`));
  if (pausedOnAir || fs.existsSync(path.join(BASE, "PAUSE"))) log("PAUSE is set: the 24/7 radio stays off until it is removed by hand");
  else if (was247) {
    const plist = path.join(HOME, "Library/LaunchAgents", `${LIVE_AGENT}.plist`);
    const r = spawnSync("launchctl", ["bootstrap", `gui/${UID}`, plist], { stdio: "ignore" });
    log(r.status === 0 ? "the 24/7 radio is back" : `could not restart the 24/7 radio (launchctl bootstrap exit ${r.status})`);
    if (r.status !== 0) await alert("the 24/7 radio did not come back after the hour; reload it with launchctl bootstrap.");
  }
  for (const label of String(env.RADIO_AUTOAIR_PAUSE_AGENTS || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    if (pausedOnAir) break;
    spawnSync("launchctl", ["bootstrap", `gui/${UID}`, path.join(HOME, "Library/LaunchAgents", `${label}.plist`)], { stdio: "ignore" }); log(`restarted ${label}`);
  }
  stage(pausedOnAir ? "paused-on-air" : early ? "ended-early" : "done");
}

// ── helpers ──
/** The fan-out's status file, or null when there is none (one destination) or it is mid-write. */
export function readOutputs(file) {
  try { const j = JSON.parse(fs.readFileSync(file, "utf8")); return Array.isArray(j.outputs) ? j : null; } catch { return null; }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, Math.max(0, ms))); }
async function sleepUntil(t) { while (Date.now() < t) await sleep(Math.min(30_000, t - Date.now())); }
const fmt = (ms, tz, o) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...o }).format(new Date(ms));
function fmtPkt(ms) { return fmt(ms, "Asia/Karachi", { hour: "numeric", minute: "2-digit", hour12: true }); }
function fmtNy(ms) { return fmt(ms, "America/New_York", { hour: "numeric", minute: "2-digit", hour12: true }); }
function fmtDate(ms) { return fmt(ms, "Asia/Karachi", { weekday: "short", day: "numeric", month: "short", year: "numeric" }); }

/** Run a child, appending its output to a log file; SIGKILL it at `killAt`. Resolves its exit code. */
function runLogged(cmd, args, { cwd, logFile, killAt, env: childEnv = process.env, log, onSpawn = null }) {
  return new Promise((resolve) => {
    const fd = fs.openSync(logFile, "a");
    const ch = spawn(cmd, args, { cwd, env: childEnv, stdio: ["ignore", fd, fd] });
    onSpawn?.(ch);
    const t = killAt ? setTimeout(() => { log(`${path.basename(args[0])} ran past its deadline; killed`); ch.kill("SIGKILL"); }, Math.max(0, killAt - Date.now())) : null;
    ch.on("exit", (code, sig) => { if (t) clearTimeout(t); fs.closeSync(fd); resolve(code ?? (sig ? 128 : 1)); });
    ch.on("error", (e) => { if (t) clearTimeout(t); log(`could not start ${cmd}: ${e.message}`); resolve(127); });
  });
}

/** Alerts: the log, a macOS notification, and email when SMTP_* and RADIO_ALERT_EMAIL are set. */
function makeAlert({ log, status, saveStatus }) {
  return async (msg, { quiet = false } = {}) => {
    log(`${quiet ? "ℹ" : "⚠"} ${msg}`);
    status.alerts.push({ at: Date.now(), msg }); saveStatus();
    if (process.platform === "darwin") spawnSync("osascript", ["-e", `display notification ${JSON.stringify(msg.slice(0, 200))} with title "ScoopFeeds Radio"`], { stdio: "ignore" });
    const to = process.env.RADIO_ALERT_EMAIL;
    if (to && process.env.SMTP_HOST) {
      try {
        const { sendMail } = await import("../../services/mailer.js");
        await sendMail({ to, subject: `${quiet ? "" : "⚠ "}ScoopFeeds Radio: ${msg.slice(0, 80)}`, text: msg });
      } catch (e) { log(`alert email failed: ${e.message}`); }
    }
  };
}

// last, so every helper above is initialised before the run starts
const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
