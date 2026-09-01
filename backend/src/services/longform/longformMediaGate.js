/**
 * longformMediaGate.js — what may enter a film, and the provenance record (#78).
 *
 * Closes the loop the disclosure work opened. `longformPublishPlan.js` derives
 * the AI-provenance disclosure from `LICENSES.md`; this file is what WRITES
 * that file, so the chain runs:
 *
 *     acquisition gate → LICENSES.md → derived disclosure → QC gate
 *
 * Every rule below is from `references/sourcing.md`, and each exists because
 * ignoring it costs something specific — a strike, a takedown, or a film that
 * looks cheap next to its own footage.
 *
 *   AI STOCK IS SCREENED OUT. Pexels serves AI clips from
 *   `content.pexels.com/aigc-bundle/…`. Only contributor-shot
 *   `videos.pexels.com/video-files/…` is real footage. Letting one through
 *   does not merely look wrong: it silently makes the film's "no AI-generated
 *   imagery" disclosure FALSE, which is the one class of error this pipeline
 *   refuses to publish rather than paper over.
 *
 *   UPSCALES ARE REJECTED. A clip that only exists below 1080 shows next to
 *   native material.
 *
 *   NO SYNTHETIC HUMANS. Generated environments are permitted; a
 *   photorealistic fake person in a journalism piece is a materially
 *   different claim. Every person on screen is real footage or appears inside
 *   a cited source screenshot.
 *
 *   RIGHTS-MANAGED IS STRUCTURALLY ABSENT. Getty/AP-style licences cannot be
 *   accepted at all — that is the asset class channels get struck over.
 */

import { AIGC_STAMP } from "./longformQcGate.js";

/** Licences a film may use. Anything else is refused, not warned about. */
export const ALLOWED_LICENCES = Object.freeze([
  "pexels",          // free commercial use, no attribution required
  "public-domain",   // US federal works (DVIDS, NASA, USGS)
  "cc-by", "cc-by-sa",
  "handout",         // agency-issued press material
]);

export const MIN_WIDTH = 1920;
export const MIN_HEIGHT = 1080;

/** Pexels' AI-generated bundle. Contributor-shot clips never live here. */
const AIGC_HOST = /content\.pexels\.com\/aigc-bundle\//i;
const PEXELS_REAL = /videos\.pexels\.com\/video-files\/|images\.pexels\.com\/photos\//i;

/**
 * Is the LICENCE half of the gate on? `LONGFORM_LICENCE_GATE=off` turns it off.
 *
 * WHY A SWITCH AND NOT A DELETION. Without one, "don't worry about licensing
 * for now" has no expression in the pipeline: the gate refuses every candidate
 * whose licence is not a known token, and footage silently never lands. A
 * research cut that cannot show real material is not a research cut. So the
 * refusal becomes a recorded note instead of a rejection — and it is one env
 * var to put back, rather than a diff to reconstruct.
 *
 * WHAT IT DOES NOT TOUCH, EVER. Only the licence-token rules relax. The
 * AI-stock host check and the synthetic-humans check are NOT part of this and
 * cannot be turned off by any flag, because they are not about rights: they are
 * what keeps the film's own AI-provenance disclosure true. A bypass that let an
 * `aigc-bundle` clip through would make the published statement "no
 * AI-generated imagery" false, which is the one class of error this pipeline
 * refuses to paper over. Resolution stays on for the same reason it always was
 * — an upscale is a quality fact, not a rights one.
 *
 * Read at CALL time, not at import, so a run can flip it per invocation.
 *
 * NOTHING IN THIS MODULE CALLS THIS FUNCTION. That is deliberate and it is the
 * safety property: no library function here weakens because of an ambient
 * environment variable. `screenCandidate` defaults to STRICT, and a caller that
 * wants the relaxed behaviour has to consult this and pass the result. So the
 * hand-authored project script opts in explicitly, and the autopost loop — which
 * publishes with no human ack — keeps the full gate no matter what is set in the
 * environment it happens to share with a research build on the same box.
 */
