/**
 * 2.1.e — Separation of news and opinion content (Editorial track record / ET).
 *
 * PARKED for B.6.3c-2 — find-relevant: needs an opinion/labelled article in-sample; true
 * locus = index/section, not body. Pulled from c-1 after dry-run showed body-only grounding
 * over-confident in the 'good' direction.
 *
 * The module + its gitignored prompt are KEPT in place but UNREGISTERED (not in
 * registry.js) so it does NOT run until c-2 reworks it for the find-relevant family.
 *
 * Article-text judgment: is opinion content clearly labelled (article level / index /
 * across channels)? Judged per body across the shared sample, then aggregated.
 * (makeArticleTextJudgment factory.)
 */
import { makeArticleTextJudgment } from "../llm/articleTextJudgment.js";

export default makeArticleTextJudgment({
  id: "2.1.e",
  component: "ET",
  levels: ["no separation", "weak labelling", "clear in product", "clear across channels"],
});
