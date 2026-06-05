/**
 * promptLoader.js — the gitignored-prompt mechanism (B.6.3a, Position C / Q4).
 *
 * ★ Why prompts are gitignored. ★ Per Position C, the LLM-evaluation PROMPTS are
 * the proprietary operationalization — the competitive moat (the published
 * methodology + headline weights are open; the prompts are not). THIS REPO IS
 * PUBLIC (confirmed: github.com/nmc192-ux/scoopfeeds is public), so anything
 * committed is published. Therefore the per-sub-criterion prompt modules live in
 * ./prompts/ which is GITIGNORED — except a redacted example template and this
 * folder's README. The loader reads the real prompt at runtime; the code stays
 * coherent and runnable by anyone who supplies their own prompts (honoring the
 * open-methodology / proprietary-operationalization split).
 *
 * ⚠ DURABLE-BACKUP NOTE: because the prompts are gitignored they are NOT
 * repo-backed-up. Keep a durable backup of ./prompts/ OUTSIDE this repo (the
 * moat is not recoverable from git history if lost). See ./prompts/README.md.
 *
 * Prompt module contract — ./prompts/<subCriterion>.js exports:
 *   export function buildPrompt(input, rubric) -> string   // the full LLM prompt
 *   export const meta = { subCriterion, version }          // optional
 * See ./prompts/_example.template.js for the redacted, runnable shape.
 */

// Only safe id characters — defends the dynamic import against path traversal.
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

/**
 * loadPrompt(subCriterion) → { buildPrompt, meta }
 * Throws a CLEAR, actionable error when the prompt is missing (the common case
 * on a fresh clone, since prompts are gitignored) or malformed.
 */
export async function loadPrompt(subCriterion) {
  if (!subCriterion || !SAFE_ID.test(subCriterion)) {
    throw new Error(`loadPrompt: invalid sub-criterion id ${JSON.stringify(subCriterion)} (allowed: letters, digits, . _ -)`);
  }
  const url = new URL(`./prompts/${subCriterion}.js`, import.meta.url);

  let mod;
  try {
    mod = await import(url.href);
  } catch (e) {
    const missing = e?.code === "ERR_MODULE_NOT_FOUND" || /Cannot find module|Cannot find package/i.test(e?.message || "");
    if (missing) {
      throw new Error(
        `loadPrompt: prompt for "${subCriterion}" not found at evidence/llm/prompts/${subCriterion}.js. ` +
        `Prompts are Position-C IP and gitignored — copy _example.template.js to ${subCriterion}.js and fill it ` +
        `(see evidence/llm/prompts/README.md).`,
      );
    }
    throw e;
  }

  const buildPrompt = mod.buildPrompt ?? mod.default?.buildPrompt;
  if (typeof buildPrompt !== "function") {
    throw new Error(`loadPrompt: prompt module "${subCriterion}.js" must export buildPrompt(input, rubric) — see _example.template.js`);
  }
  return { buildPrompt, meta: mod.meta ?? mod.default?.meta ?? null };
}
