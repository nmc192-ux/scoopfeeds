/**
 * 2.2.a — Source attribution (Methodology transparency / MT), B.6.3c-1.
 * Article-text judgment: are claims attributed to specific sources/documents/
 * interviews, with anonymous sourcing justified inline? Judged per body across the
 * shared ≤5-article sample, then aggregated. (makeArticleTextJudgment factory.)
 */
import { makeArticleTextJudgment } from "../llm/articleTextJudgment.js";

export default makeArticleTextJudgment({
  id: "2.2.a",
  component: "MT",
  levels: ["unattributed", "mostly unattributed", "mostly attributed", "fully attributed + anonymity justified"],
});
