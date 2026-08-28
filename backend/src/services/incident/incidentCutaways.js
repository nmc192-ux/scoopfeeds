/**
 * incidentCutaways.js — incident media entering the ONE compositing path.
 *
 * An incident asset is a cutaway with a different provenance. It renders through
 * #121's mechanism — `assembleSlide({ cutawayPath, cutawaySecs, cutawayCredit })`
 * — and this module produces exactly the shape that path already consumes.
 * Nothing here builds a filter graph, composites anything, or touches
 * videoAssembler. There is no second compositing path and this file is the
 * reason there does not need to be: the assembler cannot tell the difference
 * between a stock cutaway and an incident one, which is the point.
 *
 * THE SOURCE LADDER (brief §2b). Incident media is TRUE TO THE STORY — it shows
 * the thing that happened. Stock is SUBJECT illustration: a flag, a port, a
 * texture. So where both could fill a beat, incident wins, and the stock library
 * is the bottom rung, used when nothing true-to-story cleared. That ordering is
 * implemented in `mergeCutaways` below and is the whole relationship between
 * this engine and #119/#121.
 *
 * EVERY LIMIT IS RE-CHECKED HERE. Clearance already enforced the excerpt cap and
 * the credit; this checks them again against the row as it is NOW, immediately
 * before the asset is handed to the assembler. That is not belt-and-braces for
 * its own sake: clearance happened at some earlier time, possibly days ago, and
 * the question at render time is whether this asset is still usable, not whether
 * it once was.
 */

import { existsSync } from "fs";
import { assertRenderable } from "./incidentClearanceLedger.js";
import { EXCERPT_MAX_SECS, EXCERPT_MAX_TOTAL_SECS, provenanceFor, requiresCredit } from "./incidentClearance.js";
import { resolveQuarantined } from "./incidentFiles.js";
import { MAX_CUTAWAYS, cutawaySecs } from "../videoStockLibrary.js";
import { cutawayFrameForLane } from "../videoAssembler.js";
import { logger } from "../logger.js";

/** Dark until switched on, in the established shape (brief §2 Phase 5). */
export const incidentMediaEnabled = () => process.env.VIDEO_INCIDENT_MEDIA_ENABLED === "1";

/**
 * THE COLD OPEN IS OURS (DrJ, Gate C).
 *
 * No third-party footage may start inside the first COLD_OPEN_SECS of a video.
 *
 * Frame 0 is what autoplays in feed and what every platform grabs as a
 * thumbnail, and the Gate C render opened on full-bleed borrowed material with
 * the masthead suppressed — which is simultaneously the first thing a viewer
 * sees, the still that represents the video everywhere it is listed, and the
 * weakest Lane 3 position available. None of those were decisions; they were
 * consequences of slide 0 being eligible.
 *
 * 0.8s: long enough that the thumbnail frame and the first beat of autoplay are
 * unambiguously ours, short enough not to cost a cutaway on a four-slide short.
 * Named rather than inlined so the number can be argued with.
 */
export const COLD_OPEN_SECS = Number.parseFloat(process.env.VIDEO_INCIDENT_COLD_OPEN_SECS || "0.8");

export class IncidentRenderRefused extends Error {
  constructor(message, { code, candidateId } = {}) {
    super(message);
    this.name = "IncidentRenderRefused";
    this.code = code;
    this.candidateId = candidateId;
  }
}

/**
 * How long this particular asset may be on screen.
 *
 * A fair-use asset carries its own agreed excerpt length and is held to it.
 * Owner and grant assets use the ordinary cutaway duration. Both are then
 * clamped to the band the mechanism itself enforces — a clearance recorded
 * before the band changed cannot outlive it.
 */
export function secondsFor(candidate) {
  const detail = safeParse(candidate.clearance_detail);
  const agreed = Number(detail?.excerptSecs);
  const base = Number.isFinite(agreed) && agreed > 0 ? agreed : cutawaySecs();
  return Math.min(base, EXCERPT_MAX_SECS);
}

const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

/**
 * Turn a ledger row into something the assembler can take, or refuse it.
 *
 * Refuses rather than skips, deliberately. A silently dropped asset looks
 * identical to one that was never selected, and the difference — "this was
 * cleared and approved and then could not be used" — is exactly what somebody
 * needs to see.
 */
