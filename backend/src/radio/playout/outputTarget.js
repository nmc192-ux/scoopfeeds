/**
 * outputTarget.js - where the playout's encoded stream goes.
 *
 * DEFAULT IS A FILE. The RTMP path exists but is unreachable unless BOTH
 * RADIO_PLAYOUT_ENABLED=true (literally) AND a non-empty RADIO_STREAM_KEY are set.
 * With only one of them, or neither, resolveTarget() throws before anything is spawned.
 * The stream key is never logged: use redact() on anything that may contain it.
 */
import path from "node:path";

export const RTMP_BASE = "rtmp://a.rtmp.youtube.com/live2";

export function playoutEnabled(env = process.env) {
  return String(env.RADIO_PLAYOUT_ENABLED || "").trim().toLowerCase() === "true";
}

export function streamKey(env = process.env) {
  return String(env.RADIO_STREAM_KEY || "").trim();
}

/** True only when both gates are open. */
export function rtmpAllowed(env = process.env) {
  return playoutEnabled(env) && streamKey(env) !== "";
}

/**
 * Test hook: RADIO_PLAYOUT_RTMP_BASE may redirect the RTMP target, but ONLY to a loopback rtmp:// URL (a local test sink).
 * Anything else throws, so the hook cannot send the stream anywhere real. The two gates below still apply.
 */
export function rtmpBase(env = process.env) {
  const o = String(env.RADIO_PLAYOUT_RTMP_BASE || "").trim();
  if (!o) return RTMP_BASE;
  let u;
  try { u = new URL(o); } catch { throw new Error("RADIO_PLAYOUT_RTMP_BASE is not a URL"); }
  if (u.protocol !== "rtmp:" || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) {
    throw new Error("RADIO_PLAYOUT_RTMP_BASE is a test hook and only accepts a loopback rtmp:// URL");
  }
  return o.replace(/\/+$/, "");
}

/**
 * @param {{ out?: string|null, env?: object }} opts
 * @returns {{ kind: "file", path: string } | { kind: "segments", dir: string, segmentSec: number, keep: number } | { kind: "rtmp", url: string }}
 */
export function resolveTarget({ out = null, segmentsDir = null, segmentSec = 60, segmentKeep = 10, env = process.env } = {}) {
  if (out) return { kind: "file", path: path.resolve(out) };
  // Always-on dry run: a ring of `segmentKeep` x `segmentSec` s MPEG-TS files (~4.6 Mbps => ~350 MB at 10 x 60 s), so the disk cannot fill.
  if (segmentsDir) return { kind: "segments", dir: path.resolve(segmentsDir), segmentSec, keep: segmentKeep };
  if (!rtmpAllowed(env)) {
    throw new Error(
      "no output target: pass --out <file>, or set BOTH RADIO_PLAYOUT_ENABLED=true and RADIO_STREAM_KEY to enable the RTMP path",
    );
  }
  return { kind: "rtmp", url: `${rtmpBase(env)}/${streamKey(env)}` };
}

/** Strip the stream key (and anything after the RTMP base) from a string before it is logged. */
export function redact(text, env = process.env) {
  let s = String(text);
  const key = streamKey(env);
  if (key) s = s.split(key).join("***");
  return s.replace(new RegExp(`${RTMP_BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\S+`, "g"), `${RTMP_BASE}/***`);
}
