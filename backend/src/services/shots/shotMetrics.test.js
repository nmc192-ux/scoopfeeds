import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFileSync } from "child_process";
import { BARS, evaluate, recordShort, markPublished, publishedOn } from "./shotMetrics.js";

const good = { realShare: 0.86, videoShare: 0.26, avgShotSecs: 2.43, cardFallbacks: 0, outlets: 6 };
const loud = { after_aac: { I: -14.1, TP: -1.9 } };

test("the bars are the brief's §0 numbers", () => {
  assert.equal(BARS.realShareMin, 0.7);
  assert.equal(BARS.videoShareMin, 0.25);
  assert.equal(BARS.avgShotMax, 3.0);
  assert.equal(BARS.truePeakMax, -1.0);
});

test("a short that meets every bar passes", () => {
  assert.deepEqual(evaluate(good, loud, { videoFound: true }), { pass: true, misses: [] });
});

test("each miss is named — and a miss never blocks, it is only reported", () => {
  const v = evaluate({ ...good, realShare: 0.51, videoShare: 0.07, avgShotSecs: 3.4 }, { after_aac: { I: -16.2, TP: -0.4 } }, { videoFound: true });
  assert.equal(v.pass, false);
  assert.equal(v.misses.length, 5);
  assert.match(v.misses.join(" | "), /real imagery 51% < 70%/);
  assert.match(v.misses.join(" | "), /real video 7% < 25%/);
  assert.match(v.misses.join(" | "), /average shot 3.4s > 3s/);
  assert.match(v.misses.join(" | "), /loudness -16.2 LUFS/);
  assert.match(v.misses.join(" | "), /true peak -0.4 dBTP/);
});

test("the real-video bar applies only where the resolver found any video", () => {
  const v = evaluate({ ...good, videoShare: 0 }, loud, { videoFound: false });
  assert.equal(v.pass, true, v.misses.join("; "));
});

test("record → mark published → the digest lists it with its contact sheet; unpublished shorts are not listed", async () => {
  const saved = process.env.SCOOP_PERSISTENT_DATA_DIR;
  process.env.SCOOP_PERSISTENT_DATA_DIR = mkdtempSync(join(tmpdir(), "metrics-"));
  try {
    const mp4 = join(process.env.SCOOP_PERSISTENT_DATA_DIR, "s.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=24:duration=6", "-pix_fmt", "yuv420p", mp4]);
    const now = Date.parse("2026-09-25T10:00:00Z");
    const a = await recordShort({ article: { id: "a1", title: "T1", source_name: "DW" }, mp4, metrics: good, sound: { ...loud, tone: "neutral", bed: "library:neutral-1" }, videoFound: true, durationSecs: 6, now });
    await recordShort({ article: { id: "a2", title: "T2", source_name: "DW" }, mp4, metrics: { ...good, realShare: 0.4 }, sound: loud, videoFound: true, durationSecs: 6, now });
    assert.equal(a.bars.pass, true);
    assert.equal(publishedOn("2026-09-25").length, 0, "produced is not published");
    assert.equal(markPublished("a1", { youtubeId: "yt1", now: now + 1000 }), true);
    const day = publishedOn("2026-09-25");
    assert.deepEqual(day.map((r) => r.articleId), ["a1"]);
    assert.equal(day[0].youtubeId, "yt1");
    assert.ok(existsSync(day[0].sheetPath), "the 12-frame contact sheet exists");
    assert.equal(markPublished("nope", { youtubeId: "x" }), false);
  } finally {
    if (saved === undefined) delete process.env.SCOOP_PERSISTENT_DATA_DIR; else process.env.SCOOP_PERSISTENT_DATA_DIR = saved;
  }
});

// ─── The digest (Phase 6) ────────────────────────────────────────────────────
import { renderShotDigest, sendShotDigest, yesterdayUtc } from "./shotDigest.js";
import { sweepShotMetrics } from "./shotMetrics.js";
import { mkdirSync } from "fs";

const rec = (over = {}) => ({ articleId: "a1", title: "Glacier lakes <threaten>", source: "DW", publishedAt: Date.parse("2026-09-25T09:00:00Z"),
  youtubeId: "yt1", metrics: { ...good, shots: 34 }, sound: { tone: "grief", bed: "library:tense-2", I: -14, TP: -1.9 },
  videoFound: true, bars: { pass: true, misses: [] }, sheetPath: "/tmp/a1.jpg", ...over });

test("the digest flags a missed bar in the subject and on the short, and embeds each contact sheet inline", () => {
  const d = renderShotDigest([rec(), rec({ articleId: "a2", bars: { pass: false, misses: ["real imagery 51% < 70%"] }, sheetPath: null })], "2026-09-25");
  assert.match(d.subject, /2 published · 1 missed a bar/);
  assert.match(d.html, /MISSED: real imagery 51% &lt; 70%/);
  assert.match(d.html, /Glacier lakes &lt;threaten&gt;/, "titles are escaped");
  assert.equal(d.attachments.length, 1);
  assert.match(d.html, new RegExp(`cid:${d.attachments[0].cid}`));
  assert.match(d.text, /MISSED: real imagery 51% < 70%/);
});

test("sendShotDigest skips cleanly — no recipient, no SMTP, nothing published — and sends attachments when it can", async () => {
  const saved = process.env.DIGEST_RECIPIENT_EMAIL;
  try {
    delete process.env.DIGEST_RECIPIENT_EMAIL;
    assert.equal((await sendShotDigest({ deps: { getTransport: () => ({}) } })).reason, "no_recipient");
    process.env.DIGEST_RECIPIENT_EMAIL = "drj@example.com";
    assert.equal((await sendShotDigest({ deps: { getTransport: () => null } })).reason, "no_smtp");
    assert.equal((await sendShotDigest({ deps: { getTransport: () => ({}), publishedOn: () => [] } })).reason, "empty");
    let sent = null;
    const r = await sendShotDigest({ day: "2026-09-25", deps: { getTransport: () => ({}), publishedOn: () => [rec()], sendMail: async (m) => { sent = m; } } });
    assert.equal(r.sent, true);
    assert.equal(sent.to, "drj@example.com");
    assert.equal(sent.attachments[0].path, "/tmp/a1.jpg");
  } finally { if (saved === undefined) delete process.env.DIGEST_RECIPIENT_EMAIL; else process.env.DIGEST_RECIPIENT_EMAIL = saved; }
});

test("the digest covers YESTERDAY (UTC) by default, and old day folders are swept", () => {
  assert.equal(yesterdayUtc(Date.parse("2026-09-25T07:56:00Z")), "2026-09-24");
  const saved = process.env.SCOOP_PERSISTENT_DATA_DIR;
  process.env.SCOOP_PERSISTENT_DATA_DIR = mkdtempSync(join(tmpdir(), "sweep-"));
  try {
    for (const d of ["2026-09-01", "2026-09-20", "2026-09-25"]) mkdirSync(join(process.env.SCOOP_PERSISTENT_DATA_DIR, "shot-metrics", d), { recursive: true });
    assert.equal(sweepShotMetrics({ now: Date.parse("2026-09-25T12:00:00Z"), days: 14 }).removed, 1);
    assert.ok(existsSync(join(process.env.SCOOP_PERSISTENT_DATA_DIR, "shot-metrics", "2026-09-20")));
  } finally { if (saved === undefined) delete process.env.SCOOP_PERSISTENT_DATA_DIR; else process.env.SCOOP_PERSISTENT_DATA_DIR = saved; }
});
