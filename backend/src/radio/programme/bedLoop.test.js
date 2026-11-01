/**
 * 1 Nov 2026: hours refused by the listen-back (#273) for dead air every ~3 minutes. Cause: the evening bed
 * (Atlantean Twilight) ends in 7.3 s of silence and is looped under the whole hour. These pin the three fixes:
 * the bed loops on a copy without its silent start and end, a peak limiter on the mix, and "24 hours" backed in
 * the Crypto segment.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loopCopy } from "./beds.js";
import { makeLimiter, LIMIT_CEILING, durationSecs, decode } from "./assemble.js";
import { checkSegments, CRYPTO_WINDOW_H } from "./checks.js";

const ffmpeg = (args) => spawnSync(process.env.FFMPEG || "ffmpeg", ["-v", "error", "-y", ...args]);

test("loopCopy: a bed with a silent head and tail loops on the sound only, and the copy is cached", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bedloop-"));
  fs.mkdirSync(path.join(dir, "evening"));
  const f = path.join(dir, "evening", "tone.wav");
  // 2 s silence, 20 s tone, 7 s silence: the shape of Atlantean Twilight's tail
  const r = ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo:d=2", "-f", "lavfi", "-i", "sine=f=330:r=44100:d=20",
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo:d=7", "-filter_complex", "[1]aformat=channel_layouts=stereo,volume=0.3[t];[0][t][2]concat=n=3:v=0:a=1", f]);
  if (r.status !== 0) return;   // no ffmpeg here: the produce/listen-back run on the Mac still judges it
  assert.ok(Math.abs(durationSecs(f) - 29) < 0.2);
  const logs = [];
  const a = loopCopy(f, dir, { log: (m) => logs.push(m) });
  assert.notEqual(a.file, f);
  assert.ok(a.len > 19.4 && a.len < 20.6, `trimmed length ${a.len}`);
  assert.ok(logs.some((m) => /loops on/.test(m)));
  // the start and end of the loop are sound (the lavfi sine is 1/8 full scale, x0.3), not silence (past the 0.3 s fades)
  const pcm = decode(a.file);
  const rms = (from, to) => { let s = 0; for (let i = from * 2; i < to * 2; i++) s += pcm[i] * pcm[i]; return Math.sqrt(s / ((to - from) * 2)); };
  const n = pcm.length / 2;
  assert.ok(rms(Math.round(0.5 * 44100), Math.round(1.0 * 44100)) > 0.01);
  assert.ok(rms(n - Math.round(1.0 * 44100), n - Math.round(0.5 * 44100)) > 0.01);
  const mtime = fs.statSync(a.file).mtimeMs;
  const b = loopCopy(f, dir);
  assert.equal(b.file, a.file);
  assert.equal(fs.statSync(b.file).mtimeMs, mtime, "cached copy is reused");
  // the trimmed copy is outside the daypart folders, so it is never listed as a track
  assert.ok(!path.dirname(a.file).endsWith("evening"));
});

test("loopCopy: a file that cannot be read loops as the original (and the listen-back still judges the hour)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bedloop-"));
  const f = path.join(dir, "not-audio.mp3");
  fs.writeFileSync(f, "nope");
  const logs = [];
  const a = loopCopy(f, dir, { log: (m) => logs.push(m) });
  assert.equal(a.file, f);
  assert.ok(logs.some((m) => /looping the original/.test(m)));
});

test("makeLimiter: nothing past -1 dBFS, nothing changed below it", () => {
  const quiet = Float32Array.from({ length: 2000 }, (_, i) => 0.5 * Math.sin(i / 7));
  const copy = Float32Array.from(quiet);
  makeLimiter()(quiet);
  assert.deepEqual(quiet, copy, "below the ceiling the mix is bit-identical");
  const hot = Float32Array.from({ length: 20000 }, (_, i) => 1.4 * Math.sin(i / 5));
  makeLimiter()(hot);
  assert.ok(Math.max(...hot.map(Math.abs)) <= LIMIT_CEILING + 1e-6);
  // state carries across slot buffers: the next buffer does not jump back to full gain mid-peak
  const lim = makeLimiter();
  const a = new Float32Array([1.5, 1.5]), b = new Float32Array([1.0, 1.0]);
  lim(a); lim(b);
  assert.ok(b[0] <= LIMIT_CEILING + 1e-6);
});

test("checks: a crypto line's '24 hours' is backed (every change in the pack is a 24-hour change)", () => {
  assert.equal(CRYPTO_WINDOW_H, 24);
  const pack = { top: [], desks: {}, markets: [], weather: [], crypto: [{ symbol: "ETH", name: "Ether", price: 2264, pct: 1.2 }] };
  const slots = [{ id: "crypto", segment: "crypto", kind: "spoken" }];
  const segments = { crypto: { lines: [{ id: "c1", text: "Ether is at 2,264 dollars, up 1.2 percent over the past 24 hours." }, { id: "c2", text: "Ether is at 2,264 dollars, up 9 percent." }] } };
  const { segments: out, report } = checkSegments(segments, slots, pack);
  const kept = (out.crypto?.lines || []).map((l) => l.id);
  assert.ok(kept.includes("c1"), JSON.stringify(report));
  assert.ok(!kept.includes("c2"), "an unbacked figure is still dropped");
});
