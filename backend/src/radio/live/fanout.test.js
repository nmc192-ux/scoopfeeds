import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { FlvSplitter, createFanout, backoffMs, FANOUT } from "./fanout.js";

// ── a minimal FLV builder for the unit tests ──
const flvHeader = () => Buffer.from([0x46, 0x4c, 0x56, 1, 5, 0, 0, 0, 9, 0, 0, 0, 0]);
function tag(type, data, ts = 0) {
  const h = Buffer.alloc(11);
  h[0] = type; h.writeUIntBE(data.length, 1, 3); h.writeUIntBE(ts & 0xffffff, 4, 3); h[7] = (ts >>> 24) & 0xff;
  const p = Buffer.alloc(4); p.writeUInt32BE(11 + data.length);
  return Buffer.concat([h, Buffer.from(data), p]);
}
const META = tag(18, [2, 0, 10, ...Buffer.from("onMetaData")]);
const AVCSEQ = tag(9, [0x17, 0, 0, 0, 0, 1, 2]);
const AACSEQ = tag(8, [0xaf, 0, 0x12, 0x10]);
const KEY = (ts) => tag(9, [0x17, 1, 0, 0, 0, 9, 9], ts);
const INTER = (ts) => tag(9, [0x27, 1, 0, 0, 0, 8], ts);
const AUD = (ts) => tag(8, [0xaf, 1, 7, 7], ts);

test("FlvSplitter: whole tags out of arbitrary chunking, and the init segment a late joiner needs", () => {
  const stream = Buffer.concat([flvHeader(), META, AVCSEQ, AACSEQ, KEY(0), AUD(10), INTER(33), KEY(1000)]);
  const s = new FlvSplitter();
  const got = [];
  for (let i = 0; i < stream.length; i += 7) got.push(...s.push(stream.subarray(i, i + 7)));
  assert.deepEqual(got.map((t) => [t.type, t.keyframe, t.init]), [[18, false, true], [9, false, true], [8, false, true], [9, true, false], [8, false, false], [9, false, false], [9, true, false]]);
  assert.deepEqual(s.initSegment(), Buffer.concat([flvHeader(), META, AVCSEQ, AACSEQ]));
  assert.throws(() => new FlvSplitter().push(Buffer.from("NOTFLV-------")), /not FLV/);
});

test("backoff doubles from 1 s and is capped at 30 s", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(backoffMs), [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
});

// ── a fake relay process ──
function fakeSpawnFactory() {
  const procs = [];
  const fn = (cmd, args) => {
    const p = new EventEmitter();
    p.args = args; p.url = args.at(-1); p.written = []; p.exitCode = null; p.signalCode = null; p.backlog = 0;
    p.stderr = new EventEmitter();
    p.stdin = Object.assign(new EventEmitter(), {
      writable: true, write(b) { p.written.push(Buffer.from(b)); return true; }, end() { this.writable = false; },
    });
    Object.defineProperty(p.stdin, "writableLength", { get: () => p.backlog });
    p.kill = (sig) => { if (p.exitCode !== null || p.signalCode) return; p.signalCode = sig; p.stdin.writable = false; setImmediate(() => p.emit("exit", null, sig)); };
    procs.push(p);
    return p;
  };
  fn.procs = procs;
  fn.live = (url) => procs.filter((p) => p.url === url && !p.signalCode && p.exitCode === null);
  return fn;
}
const tickUntil = async (fan, clock, ms, step = 1000) => { for (let t = 0; t < ms; t += step) { clock.t += step; fan.tick(); await new Promise((r) => setImmediate(r)); } };
const OUTS = [
  { id: "youtube", label: "YouTube", priority: "primary", url: "rtmp://yt/live2/K1" },
  { id: "x", label: "X", priority: "primary", url: "rtmps://x/x/K2" },
  { id: "fb", label: "Facebook", priority: "secondary", url: "rtmps://fb/rtmp/K3", maxDurationSec: 8 * 3600 },
];

