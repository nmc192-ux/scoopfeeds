/**
 * produceLongformFilm.js — the chain, and an honest map of what is missing (#78/#80).
 *
 * `runLongformCycle` takes `produce` as an injected dependency. Until now
 * nothing implemented it: every long-form module referenced only itself, so
 * the "end to end path" was a set of parts, not a path. This is the part that
 * makes it one.
 *
 * THE STAGES ARE EXPLICIT AND EACH ONE CAN REFUSE:
 *
 *   script     → longformScriptWriter   (spine first, then beats, grounded)
 *   storyboard → longformStoryboardWriter (JSON; no generated code runs)
 *   media      → acquireMedia           ← NOT IMPLEMENTED, see below
 *   render     → engine build/music/shorts (injected: needs a filesystem)
 *   thumbnail  → makeThumbnail          ← NOT IMPLEMENTED, see below
 *   measure    → longformMeasure        (real ffmpeg)
 *   plan       → longformPublishPlan    (disclosure derived from provenance)
 *   gate       → longformQcGate         (the verdict; publishing is a one-way door)
 *
 * WHAT IS DELIBERATELY NOT IMPLEMENTED, AND WHY IT THROWS RATHER THAN STUBS:
 *
 *   acquireMedia — `engine/footage-search.mjs` FINDS candidates and classifies
 *   their provenance; nothing DOWNLOADS them. `longformMediaGate` screens what
 *   is offered and writes LICENSES.md, but a screen with nothing to screen is
 *   not acquisition. A stub returning "no media" would produce a film of cards
 *   over silence and a LICENSES.md asserting an empty provenance — which the
 *   disclosure chain would then faithfully derive a disclosure FROM. That is
 *   worse than failing.
 *
 *   makeThumbnail — a film with no thumbnail gets YouTube's auto-frame, which
 *   for a card-based film is usually a slab of text. Not fatal, but it is a
 *   quality gate the channel already has a documented standard for
 *   (references/house-style.md §Thumbnail), and silently skipping it would
 *   ship films that fail that standard invisibly.
 *
 * Both are injectable, so a caller that HAS them can supply them and the chain
 * runs. Neither is faked.
 */

import { logger } from "../logger.js";
import { writeLongformScript } from "./longformScriptWriter.js";
import { writeStoryboard } from "../longformStoryboardWriter.js";
import { planAcquisition } from "./longformMediaGate.js";
import { buildPublishPlan, buildTikTokPlan } from "./longformPublishPlan.js";
import { measureFilm } from "./longformMeasure.js";
import { qcVerdict } from "./longformQcGate.js";

/** Thrown when a stage the chain needs has no implementation. */
export class NotImplementedError extends Error {
  constructor(stage, why) {
    super(`longform stage "${stage}" is not implemented: ${why}`);
    this.name = "NotImplementedError";
    this.stage = stage;
  }
}

const notImplemented = (stage, why) => async () => { throw new NotImplementedError(stage, why); };

/** The stages with no implementation yet. Exported so a caller can see the list. */
// EMPTY. Every stage now has an implementation; what remains is wiring, which
// is UNWIRED_STAGES below. Keeping the two lists distinct matters: "nobody
// wrote this" and "nobody plugged this in" are different problems with
// different owners, and collapsing them hides whichever is real.
export const MISSING_STAGES = Object.freeze({});

/**
 * Produce one film. Returns the shape runLongformCycle expects, or throws a
 * NAMED error identifying the stage that stopped it.
 *
 * Everything with a side effect is injected, so the whole chain is testable
 * without a network, a model, a filesystem or ffmpeg.
 */
