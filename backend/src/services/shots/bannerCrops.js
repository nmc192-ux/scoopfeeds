/**
 * bannerCrops.js — per-source crops for burned-in banners (brief, Phase 3).
 *
 * `ymax` is the fraction of the source frame's height the renderer may show,
 * measured from the top: 0.80 keeps the top 80% and loses the lower-third
 * banner. Matched against the Commons author, credit and title together,
 * because an uploader's name and a channel's name both identify the source.
 *
 * Add a row when a new source's banner is seen on a contact sheet. A source
 * the vision check flags as bannered but which has NO row here gets the
 * default below, marked provisional so a human can confirm it.
 */

export const BANNER_CROPS = Object.freeze([
  // The Greenland sample: White House event video carries a lower-third
  // banner. Visible height capped at 0.80 (brief, Phase 3).
  { id: "white-house", match: /\bwhite ?house\b/i, crop: { ymax: 0.80 } },
]);

export const PROVISIONAL_CROP = Object.freeze({ ymax: 0.80, provisional: true });

/** The crop for a source, the provisional one when vision saw a banner, or null. */
export function cropFor({ author = "", credit = "", title = "" } = {}, { bannerSeen = false } = {}) {
  const hay = `${author} ${credit} ${title}`;
  const row = BANNER_CROPS.find((r) => r.match.test(hay));
  if (row) return { ...row.crop, source: row.id };
  return bannerSeen ? { ...PROVISIONAL_CROP } : null;
}
