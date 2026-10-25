/**
 * contentSafety.js - DrJ's absolute media rule (#218, 23 Oct 2026), and the one gate that enforces it
 * for pre-recorded items.
 *
 *   "NO SEXUAL, VIOLENCE and ABUSE, physical or otherwise, ANIMAL HARM and videos and audio in other
 *    such category will ever be allowed."
 *
 * The rule bans the MEDIA: footage, images and audio that show sexual content, violence, abuse
 * (physical or otherwise), harm to animals, or anything in the same category (gore, the aftermath of
 * injuries). It does not stop the radio REPORTING such a story in words under the existing story rules.
 * There is no override flag and no "newsworthy" exception. Loosening anything here is stop-list item 5
 * (docs/engine/full-throttle.md) and waits for DrJ.
 *
 * assertMediaSafe(item, checkers) is the single gate every pre-recorded item (social or journalist
 * clip, footage from the public, film, Short, feature) passes before it can be scheduled:
 *
 *   pictures  frames sampled at least once per second AND at every scene change, every one checked
 *   sound     the audio transcribed and the transcript checked, plus a sound-event check (screams,
 *             gunshots, ...), whenever the file has an audio track
 *
 * HONESTY RULE: only an explicit "safe" from a check that ran passes. A check that did not run, threw,
 * timed out, returned nothing for a frame, or is unsure is a FAIL. One flagged frame refuses the whole
 * item. Every refusal is logged with its reasons and timestamps.
 *
 * A passing item gets a clearance sidecar (<file>.safety.json) bound to the file's size, SHA-256 and the
 * rule version. Schedulers (filmRotation, autoair, airCheck) accept a file only with a valid clearance;
 * an edited file, or a new rule version, needs a fresh check.
 *
 * The checkers are injected (tests never run a model). The real ones are in mediaCheckers.js.
 */
import fs from "node:fs";
import crypto from "node:crypto";

export const RULE_TEXT = "NO SEXUAL, VIOLENCE and ABUSE, physical or otherwise, ANIMAL HARM and videos and audio in other such category will ever be allowed.";
/** Bump when the rule or a threshold changes: every clearance made under an older version stops counting. */
export const RULE_VERSION = "2026-10-23.1";

export const CATEGORIES = Object.freeze([
  "sexual",        // nudity, sexual acts or sexualised content
  "violence",      // fighting, shooting, explosions hitting people, killing, weapons used on people
  "abuse",         // physical, sexual, emotional or verbal abuse, humiliation, torture, cruelty to anyone
  "animal_harm",   // an animal hurt, killed, abused, or in distress from cruelty
  "gore",          // blood, wounds, bodies, the aftermath of injuries
  "other_same_category", // anything else of the same kind the model recognises
]);

/** Thresholds DrJ sees on the needs-drj PR. */
export const THRESHOLDS = Object.freeze({
  sampleEverySec: 1,          // at least one frame per second ...
  sceneThreshold: 0.3,        // ... plus every scene change ffmpeg scores above this (0..1)
  maxGapSec: 1.05,            // the measured gap between sampled frames may not exceed this (1 s + a frame)
  checkTimeoutMs: 10 * 60_000, // one check (all frames, or the transcript) taking longer than this is a FAIL
  soundEventsRequired: true,  // a file with sound and no sound-event check is refused
});

export class MediaRefused extends Error {
  constructor(report) {
    super(`content-safety: ${report.id || report.file} refused: ${report.reasons.map((r) => r.reason).join("; ")}`);
    this.name = "MediaRefused";
    this.report = report;
  }
}

/**
 * Normalise one checker verdict. Only verdict === "safe" with no categories passes.
 * Anything else (unsafe, unsure, missing, malformed, a category named on a "safe") is a fail.
 */
export function judge(v) {
  if (!v || typeof v !== "object") return { pass: false, why: "no verdict (unmeasured)" };
  const cats = Array.isArray(v.categories) ? v.categories.filter(Boolean).map(String) : [];
  if (v.verdict === "safe" && cats.length === 0) return { pass: true };
  if (v.verdict === "unsafe") return { pass: false, why: `flagged${cats.length ? ` (${cats.join(", ")})` : ""}`, categories: cats };
  if (v.verdict === "safe") return { pass: false, why: `"safe" but named ${cats.join(", ")}`, categories: cats };
  if (v.verdict === "unsure") return { pass: false, why: "checker unsure", categories: cats };
  return { pass: false, why: `unrecognised verdict ${JSON.stringify(v.verdict)} (unmeasured)` };
}

/**
 * Did the sampled frames actually cover the picture at the rule's density? Measured, not assumed:
 * the first frame by maxGap, no gap between frames over maxGap, the last frame within maxGap of the end.
 */
