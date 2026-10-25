/**
 * destinations.js - where the live radio goes, as data (#207).
 *
 * Each entry is one RTMP destination. YouTube is the original output and keeps its two gates
 * (RADIO_PLAYOUT_ENABLED=true AND RADIO_STREAM_KEY, see ../playout/outputTarget.js). Every other
 * destination has its own enable flag, which must be literally "true", plus its own key (and URL)
 * variables. Keys are never logged: redactAll() strips every key listed here, enabled or not.
 *
 * Scope (DrJ, 22 Oct 2026): YouTube and X only for now. Facebook (8 h cap per live video) and Twitch
 * are deferred to a later round; when they come, they are new entries here with
 * priority "secondary" and a maxDurationSec, and nothing else in the fan-out changes.
 *
 * priority: "primary" outputs are kept up first; under stress, "secondary" outputs are dropped first.
 * maxDurationSec: the platform's cap on one live video; the fan-out restarts that output at a segment
 *   boundary before the cap (null = no cap; X "start immediately" broadcasts have none).
 */
export const YOUTUBE_RTMP_BASE = "rtmp://a.rtmp.youtube.com/live2";

export const DESTINATIONS = Object.freeze([
  Object.freeze({ id: "youtube", label: "YouTube", priority: "primary", enabledVar: null, keyVar: "RADIO_STREAM_KEY", urlVar: null, maxDurationSec: null }),
  Object.freeze({ id: "x", label: "X", priority: "primary", enabledVar: "RADIO_X_ENABLED", keyVar: "RADIO_X_STREAM_KEY", urlVar: "RADIO_X_RTMP_URL", maxDurationSec: null }),
]);

const str = (v) => String(v ?? "").trim();
export const flagOn = (env, name) => str(env[name]).toLowerCase() === "true";

/** A destination's ingest URL: rtmp:// or rtmps:// only, no trailing slash. Throws a named reason otherwise. */
export function ingestBase(raw, label) {
  const s = str(raw);
  if (!s) throw new Error(`${label}: no RTMP URL set`);
  let u;
  try { u = new URL(s); } catch { throw new Error(`${label}: RTMP URL is not a URL`); }
  if (u.protocol !== "rtmp:" && u.protocol !== "rtmps:") throw new Error(`${label}: RTMP URL must start rtmp:// or rtmps://`);
  return s.replace(/\/+$/, "");
}

/**
 * The extra destinations (everything but YouTube) whose flag is on.
 * @returns {{ outputs: Array<{id,label,priority,maxDurationSec,url}>, skipped: Array<{id,reason}> }}
 *   A destination whose flag is on but whose key or URL is missing/invalid is SKIPPED with a reason
 *   (never fatal): a misconfigured X must not take YouTube off air.
 */
export function extraOutputs(env = process.env, dests = DESTINATIONS) {
  const outputs = [], skipped = [];
  for (const d of dests) {
    if (d.id === "youtube" || !d.enabledVar || !flagOn(env, d.enabledVar)) continue;
    const key = str(env[d.keyVar]);
    if (!key) { skipped.push({ id: d.id, reason: `${d.enabledVar}=true but ${d.keyVar} is empty` }); continue; }
    let base;
    try { base = ingestBase(env[d.urlVar], d.label); } catch (e) { skipped.push({ id: d.id, reason: `${e.message} (${d.urlVar})` }); continue; }
    outputs.push({ id: d.id, label: d.label, priority: d.priority, maxDurationSec: d.maxDurationSec ?? null, url: `${base}/${key}` });
  }
  return { outputs, skipped };
}

/** Every stream key configured for any destination (enabled or not), longest first, for redaction. */
export function allKeys(env = process.env, dests = DESTINATIONS) {
  return dests.map((d) => str(env[d.keyVar])).filter(Boolean).sort((a, b) => b.length - a.length);
}

/** Strip every destination key from a string. */
export function redactAll(text, env = process.env, dests = DESTINATIONS) {
  let s = String(text);
  for (const k of allKeys(env, dests)) s = s.split(k).join("***");
  return s;
}