export function toRenderable(candidate, { root, orientation = "vertical" } = {}) {
  // Cleared + credited + operator-tapped. Throws ClearanceRefusedError.
  assertRenderable(candidate);

  const rel = candidate.treated_path || candidate.local_path;
  if (!rel) {
    throw new IncidentRenderRefused(
      `candidate ${candidate.id} is cleared and approved but we hold no file for it. ` +
      "A grant without the footage is permission to use something we do not have.",
      { code: "no-file", candidateId: candidate.id }
    );
  }
  const absPath = resolveQuarantined(rel, root ? { root } : undefined);
  if (!existsSync(absPath)) {
    throw new IncidentRenderRefused(
      `candidate ${candidate.id} references ${rel}, which is not on disk — the sweeper may have taken it, ` +
      "or the library was never synced to this machine.",
      { code: "file-missing", candidateId: candidate.id }
    );
  }
  if (!candidate.treated_path) {
    // Untreated media is the provider's own look, not the house look — the same
    // rule videoStockLibrary applies to an ungraded asset.
    throw new IncidentRenderRefused(
      `candidate ${candidate.id} has not been treated. Untreated footage is whatever it happens to look like, ` +
      "and the grade is what makes it read as ours rather than as an embed.",
      { code: "untreated", candidateId: candidate.id }
    );
  }

  const creditRequired = requiresCredit(candidate.clearance_basis);

  return {
    id: candidate.id,
    absPath,
    // CREDIT BY PROVENANCE, READ THROUGH THE PREDICATE RATHER THAN OFF THE ROW.
    //
    // A third-party row's credit is passed through; own material passes null
    // even if the row happens to carry a credit string. That asymmetry is
    // deliberate: `assertRenderable` above has already refused any third-party
    // row without a credit, so the only way a credit reaches here on an `owner`
    // row is a stale value from before this lane existed, or a hand-edited
    // row — and burning either onto the picture would put a source credit on
    // footage that has no source. Ignoring it is the quiet failure; refusing
    // the render would be the loud one, and the loud one is wrong here because
    // the asset is genuinely usable and nothing about the credit is needed to
    // use it. A test covers the stray-credit row explicitly.
    credit: creditRequired ? candidate.credit_text : null,
    creditRequired,
    provenanceOfRights: provenanceFor(candidate.clearance_basis),
    seconds: secondsFor(candidate),
    clearanceBasis: candidate.clearance_basis,
    // Lane-aware composition (DrJ, Gate C and Gate E): grant renders full-bleed
    // with the chrome suppressed; fair_use and owner keep our framing. See
    // cutawayFrameForLane for why those two share a composition for entirely
    // different reasons.
    frame: cutawayFrameForLane(candidate.clearance_basis, orientation),
    provenance: "incident",
  };
}

/**
 * Choose incident cutaways for a spec's slides.
 *
 * Mirrors selectCutaways' rules rather than inventing new ones — the same
 * no-consecutive-beats rule and the same ceiling — because the viewer
 * experiences one video, not two sources.
 *
 * ALSO enforces the fair-use TOTAL across the whole video, which stock does not
 * need: two 3-second excerpts from two different posts have the same effect on a
 * video as two from one, so the budget is per video rather than per asset.
 */