export function samplingCoverage(times, durationSec, { maxGapSec = THRESHOLDS.maxGapSec } = {}) {
  const t = [...times].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const problems = [];
  if (!Number.isFinite(durationSec) || durationSec <= 0) problems.push("duration unmeasured");
  if (!t.length) problems.push("no frames sampled");
  let worstGap = 0;
  if (t.length && Number.isFinite(durationSec) && durationSec > 0) {
    const gaps = [t[0], ...t.slice(1).map((x, i) => x - t[i]), durationSec - t[t.length - 1]];
    worstGap = Math.max(...gaps);
    if (worstGap > maxGapSec) {
      const at = gaps.indexOf(worstGap);
      const from = at === 0 ? 0 : t[at - 1];
      problems.push(`frames ${worstGap.toFixed(2)} s apart from ${from.toFixed(2)} s (max ${maxGapSec} s)`);
    }
  }
  return { ok: problems.length === 0, frames: t.length, worstGapSec: +worstGap.toFixed(3), problems };
}

/** Run one check with the timeout; a throw or a timeout comes back as { error } - never as a pass. */
async function timed(name, fn, timeoutMs) {
  let timer;
  try {
    const out = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${name} timed out after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs); }),
    ]);
    return { out };
  } catch (e) {
    return { error: e?.message || String(e) };
  } finally { clearTimeout(timer); }
}

/**
 * Check one pre-recorded item. Never throws for a bad item: returns { ok, report }.
 *
 * @param {{ id?: string, file: string, kind?: string }} item
 * @param {object} c checkers:
 *   probe(file)                -> { durationSec, hasVideo, hasAudio }
 *   sampleFrames(file, opts)   -> [{ t, path }]   (>= 1/s and every scene change)
 *   vision(frames)             -> [{ t, verdict, categories?, note? }]   one per frame
 *   transcribe(file)           -> { text, segments?: [{ start, end, text }] }
 *   checkTranscript(tr)        -> { verdict, categories?, at?, note? }
 *   soundEvents(file)          -> { verdict, categories?, events?: [{ t, label }] }
 *   now()                      -> ms (for the report)
 */
export async function checkMediaSafety(item, c = {}, { thresholds = THRESHOLDS } = {}) {
  const started = (c.now || Date.now)();
  const report = { id: item.id || null, file: item.file, kind: item.kind || null, ruleVersion: RULE_VERSION, startedAt: started, checks: {}, reasons: [] };
  const refuse = (check, reason, at = null, extra = {}) => report.reasons.push({ check, reason, at, ...extra });
  const T = thresholds.checkTimeoutMs;

  if (!item.file || !fs.existsSync(item.file)) {
    refuse("file", "file missing");
    return finish();
  }
  if (typeof c.probe !== "function") { refuse("probe", "no probe configured (unmeasured)"); return finish(); }
  const p = await timed("probe", () => c.probe(item.file), T);
  if (p.error) { refuse("probe", `probe failed: ${p.error}`); return finish(); }
  const probe = p.out || {};
  report.checks.probe = probe;
  if (!Number.isFinite(probe.durationSec) || probe.durationSec <= 0) refuse("probe", "duration unmeasured");
  if (!probe.hasVideo && !probe.hasAudio) refuse("probe", "no video or audio stream found");

  // ── pictures ──
  if (probe.hasVideo) {
    if (typeof c.sampleFrames !== "function" || typeof c.vision !== "function") refuse("pictures", "no frame sampler or vision check configured (unmeasured)");
    else {
      const s = await timed("frame sampling", () => c.sampleFrames(item.file, { everySec: thresholds.sampleEverySec, sceneThreshold: thresholds.sceneThreshold }), T);
      if (s.error) refuse("pictures", `frame sampling failed: ${s.error}`);
      else {
        const frames = Array.isArray(s.out) ? s.out : [];
        const cov = samplingCoverage(frames.map((f) => f.t), probe.durationSec, { maxGapSec: thresholds.maxGapSec });
        report.checks.sampling = cov;
        if (!cov.ok) for (const pr of cov.problems) refuse("pictures", `sampling incomplete: ${pr}`);
        if (frames.length) {
          const vr = await timed("vision check", () => c.vision(frames), T);
          if (vr.error) refuse("pictures", `vision check failed: ${vr.error}`);
          else {
            const verdicts = Array.isArray(vr.out) ? vr.out : [];
            const byT = new Map(verdicts.map((x) => [Number(x?.t).toFixed(3), x]));
            let flagged = 0, unmeasured = 0;
            for (const f of frames) {
              const j = judge(byT.get(Number(f.t).toFixed(3)));
              if (j.pass) continue;
              if (/unmeasured/.test(j.why)) unmeasured++; else flagged++;
              refuse("pictures", `frame at ${Number(f.t).toFixed(2)} s: ${j.why}`, Number(f.t), j.categories ? { categories: j.categories } : {});
            }
            report.checks.vision = { frames: frames.length, verdicts: verdicts.length, flagged, unmeasured };
          }
        }
      }
    }
  } else report.checks.pictures = "no video stream (measured by probe)";

  // ── sound ──
  if (probe.hasAudio) {
    if (typeof c.transcribe !== "function" || typeof c.checkTranscript !== "function") refuse("sound", "no transcriber or transcript check configured (unmeasured)");
    else {
      const tr = await timed("transcription", () => c.transcribe(item.file), T);
      if (tr.error) refuse("sound", `transcription failed: ${tr.error}`);
      else if (!tr.out || typeof tr.out.text !== "string") refuse("sound", "transcription returned no text field (unmeasured)");
      else {
        report.checks.transcript = { chars: tr.out.text.length, segments: tr.out.segments?.length ?? null };
        const ct = await timed("transcript check", () => c.checkTranscript(tr.out), T);
        if (ct.error) refuse("sound", `transcript check failed: ${ct.error}`);
        else {
          const j = judge(ct.out);
          report.checks.transcriptVerdict = ct.out;
          if (!j.pass) refuse("sound", `transcript: ${j.why}${ct.out?.note ? ` - ${ct.out.note}` : ""}`, Number.isFinite(ct.out?.at) ? ct.out.at : null, j.categories ? { categories: j.categories } : {});
        }
      }
    }
    if (typeof c.soundEvents !== "function") {
      if (thresholds.soundEventsRequired) refuse("sound", "no sound-event check (screams, gunshots) configured (unmeasured)");
    } else {
      const se = await timed("sound-event check", () => c.soundEvents(item.file), T);
      if (se.error) refuse("sound", `sound-event check failed: ${se.error}`);
      else {
        const j = judge(se.out);
        report.checks.soundEvents = se.out;
        if (!j.pass) {
          const evs = Array.isArray(se.out?.events) ? se.out.events : [];
          if (evs.length) for (const e of evs) refuse("sound", `sound at ${Number(e.t).toFixed(2)} s: ${e.label}`, Number(e.t));
          else refuse("sound", `sound events: ${j.why}`);
        }
      }
    }
  } else if (probe.hasVideo) report.checks.sound = "no audio stream (measured by probe)";

  return finish();

  function finish() {
    report.finishedAt = (c.now || Date.now)();
    report.ok = report.reasons.length === 0;
    return { ok: report.ok, report };
  }
}

