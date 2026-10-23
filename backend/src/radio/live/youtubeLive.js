/**
 * youtubeLive.js - the YouTube side of going on air, through the Data API instead of YouTube Studio.
 *
 *   create a scheduled public broadcast -> bind it to the station's reusable stream -> set its thumbnail
 *   -> once the encoder's signal is active, transition it to live -> at the end, transition to complete.
 *
 * Credentials: RADIO_YT_CLIENT_ID / RADIO_YT_CLIENT_SECRET / RADIO_YT_REFRESH_TOKEN, falling back to the
 * YOUTUBE_* trio the Shorts uploader uses. The token must carry the youtube.force-ssl (or youtube) scope;
 * a token without it fails with a named YouTubeLiveScopeError before anything is created.
 *
 * The stream KEY is never read here: the stream is chosen by id (RADIO_YT_STREAM_ID) or, when the channel
 * has exactly one reusable stream, that one. `cdn` is never requested, so the key never enters this process.
 * `fetchImpl` and `now` are injectable so the tests make no network calls.
 */
import fs from "node:fs";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3";
export const LIVE_SCOPES = ["https://www.googleapis.com/auth/youtube.force-ssl", "https://www.googleapis.com/auth/youtube"];

export class YouTubeLiveScopeError extends Error {
  constructor(have) {
    super(`the YouTube token cannot run live broadcasts: it needs youtube.force-ssl; it has [${have.map((s) => s.split("/").pop()).join(", ")}]. Re-run backend/scripts/youtube-auth.mjs and put the new refresh token in ~/.scoopfeeds-radio.env as RADIO_YT_REFRESH_TOKEN.`);
    this.name = "YouTubeLiveScopeError";
  }
}

export function liveCredentials(env = process.env) {
  const pick = (a, b) => String(env[a] || env[b] || "").trim();
  return {
    clientId: pick("RADIO_YT_CLIENT_ID", "YOUTUBE_CLIENT_ID"),
    clientSecret: pick("RADIO_YT_CLIENT_SECRET", "YOUTUBE_CLIENT_SECRET"),
    refreshToken: pick("RADIO_YT_REFRESH_TOKEN", "YOUTUBE_REFRESH_TOKEN"),
    streamId: String(env.RADIO_YT_STREAM_ID || "").trim() || null,
  };
}
export const liveConfigured = (env = process.env) => { const c = liveCredentials(env); return Boolean(c.clientId && c.clientSecret && c.refreshToken); };

/** The broadcast resource: public, auto-start and auto-stop on, no monitor stream (so "live" is one step), DVR on. */
export function broadcastBody({ title, description = "", startMs, privacy = "public" }) {
  return {
    snippet: { title: String(title).slice(0, 100), description: String(description).slice(0, 5000), scheduledStartTime: new Date(startMs).toISOString() },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
    contentDetails: { enableAutoStart: true, enableAutoStop: true, enableDvr: true, latencyPreference: "low", monitorStream: { enableMonitorStream: false } },
  };
}

/** Choose the station's stream: the configured id, else the only reusable one. Never looks at the key. */
export function pickStream(items, wantedId) {
  const list = (items || []).filter((s) => s?.id);
  if (wantedId) {
    const s = list.find((x) => x.id === wantedId);
    if (!s) throw new Error(`RADIO_YT_STREAM_ID ${wantedId} is not one of this channel's streams`);
    return s;
  }
  const reusable = list.filter((s) => s.contentDetails?.isReusable !== false);
  if (reusable.length === 1) return reusable[0];
  if (!reusable.length) throw new Error("this channel has no reusable live stream; open YouTube Studio > Go live once to create the default stream key");
  throw new Error(`this channel has ${reusable.length} reusable streams; set RADIO_YT_STREAM_ID to one of: ${reusable.map((s) => `${s.id} (${s.snippet?.title || "untitled"})`).join(", ")}`);
}

/** The first broadcast in `items` bound to `streamId` that has not ended. */
export function pickBound(items, streamId) {
  const b = (items || []).find((x) => x?.id && x.contentDetails?.boundStreamId === streamId && !["complete", "revoked"].includes(x.status?.lifeCycleStatus));
  return b ? { id: b.id, lifeCycleStatus: b.status?.lifeCycleStatus || null } : null;
}

