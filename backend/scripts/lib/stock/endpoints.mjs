/**
 * endpoints.mjs — every provider host and path this tooling will ever contact,
 * in one file, because docs/briefs/stock-library-builder.md §2a makes endpoint
 * verification a stop-and-report rather than a judgement call.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THESE CONSTANTS ARE UNVERIFIED. `verifiedAgainstDocs` is false and the    │
 * │ acquire tool REFUSES to make a live request while it stays false.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * §2a requires each host and path be confirmed against the provider's own
 * documentation — NOT against MoneyPrinterTurbo's `material.py`, because porting
 * code means copying its URLs. That check could not be performed in the
 * environment this was written in: the egress proxy blocks www.pexels.com and
 * pixabay.com outright (verified — all four hosts return no response), so the
 * documentation pages were unreachable and no endpoint here has been read off
 * the official docs by the author of this file.
 *
 * Rather than ship a plausible URL behind a comment claiming it was checked,
 * the values below are quarantined: they are the *proposal*, and a human closes
 * §2a by reading each doc URL, confirming the constant beside it character for
 * character, and flipping `verifiedAgainstDocs` to true. A near-miss hostname is
 * exactly the failure §2a is written against, and a homograph or typosquat of a
 * media host is worth more than a stray comment.
 *
 * TO CLOSE §2a:
 *   1. Open each `doc` URL below.
 *   2. Confirm `url`, `auth` and `params` match it exactly.
 *   3. Set verifiedAgainstDocs: true (and record who checked it, and when).
 * Nothing else in this port needs to change — the wire contract lives here.
 */

/** Flip to true ONLY after a human has read the doc URLs below. See §2a. */
export const verifiedAgainstDocs = false;

/** Who verified, and when. Fill in alongside the flag. */
export const verification = { by: null, date: null };

export const PEXELS = Object.freeze({
  // Doc to check against: https://www.pexels.com/api/documentation/#videos-search
  doc: "https://www.pexels.com/api/documentation/#videos-search",
  url: "https://api.pexels.com/videos/search",
  auth: "Authorization header, the API key as the bare value (no 'Bearer ' prefix)",
  params: ["query", "orientation", "per_page", "page"],
  license: "Pexels License",
});

export const PIXABAY = Object.freeze({
  // Doc to check against: https://pixabay.com/api/docs/#api_search_videos
  doc: "https://pixabay.com/api/docs/#api_search_videos",
  url: "https://pixabay.com/api/videos/",
  auth: "`key` query parameter",
  // Pixabay video search exposes NO orientation filter — §3a says filter on
  // returned dimensions instead. Confirm that absence when verifying.
  params: ["key", "q", "video_type", "per_page", "page", "safesearch"],
  license: "Pixabay Content License",
});

/**
 * Throw unless a human has closed §2a. Called on the live path only — --dry-run
 * and the unit tests never reach the network and so never call this.
 */
export function assertEndpointsVerified() {
  if (verifiedAgainstDocs === true) return;
  throw new Error(
    "REFUSING to contact a provider: the endpoint constants in " +
      "backend/scripts/lib/stock/endpoints.mjs have not been verified against the " +
      "providers' own documentation (brief §2a).\n" +
      `  Pexels:  ${PEXELS.url}   check against ${PEXELS.doc}\n` +
      `  Pixabay: ${PIXABAY.url}   check against ${PIXABAY.doc}\n` +
      "Read both doc pages, confirm each host and path character for character, " +
      "then set verifiedAgainstDocs = true in that file.\n" +
      "This applies to --dry-run too: a dry run still asks the provider what exists, so it reaches " +
      "the same unverified host. --list-classes is the only mode that works before then."
  );
}
