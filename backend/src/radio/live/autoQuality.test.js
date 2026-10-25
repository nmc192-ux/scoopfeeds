import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chooseQuality, parseNetworkQuality, applyAutoQuality, measureUploadMbps, UPLOAD_FLOOR_MBPS } from "./autoQuality.js";
import { buildFfmpegArgs } from "../playout/ffmpegArgs.js";

test("below 6 Mbps per output -> 720p; at or above stays 1080p; unmeasured changes nothing", () => {
  assert.equal(UPLOAD_FLOOR_MBPS, 6);
  assert.equal(chooseQuality({ uploadMbps: 5.9, env: {} }).quality, "720p");
  assert.equal(chooseQuality({ uploadMbps: 6, env: {} }).quality, null);
  assert.equal(chooseQuality({ uploadMbps: 9, outputs: 2, env: {} }).quality, "720p", "YouTube + X need 12");
  const u = chooseQuality({ uploadMbps: null, env: {} });
  assert.equal(u.quality, null); assert.match(u.reason, /UNMEASURED/);
});

test("a hand-set RADIO_PLAYOUT_QUALITY or RADIO_AUTO_QUALITY=off is never measured or overridden", async () => {
  let measured = 0;
  const measure = async () => { measured++; return 1; };
  const e1 = { RADIO_PLAYOUT_QUALITY: "1080p" };
  assert.equal((await applyAutoQuality({ env: e1, measure })).quality, null);
  assert.equal(e1.RADIO_PLAYOUT_QUALITY, "1080p");
  const e2 = { RADIO_AUTO_QUALITY: "OFF" };
  await applyAutoQuality({ env: e2, measure });
  assert.equal(e2.RADIO_PLAYOUT_QUALITY, undefined);
  assert.equal(measured, 0);
  const e3 = {};
  const d = await applyAutoQuality({ env: e3, measure });
  assert.equal(e3.RADIO_PLAYOUT_QUALITY, "720p"); assert.equal(d.uploadMbps, 1); assert.equal(measured, 1);
});

test("networkQuality JSON parses to Mbps; junk is null; non-macOS is not measured", async () => {
  assert.equal(parseNetworkQuality(JSON.stringify({ ul_throughput: 5_432_100 })), 5.43);
  assert.equal(parseNetworkQuality("garbage"), null);
  assert.equal(parseNetworkQuality("{}"), null);
  assert.equal(await measureUploadMbps({ platform: "linux" }), null);
  const fake = () => { const p = new EventEmitter(); p.stdout = new EventEmitter(); setImmediate(() => { p.stdout.emit("data", JSON.stringify({ ul_throughput: 12e6 })); p.emit("exit", 0); }); return p; };
  assert.equal(await measureUploadMbps({ platform: "darwin", spawn: fake }), 12);
  const hang = () => { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.kill = () => {}; return p; };
  assert.equal(await measureUploadMbps({ platform: "darwin", spawn: hang, timeoutMs: 20 }), null);
});

test("720p chosen here reaches the encoder's arguments (outputQuality reads process.env)", () => {
  const prev = process.env.RADIO_PLAYOUT_QUALITY;
  try {
    process.env.RADIO_PLAYOUT_QUALITY = "720p";
    const a = buildFfmpegArgs({ target: { kind: "rtmp", url: "rtmp://127.0.0.1/x/k" }, bed: "b.mp3", bedLufs: -16, audioPipe: true });
    assert.ok(a.join(" ").includes("scale=1280:720") && a.includes("2500k"));
  } finally { if (prev === undefined) delete process.env.RADIO_PLAYOUT_QUALITY; else process.env.RADIO_PLAYOUT_QUALITY = prev; }
});
