/**
 * liveSafetyGate.js - DrJ's media rule (#218) for LIVE feeds: a delay buffer between the feed and air.
 *
 * Every live feed (official channels included: a UN Security Council session or a defence briefing can
 * show war footage) reaches air only through this gate:
 *
 *   capture -> push(frame|audio, ts) -> [ delay buffer, delayMs ] -> release() -> air
 *                         \-> sampled (>= 1 frame / sampleEveryMs, audio in windows) -> check()
 *
 * A buffered item is released only when BOTH
 *   1. it has waited delayMs (60 s by default), and
 *   2. every track's checks have cleared it: the newest consecutively-"safe" sample of each track is at
 *      or after its timestamp (the "watermark").
 * So if the checker is down, slow or behind the buffer, the watermark stops and nothing airs. If an item
 * has waited maxBehindMs past the delay without being cleared, the feed is cut (below) rather than
 * aired late; a check that fails cuts it at once.
 *
 * On a hit (unsafe, unsure, or a check that threw / timed out - unmeasured is a FAIL) at sample time t:
 *   - the gate CUTS: everything still buffered is discarded, so no frame at or after t (and nothing after
 *     the last cleared sample) ever airs; `onCut` tells the playout to switch to the normal grid and the
 *     music bed;
 *   - the feed stays off for the rest of the event: every later push is dropped, until resume() - DrJ's
 *     decision, never automatic;
 *   - the cut is logged with the reason and the timestamps.
 *
 * Pure apart from the injected check(): time comes from the caller, so tests drive it with a fake clock.
 * NOT WIRED INTO THE PLAYOUT YET: the live events desk (PR #211) owns that code. It must route its picture
 * hub and audio feeder through release() before RADIO_LIVE_ENABLED can be switched on.
 */
export const LIVE_DEFAULTS = Object.freeze({
  delayMs: 60_000,          // proposed in #218; the measured on-air delay is reported by stats()
  sampleEveryMs: 1_000,     // at least one frame per second goes to the checker
  audioWindowMs: 5_000,     // audio is checked in windows of this length
  checkTimeoutMs: 20_000,   // a check slower than this is a failure (unmeasured)
  maxBehindMs: 10_000,      // checks this far behind the buffer: the feed is cut, not aired late
});

