import { test } from "node:test";
import assert from "node:assert/strict";

import { buildMediaFrameArgs, splitJpegs } from "./ffmpegArgs.js";
test("media frames: real-time decode from the offset, boxed onto 1920x1080, MJPEG on stdout", () => {
  const a = buildMediaFrameArgs({ file: "/x/a.mp4", ssSec: 12.3456 });
  assert.ok(a.includes("-re"));
  assert.equal(a[a.indexOf("-ss") + 1], "12.346");
  assert.ok(a.indexOf("-ss") < a.indexOf("-i"), "input seek, so the start is fast");
  assert.match(a[a.indexOf("-vf") + 1], /pad=1920:1080/);
  assert.equal(a.at(-1), "pipe:1");
  assert.equal(buildMediaFrameArgs({ file: "f", ssSec: -3 })[buildMediaFrameArgs({ file: "f", ssSec: -3 }).indexOf("-ss") + 1], "0.000");
});
test("splitJpegs: whole frames out, the partial tail kept", () => {
  const f1 = Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]), f2 = Buffer.from([0xff, 0xd8, 3, 0xff, 0xd9]);
  const r = splitJpegs(Buffer.concat([f1, f2, Buffer.from([0xff, 0xd8, 9])]));
  assert.equal(r.frames.length, 2);
  assert.deepEqual([...r.frames[1]], [...f2]);
  assert.deepEqual([...r.rest], [0xff, 0xd8, 9]);
});
