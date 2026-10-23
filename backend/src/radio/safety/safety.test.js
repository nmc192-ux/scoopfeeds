/**
 * safety.test.js — #208 radio platform safety: disclosure, music provenance, the standing watchdog,
 * film clearance, election claims and factual titles. No network: every API is stubbed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DISCLOSURE, STATION_ID_LINE, withDisclosure, xBroadcastText, withStationId, titleProblems, factualTitle } from "./disclosure.js";
import { broadcastBody, makeYouTubeLive } from "../live/youtubeLive.js";
import { entryProblems, isCcAttribution, loadManifest, clearBed, screenCredit, creditLines } from "../musicManifest.js";
import { listBeds, listFiles, bedCredit, clearedTracks } from "../musicLibrary.js";
import { makeMusicLibrary, ccEntry } from "../musicTestLibrary.js";
import { ensureProceduralBed, proceduralArgs, VOICES_FOR_TEST, LOOP_SEC } from "../proceduralBed.js";
import { readStanding, incidents, standingLine, watchOnce } from "./standing.js";
import { pickClearedFilm, recordProblem, apiProblem } from "./filmClearance.js";
import { electionClaim, electionClaimVerdict } from "./electionClaims.js";
import { checkSegments } from "../programme/checks.js";
import { makeRadioAlert } from "./alert.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = (p = "radio-safety-") => fs.mkdtempSync(path.join(os.tmpdir(), p));

// ── 1. disclosure on every broadcast ─────────────────────────────────────────
test("every broadcast body carries the disclosure and the music credits, whatever the caller passes", () => {
  const credits = ["Calm River by A. Artist (CC BY 4.0)"];
  for (const description of ["", "One hour of world news.", "x".repeat(9000), `Already has it. ${DISCLOSURE}`]) {
    const b = broadcastBody({ title: "ScoopFeeds Radio LIVE", description, startMs: Date.UTC(2026, 9, 30, 16), credits });
    const d = b.snippet.description;
    assert.ok(d.includes(DISCLOSURE), "disclosure present");
    assert.equal(d.split(DISCLOSURE).length - 1, 1, "exactly once");
    assert.ok(d.includes(credits[0]), "credit present");
    assert.ok(d.length <= 5000);
  }
  assert.ok(broadcastBody({ title: "t", startMs: 0 }).snippet.description.includes(DISCLOSURE), "no description at all still discloses");
});

test("YouTube's altered/synthetic setting is never ticked: the field is not sent (DrJ, 22 Oct 2026)", () => {
  const b = broadcastBody({ title: "t", description: "d", startMs: 0 });
  assert.equal(JSON.stringify(b).includes("containsSyntheticMedia"), false);
});

test("the description is idempotent and has no angle brackets (YouTube rejects them)", () => {
  const once = withDisclosure("Body <b>text</b>", ["Song by X <https://x.example>"]);
  assert.equal(withDisclosure(once, ["Song by X <https://x.example>"]), once);
  assert.equal(/[<>]/.test(once), false);
});

test("the createBroadcast payload sent over the wire carries the disclosure", async () => {
  let sent = null;
  const fetchImpl = async (url, init = {}) => {
    if (/oauth2.*token$/.test(url)) return { ok: true, status: 200, json: async () => ({ access_token: "A", expires_in: 3600 }) };
    if (/liveBroadcasts\?/.test(url) && init.method === "POST") { sent = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ id: "B1" }) }; }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const yt = makeYouTubeLive({ env: { RADIO_YT_CLIENT_ID: "c", RADIO_YT_CLIENT_SECRET: "s", RADIO_YT_REFRESH_TOKEN: "r" }, fetchImpl });
  await yt.createBroadcast({ title: "ScoopFeeds Radio LIVE", description: "One hour.", startMs: Date.UTC(2026, 9, 30, 16), credits: ["Track by Artist, CC BY"] });
  assert.ok(sent.snippet.description.includes(DISCLOSURE));
  assert.ok(sent.snippet.description.includes("Track by Artist, CC BY"));
});

test("the X broadcast text carries the disclosure, the credits, and stays within X's limit", () => {
  const t = xBroadcastText({ title: "ScoopFeeds Radio LIVE", credits: ["A by B", "C by D"] });
  assert.ok(t.includes(DISCLOSURE) && t.includes("A by B") && t.includes("C by D"));
  const long = xBroadcastText({ title: "ScoopFeeds Radio LIVE", credits: Array(400).fill("A very long credit line for a track by an artist"), watchUrl: "https://www.youtube.com/watch?v=B1", max: 4000 });
  assert.ok(long.length <= 4000 && long.includes(DISCLOSURE) && long.includes("watch?v=B1"));
});

// ── 2. the spoken station ID, no AI badge ────────────────────────────────────
test("the station-ID line goes into The Hour right after the open, word for word, once", () => {
  const segs = { "the-hour": { lines: [{ id: "open", text: "It's noon in New York." }, { id: "s1", story: "t1", text: "x" }] }, half: { lines: [] } };
  const out = withStationId(withStationId(segs));
  const ids = out["the-hour"].lines.map((l) => l.id);
  assert.deepEqual(ids, ["open", "station-id", "s1"]);
  assert.equal(out["the-hour"].lines[1].text, STATION_ID_LINE);
  assert.equal(STATION_ID_LINE, DISCLOSURE);
  assert.deepEqual(out.half, segs.half);
});

test("no screen shows an AI badge or label (both screens, every scene)", () => {
  const BADGE = /\b(ai[- ]?(generated|badge|label|made|produced)|made (with|by) ai|synthetic (media|content|voice)|artificial intelligence)\b/i;
  for (const f of ["scoopfeeds-radio-screen.html", "scoopfeeds-radio-programme.html"]) {
    const html = fs.readFileSync(path.join(HERE, "../screen", f), "utf8");
    const visible = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
    assert.equal(BADGE.test(visible.replace(/<[^>]+>/g, " ")), false, `${f}: visible text`);
    assert.equal(/class="[^"]*\b(ai-?badge|ai-?label|synthetic)\b/i.test(html), false, `${f}: badge element`);
    assert.ok(html.includes('id="musicCredit"'), `${f}: the music-break credit element exists`);
  }
});

// ── 3. music provenance ─────────────────────────────────────────────────────
test("manifest entries: complete CC-attribution entries pass; anything else is refused with a reason", () => {
  const good = ccEntry("evening/a.mp3", "x");
  assert.deepEqual(entryProblems(good), []);
  for (const k of ["title", "artist", "licence", "credit", "downloaded", "sha256", "file"]) assert.match(entryProblems({ ...good, [k]: "" }).join(), new RegExp(`${k} missing`));
  assert.match(entryProblems({ ...good, licence: "YouTube Audio Library Standard License" }).join(), /not Creative Commons/);
  assert.match(entryProblems({ ...good, licence: "Creative Commons Attribution-NonCommercial 4.0" }).join(), /not Creative Commons/);
  assert.match(entryProblems({ ...good, source: "ElevenLabs Music" }).join(), /AI music tool/);
  assert.match(entryProblems({ ...good, tool: "Suno" }).join(), /AI music tool/);
  assert.match(entryProblems({ ...good, sha256: "abc" }).join(), /64 hex/);
  assert.equal(isCcAttribution("CC BY 4.0"), true);
  assert.equal(isCcAttribution("Creative Commons – attribution required"), true);
  assert.equal(isCcAttribution("CC BY-NC 4.0"), false);
});

test("playout refuses any bed without a complete manifest entry; a changed file is refused; .norm.mp3 airs under its original", () => {
  const dir = makeMusicLibrary({ evening: ["ok.mp3", "ok.norm.mp3", "nolabel.mp3", "ai.mp3", "changed.mp3"] }, {
    entry: (rel, body) => rel.endsWith("nolabel.mp3") ? null : rel.endsWith("ai.mp3") ? ccEntry(rel, body, { source: "ElevenLabs" }) : ccEntry(rel, body),
  });
  fs.writeFileSync(path.join(dir, "evening", "changed.mp3"), "edited after download");
  const refused = [];
  const beds = listBeds("evening", dir, { onRefused: (w) => refused.push(w) }).map((p) => path.basename(p));
  assert.deepEqual(beds, ["ok.norm.mp3"]);
  assert.equal(listFiles("evening", dir).length, 4);
  assert.equal(refused.length, 3);
  assert.ok(refused.some((w) => /changed\.mp3: sha256 does not match/.test(w)));
  assert.ok(refused.some((w) => /nolabel\.mp3: no complete manifest entry/.test(w)));
  assert.ok(refused.some((w) => /ai\.mp3: no complete manifest entry/.test(w)));
  assert.match(loadManifest(dir).problems.join(), /ai\.mp3: .*AI music tool/);
  assert.equal(bedCredit(path.join(dir, "evening", "ok.norm.mp3"), dir), "Music: Artist ok – Track ok");
});

test("no manifest at all: nothing airs from the library", () => {
  const dir = makeMusicLibrary({ evening: ["a.mp3"], morning: ["b.mp3"] }, { manifest: false });
  assert.deepEqual(listBeds("evening", dir), []);
  assert.equal(clearBed(path.join(dir, "evening", "a.mp3"), dir).ok, false);
  assert.match(loadManifest(dir).problems.join(), /manifest.json missing/);
});

test("credits: every cleared track, the library's exact wording, once each", () => {
  const dir = makeMusicLibrary({ evening: ["a.mp3"], morning: ["b.mp3"] });
  const tr = clearedTracks(dir);
  assert.equal(tr.length, 2);
  const lines = creditLines([...tr, tr[0]]);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => /Creative Commons Attribution 4\.0/.test(l)));
  assert.equal(screenCredit(tr[0]), `Music: ${tr[0].artist} – ${tr[0].title}`);
});

test("the procedural fallback bed renders with ffmpeg alone, and loops seamlessly", (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg not installed");
  const dir = tmp("radio-proc-");
  const f = ensureProceduralBed(dir);
  assert.ok(fs.statSync(f).size > 1_000_000);
  assert.equal(ensureProceduralBed(dir), f, "rendered once, reused");
  assert.equal(listFiles("evening", dir).length, 0, "not a daypart bed");
  // every voice completes whole cycles in the loop, so the seam has no click
  for (const hz of VOICES_FOR_TEST.flat()) assert.ok(Math.abs(hz * LOOP_SEC - Math.round(hz * LOOP_SEC)) < 1e-6, `${hz} Hz`);
  assert.ok(proceduralArgs("/x.wav").includes("lavfi"));
});

// ── 4. the standing watchdog ────────────────────────────────────────────────
function stubYt(state) {
  const calls = { transition: [] };
  return {
    calls,
    channelStatus: async () => { if (state.fail) { const e = new Error(state.fail.message); e.reason = state.fail.reason; throw e; } return state.channel; },
    listBroadcasts: async () => state.broadcasts,
    broadcastState: async (id) => state.lifeOf?.[id] ?? null,
    videoStatus: async (ids) => Object.fromEntries(ids.map((id) => [id, state.videos?.[id] || { found: true, uploadStatus: "uploaded", rejectionReason: null, regionBlocked: [] }])),
    transition: async (id, to) => { calls.transition.push([id, to]); },
  };
}
const CLEAN = () => ({ channel: { found: true, privacyStatus: "public", longUploadsStatus: "allowed" }, broadcasts: [{ id: "B1", title: "ScoopFeeds Radio LIVE", life: "live" }] });

test("simulated claim: PAUSE written, the live broadcast ended, the 24/7 radio stopped, DrJ alerted; resume only by hand", async () => {
  const baseDir = tmp();
  const state = CLEAN();
  const yt = stubYt(state);
  const alerts = [], stops = [];
  const run = () => watchOnce({ baseDir, yt, stopRadio: async () => stops.push(1), alert: async (m) => alerts.push(m), now: Date.now() });

  const first = await run();
  assert.equal(first.acted, false, "a clean channel is not an incident");
  assert.equal(fs.existsSync(path.join(baseDir, "PAUSE")), false);

  // a copyright claim blocks the broadcast in some regions
  state.videos = { B1: { found: true, uploadStatus: "uploaded", rejectionReason: null, regionBlocked: ["DE", "GB"] } };
  const second = await run();
  assert.equal(second.acted, true);
  assert.ok(fs.existsSync(path.join(baseDir, "PAUSE")));
  assert.match(fs.readFileSync(path.join(baseDir, "PAUSE"), "utf8"), /blocked in 2 region/);
  assert.deepEqual(yt.calls.transition, [["B1", "complete"]]);
  assert.equal(stops.length, 1);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /PAUSED.*copyright claim.*remove ~\/scoopfeeds-radio\/PAUSE by hand/s);

  // the same state again: no second alert, and PAUSE is never removed by the watchdog
  const third = await run();
  assert.equal(third.acted, false);
  assert.equal(alerts.length, 1);
  assert.ok(fs.existsSync(path.join(baseDir, "PAUSE")));
});

test("watchdog: a revoked broadcast, a strike-style restriction, a suspended account and a notice file are each incidents", async () => {
  const base = { at: 0, youtube: { read: true, account: "active", channel: { found: true, longUploadsStatus: "allowed" }, broadcasts: [], videos: {} }, x: { read: false }, notices: [] };
  const v = (y = {}, extra = {}) => ({ ...base, youtube: { ...base.youtube, ...y }, ...extra });
  assert.match(incidents(base, v({ broadcasts: [{ id: "B1", title: "t", life: "revoked" }] })).join(), /revoked/);
  assert.match(incidents(base, v({ channel: { found: true, longUploadsStatus: "disallowed" } })).join(), /disallows long uploads/);
  assert.match(incidents(base, v({ account: "suspended", error: "accountSuspended" })).join(), /suspended/);
  assert.match(incidents(base, v({ videos: { B1: { rejectionReason: "copyright" } } })).join(), /rejected broadcast B1: copyright/);
  assert.match(incidents(base, v({}, { notices: [{ name: "x-takedown.txt", platform: "X", text: "DMCA notice for broadcast 123" }] })).join(), /X notice.*DMCA/);
  assert.deepEqual(incidents(base, base), []);

  // a broadcast that was live last pass and is now revoked is found by its own state
  const baseDir = tmp();
  const state = CLEAN();
  const yt = stubYt(state);
  const alerts = [];
  await watchOnce({ baseDir, yt, alert: async (m) => alerts.push(m) });
  state.broadcasts = []; state.lifeOf = { B1: "revoked" };
  const r = await watchOnce({ baseDir, yt, alert: async (m) => alerts.push(m) });
  assert.equal(r.acted, true);
  assert.match(alerts[0], /revoked/);
});

test("watchdog: X refusing the stream for 15 min while YouTube stays live is an incident; a notice dropped in notices/ is too", async () => {
  const baseDir = tmp();
  const now = Date.now();
  fs.writeFileSync(path.join(baseDir, "outputs.json"), JSON.stringify({ outputs: [{ id: "youtube", state: "live" }, { id: "x", state: "reconnecting", since: now - 16 * 60_000, lastError: "Connection refused" }] }));
  const s = await readStanding({ yt: null, baseDir, now });
  assert.match(s.x.note, /X has refused the stream for 16 min/);
  fs.mkdirSync(path.join(baseDir, "notices"));
  fs.writeFileSync(path.join(baseDir, "notices", "youtube-claim-2026-10-30.txt"), "Copyright claim on the live stream: track X");
  const r = await watchOnce({ baseDir, yt: null, alert: async () => {}, now });
  assert.equal(r.acted, true);
  assert.match(r.reason, /X has refused.*YouTube notice/s);
});

test("watchdog: a pass that cannot read YouTube is not an incident and does not forget the baseline", async () => {
  const baseDir = tmp();
  const state = CLEAN();
  const yt = stubYt(state);
  await watchOnce({ baseDir, yt, alert: async () => {} });
  state.fail = { message: "HTTP 503 backendError", reason: "backendError" };
  const r = await watchOnce({ baseDir, yt, alert: async () => {} });
  assert.equal(r.acted, false);
  assert.match(r.line, /YouTube channel unknown/);
  const saved = JSON.parse(fs.readFileSync(path.join(baseDir, "standing.json"), "utf8"));
  assert.equal(saved.baseline.youtube.read, true, "the last good reading is kept");
});

test("weekly standing line: what the API cannot read says unknown, never OK", () => {
  const line = standingLine({ youtube: { read: true, account: "active", channel: { found: true, longUploadsStatus: "allowed" }, broadcasts: [], strikes: null, claims: null }, x: { read: false } });
  assert.match(line, /strikes unknown\/3/);
  assert.match(line, /open claims unknown/);
  assert.match(line, /X account unknown/);
  assert.equal(/\bOK\b/.test(line), false);
  assert.match(standingLine({}), /YouTube channel unknown/);
  assert.match(standingLine({ youtube: { read: true, strikes: 0, claims: 0, account: "active", channel: {} }, x: { read: true, state: "live" } }), /strikes 0\/3 · open claims 0/);
});

test("alerts: push (ntfy URL) and email both fire when configured; a failing channel does not stop the other", async () => {
  const posts = [], mails = [];
  const alert = makeRadioAlert({ env: { RADIO_ALERT_PUSH_URL: "https://ntfy.example/topic", RADIO_ALERT_EMAIL: "drj@example.com" }, platform: "linux",
    fetchImpl: async (url, init) => { posts.push([url, init.body]); return { ok: true, status: 200 }; }, mailer: async (m) => { mails.push(m); } });
  assert.deepEqual(await alert("ScoopFeeds Radio is PAUSED."), ["push", "email"]);
  assert.equal(posts[0][0], "https://ntfy.example/topic");
  assert.equal(mails[0].to, "drj@example.com");
  const half = makeRadioAlert({ env: { RADIO_ALERT_PUSH_URL: "https://ntfy.example/t", RADIO_ALERT_EMAIL: "d@e.com" }, platform: "linux", fetchImpl: async () => { throw new Error("offline"); }, mailer: async () => {} });
  assert.deepEqual(await half("x"), ["email"]);
});

// ── 5. film clearance ───────────────────────────────────────────────────────
test("film rotation: only a recorded no-issues check AND a clean API status airs; unknown is excluded", async () => {
  const dir = tmp("radio-films-");
  const now = Date.parse("2026-10-30T12:00:00Z");
  for (const [f, mt] of [["clean.mp4", 1], ["claimed.mp4", 2], ["unchecked.mp4", 3], ["unknown.mp4", 4], ["stale.mp4", 5]]) {
    fs.writeFileSync(path.join(dir, f), f); fs.utimesSync(path.join(dir, f), new Date(mt * 1e12), new Date(mt * 1e12));
  }
  fs.writeFileSync(path.join(dir, "clearance.json"), JSON.stringify({ films: [
    { file: "clean.mp4", videoId: "V1", copyright: "no-issues", checkedAt: "2026-10-29T10:00:00Z" },
    { file: "claimed.mp4", videoId: "V2", copyright: "claim: audio muted", checkedAt: "2026-10-29T10:00:00Z" },
    { file: "unknown.mp4", videoId: "V4", copyright: "no-issues", checkedAt: "2026-10-29T10:00:00Z" },
    { file: "stale.mp4", videoId: "V5", copyright: "no-issues", checkedAt: "2026-08-01T10:00:00Z" },
  ] }));
  const ok = { found: true, uploadStatus: "processed", rejectionReason: null, privacyStatus: "public", regionBlocked: [] };
  const yt = { videoStatus: async () => ({ V1: ok, V4: { found: false } }) };
  const logs = [];
  assert.equal(path.basename(await pickClearedFilm(dir, { yt, now, log: (m) => logs.push(m) })), "clean.mp4");
  assert.ok(logs.some((l) => /unchecked\.mp4: no recorded copyright check/.test(l)));
  assert.ok(logs.some((l) => /claimed\.mp4: .*not "no-issues"/.test(l)));
  assert.ok(logs.some((l) => /stale\.mp4: .*over 30 days/.test(l)));
  assert.ok(logs.some((l) => /unknown\.mp4: the video is not on the channel/.test(l)));
  assert.equal(await pickClearedFilm(dir, { yt: null, now }), null, "no API = unknown = nothing airs");
  assert.equal(await pickClearedFilm(dir, { yt: { videoStatus: async () => { throw new Error("quota"); } }, now }), null);
  assert.equal(await pickClearedFilm(path.join(dir, "unchecked.mp4"), { yt, now }), null, "a single unchecked file is excluded too");
  assert.match(apiProblem({ ...ok, rejectionReason: "copyright" }), /copyright/);
  assert.match(apiProblem({ ...ok, regionBlocked: ["US"] }), /blocked in 1/);
  assert.match(apiProblem(null), /unknown/);
  assert.equal(recordProblem({ videoId: "V", copyright: "no-issues", checkedAt: "2026-10-29" }, now), null);
});

// ── 6. election claims ──────────────────────────────────────────────────────
test("election: fraud, rigging or a winner unattributed is dropped; attributed to a named outlet or official, it airs", () => {
  const outlets = ["Reuters", "The Guardian"];
  assert.equal(electionClaim("The election was rigged."), "fraud");
  assert.equal(electionClaim("Smith won the Senate race in Ohio."), "winner");
  assert.equal(electionClaim("The Lakers beat the Celtics."), null);
  assert.match(electionClaimVerdict("The election was rigged.", { outlets }), /fraud/);
  assert.match(electionClaimVerdict("Smith won the Senate race in Ohio.", { outlets }), /winner/);
  assert.match(electionClaimVerdict("Officials say Smith won the Senate race.", { outlets }), /winner/, "no named office");
  assert.equal(electionClaimVerdict("The Associated Press projects that Smith won the Senate race in Ohio.", { outlets }), null);
  assert.equal(electionClaimVerdict("Reuters reports that Smith won the Senate race in Ohio.", { outlets }), null);
  assert.equal(electionClaimVerdict("Jones claimed the election was rigged, The Guardian reports.", { outlets }), null);
  assert.equal(electionClaimVerdict("Ohio's secretary of state said the count found no fraud.", { outlets }), null);
});

test("election: checkSegments drops the unattributed line and keeps the attributed one", () => {
  const pack = { top: [{ id: "t1", headline: "Ohio Senate race", count: 2, outlets: [{ source: "Reuters", title: "Smith leads in Ohio", description: "" }, { source: "AP", title: "AP calls Ohio", description: "" }] }], desks: {}, markets: [], weather: [] };
  const slots = [{ id: "the-hour", segment: "the-hour" }];
  const raw = { "the-hour": { lines: [
    { id: "s1", story: "t1", text: "Smith won the Senate race in Ohio." },
    { id: "s2", story: "t1", text: "Reuters reports that Smith won the Senate race in Ohio." },
    { id: "s3", story: "t1", text: "The vote was rigged." },
  ] } };
  const { segments, report } = checkSegments(raw, slots, pack);
  assert.deepEqual(segments["the-hour"].lines.map((l) => l.id), ["s2"]);
  assert.equal(report.filter((r) => /^election:/.test(r.drop)).length, 2);
});

// ── 7. factual titles ───────────────────────────────────────────────────────
test("titles: the default passes; BREAKING, clickbait and shouting are replaced with the default", () => {
  assert.deepEqual(titleProblems("ScoopFeeds Radio LIVE · The news, compared · Fri, 30 Oct 2026"), []);
  assert.match(titleProblems("BREAKING: ScoopFeeds Radio LIVE").join(), /BREAKING/);
  assert.match(titleProblems("You won't believe this hour").join(), /clickbait/);
  assert.match(titleProblems("Huge night!!").join(), /exclamation/);
  const r = factualTitle("SHOCKING ELECTION RESULTS", "Default");
  assert.equal(r.title, "Default");
  assert.equal(r.replaced, true);
});
