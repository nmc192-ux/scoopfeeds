#!/usr/bin/env node
/**
 * cli.js - run the radio playout.
 *   node cli.js [--segments-dir DIR (always-on dry run, rolling 10 x 60 s ring)] [--force-daypart-cycle SEC (test only)] --out test.mp4 --seconds 120 [--music-dir DIR] [--state-file FILE] [--base-url https://host] [--demo-cycle 15] [--programme DIR (play a produced hour: radio/programme/produce.mjs)] [--segment-keep N (ring size, default 10; 80 records a whole programme)] [--status-file FILE (per-destination live status, #207)] [--alerts off (no Mac notification when a primary is down; autoair alerts itself)]
 * Without --out the RTMP path is used, and only if RADIO_PLAYOUT_ENABLED=true AND RADIO_STREAM_KEY are both set.
 */
import { parseArgs } from "node:util";
import { runPlayout } from "./playout.js";
import { redact, resolveTarget } from "./outputTarget.js";
import { applyAutoQuality } from "../live/autoQuality.js";

const { values: v } = parseArgs({
  options: {
    out: { type: "string" }, "segments-dir": { type: "string" }, "force-daypart-cycle": { type: "string" }, seconds: { type: "string" }, "music-dir": { type: "string" },
    "state-file": { type: "string" }, programme: { type: "string" }, "segment-keep": { type: "string" }, "base-url": { type: "string" }, "demo-cycle": { type: "string" },
    "status-file": { type: "string" }, alerts: { type: "string" },
  },
});

const ac = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => ac.abort());

try {
  // #196: live RTMP only - measure the upload once and drop to 720p for this run when it is weak (RADIO_AUTO_QUALITY=off to skip)
  if (!v.out && !v["segments-dir"]) {
    let outputs = 0;
    try { const t = resolveTarget({ env: process.env }); outputs = t.kind === "multi" ? t.outputs.length : 1; } catch { /* runPlayout reports the missing gates */ }
    if (outputs) await applyAutoQuality({ env: process.env, outputs, log: (m) => console.log(`📻 playout: ${m}`) });
  }
  const res = await runPlayout({
    out: v.out, segmentsDir: v["segments-dir"], forceDaypartCycleSec: v["force-daypart-cycle"] ? Number(v["force-daypart-cycle"]) : 0, seconds: v.seconds ? Number(v.seconds) : undefined, musicDir: v["music-dir"],
    stateFile: v["state-file"], programmeDir: v.programme, segmentKeep: v["segment-keep"] ? Number(v["segment-keep"]) : undefined, baseUrl: v["base-url"], demoCycleSec: v["demo-cycle"] ? Number(v["demo-cycle"]) : 0,
    statusFile: v["status-file"], alerts: v.alerts,
    signal: ac.signal,
  });
  console.log(`📻 playout: finished ${JSON.stringify(res)}`);
  process.exit(res.reason === "completed" || res.reason === "stopped" ? 0 : 1);
} catch (err) {
  console.error(`📻 playout: ${redact(err.message)}`);
  process.exit(2);
}
