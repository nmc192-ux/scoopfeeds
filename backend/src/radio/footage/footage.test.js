/**
 * footage.test.js - #219: footage from the public and social clips, intake -> safety gate -> approval
 * -> insert queue. The model checks are injected fakes; ffmpeg/ffprobe are real when on PATH (the
 * credit and metadata tests skip, loudly, when they are not).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";

import { validateLicence, LICENCE_VERSION, LICENCE_TERMS, creditText } from "./licence.js";
import { createIntakeStore } from "./intakeStore.js";
import { verifyFootage, ffprobeMetadata, readFileClaims, checkMetadataAgainstStory, parseIso6709, judgeReverseSearch } from "./verify.js";
import { approveSubmission, rejectSubmission, isApprover } from "./approval.js";
import { createInsertQueue, InsertRefused, licenceComplete } from "./insertQueue.js";
import { renderAirCopy, hasBurnedCredit, creditSidecarPath } from "./credit.js";
import { queueSocialClip } from "./socialInsert.js";
import { clearancePath, hasValidClearance } from "../safety/contentSafety.js";
import { createLiveLog } from "../live/liveLog.js";

const HAVE_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "footage-test-"));
const allTicks = () => Object.fromEntries(LICENCE_TERMS.map((t) => [t.key, true]));
const goodLicence = (credit = { mode: "name", value: "Amina Q" }) => validateLicence({ version: LICENCE_VERSION, ticks: allTicks(), credit });

/** A real clip with phone-style tags. */
function makeClip(file, { sec = 3, filmedAt = "2026-10-23T10:05:00Z", location = "+51.5072-000.1276/", audio = true } = {}) {
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=black:s=640x360:d=${sec}:r=30`];
  if (audio) args.push("-f", "lavfi", "-i", `sine=d=${sec}`, "-shortest");
  if (filmedAt) args.push("-metadata", `creation_time=${filmedAt}`);
  if (location) args.push("-metadata", `location=${location}`);
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", file);
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return file;
}

/** Checkers that pass everything they are given (the gate's own logic is tested in contentSafety.test.js). */
function safeCheckers({ flagAt = null } = {}) {
  return {
    probe: (f) => { const m = ffprobeMetadata(f); return { durationSec: m.durationSec, hasVideo: m.hasVideo, hasAudio: m.hasAudio }; },
    sampleFrames: (_f, _o) => { const d = ffprobeMetadata(_f).durationSec; const out = []; for (let t = 0; t < d; t += 0.5) out.push({ t: +t.toFixed(3), path: "x" }); return out; },
    vision: (frames) => frames.map((f) => (flagAt !== null && Math.abs(f.t - flagAt) < 0.01 ? { t: f.t, verdict: "unsafe", categories: ["violence"] } : { t: f.t, verdict: "safe" })),
    transcribe: () => ({ text: "a tone" }),
    checkTranscript: () => ({ verdict: "safe" }),
    soundEvents: () => ({ verdict: "safe" }),
  };
}

const story = { startedAt: "2026-10-23T10:00:00Z", lat: 51.5, lon: -0.12 };
const reverseOk = () => ({ verdict: "no-older-copies", method: "test fake" });
const probeDur = (f) => ({ durationSec: ffprobeMetadata(f).durationSec });

async function submit(store, file, { credit } = {}) {
  const lic = goodLicence(credit);
  assert.equal(lic.ok, true, lic.errors?.join("; "));
  const { id, uploadToken } = store.create({ acceptance: lic.acceptance, sender: { contact: "a@example.com" }, claims: { storyId: "ev-1", place: "London" } });
  await store.receiveFile(id, uploadToken, fs.createReadStream(file), { contentType: "video/mp4" });
  return id;
}

// ── licence ─────────────────────────────────────────────────────────────────────────────────────

test("licence: every term must be ticked, the version current, and a credit chosen", () => {
  assert.equal(goodLicence().ok, true);
  for (const t of LICENCE_TERMS) {
    const ticks = allTicks(); ticks[t.key] = false;
    const r = validateLicence({ version: LICENCE_VERSION, ticks, credit: { mode: "anonymous" } });
    assert.equal(r.ok, false); assert.match(r.errors.join(), new RegExp(t.key));
  }
  assert.equal(validateLicence({ version: "old", ticks: allTicks(), credit: { mode: "anonymous" } }).ok, false);
  assert.equal(validateLicence({ version: LICENCE_VERSION, ticks: allTicks(), credit: {} }).ok, false);
  assert.equal(validateLicence({ version: LICENCE_VERSION, ticks: allTicks(), credit: { mode: "name", value: "<a href=x>" } }).ok, false);
  assert.equal(creditText({ mode: "handle", value: "@cam_1" }), "Video: @cam_1, sent to ScoopFeeds");
  assert.equal(creditText({ mode: "anonymous" }), "Video: viewer footage, sent to ScoopFeeds");
});

test("licence acceptance is stored with the file, in full", { skip: !HAVE_FFMPEG && "ffmpeg not on PATH" }, async () => {
  const d = tmp();
  const store = createIntakeStore({ dir: path.join(d, "intake") });
  const id = await submit(store, makeClip(path.join(d, "c.mp4")));
  const rec = store.get(id);
  const folder = store.folder(id);
  assert.ok(fs.existsSync(path.join(folder, "original.mp4")));
  assert.ok(fs.existsSync(path.join(folder, "submission.json")));
  assert.equal(rec.licence.version, LICENCE_VERSION);
  assert.equal(rec.licence.terms.length, LICENCE_TERMS.length);
  for (const t of rec.licence.terms) { assert.equal(t.accepted, true); assert.ok(t.text.length > 10); }
  assert.ok(licenceComplete(rec.licence));
  assert.equal(rec.status, "received");
  assert.equal(rec.uploadTokenSha256, "used");
  const keys = []; JSON.stringify(rec, (k, v) => { keys.push(k); return v; });
  assert.equal(keys.some((k) => /^(ip|ipAddress|remoteAddress|userAgent|deviceId)$/i.test(k)), false, "no IP address or device id is stored");
});

test("intake refuses a bad token, a second upload, a wrong type and an oversized file", async () => {
  const d = tmp();
  const store = createIntakeStore({ dir: d });
  const { id, uploadToken } = store.create({ acceptance: goodLicence().acceptance });
  await assert.rejects(store.receiveFile(id, "nope", Readable.from([Buffer.from("x")]), { contentType: "video/mp4" }), /bad upload token/);
  await assert.rejects(store.receiveFile(id, uploadToken, Readable.from([Buffer.from("x")]), { contentType: "text/html" }), /not accepted/);
  await assert.rejects(store.receiveFile(id, uploadToken, Readable.from([Buffer.alloc(2048)]), { contentType: "video/mp4", maxBytes: 1024 }), /over/);
  assert.equal(fs.existsSync(path.join(store.folder(id), "original.mp4")), false, "partial file removed");
  await store.receiveFile(id, uploadToken, Readable.from([Buffer.from("data")]), { contentType: "video/mp4" });
  await assert.rejects(store.receiveFile(id, uploadToken, Readable.from([Buffer.from("x")]), { contentType: "video/mp4" }), /bad upload token|already/);
  assert.throws(() => store.create({ acceptance: null }), /licence/);
});

// ── metadata ────────────────────────────────────────────────────────────────────────────────────

test("metadata: date and place compared with the story; missing ones are unmeasured, not passed", () => {
  assert.deepEqual(parseIso6709("+51.5072-000.1276+011.000/"), { lat: 51.5072, lon: -0.1276 });
  const ok = checkMetadataAgainstStory({ filmedAt: "2026-10-23T10:05:00Z", location: { lat: 51.5072, lon: -0.1276 } }, story, "2026-10-23T11:00:00Z");
  assert.equal(ok.ok, true, ok.reasons.join());
  const old = checkMetadataAgainstStory({ filmedAt: "2025-01-01T00:00:00Z", location: { lat: 51.5, lon: -0.12 } }, story, "2026-10-23T11:00:00Z");
  assert.match(old.reasons.join(), /older footage/);
  const far = checkMetadataAgainstStory({ filmedAt: "2026-10-23T10:05:00Z", location: { lat: 48.85, lon: 2.35 } }, story, "2026-10-23T11:00:00Z");
  assert.match(far.reasons.join(), /km from the story/);
  const future = checkMetadataAgainstStory({ filmedAt: "2026-10-23T12:00:00Z", location: { lat: 51.5, lon: -0.12 } }, story, "2026-10-23T11:00:00Z");
  assert.match(future.reasons.join(), /after it reached us/);
  const noDate = checkMetadataAgainstStory({ filmedAt: null, location: { lat: 51.5, lon: -0.12 } }, story, "2026-10-23T11:00:00Z");
  assert.match(noDate.reasons.join(), /no recording date \(unmeasured\)/);
  const noPlace = checkMetadataAgainstStory({ filmedAt: "2026-10-23T10:05:00Z", location: null }, story, "2026-10-23T11:00:00Z");
  assert.match(noPlace.reasons.join(), /carries none \(unmeasured\)/);
  const noStory = checkMetadataAgainstStory({ filmedAt: "2026-10-23T10:05:00Z", location: null }, {}, "2026-10-23T11:00:00Z");
  assert.match(noStory.reasons.join(), /story time unknown/);
  assert.equal(readFileClaims({ creation_time: "garbage" }).filmedAt, null);
});

test("reverse search: only an explicit no-older-copies with a method passes", () => {
  assert.equal(judgeReverseSearch({ verdict: "no-older-copies", method: "TinEye keyframes" }).ok, true);
  assert.equal(judgeReverseSearch({ verdict: "no-older-copies" }).ok, false);
  assert.equal(judgeReverseSearch(null).ok, false);
  assert.equal(judgeReverseSearch({ verdict: "unsure" }).ok, false);
  assert.match(judgeReverseSearch({ verdict: "older-copy-found", matches: [{ url: "https://x/y" }] }).reason, /https:\/\/x\/y/);
});

// ── credit ──────────────────────────────────────────────────────────────────────────────────────

/** Measure: is there bright text in the credit box (bottom-left) of EVERY frame of a black clip? */
function creditVisibleEveryFrame(file) {
  const W = 320, H = 180;
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  const frames = r.stdout.length / (W * H);
  let without = 0;
  for (let f = 0; f < frames; f++) {
    let max = 0;
    for (let y = 140; y < 172; y++) for (let x = 0; x < 200; x++) max = Math.max(max, r.stdout[f * W * H + y * W + x]);
    if (max < 160) without++;
  }
  return { frames, without };
}

test("credit: burned into every frame of the air copy, which is cut to 30 s", { skip: !HAVE_FFMPEG && "ffmpeg not on PATH" }, () => {
  const d = tmp();
  const src = makeClip(path.join(d, "long.mp4"), { sec: 34, audio: true });
  const air = path.join(d, "air.mp4");
  const rec = renderAirCopy(src, air, "Video: Amina Q, sent to ScoopFeeds", { playSec: 34 });
  assert.equal(rec.burnedIn, true);
  const dur = ffprobeMetadata(air).durationSec;
  assert.ok(dur <= 30.1, `air copy is ${dur} s`);
  const v = creditVisibleEveryFrame(air);
  assert.ok(v.frames >= 29 * 30, `only ${v.frames} frames`);
  assert.equal(v.without, 0, `${v.without} of ${v.frames} frames had no credit`);
  assert.equal(hasBurnedCredit(air).ok, true);
  assert.equal(readFileClaims(ffprobeMetadata(air).tags).location, null, "air copy drops the location tag");
  fs.appendFileSync(air, Buffer.from("tamper"));
  assert.match(hasBurnedCredit(air).why, /changed/);
  fs.rmSync(creditSidecarPath(air));
  assert.match(hasBurnedCredit(air).why, /no burned-in credit/);
});

// ── the whole route: intake -> safety -> approval -> queue ──────────────────────────────────────

test("ACCEPTANCE: a test clip goes intake -> checks -> safety gate -> approval -> insert queue", { skip: !HAVE_FFMPEG && "ffmpeg not on PATH" }, async () => {
  const d = tmp();
  const store = createIntakeStore({ dir: path.join(d, "intake") });
  const events = [];
  const queue = createInsertQueue({ dir: path.join(d, "queue"), probe: probeDur, intake: store, log: (r) => events.push(r), approvers: ["DrJ"] });
  const id = await submit(store, makeClip(path.join(d, "c.mp4")));

  const checks = await verifyFootage(store, store.get(id), { storyLookup: () => story, reverseSearch: reverseOk, safetyCheckers: safeCheckers() });
  assert.equal(checks.ok, true, checks.reasons.join("\n"));
  store.setChecks(id, checks);
  const air = store.airPath(store.get(id));
  assert.equal(hasValidClearance(air).ok, true);

  // Cannot be queued before approval.
  await assert.rejects(queue.admitPublicFootage(id), (e) => e instanceof InsertRefused && /not approved/.test(e.message));
  assert.throws(() => approveSubmission(store, id, { by: "someone", approvers: ["DrJ"] }), /not a named approver/);
  approveSubmission(store, id, { by: "DrJ", approvers: ["DrJ"] });
  const item = await queue.admitPublicFootage(id);
  assert.equal(item.state, "queued");
  assert.equal(item.credit, "Video: Amina Q, sent to ScoopFeeds");
  assert.equal(store.get(id).status, "queued");

  const taken = await queue.take();
  assert.equal(taken.qid, item.qid);
  queue.markAired(item.qid, { playedSec: 3 });
  assert.deepEqual(events.map((e) => e.type), ["insert-refused", "insert-admitted", "insert-taken", "insert-aired"]);
  assert.deepEqual(store.get(id).history.map((h) => h.status), ["awaiting-file", "received", "verified", "approved", "queued"]);
});

test("ACCEPTANCE: a clip that fails ANY check never reaches the queue", { skip: !HAVE_FFMPEG && "ffmpeg not on PATH" }, async () => {
  const cases = {
    "flagged frame (content rule)": { checkers: { safetyCheckers: safeCheckers({ flagAt: 1 }) }, want: /content safety: frame at 1\.00 s: flagged \(violence\)/ },
    "no safety checkers (unmeasured)": { checkers: { safetyCheckers: {} }, want: /content safety: no probe configured \(unmeasured\)/ },
    "no reverse search (unmeasured)": { checkers: { reverseSearch: undefined }, want: /reverse search: none configured \(unmeasured\)/ },
    "older copy found": { checkers: { reverseSearch: () => ({ verdict: "older-copy-found", matches: [{ url: "https://old" }] }) }, want: /older copy found/ },
    "reverse search throws": { checkers: { reverseSearch: () => { throw new Error("down"); } }, want: /reverse search: .*unmeasured/ },
    "story unknown": { checkers: { storyLookup: () => null }, want: /story this footage is for is unknown/ },
    "no story lookup": { checkers: { storyLookup: undefined }, want: /no story lookup configured/ },
    "no recording date": { clip: { filmedAt: null }, want: /no recording date \(unmeasured\)/ },
    "old footage": { clip: { filmedAt: "2024-05-01T00:00:00Z" }, want: /older footage/ },
    "far away": { clip: { location: "+48.8566+002.3522/" }, want: /km from the story/ },
  };
  for (const [name, c] of Object.entries(cases)) {
    const d = tmp();
    const store = createIntakeStore({ dir: path.join(d, "intake") });
    const queue = createInsertQueue({ dir: path.join(d, "queue"), probe: probeDur, intake: store, approvers: ["DrJ"] });
    const id = await submit(store, makeClip(path.join(d, "c.mp4"), c.clip || {}));
    const deps = { storyLookup: () => story, reverseSearch: reverseOk, safetyCheckers: safeCheckers(), ...(c.checkers || {}) };
    for (const k of Object.keys(c.checkers || {})) if (c.checkers[k] === undefined) delete deps[k];
    const checks = await verifyFootage(store, store.get(id), deps);
    assert.equal(checks.ok, false, `${name}: should fail`);
    assert.match(checks.reasons.join("\n"), c.want, `${name}: ${checks.reasons.join(" | ")}`);
    store.setChecks(id, checks);
    assert.equal(store.get(id).status, "verify-failed", name);
    assert.throws(() => approveSubmission(store, id, { by: "DrJ", approvers: ["DrJ"] }), /cannot approve/, name);
    await assert.rejects(queue.admitPublicFootage(id), InsertRefused, name);
    assert.equal(queue.pending().length, 0, `${name}: queue must be empty`);
  }
});

test("queue: a file changed after approval is refused at admission and withdrawn at take()", { skip: !HAVE_FFMPEG && "ffmpeg not on PATH" }, async () => {
  const d = tmp();
  const store = createIntakeStore({ dir: path.join(d, "intake") });
  const events = [];
  const queue = createInsertQueue({ dir: path.join(d, "queue"), probe: probeDur, intake: store, log: (r) => events.push(r), approvers: ["DrJ"] });
  const id = await submit(store, makeClip(path.join(d, "c.mp4")));
  store.setChecks(id, await verifyFootage(store, store.get(id), { storyLookup: () => story, reverseSearch: reverseOk, safetyCheckers: safeCheckers() }));
  approveSubmission(store, id, { by: "drj", approvers: ["DrJ"] });
  await queue.admitPublicFootage(id);
  fs.rmSync(clearancePath(store.airPath(store.get(id)))); // e.g. the rule version bumped, clearance gone
  assert.equal(await queue.take(), null);
  assert.equal(events.at(-1).type, "insert-withdrawn");
  assert.match(events.at(-1).reasons.join(), /content safety/);
});

test("approval: rejection by a named approver; a re-verification needs a fresh approval", { skip: !HAVE_FFMPEG && "ffmpeg not on PATH" }, async () => {
  const d = tmp();
  const store = createIntakeStore({ dir: path.join(d, "intake") });
  const queue = createInsertQueue({ dir: path.join(d, "queue"), probe: probeDur, intake: store, approvers: ["DrJ", "Sara"] });
  const id = await submit(store, makeClip(path.join(d, "c.mp4")));
  const deps = { storyLookup: () => story, reverseSearch: reverseOk, safetyCheckers: safeCheckers() };
  store.setChecks(id, await verifyFootage(store, store.get(id), deps));
  approveSubmission(store, id, { by: "Sara", approvers: ["DrJ", "Sara"] });
  // Re-verify (e.g. the story changed): the approval is cleared.
  store.setChecks(id, await verifyFootage(store, store.get(id), deps));
  assert.equal(store.get(id).approval, null);
  await assert.rejects(queue.admitPublicFootage(id), /not approved/);
  rejectSubmission(store, id, { by: "DrJ", approvers: ["DrJ", "Sara"], note: "faces of children" });
  assert.equal(store.get(id).status, "rejected");
  await assert.rejects(queue.admitPublicFootage(id), InsertRefused);
  assert.equal(isApprover("drj", ["DrJ"]), true);
  assert.equal(isApprover("", ["DrJ"]), false);
});

// ── route 1: social clips ───────────────────────────────────────────────────────────────────────

test("social clip: rules -> credit -> safety -> queue, logged in the live log when aired", { skip: !HAVE_FFMPEG && "ffmpeg not on PATH" }, async () => {
  const d = tmp();
  const liveLog = createLiveLog({ dir: path.join(d, "live-log") });
  const queue = createInsertQueue({ dir: path.join(d, "queue"), probe: probeDur, liveLog });
  const src = makeClip(path.join(d, "post.mp4"), { sec: 4 });
  const clip = { url: "https://x.com/reporter/status/1", handle: "reporter", platform: "x", durationSec: 4, isTheStory: true, storyId: "ev-1" };
  const item = await queueSocialClip(clip, src, path.join(d, "post.air.mp4"), { queue, safetyCheckers: safeCheckers() });
  assert.equal(item.credit, "via @reporter on X");
  assert.equal(hasBurnedCredit(item.file).credit, "via @reporter on X");
  const v = creditVisibleEveryFrame(item.file);
  assert.equal(v.without, 0);
  await queue.take();
  queue.markAired(item.qid, { playedSec: 4 });
  const logged = liveLog.readAll().filter((r) => r.type === "clip");
  assert.equal(logged.length, 1);
  assert.equal(logged[0].handle, "@reporter");
});

test("social clip: not the story, too long, or flagged never reaches the queue", { skip: !HAVE_FFMPEG && "ffmpeg not on PATH" }, async () => {
  const d = tmp();
  const queue = createInsertQueue({ dir: path.join(d, "queue"), probe: probeDur });
  const src = makeClip(path.join(d, "post.mp4"), { sec: 4 });
  const base = { url: "https://x.com/r/status/1", handle: "r", platform: "x", durationSec: 4, isTheStory: true };
  await assert.rejects(queueSocialClip({ ...base, isTheStory: false }, src, path.join(d, "a.mp4"), { queue, safetyCheckers: safeCheckers() }), /only when the post is the story/);
  await assert.rejects(queueSocialClip({ ...base, durationSec: 45 }, src, path.join(d, "b.mp4"), { queue, safetyCheckers: safeCheckers() }), /at most 30 s/);
  await assert.rejects(queueSocialClip(base, src, path.join(d, "c.mp4"), { queue, safetyCheckers: safeCheckers({ flagAt: 2 }) }), /refused/);
  await assert.rejects(queueSocialClip(base, src, path.join(d, "e.mp4"), { queue, safetyCheckers: {} }), /refused/);
  // A file that never went through the gate cannot be admitted directly either.
  await assert.rejects(queue.admitSocialClip(base, src), (e) => e instanceof InsertRefused && /content safety/.test(e.message) && /credit/.test(e.message));
  assert.equal(queue.pending().length, 0);
});