export function selectIncidentCutaways(slides = [], {
  candidates = [], max = MAX_CUTAWAYS, root = null, slideStarts = null, orientation = "vertical",
} = {}) {
  const picks = [];
  const refused = [];
  let fairUseSpent = 0;

  /**
   * Is this beat inside the cold open?
   *
   * With real slide start times this is exact. Without them only slide 0 can be
   * PROVEN to start at t=0, so that is the conservative floor — and
   * `assertColdOpen` below is the authoritative check, run at assembly where the
   * timeline is actually known. Two layers, the second being the one that cannot
   * be fooled by a missing argument.
   */
  const insideColdOpen = (i) =>
    Array.isArray(slideStarts) ? (slideStarts[i] ?? 0) < COLD_OPEN_SECS : i === 0;

  const usable = [];
  for (const c of candidates) {
    try {
      usable.push(toRenderable(c, { root: root ?? undefined, orientation }));
    } catch (err) {
      refused.push({ candidateId: c?.id, code: err?.code || "refused", reason: err?.message });
    }
  }

  for (let i = 0; i < slides.length && picks.length < max; i++) {
    if (insideColdOpen(i)) continue;                                            // the open is ours
    if (picks.length && i - picks[picks.length - 1].slideIndex < 2) continue;   // never consecutive
    const asset = usable.find((a) => !picks.some((p) => p.asset.id === a.id));
    if (!asset) break;

    if (asset.clearanceBasis === "fair_use") {
      if (fairUseSpent + asset.seconds > EXCERPT_MAX_TOTAL_SECS) {
        refused.push({
          candidateId: asset.id, code: "fair-use-budget",
          reason: `${fairUseSpent + asset.seconds}s would exceed the ${EXCERPT_MAX_TOTAL_SECS}s fair-use total for one video`,
        });
        continue;
      }
      fairUseSpent += asset.seconds;
    }
    picks.push({ slideIndex: i, asset });
  }

  for (const r of refused) {
    logger.warn(`🎥 incident: candidate ${r.candidateId} not rendered — ${r.code}: ${String(r.reason).slice(0, 160)}`);
  }
  return { picks, refused, fairUseSpent };
}

/**
 * Merge incident picks over stock picks — the source ladder, applied.
 *
 * Incident wins any beat both want, and a stock pick is dropped rather than
 * shuffled: moving it to a neighbouring beat would break the
 * no-consecutive-cutaways rule that both selectors independently maintain, and
 * a beat with no cutaway is a correct beat.
 *
 * The combined result still respects MAX_CUTAWAYS, because the ceiling is about
 * the viewer's experience of the video and does not care where a clip came from.
 */
export function mergeCutaways(incidentPicks = [], stockPicks = [], { max = MAX_CUTAWAYS } = {}) {
  const bySlide = new Map();
  for (const p of incidentPicks) bySlide.set(p.slideIndex, { ...p, source: "incident" });

  for (const p of stockPicks) {
    if (bySlide.size >= max) break;
    if (bySlide.has(p.slideIndex)) continue;                       // incident already has this beat
    // Respect the no-consecutive rule ACROSS both sources.
    const adjacent = [...bySlide.keys()].some((s) => Math.abs(s - p.slideIndex) < 2);
    if (adjacent) continue;
    bySlide.set(p.slideIndex, { ...p, source: "stock" });
  }

  return [...bySlide.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, max)
    .map(([, pick]) => pick);
}

/**
 * The credit for a merged pick, whichever source it came from.
 *
 * Incident assets carry a `credit` composed at clearance from the poster and
 * platform; stock assets are credited by videoStockLibrary.cutawayCredit from
 * the manifest. One function so the assembler's call site does not have to know
 * which kind it has.
 */
export function creditForPick(pick, stockCredit) {
  if (pick.source === "incident") return pick.asset.credit;
  return stockCredit ? stockCredit(pick.asset) : null;
}


/**
 * The authoritative cold-open check, run where the timeline is known.
 *
 * Selection excludes beats it can prove are inside the cold open; this refuses
 * any pick that actually is, given the real slide start times. It exists because
 * selection's fallback is a heuristic and this one is not — and the property
 * being protected (the first frames of the video are ours) is about the finished
 * timeline rather than about slide indices.
 *
 * THROWS. A cold open on borrowed footage is not a degraded render to log and
 * carry on with: it is the thumbnail.
 */
export function assertColdOpen(picks = [], slideStarts = []) {
  const bad = picks.filter((p) => p.source !== "stock" && (slideStarts[p.slideIndex] ?? 0) < COLD_OPEN_SECS);
  if (bad.length) {
    throw new IncidentRenderRefused(
      `third-party footage starts at ${bad.map((p) => (slideStarts[p.slideIndex] ?? 0).toFixed(2)).join("s, ")}s, ` +
      `inside the ${COLD_OPEN_SECS}s cold open. Frame 0 autoplays in feed and is grabbed as the thumbnail — ` +
      "opening on borrowed material with no framing is the weakest position available.",
      { code: "cold-open", candidateId: bad[0]?.asset?.id }
    );
  }
  return true;
}
