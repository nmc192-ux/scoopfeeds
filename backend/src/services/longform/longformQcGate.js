/**
 * longformQcGate.js — QC as a VERDICT, not a report (#79).
 *
 * `engine/qc.mjs` prints a gate table for a human to read and decide on. DrJ
 * chose fully machine-gated operation, so that has to become an accept/reject
 * that discards a failing film and abandons the cycle, with no path by which a
 * film that fails a gate reaches an upload.
 *
 * THIS FILE IS THE HIGHEST-CONSEQUENCE CODE IN THE PROGRAMME. With no human
 * ack before the publishAt slot, the disclosure chain below is the only thing
 * standing between an incorrect AI-provenance statement and the channel's
 * subscribers — and unlike the website, a published film cannot be quietly
 * corrected: the notification has already gone out.
 *
 * Two rules govern everything here, both from docs/agentic-workflow.md §5:
 *
 *   UNMEASURED IS A FAILURE, NEVER A PASS. A gate that could not be measured
 *   returns `measured: false` and fails. The tempting bug is to treat a
 *   missing measurement as "nothing found wrong".
 *
 *   REJECT, DON'T REPAIR. Nothing here fixes a film. It says no, names the
 *   gate, the measured value and the threshold, and the cycle abandons.
 *
 * Thresholds are INHERITED from references/quality-gates.md. This file
 * enforces them; it does not retune them.
 */

import { existsSync, readFileSync } from "fs";
import path from "path";

/**
 * The exact stamp genscene.mjs writes into LICENSES.md when an AI-generated
 * scene enters a project.
 *
 * KEYED ON THE EXACT PHRASE, NOT /AI-generated/i. Provenance notes legitimately
 * contain those words while EXCLUDING AI content — the Ebola project's does —
 * so a looser match would refuse correct films. That precision is load-bearing
 * in both directions and must not be "simplified".
 */
export const AIGC_STAMP = "**AI-generated content present in this project.**";

/** Phrasings that positively assert the film contains no AI imagery. */
const NO_AI_CLAIM = /no ai[- ]generated (imagery|content|footage|scenes)/i;

/**
 * THE DISCLOSURE CHAIN — checked in BOTH directions, before any upload.
 *
 * The shipped publish-time gate refuses when generated scenes are present but
 * a disclosure is missing. That is half the problem. The converse is also a
 * false public statement: declaring synthetic content on a film that contains
 * none tells YouTube and the audience something untrue about the work, and
 * "erring toward disclosure" is not a defence for an inaccurate one.
 *
 * Surfaces checked: LICENSES.md (the ground truth), publish.json
 * syntheticContent, the YouTube description, and tiktok.json isAigc.
 *
 * @returns {string[]} failures, empty when the chain is consistent
 */
export function disclosureFailures({
  licensesText = null, publishJson = {}, tiktokJson = null,
} = {}) {
  const fails = [];

  // Ground truth must exist. A film with no provenance file is not one whose
  // disclosures we can verify — and unverifiable is a failure, not a pass.
  if (licensesText === null) {
    return ["disclosure: LICENSES.md is missing — provenance cannot be verified, so no disclosure can be trusted"];
  }

  const hasAigc = licensesText.includes(AIGC_STAMP);
  const desc = String(publishJson?.youtube?.description || "");
  const declared = publishJson?.syntheticContent;
  const hasDeclaration = Boolean(declared) && String(declared).trim().length > 0;

  if (hasAigc) {
    // Generated scenes ARE present.
    if (NO_AI_CLAIM.test(desc)) {
      fails.push('disclosure: LICENSES.md declares AI-generated content, but the YouTube description claims there is none — a false public statement');
    }
    if (!hasDeclaration) {
      fails.push("disclosure: AI-generated scenes present but publish.json syntheticContent is unset — YouTube's 'Altered content' disclosure would be skipped");
    }
    if (tiktokJson && tiktokJson.isAigc !== true) {
      fails.push("disclosure: AI-generated scenes present but tiktok.json isAigc is not true");
    }
  } else {
    // NO generated scenes. The converse errors — asserting synthetic content
    // that does not exist is equally untrue, and is the half the shipped gate
    // never checked.
    if (hasDeclaration) {
      fails.push(`disclosure: publish.json declares syntheticContent ("${String(declared).slice(0, 60)}") but LICENSES.md records no AI-generated content — declaring synthetic media that is not present is also a false statement`);
    }
    if (tiktokJson && tiktokJson.isAigc === true) {
      fails.push("disclosure: tiktok.json isAigc is true but LICENSES.md records no AI-generated content");
    }
  }
  return fails;
}

