import { test } from "node:test";
import assert from "node:assert/strict";

import { DESTINATIONS, extraOutputs, redactAll } from "./destinations.js";
import { resolveTarget, redact } from "../playout/outputTarget.js";
import { buildFfmpegArgs, buildRelayArgs } from "../playout/ffmpegArgs.js";
import { choosePath, requiredMbps } from "./bandwidth.js";

const YT = { RADIO_PLAYOUT_ENABLED: "true", RADIO_STREAM_KEY: "yt-key-123" };
const X = { RADIO_X_ENABLED: "true", RADIO_X_STREAM_KEY: "x-secret-987", RADIO_X_RTMP_URL: "rtmps://va.pscp.tv:443/x/" };

// Captured from the pre-#207 code (feat/radio-test-hour @ d4eca98 + main) with the same inputs.
const GOLDEN = ["-hide_banner", "-loglevel", "warning", "-y", "-use_wallclock_as_timestamps", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-i", "pipe:0",
  "-thread_queue_size", "512", "-f", "s16le", "-ar", "44100", "-ac", "2", "-i", "pipe:3", "-map", "0:v:0", "-map", "1:a:0",
  "-vf", "fps=30,scale=1920:1080:flags=bicubic,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-pix_fmt", "yuv420p",
  "-r", "30", "-b:v", "4500k", "-minrate", "4500k", "-maxrate", "4500k", "-bufsize", "9000k",
  "-x264-params", "nal-hrd=cbr:force-cfr=1:keyint=60:min-keyint=60:scenecut=0", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
  "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2", "-rw_timeout", "7000000", "-f", "flv", "rtmp://a.rtmp.youtube.com/live2/yt-key-123"];

test("with every new destination flag unset, the encoder's ffmpeg arguments are byte-identical to before #207", () => {
  const saved = process.env.RADIO_PLAYOUT_QUALITY; delete process.env.RADIO_PLAYOUT_QUALITY;
  try {
    for (const env of [YT, { ...YT, RADIO_X_STREAM_KEY: "x", RADIO_X_RTMP_URL: "rtmp://h/x" }, { ...YT, RADIO_X_ENABLED: "1" }, { ...YT, RADIO_X_ENABLED: "yes" }]) {
      const t = resolveTarget({ env });
      assert.deepEqual(t, { kind: "rtmp", url: "rtmp://a.rtmp.youtube.com/live2/yt-key-123" });
      assert.equal(JSON.stringify(buildFfmpegArgs({ target: t, bed: "/m/bed.mp3", bedLufs: -20, audioPipe: true })), JSON.stringify(GOLDEN));
    }
  } finally { if (saved !== undefined) process.env.RADIO_PLAYOUT_QUALITY = saved; }
});

test("destinations are data: YouTube and X, both primary, no Facebook/Twitch this round (DrJ, 22 Oct)", () => {
  assert.deepEqual(DESTINATIONS.map((d) => [d.id, d.priority]), [["youtube", "primary"], ["x", "primary"]]);
  assert.ok(Object.isFrozen(DESTINATIONS));
  const x = DESTINATIONS.find((d) => d.id === "x");
  assert.deepEqual([x.enabledVar, x.keyVar, x.urlVar, x.maxDurationSec], ["RADIO_X_ENABLED", "RADIO_X_STREAM_KEY", "RADIO_X_RTMP_URL", 86400]);
});

test("#220: with X enabled, the X output carries X Live Studio's 24 h cap (86400 s); YouTube stays uncapped (null)", () => {
  assert.deepEqual(extraOutputs({ ...X }).outputs.map((o) => [o.id, o.maxDurationSec]), [["x", 86400]]);
  const t = resolveTarget({ env: { ...YT, ...X } });
  assert.deepEqual(t.outputs.map((o) => [o.id, o.maxDurationSec]), [["youtube", null], ["x", 86400]]);
  assert.equal(DESTINATIONS.find((d) => d.id === "youtube").maxDurationSec, null);
});

