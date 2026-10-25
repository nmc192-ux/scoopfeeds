/**
 * liveDesk.js - switch the radio to an official live feed at its start time, and back (#202 item 3).
 *
 *   grid ──(event start, allow-listed, pre-air check passes)──> LIVE · <publisher> ──(event end, or no
 *   media for 30 s)──> grid
 *
 * The desk decides; the playout unit does the switching (playout.js goLive/endLive): the feed's
 * picture is framed in our Signal layout with "LIVE · <publisher>" and our lower thirds, its sound
 * replaces the music bed. Our encoder, our RTMP connection (and the X simulcast fed from it) are
 * never touched.
 *
 * Every carry, refusal and return is written to the live log. An event that ended or dropped is not
 * re-joined automatically (no flapping between the feed and the grid on a bad connection); put it in
 * the manual file again to retry.
 */
import { OFFICIAL_FEEDS, assertCanAir, feedById, creditFor } from "./officialFeeds.js";
import { airsAutomatically } from "./eventsCalendar.js";

export const DROP_MS = 30_000;
export const TICK_MS = 5_000;

export function liveEnabled(env = process.env) {
  return String(env.RADIO_LIVE_ENABLED || "").trim().toLowerCase() === "true";
}

/**
 * Pure decision. state: { mode: "grid"|"live", event?, lastMediaAt? }, done: Set of event ids.
 * Returns { action: "stay" } | { action: "go-live", event } | { action: "end", reason }.
 */
export function decide({ now, events, state, done = new Set(), feeds = OFFICIAL_FEEDS, dropMs = DROP_MS }) {
  if (state.mode === "live") {
    if (now >= state.event.end) return { action: "end", reason: "scheduled-end" };
    if (now - (state.lastMediaAt ?? state.startedAt ?? now) >= dropMs) return { action: "end", reason: "feed-dropped" };
    return { action: "stay" };
  }
  const due = events.find((e) => !done.has(e.id) && e.start <= now && now < e.end && airsAutomatically(e, feeds));
  return due ? { action: "go-live", event: due } : { action: "stay" };
}

/**
 * @param {{ unit: () => ({ goLive: Function, endLive: Function } | null), calendar: () => Promise<object[]>,
 *           probe: (url: string) => Promise<object>, log: { write: Function }, say?: Function,
 *           now?: () => number, feeds?: object[], dropMs?: number }} deps
 */
export function createLiveDesk({ unit, calendar, probe, log, say = () => {}, now = Date.now, feeds = OFFICIAL_FEEDS, dropMs = DROP_MS }) {
  let state = { mode: "grid" };
  const done = new Set();
  let busy = false;

  const end = async (reason) => {
    const ev = state.event;
    const seconds = Math.round((now() - state.startedAt) / 1000);
    state = { mode: "grid" };
    done.add(ev.id);
    try { await unit()?.endLive(reason); }
    catch (err) { say(`live: return to grid failed (${err.message}); the unit restarts onto the grid`); }
    log.write({ type: "live-end", eventId: ev.id, feed: ev.feed, publisher: ev.publisher, url: ev.url, title: ev.title, reason, seconds });
    say(`live: ${ev.publisher} ended (${reason}) after ${seconds} s; back to the grid`);
  };

  const goLive = async (ev) => {
    done.add(ev.id);   // one attempt per event: a refusal or failure does not retry every 5 s
    const p = await probe(ev.url);
    try {
      assertCanAir({ entryId: ev.feed, url: ev.url, probe: p }, { feeds });
    } catch (err) {
      log.write({ type: "live-skip", eventId: ev.id, feed: ev.feed, url: ev.url, title: ev.title, reason: err.message });
      say(err.message);
      return false;
    }
    const u = unit();
    if (!u) { log.write({ type: "live-skip", eventId: ev.id, feed: ev.feed, url: ev.url, reason: "no running playout unit" }); return false; }
    try {
      await u.goLive({
        mediaUrl: p.mediaUrl, httpHeaders: p.httpHeaders,
        overlay: { publisher: ev.publisher, title: ev.title, credit: creditFor(feedById(ev.feed, feeds) || { publisher: ev.publisher }, new Date(now())) },
        onMedia: () => { if (state.mode === "live" && state.event?.id === ev.id) state.lastMediaAt = now(); },
      });
    } catch (err) {
      log.write({ type: "live-skip", eventId: ev.id, feed: ev.feed, url: ev.url, reason: `switch failed: ${err.message}` });
      say(`live: could not switch to ${ev.publisher} (${err.message}); staying on the grid`);
      try { await u.endLive("switch-failed"); } catch { /* already on the grid */ }
      return false;
    }
    const t = now();
    state = { mode: "live", event: ev, startedAt: t, lastMediaAt: t };
    log.write({ type: "live-start", eventId: ev.id, feed: ev.feed, publisher: ev.publisher, url: ev.url, title: ev.title, source: ev.source, check: p.reason });
    say(`live: on air with ${ev.publisher}: ${ev.title}`);
    return true;
  };

  return {
    get state() { return { ...state }; },
    done,
    async tick() {
      if (busy) return { action: "busy" };
      busy = true;
      try {
        const events = state.mode === "live" ? [] : await calendar();
        const d = decide({ now: now(), events, state, done, feeds, dropMs });
        if (d.action === "end") await end(d.reason);
        else if (d.action === "go-live") await goLive(d.event);
        return d;
      } finally { busy = false; }
    },
    /** The unit died while live: the restarted unit is on the grid, so close the record. */
    async unitLost() { if (state.mode === "live") await end("unit-restarted"); },
    async stop() { if (state.mode === "live") await end("playout-stopped"); },
  };
}
