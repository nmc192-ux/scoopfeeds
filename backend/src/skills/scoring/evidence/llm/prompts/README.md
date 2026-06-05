# LLM-judgment prompts (Position C — proprietary, gitignored)

The per-sub-criterion prompt modules in this directory are the **proprietary
operationalization** of the Source Credibility Methodology — the competitive moat
(Position C / Decision 7). The published methodology and the headline component
weights are open; **these prompts are not.**

## Why gitignored

`github.com/nmc192-ux/scoopfeeds` is a **public** repo — anything committed is
published. So this directory is gitignored **except** `_example.template.js` (the
redacted, runnable contract example) and this README. The real prompts
(`2.1.d.js`, `2.4.b.js`, …) live here at runtime but never enter git.

## ⚠ Durable backup

Because the prompts are gitignored, **they are NOT backed up by the repo.** Git
history will not recover them if lost. **Keep a durable backup of this directory
outside the repo** (encrypted store / private vault / secrets manager). The moat
is only as safe as that backup.

## Adding a prompt

1. Copy `_example.template.js` to `<subCriterion>.js` (e.g. `2.1.d.js`).
2. Replace the generic skeleton with the real rubric application, calibration
   few-shot examples, and edge-case guidance.
3. Keep `buildPrompt(input, rubric)` ending in `groundedRubricInstruction(...)`
   so the model returns the grounded JSON the harness expects.

The loader (`../promptLoader.js`) reads `<subCriterion>.js` at runtime and throws
a clear error if it is missing.
