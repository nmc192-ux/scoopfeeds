/**
 * _example.template.js — REDACTED example of an LLM-judgment prompt module.
 *
 * This file is COMMITTED (the rest of ./prompts/ is gitignored) so the code is
 * coherent and runnable by anyone supplying their own prompts. It documents the
 * prompt-module CONTRACT without any proprietary content.
 *
 * ★ Position C. ★ The real per-sub-criterion prompts are the proprietary
 * operationalization (the moat). They are gitignored (this repo is public). To
 * add a sub-criterion: copy this file to ./prompts/<subCriterion>.js (e.g.
 * 2.1.d.js) and replace the GENERIC skeleton below with the real rubric
 * application, calibration examples, and edge-case guidance — that filled-in file
 * stays out of git.
 *
 * Contract — a prompt module exports:
 *   buildPrompt(input, rubric) -> string   // the full prompt sent to the LLM
 *   meta = { subCriterion, version }       // optional
 *
 * buildPrompt receives:
 *   input  = { text, language?, evidenceUrl? }   // the source material to judge
 *   rubric = { levels: [...graduated buckets...], guidance? }  // the methodology scale
 * and MUST end with groundedRubricInstruction(rubric.levels) so the model returns
 * the grounded JSON the harness expects ({bucket, groundingQuote, reasoning}).
 */

import { groundedRubricInstruction } from "../groundedSchema.js";

export const meta = { subCriterion: "_example", version: "template-v1" };

export function buildPrompt(input, rubric) {
  const levels = rubric?.levels || [];
  // GENERIC, non-proprietary skeleton. Real prompts add the methodology rubric
  // definition per level, calibration few-shot examples, and edge-case rules.
  return [
    "You are applying a published source-credibility rubric to one piece of evidence.",
    "Judge ONLY from the TEXT provided — do not use outside knowledge or assume facts.",
    "",
    "RUBRIC LEVELS (least to most): " + levels.join(" < ") + ".",
    rubric?.guidance ? "GUIDANCE: " + rubric.guidance : "",
    "",
    "TEXT:",
    '"""',
    String(input?.text || "").slice(0, 12000),
    '"""',
    "",
    groundedRubricInstruction(levels),
  ].filter(Boolean).join("\n");
}
