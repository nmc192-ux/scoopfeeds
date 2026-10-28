/**
 * electionReport.js - the dress rehearsal's report for DrJ (#198), in plain English.
 *
 * Read from what the rehearsal left on disk (one folder per hour, as the rolling station writes them) and the
 * station's own record of every 15-minute update. For each hour: did it air the special or fall back, how long
 * producing took, the air check, dead air in the audio plan, every dropped line, and an attribution audit of
 * every electoral line that would have aired. For each update: produced on time, or skipped (and why).
 *
 * Honesty: anything it cannot read is reported as UNMEASURED, never as passing. The verdict is PASS only when
 * every hour aired the special, every update is on air or skipped cleanly (the placeholder aired), nothing is
 * unmeasured, there is no dead air and no attribution violation.
 */
import fs from "node:fs";
import path from "node:path";
import { attributionAudit, audioCoverage, UPDATE_ID } from "./electionNight.js";

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const t = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(11, 19) : "?");
const mins = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? `${Math.round((b - a) / 6000) / 10} min` : "unmeasured");

/** WAV length in seconds from its header (PCM, the producer's format); NaN when unreadable. */
export function wavSeconds(file) {
  try {
    const fd = fs.openSync(file, "r"); const b = Buffer.alloc(4096); fs.readSync(fd, b, 0, 4096, 0); fs.closeSync(fd);
    if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") return NaN;
    let off = 12, byteRate = 0;
    while (off + 8 <= b.length) {
      const id = b.toString("ascii", off, off + 4), size = b.readUInt32LE(off + 4);
      if (id === "fmt ") byteRate = b.readUInt32LE(off + 16);
      if (id === "data") { const dataBytes = Math.min(size, fs.statSync(file).size - off - 8); return byteRate ? dataBytes / byteRate : NaN; }
      off += 8 + size + (size % 2);
    }
    return NaN;
  } catch { return NaN; }
}

/**
 * @param {object} o
 * @param {string} o.airDir           the rehearsal's hour folders
 * @param {object[]} o.hours          RollingStation.run() result
 * @param {object[]} o.updates        RollingStation.updateLog
 * @param {object} o.night            nightWindow() of the rehearsal
 * @param {Function} [o.durationOf]   (absolute file) -> seconds
 * @returns {{ ok: boolean, verdict: string, markdown: string, data: object }}
 */
