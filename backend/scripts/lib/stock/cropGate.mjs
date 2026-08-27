/**
 * cropGate.mjs — the quality/crop gate from docs/briefs/stock-library-builder.md §5.
 *
 * The vertical frame is 1080×1920 and most stock is 16:9, so a 9:16 centre crop
 * from a landscape source keeps only `height × 9/16` of the width. Resolution is
 * therefore the whole question: a 1080p landscape clip yields a 607×1080 crop that
 * has to be upscaled ~1.78×, which is why that grade is rationed rather than
 * accepted outright.
 *
 * What this file does NOT decide: whether the subject survives the centre crop.
 * That is a human judgement made during curation (§5, §8) and no amount of
 * dimension arithmetic substitutes for it.
 */

export const TARGET_WIDTH = 1080;
export const TARGET_HEIGHT = 1920;
export const MIN_DURATION_SEC = 2;
export const MAX_DURATION_SEC = 120;

/** Above this many better-grade candidates in a class, soft-hd-crop is not worth taking (§5). */
export const SOFT_CROP_CLASS_LIMIT = 5;

/** Grades in descending order of quality. */
export const GRADES = ["native-portrait", "crisp-4k-crop", "soft-hd-crop"];
const BETTER_THAN_SOFT = new Set(["native-portrait", "crisp-4k-crop"]);

/** Width of a 9:16 centre crop taken from a source of this height. */
export function centreCropWidth(height) {
  return Math.round((height * TARGET_WIDTH) / TARGET_HEIGHT);
}

/**
 * Grade one candidate on dimensions and duration alone.
 * Returns { orientation, grade, accepted, reason }. `grade` is null when rejected
 * on resolution; a duration rejection still reports the grade it would have had,
 * because that is what a --dry-run reader wants to see.
 */
export function gradeCandidate({ width, height, durationSec }) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { orientation: null, grade: null, accepted: false, reason: "unknown-dimensions" };
  }

  const orientation = h > w ? "portrait" : "landscape";

  let grade = null;
  let reason = null;
  if (orientation === "portrait") {
    if (w >= TARGET_WIDTH) grade = "native-portrait";
    else reason = "below-1080p";
  } else if (h >= 2160) {
    grade = "crisp-4k-crop";
  } else if (h >= TARGET_WIDTH) {
    grade = "soft-hd-crop";
  } else {
    reason = "below-1080p";
  }

  if (!grade) return { orientation, grade: null, accepted: false, reason };

  const d = Number(durationSec);
  if (!Number.isFinite(d) || d <= 0) {
    return { orientation, grade, accepted: false, reason: "unknown-duration" };
  }
  if (d < MIN_DURATION_SEC) return { orientation, grade, accepted: false, reason: "too-short" };
  if (d > MAX_DURATION_SEC) return { orientation, grade, accepted: false, reason: "too-long" };

  return { orientation, grade, accepted: true, reason: null };
}

/**
 * Ration soft-hd-crop within a class (§5): accept it only while the class holds
 * fewer than SOFT_CROP_CLASS_LIMIT better-grade assets. `existingBetterCount` is
 * the count already in the manifest for this class, so the budget survives across
 * runs instead of resetting every invocation.
 *
 * Input order is treated as preference order. Returns the same objects with
 * `accepted`/`reason` updated, so a caller can print the rejected ones too.
 */
export function rationSoftCrops(graded, existingBetterCount = 0) {
  let better = existingBetterCount;
  return graded.map((c) => {
    if (!c.accepted) return c;
    if (BETTER_THAN_SOFT.has(c.grade)) {
      better += 1;
      return c;
    }
    if (better >= SOFT_CROP_CLASS_LIMIT) {
      return { ...c, accepted: false, reason: "soft-crop-quota" };
    }
    return c;
  });
}
