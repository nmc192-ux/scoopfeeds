/**
 * loudness.js - measure a bed's integrated loudness (EBU R128) once, so the playout can apply a
 * fixed linear gain. A looped bed gets the same gain every pass: no loudnorm pumping on the loop.
 */
import { spawn } from "node:child_process";

/** Parse the "I:  -23.4 LUFS" summary block at the end of an ebur128 run. */
export function parseIntegrated(stderr) {
  const i = String(stderr).lastIndexOf("Integrated loudness");
  const tail = i >= 0 ? String(stderr).slice(i) : "";
  const m = tail.match(/I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/);
  return m ? Number(m[1]) : null;
}

export function measureIntegrated(file, { ffmpeg = "ffmpeg", seconds = null } = {}) {
  return new Promise((resolve) => {
    const args = ["-hide_banner", "-nostats", "-i", file];
    if (seconds) args.push("-t", String(seconds));
    args.push("-af", "ebur128", "-f", "null", "-");
    let err = "";
    const p = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", () => resolve(null));
    p.on("close", () => resolve(parseIntegrated(err)));
  });
}
