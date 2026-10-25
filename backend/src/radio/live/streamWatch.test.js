import { test } from "node:test";
import assert from "node:assert/strict";
import { createStreamWatch, makePlayoutAlert, reportsNoData, watchEnabled, watchBroadcastCopy, WATCH, DEFAULT_TITLE } from "./streamWatch.js";
import { pickBound, broadcastBody } from "./youtubeLive.js";
import { creditsComplete } from "../safety/broadcastCopy.js";

/** A fake YouTube whose stream health and bound broadcast the test sets. */
function fakeYt({ health = "good", streamStatus = "active", bound = { id: "B1", lifeCycleStatus: "live" } } = {}) {
  const yt = {
    st: { streamStatus, health }, bound, created: [], binds: [], fail: null,
    findStream: async () => ({ id: "S" }),
    streamState: async () => { if (yt.fail) throw new Error(yt.fail); return { ...yt.st }; },
    boundBroadcast: async (sid) => { assert.equal(sid, "S"); return yt.bound; },
    createBroadcast: async (o) => { const id = `N${yt.created.length + 1}`; yt.created.push({ id, ...o }); return { id }; },
    bind: async (b, s) => { yt.binds.push([b, s]); yt.bound = { id: b, lifeCycleStatus: "ready" }; },
  };
  return yt;
}
function rig(yt, extra = {}) {
  const clock = { t: 1e12 }, restarts = [], alerts = [], logs = [];
  const w = createStreamWatch({ yt, encoderRunning: () => true, restart: (r) => restarts.push(r), alert: (m) => alerts.push(m), log: (m) => logs.push(m), now: () => clock.t, env: {}, ...extra });
  const minute = async (n = 1) => { const out = []; for (let i = 0; i < n; i++) { clock.t += WATCH.EVERY_MS; out.push(await w.check()); } return out; };
  return { w, clock, restarts, alerts, logs, minute };
}

test("flag: RADIO_STREAM_WATCH_ENABLED must be literally true; no-data means not active or health noData", () => {
  assert.equal(watchEnabled({}), false);
  assert.equal(watchEnabled({ RADIO_STREAM_WATCH_ENABLED: "1" }), false);
  assert.equal(watchEnabled({ RADIO_STREAM_WATCH_ENABLED: "true" }), true);
  assert.equal(reportsNoData({ streamStatus: "active", health: "good" }), false);
  assert.equal(reportsNoData({ streamStatus: "active", health: "bad" }), false, "bad health is degraded, not absent");
  assert.equal(reportsNoData({ streamStatus: "active", health: "noData" }), true);
  assert.equal(reportsNoData({ streamStatus: "inactive", health: null }), true);
});

test("no data for 2 minutes while the encoder runs restarts YouTube once; a healthy stream is left alone", async () => {
  const yt = fakeYt();
  const r = rig(yt);
  assert.deepEqual(await r.minute(3), ["ok", "ok", "ok"]);
  yt.st = { streamStatus: "active", health: "noData" };
  const got = await r.minute(3);   // t+1 min: first seen; t+2: 1 min; t+3: 2 min -> restart
  assert.deepEqual(got, ["waiting", "waiting", "restarted"]);
  assert.deepEqual(r.restarts, ["youtube reports no data"]);
  yt.st = { streamStatus: "active", health: "good" };
  await r.minute(10);
  assert.equal(r.restarts.length, 1);
  assert.equal(r.alerts.length, 0, "a restart that recovers is not an alert");
  assert.ok(r.logs.some((l) => /receiving again/.test(l)));
});

test("a restart that has not recovered within 5 minutes raises ONE alert; recovery re-arms it", async () => {
  const yt = fakeYt({ health: "noData" });
  const r = rig(yt);
  await r.minute(20);
  assert.ok(r.restarts.length >= 3, `keeps restarting every 2 min (${r.restarts.length})`);
  assert.equal(r.alerts.length, 1);
  assert.match(r.alerts[0], /not recovered 5 min after/);
  yt.st = { streamStatus: "active", health: "good" };
  await r.minute(2);
  yt.st = { streamStatus: "inactive", health: null };
  await r.minute(8);
  assert.equal(r.alerts.length, 2, "a new outage can alert again");
});

