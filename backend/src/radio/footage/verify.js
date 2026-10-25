/**
 * verify.js - the checks a public submission must pass before an editor may approve it (#219 route 2).
 *
 *   metadata       the file's own date (and place, where the story has one) read from the ORIGINAL;
 *                  compared with the story's time and location
 *   reverseSearch  a search for older copies of the footage elsewhere (an injected service, or a
 *                  check a named editor attests to having done)
 *   safety         DrJ's content rule (#218): assertMediaSafe() on the credited AIR COPY, the exact
 *                  bytes that would go to air
 *
 * HONESTY RULE (issue #219): "if any check is unmeasured, the video does not air." A check that did not
 * run, had nothing to read, threw, or is unsure is a FAIL with its reason. Only `ok: true` from
 * verifyFootage lets the submission reach the approval step, and approval re-checks it.
 *
 * Every dependency is injected; tests never call a model or the network.
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { assertMediaSafe, MediaRefused } from "../safety/contentSafety.js";
import { renderAirCopy } from "./credit.js";
import { MAX_CLIP_SECONDS } from "../live/socialClips.js";

export const VERIFY_THRESHOLDS = Object.freeze({
  earliestBeforeStoryMin: 120, // footage filmed more than 2 h before the story began is refused
  clockSkewMin: 10,            // footage dated more than 10 min after it reached us is refused
  maxDistanceKm: 50,           // footage filmed more than 50 km from the story is refused
});

const FFPROBE = () => process.env.FFPROBE_PATH || "ffprobe";

/** ffprobe the original: duration, streams, and the tags a phone writes (time, place). */
export function ffprobeMetadata(file) {
  const r = spawnSync(FFPROBE(), ["-v", "error", "-show_entries", "format=duration:format_tags:stream=codec_type:stream_tags", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${(r.stderr || "").slice(-300)}`);
  const j = JSON.parse(r.stdout);
  const tags = { ...(j.format?.tags || {}) };
  for (const s of j.streams || []) for (const [k, v] of Object.entries(s.tags || {})) if (!(k in tags)) tags[k] = v;
  const types = (j.streams || []).map((s) => s.codec_type);
  return { durationSec: Number(j.format?.duration), hasVideo: types.includes("video"), hasAudio: types.includes("audio"), tags };
}

/** ISO 6709 ("+51.5072-000.1276+011.000/") as phones write it, to { lat, lon }. */
export function parseIso6709(s) {
  const m = String(s || "").match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return { lat, lon };
}

/** Where the file says it was filmed and when, from its own tags. Missing values are null, never guessed. */
export function readFileClaims(tags = {}) {
  const lower = Object.fromEntries(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), v]));
  const timeRaw = lower["com.apple.quicktime.creationdate"] || lower["creation_time"] || lower["date"] || null;
  const t = timeRaw ? Date.parse(timeRaw) : NaN;
  const locRaw = lower["com.apple.quicktime.location.iso6709"] || lower["location"] || lower["location-eng"] || null;
  return { filmedAt: Number.isFinite(t) ? new Date(t).toISOString() : null, filmedAtRaw: timeRaw, location: parseIso6709(locRaw), locationRaw: locRaw };
}

export function distanceKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Compare the file's metadata with the story. `story` = { startedAt, lat?, lon? }.
 * Returns { ok, reasons, measured }.
 */
export function checkMetadataAgainstStory(fileClaims, story, receivedAt, th = VERIFY_THRESHOLDS) {
  const reasons = [];
  const measured = { filmedAt: fileClaims.filmedAt, location: fileClaims.location };
  const storyStart = story?.startedAt ? Date.parse(story.startedAt) : NaN;
  if (!Number.isFinite(storyStart)) reasons.push("story time unknown (unmeasured)");
  if (!fileClaims.filmedAt) reasons.push("the file carries no recording date (unmeasured)");
  if (fileClaims.filmedAt && Number.isFinite(storyStart)) {
    const t = Date.parse(fileClaims.filmedAt);
    const earliest = storyStart - th.earliestBeforeStoryMin * 60_000;
    const latest = Date.parse(receivedAt) + th.clockSkewMin * 60_000;
    measured.minutesFromStoryStart = Math.round((t - storyStart) / 60_000);
    if (t < earliest) reasons.push(`filmed ${fileClaims.filmedAt}, more than ${th.earliestBeforeStoryMin} min before the story began (${story.startedAt}): may be older footage`);
    if (Number.isFinite(latest) && t > latest) reasons.push(`dated ${fileClaims.filmedAt}, after it reached us: the date is not trustworthy`);
  }
  const storyHasPlace = Number.isFinite(story?.lat) && Number.isFinite(story?.lon);
  if (storyHasPlace) {
    if (!fileClaims.location) reasons.push("the story has a location but the file carries none (unmeasured)");
    else {
      const km = distanceKm(fileClaims.location, { lat: story.lat, lon: story.lon });
      measured.distanceKm = Math.round(km * 10) / 10;
      if (km > th.maxDistanceKm) reasons.push(`filmed ${measured.distanceKm} km from the story (max ${th.maxDistanceKm} km)`);
    }
  } else measured.place = "story has no coordinates: place not compared";
  return { ok: reasons.length === 0, reasons, measured };
}

/** Normalise a reverse-search result. Only "no-older-copies" passes. */
export function judgeReverseSearch(r) {
  if (!r || typeof r !== "object") return { ok: false, reason: "reverse search did not run (unmeasured)" };
  if (r.verdict === "no-older-copies") {
    if (!r.method || !String(r.method).trim()) return { ok: false, reason: "reverse search result does not say how it was done (unmeasured)" };
    return { ok: true, reason: null };
  }
  if (r.verdict === "older-copy-found") return { ok: false, reason: `older copy found: ${(r.matches || []).map((m) => m.url || m).join(", ") || "(no link given)"}` };
  return { ok: false, reason: `reverse search ${r.verdict ? `returned "${r.verdict}"` : "returned no verdict"} (unmeasured)` };
}

/**
 * Run every check on one submission. Never throws for a bad submission; returns
 * { ok, reasons, metadata, reverseSearch, safety, airCopy }.
 *
 * @param store       intakeStore
 * @param rec         the submission record (status "received" or re-verifying)
 * @param deps        { probe(file), storyLookup(storyId|claims) -> story, reverseSearch(file, rec),
 *                      safetyCheckers (for assertMediaSafe), safetyLog, render(src, out, credit, opts), now() }
 */
export async function verifyFootage(store, rec, deps = {}) {
  const reasons = [];
  const out = { ok: false, reasons, checkedAt: null, metadata: null, reverseSearch: null, safety: null, airCopy: null };
  const now = deps.now || (() => new Date());
  const src = store.originalPath(rec);
  if (!src || !fs.existsSync(src)) { reasons.push("original file missing"); return done(); }

  // 1. metadata (from the original, before anything re-encodes it)
  let meta = null;
  try { meta = await (deps.probe || ffprobeMetadata)(src); } catch (e) { reasons.push(`metadata: probe failed: ${e.message}`); }
  let story = null;
  if (typeof deps.storyLookup !== "function") reasons.push("metadata: no story lookup configured (unmeasured)");
  else {
    try { story = await deps.storyLookup(rec.claims?.storyId || null, rec); } catch (e) { reasons.push(`metadata: story lookup failed: ${e.message}`); }
    if (!story) reasons.push("metadata: the story this footage is for is unknown (unmeasured)");
  }
  if (meta) {
    const fc = readFileClaims(meta.tags);
    const m = checkMetadataAgainstStory(fc, story || {}, rec.file?.receivedAt || now().toISOString());
    out.metadata = { ...m, fileClaims: fc, story };
    // A missing story is already reported once above.
    for (const r of m.reasons) if (!(story === null && /^story time unknown/.test(r))) reasons.push(`metadata: ${r}`);
    if (!meta.hasVideo) reasons.push("metadata: the file has no picture");
  }

  // 2. reverse search for older copies
  if (typeof deps.reverseSearch !== "function") { out.reverseSearch = { ok: false, reason: "no reverse search configured (unmeasured)" }; reasons.push("reverse search: none configured (unmeasured)"); }
  else {
    let r = null;
    try { r = await deps.reverseSearch(src, rec); } catch (e) { r = { verdict: "error", error: e.message }; }
    const j = judgeReverseSearch(r);
    out.reverseSearch = { ...j, result: r };
    if (!j.ok) reasons.push(`reverse search: ${j.reason}`);
  }

  // 3. the air copy (credited, capped) and DrJ's content rule on exactly those bytes
  const air = store.airPath(rec);
  if (meta?.hasVideo) {
    try {
      const playSec = Math.min(Number(meta.durationSec) || MAX_CLIP_SECONDS, MAX_CLIP_SECONDS);
      const render = deps.render || renderAirCopy;
      out.airCopy = await render(src, air, rec.credit, { playSec, hasAudio: !!meta.hasAudio });
    } catch (e) { reasons.push(`air copy: ${e.message}`); }
  }
  if (out.airCopy) {
    try {
      const rep = await assertMediaSafe({ id: rec.id, file: air, kind: "public-footage" }, deps.safetyCheckers || {}, { log: deps.safetyLog || null });
      out.safety = { ok: true, ruleVersion: rep.ruleVersion, checks: rep.checks };
    } catch (e) {
      if (e instanceof MediaRefused) {
        out.safety = { ok: false, reasons: e.report.reasons };
        for (const r of e.report.reasons) reasons.push(`content safety: ${r.reason}`);
      } else { out.safety = { ok: false, error: e.message }; reasons.push(`content safety: ${e.message}`); }
    }
  } else if (meta?.hasVideo) reasons.push("content safety: not run because the air copy could not be made (unmeasured)");

  return done();
  function done() {
    out.checkedAt = now().toISOString();
    out.ok = reasons.length === 0;
    return out;
  }
}
