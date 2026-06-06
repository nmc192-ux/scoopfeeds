/**
 * modelGuard.js — model-tier guard for gated find-relevant judgments (B.6.4a / #109).
 *
 * A find-relevant gate (2.2.c, 2.2.d) only abstains correctly on a CAPABLE model; a
 * too-small model ignores the gate and scores non-relevant articles to a false bucket
 * (#109). So judgments flagged requiresCapableModel are guarded: if the model the tier
 * will use is NOT gate-validated, the runner abstains (unavailable "model-not-validated")
 * BEFORE any LLM call — fail-safe, not fail-silent.
 *
 * Resolution reuses llmQueue's existing getQueueStatus() (genModel/premiumModel) — no
 * llmQueue change. The allowlist is config: new production models are gate-validated
 * before being added here (finding #109).
 */

import { getQueueStatus } from "../../../../realityIndex/llmQueue.js";

// Models GATE-VALIDATED for find-relevant judgments. Seeded with the proven model.
// New production models are gate-validated before being added (finding #109).
export const VALIDATED_CAPABLE_MODELS = new Set([
  "qwen2.5-coder:7b",
]);

/** The concrete model the given tier resolves to right now (via llmQueue config). */
export function resolvedModelForTier(tier = "standard") {
  const s = getQueueStatus();
  return tier === "premium" ? s.premiumModel : s.genModel;
}

/** True iff `model` is on the gate-validated allowlist. Pure (testable in isolation). */
export function isModelValidated(model) {
  return !!model && VALIDATED_CAPABLE_MODELS.has(model);
}