test("an API failure is skipped, never counted as no data; a stopped encoder is not judged", async () => {
  const yt = fakeYt({ health: "noData" });
  let running = false;
  const r = rig(yt, { encoderRunning: () => running });
  assert.deepEqual(await r.minute(5), ["idle", "idle", "idle", "idle", "idle"]);
  running = true; yt.fail = "HTTP 500 backendError";
  assert.deepEqual(await r.minute(5), ["skipped", "skipped", "skipped", "skipped", "skipped"]);
  assert.equal(r.restarts.length, 0);
});

test("24/7 mode: an ended broadcast is replaced by a new one, bound to the stream, at most once per 10 minutes", async () => {
  const yt = fakeYt();
  const r = rig(yt, { manageBroadcast: true, env: { RADIO_STREAM_WATCH_PRIVACY: "unlisted" } });
  await r.minute();
  assert.equal(yt.created.length, 0, "a bound broadcast is left alone");
  yt.bound = null;                       // the broadcast ended
  yt.bind = async (b, s) => { yt.binds.push([b, s]); };   // and binding does not (yet) show up as bound
  await r.minute();
  assert.equal(yt.created.length, 1);
  assert.deepEqual(yt.binds, [["N1", "S"]]);
  assert.equal(yt.created[0].privacy, "unlisted");
  assert.match(yt.created[0].title, /ScoopFeeds Radio LIVE/);
  await r.minute(9);
  assert.equal(yt.created.length, 1, "rate-limited");
  await r.minute(1);
  assert.equal(yt.created.length, 2);
});

test("programme mode never creates a broadcast (autoair.mjs owns it)", async () => {
  const yt = fakeYt({ bound: null });
  const r = rig(yt, { manageBroadcast: false });
  await r.minute(15);
  assert.equal(yt.created.length, 0);
});

test("pickBound: only a broadcast bound to this stream that has not ended", () => {
  const items = [
    { id: "A", status: { lifeCycleStatus: "complete" }, contentDetails: { boundStreamId: "S" } },
    { id: "B", status: { lifeCycleStatus: "live" }, contentDetails: { boundStreamId: "OTHER" } },
    { id: "C", status: { lifeCycleStatus: "ready" }, contentDetails: { boundStreamId: "S" } },
  ];
  assert.deepEqual(pickBound(items, "S"), { id: "C", lifeCycleStatus: "ready" });
  assert.equal(pickBound(items.slice(0, 2), "S"), null);
  assert.equal(pickBound(undefined, "S"), null);
});

test("alerts: Mac notification and email when configured; a failing mailer is logged, not thrown", async () => {
  const spawned = [], mails = [], logs = [];
  const fakeSpawn = (cmd, args) => { spawned.push([cmd, args]); return { on() {}, unref() {} }; };
  const a = makePlayoutAlert({ platform: "darwin", spawn: fakeSpawn, env: { RADIO_ALERT_EMAIL: "d@x", SMTP_HOST: "h" }, sendMail: async (m) => mails.push(m), log: (m) => logs.push(m) });
  await a("YouTube has not recovered");
  assert.equal(spawned[0][0], "osascript");
  assert.equal(mails[0].to, "d@x");
  const b = makePlayoutAlert({ platform: "linux", spawn: fakeSpawn, env: { RADIO_ALERT_EMAIL: "d@x", SMTP_HOST: "h" }, sendMail: async () => { throw new Error("smtp down"); }, log: (m) => logs.push(m) });
  await b("x");
  assert.equal(spawned.length, 1, "no osascript off macOS");
  assert.ok(logs.some((l) => /alert email failed: smtp down/.test(l)));
});

// ── #208 copy rules for a broadcast the watch creates (review of 25 Oct) ──
const CREDIT = (i) => `"Track ${i}" by Artist ${i} (https://example.org/t/${i}) licensed under CC BY 4.0 https://creativecommons.org/licenses/by/4.0/`;

