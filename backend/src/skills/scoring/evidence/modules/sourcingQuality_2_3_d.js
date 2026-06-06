/**
 * 2.3.d — Quality of sourcing within the beat (Domain expertise / DE), B.6.3c-1.
 * Article-text judgment: does the source cite domain experts / primary literature /
 * original data — not other news coverage as the primary source? Judged per body
 * across the shared sample, then aggregated. (makeArticleTextJudgment factory.)
 */
import { makeArticleTextJudgment } from "../llm/articleTextJudgment.js";

export default makeArticleTextJudgment({
  id: "2.3.d",
  component: "DE",
  levels: ["only other news", "mostly secondary", "mixed", "experts/primary sources"],
});