export function makeYouTubeLive({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const cred = liveCredentials(env);
  let tok = null;

  async function token() {
    if (tok && tok.exp > now() + 60_000) return tok.access;
    const r = await fetchImpl(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cred.clientId, client_secret: cred.clientSecret, refresh_token: cred.refreshToken, grant_type: "refresh_token" }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || !b.access_token) throw new Error(`YouTube token refresh failed: HTTP ${r.status} ${b.error || ""} ${b.error_description || ""}`.trim());
    tok = { access: b.access_token, exp: now() + (Number(b.expires_in) || 3600) * 1000 };
    return tok.access;
  }

  async function call(method, url, body) {
    const r = await fetchImpl(url, { method, headers: { Authorization: `Bearer ${await token()}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) {
      const reason = b?.error?.errors?.[0]?.reason || b?.error?.status || "";
      const e = new Error(`YouTube ${method} ${url.replace(API, "").split("?")[0]}: HTTP ${r.status} ${reason} ${b?.error?.message || ""}`.trim());
      e.status = r.status; e.reason = reason; throw e;
    }
    return b;
  }

  return {
    configured: () => Boolean(cred.clientId && cred.clientSecret && cred.refreshToken),

    async checkScope() {
      const r = await fetchImpl(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(await token())}`);
      const b = await r.json().catch(() => ({}));
      const have = String(b.scope || "").split(/\s+/).filter(Boolean);
      if (!have.some((s) => LIVE_SCOPES.includes(s))) throw new YouTubeLiveScopeError(have);
      return have;
    },

    async findStream() {
      const b = await call("GET", `${API}/liveStreams?part=id,snippet,status,contentDetails&mine=true&maxResults=50`);
      return pickStream(b.items, cred.streamId);
    },

    async createBroadcast(opts) {
      return call("POST", `${API}/liveBroadcasts?part=snippet,status,contentDetails`, broadcastBody(opts));
    },

    async bind(broadcastId, streamId) {
      return call("POST", `${API}/liveBroadcasts/bind?id=${encodeURIComponent(broadcastId)}&streamId=${encodeURIComponent(streamId)}&part=id,contentDetails`);
    },

    async setThumbnail(videoId, file) {
      const buf = fs.readFileSync(file);
      const type = /\.png$/i.test(file) ? "image/png" : "image/jpeg";
      const r = await fetchImpl(`${UPLOAD}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
        { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": type, "Content-Length": String(buf.length) }, body: buf });
      if (!r.ok) throw new Error(`YouTube thumbnail: HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
    },

    /** { streamStatus: "active"|"inactive"|"ready"|..., health: "good"|"ok"|"bad"|"noData"|null } */
    async streamState(streamId) {
      const b = await call("GET", `${API}/liveStreams?part=status&id=${encodeURIComponent(streamId)}`);
      const s = b.items?.[0]?.status || {};
      return { streamStatus: s.streamStatus || null, health: s.healthStatus?.status || null };
    },

    /** "created" | "ready" | "testing" | "live" | "complete" | ... */
    async broadcastState(id) {
      const b = await call("GET", `${API}/liveBroadcasts?part=status&id=${encodeURIComponent(id)}`);
      return b.items?.[0]?.status?.lifeCycleStatus || null;
    },

    /**
     * The broadcast this stream is bound to right now, live or waiting for data (#196 stream watch), else null.
     * Looks at active broadcasts first, then upcoming ones; persistent ("Stream now") broadcasts are included.
     * @returns {Promise<{ id: string, lifeCycleStatus: string|null }|null>}
     */
    async boundBroadcast(streamId) {
      for (const status of ["active", "upcoming"]) {
        const b = await call("GET", `${API}/liveBroadcasts?part=id,status,contentDetails&broadcastStatus=${status}&broadcastType=all&maxResults=50`);
        const hit = pickBound(b.items, streamId);
        if (hit) return hit;
      }
      return null;
    },

    /** Transition; "already there" (redundantTransition) is success. */
    async transition(id, to) {
      try { return await call("POST", `${API}/liveBroadcasts/transition?broadcastStatus=${to}&id=${encodeURIComponent(id)}&part=status`); }
      catch (e) { if (e.reason === "redundantTransition") return null; throw e; }
    },
  };
}

/**
 * Bring a bound broadcast live once the encoder is sending: poll the stream until it is active, then
 * transition to live (auto-start usually beats us to it; that is fine). Resolves "live", or throws after `timeoutMs`.
 */
export async function goLiveWhenActive(yt, { broadcastId, streamId, timeoutMs = 180_000, everyMs = 5_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, log = () => {} }) {
  const until = now() + timeoutMs;
  let lastNote = "";
  while (now() < until) {
    const [st, life] = await Promise.all([yt.streamState(streamId).catch((e) => ({ err: e.message })), yt.broadcastState(broadcastId).catch(() => null)]);
    if (life === "live") return "live";
    const note = st.err ? `stream check failed: ${st.err}` : `stream ${st.streamStatus}, health ${st.health}, broadcast ${life}`;
    if (note !== lastNote) { log(`youtube: ${note}`); lastNote = note; }
    if (st.streamStatus === "active" && (life === "ready" || life === "testing")) {
      try { await yt.transition(broadcastId, "live"); log("youtube: transitioned to live"); } catch (e) { log(`youtube: transition to live failed: ${e.message}`); }
    }
    await sleep(everyMs);
  }
  throw new Error(`the broadcast did not go live within ${Math.round(timeoutMs / 1000)} s (${lastNote})`);
}
