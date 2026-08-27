/**
 * endpoints.mjs — every provider host and path this tooling will ever contact,
 * in one file, because docs/briefs/stock-library-builder.md §2a makes endpoint
 * verification a stop-and-report rather than a judgement call.
 *
 * §2a IS CLOSED. Verified off-container by DrJ on 27 Aug 2026 against the
 * providers' own documentation. It was NOT verified by the session that wrote
 * this code: the egress proxy blocks both hosts, so the first draft of this file
 * shipped its constants quarantined behind `verifiedAgainstDocs: false` rather
 * than assert a URL nobody had read.
 *
 * THE GATE EARNED ITS KEEP. The Pexels endpoint in that first draft was WRONG —
 * it used the older https://api.pexels.com/videos/ path, which the documentation
 * marks for deprecation:
 *
 *   "Video endpoints are now available at https://api.pexels.com/v1/videos/. The
 *    https://api.pexels.com/videos/ endpoints will be deprecated in the future."
 *
 * That is exactly the near-miss §2a is written against, and it reached this file
 * because porting code means copying its URLs. Any future change to a constant
 * here is the same kind of change: re-verify against the doc URL beside it, and
 * update `verification` to say who did and when.
 */

/** True only because a human read the doc pages below. See the header. */
export const verifiedAgainstDocs = true;

/** Who verified, when, and how — the how matters (see header). */
export const verification = Object.freeze({
  by: "DrJ",
  date: "2026-08-27",
  method: "off-container: read from the official documentation pages directly, " +
    "not by the authoring session, which cannot reach either host",
});

export const PEXELS = Object.freeze({
  // Verified 2026-08-27 against https://www.pexels.com/api/documentation/ (#videos-search).
  doc: "https://www.pexels.com/api/documentation/#videos-search",
  // NOTE the /v1/ — https://api.pexels.com/videos/search is the deprecated path.
  url: "https://api.pexels.com/v1/videos/search",
  auth: "Authorization header, the API key as the bare value (no 'Bearer ' prefix)",
  params: ["query", "orientation", "size", "locale", "page", "per_page"],
  // orientation: landscape | portrait | square
  // size: large (4K) | medium (Full HD) | small (HD)
  // per_page: default 15, max 80
  perPageMax: 80,
  license: "Pexels License",
  // 200 requests/hour, 20,000/month. X-Ratelimit-* headers come back on 2xx ONLY
  // and are ABSENT on a 429, so they cannot be used to decide how long to wait —
  // which is part of why a 429 stops the run outright instead of backing off.
  rateLimit: { perHour: 200, perMonth: 20000, headersOn429: false },
});

export const PIXABAY = Object.freeze({
  // Verified 2026-08-27 against https://pixabay.com/api/docs/ (#api_search_videos).
  doc: "https://pixabay.com/api/docs/#api_search_videos",
  url: "https://pixabay.com/api/videos/",
  auth: "`key` query parameter",
  params: [
    "key", "q", "lang", "id", "video_type", "category", "min_width", "min_height",
    "editors_choice", "safesearch", "order", "page", "per_page",
  ],
  // CONFIRMED 2026-08-27: video search has NO orientation filter (image search
  // does). Portrait detection is therefore dimension-based — see cropGate.mjs.
  hasOrientationFilter: false,
  // q is URL-encoded, max 100 characters. per_page is 3-200, default 20.
  queryMaxChars: 100,
  perPageMin: 3,
  perPageMax: 200,
  license: "Pixabay Content License",
  // 100 requests per 60 SECONDS — not per hour. A 429 returns a plain-text body,
  // which is why readJson checks the content type before trying to parse.
  rateLimit: { perSeconds: 60, requests: 100 },
  /**
   * CACHING IS A LICENCE TERM, NOT A PERFORMANCE CHOICE. The Pixabay API terms
   * require that "requests must be cached for 24 hours" and state that
   * "systematic mass downloads are not allowed". The search cache in
   * providers.mjs is therefore a compliance mechanism: do not remove it as an
   * optimisation nobody needs.
   */
  cacheHours: 24,
});

/**
 * Throw unless a human has closed §2a. Called on the live path only — the unit
 * tests never reach the network and so never call this.
 *
 * This passes today. It is kept because the condition it guards can be reopened:
 * anyone changing a URL above without re-verifying should flip the flag back and
 * get this refusal rather than silently repointing the tool at a new host.
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
