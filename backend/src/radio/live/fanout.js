/**
 * fanout.js - one encode, several live destinations, each failing on its own (#207, the per-output part of #196).
 *
 *   encoder ffmpeg --FLV on stdout--> FlvSplitter --whole tags--> relay ffmpeg (copy) --> YouTube
 *                                                             \--> relay ffmpeg (copy) --> X
 *
 * Why relays and not ffmpeg's tee muxer: tee's onfail=ignore drops a dead output but never brings it back, and it
 * cannot give each output its own I/O timeout. Here each destination is its own small `-c copy` ffmpeg, so:
 *   - a dead link (rw_timeout, a muxer write error, a crash) takes down only that relay, which reconnects with
 *     backoff (1 s doubling to 30 s, reset after 60 s healthy);
 *   - a relay whose uplink stalls is cut loose once its queued bytes pass HARD_BACKLOG instead of slowing the encoder;
 *   - a (re)connecting relay is sent the FLV header, onMetaData and the codec headers, then joins at the next keyframe.
 *
 * Priority under stress: while a primary output is reconnecting or backing up, every secondary output is dropped
 * ("shed") for SHED_COOLDOWN_MS so the uplink goes to the primaries. Today's destinations are all primary
 * (YouTube + X), so this only acts once a secondary (Facebook, Twitch) is added to destinations.js.
 *
 * Planned restarts: an output with maxDurationSec is marked due RESTART_MARGIN_SEC before its cap and restarted at
 * the next boundary() call (the playout calls it at programme part and daypart changes, never mid-part). If no
 * boundary comes, it is restarted HARD_MARGIN_SEC before the cap anyway (the platform would end it a minute later).
 *
 * Health: status() per output (live / connecting / reconnecting / shed / restarting / off), written to `statusFile`
 * every few seconds, and a "primary-down" event once a primary has been off air for ALERT_AFTER_MS.
 * Keys never reach a log line or the status file: everything passes through `redact`.
 */
import { spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { buildRelayArgs } from "../playout/ffmpegArgs.js";

export const FANOUT = Object.freeze({
  LIVE_AFTER_MS: 3000,             // a relay forwarding this long without failing counts as live
  HEALTHY_RESET_MS: 60_000,        // live this long: the reconnect backoff starts again from 1 s
  BACKOFF_MAX_MS: 30_000,
  SOFT_BACKLOG: 1 * 1024 * 1024,   // ~2 s of a 4.6 Mbps stream queued: that output is degraded
  HARD_BACKLOG: 4 * 1024 * 1024,   // ~7 s queued: the uplink to it is stalled; drop it and reconnect
  SHED_COOLDOWN_MS: 10 * 60_000,
  ALERT_AFTER_MS: 5 * 60_000,      // DrJ, #207: alert only when a primary is down for more than 5 minutes
  RESTART_MARGIN_SEC: 10 * 60,
  HARD_MARGIN_SEC: 60,
  TICK_MS: 1000,
  STATUS_EVERY_MS: 5000,
});

export const backoffMs = (failures) => Math.min(FANOUT.BACKOFF_MAX_MS, 1000 * 2 ** Math.max(0, failures - 1));

/** ffmpeg prints this when an output can no longer be written (same test as the single-output path). */
const STALL_RE = /uplink stalled|timed out|Input\/output error|rw_timeout/i;
const isFatal = (text) => /Error (submitting a packet to the muxer|muxing a packet)|Broken pipe|Connection (refused|reset)|Input\/output error/.test(String(text));

/**
 * Splits a growing FLV byte stream into whole tags and remembers what a late joiner needs: the 13-byte file header,
 * the onMetaData script tag and the AVC / AAC sequence headers.
 */
export class FlvSplitter {
  constructor() { this.buf = Buffer.alloc(0); this.header = null; this.meta = null; this.avcSeq = null; this.aacSeq = null; }
  /** @returns {Array<{ type: number, tag: Buffer, keyframe: boolean, init: boolean }>} */
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out = [];
    if (!this.header) {
      if (this.buf.length < 13) return out;
      if (this.buf.toString("latin1", 0, 3) !== "FLV") throw new Error("encoder output is not FLV");
      const off = this.buf.readUInt32BE(5);
      if (this.buf.length < off + 4) return out;
      this.header = Buffer.from(this.buf.subarray(0, off + 4));
      this.buf = this.buf.subarray(off + 4);
    }
    while (this.buf.length >= 11) {
      const size = this.buf.readUIntBE(1, 3);
      const total = 11 + size + 4;
      if (this.buf.length < total) break;
      const tag = Buffer.from(this.buf.subarray(0, total));
      this.buf = this.buf.subarray(total);
      const type = tag[0] & 0x1f;
      const d0 = tag[11], d1 = tag[12];
      let keyframe = false, init = false;
      if (type === 18) { this.meta = tag; init = true; }
      else if (type === 9 && (d0 & 0x0f) === 7) {
        if (d1 === 0) { this.avcSeq = tag; init = true; }
        else keyframe = (d0 >> 4) === 1;
      } else if (type === 8 && (d0 >> 4) === 10 && d1 === 0) { this.aacSeq = tag; init = true; }
      out.push({ type, tag, keyframe, init });
    }
    return out;
  }
  /** What a relay that joins now is sent before its first keyframe. */
  initSegment() {
    return Buffer.concat([this.header, this.meta, this.avcSeq, this.aacSeq].filter(Boolean));
  }
}