test("a joining relay gets the init segment, then waits for a keyframe; a failed relay reconnects alone", async () => {
  const sp = fakeSpawnFactory(), clock = { t: 1e9 }, logs = [];
  const fan = createFanout({ outputs: OUTS.slice(0, 2), spawn: sp, now: () => clock.t, log: (m) => logs.push(m) });
  fan.write(Buffer.concat([flvHeader(), META, AVCSEQ, AACSEQ, INTER(5), AUD(6)]));
  for (const p of sp.procs) assert.equal(p.written.length, 0, "nothing before the first keyframe");
  fan.write(KEY(1000));
  for (const p of sp.procs) assert.deepEqual(Buffer.concat(p.written), Buffer.concat([flvHeader(), META, AVCSEQ, AACSEQ, KEY(1000)]));
  await tickUntil(fan, clock, 4000);
  assert.deepEqual(fan.summary(), { youtube: "live", x: "live" });

  // X's link dies: only X goes to reconnecting; YouTube keeps receiving every tag
  const [yt, x] = sp.procs;
  x.stderr.emit("data", "Error submitting a packet to the muxer: Broken pipe\n");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(fan.summary(), { youtube: "live", x: "reconnecting" });
  const before = yt.written.length;
  fan.write(Buffer.concat([INTER(1033), AUD(1040)]));
  assert.equal(yt.written.length, before + 2);
  await tickUntil(fan, clock, 1000);
  const x2 = sp.live("rtmps://x/x/K2");
  assert.equal(x2.length, 1, "X respawned after its 1 s backoff");
  fan.write(INTER(1066));
  assert.equal(x2[0].written.length, 0, "the new X relay joins only at a keyframe");
  fan.write(KEY(2000));
  assert.deepEqual(Buffer.concat(x2[0].written), Buffer.concat([flvHeader(), META, AVCSEQ, AACSEQ, KEY(2000)]));
  assert.equal(sp.live("rtmp://yt/live2/K1").length, 1, "YouTube was never restarted");
  assert.ok(logs.some((l) => /X: output failed.*only this output/.test(l)));
  await fan.stop();
  assert.deepEqual(fan.summary(), { youtube: "off", x: "off" });
});

test("a stalled uplink (backlog past HARD_BACKLOG) cuts that relay loose instead of slowing the others", async () => {
  const sp = fakeSpawnFactory(), clock = { t: 1e9 };
  const fan = createFanout({ outputs: OUTS.slice(0, 2), spawn: sp, now: () => clock.t });
  fan.write(Buffer.concat([flvHeader(), META, AVCSEQ, AACSEQ, KEY(0)]));
  sp.procs[1].backlog = FANOUT.HARD_BACKLOG + 1;
  fan.write(INTER(33));
  assert.equal(fan.status().find((s) => s.id === "x").state, "reconnecting");
  assert.equal(fan.status().find((s) => s.id === "youtube").state, "connecting", "YouTube's relay untouched (not yet 3 s old)");
  assert.match(fan.status().find((s) => s.id === "x").lastError, /uplink stalled/);
  assert.equal(sp.procs[0].signalCode, null);
  await fan.stop();
});