test("X needs RADIO_X_ENABLED literally true, plus a key and an rtmp(s) URL; a broken X is skipped, never fatal", () => {
  const t = resolveTarget({ env: { ...YT, ...X } });
  assert.equal(t.kind, "multi");
  assert.deepEqual(t.outputs.map((o) => [o.id, o.url]), [["youtube", "rtmp://a.rtmp.youtube.com/live2/yt-key-123"], ["x", "rtmps://va.pscp.tv:443/x/x-secret-987"]]);
  assert.deepEqual(t.skipped, []);
  for (const bad of [{ RADIO_X_STREAM_KEY: "" }, { RADIO_X_RTMP_URL: "" }, { RADIO_X_RTMP_URL: "https://va.pscp.tv/x" }, { RADIO_X_RTMP_URL: "not a url" }]) {
    const r = resolveTarget({ env: { ...YT, ...X, ...bad } });
    assert.equal(r.kind, "rtmp", JSON.stringify(bad));
    assert.equal(r.skipped.length, 1);
    assert.equal(r.skipped[0].id, "x");
    assert.ok(!JSON.stringify(r.skipped).includes("x-secret-987"));
  }
  // X alone cannot open the RTMP path: YouTube's two gates still hold
  assert.throws(() => resolveTarget({ env: { ...X } }), /no output target/);
  assert.throws(() => resolveTarget({ env: { ...X, RADIO_STREAM_KEY: "k" } }), /no output target/);
  assert.deepEqual(extraOutputs({ ...X, RADIO_X_ENABLED: "TRUE" }).outputs.length, 1, "case-insensitive literal true, like RADIO_PLAYOUT_ENABLED");
});

test("multi target: the encoder writes FLV to stdout and each relay copies to one URL with the dead-link timeout", () => {
  const t = resolveTarget({ env: { ...YT, ...X } });
  const a = buildFfmpegArgs({ target: t, bed: "b", bedLufs: -20, audioPipe: true });
  assert.deepEqual(a.slice(-5), ["-flvflags", "no_duration_filesize", "-f", "flv", "pipe:1"]);
  assert.ok(!a.some((s) => /rtmp|secret|yt-key/.test(s)), "no destination URL or key on the encoder's command line");
  const r = buildRelayArgs({ url: t.outputs[1].url });
  assert.deepEqual(r.slice(-5), ["-rw_timeout", "7000000", "-f", "flv", "rtmps://va.pscp.tv:443/x/x-secret-987"]);
  assert.ok(r.includes("copy"));
});

test("no key survives redact(): YouTube's and X's, enabled or not", () => {
  const env = { ...YT, ...X };
  const line = "relay rtmps://va.pscp.tv:443/x/x-secret-987 failed; yt rtmp://a.rtmp.youtube.com/live2/yt-key-123 ok; x-secret-987 yt-key-123";
  const out = redact(line, env);
  assert.ok(!out.includes("x-secret-987") && !out.includes("yt-key-123"), out);
  assert.ok(!redactAll("x-secret-987", { ...X, RADIO_X_ENABLED: "" }).includes("x-secret-987"), "a disabled destination's key is still redacted");
});

test("bandwidth: two 1080p outputs need ~14.3 Mbps with 40% headroom; the WORST sample decides; too few samples is unverified", () => {
  const env = {};
  assert.deepEqual(requiredMbps({ outputs: 2, env }), { perOutput: 5.1, total: 10.2, withHeadroom: 14.3 });
  assert.equal(requiredMbps({ outputs: 2, env: { RADIO_PLAYOUT_QUALITY: "720p" } }).withHeadroom, 8.1);
  const s = (...v) => v.map((uploadMbps) => ({ uploadMbps }));
  assert.equal(choosePath(s(40, 40), { env }).path, "unverified");
  assert.equal(choosePath(s(40, 30, 20, 15), { env }).path, "direct");
  assert.equal(choosePath(s(40, 30, 20, 12), { env }).path, "relay");
  assert.equal(choosePath(s(40, 30, 20, 12), { env: { RADIO_PLAYOUT_QUALITY: "720p" } }).path, "direct");
});
