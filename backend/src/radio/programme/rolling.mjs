#!/usr/bin/env node
/**
 * rolling.mjs - ScoopFeeds Radio 24/7 (#195): one long-running process owns the air. Every hour is prepared while
 * the one before it airs; a failed hour airs the 24/7 headline screen + music bed; the next hour tries again.
 * The loop itself is rollingStation.js; this file wires real processes, files and YouTube into it.
 *
 * Gates (same as the one-hour auto-air, plus one):
 *   ~/scoopfeeds-radio/PAUSE        -> no hours are prepared; the 24/7 headline screen airs until it is removed
 *   REHEARSAL unless BOTH RADIO_AUTOAIR_ENABLED and RADIO_ROLLING_ENABLED are literally "1": every playout
 *     writes segments to disk under ~/scoopfeeds-radio/rehearsal-seg/<hour>/ and nothing is streamed
 *   live: the playout's own RTMP gates (RADIO_PLAYOUT_ENABLED=true + RADIO_STREAM_KEY) still apply
 * Going on air 24/7 also waits for #208 (platform safety) to be merged: DrJ, 22 Oct 2026.
 *
 *   node src/radio/programme/rolling.mjs [--hours 6] [--force-fail 2026-10-27T15] [--force-top-change]
 *        [--music-dir DIR] [--film FILE|DIR] [--fake-voice] [--fake-writer]
 * Mac: playout/deploy/macos/install-rolling.sh (launchd). Nothing else here is Mac-specific.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { airCheck } from "./airCheck.js";
import { RollingStation, WriterLedger, continuousBroadcast, hourStamp } from "./rollingStation.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, "../../..");
const HOME = os.homedir();
const tilde = (p) => (p ? path.resolve(String(p).replace(/^~/, HOME)) : p);

/** Streaming needs both literal "1"s; anything else is a rehearsal (segments to disk). */
export function rollingLive(e = process.env) {
  return e.RADIO_AUTOAIR_ENABLED === "1" && e.RADIO_ROLLING_ENABLED === "1";
}
export const numEnv = (v, dflt, min = 0) => { const n = Number(v); return v !== undefined && v !== "" && Number.isFinite(n) && n >= min ? n : dflt; };

/** A file, or the newest video in a directory. */
function newestVideo(p) {
  if (!p || !fs.existsSync(p)) return null;
  if (!fs.statSync(p).isDirectory()) return p;
  const vids = fs.readdirSync(p).filter((f) => /\.(mp4|mov|m4v|webm)$/i.test(f)).map((f) => path.join(p, f));
  return vids.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
}

/**
 * Disk: a produced hour is ~0.8 GB of WAV and a rehearsal hour ~80 one-minute segments. Keep the hour folders the
 * repeat may still pick (18 h) plus a margin, and the newest rehearsal recordings; delete older ones.
 * Folder names are hour stamps (YYYY-MM-DDTHH...), so their age is read from the name, never from mtime.
 */
export function pruneOld(dir, { keepHours, now = Date.now(), keepNewest = 0 } = {}) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}T\d{2}/.test(n)).sort(); } catch { return []; }
  const keepSet = new Set(keepNewest ? names.slice(-keepNewest) : []);
  const gone = [];
  for (const n of names) {
    const t = Date.parse(`${n.slice(0, 13)}:00:00Z`);
    const old = keepHours != null ? Number.isFinite(t) && t < now - keepHours * 3_600_000 : !keepSet.has(n);
    if (old && !keepSet.has(n)) { fs.rmSync(path.join(dir, n), { recursive: true, force: true }); gone.push(n); }
  }
  return gone;
}

/** Take <base>/<name>.lock for this pid; false if a live process holds it. */
export function takeLock(file) {
  try { fs.writeFileSync(file, String(process.pid), { flag: "wx" }); return true; }
  catch {
    if (lockAlive(file)) return false;
    fs.writeFileSync(file, String(process.pid)); return true;   // stale lock from a dead process
  }
}
export function lockAlive(file) {
  try { const pid = Number(fs.readFileSync(file, "utf8")); if (!pid) return false; process.kill(pid, 0); return true; } catch { return false; }
}

