/**
 * streamWatch.js - ask YouTube, once a minute, whether the radio is actually reaching it (#196, build step 3).
 *
 * The fan-out (fanout.js) knows whether our side of each RTMP link is up. It cannot know whether YouTube is
 * receiving and accepting the stream: an encoder can write happily into a socket YouTube ignores, and a broadcast
 * can end (auto-stop, a Studio click, a policy action) while we keep sending. This watch closes that gap through
 * the Live API that youtubeLive.js already uses:
 *
 *   - YouTube reports no data for WATCH.NO_DATA_MS (2 min) while the encoder is running -> restart the YouTube
 *     output. With several destinations that is only YouTube's relay (X keeps going); with one, the whole unit.
 *   - The station's stream has no broadcast bound to it (the last one ended) -> create a new one and bind it
 *     (24/7 mode only; in programme mode autoair.mjs owns the broadcast). At most once per CREATE_EVERY_MS.
 *   - Alert DrJ (Mac notification + email) only when a restart has not recovered within RECOVER_MS (5 min),
 *     once per outage. A restart that recovers is a log line, not an alert.
 *
 * A failed API call is never treated as "no data": it is logged and that minute is skipped (unverified, not bad).
 * The stream KEY is never read here (youtubeLive.js never requests the `cdn` part).
 * Off unless RADIO_STREAM_WATCH_ENABLED is literally "true"; it also needs the RADIO_YT_* API credentials.
 */
import { spawn as nodeSpawn } from "node:child_process";

export const WATCH = Object.freeze({
  EVERY_MS: 60_000,           // DrJ, #196: every minute
  NO_DATA_MS: 2 * 60_000,     // no data this long while the encoder runs -> restart
  RECOVER_MS: 5 * 60_000,     // a restart not recovered within this -> alert
  CREATE_EVERY_MS: 10 * 60_000,
  WARMUP_MS: 30_000,          // a freshly started encoder is not judged yet
});

export const DEFAULT_TITLE = "ScoopFeeds Radio LIVE · World news, compared · 24/7";

export const watchEnabled = (env = process.env) => String(env.RADIO_STREAM_WATCH_ENABLED || "").trim().toLowerCase() === "true";

/** "No data" in YouTube's words: the stream is not active, or its health says noData. */
export const reportsNoData = (st) => !st || st.streamStatus !== "active" || st.health === "noData";

/**
 * @param {{ yt: object, streamId?: string|null, manageBroadcast?: boolean, encoderRunning: () => boolean,
 *           restart: (reason: string) => Promise<any>|any, alert: (msg: string) => Promise<any>|any,
 *           log?: Function, now?: Function, env?: object }} o
 */