test("#208: a created broadcast has a factual title and the 24/7 credits as the link; YouTube receives exactly the checked copy", async () => {
  const yt = fakeYt({ bound: null });
  const credits = Array.from({ length: 80 }, (_, i) => CREDIT(i));
  const env = { RADIO_STREAM_WATCH_TITLE: "BREAKING!! You won't believe this", RADIO_MUSIC_CREDITS_URL: "https://scoopfeeds.com/radio/music-credits" };
  const r = rig(yt, { manageBroadcast: true, env, credits: () => credits });
  await r.minute();
  assert.equal(yt.created.length, 1);
  const c = yt.created[0];
  assert.equal(c.title, DEFAULT_TITLE, "a clickbait title is replaced by the default");
  assert.ok(r.logs.some((m) => /title replaced/.test(m)));
  assert.deepEqual(c.credits, credits);
  assert.equal(c.creditsUrl, env.RADIO_MUSIC_CREDITS_URL);
  assert.equal(c.listAll, false, "24/7 with a credits page: the link alone");
  const sent = broadcastBody(c).snippet.description;
  assert.equal(sent, watchBroadcastCopy({ env, credits }).full);
  assert.match(sent, /Music credits: https:\/\/scoopfeeds\.com\/radio\/music-credits/);
  assert.ok(creditsComplete(sent, credits, env.RADIO_MUSIC_CREDITS_URL));
  assert.ok(sent.length <= 5000);
});

test("#208: without a credits page, a small library is listed whole; a library that does not fit refuses, alerts once, creates nothing", async () => {
  const few = [CREDIT(1), CREDIT(2)];
  const ok = fakeYt({ bound: null });
  const r1 = rig(ok, { manageBroadcast: true, credits: () => few });
  await r1.minute();
  assert.equal(ok.created.length, 1);
  const sent = broadcastBody(ok.created[0]).snippet.description;
  for (const c of few) assert.ok(sent.includes(c), "every credit whole");

  const yt = fakeYt({ bound: null });
  const many = Array.from({ length: 80 }, (_, i) => CREDIT(i));
  const r = rig(yt, { manageBroadcast: true, credits: () => many });
  await r.minute(25);                       // three create attempts (every 10 min), all refused
  assert.equal(yt.created.length, 0, "never publish incomplete attribution");
  assert.equal(yt.binds.length, 0);
  assert.equal(r.alerts.length, 1, "alerted once per outage, not every attempt");
  assert.match(r.alerts[0], /RADIO_MUSIC_CREDITS_URL/);
  assert.ok(r.logs.filter((m) => /refusing to create a broadcast.*credits-failed/.test(m)).length >= 1);
});

test("#208: a credits library that cannot be read refuses too (unknown credits are not 'no credits')", async () => {
  const yt = fakeYt({ bound: null });
  const r = rig(yt, { manageBroadcast: true, credits: () => { throw new Error("manifest.json is not valid JSON"); } });
  await r.minute();
  assert.equal(yt.created.length, 0);
  assert.equal(r.alerts.length, 1);
  assert.match(r.alerts[0], /manifest\.json/);
});

test("#208: PAUSE stops the watch: no new broadcast, no restart, however long YouTube reports no data", async () => {
  const yt = fakeYt({ bound: null, streamStatus: "inactive", health: "noData" });
  let paused = true;
  const r = rig(yt, { manageBroadcast: true, paused: () => paused, credits: () => [] });
  const got = await r.minute(15);
  assert.ok(got.every((x) => x === "paused"));
  assert.equal(yt.created.length, 0, "PAUSE means stay off air: nothing re-creates a broadcast");
  assert.equal(r.restarts.length, 0);
  assert.equal(r.alerts.length, 0);
  assert.equal(r.logs.filter((m) => /PAUSE is set/.test(m)).length, 1, "logged once, not every minute");
  paused = false;                            // DrJ removed PAUSE by hand
  await r.minute();
  assert.equal(yt.created.length, 1);
});
