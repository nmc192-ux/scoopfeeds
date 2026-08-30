/**
 * videoImageIdentity.js — one key per PHOTOGRAPH, derived from its URL.
 *
 * WHY THIS EXISTS. Perceptual hashing catches re-encodings of one picture, and
 * it was already doing that. It does NOT catch CROPS: a CDN serving
 * `0_0_3749_3000/master` and `1200_0_2549_3000/master` of one photograph
 * produces genuinely different pixels, so aHash reports two pictures and a
 * rendered short showed the same artwork twice (measured 2026-08-30, and the
 * two crops hashed 27 bits apart against a 5-bit duplicate threshold).
 *
 * Every major news CDN carries a STABLE PER-IMAGE TOKEN in the path, with the
 * size and crop as separate segments — verified against live pages:
 *
 *   Guardian     /img/media/{mediaHash}/{cropRect}/master/{w}.jpg?width=
 *   The Hindu    /{article}.ece/alternates/LANDSCAPE_{size}/{file}
 *   DW           /image/{id}_{size}.{ext}
 *   Smithsonian  /{signature}=/{size}/filters:.../{THE ORIGINAL URL}
 *   CNBC         /api/v1/image/{id}-{stamp}-{name}?v=&w=&h=
 *
 * So the identity is recoverable BEFORE the download, which also makes this the
 * cheapest of the three dedupe layers: a duplicate is never fetched at all.
 *
 * IT RUNS IN FRONT OF THE HASH, NOT INSTEAD OF IT. Unknown hosts fall back to
 * generic rules that will miss things, and one photograph served by two
 * different publishers has two identities and one hash. The layers are
 * complementary and both are cheap.
 */

/** Hosts whose path embeds the ORIGINAL image URL after a signature/filters. */
const EMBEDS_ORIGINAL = /https?:\/\/[^/]+\/.*?\/(https?:\/\/.+)$/;

/**
 * A stable key for the photograph behind a URL.
 *
 * Never throws — an unparseable URL is its own identity, which is the safe
 * answer: it dedupes against nothing and costs one fetch.
 */
export function imageIdentity(url) {
  try {
    let s = String(url || "").trim();
    if (!s) return "";
    s = s.split("#")[0].split("?")[0];

    // A thumbnailer that wraps the original: the original IS the identity.
    const embedded = s.match(EMBEDS_ORIGINAL);
    if (embedded) s = embedded[1];

    return s
      // The Hindu: /alternates/LANDSCAPE_1200/ -> /alternates/
      .replace(/\/alternates\/[A-Z]+_\d+\//i, "/alternates/")
      // DW: /image/77474131_605.jpg -> /image/77474131
      .replace(/\/image\/(\d+)_\d+\.(jpe?g|png|webp|avif)$/i, "/image/$1")
      // Guardian: /{cropRect}/master/3749.jpg -> /master  (the crop is the point)
      .replace(/\/\d+_\d+_\d+_\d+\/master\/\d+\.(jpe?g|png|webp)$/i, "/master")
      // Generic "/1600x0/" or "/fit-in/768x512/" size segments.
      .replace(/\/(fit-in\/)?\d+x\d+\//g, "/")
      // A long base64-ish signature segment (thumbor and friends).
      .replace(/\/[A-Za-z0-9_-]{20,}=\//, "/")
      // Trailing -1600x900 / _1024x768 dimension suffixes before the extension.
      .replace(/[-_]\d{3,4}x\d{3,4}(?=\.[a-z]{3,4}$)/i, "");
  } catch { return String(url || ""); }
}

/** True when two URLs name the same photograph. */
export const sameImage = (a, b) => {
  const ia = imageIdentity(a);
  return Boolean(ia) && ia === imageIdentity(b);
};

/**
 * Filter a list to one URL per photograph, keeping the FIRST occurrence.
 *
 * First, not largest: the caller's order carries its own meaning (search rank,
 * or the card cascade's upscale-then-original preference), and re-ranking here
 * would silently overrule it.
 */
export function dedupeByIdentity(urls = []) {
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    const id = imageIdentity(u);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(u);
  }
  return out;
}
