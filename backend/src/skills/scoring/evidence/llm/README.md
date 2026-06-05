# evidence/llm — LLM-judgment substrate (B.6.3a)

The honest-confidence harness for the LLM-evaluation sub-criteria (B.6.3b/c/d).
Analogue of B.6.2b-1's fetch foundation: the substrate and the precedent, shipped
and validated **before** any judgment module.

## The honesty crux — confidence is STRUCTURAL, never self-reported

A model is trained to sound confident even when wrong, so its own `confidence`
field is meaningless. `judgmentHarness.evaluateWithConfidence` derives confidence
from three structural signals instead:

1. **Inter-run agreement** — run the judgment `N=3` times at temperature `~0.3`
   and measure how often the runs land on the same graduated bucket. Agreement
   *is* the confidence (3/3 high, 2/3 moderate, split → unresolved). The modest
   temperature is deliberate: near-zero makes runs trivially identical so
   "agreement" means nothing; a modest temperature lets genuine uncertainty
   surface as disagreement, which is the signal.
2. **Grounding** — each run must quote the verbatim text its verdict rests on, and
   the harness verifies the quote actually appears in the input. Ungrounded → a
   heavy confidence penalty (auditable, not vibes).
3. **Language / observability factor** — confidence is down-weighted for
   less-supported languages (methodology §7.4). The residual-limit honesty:
   multi-run catches fluently-but-variably wrong; *consistently* confident-wrong
   (systematic bias) survives N runs, so a low-resource source reads as less
   reliable **by construction**, and `founderFlag` is the backstop.

Status mapping: majority + grounded → `evidenced` (confidence = agreement ×
grounding × language); split/tie → `pending-llm` (founderFlag); LLM disabled →
`pending-llm` (never a fabricated score); no input → `unavailable`.

## Skill-isolation EXCEPTION (deliberate)

B.6.2's precedent was "the skill owns its own HTTP." This layer **deliberately
reuses** the shared `realityIndex/llmQueue.js` `callJson` rather than building a
skill-local LLM client, because `llmQueue` is a **shared, stateful, rate-limited**
resource — two skills with independent clients would collide on the same
free-tier RPM. `callJson` already provides provider routing, RPM queueing, retry,
structured-JSON, temperature, and tiers. It is injectable via `ctx.llmCall` for
offline tests (the default *is* `callJson`).

## Files

- `groundedSchema.js` — the grounded-rubric output contract + `parseJudgment`.
- `judgmentHarness.js` — `evaluateWithConfidence(...)` (the crux).
- `promptLoader.js` — loads gitignored, proprietary prompts (Position C).
- `prompts/` — gitignored prompt modules + the committed redacted template + README.

Evidence-only: the harness returns an Evidence object and **never** writes
`sources.quality_score`.
