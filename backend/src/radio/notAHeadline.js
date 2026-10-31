/**
 * notAHeadline.js — drops feed items whose "title" is not a news story: a promo or call to action (DrJ, 30 Oct 2026:
 * "Watch Latest Business News on Bloomberg" aired on the 24/7 screen), or a regular feature with no story behind it
 * (DrJ, 1 Nov 2026: "Pointed! Bloomberg's Weekly News Quiz For Risk-Takers" aired as a headline; "a headline should
 * actually represent a story with real meaning"): quizzes and puzzles, newsletters and podcast episodes, shopping
 * deals, recipes, sponsored posts, picture round-ups and what-to-watch guides.
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
  // 1 Nov: features with no news story behind them. Quizzes, puzzles and games anywhere in the title ("Pointed!
  // Bloomberg's Weekly News Quiz For Risk-Takers", "Can you name every...", "Test your knowledge").
  /\b(?:quiz(?:zes)?|crosswords?|puzzles?|wordle|sudoku|horoscopes?|brain\s*teasers?|trivia)\b/i,
  /^(?:can\s+you\s+(?:name|guess|spot|solve)|test\s+your\s+(?:knowledge|news)|how\s+(?:well|much)\s+do\s+you\s+know)\b/i,
  // Newsletters, briefings and podcast episodes as products ("The Morning Briefing", "Podcast: ...", "Episode 214").
  /^(?:(?:the\s+)?(?:morning|evening|daily|weekly|weekend)\s+(?:briefing|brief|digest|roundup|round-up|wrap|newsletter|edition))\b/i,
  /^(?:podcast|newsletter|episode\s+\d+)\b|\|\s*(?:podcast|newsletter)\b|\bpodcast\s+episode\b|\bepisode\s+\d+\b/i,
  // Shopping, recipes, sponsored content.
  /\b(?:best|top)\s+(?:\d+\s+)?(?:\w+\s+){0,2}(?:deals?|gifts?|buys?)\b|\b(?:promo|discount|coupon)\s+codes?\b|\bdeals?\s+of\s+the\s+(?:day|week)\b/i,
  /\brecipes?\b/i,
  /\b(?:sponsored|advertorial|advertisement|paid\s+(?:post|content|partnership)|partner\s+content)\b/i,
  // Picture and viewing round-ups ("Photos of the week", "The week in pictures", "What to watch this weekend").
  /\b(?:photos?|pictures?|images)\s+of\s+the\s+(?:day|week|month|year)\b|\bweek\s+in\s+(?:pictures|photos)\b|\b(?:what|where)\s+to\s+(?:watch|stream|read|listen)\b|\bhow\s+to\s+watch\b/i,
];

/** True when `title` is a promo, a call to action or a feature with no news story, rather than a headline. A missing title is not a headline. */
export function looksLikePromo(title) {
  if (!title || typeof title !== "string") return true;
  const t = title.trim().replace(/\s+/g, " ");
  return PATTERNS.some((re) => re.test(t));
}