export function createLiveSafetyGate({
  feedId = "live",
  check,                       // async ({ track: "video"|"audio", ts, endTs, data }) -> { verdict, categories?, note? }
  tracks = ["video", "audio"], // a feed without sound passes ["video"]
  delayMs = LIVE_DEFAULTS.delayMs,
  sampleEveryMs = LIVE_DEFAULTS.sampleEveryMs,
  audioWindowMs = LIVE_DEFAULTS.audioWindowMs,
  checkTimeoutMs = LIVE_DEFAULTS.checkTimeoutMs,
  maxBehindMs = LIVE_DEFAULTS.maxBehindMs,
  onCut = () => {},
  log = () => {},
} = {}) {
  if (typeof check !== "function") throw new Error("live safety gate needs a check()");
  const buffer = [];                         // { track, ts, data } in push order
  const wm = Object.fromEntries(tracks.map((t) => [t, -Infinity]));   // cleared-through timestamp per track
  const queue = Object.fromEntries(tracks.map((t) => [t, []]));       // pending samples, in time order
  const lastSampled = Object.fromEntries(tracks.map((t) => [t, -Infinity]));
  const audioWin = { start: null, chunks: [] };
  const pending = new Set();
  let cut = null;            // { at, reason, ... } once cut
  let held = false;          // off for the rest of the event
  let released = 0, dropped = 0, maxDelaySeenMs = 0, minDelaySeenMs = Infinity;

  function sample(track, ts, endTs, data) {
    const s = { track, ts, endTs, status: "pending", result: null };
    queue[track].push(s);
    let timer;
    const p = Promise.race([
      Promise.resolve().then(() => check({ feedId, track, ts, endTs, data })),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`check timed out after ${checkTimeoutMs} ms`)), checkTimeoutMs); timer.unref?.(); }),
    ]).then((r) => { s.status = "done"; s.result = r; }, (e) => { s.status = "done"; s.result = { verdict: null, error: e?.message || String(e) }; })
      .then(() => { clearTimeout(timer); pending.delete(p); advance(track); });
    pending.add(p);
  }

  function advance(track) {
    const q = queue[track];
    while (q.length && q[0].status === "done") {
      const s = q.shift();
      const r = s.result || {};
      const cats = Array.isArray(r.categories) ? r.categories.filter(Boolean) : [];
      if (r.verdict === "safe" && !cats.length) { wm[track] = Math.max(wm[track], s.endTs ?? s.ts); continue; }
      const reason = r.error ? `checker failed: ${r.error}` : r.verdict === "unsafe" ? `flagged${cats.length ? ` (${cats.join(", ")})` : ""}`
        : r.verdict === "unsure" ? "checker unsure" : `no usable verdict (${JSON.stringify(r.verdict ?? null)})`;
      doCut({ track, at: s.ts, reason, categories: cats, note: r.note || null, kind: r.error ? "checker-failure" : "hit" });
      return;
    }
  }

  function doCut({ track, at, reason, categories = [], note = null, kind }) {
    if (held) return;
    held = true;
    const discarded = buffer.length;
    buffer.length = 0;
    for (const t of tracks) queue[t].length = 0;
    cut = { type: "live-cut", feedId, kind, track, flaggedAt: at, reason, categories, note, discarded, lastClearedAt: { ...wm } };
    log(cut);
    onCut(cut);
  }

  return {
    /** A captured video frame or audio chunk with its capture time (ms). Audio chunks carry endTs. */
    push(track, ts, data, { endTs = ts } = {}) {
      if (!(track in wm)) throw new Error(`unknown track ${track}`);
      if (held) { dropped++; return false; }
      buffer.push({ track, ts, endTs, data });
      if (track === "audio") {
        if (audioWin.start == null) audioWin.start = ts;
        audioWin.chunks.push({ ts, endTs, data });
        if (endTs - audioWin.start >= audioWindowMs) {
          sample("audio", audioWin.start, endTs, audioWin.chunks);
          audioWin.start = null; audioWin.chunks = [];
        }
      } else if (ts - lastSampled[track] >= sampleEveryMs || !Number.isFinite(lastSampled[track])) {
        lastSampled[track] = ts;
        sample(track, ts, ts, data);
      }
      return true;
    },
    /**
     * What may go to air now: items older than delayMs and inside every track's cleared watermark,
     * in push order. Stops at the first item that may not go yet, so order is never broken.
     */
    release(nowMs) {
      const out = [];
      if (held) return out;
      // A frame between two samples airs only once the LATER sample is cleared: its bar is "watermark >= its ts".
      if (buffer.length && nowMs - buffer[0].ts > delayMs + maxBehindMs) {
        doCut({ track: buffer[0].track, at: buffer[0].ts, reason: `checks are ${Math.round((nowMs - buffer[0].ts - delayMs) / 1000)} s behind the ${delayMs / 1000} s buffer`, kind: "checker-behind" });
        return out;
      }
      const bar = Math.min(...tracks.map((t) => wm[t]));
      while (buffer.length) {
        const it = buffer[0];
        if (nowMs - it.ts < delayMs) break;
        if ((it.endTs ?? it.ts) > bar) break;
        buffer.shift();
        released++;
        const d = nowMs - it.ts;
        maxDelaySeenMs = Math.max(maxDelaySeenMs, d); minDelaySeenMs = Math.min(minDelaySeenMs, d);
        out.push(it);
      }
      return out;
    },
    /** True when the feed may be on air at all (not cut, not held). */
    get onAir() { return !held; },
    get cut() { return cut; },
    /** DrJ resumes the feed by hand. Everything starts fresh: nothing from before the cut can air. */
    resume({ by = "DrJ", note = null } = {}) {
      if (!held) return false;
      log({ type: "live-resume", feedId, by, note, cut });
      held = false; cut = null;
      buffer.length = 0;
      for (const t of tracks) { queue[t].length = 0; wm[t] = -Infinity; lastSampled[t] = -Infinity; }
      audioWin.start = null; audioWin.chunks = [];
      return true;
    },
    /** For tests: wait for every in-flight check. */
    async drain() { while (pending.size) await Promise.all([...pending]); },
    stats() {
      return { feedId, buffered: buffer.length, released, dropped, watermark: { ...wm }, held,
        delayMsConfigured: delayMs, measuredDelayMs: released ? { min: minDelaySeenMs, max: maxDelaySeenMs } : null };
    },
  };
}
