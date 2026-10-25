/**
 * autoQuality.js - drop the live output to 720p when the Mac's uplink is weak (#196, build step 4).
 *
 * At playout start (live RTMP only) the upload is measured once with macOS's `networkQuality`. Below
 * UPLOAD_FLOOR_MBPS per live destination (DrJ, #196: 6 Mbps), RADIO_PLAYOUT_QUALITY=720p is set for this run.
 *   - RADIO_PLAYOUT_QUALITY set by hand always wins: nothing is measured.
 *   - RADIO_AUTO_QUALITY=off switches the measurement off.
 *   - A failed or impossible measurement (not a Mac, tool missing, timeout) changes nothing: the output stays at
 *     the 1080p default and the log says the upload was UNMEASURED.
 * Per destination, because with YouTube + X each output is sent separately (fanout.js): one output at 6 Mbps is
 * the spec's rule, two need 12. bandwidth.js remains the fuller, multi-sample judgement for the direct/relay call.
 */
import { spawn as nodeSpawn } from "node:child_process";

export const UPLOAD_FLOOR_MBPS = 6;

/** Why nothing should be measured, or null when the measurement should run. */
export function skipReason(env = process.env) {
  if (String(env.RADIO_PLAYOUT_QUALITY || "").trim()) return `RADIO_PLAYOUT_QUALITY=${String(env.RADIO_PLAYOUT_QUALITY).trim()} set by hand; not measured`;
  if (String(env.RADIO_AUTO_QUALITY || "").trim().toLowerCase() === "off") return "RADIO_AUTO_QUALITY=off";
  return null;
}

/** @returns {{ quality: "720p"|null, reason: string }} quality null = leave the setting as it is. */
export function chooseQuality({ uploadMbps, outputs = 1, env = process.env }) {
  const skip = skipReason(env);
  if (skip) return { quality: null, reason: skip };
  if (!Number.isFinite(uploadMbps) || uploadMbps <= 0) return { quality: null, reason: "upload UNMEASURED; staying at 1080p" };
  const floor = UPLOAD_FLOOR_MBPS * Math.max(1, outputs);
  if (uploadMbps < floor) return { quality: "720p", reason: `upload ${uploadMbps} Mbps is below ${floor} Mbps (${outputs} output${outputs > 1 ? "s" : ""} x ${UPLOAD_FLOOR_MBPS}); using 720p for this run` };
  return { quality: null, reason: `upload ${uploadMbps} Mbps covers ${floor} Mbps; staying at 1080p` };
}

/** networkQuality's computer-readable JSON -> upload in Mbps, or null. */
export function parseNetworkQuality(text) {
  try { const ul = Number(JSON.parse(String(text)).ul_throughput); return Number.isFinite(ul) && ul > 0 ? Math.round(ul / 1e4) / 100 : null; }
  catch { return null; }
}

/** One upload measurement on macOS (`networkQuality -s -c`, as measure-upload.sh), or null. Never throws. */
export function measureUploadMbps({ spawn = nodeSpawn, platform = process.platform, timeoutMs = 60_000 } = {}) {
  if (platform !== "darwin") return Promise.resolve(null);
  return new Promise((resolve) => {
    let out = "", done = false;
    const end = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
    let p;
    try { p = spawn("networkQuality", ["-s", "-c"], { stdio: ["ignore", "pipe", "ignore"] }); } catch { return resolve(null); }
    const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* gone */ } end(null); }, timeoutMs);
    p.stdout?.on("data", (d) => { out += d; });
    p.on("error", () => end(null));
    p.on("exit", () => end(parseNetworkQuality(out)));
  });
}

/** Measure (unless set by hand or off) and set env.RADIO_PLAYOUT_QUALITY for this run. Returns the decision. */
export async function applyAutoQuality({ env = process.env, outputs = 1, measure = measureUploadMbps, log = () => {} } = {}) {
  const skip = skipReason(env);
  if (skip) { log(`quality: ${skip}`); return { quality: null, reason: skip, uploadMbps: null }; }
  const uploadMbps = await measure();
  const d = chooseQuality({ uploadMbps, outputs, env });
  if (d.quality) env.RADIO_PLAYOUT_QUALITY = d.quality;
  log(`quality: ${d.reason}`);
  return { ...d, uploadMbps };
}
