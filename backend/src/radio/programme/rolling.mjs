#!/usr/bin/env node
/**
 * rolling.mjs - ScoopFeeds Radio 24/7 (#195): one long-running process owns the air. Every hour is prepared while
 * the one before it airs; a failed hour airs the 24/7 headline screen + music bed; the next hour tries again.
 * The loop itself is rollingStation.js; this file wires real processes, files and YouTube into it.
 *
 * Gates (same as the one-hour auto-air, plus one):
 *   ~/scoopfeeds-radio/PAUSE        -> OFF AIR (#208): checked at least every 30 s, mid-hour too; the playout stops,
 *     the YouTube broadcast is completed and the loop exits. At start-up it holds until PAUSE is removed by hand.
 *   REHEARSAL unless BOTH RADIO_AUTOAIR_ENABLED and RADIO_ROLLING_ENABLED are literally "1": every playout
 *     writes segments to disk under ~/scoopfeeds-radio/rehearsal-seg/<hour>/ and nothing is streamed
 *   live: the playout's own RTMP gates (RADIO_PLAYOUT_ENABLED=true + RADIO_STREAM_KEY) still apply
 * #208 platform safety, as in autoair.mjs: a film airs only when pickClearedFilm() clears it (else music fills the
 * slot; a repeat whose film is no longer cleared falls back); the broadcast title goes through factualTitle(); the
 * description and the X text carry the music credits of every track that may air, or the RADIO_MUSIC_CREDITS_URL
 * link; credits that cannot be published complete keep the loop in REHEARSAL.
 *
 *   node src/radio/programme/rolling.mjs [--hours 6] [--force-fail 2026-10-27T15] [--force-top-change]
 *        [--music-dir DIR] [--film FILE|DIR] [--fake-voice] [--fake-writer] [--developing-file FILE]
 * #201 developing desk: on when RADIO_DEVELOPING_ENABLED=1 (reads <RADIO_BASE_URL>/api/radio/developing.json) or with
 *   --developing-file (a rehearsal: the list is read from that file, e.g. one fake fast-growing event). A bulletin is
 *   spliced into the hour on air at the next segment boundary within 15 minutes (bulletin.mjs, developingDesk.js).
 * Mac: playout/deploy/macos/install-rolling.sh (launchd). Nothing else here is Mac-specific.
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
import { factualTitle, withCredits, xBroadcastText } from "../safety/broadcastCopy.js";
import { clearedTracks } from "../musicLibrary.js";
import { creditLines } from "../musicManifest.js";
import { RollingStation, WriterLedger, continuousBroadcast, hourStamp, writerRunCount, writerRunSince } from "./rollingStation.js";
import { DevelopingDesk, deskEnabled, developingTick, fetchDevelopingList } from "./developingDesk.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, "../../..");
const HOME = os.homedir();
const tilde = (p) => (p ? path.resolve(String(p).replace(/^~/, HOME)) : p);

/** Streaming needs both literal "1"s; anything else is a rehearsal (segments to disk). */
export function rollingLive(e = process.env) {
  return e.RADIO_AUTOAIR_ENABLED === "1" && e.RADIO_ROLLING_ENABLED === "1";
}
export const numEnv = (v, dflt, min = 0) => { const n = Number(v); return v !== undefined && v !== "" && Number.isFinite(n) && n >= min ? n : dflt; };

/**
 * #208: the film for a producer run, through the same copyright clearance as autoair.mjs. A produced hour gets the
 * newest CLEARED film from `filmSrc` (none cleared: no --film, and music fills the slot). A repeat keeps the
 * repeated hour's film, so that film must still be cleared now, or the repeat is refused ({ ok: false }).
 */
export async function filmFor({ out, to, filmSrc, yt, log = () => {}, pick = pickClearedFilm }) {
  if (to) {
    let prog = {};
    try { prog = JSON.parse(fs.readFileSync(path.join(out, "programme.json"), "utf8")) || {}; } catch { /* no programme: no film */ }
    const fp = prog.filmPath || null;
    if (!fp && prog.film) return { ok: false, why: `the repeated hour's film ${prog.film} has no recorded path, so its clearance cannot be checked` };
    if (!fp) return { ok: true, film: null };
    return (await pick(fp, { yt, log })) ? { ok: true, film: null } : { ok: false, why: `the repeated hour's film ${path.basename(fp)} is not cleared now` };
  }
  return { ok: true, film: filmSrc ? await pick(filmSrc, { yt, log }) : null };
}

