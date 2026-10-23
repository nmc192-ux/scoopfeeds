#!/usr/bin/env node
/**
 * cli.js - run the radio playout.
 *   node cli.js [--live-now FEED_ID --live-url URL [--live-minutes 5] [--live-title T] (rehearsal, needs --segments-dir; #202)] [--segments-dir DIR (always-on dry run, rolling 10 x 60 s ring)] [--force-daypart-cycle SEC (test only)] --out test.mp4 --seconds 120 [--music-dir DIR] [--state-file FILE] [--base-url https://host] [--demo-cycle 15]
 * Without --out the RTMP path is used, and only if RADIO_PLAYOUT_ENABLED=true AND RADIO_STREAM_KEY are both set.
 */
import { parseArgs } from "node:util";
import { runPlayout } from "./playout.js";
import { redact } from "./outputTarget.js";

const { values: v } = parseArgs({
  options: {
    out: { type: "string" }, "segments-dir": { type: "string" }, "force-daypart-cycle": { type: "string" }, seconds: { type: "string" }, "music-dir": { type: "string" },
    "state-file": { type: "string" }, "base-url": { type: "string" }, "demo-cycle": { type: "string" },
    "live-now": { type: "string" }, "live-url": { type: "string" }, "live-minutes": { type: "string" }, "live-title": { type: "string" },
  },
});

const ac = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => ac.abort());

try {
  const res = await runPlayout({
    out: v.out, segmentsDir: v["segments-dir"], forceDaypartCycleSec: v["force-daypart-cycle"] ? Number(v["force-daypart-cycle"]) : 0, seconds: v.seconds ? Number(v.seconds) : undefined, musicDir: v["music-dir"],
    stateFile: v["state-file"], baseUrl: v["base-url"], demoCycleSec: v["demo-cycle"] ? Number(v["demo-cycle"]) : 0,
    liveNow: v["live-now"] ? { feed: v["live-now"], url: v["live-url"], minutes: v["live-minutes"] ? Number(v["live-minutes"]) : 5, title: v["live-title"] } : null,
    signal: ac.signal,
  });
  console.log(`📻 playout: finished ${JSON.stringify(res)}`);
  process.exit(res.reason === "completed" || res.reason === "stopped" ? 0 : 1);
} catch (err) {
  console.error(`📻 playout: ${redact(err.message)}`);
  process.exit(2);
}