/**
 * @param {{ outputs: Array<{id,label,priority,maxDurationSec,url}>, ffmpeg?: string, spawn?: Function,
 *           log?: Function, redact?: Function, statusFile?: string|null, now?: Function, relayArgs?: Function }} o
 */
export function createFanout(o) {
  const spawn = o.spawn || nodeSpawn;
  const log = o.log || (() => {});
  const redact = o.redact || ((s) => String(s));
  const now = o.now || Date.now;
  const relayArgs = o.relayArgs || buildRelayArgs;
  const ev = new EventEmitter();
  const split = new FlvSplitter();
  let stopped = false, lastStatusAt = 0;

  const outs = o.outputs.map((d) => ({
    id: d.id, label: d.label, priority: d.priority === "secondary" ? "secondary" : "primary", maxDurationSec: d.maxDurationSec ?? null, url: d.url,
    state: "connecting", since: now(), proc: null, waitingKey: true, forwardingSince: null, liveSince: null,
    failures: 0, restarts: 0, lastError: null, retryAt: 0, downSince: now(), alerted: false, restartDue: false, shedUntil: 0, expect: null, stallAt: null,
  }));

  const setState = (out, state) => { if (out.state !== state) { out.state = state; out.since = now(); } };

  function spawnRelay(out) {
    if (stopped) return;
    out.waitingKey = true; out.forwardingSince = null; out.liveSince = null; out.expect = null;
    setState(out, out.state === "restarting" ? "restarting" : "connecting");
    let proc;
    try { proc = spawn(o.ffmpeg || "ffmpeg", relayArgs({ url: out.url }), { stdio: ["pipe", "ignore", "pipe"] }); }
    catch (e) { out.proc = null; return fail(out, `relay spawn failed: ${e.message}`); }
    out.proc = proc;
    let tail = "";
    proc.stdin.on("error", () => { /* relay ended first; its exit handler reports it */ });
    proc.stderr?.on("data", (d) => {
      tail = (tail + d).slice(-2000);
      if (out.proc === proc && !out.expect && isFatal(d)) { try { proc.kill("SIGKILL"); } catch { /* gone */ } fail(out, `output failed: ${String(d).trim().split("\n")[0]}`); }
    });
    proc.on("error", (e) => { if (out.proc === proc) fail(out, `relay error: ${e.message}`); });
    proc.on("exit", (code, sig) => {
      if (out.proc !== proc) return;
      out.proc = null;
      const why = out.expect; out.expect = null;
      if (stopped || why === "stop") { setState(out, "off"); return; }
      if (why === "shed") { setState(out, "shed"); return; }
      if (why === "restart") { log(`${out.label}: planned restart; reconnecting now`); out.restarts++; return spawnRelay(out); }
      fail(out, `relay exited code=${code} signal=${sig}${tail ? `: ${tail.trim().split("\n").pop()}` : ""}`);
    });
  }

  function fail(out, reason) {
    if (out.proc) { const p = out.proc; out.proc = null; try { p.kill("SIGKILL"); } catch { /* gone */ } }
    if (stopped) return;
    out.failures++;
    out.lastError = redact(reason);
    if (STALL_RE.test(reason)) out.stallAt = now();
    out.retryAt = now() + backoffMs(out.failures);
    out.downSince ??= now();
    out.liveSince = null; out.forwardingSince = null;
    setState(out, "reconnecting");
    log(`${out.label}: ${out.lastError}; reconnecting in ${Math.round(backoffMs(out.failures) / 1000)} s (only this output; the others are untouched)`);
  }

  /** End a running relay on purpose. `why`: "restart" | "shed" | "stop". SIGINT first so the platform sees a clean end. */
  function endRelay(out, why) {
    const p = out.proc;
    if (!p) { if (why === "restart") { out.restarts++; spawnRelay(out); } else setState(out, why === "shed" ? "shed" : "off"); return; }
    out.expect = why;
    if (why === "restart") setState(out, "restarting");
    try { p.stdin.end(); } catch { /* closed */ }
    try { p.kill("SIGINT"); } catch { /* gone */ }
    setTimeout(() => { if (out.proc === p) { try { p.kill("SIGKILL"); } catch { /* gone */ } } }, 3000).unref?.();
  }

  function write(chunk) {
    if (stopped) return;
    let tags;
    try { tags = split.push(chunk); } catch (e) { log(`fan-out: ${e.message}`); return; }
    for (const t of tags) {
      for (const out of outs) {
        const p = out.proc;
        if (!p || out.expect || !p.stdin.writable) continue;
        if (out.waitingKey) {
          if (!t.keyframe) continue;
          p.stdin.write(split.initSegment());
          out.waitingKey = false; out.forwardingSince = now();
        }
        p.stdin.write(t.tag);
        if (p.stdin.writableLength > FANOUT.HARD_BACKLOG) fail(out, `uplink stalled: ${Math.round(p.stdin.writableLength / 1024)} KB queued`);
      }
    }
  }

  // Uplink stress, not "the far end is down": a primary backing up, or one that failed on a stall / write timeout in the
  // last minute. A primary refused by its platform (wrong key, server down) does not cost the secondaries their slot.
  const distressed = (out) => (out.proc && out.proc.stdin.writableLength > FANOUT.SOFT_BACKLOG) || (out.stallAt && now() - out.stallAt < 60_000);

  function tick() {
    if (stopped) return;
    const t = now();
    const primaryDistress = outs.some((x) => x.priority === "primary" && distressed(x));
    for (const out of outs) {
      // reconnect after backoff
      if (out.state === "reconnecting" && !out.proc && t >= out.retryAt) spawnRelay(out);
      // connecting -> live
      if (out.proc && !out.expect && out.forwardingSince !== null && out.liveSince === null && t - out.forwardingSince >= FANOUT.LIVE_AFTER_MS) {
        out.liveSince = t; out.downSince = null;
        if (out.alerted) log(`${out.label}: back on air`);
        out.alerted = false;
        setState(out, "live");
        log(`${out.label}: live`);
      }
      if (out.liveSince !== null && t - out.liveSince >= FANOUT.HEALTHY_RESET_MS) out.failures = 0;
      // primary down too long: one alert per outage
      if (out.priority === "primary" && out.downSince !== null && !out.alerted && t - out.downSince > FANOUT.ALERT_AFTER_MS) {
        out.alerted = true;
        ev.emit("primary-down", { id: out.id, label: out.label, downMs: t - out.downSince, lastError: out.lastError });
      }
      // stress: drop secondaries while a primary struggles; bring them back after the cooldown
      if (out.priority === "secondary") {
        if (primaryDistress && out.state !== "shed" && out.expect !== "shed") {
          log(`${out.label}: dropped to keep the primary outputs up (a primary is reconnecting or backing up)`);
          out.shedUntil = t + FANOUT.SHED_COOLDOWN_MS;
          endRelay(out, "shed");
        } else if (out.state === "shed" && !out.proc && t >= out.shedUntil && !primaryDistress) {
          log(`${out.label}: cooldown over; reconnecting`);
          spawnRelay(out);
        }
      }
      // platform duration cap
      if (out.maxDurationSec && out.liveSince !== null && !out.expect) {
        const up = (t - out.liveSince) / 1000;
        if (!out.restartDue && up >= out.maxDurationSec - FANOUT.RESTART_MARGIN_SEC) { out.restartDue = true; log(`${out.label}: ${Math.round(up / 60)} min on air; restart due at the next segment boundary`); }
        if (up >= out.maxDurationSec - FANOUT.HARD_MARGIN_SEC) { log(`${out.label}: no segment boundary before the ${out.maxDurationSec / 3600} h cap; restarting now`); out.restartDue = false; endRelay(out, "restart"); }
      }
    }
    if (o.statusFile && t - lastStatusAt >= FANOUT.STATUS_EVERY_MS) writeStatus();
  }

  function status() {
    return outs.map((x) => ({
      id: x.id, label: x.label, priority: x.priority,
      state: x.state,
      since: x.since, liveSince: x.liveSince, restarts: x.restarts, failures: x.failures,
      lastError: x.lastError, backlogBytes: x.proc ? x.proc.stdin.writableLength : 0,
    }));
  }
  /** Platform status in three words for reports: live / reconnecting / off. */
  function summary() {
    return Object.fromEntries(outs.map((x) => [x.id, x.state === "live" ? "live" : x.state === "shed" || x.state === "off" ? "off" : "reconnecting"]));
  }

  function writeStatus() {
    lastStatusAt = now();
    try {
      const body = redact(JSON.stringify({ updatedAt: lastStatusAt, summary: summary(), outputs: status() }, null, 1));
      const tmp = `${o.statusFile}.tmp`;
      fs.mkdirSync(path.dirname(o.statusFile), { recursive: true });
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, o.statusFile);
    } catch { /* best effort */ }
  }

  /** A segment boundary: restart every output whose duration cap is near. Never touches the others. */
  function boundary() {
    for (const out of outs) if (out.restartDue && out.proc && !out.expect) { out.restartDue = false; log(`${out.label}: restarting at a segment boundary before its cap`); endRelay(out, "restart"); }
  }

  /**
   * Restart one output now, by id (#196: the stream watch saw YouTube report no data). Only that relay is touched;
   * the encoder and every other output keep running. Returns false for an unknown, shed or stopped output.
   */
  function restart(id) {
    const out = outs.find((x) => x.id === id);
    if (!out || stopped || out.state === "shed" || out.expect) return false;
    log(`${out.label}: restart requested (only this output)`);
    if (out.proc) endRelay(out, "restart");
    else { out.retryAt = now(); spawnRelay(out); }
    return true;
  }

  async function stop() {
    if (stopped) return;
    const procs = outs.map((x) => x.proc).filter(Boolean);
    for (const out of outs) if (out.proc) endRelay(out, "stop"); else setState(out, "off");
    stopped = true;
    clearInterval(timer);
    await Promise.all(procs.map((p) => new Promise((r) => { if (p.exitCode !== null || p.signalCode) return r(); p.once("exit", r); setTimeout(r, 4000).unref?.(); })));
    for (const out of outs) setState(out, "off");
    if (o.statusFile) writeStatus();
  }

  const timer = setInterval(tick, FANOUT.TICK_MS);
  timer.unref?.();
  for (const out of outs) spawnRelay(out);
  log(`fan-out to ${outs.map((x) => `${x.label} (${x.priority})`).join(", ")}`);

  return { write, boundary, restart, status, summary, stop, tick, on: (e, f) => ev.on(e, f), get outputs() { return outs; } };
}
