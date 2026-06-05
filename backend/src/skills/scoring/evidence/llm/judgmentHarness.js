/**
 * judgmentHarness.js — the honest-confidence harness for LLM-judgment sub-criteria
 * (B.6.3a). The precedent every B.6.3b/c/d judgment module is built from — the
 * analogue of B.6.2b-1's fetch foundation.
 *
 * ★ THE CRUX — confidence must be STRUCTURAL, never self-reported. ★ A model is
 * trained to sound confident even when wrong, so its "confidence: 0.9" is
 * meaningless. Honest confidence here is built from three structural signals:
 *
 *   1. INTER-RUN AGREEMENT — run the judgment N times at a modest temperature and
 *      measure how often the runs land on the SAME graduated bucket. Agreement IS
 *      the confidence: 3/3 → high, 2/3 → moderate, all-differ → unresolved. A
 *      modest temperature (~0.3) is deliberate: near-zero makes runs trivially
 *      identical (agreement becomes meaningless), while a modest temperature lets
 *      GENUINE uncertainty surface as disagreement — which is the signal.
 *   2. GROUNDING — each run must quote the VERBATIM text its verdict rests on, and
 *      the harness verifies the quote actually appears in the input. Ungrounded =
 *      a heavy confidence penalty, never a confident answer (auditable, not vibes).
 *   3. LANGUAGE / OBSERVABILITY FACTOR — confidence is down-weighted for
 *      less-supported languages (methodology §7.4). This is the residual-limit
 *      honesty: multi-run catches fluently-but-VARIABLY wrong, but CONSISTENTLY
 *      confident-wrong (systematic bias, esp. low-resource-language) survives N
 *      runs — so a low-resource source's score reads as less reliable BY
 *      CONSTRUCTION, and founder review (founderFlag) is the backstop.
 *
 * Status mapping (Q5):
 *   majority agree + grounded → EVIDENCED (confidence = agreement × grounding × language)
 *   runs split / tie          → PENDING-LLM (judgment attempted, unresolved; founderFlag)  ← pending-llm earns its place
 *   LLM disabled              → PENDING-LLM (NEVER a fabricated score)
 *   no usable input text      → UNAVAILABLE
 *   no run committed          → PENDING-LLM (calls failed / model refused / "can't tell")
 *
 * ★ SKILL-ISOLATION EXCEPTION (Q2). ★ B.6.2's precedent was "the skill owns its
 * own HTTP." This harness deliberately RELAXES that and reuses the shared
 * realityIndex/llmQueue.callJson rather than building a skill-local LLM client —
 * because llmQueue is a SHARED, STATEFUL, rate-limited resource: two skills with
 * independent clients would collide on the same free-tier RPM. callJson already
 * provides provider-routing, RPM queueing, retry, structured-JSON, temperature,
 * and tiers. Reusing it is the correct call for a genuinely-shared resource.
 * (Injectable via ctx.llmCall for offline tests — the default IS callJson.)
 *
 * Evidence-only: returns an Evidence object; NEVER writes sources.quality_score.
 */

import { EVIDENCE_STATUS, round2 } from "../contract.js";
import { callJson } from "../../../../realityIndex/llmQueue.js";
import { loadPrompt } from "./promptLoader.js";
import { parseJudgment } from "./groundedSchema.js";

const BASIS = "llm-multi-run-agreement";
const RUNS_DEFAULT = 3;
const TEMPERATURE_DEFAULT = 0.3; // modest — see header (Q3)
const MAX_OUTPUT_TOKENS = 512;
const FOUNDER_CONFIDENCE_THRESHOLD = 0.5; // below this (or ungrounded) → flag for founder
const UNGROUNDED_FACTOR = 0.4; // a consistent-but-unquotable bucket is weak signal, not zero
const MIN_QUOTE_CHARS = 8; // a "quote" shorter than this can't be a real grounding

// Language reliability factors (methodology §7.4). High-resource → 1.0; the
// long tail → down-weighted. Extensible — flagged for review. Default for an
// UNSPECIFIED language is 1.0 (the caller didn't supply the bias signal; we don't
// invent a penalty) but it is recorded as "unspecified" so the absence is visible.
const LANGUAGE_FACTORS = Object.freeze({
  en: 1, es: 1, fr: 1, de: 1, pt: 1, it: 1, nl: 1,
  ru: 0.9, ar: 0.9, zh: 0.9, ja: 0.9, ko: 0.9,
  hi: 0.85, tr: 0.85, pl: 0.85, id: 0.85, vi: 0.85, uk: 0.85,
});
const LOW_RESOURCE_FACTOR = 0.7;

