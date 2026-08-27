/**
 * passes.mjs — the order in which provider requests are spent.
 *
 * This is quota policy, and it lives here rather than inside the CLI so the
 * ordering can be pinned by a test. Pexels allows 200 requests/hour and Pixabay
 * 100 per 60 seconds, so which request goes first is not a detail: each pass is
 * one request PER QUERY, and a class with four queries spends four requests a
 * pass.
 *
 * The provider-side filters do the crop gate's work before any bytes move.
 * Asking Pexels for portrait 4K, or Pixabay for min_height=2160, is far cheaper
 * than pulling a page of 720p and discarding it locally at the gate.
 *
 * `rank` orders passes ACROSS providers, best first, so a run spends its best
 * requests before its weak ones and can stop once a class is full. The ranking
 * follows the §5 grades: native portrait needs no crop at all, 4K landscape
 * crops crisply, and Full HD landscape is the soft grade that gets rationed
 * anyway — so it is asked for last, if at all.
 */

export const PASSES = Object.freeze([
  { rank: 1, provider: "pexels", orientation: "portrait", size: "large" },   // 4K portrait: nothing to crop
  { rank: 2, provider: "pixabay", minHeight: 2160 },                          // 4K, either orientation
  { rank: 3, provider: "pexels", orientation: "portrait", size: "medium" },  // Full HD portrait: native-portrait
  { rank: 4, provider: "pexels", orientation: "landscape", size: "large" },  // 4K landscape: crisp-4k-crop
  { rank: 5, provider: "pixabay", minHeight: 1080 },
  { rank: 6, provider: "pexels", orientation: "landscape", size: "medium" }, // soft-hd-crop, and rationed
].sort((a, b) => a.rank - b.rank));

/** The passes for the providers actually in play, still best-first. */
export function applicablePasses(providers) {
  return PASSES.filter((p) => providers.includes(p.provider));
}

/** How a pass reads in the run log — the run must say what it asked for. */
export function describePass(p) {
  return p.provider === "pexels" ? `pexels ${p.orientation}/${p.size}` : `pixabay ≥${p.minHeight}p`;
}