// ── Measured gates ──────────────────────────────────────────────────────────

/** Thresholds, inherited from references/quality-gates.md. */
export const GATES = Object.freeze({
  loudnessTarget: -14, loudnessTolerance: 1.5,
  minSideChannelDb: -60,          // a mono bed measures about -91
  maxMedianShotSecs: 6,
  minShortsUnder2s: 0.08,
  minFilmSecs: 7 * 60, maxFilmSecs: 10 * 60,
  minShorts: 3, maxShortSecs: 59,
  shortWidth: 1080, shortHeight: 1920,
});

/**
 * Build the verdict from measurements.
 *
 * Every measurement is `{ measured: boolean, value }`. A measurement with
 * `measured: false` FAILS its gate — see the header. This shape is what makes
 * that rule enforceable rather than aspirational: there is no way to express
 * "we didn't check" that reads as a pass.
 */
export function qcVerdict({
  loudness, sideChannel, flatFactor, medianShot, shortsUnder2s,
  filmSeconds, shorts = [], srt, disclosure = [],
} = {}) {
  const failures = [];
  const checked = [];

  const check = (name, m, predicate, target) => {
    checked.push(name);
    if (!m || m.measured !== true) {
      failures.push({ gate: name, measured: "UNVERIFIED", target,
                      why: m?.why || "could not be measured — unmeasured is a failure, never a pass" });
      return;
    }
    if (!predicate(m.value)) {
      failures.push({ gate: name, measured: String(m.value), target });
    }
  };

  check("integrated loudness", loudness,
    (v) => Math.abs(v - GATES.loudnessTarget) <= GATES.loudnessTolerance,
    `${GATES.loudnessTarget} ±${GATES.loudnessTolerance} LUFS`);

  check("clipping (flat factor)", flatFactor, (v) => v === 0, "0");

  check("stereo side channel", sideChannel,
    (v) => v > GATES.minSideChannelDb, `> ${GATES.minSideChannelDb} dB (mono reads ~-91)`);

  check("median shot length", medianShot,
    (v) => v <= GATES.maxMedianShotSecs, `<= ${GATES.maxMedianShotSecs}s`);

  check("shots under 2s", shortsUnder2s,
    (v) => v >= GATES.minShortsUnder2s, `>= ${(GATES.minShortsUnder2s * 100).toFixed(0)}%`);

  check("film duration", filmSeconds,
    (v) => v >= GATES.minFilmSecs && v <= GATES.maxFilmSecs,
    `${GATES.minFilmSecs / 60}-${GATES.maxFilmSecs / 60} min`);

  // The SRT is the timeline; a film without one breaks Shorts cutting,
  // chapter markers and the caption upload downstream.
  check("SRT present and covering the film", srt,
    (v) => v.cues > 0 && v.lastCueSecs > 0,
    "cues > 0, covering the film");

  // Shorts: count, and each within the platform ceiling and shape. The
  // duration ceiling is an edge this format actually reaches, not a margin —
  // a Short one second over is rejected by Meta at publish time, after the
  // container exists.
  checked.push("shorts");
  if (!Array.isArray(shorts) || !shorts.length) {
    failures.push({ gate: "shorts", measured: "UNVERIFIED", target: `>= ${GATES.minShorts}`,
                    why: "no shorts measured — unmeasured is a failure" });
  } else {
    if (shorts.length < GATES.minShorts) {
      failures.push({ gate: "shorts count", measured: String(shorts.length), target: `>= ${GATES.minShorts}` });
    }
    for (const s of shorts) {
      if (s.measured !== true) {
        failures.push({ gate: `short ${s.name}`, measured: "UNVERIFIED", target: "measurable",
                        why: s.why || "could not be measured" });
        continue;
      }
      if (s.seconds > GATES.maxShortSecs) {
        failures.push({ gate: `short ${s.name} duration`, measured: `${s.seconds}s`,
                        target: `<= ${GATES.maxShortSecs}s` });
      }
      if (s.width !== GATES.shortWidth || s.height !== GATES.shortHeight) {
        failures.push({ gate: `short ${s.name} shape`, measured: `${s.width}x${s.height}`,
                        target: `${GATES.shortWidth}x${GATES.shortHeight}` });
      }
    }
  }

  for (const d of disclosure) {
    failures.push({ gate: "disclosure", measured: "INCONSISTENT", target: "consistent", why: d });
  }

  return { pass: failures.length === 0, failures, checked };
}