/** The gate. Resolves with the report when the item is safe; throws MediaRefused otherwise. Logs either way. */
export async function assertMediaSafe(item, checkers = {}, { log = null, thresholds = THRESHOLDS, writeClearanceFile = true } = {}) {
  const { ok, report } = await checkMediaSafety(item, checkers, { thresholds });
  if (log) log({ type: ok ? "media-cleared" : "media-refused", at: report.finishedAt, id: report.id, file: report.file, kind: report.kind, ruleVersion: RULE_VERSION, reasons: report.reasons });
  if (!ok) {
    if (item.file && fs.existsSync(item.file)) { try { fs.rmSync(clearancePath(item.file), { force: true }); } catch { /* none */ } }
    throw new MediaRefused(report);
  }
  if (writeClearanceFile) writeClearance(item.file, report);
  return report;
}

// ── clearance sidecar ──

export const clearancePath = (file) => `${file}.safety.json`;

export function fileFingerprint(file) {
  const st = fs.statSync(file);
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    for (;;) { const n = fs.readSync(fd, buf, 0, buf.length, null); if (!n) break; h.update(buf.subarray(0, n)); }
  } finally { fs.closeSync(fd); }
  return { size: st.size, sha256: h.digest("hex") };
}

export function writeClearance(file, report) {
  const rec = { ok: true, ruleVersion: RULE_VERSION, clearedAt: report.finishedAt, ...fileFingerprint(file),
    sampling: report.checks.sampling || null, vision: report.checks.vision || null, transcript: report.checks.transcript || null };
  fs.writeFileSync(clearancePath(file), JSON.stringify(rec, null, 1) + "\n");
  return rec;
}

/**
 * Does `file` hold a clearance that still counts? { ok, why }. A missing, unreadable, old-version,
 * or mismatched (edited file) clearance does not. `hash: false` checks size only (cheap pre-filter);
 * the scheduling gates always hash.
 */
export function hasValidClearance(file, { hash = true } = {}) {
  if (!file || !fs.existsSync(file)) return { ok: false, why: "file missing" };
  const cp = clearancePath(file);
  if (!fs.existsSync(cp)) return { ok: false, why: "no content-safety clearance" };
  let rec;
  try { rec = JSON.parse(fs.readFileSync(cp, "utf8")); } catch (e) { return { ok: false, why: `clearance unreadable: ${e.message}` }; }
  if (rec.ok !== true) return { ok: false, why: "clearance is not a pass" };
  if (rec.ruleVersion !== RULE_VERSION) return { ok: false, why: `clearance made under rule ${rec.ruleVersion}, current is ${RULE_VERSION}` };
  const st = fs.statSync(file);
  if (st.size !== rec.size) return { ok: false, why: "file changed since it was cleared (size)" };
  if (hash && fileFingerprint(file).sha256 !== rec.sha256) return { ok: false, why: "file changed since it was cleared (hash)" };
  return { ok: true, why: null, clearedAt: rec.clearedAt };
}

/** Append-only JSONL log for refusals, clearances and live cuts. */
export function jsonlLog(file) {
  return (rec) => {
    const line = JSON.stringify({ loggedAt: new Date().toISOString(), ...rec });
    fs.appendFileSync(file, line + "\n");
    return rec;
  };
}
