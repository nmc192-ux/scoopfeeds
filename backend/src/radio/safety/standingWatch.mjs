#!/usr/bin/env node
/**
 * standingWatch.mjs — one pass of the #208 channel-standing watchdog. launchd runs it every 10 minutes
 * (deploy/macos/install-standing.sh). On any NEW claim, strike, warning, restriction, revoked broadcast,
 * X refusal or notice: writes ~/scoopfeeds-radio/PAUSE, ends the live broadcast(s) cleanly, stops the 24/7
 * playout, and alerts DrJ (Mac notification, email, push). It never removes PAUSE: resume is by hand.
 *
 *   node src/radio/safety/standingWatch.mjs            one pass
 *   node src/radio/safety/standingWatch.mjs --line     print the weekly standing line from the last pass, no reading
 *
 * Read-only towards YouTube except the one write the spec asks for: ending a live broadcast on an incident.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeYouTubeLive, liveConfigured } from "../live/youtubeLive.js";
import { watchOnce } from "./standing.js";
import { makeRadioAlert } from "./alert.js";

const env = process.env;
const HOME = os.homedir();
const BASE = path.resolve(String(env.RADIO_BASE_DIR || "~/scoopfeeds-radio").replace(/^~/, HOME));
const UID = process.getuid?.() ?? 501;
const AGENTS = [env.RADIO_AUTOAIR_247_LABEL || "com.scoopfeeds.radio"];

const log = (m) => { const line = `${new Date().toISOString()} 🛡 standing: ${m}`; console.log(line); try { fs.mkdirSync(path.join(BASE, "logs"), { recursive: true }); fs.appendFileSync(path.join(BASE, "logs", "standing.log"), line + "\n"); } catch { /* */ } };

/** Stop the 24/7 playout agent (its run-playout.sh also holds while PAUSE exists, so a reboot cannot restart it). */
function stopRadio() {
  if (process.platform !== "darwin") { log("not macOS: no launchd agent to stop"); return; }
  for (const label of AGENTS) {
    const r = spawnSync("launchctl", ["bootout", `gui/${UID}/${label}`], { stdio: "ignore" });
    log(`launchctl bootout ${label}: ${r.status === 0 ? "stopped" : `exit ${r.status} (not running?)`}`);
  }
}

async function main() {
  if (process.argv.includes("--line")) {
    try { console.log(JSON.parse(fs.readFileSync(path.join(BASE, "standing.json"), "utf8")).line); }
    catch { console.log("Radio standing: unknown (the watchdog has not run)"); }
    return;
  }
  const yt = liveConfigured(env) ? makeYouTubeLive({ env }) : null;
  const r = await watchOnce({ baseDir: BASE, yt, stopRadio, alert: makeRadioAlert({ env, log }), log });
  if (r.acted) process.exitCode = 3;
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
