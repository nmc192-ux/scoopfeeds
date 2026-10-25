/**
 * bandwidth.js - can the Mac mini's home uplink carry every live output itself? (#207, build step 1)
 *
 * Path (a), DIRECT: the Mac sends each destination itself (live/fanout.js). Allowed only when the measured upload
 * covers all outputs with 40% headroom, judged on the WORST sample (a dip mid-broadcast is what drops a stream).
 * Path (b), RELAY on the ScoopFeeds VPS: the Mac sends one stream and the VPS fans out. That changes the server, so it
 * is stop-list item 2 and waits for DrJ (engine:needs-drj). Nothing here builds or provisions it.
 *
 * Samples come from deploy/macos/measure-upload.sh (macOS `networkQuality`), one JSON object per line.
 */
import fs from "node:fs";
import { AUDIO, outputQuality } from "../playout/ffmpegArgs.js";

export const HEADROOM = 1.4;      // DrJ, #207: 40% headroom
export const OVERHEAD = 1.1;      // RTMP/FLV + TCP framing on top of the encoder's CBR

/** Upload one output needs at the current quality, and the total for `outputs` with headroom, in Mbps. */
export function requiredMbps({ outputs = 2, env = process.env } = {}) {
  const perOutput = ((outputQuality(env).bitrateK + AUDIO.bitrateK) * OVERHEAD) / 1000;
  return { perOutput: round(perOutput), total: round(perOutput * outputs), withHeadroom: round(perOutput * outputs * HEADROOM) };
}

/** Read measure-upload.sh's JSONL: [{ at, uploadMbps }], ignoring junk lines. */
export function readSamples(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((x) => x && Number.isFinite(x.uploadMbps) && x.uploadMbps > 0);
}

/**
 * The call, in plain words. Fewer than `minSamples` samples is UNVERIFIED, never "direct".
 * @returns {{ path: "direct"|"relay"|"unverified", need: number, worst: number|null, median: number|null, samples: number, reason: string }}
 */
export function choosePath(samples, { outputs = 2, env = process.env, minSamples = 4 } = {}) {
  const need = requiredMbps({ outputs, env }).withHeadroom;
  const v = samples.map((s) => s.uploadMbps).sort((a, b) => a - b);
  const worst = v.length ? round(v[0]) : null, median = v.length ? round(v[Math.floor(v.length / 2)]) : null;
  if (v.length < minSamples) return { path: "unverified", need, worst, median, samples: v.length, reason: `only ${v.length} upload sample(s); need ${minSamples} across a day before choosing` };
  if (worst >= need) return { path: "direct", need, worst, median, samples: v.length, reason: `worst sample ${worst} Mbps covers ${outputs} outputs with 40% headroom (${need} Mbps): the Mac sends each destination itself` };
  return { path: "relay", need, worst, median, samples: v.length, reason: `worst sample ${worst} Mbps is below the ${need} Mbps that ${outputs} outputs need with 40% headroom: recommend the VPS relay (stop-list item 2, needs DrJ), or 720p` };
}

const round = (n) => Math.round(n * 10) / 10;

// CLI: node src/radio/live/bandwidth.js [samples.jsonl] [outputs]
import { fileURLToPath } from "node:url";
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] || `${process.env.HOME}/scoopfeeds-radio/upload-samples.jsonl`;
  const outputs = Number(process.argv[3] || 2);
  const r = choosePath(readSamples(file), { outputs });
  console.log(JSON.stringify({ file, outputs, need1080p: requiredMbps({ outputs, env: {} }), need720p: requiredMbps({ outputs, env: { RADIO_PLAYOUT_QUALITY: "720p" } }), ...r }, null, 1));
}
