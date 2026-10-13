#!/usr/bin/env node
/**
 * batch.mjs — one scheduled batch of 60 · films (DrJ, 13 Oct 2026: 2 films a day, one per 5-hour window,
 * around 06:00 and 14:00 PKT). launchd runs this; it is also what a manual checkpoint run uses.
 *
 *   node sixty/bin/batch.mjs --window am|pm|now [--day YYYY-MM-DD] [--dir <batchdir>] [--dry-run]
 *   --dry-run runs every guard and the Kokoro check, then stops before any agent session (spends no quota).
 *
 * One film per batch, no reserve retry: the daily cap is 2 (SIXTY_FILMS_PER_DAY in the launchd job) and each
 * window gets one. It never posts anything. Refuses to start when:
 *   - a pause window is open, or opens within 2.5 h (gates/pause.mjs — e.g. the radio rehearsal);
 *   - the job fired more than 90 min after its nominal time (am 06:00, pm 14:00 PKT): the window is gone;
 *   - STOP exists, the cap is reached, disk is low, or the login is not a subscription (run.mjs preflight/cap).
 * Writes <batchdir>/batch.json.
 */
import { spawnSync, spawn } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "fs";
import path from "path";
import { HOME, REPO } from "../tools/env.mjs";
import { loadWindows, pauseStatus } from "../gates/pause.mjs";
const pktDay = (d = new Date()) => new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 10);   // same rule as gates/cap.mjs (not imported: it runs a CLI on import)

const SIXTY = path.join(REPO, "sixty");
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const window_ = opt("window", "now");
const NOMINAL = { am: 6, pm: 14 };            // PKT hour a window opens
const LATE_MIN = 90, NEED_MIN = 150;
const log = (m) => { const l = `[${new Date().toISOString()}] batch(${window_}): ${m}`; console.log(l); try { appendFileSync(path.join(HOME, "logs/batch.log"), l + "\n"); } catch { /* logs dir */ } };

const day = opt("day", pktDay());
const dir = opt("dir", path.join(HOME, "films", day, window_));
const summary = { window: window_, day, dir, startedAt: new Date().toISOString(), steps: [] };
const done = (status, extra = {}) => {
  Object.assign(summary, { status, endedAt: new Date().toISOString(), ...extra });
  mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, "batch.json"), JSON.stringify(summary, null, 1));
  log(`${status}${extra.reason ? ": " + extra.reason : ""}`); process.exit(status === "film_done" ? 0 : status === "skipped" ? 0 : 2);
};
const run = (label, argv) => {
  log(`▶ ${label}`);
  const r = spawnSync(process.execPath, argv, { stdio: "inherit", env: { ...process.env, ANTHROPIC_API_KEY: "" } });
  summary.steps.push({ step: label, exit: r.status }); return r.status === 0;
};

// ─── guards ─────────────────────────────────────────────────────────────────
if (NOMINAL[window_] !== undefined) {
  const pkt = new Date(Date.now() + 5 * 3600_000);                       // PKT wall clock via UTC+5
  const minsIntoDay = pkt.getUTCHours() * 60 + pkt.getUTCMinutes();
  const late = minsIntoDay - NOMINAL[window_] * 60;
  if (late > LATE_MIN) done("skipped", { reason: `fired ${late} min after the ${window_} window opened (limit ${LATE_MIN}) — the window is gone, not starting` });
  if (late < -30) done("skipped", { reason: `fired ${-late} min BEFORE the ${window_} window — not starting` });
}
const ps = pauseStatus(loadWindows(), Date.now(), NEED_MIN * 60000);
if (ps.paused) done("skipped", { reason: ps.why });
if (existsSync(path.join(HOME, "STOP"))) done("skipped", { reason: `STOP present: ${readFileSync(path.join(HOME, "STOP"), "utf8").split("\n")[0]}` });

// ─── Kokoro (local voice) must be up ────────────────────────────────────────
const kokoroUp = () => spawnSync("curl", ["-s", "-m", "5", "-o", "/dev/null", "-w", "%{http_code}", "http://127.0.0.1:8880/v1/audio/voices"], { encoding: "utf8" }).stdout === "200";
if (!kokoroUp()) {
  log("Kokoro is down — starting it");
  spawn("/bin/bash", [path.join(HOME, "kokoro-start.sh")], { detached: true, stdio: ["ignore", "ignore", "ignore"] }).unref();
  for (let i = 0; i < 45 && !kokoroUp(); i++) spawnSync("sleep", ["2"]);
  if (!kokoroUp()) done("failed", { reason: "local Kokoro did not come up in 90 s" });
}

if (args.includes("--dry-run")) done("skipped", { reason: "dry run: every guard passed; would pick and render one film" });

// ─── 1. pick one story ──────────────────────────────────────────────────────
mkdirSync(dir, { recursive: true });
if (!run("pick", [path.join(SIXTY, "bin/run.mjs"), "pick", "--day", dir, "--films", "1"])) done("failed", { reason: "pick step failed (see runner.log)" });
let pick = null;
try {
  const picks = JSON.parse(readFileSync(path.join(dir, "picks.json"), "utf8")).picks || [];
  const kept = new Set((JSON.parse(readFileSync(path.join(dir, "picks-flat.rule0.json"), "utf8")).kept || []).map((k) => k.id));
  pick = picks.filter((p) => !p.reserve).sort((a, b) => a.rank - b.rank).find((p) => kept.has(p.id))
      || picks.sort((a, b) => a.rank - b.rank).find((p) => kept.has(p.id));          // a reserve only if the main pick was blocked
} catch (e) { done("failed", { reason: `could not read picks: ${e.message}` }); }
if (!pick) done("failed", { reason: "no pick survived the Rule 0 selection gate" });
writeFileSync(path.join(dir, "pick.json"), JSON.stringify(pick, null, 1));
summary.pick = { id: pick.id, title: pick.title };
log(`picked ${pick.id}: ${pick.title}`);

// ─── 2. the film (never posted) ─────────────────────────────────────────────
const filmDir = path.join(dir, "film");
if (!run("film", [path.join(SIXTY, "bin/run.mjs"), "film", "--pick", path.join(dir, "pick.json"), "--dir", filmDir])) done("failed", { reason: "film step failed (see runner.log; a limit stop writes ~/sixty/STOP)" });
const qa = (() => { try { return JSON.parse(readFileSync(path.join(filmDir, "gate-qa.json"), "utf8")); } catch { return null; } })();
const finalOk = existsSync(path.join(filmDir, "final.mp4"));
summary.qaPass = Boolean(qa?.pass); summary.finalMp4 = finalOk;
done("film_done", { film: filmDir, reason: finalOk ? (qa?.pass ? "QA gate passed" : "QA gate did NOT pass — not deliverable") : "no final.mp4" });
