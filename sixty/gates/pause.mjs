#!/usr/bin/env node
/**
 * pause.mjs — pause windows for 60 · (DrJ, 13 Oct 2026: the radio test-hour rehearsal takes priority on this Mac).
 * Hard gate, outside the agents.
 *
 *   node sixty/gates/pause.mjs check [--need-minutes N]   exit 0 = may start; 7 = paused (or a window opens within N minutes)
 *   node sixty/gates/pause.mjs list
 *   node sixty/gates/pause.mjs add --from <ISO with offset> [--to <ISO|none>] --reason "..."
 *   node sixty/gates/pause.mjs clear                      remove every window (resume)
 *
 * ~/sixty/pause.json = { "windows": [{ "from": "2026-10-14T10:00:00+05:00", "to": null, "reason": "..." }] }
 * `to: null` = open-ended: it pauses until you clear it. Nothing is ever killed mid-run: a pause stops NEW
 * starts, and a batch also refuses to start a film that would run into a window (a film takes about an hour).
 */
import { HOME } from "../tools/env.mjs";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const PAUSE_FILE = path.join(HOME, "pause.json");

export function loadWindows(file = PAUSE_FILE) {
  if (!existsSync(file)) return [];
  const j = JSON.parse(readFileSync(file, "utf8"));
  return (j.windows || []).map((w) => ({ ...w, fromMs: Date.parse(w.from), toMs: w.to ? Date.parse(w.to) : Infinity }));
}

/** { paused, why }: paused if `now` is inside a window, or a window opens within `needMs` from now. */
export function pauseStatus(windows, now = Date.now(), needMs = 0) {
  for (const w of windows) {
    if (!Number.isFinite(w.fromMs)) return { paused: true, why: `pause window with an unreadable "from" (${w.from}) — treated as paused` };
    if (now >= w.fromMs && now < w.toMs) return { paused: true, why: `paused: ${w.reason || "pause window"} (since ${w.from}${w.to ? ` until ${w.to}` : ", until cleared"})` };
    if (needMs > 0 && w.fromMs > now && w.fromMs - now < needMs) return { paused: true, why: `a pause window opens at ${w.from} (${w.reason || "pause"}) — less than ${Math.round(needMs / 60000)} min away, not starting a film that would run into it` };
  }
  return { paused: false, why: "" };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (k, d = null) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : d; };
  if (cmd === "check") {
    const s = pauseStatus(loadWindows(), Date.now(), Number(opt("need-minutes", 0)) * 60000);
    if (s.paused) { console.log(s.why); process.exit(7); }
    console.log("not paused");
  } else if (cmd === "list") {
    console.log(JSON.stringify(loadWindows().map(({ from, to, reason }) => ({ from, to, reason })), null, 1));
  } else if (cmd === "add") {
    const from = opt("from"), to = opt("to", "none"), reason = opt("reason", "");
    if (!from || !Number.isFinite(Date.parse(from))) { console.error("add: --from <ISO date-time with offset> is required"); process.exit(1); }
    if (to !== "none" && !Number.isFinite(Date.parse(to))) { console.error("add: --to must be an ISO date-time or none"); process.exit(1); }
    const cur = existsSync(PAUSE_FILE) ? JSON.parse(readFileSync(PAUSE_FILE, "utf8")) : { windows: [] };
    cur.windows.push({ from, to: to === "none" ? null : to, reason });
    writeFileSync(PAUSE_FILE, JSON.stringify(cur, null, 1) + "\n"); console.log(`added: ${from} → ${to}  ${reason}`);
  } else if (cmd === "clear") {
    writeFileSync(PAUSE_FILE, JSON.stringify({ windows: [] }, null, 1) + "\n"); console.log("pause windows cleared");
  } else { console.error("usage: pause.mjs check [--need-minutes N] | list | add --from ISO [--to ISO|none] --reason ... | clear"); process.exit(1); }
}