function spawnLogged(cmd, args, { cwd, logFile, env = process.env }) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = fs.openSync(logFile, "a");
  const ch = spawn(cmd, args, { cwd, env, stdio: ["ignore", fd, fd] });
  const done = new Promise((resolve) => {
    ch.on("exit", (code, sig) => { try { fs.closeSync(fd); } catch { /* */ } resolve(code ?? (sig ? 128 : 1)); });
    ch.on("error", () => { try { fs.closeSync(fd); } catch { /* */ } resolve(127); });
  });
  return { ch, done };
}

async function main() {
  const { values: v } = parseArgs({ options: {
    hours: { type: "string" }, "force-fail": { type: "string" }, "force-top-change": { type: "boolean" },
    "music-dir": { type: "string" }, film: { type: "string" }, "fake-voice": { type: "boolean" }, "fake-writer": { type: "boolean" },
  } });
  const env = process.env;
  const BASE = tilde(env.RADIO_BASE_DIR || "~/scoopfeeds-radio");
  const airDir = path.join(BASE, "air");
  const musicDir = tilde(v["music-dir"] || env.RADIO_MUSIC_DIR || path.join(BASE, "music"));
  const logFile = path.join(BASE, "logs", "rolling.log");
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = (m) => { const line = `${new Date().toISOString()} 📡 rolling: ${m}`; console.log(line); try { fs.appendFileSync(logFile, line + "\n"); } catch { /* */ } };

  const lock = path.join(BASE, "rolling.lock");
  if (lockAlive(path.join(BASE, "autoair.lock"))) { log("a one-hour auto-air run holds autoair.lock; not starting (one owner of the air at a time)"); process.exit(75); }
  if (!takeLock(lock)) { log(`another rolling loop (pid ${fs.readFileSync(lock, "utf8")}) owns the air; exiting`); process.exit(75); }
  process.on("exit", () => { try { if (Number(fs.readFileSync(lock, "utf8")) === process.pid) fs.unlinkSync(lock); } catch { /* */ } });

  const live = rollingLive(env);
  log(live ? "LIVE: hours stream through the playout's RTMP gates" : "REHEARSAL: every playout writes segments to disk; nothing is streamed (needs RADIO_AUTOAIR_ENABLED=1 and RADIO_ROLLING_ENABLED=1 to air)");

  const alert = async (msg) => {
    log(`⚠ ${msg}`);
    if (env.RADIO_ALERT_CMD) spawnSync(env.RADIO_ALERT_CMD, [msg.slice(0, 300)], { stdio: "ignore", shell: false });
    if (env.RADIO_ALERT_EMAIL && env.SMTP_HOST) {
      try { const { sendMail } = await import("../../services/mailer.js"); await sendMail({ to: env.RADIO_ALERT_EMAIL, subject: `⚠ ScoopFeeds Radio 24/7: ${msg.slice(0, 80)}`, text: msg }); }
      catch (e) { log(`alert email failed: ${e.message}`); }
    }
  };

  const film = newestVideo(tilde(v.film || env.RADIO_ROLLING_FILM || env.RADIO_AUTOAIR_FILM));
  const produce = ({ hourStart, out, from, to, weather, headlineWriter, deadline }) => {
    const args = [path.join(HERE, "produce.mjs"), "--hour", new Date(hourStart).toISOString(), "--out", out, "--music-dir", musicDir, "--weather", weather === false ? "0" : "1"];
    if (from) args.push("--from", from);
    if (to) args.push("--to", to);
    if (headlineWriter) args.push("--headline-writer");
    if (film && !to) args.push("--film", film);
    if (v["fake-voice"]) args.push("--fake-voice");
    if (v["fake-writer"]) args.push("--fake-writer");
    const { ch, done } = spawnLogged(process.execPath, args, { cwd: BACKEND, logFile: path.join(out, "produce.log") });
    const t = setTimeout(() => { log(`producer for ${hourStamp(hourStart)} ran past its deadline; killed`); ch.kill("SIGKILL"); }, Math.max(0, deadline - Date.now()));
    return done.finally(() => clearTimeout(t));
  };

  const playout = {
    start({ kind, dir, hourStart }) {
      const tag = hourStart ? hourStamp(hourStart) : `${hourStamp(Date.now())}-start`;
      const args = [path.join(BACKEND, "src/radio/playout/cli.js"), "--music-dir", musicDir];
      if (kind === "programme") args.push("--programme", dir);
      else args.push("--base-url", env.RADIO_BASE_URL || "https://scoopfeeds.com");
      if (!live) args.push("--segments-dir", path.join(BASE, "rehearsal-seg", `${tag}-${kind}`), "--segment-keep", "80");
      const logTo = kind === "programme" ? path.join(dir, "playout.log") : path.join(BASE, "logs", "playout-247.log");
      const { ch, done } = spawnLogged(process.execPath, args, { cwd: BACKEND, logFile: logTo, env: { ...env, RADIO_PLAYOUT_CHROME: env.RADIO_PLAYOUT_CHROME || "system" } });
      log(`playout started: ${kind}${dir ? ` ${path.basename(dir)}` : ""} (pid ${ch.pid})`);
      return {
        done,
        async stop() {
          if (ch.exitCode !== null || ch.signalCode) return;
          ch.kill("SIGTERM");
          const killer = setTimeout(() => ch.kill("SIGKILL"), 15_000);
          await done; clearTimeout(killer);
        },
      };
    },
  };

  const topStory = async () => {
    const { buildFactPack } = await import("./factPack.js");
    const pack = await buildFactPack({ base: env.RADIO_BASE_URL || "https://scoopfeeds.com", log: () => {} });
    return pack.top?.[0] || null;
  };

  let broadcast = null;
  if (live) {
    const { makeYouTubeLive, liveConfigured, goLiveWhenActive } = await import("../live/youtubeLive.js");
    if (liveConfigured(env)) {
      const yt = makeYouTubeLive({ env });
      broadcast = continuousBroadcast({
        yt, log, alert, privacy: env.RADIO_AUTOAIR_PRIVACY || "public",
        goLive: (o) => goLiveWhenActive(yt, { ...o, timeoutMs: 4 * 60_000 }),
        title: () => env.RADIO_ROLLING_TITLE || "ScoopFeeds Radio LIVE 24/7 · The news, compared",
        description: "World news around the clock, compared across outlets. Every newsroom, one stream. https://scoopfeeds.com",
      });
    } else log("youtube: no API credentials (RADIO_YT_*); the stream goes out and YouTube Studio must be used to go live");
  }

  const keepHours = numEnv(env.RADIO_ROLLING_KEEP_HOURS, 26, 19);
  const prune = () => {
    const a = pruneOld(airDir, { keepHours });
    const r = pruneOld(path.join(BASE, "rehearsal-seg"), { keepNewest: numEnv(env.RADIO_ROLLING_REHEARSAL_KEEP, 8, 1) });
    if (a.length || r.length) log(`disk: removed ${a.length} hour folder(s) older than ${keepHours} h and ${r.length} old rehearsal recording(s)`);
  };
  prune();
  const pruneTimer = setInterval(prune, 3_600_000);

  const ac = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { log(`${sig}: stopping after the current step`); ac.abort(); });
  const station = new RollingStation({
    airDir, produce, check: airCheck, topStory, playout, broadcast, log, alert,
    isPaused: () => fs.existsSync(path.join(BASE, "PAUSE")),
    ledger: new WriterLedger({ dir: path.join(BASE, "writer-calls"), maxPerDay: numEnv(env.RADIO_WRITER_DAILY_MAX, 96, 1), cooldownMin: numEnv(env.RADIO_WRITER_COOLDOWN_MIN, 60, 1) }),
    forceFail: new Set(String(v["force-fail"] || "").split(",").map((s) => s.trim().replace(/[:]/g, "").slice(0, 13)).filter(Boolean)),
    forceTopChange: !!v["force-top-change"],
    opts: { rollEtHours: String(env.RADIO_ROLLING_ROLL_ET || "4,16").split(",").map(Number).filter((n) => n >= 0 && n < 24) },
  });
  if (v["force-fail"]) log(`rehearsal switch: producer failure forced for ${[...station.forceFail].join(", ")}`);
  const hours = await station.run({ hours: v.hours ? Number(v.hours) : Infinity, signal: ac.signal });
  clearInterval(pruneTimer);
  fs.writeFileSync(path.join(BASE, "logs", `rolling-summary-${hourStamp(Date.now())}.json`), JSON.stringify(hours, null, 1));
  log(`summary: ${hours.map((h) => `${h.hour} ${h.aired}${h.reason ? ` (${h.reason})` : ""}`).join(" | ")}`);
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