export function rehearsalReport({ airDir, hours = [], updates = [], night, durationOf = wavSeconds, startedAt = null, endedAt = null }) {
  const issues = [], unmeasured = [];
  const hourRows = [];
  for (const h of hours) {
    const dir = path.join(airDir, h.hour);
    const st = readJson(path.join(dir, "status.json")) || {};
    const prog = readJson(path.join(dir, "programme.json"));
    const segs = readJson(path.join(dir, "segments.json"));
    const pack = readJson(path.join(dir, "pack.json"));
    const checks = readJson(path.join(dir, "checks.json"));
    const row = { hour: h.hour, aired: h.aired, decision: h.decision, reason: h.reason, preparedIn: mins(st.startedAt, st.readyAt), readyAt: st.readyAt, hourStart: h.hourStart,
      airCheck: st.check ? (st.check.ok ? "passed" : `failed: ${st.check.problems.join("; ")}`) : "unmeasured", drops: [], deadAir: null, audit: null };
    if (h.aired !== "programme" || h.decision !== "election-special") issues.push(`${h.hour}: aired ${h.aired === "programme" ? `a ${h.decision} hour` : "the 24/7 headline screen"}${h.reason ? ` (${h.reason})` : ""}, not the special`);
    if (!st.check) unmeasured.push(`${h.hour}: no air check recorded`);
    if (Number.isFinite(st.readyAt) && Number.isFinite(h.hourStart) && st.readyAt > h.hourStart - 15 * 60_000) issues.push(`${h.hour}: ready only at ${t(st.readyAt)}, after its pre-roll started`);
    if (Array.isArray(checks)) row.drops = checks.map((d) => `${d.slot}/${d.line || "-"}: ${d.drop}${d.text ? ` ("${d.text}")` : ""}`);
    else if (h.aired === "programme") unmeasured.push(`${h.hour}: checks.json unreadable (dropped lines unmeasured)`);
    if (prog) {
      const cov = audioCoverage(prog, (f) => durationOf(path.join(dir, f)));
      row.deadAir = cov;
      for (const g of cov.gaps) issues.push(`${h.hour}: dead air ${t(g.from)} to ${t(g.to)} (${g.sec} s)`);
      for (const f of cov.unmeasured) unmeasured.push(`${h.hour}: audio ${f} unreadable (dead air unmeasured)`);
      const slots = (prog.slots || []).map((s) => ({ ...s, segment: /^update-/.test(s.id) ? "update" : /^results-/.test(s.id) ? "results" : s.id === "roundup" ? "roundup" : s.id === "counting" ? "counting" : s.id.startsWith("compared") ? "compared" : null }));
      if (segs && pack) {
        row.audit = attributionAudit(segs, slots.filter((s) => s.segment && !(s.insert && UPDATE_ID.test(s.id))), pack);   // spliced updates are audited from their own file
        for (const v of row.audit.violations) issues.push(`${h.hour} ${v.slot}/${v.line}: ${v.why}: "${v.text}"`);
      } else if (h.aired === "programme") unmeasured.push(`${h.hour}: segments.json or pack.json unreadable (attribution unmeasured)`);
    } else if (h.aired === "programme") unmeasured.push(`${h.hour}: programme.json unreadable`);
    // every spliced update, audited against the pack it was written from
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /^update-update-\d\d-.*\.json$/.test(n)) : []) {
      const u = readJson(path.join(dir, f));
      if (!u) { unmeasured.push(`${h.hour}: ${f} unreadable`); continue; }
      const a = attributionAudit({ [u.slot.id]: u.checked }, [u.slot], { election: u.pack?.election });
      row.audit = row.audit ? { lines: row.audit.lines + a.lines, results: row.audit.results + a.results, violations: [...row.audit.violations, ...a.violations] } : a;
      for (const v of a.violations) issues.push(`${h.hour} ${v.slot}/${v.line}: ${v.why}: "${v.text}"`);
      row.drops.push(...(u.drops || []).map((d) => `${u.slot.id} (update at ${t(u.at)})/${d.line || "-"}: ${d.drop}${d.text ? ` ("${d.text}")` : ""}`));
    }
    hourRows.push(row);
  }
  const upd = updates.map((u) => ({ ...u, clean: u.result === "on air" || u.result === "skipped" }));
  const onAir = upd.filter((u) => u.result === "on air").length, skipped = upd.filter((u) => u.result === "skipped");
  for (const u of upd) if (u.result === "on air" && !(u.finishedAt <= u.airsAt)) issues.push(`${u.hour} ${u.slot}: spliced after it started airing`);
  const expected = hours.filter((h) => h.decision === "election-special").length * 4;
  if (upd.length < expected) unmeasured.push(`${expected - upd.length} of ${expected} update slots have no record`);
  const ok = !issues.length && !unmeasured.length && hours.length > 0;
  const verdict = !hours.length ? "NOT RUN: no hour was recorded" : ok ? "PASS" : issues.length ? "FAIL" : "UNVERIFIED";

  const L = [];
  L.push(`# Election night dress rehearsal: ${verdict}`, "");
  L.push(`Rehearsal of the 3 November election night special, moved to ${new Date(night.from).toISOString().slice(0, 16)} UTC, ${hours.length} hour(s), recorded to disk only (nothing streamed). Projections came from the fixture file, not real results.${startedAt ? ` Ran ${t(startedAt)} to ${t(endedAt)} UTC.` : ""}`, "");
  L.push("## In short", "");
  L.push(`- Hours that aired the special: ${hours.filter((h) => h.aired === "programme" && h.decision === "election-special").length} of ${hours.length}.`);
  L.push(`- 15-minute updates: ${onAir} produced on time, ${skipped.length} skipped cleanly (the placeholder aired), out of ${upd.length} recorded${expected ? ` (${expected} expected)` : ""}.`);
  L.push(`- Dead air: ${hourRows.some((r) => r.deadAir?.gaps.length) ? "FOUND (see below)" : hourRows.every((r) => r.deadAir && !r.deadAir.unmeasured.length) ? "none in the audio plan" : "partly unmeasured"}.`);
  const audited = hourRows.reduce((n, r) => n + (r.audit?.lines || 0), 0), viol = hourRows.reduce((n, r) => n + (r.audit?.violations.length || 0), 0);
  L.push(`- Attribution: ${audited} electoral lines re-checked, ${viol} without a named projecting organisation and a matching projection.`);
  L.push(`- Lines dropped by the checks: ${hourRows.reduce((n, r) => n + r.drops.length, 0)}.`, "");
  if (issues.length) L.push("## Problems", "", ...issues.map((x) => `- ${x}`), "");
  if (unmeasured.length) L.push("## Not measured (counts against a pass)", "", ...unmeasured.map((x) => `- ${x}`), "");
  L.push("## Hour by hour", "");
  for (const r of hourRows) {
    L.push(`### ${r.hour}:00 UTC: ${r.aired === "programme" ? `aired (${r.decision})` : `24/7 screen (${r.reason})`}`, "");
    L.push(`- Producing took ${r.preparedIn}; ready at ${t(r.readyAt)}. Air check: ${r.airCheck}.`);
    L.push(`- Dead air: ${!r.deadAir ? "unmeasured" : r.deadAir.gaps.length ? r.deadAir.gaps.map((g) => `${t(g.from)}-${t(g.to)}`).join(", ") : r.deadAir.unmeasured.length ? "partly unmeasured" : "none"}.`);
    L.push(`- Attribution: ${r.audit ? `${r.audit.lines} electoral lines, ${r.audit.violations.length} violation(s)` : "unmeasured"}.`);
    for (const u of upd.filter((x) => x.hour === r.hour)) L.push(`- ${u.slot} (airs ${t(u.airsAt)}): ${u.result}${u.result === "on air" ? `, ready ${u.marginSec} s before air, ${u.writer} writer` : ""}${u.reason ? `, ${u.reason}` : ""}.`);
    if (r.drops.length) L.push(`- Dropped lines (${r.drops.length}):`, ...r.drops.slice(0, 40).map((d) => `  - ${d}`), ...(r.drops.length > 40 ? [`  - ...and ${r.drops.length - 40} more (all in checks.json)`] : []));
    L.push("");
  }
  L.push("To check on the Mac: listen to one recorded update and one poll-closing call-out; the timings above come from the station's own clock.");
  return { ok, verdict, markdown: L.join("\n"), data: { verdict, hours: hourRows, updates: upd, issues, unmeasured } };
}
