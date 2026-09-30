#!/usr/bin/env node
/**
 * cap.mjs — the daily film cap and the stop switch. Hard gate, outside the agents.
 *
 *   node sixty/gates/cap.mjs check            exit 0 = may start a film; 5 = STOP file present; 6 = cap reached
 *   node sixty/gates/cap.mjs record <filmId> <status>
 *
 * Cap = min(6, SIXTY_FILMS_PER_DAY). The 6 is DrJ's interim ceiling (30 Sep 2026) and
 * cannot be raised by env. The day is Pakistan time. Every STARTED film counts,
 * finished or not: usage is spent either way. ~/sixty/STOP (written by the runner on
 * any usage-limit message) blocks everything until DrJ deletes it.
 */
import "../tools/env.mjs";
import { HOME } from "../tools/env.mjs";
import { existsSync, readFileSync, appendFileSync } from "fs";
import path from "path";

export const HARD_MAX = 6;
export const cap = () => Math.max(0, Math.min(HARD_MAX, Number(process.env.SIXTY_FILMS_PER_DAY ?? HARD_MAX) || 0));
export const pktDay = (d = new Date()) => new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
const LEDGER = path.join(HOME, "ledger.jsonl");
const STOP = path.join(HOME, "STOP");

export function startedToday(day = pktDay()) {
  if (!existsSync(LEDGER)) return 0;
  return readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => e.day === day && e.status === "started").length;
}

const [cmd, id, status] = process.argv.slice(2);
if (cmd === "check") {
  if (existsSync(STOP)) { console.log(JSON.stringify({ gate: "cap", ok: false, why: `STOP: ${readFileSync(STOP, "utf8").trim().slice(0, 200)}` })); process.exit(5); }
  const n = startedToday(), c = cap();
  console.log(JSON.stringify({ gate: "cap", ok: n < c, startedToday: n, cap: c }));
  process.exit(n < c ? 0 : 6);
} else if (cmd === "record") {
  appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), day: pktDay(), film: id, status, test: process.env.SIXTY_TEST === "1" }) + "\n");
} else if (cmd) { console.error("usage: cap.mjs check | record <filmId> <status>"); process.exit(1); }