export async function produceLongformFilm(topic, {
  // model-backed stages
  writeScript = writeLongformScript,
  writeBoard = writeStoryboard,
  // stages with no implementation — see MISSING_STAGES
  acquireMedia = notImplemented("acquireMedia", MISSING_STAGES.acquireMedia),
  makeThumbnail = notImplemented("makeThumbnail", MISSING_STAGES.makeThumbnail),
  // filesystem-bound
  render,
  // measurement + publication
  measure = measureFilm,
  publish,
  ffmpegPath,
  sources = [],
  sourceText = "",
  now = Date.now(),
} = {}) {
  const slug = topic?.slug || String(topic?.id || "untitled");
  const stage = (name) => logger.info(`🎬 ${slug}: ${name}`);

  // ── 1. script ────────────────────────────────────────────────────────────
  stage("writing the script");
  const script = await writeScript({ event: topic, sources, sourceText });
  if (!script) throw new Error("script generation returned null — the topic is abandoned");

  // ── 2. media, BEFORE the storyboard ──────────────────────────────────────
  // Order matters: the storyboard references media KEYS, and a storyboard
  // written against media that was never acquired produces dangling
  // references the schema then rejects — after paying for the generation.
  stage("acquiring media");
  const candidates = await acquireMedia({ topic, script: script.doc, now });
  const acq = planAcquisition({ title: topic?.title, candidates, acquiredOn: now });
  if (!acq.ok) {
    throw new Error(`media acquisition refused:\n  ${acq.problems.join("\n  ")}`);
  }

  // ── 3. storyboard ────────────────────────────────────────────────────────
  stage("writing the storyboard");
  const mediaKeys = {
    footage: acq.assets.filter((a) => !a.synthetic).map((a) => a.key),
    photos: [], docs: [], statements: [],
  };
  const board = await writeBoard({
    script: script.markdown, spine: script.doc.spine, mediaKeys, sources, sourceText, slug,
  });
  if (!board) throw new Error("storyboard generation returned null — the topic is abandoned");

  // ── 4. render ────────────────────────────────────────────────────────────
  if (!render) throw new NotImplementedError("render", "no render function supplied");
  stage("rendering");
  const art = await render({ slug, script, board, assets: acq.assets });

  // ── 5. thumbnail ─────────────────────────────────────────────────────────
  stage("thumbnail");
  const thumb = await makeThumbnail({ slug, film: art.film, title: topic?.title });

  // ── 6. measure ───────────────────────────────────────────────────────────
  stage("measuring");
  const measurements = await measure({
    ffmpegPath, film: art.film, srtPath: art.srt,
    shotsJsonPath: art.shotsJson, shortFiles: art.shortFiles || [],
  });

  // ── 7. the publish plan, with the disclosure DERIVED ─────────────────────
  const plan = buildPublishPlan({
    slug, title: topic?.title, description: topic?.summary || "",
    licensesText: acq.licenses,
    generatedScenes: acq.assets.filter((a) => a.synthetic).map((a) => a.key),
    shorts: (art.shortFiles || []).map((f, i) => ({
      file: f.split("/").pop(),
      title: board.shorts?.[i]?.title || `${topic?.title} — ${i + 1}`,
      hook: board.shorts?.[i]?.hook || "",
    })),
    startFrom: now,
  });
  const tiktok = buildTikTokPlan({
    licensesText: acq.licenses, shorts: plan.shorts,
    generatedScenes: acq.assets.filter((a) => a.synthetic).map((a) => a.key),
  });

  // ── 8. the verdict ───────────────────────────────────────────────────────
  // The disclosure is checked against the SAME provenance it was derived from.
  // That is belt-and-braces on purpose: derivation makes it correct, the gate
  // proves it, and a future change to either is caught by the other.
  const { disclosureFailures } = await import("./longformQcGate.js");
  const verdict = qcVerdict({
    ...measurements,
    disclosure: disclosureFailures({
      licensesText: acq.licenses, publishJson: plan, tiktokJson: tiktok }),
  });

  return {
    slug, verdict, plan, tiktok, thumb,
    artifacts: art,
    // publishIfPassed calls this ONLY on a pass.
    publish: async () => publish({ plan, tiktok, artifacts: art, thumb }),
    youtubeId: null, privacyStatus: "private", publishAt: plan.youtube.publishAt,
    shorts: plan.shorts,
  };
}

/**
 * What still has no implementation. Callable without running anything, so the
 * gap is inspectable rather than discovered halfway through a render.
 */
export function missingCapabilities() {
  return Object.entries(MISSING_STAGES).map(([stage, why]) => ({ stage, why }));
}

/**
 * Stages that HAVE an implementation but still need wiring by the caller.
 * Separate from MISSING_STAGES so "nobody wrote this" and "nobody plugged this
 * in" cannot be confused for one another.
 */
export const UNWIRED_STAGES = Object.freeze({
  acquireMedia:
    "implemented in longformAcquire.makeAcquireMedia({ search, download, probe, destDir }). " +
    "Needs a DVIDS/NASA search client, an HTTP downloader and a destination directory. " +
    "DVIDS_API_KEY IS set on the VPS and VIDEO_FOOTAGE_ENABLED=1 — the shorts loop already " +
    "uses both, so the credential side of unattended acquisition is solved (verified in the " +
    "worker container 2026-08-26).",
  render:
    "the engine renders (build.mjs / music.mjs / shorts.mjs) but is driven by path from a " +
    "project working directory; a caller must set that directory up first.",
  makeThumbnail:
    "implemented in longformThumbnail.makeThumbnailStage({ outDir, ffmpegPath, fontsDir, " +
    "satori, Resvg, plateFrom }). Needs a plate frame from the film's FOOTAGE — not from " +
    "the film itself, which on a card-based film puts the headline over its own type.",
});