/**
 * #208: the words around the continuous broadcast. It spans many hours, so its credits are every track that may
 * air (the cleared library), or the link to the full list when RADIO_MUSIC_CREDITS_URL is set. Throws
 * CreditsDoNotFit rather than return an incomplete attribution.
 */
export function broadcastCopy({ env = process.env, credits = [], log = () => {} } = {}) {
  const defaultTitle = "ScoopFeeds Radio LIVE 24/7 · The news, compared";
  const tt = factualTitle(env.RADIO_ROLLING_TITLE || defaultTitle, defaultTitle);
  if (tt.replaced) log(`title replaced with the default (${tt.why.join(", ")})`);
  const creditsUrl = String(env.RADIO_MUSIC_CREDITS_URL || "").trim() || null;
  const listAll = !creditsUrl;
  const body = "World news around the clock, compared across outlets. Every newsroom, one stream. https://scoopfeeds.com";
  const description = withCredits(body, credits, { creditsUrl, listAll });   // exactly what broadcastBody() sends
  const xText = xBroadcastText({ title: tt.title, credits, creditsUrl, listAll });
  return { title: tt.title, body, description, xText, credits, creditsUrl, listAll };
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
    "developing-file": { type: "string" },
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

  // #208: PAUSE means off air. Hold here (no spin under launchd's KeepAlive); removing it by hand resumes.
  if (fs.existsSync(path.join(BASE, "PAUSE"))) {
    log(`${path.join(BASE, "PAUSE")} exists: holding off air until it is removed by hand`);
    while (fs.existsSync(path.join(BASE, "PAUSE"))) await new Promise((r) => setTimeout(r, 30_000));
    log("PAUSE removed: starting");
  }

  let live = rollingLive(env);
  log(live ? "LIVE: hours stream through the playout's RTMP gates" : "REHEARSAL: every playout writes segments to disk; nothing is streamed (needs RADIO_AUTOAIR_ENABLED=1 and RADIO_ROLLING_ENABLED=1 to air)");

  const alert = async (msg) => {
    log(`⚠ ${msg}`);
    if (env.RADIO_ALERT_CMD) spawnSync(env.RADIO_ALERT_CMD, [msg.slice(0, 300)], { stdio: "ignore", shell: false });
    if (env.RADIO_ALERT_EMAIL && env.SMTP_HOST) {
      try { const { sendMail } = await import("../../services/mailer.js"); await sendMail({ to: env.RADIO_ALERT_EMAIL, subject: `⚠ ScoopFeeds Radio 24/7: ${msg.slice(0, 80)}`, text: msg }); }
      catch (e) { log(`alert email failed: ${e.message}`); }
    }
  };

  // #208: the broadcast's title, description and X text, checked before anything goes out
  let copy = null;
  if (live) {
    try {
      copy = broadcastCopy({ env, credits: creditLines(clearedTracks(musicDir)), log });
      for (const f of [path.join(BASE, "x-broadcast.txt"), path.join(BASE, "logs", "x-broadcast-247.txt")]) { try { fs.writeFileSync(f, copy.xText + "\n"); } catch { /* best effort */ } }
      log(`broadcast copy: "${copy.title}"; ${copy.credits.length} music credit(s) ${copy.listAll ? "listed in full" : `linked (${copy.creditsUrl})`}; X text in ${path.join(BASE, "x-broadcast.txt")}`);
    } catch (e) {
      await alert(`the 24/7 loop cannot go on air: ${e.message}. Running as a REHEARSAL (nothing streams) until that is fixed.`);
      live = false;
    }
  }

  const ytApi = liveConfigured(env) ? makeYouTubeLive({ env }) : null;
  const filmSrc = tilde(v.film || env.RADIO_ROLLING_FILM || env.RADIO_AUTOAIR_FILM);
  // #201: the developing desk (dark unless RADIO_DEVELOPING_ENABLED=1, or a --developing-file rehearsal)
  const devDir = path.join(BASE, "developing");
  const devDesk = deskEnabled(env) || v["developing-file"] ? new DevelopingDesk({ dir: devDir, log }) : null;
  if (devDesk) log(`developing desk ON (${v["developing-file"] ? `rehearsal list ${tilde(v["developing-file"])}` : `${env.RADIO_BASE_URL || "https://scoopfeeds.com"}/api/radio/developing.json`}); state in ${devDir}`);
  const produce = async ({ hourStart, out, from, to, weather, headlineWriter, deadline }) => {
    const f = await filmFor({ out, to, filmSrc, yt: ytApi, log: (m) => log(`${hourStamp(hourStart)}: ${m}`) });
    if (!f.ok) { log(`hour ${hourStamp(hourStart)}: ${f.why}; not airing it`); return 1; }
    const film = f.film;
    const args = [path.join(HERE, "produce.mjs"), "--hour", new Date(hourStart).toISOString(), "--out", out, "--music-dir", musicDir, "--weather", weather === false ? "0" : "1"];
    if (from) args.push("--from", from);
    if (to) args.push("--to", to);
    if (headlineWriter) args.push("--headline-writer");
    if (devDesk && !to && fs.existsSync(path.join(devDir, "followups.json"))) args.push("--developing", path.join(devDir, "followups.json"));   // #201
    if (film) args.push("--film", film);
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

  // #201: one bulletin, produced by bulletin.mjs into the target hour's folder, killed at its deadline
  let station = null;
  const produceBulletin = async ({ dir, hourStart, event, plan, writer, deadline }) => {
    const evFile = path.join(dir, `developing-event-${Date.now().toString(36)}.json`);
    fs.writeFileSync(evFile, JSON.stringify(event, null, 1));
    const args = [path.join(HERE, "bulletin.mjs"), "--dir", dir, "--event", evFile, "--cut", String(plan.cut), "--end", String(plan.end), "--resume", String(plan.resumeAt),
      "--slot", plan.slot.id, "--music-dir", musicDir, "--writer", writer];
    if (plan.next) args.push("--next-title", plan.next.title, "--next-at", String(plan.next.at));
    if (v["fake-voice"]) args.push("--fake-voice");
    if (v["fake-writer"]) args.push("--fake-writer");
    const before = writerRunCount(dir);
    const { ch, done } = spawnLogged(process.execPath, args, { cwd: BACKEND, logFile: path.join(dir, "bulletin.log") });
    const t = setTimeout(() => { log(`bulletin for ${hourStamp(hourStart)} ran past its deadline; killed`); ch.kill("SIGKILL"); }, Math.max(0, deadline - Date.now()));
    const code = await done.finally(() => clearTimeout(t));
    const run = writerRunSince(dir, before);
    if (run && station) station.ledger.add(hourStart, run, "developing");
    return code;
  };
  const developing = devDesk ? async ({ targets, now, writerBusy }) => {
    let list;
    try {
      if (v["developing-file"]) { list = JSON.parse(fs.readFileSync(tilde(v["developing-file"]), "utf8")); list.updatedAt ??= now; }
      else list = await fetchDevelopingList(env.RADIO_BASE_URL || "https://scoopfeeds.com");
    } catch (e) { log(`developing: list unavailable (${e.message})`); return { result: "list unavailable" }; }
    const guard = station.ledger.guard();
    const r = await developingTick({ desk: devDesk, list, targets, now, useClaude: !writerBusy && guard.ok && !v["fake-writer"], produceBulletin, log: (m) => log(m) });
    if (!["nothing firing", "no insertion this tick"].includes(r.result)) log(`developing: ${r.result}`);
    return r;
  } : null;

  let broadcast = null;
  if (live) {
    if (ytApi) {
      const yt = ytApi;
      broadcast = continuousBroadcast({
        yt, log, alert, privacy: env.RADIO_AUTOAIR_PRIVACY || "public",
        goLive: (o) => goLiveWhenActive(yt, { ...o, timeoutMs: 4 * 60_000 }),
        title: () => copy.title, description: copy.body, credits: copy.credits, creditsUrl: copy.creditsUrl, listAll: copy.listAll,
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
  station = new RollingStation({
    airDir, produce, check: airCheck, topStory, playout, broadcast, log, alert, developing,
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
  if (station.offAir) log(`PAUSE took the stream off air at ${new Date(station.offAir.at).toISOString()}; exiting (resume: remove PAUSE by hand)`);
  log(`summary: ${hours.map((h) => `${h.hour} ${h.aired}${h.reason ? ` (${h.reason})` : ""}`).join(" | ")}`);
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