export function licenceGateEnabled() {
  return String(process.env.LONGFORM_LICENCE_GATE || "").toLowerCase() !== "off";
}

/** The licence problems that a disabled gate downgrades to notes. */
export function licenceNotes(c = {}) {
  return screenCandidate(c, { licenceGate: true })
    .filter((e) => LICENCE_RULE.test(e));
}

/** Marks the errors `licenceGateEnabled() === false` is allowed to suppress. */
const LICENCE_RULE = /^(licence |no licence)/;

/**
 * Screen one candidate. Returns [] when usable, or the reasons it is not.
 *
 * REJECT, DON'T DOWNGRADE. There is deliberately no "accept with a warning"
 * path: a warning in a log nobody reads is how an AI clip ends up under a
 * disclosure that says there is none. The licence switch above is the single
 * exception, it is explicit, and what it suppresses is recorded on the asset.
 */
export function screenCandidate(c = {}, { licenceGate = true } = {}) {
  const errs = [];
  const url = String(c.url || "");

  if (!c.key) errs.push("no key — every clip needs a stable name for the storyboard and LICENSES.md");
  if (!url) errs.push("no url — provenance must be answerable without re-deriving it");

  if (AIGC_HOST.test(url)) {
    errs.push("AI-generated stock (content.pexels.com/aigc-bundle) — this would silently falsify the film's disclosure");
  }
  // A Pexels-licensed clip that is not from the real-footage host is not
  // something to assume about: say so rather than guess.
  if (c.licence === "pexels" && url && !PEXELS_REAL.test(url) && !AIGC_HOST.test(url)) {
    errs.push(`licence "pexels" but the url is not a Pexels media host (videos.pexels.com/video-files or images.pexels.com/photos) — provenance unclear`);
  }

  if (!c.licence) errs.push("no licence — an asset without one cannot be registered");
  else if (!ALLOWED_LICENCES.includes(c.licence)) {
    errs.push(`licence "${c.licence}" is not usable (allowed: ${ALLOWED_LICENCES.join(", ")})`);
  }
  if ((c.licence === "cc-by" || c.licence === "cc-by-sa") && !c.attribution) {
    errs.push(`licence "${c.licence}" requires attribution and none was recorded`);
  }

  // Resolution: unknown is a REFUSAL, not a pass. An unmeasured clip is
  // exactly the one that turns out to be an upscale.
  if (!Number.isFinite(c.width) || !Number.isFinite(c.height)) {
    errs.push("resolution not measured — unmeasured is not a pass");
  } else if (c.width < MIN_WIDTH || c.height < MIN_HEIGHT) {
    errs.push(`${c.width}×${c.height} is below ${MIN_WIDTH}×${MIN_HEIGHT} — upscales show next to native material`);
  }

  if (c.synthetic && c.containsPeople) {
    errs.push("synthetic imagery containing people — generated environments are permitted, synthetic humans are not");
  }
  // The filter is applied LAST, over the complete set, so that adding a rule
  // above cannot accidentally fall inside the bypass: a new error only becomes
  // suppressible if its text matches LICENCE_RULE, which is a deliberate act.
  return licenceGate ? errs : errs.filter((e) => !LICENCE_RULE.test(e));
}

/**
 * Screen a whole acquisition set.
 *
 * Also refuses DUPLICATE KEYS: two clips sharing a key means one silently
 * replaces the other in the storyboard, and the LICENSES.md row would describe
 * whichever lost.
 */
export function screenAcquisition(candidates = []) {
  const problems = [];
  const seen = new Set();
  const accepted = [];
  for (const [i, c] of candidates.entries()) {
    const errs = screenCandidate(c);
    if (c.key && seen.has(c.key)) errs.push(`duplicate key "${c.key}" — one clip would silently replace the other`);
    if (c.key) seen.add(c.key);
    if (errs.length) problems.push(...errs.map((e) => `[${i}] ${c.key || "(no key)"}: ${e}`));
    else accepted.push(c);
  }
  return { accepted, problems, ok: problems.length === 0 };
}

