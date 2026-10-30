/**
 * notAHeadline.js — drops feed items whose "title" is a promo or call to action, not a news headline
 * (DrJ, 30 Oct 2026: "Watch Latest Business News on Bloomberg" aired on the 24/7 screen).
 *
 * Applied to the radio's candidates beside looksLikeProgrammingBlock() (recurring show slots). Radio only: the
 * social publisher keeps its own filter. Pure, no I/O. A false drop costs one headline; a false keep puts an
 * advert for someone else's channel on air, so the patterns lean towards dropping.
 */

const BRAND = String.raw`(?:bloomberg|cnbc|cnn|bbc|fox|sky|msnbc|abc|cbs|nbc|al\s+jazeera|reuters|dw|pbs|npr|euronews|france\s*24|yahoo|wsj|ft)(?:\s+(?:tv|radio|news|business|live|plus|originals|markets|world|digital|go))?`;

const PATTERNS = [
  // "Watch Latest Business News on Bloomberg", "Watch live coverage", "Listen to the full episode", "Watch Trump's
  // speech in full". A "Watch:" label in front of a real story ("Watch: Rocket lands") is left alone.
  /^(?:watch|listen(?:\s+to)?|stream|tune\s+in(?:\s+to)?)\b(?!\s*:)[^:]*\b(?:latest|live|news|coverage|full|episodes?|now|here|today|replay)\b/i,
  // A title that is only "Latest / Top / Today's / Breaking (business) news|headlines|updates", optionally
  // "today", "this morning" or "on <channel>": "Latest Business News", "Top headlines on CNBC".
  new RegExp(String.raw`^(?:the\s+)?(?:latest|top|today'?s|breaking|morning|evening)\s+(?:[a-z&]+\s+){0,2}(?:news|headlines|stories|updates|bulletin)(?:\s+(?:today|now|this\s+(?:hour|morning|afternoon|evening|week)))?(?:\s+(?:on|from|at|with)\s+${BRAND})?\s*[.!]?$`, "i"),
  // Anything that ends by sending the reader to a channel: "Markets wrap: live on Bloomberg TV".
  new RegExp(String.raw`\b(?:watch|listen|live|streaming|available)\s+(?:\w+\s+){0,3}(?:on|at)\s+${BRAND}\s*[.!]?$`, "i"),
  // Calls to action.
  /^(?:subscribe|sign\s+up|download|follow\s+us|get\s+the\s+(?:app|newsletter)|click\s+here|read\s+more)\b/i,
];

/** True when `title` is a promo or call to action rather than a headline. A missing title is not a headline. */
export function looksLikePromo(title) {
  if (!title || typeof title !== "string") return true;
  const t = title.trim().replace(/\s+/g, " ");
  return PATTERNS.some((re) => re.test(t));
}