function isLlmDisabled() {
  // Read at call time (not module load) so it is honored dynamically + testable.
  return String(process.env.LLM_DISABLED || process.env.GEMINI_DISABLED || "").toLowerCase() === "1";
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// A grounding quote is valid iff it is a real, non-trivial substring of the text.
function isGrounded(quote, text) {
  const q = norm(quote);
  if (q.length < MIN_QUOTE_CHARS) return false;
  return norm(text).includes(q);
}

function languageFactorFor(language) {
  if (!language) return { factor: 1, language: "unspecified" };
  const l = String(language).toLowerCase().slice(0, 2);
  return { factor: LANGUAGE_FACTORS[l] ?? LOW_RESOURCE_FACTOR, language: l };
}

function evidence(status, value, confidence, evidenceUrl, now) {
  return { status, value, confidence: round2(confidence), evidenceUrl: evidenceUrl ?? null, gatheredAt: now };
}

/**
 * evaluateWithConfidence({ subCriterion, input, rubric, tier, ctx }) → Evidence
 *
 *   input  = { text, language?, evidenceUrl?, observability? }  — the text to judge.
 *   rubric = { levels: [graduated buckets in order], ... }      — the methodology scale.
 *   tier   = "standard" | "premium"                             — routed to llmQueue.
 *   ctx    = { now?, runs?, temperature?, maxOutputTokens?, priority?,
 *              llmCall?, buildPrompt? }  — llmCall/buildPrompt injectable for tests;
 *              defaults are the real callJson + the gitignored prompt for subCriterion.
 */
export async function evaluateWithConfidence({ subCriterion, input, rubric, tier = "standard", ctx = {} }) {
  const now = ctx.now ?? Date.now();
  const N = ctx.runs ?? RUNS_DEFAULT;
  const temperature = ctx.temperature ?? TEMPERATURE_DEFAULT;
  const llmCall = ctx.llmCall ?? callJson;
  const evidenceUrl = input?.evidenceUrl ?? null;
  const { factor: languageFactor, language } = languageFactorFor(input?.language);

  // Kill switch — never fabricate a score when the LLM is off.
  if (isLlmDisabled()) {
    return evidence(EVIDENCE_STATUS.PENDING_LLM, { reason: "llm-disabled", founderFlag: true, basis: BASIS }, 0, evidenceUrl, now);
  }

  const text = input?.text;
  if (!text || !norm(text)) {
    return evidence(EVIDENCE_STATUS.UNAVAILABLE, { reason: "no-input-text", basis: BASIS }, 0, evidenceUrl, now);
  }

  const levels = rubric?.levels;
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new Error("evaluateWithConfidence: rubric.levels (the graduated buckets, in order) is required");
  }

  // Resolve the prompt builder: real path loads the gitignored prompt for the
  // sub-criterion; tests inject ctx.buildPrompt so no prompt file is needed.
  const buildPrompt = ctx.buildPrompt ?? (await loadPrompt(subCriterion)).buildPrompt;

  // N independent runs (sequential — gentle on the shared free-tier RPM).
  const runs = [];
  for (let i = 0; i < N; i++) {
    let raw = null;
    try {
      raw = await llmCall(buildPrompt(input, rubric), {
        tier,
        temperature,
        maxOutputTokens: ctx.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
        priority: ctx.priority ?? "low",
      });
    } catch {
      raw = null; // a failed call is a non-committal run, not a verdict
    }
    runs.push(parseJudgment(raw, levels));
  }

  const committed = runs.filter((r) => r.bucket); // runs that picked an in-rubric level
  const perRunBuckets = runs.map((r) => r.bucket); // includes nulls — honest record

  // No run committed → unresolved (calls failed / model refused / can't-tell).
  if (committed.length === 0) {
    return evidence(EVIDENCE_STATUS.PENDING_LLM, {
      reason: "no-committed-runs", runs: N, buckets: perRunBuckets,
      founderFlag: true, languageFactor, language, basis: BASIS,
    }, 0, evidenceUrl, now);
  }

  // Modal bucket + agreement across ALL N runs (failed runs depress agreement — honest).
  const counts = {};
  for (const r of committed) counts[r.bucket] = (counts[r.bucket] || 0) + 1;
  let modalBucket = null, modalCount = 0;
  for (const [b, c] of Object.entries(counts)) if (c > modalCount) { modalBucket = b; modalCount = c; }
  const tie = Object.values(counts).filter((c) => c === modalCount).length > 1;
  const majority = modalCount >= Math.ceil((N + 1) / 2); // N=3 → ≥2

  // Split / tie → unresolved. Never a confident pick from disagreement.
  // "runs-disagree" = no two runs agreed (every committed run distinct);
  // "runs-tie" = ≥2 agreed on the top bucket but short of a majority (tie/plurality).
  if (!majority || tie) {
    return evidence(EVIDENCE_STATUS.PENDING_LLM, {
      reason: modalCount === 1 ? "runs-disagree" : "runs-tie", runs: N,
      buckets: perRunBuckets, counts,
      founderFlag: true, languageFactor, language, basis: BASIS,
    }, 0, evidenceUrl, now);
  }

  const agreement = round2(modalCount / N);

  // Grounding: of the modal-bucket runs, which quoted text that actually appears?
  const modalRuns = committed.filter((r) => r.bucket === modalBucket);
  const groundingQuotes = modalRuns.map((r) => r.groundingQuote).filter((q) => isGrounded(q, text));
  const groundingFactor = round2(groundingQuotes.length / modalRuns.length);
  const ungrounded = groundingQuotes.length === 0;

  const confidence = round2(agreement * (ungrounded ? UNGROUNDED_FACTOR : groundingFactor) * languageFactor);
  const founderFlag = confidence < FOUNDER_CONFIDENCE_THRESHOLD || ungrounded;

  return evidence(EVIDENCE_STATUS.EVIDENCED, {
    bucket: modalBucket,
    agreement,
    agreementCount: modalCount,
    runs: N,
    buckets: perRunBuckets,
    groundingQuotes,
    groundingFactor,
    ungrounded,
    languageFactor,
    language,
    founderFlag,
    reasoningSample: modalRuns[0]?.reasoning ?? null,
    basis: BASIS,
  }, confidence, evidenceUrl, now);
}
