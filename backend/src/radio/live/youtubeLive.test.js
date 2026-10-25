import { test } from "node:test";
import assert from "node:assert/strict";
import { broadcastBody, pickStream, makeYouTubeLive, goLiveWhenActive, liveCredentials, YouTubeLiveScopeError } from "./youtubeLive.js";

test("broadcast: public, auto start/stop, no monitor stream, scheduled at H", () => {
  const b = broadcastBody({ title: "x".repeat(150), startMs: Date.UTC(2026, 9, 14, 16) });
  assert.equal(b.snippet.title.length, 100);
  assert.equal(b.snippet.scheduledStartTime, "2026-10-14T16:00:00.000Z");
  assert.equal(b.status.privacyStatus, "public");
  assert.equal(b.status.selfDeclaredMadeForKids, false);
  assert.equal(b.contentDetails.enableAutoStart, true);
  assert.equal(b.contentDetails.monitorStream.enableMonitorStream, false);
});

test("stream choice: configured id, else the only reusable one; several is an error naming them", () => {
  const a = { id: "A", snippet: { title: "Default" }, contentDetails: { isReusable: true } }, b = { id: "B", snippet: { title: "Radio" }, contentDetails: { isReusable: true } };
  assert.equal(pickStream([a], null).id, "A");
  assert.equal(pickStream([a, b], "B").id, "B");
  assert.throws(() => pickStream([a, b], null), /RADIO_YT_STREAM_ID.*A \(Default\).*B \(Radio\)/);
  assert.throws(() => pickStream([a], "Z"), /not one of/);
  assert.throws(() => pickStream([], null), /no reusable/);
});

test("credentials: radio-specific first, then the Shorts uploader's", () => {
  const c = liveCredentials({ YOUTUBE_CLIENT_ID: "y", RADIO_YT_CLIENT_ID: "r", YOUTUBE_CLIENT_SECRET: "s", YOUTUBE_REFRESH_TOKEN: "t" });
  assert.deepEqual([c.clientId, c.clientSecret, c.refreshToken, c.streamId], ["r", "s", "t", null]);
});

function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET" });
    for (const [re, h] of routes) if (re.test(url)) { const [status, body] = await h(url, init); return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }; }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  };
  f.calls = calls; return f;
}
const ENV = { RADIO_YT_CLIENT_ID: "c", RADIO_YT_CLIENT_SECRET: "s", RADIO_YT_REFRESH_TOKEN: "r" };
const token = [/oauth2.googleapis.com\/token$/, async () => [200, { access_token: "AT", expires_in: 3600 }]];

test("scope preflight: a token without force-ssl is a named error", async () => {
  const yt = makeYouTubeLive({ env: ENV, fetchImpl: fakeFetch([token, [/tokeninfo/, async () => [200, { scope: "https://www.googleapis.com/auth/youtube.upload" }]]]) });
  await assert.rejects(yt.checkScope(), YouTubeLiveScopeError);
  const ok = makeYouTubeLive({ env: ENV, fetchImpl: fakeFetch([token, [/tokeninfo/, async () => [200, { scope: "https://www.googleapis.com/auth/youtube.force-ssl" }]]]) });
  assert.ok((await ok.checkScope()).length);
});

test("the stream key is never requested (no cdn part)", async () => {
  const f = fakeFetch([token, [/liveStreams/, async () => [200, { items: [{ id: "S", contentDetails: { isReusable: true } }] }]]]);
  const yt = makeYouTubeLive({ env: ENV, fetchImpl: f });
  assert.equal((await yt.findStream()).id, "S");
  assert.ok(f.calls.every((c) => !/cdn/.test(c.url)));
});

test("redundant transition counts as success", async () => {
  const f = fakeFetch([token, [/transition/, async () => [403, { error: { errors: [{ reason: "redundantTransition" }] } }]]]);
  assert.equal(await makeYouTubeLive({ env: ENV, fetchImpl: f }).transition("B", "live"), null);
});

test("go live: waits for an active signal, then transitions", async () => {
  let t = 0, polls = 0, transitioned = false;
  const yt = {
    streamState: async () => ({ streamStatus: ++polls >= 3 ? "active" : "inactive", health: "good" }),
    broadcastState: async () => (transitioned ? "live" : "ready"),
    transition: async (id, to) => { assert.equal(to, "live"); transitioned = true; },
  };
  const r = await goLiveWhenActive(yt, { broadcastId: "B", streamId: "S", sleep: async (ms) => { t += ms; }, now: () => t });
  assert.equal(r, "live");
  assert.ok(transitioned);
});

test("go live: gives up with a reason", async () => {
  let t = 0;
  const yt = { streamState: async () => ({ streamStatus: "inactive", health: "noData" }), broadcastState: async () => "ready", transition: async () => {} };
  await assert.rejects(goLiveWhenActive(yt, { broadcastId: "B", streamId: "S", timeoutMs: 20_000, sleep: async (ms) => { t += ms; }, now: () => t }), /did not go live.*inactive/);
});
