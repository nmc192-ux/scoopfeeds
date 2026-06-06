/**
 * groundedSchema.js — the grounded-rubric output contract for LLM judgment (B.6.3a).
 *
 * Every LLM-evaluation prompt MUST force the model to return this exact JSON:
 *
 *   {
 *     "bucket":         <one of the sub-criterion's graduated rubric levels>,
 *     "groundingQuote": <a VERBATIM passage from the judged text the verdict rests on>,
 *     "reasoning":      <one brief sentence>
 *   }
 *
 * ★ Why grounding is MANDATORY (the honesty crux). ★ A model is trained to sound
 * confident — a freeform score is vibes. Forcing it to quote the SPECIFIC text it
 * judged makes the verdict (a) auditable by a human/founder and (b) falsifiable:
 * the harness checks the quote actually appears in the input. A verdict whose
 * "quote" isn't in the text is ungrounded — a signal the judgment is unreliable,
 * NOT a confident answer. The model NEVER reports its own confidence; confidence
 * is computed structurally by the harness (inter-run agreement × grounding ×
 * language factor).
 *
 * Pure module: no LLM call, no I/O. Shared by the harness and every prompt module.
 */

export const GROUNDED_RUBRIC_SCHEMA = Object.freeze({
  type: "object",
  required: ["bucket", "groundingQuote", "reasoning"],
  properties: {
    bucket: { type: "string", description: "exactly one of the allowed rubric levels" },
    groundingQuote: { type: "string", description: "verbatim passage from the provided text" },
    reasoning: { type: "string", description: "one brief sentence" },
  },
});

/**
 * groundedRubricInstruction(levels) → the standard output-format instruction
 * string appended to every judgment prompt, so the model returns the grounded
 * schema with a bucket drawn ONLY from this sub-criterion's graduated levels.
 * `levels` is the methodology's graduated scale, in order (e.g. 2.1.d:
 * ["no-process","not-transparent","transparent-timely","public-log"]).
 */
export function groundedRubricInstruction(levels) {
  const allowed = (levels || []).map((l) => JSON.stringify(l)).join(", ");
  return [
    "Return ONLY a JSON object with exactly these keys:",
    '  "bucket": one of [' + allowed + "] — pick the single level the evidence best supports.",
    '  "groundingQuote": a VERBATIM substring copied from the TEXT above that your judgment rests on',
    "    (copy it exactly, do not paraphrase). If the text contains no passage that supports a",
    '    judgment, return "bucket" as the most cautious level and an empty "groundingQuote".',
    '  "reasoning": one brief sentence.',
    "Do NOT include a confidence field — confidence is computed externally. Do NOT invent",
    "facts not present in the TEXT.",
  ].join("\n");
}

/**
 * parseJudgment(raw, levels) → normalize one LLM run into
 *   { bucket: <in-rubric level> | null, groundingQuote: string|null, reasoning: string|null }
 * bucket is null when the run did not commit to an allowed level (refusal,
 * out-of-rubric value, malformed/!object) — a non-committal run, NOT a guess.
 */
// Reserved find-relevant sentinel (B.6.3c-2): a gated prompt returns this bucket when
// the article is not the relevant TYPE. It is OUTSIDE every rubric's levels, so it never
// commits — but it is flagged distinctly (notApplicable:true) so the find-relevant
// factory can tell "not the right kind of article" from "model said garbage / can't decide".
const NOT_APPLICABLE = "not-applicable";

export function parseJudgment(raw, levels) {
  if (!raw || typeof raw !== "object") return { bucket: null, groundingQuote: null, reasoning: null };
  const lv = Array.isArray(levels) ? levels : [];
  const bucketRaw = typeof raw.bucket === "string" ? raw.bucket.trim() : null;
  const bucket = bucketRaw && lv.includes(bucketRaw) ? bucketRaw : null;
  const groundingQuote = typeof raw.groundingQuote === "string" && raw.groundingQuote.trim() ? raw.groundingQuote : null;
  const reasoning = typeof raw.reasoning === "string" && raw.reasoning.trim() ? raw.reasoning : null;
  // The reserved sentinel → bucket:null + notApplicable:true. Any OTHER out-of-levels
  // value → bucket:null with NO flag (unchanged: garbage stays garbage).
  if (bucket === null && bucketRaw && bucketRaw.toLowerCase() === NOT_APPLICABLE) {
    return { bucket: null, notApplicable: true, groundingQuote, reasoning };
  }
  return { bucket, groundingQuote, reasoning };
}