export function createStreamWatch(o) {
  const log = o.log || (() => {});
  const now = o.now || Date.now;
  const env = o.env || process.env;
  const s = { streamId: o.streamId || null, noDataSince: null, restartedAt: null, restarts: 0, alerted: false, lastCreateAt: -Infinity, broadcastId: null, lastNote: "" };

  const note = (m) => { if (m !== s.lastNote) { log(m); s.lastNote = m; } };

  async function ensureBroadcast(t) {
    let bound;
    try { bound = await o.yt.boundBroadcast(s.streamId); }
    catch (e) { note(`stream watch: broadcast check failed (${e.message}); skipped this minute`); return; }
    if (bound) { if (bound.id !== s.broadcastId) { s.broadcastId = bound.id; log(`stream watch: broadcast ${bound.id} (${bound.lifeCycleStatus}) is bound to the stream`); } return; }
    if (t - s.lastCreateAt < WATCH.CREATE_EVERY_MS) return;
    s.lastCreateAt = t;
    const prev = s.broadcastId;
    try {
      const b = await o.yt.createBroadcast({ title: env.RADIO_STREAM_WATCH_TITLE || DEFAULT_TITLE, description: env.RADIO_STREAM_WATCH_DESCRIPTION || "World news, compared across outlets, around the clock. https://scoopfeeds.com", startMs: t, privacy: env.RADIO_STREAM_WATCH_PRIVACY || "public" });
      await o.yt.bind(b.id, s.streamId);
      s.broadcastId = b.id;
      log(`stream watch: ${prev ? `broadcast ${prev} has ended; ` : "no broadcast was bound to the stream; "}created ${b.id} and bound it (auto-start: it goes live as data arrives)`);
    } catch (e) {
      log(`stream watch: could not create a new broadcast (${e.message}); next try in ${WATCH.CREATE_EVERY_MS / 60_000} min`);
    }
  }

  /** One check. Returns what it did, for the log and the tests: "idle" | "skipped" | "ok" | "waiting" | "restarted". */
  async function check() {
    const t = now();
    if (!o.encoderRunning()) { s.noDataSince = null; return "idle"; }
    if (!s.streamId) {
      try { s.streamId = (await o.yt.findStream()).id; }
      catch (e) { note(`stream watch: cannot find the station's stream (${e.message}); skipped this minute`); return "skipped"; }
    }
    let st;
    try { st = await o.yt.streamState(s.streamId); }
    catch (e) { note(`stream watch: health check failed (${e.message}); skipped this minute, not counted as no data`); return "skipped"; }

    let did = "ok";
    if (reportsNoData(st)) {
      s.noDataSince ??= t;
      note(`stream watch: YouTube reports ${st.streamStatus || "?"}, health ${st.health || "?"} (no data for ${Math.round((t - s.noDataSince) / 1000)} s)`);
      did = "waiting";
      if (t - s.noDataSince >= WATCH.NO_DATA_MS) {
        s.restarts++;
        s.restartedAt ??= t;          // the outage's first restart: the 5-minute recovery clock runs from here
        s.noDataSince = null;          // judge the restarted output afresh
        log(`stream watch: no data at YouTube for ${WATCH.NO_DATA_MS / 60_000} min while the encoder runs; restarting the YouTube output (restart ${s.restarts})`);
        try { await o.restart("youtube reports no data"); } catch (e) { log(`stream watch: restart failed: ${e.message}`); }
        did = "restarted";
      }
    } else {
      if (s.restartedAt !== null) log(`stream watch: YouTube is receiving again ${Math.round((t - s.restartedAt) / 1000)} s after the restart`);
      s.noDataSince = null; s.restartedAt = null; s.alerted = false;
      note(`stream watch: YouTube receiving (${st.streamStatus}, health ${st.health || "?"})`);
    }
    if (s.restartedAt !== null && !s.alerted && t - s.restartedAt >= WATCH.RECOVER_MS) {
      s.alerted = true;
      await Promise.resolve(o.alert(`YouTube has not recovered ${Math.round((t - s.restartedAt) / 60_000)} min after the stream watch restarted it (${st.streamStatus || "?"}, health ${st.health || "?"}). The radio is still trying.`)).catch(() => {});
    }
    if (o.manageBroadcast) await ensureBroadcast(t);
    return did;
  }

  let timer = null, busy = false;
  return {
    check,
    state: () => ({ ...s }),
    start() {
      if (timer) return;
      timer = setInterval(async () => { if (busy) return; busy = true; try { await check(); } finally { busy = false; } }, WATCH.EVERY_MS);
      timer.unref?.();
    },
    stop() { clearInterval(timer); timer = null; },
  };
}

/**
 * Alerts for the playout process: a macOS notification and, when RADIO_ALERT_EMAIL and SMTP_HOST are set, an email.
 * Same channels as autoair.mjs. The notifier runs async so the playout keeps reading the encoder while it does.
 */
export function makePlayoutAlert({ log = () => {}, env = process.env, platform = process.platform, spawn = nodeSpawn, sendMail = null } = {}) {
  return async (msg) => {
    log(`⚠ ${msg}`);
    if (platform === "darwin") {
      try { const n = spawn("osascript", ["-e", `display notification ${JSON.stringify(msg.slice(0, 200))} with title "ScoopFeeds Radio"`], { stdio: "ignore" }); n.on?.("error", () => {}); n.unref?.(); }
      catch { /* best effort */ }
    }
    if (env.RADIO_ALERT_EMAIL && env.SMTP_HOST) {
      try {
        const send = sendMail || (await import("../../services/mailer.js")).sendMail;
        await send({ to: env.RADIO_ALERT_EMAIL, subject: `⚠ ScoopFeeds Radio: ${msg.slice(0, 80)}`, text: msg });
      } catch (e) { log(`alert email failed: ${e.message}`); }
    }
  };
}