/**
 * Read a project's disclosure surfaces from disk and verify them.
 * Thin wrapper so callers do not each re-derive the file layout.
 */
export function readDisclosure({ P }) {
  const lic = P("out/footage/LICENSES.md");
  const pub = P("publish.json");
  const tt = P("tiktok.json");
  const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : null);
  const json = (f) => { const t = read(f); try { return t ? JSON.parse(t) : null; } catch { return null; } };
  return disclosureFailures({
    licensesText: read(lic),
    publishJson: json(pub) || {},
    tiktokJson: json(tt),
  });
}

/** One structured decision-log line per verdict — the calibration corpus. */
export function formatVerdict(slug, verdict) {
  if (verdict.pass) {
    return `🧭 qc-pass ${slug} — ${verdict.checked.length} gates measured, all within threshold`;
  }
  const lines = verdict.failures.map(
    (f) => `    ${f.gate}: ${f.measured} (target ${f.target})${f.why ? ` — ${f.why}` : ""}`);
  return `🧭 qc-reject ${slug} — ${verdict.failures.length} of ${verdict.checked.length} gates failed\n${lines.join("\n")}`;
}

/**
 * Which rejected films to keep for diagnosis.
 *
 * Rejected artifacts are retained rather than deleted — a film that failed is
 * the only evidence of why — but BOUNDED, because the persistent volume is
 * finite and a run of failures would otherwise fill it silently.
 */
export const RETAIN_REJECTED = () =>
  Math.max(0, Number.parseInt(process.env.LONGFORM_RETAIN_REJECTED || "", 10) || 3);

export function rejectionsToPrune(entries, { keep = RETAIN_REJECTED() } = {}) {
  return [...(entries || [])]
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(keep)
    .map((e) => e.dir);
}

/**
 * THE ONE-WAY DOOR. Publishing is reachable only through this function.
 *
 * The safety property the whole issue exists for: a film that failed a gate
 * must produce ZERO calls to any publishing surface. Expressing that as a
 * guard function — rather than as an `if` inside the cycle — means the
 * property is testable on its own and cannot be lost to a later refactor of
 * the cycle's control flow.
 *
 * It also refuses a verdict it does not understand. A caller that forgets to
 * run QC and passes `undefined` gets a refusal, not a publish: the failure
 * mode of a missing check must never be "proceed".
 *
 * @param {object} verdict   from qcVerdict()
 * @param {() => Promise<any>} publish  the publishing action
 * @param {(line:string) => void} [log]
 * @returns {Promise<{published:boolean, verdict:object}>}
 */
export async function publishIfPassed({ slug = "untitled", verdict, publish, log = () => {} } = {}) {
  if (!verdict || typeof verdict.pass !== "boolean") {
    log(`🧭 qc-refuse ${slug} — no usable QC verdict; refusing to publish`);
    return { published: false, verdict: verdict ?? null };
  }
  if (!verdict.pass) {
    log(formatVerdict(slug, verdict));
    return { published: false, verdict };
  }
  log(formatVerdict(slug, verdict));
  // THE PUBLISHER'S RETURN VALUE IS CARRIED BACK, not discarded. Everything
  // goes up PRIVATE with a publishAt, so the video id is the ONLY handle on it
  // until the slot — a private upload does not appear in the channel's public
  // listing, so an id lost here can only be recovered by re-querying the API.
  const result = await publish();
  return { published: true, verdict, result: result ?? null };
}