/**
 * Write the provenance record.
 *
 * THE AIGC STAMP IS EMITTED FROM THE ASSETS THEMSELVES. It is not a flag
 * someone remembers to set — if any accepted asset is marked synthetic, the
 * exact phrase the disclosure chain keys on appears, and if none is, it does
 * not. That is what makes `deriveDisclosure` trustworthy, and it is the
 * mechanism whose absence let a shipped film declare AI content it did not
 * contain.
 *
 * The phrase must be EXACT — the gate matches it literally, deliberately, so
 * that provenance notes mentioning "AI-generated" while excluding AI content
 * do not read as declarations.
 */
export function renderLicenses({ title, assets = [], acquiredOn = null } = {}) {
  const real = assets.filter((a) => !a.synthetic);
  const synthetic = assets.filter((a) => a.synthetic);
  const when = acquiredOn ? new Date(acquiredOn).toISOString().slice(0, 10) : "unknown date";

  const lines = [`# Asset provenance — ${title || "untitled"}`, ""];

  lines.push("## Real video and stills", "");
  lines.push(`Acquired ${when}. Contributor-shot only — AI-generated`,
             "`content.pexels.com/aigc-bundle/…` results are filtered out by the acquisition gate.", "");
  if (real.length) {
    lines.push("| Key | Licence | Source | Resolution | Attribution |", "|---|---|---|---|---|");
    for (const a of real) {
      lines.push(`| \`${a.key}\` | ${a.licence} | ${a.url} | ${a.width}×${a.height} | ${a.attribution || "—"} |`);
    }
  } else {
    lines.push("_None._");
  }
  lines.push("");

  // A BYPASSED LICENCE IS STATED, NOT OMITTED. If the gate was off when these
  // were acquired, the provenance record is the one place that fact survives to
  // whoever reads it later — the env var is long gone by then. Listing them
  // here is also what makes the bypass reversible in practice: this is the
  // worklist of what to re-clear before the film goes anywhere public.
  const unverified = assets.filter((a) => a.licenceUnverified);
  if (unverified.length) {
    lines.push("## Licence NOT verified", "");
    lines.push(`**${unverified.length} asset(s) entered with \`LONGFORM_LICENCE_GATE=off\`.** `
      + "Their licences were not checked against the allowed set. This film is not "
      + "cleared for publication until each row below is resolved or replaced.", "");
    lines.push("| Key | Claimed licence | Source | Why it would have been refused |", "|---|---|---|---|");
    for (const a of unverified) {
      lines.push(`| \`${a.key}\` | ${a.licence || "—"} | ${a.url} | ${(a.licenceNotes || []).join("; ") || "—"} |`);
    }
    lines.push("");
  }

  lines.push("## AI-generated imagery", "");
  if (synthetic.length) {
    // THE EXACT PHRASE the disclosure chain keys on.
    lines.push(AIGC_STAMP, "");
    lines.push("Stylized metaphor scenes only. No synthetic humans; every person on screen",
               "is real footage or appears inside a cited source screenshot.", "");
    lines.push("| Key | Register | Prompt summary |", "|---|---|---|");
    for (const a of synthetic) {
      lines.push(`| \`${a.key}\` | ${a.register || "unspecified"} | ${a.note || "—"} |`);
    }
  } else {
    lines.push("**None.** No generated imagery is used in this film.");
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Acquire: screen, then produce the assets and the provenance record.
 * Refuses the whole set rather than acquiring a partial one — a film built
 * from a partially-screened set is a film whose disclosure cannot be trusted.
 */
export function planAcquisition({ title, candidates = [], acquiredOn = null } = {}) {
  const { accepted, problems, ok } = screenAcquisition(candidates);
  if (!ok) {
    return { ok: false, problems, licenses: null, assets: [] };
  }
  return {
    ok: true,
    problems: [],
    assets: accepted,
    licenses: renderLicenses({ title, assets: accepted, acquiredOn }),
  };
}