test("under stress the secondary is dropped first and comes back after the cooldown; primaries untouched", async () => {
  const sp = fakeSpawnFactory(), clock = { t: 1e9 }, logs = [];
  const fan = createFanout({ outputs: OUTS, spawn: sp, now: () => clock.t, log: (m) => logs.push(m) });
  fan.write(Buffer.concat([flvHeader(), META, AVCSEQ, AACSEQ, KEY(0)]));
  await tickUntil(fan, clock, 4000);
  assert.deepEqual(fan.summary(), { youtube: "live", x: "live", fb: "live" });
  sp.procs[1].backlog = FANOUT.SOFT_BACKLOG + 1;   // X backing up: the uplink is short
  await tickUntil(fan, clock, 1000);
  assert.equal(fan.summary().fb, "off");
  assert.equal(fan.status().find((s) => s.id === "fb").state, "shed");
  assert.equal(sp.live("rtmp://yt/live2/K1").length + sp.live("rtmps://x/x/K2").length, 2, "both primaries still up");
  sp.procs[1].backlog = 0;
  await tickUntil(fan, clock, FANOUT.SHED_COOLDOWN_MS - 5000, 5000);
  assert.equal(sp.live("rtmps://fb/rtmp/K3").length, 0, "still shed inside the cooldown");
  await tickUntil(fan, clock, 10_000);
  assert.equal(sp.live("rtmps://fb/rtmp/K3").length, 1, "reconnected after the cooldown");
  assert.ok(logs.some((l) => /Facebook: dropped to keep the primary outputs up/.test(l)));
  await fan.stop();
});

test("a primary refused by its platform does not shed the secondary; a primary that stalls does", async () => {
  const sp = fakeSpawnFactory(), clock = { t: 1e9 };
  const fan = createFanout({ outputs: OUTS, spawn: sp, now: () => clock.t });
  fan.write(Buffer.concat([flvHeader(), META, AVCSEQ, AACSEQ, KEY(0)]));
  await tickUntil(fan, clock, 4000);
  sp.procs[1].stderr.emit("data", "rtmps://x/x/K2: Connection refused\n");
  await tickUntil(fan, clock, 3000);
  assert.equal(fan.summary().fb, "live", "X's server being down is not an uplink problem");
  for (const p of sp.live("rtmps://x/x/K2")) p.backlog = FANOUT.HARD_BACKLOG + 1;
  fan.write(KEY(5000));
  fan.write(INTER(5033));
  await tickUntil(fan, clock, 1000);
  assert.equal(fan.status().find((x) => x.id === "fb").state, "shed", "a stall is an uplink problem");
  await fan.stop();
});

test("a capped output restarts at a segment boundary, not before; the others are not touched", async () => {
  const sp = fakeSpawnFactory(), clock = { t: 1e9 }, logs = [];
  const fan = createFanout({ outputs: OUTS, spawn: sp, now: () => clock.t, log: (m) => logs.push(m) });
  fan.write(Buffer.concat([flvHeader(), META, AVCSEQ, AACSEQ, KEY(0)]));
  await tickUntil(fan, clock, 4000);
  fan.boundary();
  assert.equal(sp.procs.length, 3, "boundary before the restart is due does nothing");
  await tickUntil(fan, clock, (8 * 3600 - FANOUT.RESTART_MARGIN_SEC) * 1000, 600_000);
  assert.ok(logs.some((l) => /Facebook: .*restart due at the next segment boundary/.test(l)));
  assert.equal(sp.procs.length, 3, "due, but no boundary yet: still the first relay");
  fan.boundary();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sp.procs.length, 4, "Facebook relay restarted");
  assert.equal(sp.procs[3].url, "rtmps://fb/rtmp/K3");
  assert.equal(sp.procs[0].signalCode, null); assert.equal(sp.procs[1].signalCode, null);
  assert.equal(fan.status().find((s) => s.id === "fb").restarts, 1);
  await fan.stop();
});

test("a primary down for more than 5 minutes raises one primary-down event; no key in a log line or the status file", async () => {
  const sp = fakeSpawnFactory(), clock = { t: 1e9 };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fanout-"));
  const statusFile = path.join(dir, "outputs.json");
  const redact = (s) => String(s).split("K2").join("***").split("K1").join("***");
  const logs = [];
  const fan = createFanout({ outputs: OUTS.slice(0, 2), spawn: sp, now: () => clock.t, statusFile, redact, log: (m) => logs.push(m) });
  const events = [];
  fan.on("primary-down", (e) => events.push(e));
  fan.write(Buffer.concat([flvHeader(), META, AVCSEQ, AACSEQ, KEY(0)]));
  await tickUntil(fan, clock, 4000);
  sp.procs[1].stderr.emit("data", "rtmps://x/x/K2: Connection refused\n");
  for (let i = 0; i < 8 * 60; i++) {
    clock.t += 1000; fan.tick(); await new Promise((r) => setImmediate(r));
    for (const p of sp.live("rtmps://x/x/K2")) { p.stderr.emit("data", "rtmps://x/x/K2: Connection refused\n"); }
  }
  assert.equal(events.length, 1);
  assert.equal(events[0].id, "x");
  assert.ok(events[0].downMs > FANOUT.ALERT_AFTER_MS);
  assert.ok(logs.length > 0 && logs.every((l) => !l.includes("K2") && !l.includes("K1")), "no key in any log line");
  assert.ok(logs.some((l) => /\*\*\*: Connection refused/.test(l)));
  const body = fs.readFileSync(statusFile, "utf8");
  assert.ok(!body.includes("K2") && !body.includes("K1"), body);
  assert.deepEqual(JSON.parse(body).summary, { youtube: "live", x: "reconnecting" });
  await fan.stop();
  assert.deepEqual(JSON.parse(fs.readFileSync(statusFile, "utf8")).summary, { youtube: "off", x: "off" });
});

test("restart(id) restarts only that output (the #196 stream watch's YouTube restart); X is never touched", async () => {
  const sp = fakeSpawnFactory(), clock = { t: 1e9 }, logs = [];
  const fan = createFanout({ outputs: OUTS.slice(0, 2), spawn: sp, now: () => clock.t, log: (m) => logs.push(m) });
  fan.write(Buffer.concat([flvHeader(), META, AVCSEQ, AACSEQ, KEY(0)]));
  await tickUntil(fan, clock, 4000);
  assert.deepEqual(fan.summary(), { youtube: "live", x: "live" });
  const [yt1, x1] = sp.procs;
  assert.equal(fan.restart("youtube"), true);
  assert.equal(fan.restart("nope"), false);
  await new Promise((r) => setImmediate(r));
  assert.equal(yt1.signalCode, "SIGINT", "YouTube's relay ended cleanly");
  assert.equal(x1.signalCode, null, "X's relay untouched");
  const yt2 = sp.live("rtmp://yt/live2/K1");
  assert.equal(yt2.length, 1, "YouTube respawned at once (no backoff for a requested restart)");
  fan.write(KEY(2000));
  await tickUntil(fan, clock, 4000);
  assert.deepEqual(fan.summary(), { youtube: "live", x: "live" });
  assert.equal(sp.live("rtmps://x/x/K2")[0], x1);
  assert.equal(fan.status().find((s) => s.id === "youtube").restarts, 1);
  assert.ok(logs.some((l) => /YouTube: restart requested \(only this output\)/.test(l)));
  await fan.stop();
});

// ── loopback: real ffmpeg encoder -> fan-out -> three real local RTMP sinks ──
const hasFfmpeg = (() => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" });
  return r.status === 0 && /libx264/.test(r.stdout);
})();
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });

/** A local RTMP server for one destination that respawns after each client disconnect (until killed), counting bytes. */
function sink(port, name) {
  const s = { bytes: 0, sessions: 0, proc: null, dead: false, name };
  const start = () => {
    if (s.dead) return;
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-listen", "1", "-i", `rtmp://127.0.0.1:${port}/live/${name}`, "-c", "copy", "-f", "flv", "pipe:1"], { stdio: ["ignore", "pipe", "ignore"] });
    s.proc = p;
    p.stdout.on("data", (d) => { if (s.proc === p && d.length) { if (!p.counted) { p.counted = true; s.sessions++; } s.bytes += d.length; } });
    p.on("exit", () => { if (s.proc === p) setTimeout(start, 100); });
  };
  s.start = () => { s.dead = false; start(); };
  s.kill = () => { s.dead = true; try { s.proc?.kill("SIGKILL"); } catch { /* gone */ } };
  s.start();
  return s;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("loopback: killing one sink leaves the others receiving; it reconnects; a boundary restart of one causes no gap on the others",
  { skip: hasFfmpeg ? false : "ffmpeg with libx264 not on PATH", timeout: 90_000 }, async () => {
    const ports = [await freePort(), await freePort(), await freePort()];
    const names = ["yt", "x", "fb"];
    const sinks = names.map((n, i) => sink(ports[i], n));
    await wait(700);
    const outputs = [
      { id: "youtube", label: "YouTube", priority: "primary", url: `rtmp://127.0.0.1:${ports[0]}/live/yt` },
      { id: "x", label: "X", priority: "primary", url: `rtmp://127.0.0.1:${ports[1]}/live/x` },
      { id: "fb", label: "Facebook", priority: "secondary", url: `rtmp://127.0.0.1:${ports[2]}/live/fb`, maxDurationSec: 8 * 3600 },
    ];
    const logs = [];
    const fan = createFanout({ outputs, log: (m) => logs.push(m) });
    // the encoder: same shape as the playout's multi target (FLV on stdout), small picture so the test is cheap
    const enc = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
      "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k", "-flvflags", "no_duration_filesize", "-f", "flv", "pipe:1"], { stdio: ["ignore", "pipe", "ignore"] });
    enc.stdout.on("data", (d) => fan.write(d));
    try {
      await wait(6000);
      assert.deepEqual(fan.summary(), { youtube: "live", x: "live", fb: "live" }, JSON.stringify(fan.status()));
      for (const s of sinks) assert.ok(s.bytes > 20_000, `${s.name} received ${s.bytes} bytes`);

      // kill X's sink: YouTube and Facebook must keep receiving the whole time
      sinks[1].kill();
      const yt0 = sinks[0].bytes, fb0 = sinks[2].bytes, ytSess = sinks[0].sessions;
      const samples = [];
      for (let i = 0; i < 6; i++) { await wait(1000); samples.push([sinks[0].bytes, sinks[2].bytes]); }
      for (let i = 1; i < samples.length; i++) {
        assert.ok(samples[i][0] > samples[i - 1][0], `YouTube kept receiving (second ${i})`);
        assert.ok(samples[i][1] > samples[i - 1][1], `Facebook kept receiving (second ${i})`);
      }
      assert.ok(sinks[0].bytes > yt0 && sinks[2].bytes > fb0);
      assert.equal(sinks[0].sessions, ytSess, "YouTube never reconnected");
      assert.equal(fan.summary().x, "reconnecting");

      // bring X's sink back: X reconnects by itself
      const x0 = sinks[1].bytes;
      sinks[1].start();
      for (let i = 0; i < 40 && fan.summary().x !== "live"; i++) await wait(500);
      assert.equal(fan.summary().x, "live", JSON.stringify(fan.status()));
      await wait(1500);
      assert.ok(sinks[1].bytes > x0, "X receiving again");

      // planned restart of Facebook at a boundary (forced due): no gap on YouTube or X
      fan.outputs.find((o) => o.id === "fb").restartDue = true;
      const sess = sinks.map((s) => s.sessions);
      fan.boundary();
      const s2 = [];
      for (let i = 0; i < 6; i++) { await wait(1000); s2.push([sinks[0].bytes, sinks[1].bytes]); }
      for (let i = 1; i < s2.length; i++) assert.ok(s2[i][0] > s2[i - 1][0] && s2[i][1] > s2[i - 1][1], `primaries kept receiving through the Facebook restart (second ${i})`);
      assert.equal(sinks[0].sessions, sess[0]); assert.equal(sinks[1].sessions, sess[1]);
      assert.ok(sinks[2].sessions > sess[2], "Facebook reconnected as a new session");
      assert.equal(fan.summary().fb, "live");
      assert.ok(logs.some((l) => /Facebook: planned restart/.test(l)));
    } finally {
      enc.kill("SIGKILL");
      await fan.stop();
      for (const s of sinks) s.kill();
    }
  });
