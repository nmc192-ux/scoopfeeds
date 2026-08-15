/**
 * videoSpecWriter.js — the two generation calls behind the video spec contract.
 *
 * Call 1 (writeVideoSpec)  — article  → slide spec   (brief §3)
 * Call 2 (writePackaging)  — spec     → packaging    (brief §5b)
 *
 * Schema, validation and the closed card set live in videoSpecSchema.js. This
 * module owns the prompts and the model plumbing, nothing else. It does not
 * render, select, or publish.
 *
 * WHY TWO CALLS. Brief §3 shows packaging and slides in ONE JSON object; §5b
 * then says packaging is a separate call run AFTER the script, because
 * packaging written in the same breath as the script inherits the script's
 * register and comes out flat. §5b wins and gives its reason, so the schema
 * describes one merged artifact while generation is two calls. Call 2 also
 * gets to validate against a spec that already passed — a title cannot be
 * checked for "asserts a figure the video never pays off" until the figures
 * are settled.
 *
 * MODEL PLUMBING IS A DELIBERATE COPY, not shared code. llmQueue, igSummary
 * and scriptWriter each carry their own pin + degrade block; 1ba73f0 chose
 * per-service duplication explicitly ("no refactor onto llmQueue"). A fourth
 * copy follows the house pattern rather than introducing a fifth shape. If
 * that call is ever revisited, all four move together — not this one alone.
 *
 * §3 / §6.2 TENSION, resolved and flagged. §3 says an untraceable numeric card
 * is DROPPED. §6.2 says an article with such a card is SKIPPED. Both are
 * implemented and kept separate: validateSpec drops and reports `dropped[]`,
 * and the Section 6 publish gate reads that array to decide. Collapsing them
 * here would hard-code a publishing policy into a schema module.
 *
 * Required env:
 *   VIDEO_SPEC_ENABLED=1        — master switch (default off, dark-ship posture)
 *   GEMINI_API_KEY
 *
 * Optional env:
 *   VIDEO_SPEC_MODEL            — SPEC call pin (default gemini-3.5-flash)
 *   GEMINI_GENERATION_MODEL     — PACKAGING pin (default gemini-3.1-flash-lite)
 *   VIDEO_SPEC_MAX_OUTPUT_TOKENS — output cap (default 8192, see below)
 *   VIDEO_FULLTEXT_MAX_CHARS / VIDEO_FULLTEXT_TIMEOUT_MS — see videoFullText.js
 */

import axios from "axios";
import { logger } from "./logger.js";
import {
  buildGeminiGenerationConfig,
  isGeminiThinkingRejection,
  markGeminiThinkingRejected,
  isGeminiModelGone,
  markGeminiModelGone,
} from "../realityIndex/llmQueue.js";
import {
  MODEL_EMITTABLE, SUBJECT_VISUAL_TYPES, THUMBNAIL_ANGLES, MIN_SLIDES, MAX_SLIDES,
  CAPTION_MAX_CHARS, CAPTION_MIN_CHARS,
  validateSpec, validatePackaging, decorateTitleCard,
} from "./videoSpecSchema.js";
import { resolveAttribution } from "./videoAttribution.js";

// TWO PINS, deliberately different tiers for two different jobs.
//
// SPEC_MODEL — gemini-3.5-flash, pinned for RELIABILITY, not for beat count.
// Measured 2026-08-02 on identical articles and an identical prompt:
//   flash-lite      0/3 successful specs · beats 5.0
//   3.5-flash       2/3 · beats 5.5 · thoughts 0 · 5-8s
//   3.1-pro-preview 2/3 · beats 6.5 · thoughts 4-6k billed as output · 38-55s,
//                   and one article lost outright to truncation
// Tier is NOT the variable behind flat beat counts — 5 → 5.5 → 6.5 across three
// tiers is noise next to the 12-20 the rubric asks for. What 3.5-flash buys is
// a spec that comes back at all, with no thinking tokens and inside a sane
// latency budget. Pro is rejected on cost and latency, not on quality.
//
// This is a SERVICE-LOCAL var, unlike the SCRIPT_LLM_MODEL knob retired from
// scriptWriter — and for the opposite reason. That one was a second name for
// the same intent, which is how pins drift apart. This one encodes a measured
// divergence: the spec call genuinely needs a different tier from every other
// Gemini caller, and folding it into GEMINI_GENERATION_MODEL would drag the
// whole codebase onto 3.5-flash as a side effect.
const SPEC_MODEL = process.env.VIDEO_SPEC_MODEL || "gemini-3.5-flash";

// PACKAGING_MODEL stays on the shared pin. Packaging is a few hundred tokens of
// hook-writing against a finished script — the cheap tier does it well, and the
// comparison gave no reason to move it.
const PACKAGING_MODEL = process.env.GEMINI_GENERATION_MODEL || "gemini-3.1-flash-lite";

const ENDPOINT = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

// 8192, not scriptWriter's 4096. A 25-slide spec is a structurally larger
// artifact than a narration blob: every slide carries a type, an eyebrow, its
// own content fields AND a caption, so the JSON scaffolding is a real fraction
// of the output rather than a rounding error. The measured figure from the
// production-length run is recorded in docs; this default is set from that
// measurement, not from a guess — and MAX_TOKENS remains a hard rejection
// either way, so an under-set cap fails loudly instead of truncating.
const MAX_OUTPUT_TOKENS = Number.parseInt(process.env.VIDEO_SPEC_MAX_OUTPUT_TOKENS || "8192", 10);
const PACKAGING_MAX_OUTPUT_TOKENS = Number.parseInt(process.env.VIDEO_PACKAGING_MAX_OUTPUT_TOKENS || "2048", 10);
const TIMEOUT_MS = 60000;   // a 25-slide spec is a longer generation than a caption

// Gemini 2.5 Flash rates (analysisService's pinned figures). flash-lite is the
// cheaper tier, so costUsd is an UPPER BOUND — same note as scriptWriter.
const RATE_IN_PER_M  = 0.30;
const RATE_OUT_PER_M = 2.50;

// Prompt-side ceiling on body text. Above videoFullText's 24,000-char cap so
// it never binds first; present so a caller passing text from elsewhere cannot
// blow the input budget.
const SPEC_BODY_MAX_CHARS = Number.parseInt(process.env.VIDEO_SPEC_BODY_MAX_CHARS || "28000", 10);

const WPM = Number.parseInt(process.env.VIDEO_SPEC_WPM || "150", 10);

/**
 * Does the prompt ASK for subject-visual cards? Default off.
 *
 * The schema and both renderers know `photo` and `map` unconditionally, so this
 * flag cannot produce a card the pipeline is unable to draw — which is the whole
 * reason it gates the PROMPT rather than the contract. Off: the model is never
 * told the types exist and the output is identical to before. On: it is told,
 * and one env line is the entire difference.
 */
export const subjectVisualsEnabled = () => process.env.VIDEO_SUBJECT_VISUALS_ENABLED === "1";

export function isVideoSpecEnabled() {
  return process.env.VIDEO_SPEC_ENABLED === "1" && !!process.env.GEMINI_API_KEY;
}

// ─── Rejection logging (same four fields as scriptWriter) ───────────────────

// NAMED ARGUMENTS, deliberately. This was positional through a63b45d, and the
// per-call model refactor updated three of the five call sites — the two it
// missed logged `model=undefined` in production, on the too-thin and
// exhausted-retries paths. A positional tail argument is exactly the shape that
// gets silently dropped; a named one shows up as missing at the call site, and
// videoSpecWriter.test.js asserts no call site omits it.
function logRejection({ tag, articleId, reason, len, finishReason, usage, model }) {
  logger.warn(
    `🎬 ${tag}: rejected article ${articleId} — ${reason} (len=${len}, ` +
    `model=${model ?? "UNKNOWN"}, finishReason=${finishReason ?? "?"}, ` +
    `thoughtsTokenCount=${usage?.thoughtsTokenCount ?? "?"})`
  );
}

/**
 * A bare 400 INVALID_ARGUMENT. Deliberately NOT added to llmQueue's shared
 * isGeminiThinkingRejection: a 400 can mean a dozen things, and treating every
 * one as a thinking rejection would flip a process-wide flag on evidence that
 * does not support it. This predicate only opens the probe above; the retry's
 * outcome is what decides.
 */
function isInvalidArgument(err) {
  if (err?.response?.status !== 400) return false;
  const body = JSON.stringify(err?.response?.data ?? "");
  return /INVALID_ARGUMENT|invalid argument/i.test(body);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// One retry when the payload is not JSON. The API is stateless — the reminder
// rides on a fresh call of the same prompt, appended so the article context is
// identical both times.
const JSON_ONLY_REMINDER = `

STRICT OUTPUT REMINDER: a previous attempt returned something other than a single JSON object. Return ONLY the JSON object — no markdown fence, no commentary, no text of any kind before the opening { or after the closing }.`;

/**
 * Remove trailing commas before `}` or `]`, string-aware so a comma inside a
 * caption is untouched. This was the ACTUAL cause of the 2026-08-02 non-JSON
 * payloads — visible in the head/tail log the previous change added, which is
 * the whole reason the log was worth adding.
 *
 * Repair, not leniency: a trailing comma is a syntax artifact that carries no
 * content, so removing it cannot change what the model said. Everything the
 * repair produces still faces the full validator.
 */
function repairTrailingCommas(s) {
  let out = "", inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === ",") {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === "}" || s[j] === "]") continue; // drop it
    }
    out += ch;
  }
  return out;
}

/** Parse, then parse-after-repair. Returns the value or undefined on failure. */
function tryParse(s) {
  try { return JSON.parse(s); } catch { /* try the repair */ }
  try { return JSON.parse(repairTrailingCommas(s)); } catch { return undefined; }
}

/**
 * Tolerant JSON extraction: exact parse, fence-stripped, trailing-comma
 * repaired, then the outermost balanced {...} scanned string-aware (braces
 * inside string values don't count) with the same repair applied.
 *
 * Tolerance here is NOT leniency about content — whatever comes out still
 * faces the full validator. It only stops a cosmetic fence, a trailing
 * "Hope this helps!", or a stray comma from costing an entire article. A
 * payload that never balances is genuinely truncated and stays null.
 */
function extractJsonPayload(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  let t = text.trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/i);
  if (fenced) t = fenced[1].trim();

  const direct = tryParse(t);
  if (direct !== undefined) return direct;

  const start = t.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const scoped = tryParse(t.slice(start, i + 1));
        return scoped === undefined ? null : scoped;
      }
    }
  }
  return null;
}

async function callModel(prompt, { articleId, tag, model, maxOutputTokens }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  logger.info(`🎬 ${tag}: Gemini model=${model} for article ${articleId} (cap=${maxOutputTokens})`);

  // Each retry class has its own single-use (or bounded) budget so no
  // combination can loop: transient 5xx/429 gets two backoff retries,
  // thinking-rejection and non-JSON get one immediate retry each.
  const RETRY_DELAYS_MS = [4000, 9000];
  let transientUsed = 0;
  let thinkingRetryUsed = false;
  let jsonRetryUsed = false;
  let promptText = prompt;
  // Set only by the evidence-gated INVALID_ARGUMENT probe below.
  let forceNoThinking = false;
  let thinkingConfirmed = false;

  while (true) {
    const baseConfig = {
      // Lower than scriptWriter's 0.4: this is a structured artifact with
      // hard field constraints, not prose that needs phrasing variety.
      temperature: 0.3,
      responseMimeType: "application/json",
      maxOutputTokens,
    };
    const generationConfig = forceNoThinking ? baseConfig : buildGeminiGenerationConfig(baseConfig);
    const sentThinkingConfig = "thinkingConfig" in generationConfig;

    try {
      const { data } = await axios.post(
        ENDPOINT(model, key),
        { contents: [{ role: "user", parts: [{ text: promptText }] }], generationConfig },
        { timeout: TIMEOUT_MS }
      );

      // The probe succeeded without thinkingConfig — that IS the proof. Flip the
      // shared flag so every later Gemini call in this process skips it too.
      if (forceNoThinking && !thinkingConfirmed) {
        thinkingConfirmed = true;
        markGeminiThinkingRejected(logger, model);
        logger.warn(`🧠 ${tag}: confirmed — ${model} rejects thinkingBudget:0; the 400 was thinkingConfig`);
      }

      const candidate    = data?.candidates?.[0];
      const finishReason = candidate?.finishReason;
      const usage        = data?.usageMetadata || {};
      const text         = candidate?.content?.parts?.[0]?.text;

      if (!text) {
        logRejection({ tag, articleId, reason: "empty", len: 0, finishReason, usage, model });
        return null;
      }
      // HARD rejection. A truncated 25-slide spec that happens to parse is a
      // video that stops mid-argument with narration that references slides
      // which were never emitted.
      if (finishReason === "MAX_TOKENS") {
        logRejection({ tag, articleId, reason: "truncated_max_tokens", len: text.length, finishReason, usage, model });
        return null;
      }

      const parsed = extractJsonPayload(text);
      if (parsed === null || typeof parsed !== "object") {
        // The cause must be legible from the log alone: head and tail of the
        // raw payload, JSON-escaped so newlines survive the log line.
        const head = JSON.stringify(text.slice(0, 200));
        const tail = JSON.stringify(text.slice(-200));
        if (!jsonRetryUsed) {
          jsonRetryUsed = true;
          logger.warn(`🎬 ${tag}: non-JSON payload for article ${articleId} — one retry with JSON-only reminder. head=${head} tail=${tail}`);
          promptText = prompt + JSON_ONLY_REMINDER;
          continue;
        }
        logger.warn(`🎬 ${tag}: non-JSON payload persisted after reminder retry. head=${head} tail=${tail}`);
        logRejection({ tag, articleId, reason: "unparseable_json", len: text.length, finishReason, usage, model });
        return null;
      }

      const cost =
        ((usage.promptTokenCount || 0) / 1e6) * RATE_IN_PER_M +
        ((usage.candidatesTokenCount || 0) / 1e6) * RATE_OUT_PER_M;

      return { parsed, usage, cost, finishReason };
    } catch (err) {
      if (isGeminiThinkingRejection(err) && !thinkingRetryUsed) {
        thinkingRetryUsed = true;
        markGeminiThinkingRejected(logger, model);
        continue;
      }
      if (isGeminiModelGone(err)) { markGeminiModelGone(model, logger); return null; }

      // EVIDENCE-GATED THINKING DEGRADE. Some models reject thinkingBudget:0
      // with a bare 400 INVALID_ARGUMENT whose body says only "Request contains
      // an invalid argument" — no mention of thinking, so
      // isGeminiThinkingRejection cannot match it and the call died as a hard
      // transport failure. Measured 2026-08-02: gemini-3.5-flash-lite, 0/3.
      //
      // Rather than widen the SHARED classifier to "any 400 is a thinking
      // rejection" — which would let an unrelated malformed request flip the
      // process-wide flag for igSummary, scriptWriter and llmQueue too — this
      // binary-searches the request in place: retry ONCE with thinkingConfig
      // removed and nothing else changed. Success proves thinkingConfig was the
      // invalid argument, and only THEN is the shared flag flipped. Failure
      // proves it was not, and the error falls through to be reported honestly.
      if (isInvalidArgument(err) && sentThinkingConfig && !thinkingRetryUsed) {
        thinkingRetryUsed = true;
        forceNoThinking = true;
        logger.warn(
          `🧠 ${tag}: ${model} returned 400 INVALID_ARGUMENT with thinkingConfig present — ` +
          `retrying once WITHOUT it to identify the offending argument`
        );
        continue;
      }
      // The probe came back and still failed: thinkingConfig was NOT the cause.
      // Say so explicitly, so the next reader does not re-run the same test.
      if (isInvalidArgument(err) && forceNoThinking) {
        logger.warn(`🧠 ${tag}: ${model} still 400s WITHOUT thinkingConfig — thinkingConfig is NOT the invalid argument`);
      }

      const status = err.response?.status;
      const transient = status === 503 || status === 429 ||
                        err.code === "ECONNRESET" || err.code === "ETIMEDOUT";
      if (transient && transientUsed < RETRY_DELAYS_MS.length) {
        logger.warn(`🎬 ${tag}: ${status || err.code} — retry in ${RETRY_DELAYS_MS[transientUsed]}ms`);
        await sleep(RETRY_DELAYS_MS[transientUsed]);
        transientUsed++;
        continue;
      }
      // FULL response body, not just err.message. A 400 from Gemini carries
      // its reason only in the body — err.message is the useless "Request
      // failed with status code 400". Measured 2026-08-02: gemini-3.5-flash-lite
      // failed on TRANSPORT, not on output, so the cheap-generation-bump
      // question stays open and the body is the only thing that can settle it.
      const body = (() => {
        try { return JSON.stringify(err.response?.data ?? null); }
        catch { return String(err.response?.data); }
      })();
      logger.warn(
        `🎬 ${tag}: call failed — model=${model} status=${status ?? err.code ?? "?"} ` +
        `error=${err.message} body=${String(body).slice(0, 3000)}`
      );
      return null;
    }
  }
}

// ─── Prompt 1 — the slide spec ──────────────────────────────────────────────

/**
 * The card grammar, as a FUNCTION of what this article and this configuration
 * make available. It was a constant until subject visuals landed; the two new
 * types must appear only when the prompt is asking for them, and `photo` only
 * when there is a photograph, so the text is no longer the same for every call.
 */
const cardGrammar = ({ visualsOn = false, hasPhoto = false } = {}) => `
"title"   — the opener. { "t":"title", "eyebrow":"SHORT LABEL", "lines":[["TEXT","white"],["TEXT","lime"]], "sub":"one line", "caption":"..." }
"stat"    — ONE dominant number. { "t":"stat", "eyebrow":"...", "value":70, "unit":"%", "lines":["short line","short line"], "hi":1, "source":"OUTLET NAME", "caption":"..." }
            "hi" is the index of the line to emphasise. "value" MUST be a number, not a string.
            !! On a "stat" card, "lines" is an array of PLAIN STRINGS. It is NOT an array of
               [text, colour] pairs — that form belongs to "title" and "turn" ONLY. Getting this
               wrong invalidates the card and it is dropped from the video.
            Worked example, copy this shape exactly:
              { "t":"stat", "eyebrow":"CABLE FAULTS", "value":70, "unit":"%",
                "lines":["of all faults", "are caused by anchors"], "hi":1,
                "source":"Reuters",
                "caption":"Seventy percent of cable faults are caused by ships dragging anchors." }
            CORRECT:   "lines":["of all faults", "are caused by anchors"]
            WRONG:     "lines":[["of all faults","white"], ["are caused by anchors","lime"]]
"diagram" — a chain or flow of 2-6 nodes. { "t":"diagram", "eyebrow":"...", "nodes":[["LABEL","sub"],["LABEL","sub"]], "marker":{"on":1,"label":"...","sub":"..."}, "caption":"..." }
            "marker.on" is the index of the node it points at.
            !! 2 to 6 nodes is a HARD LIMIT, not a guideline. The renderer draws six; a card
               with seven or more is DROPPED FROM THE VIDEO ENTIRELY. If a mechanism genuinely
               has more steps, split it across two "diagram" cards — do not compress it into
               one and do not let the tail run past six, because the caption describes the
               whole chain and a lost step becomes a caption about something not on screen.
"bars"    — a COMPARISON of 2 to 5 labelled quantities. { "t":"bars", "eyebrow":"...", "bars":[["label",70],["label",30]], "source":"OUTLET NAME", "caption":"..." }
            "bars" MUST contain AT LEAST 2 entries — a single number is never a "bars" card; use "stat" for a single number.
            !! AND AT MOST 5. This is a HARD LIMIT, not a guideline: the renderer draws five,
               and a card with six or more is DROPPED FROM THE VIDEO ENTIRELY. Choose the five
               entries that actually carry the comparison; a long tail of small values is not
               what makes the point anyway.
"turn"    — the pivot beat, where the obvious reading gives way to the real one.
            { "t":"turn", "eyebrow":"...", "lines":[["TEXT","white"],["TEXT","lime"]], "sub":"one line", "caption":"..." }
${visualsOn ? `"map"     — a GEOGRAPHIC subject, drawn from a country list. { "t":"map", "eyebrow":"...", "codes":["DZA","EGY"], "exception":"SWZ", "lines":[["TEXT","white"],["TEXT","lime"]], "caption":"..." }
            "codes" are ISO 3166-1 alpha-3, one per country the story covers. They are checked
            against a real atlas: a code that does not exist invalidates the card, so emit codes
            you are sure of and omit ones you are not. Do not invent codes to pad a set.
            "exception" is the ONE country the story EXCLUDES — the "all of them except this one"
            case. It must also appear in "codes". It is drawn dark and CALLED OUT with a label,
            because the excepted country is often a couple of pixels wide and it is usually the
            entire point of the story. Omit "exception" when there is no exception.
            You do not supply a projection, a colour or a position. The map is drawn by code.
${hasPhoto ? `"photo"   — a NAMED PERSON or a specific place: the article's own photograph. { "t":"photo", "eyebrow":"...", "subject":"...", "lines":[["TEXT","white"],["TEXT","lime"]], "caption":"..." }
            "subject" is REQUIRED and it is what makes this card checkable: a short noun phrase
            naming what the photograph should SHOW — "Aung San Suu Kyi", "the Port of Mombasa".
            Not a sentence, not the beat restated. The picture is the publisher's own and nobody
            downstream can see it, so this is the only statement of what it is expected to be.
            If you cannot say in a few words what the image ought to show, this story does not
            want a photo card — use a map, a data card, or type.
            You do NOT supply an image, a URL, a crop or a treatment. The photograph is the
            article's own and the presentation is a design decision made in code.
            Write the two lines as you would for a title card: short, declarative, upper case.
` : ""}` : ""}"kicker"  — the closer. { "t":"kicker", "top":"...", "bottom":"...", "sub":"...", "caption":"..." }
`.trim();

/**
 * THE PROMPT CONTAINS NO SLIDE COUNT. Not a target, not a ceiling, not a floor.
 *
 * Measured 2026-08-02, second live run: told to emit "AT LEAST 6 and AT MOST
 * N", all three articles returned EXACTLY 6 — the floor — with an identical
 * card mix each time, including a Trump/Iran story carrying 30 allowed
 * sources. The model does not weigh a stated range; it anchors on whichever
 * number is nearest and stops there. The first run anchored on the ceiling and
 * padded to it; the second anchored on the floor and starved to it. Both
 * failures have one cause — a number in the prompt.
 *
 * MIN_SLIDES and MAX_SLIDES survive as VALIDATION GATES ONLY, and the model
 * never learns they exist: the floor silently discards a spec too thin to
 * carry a video, the ceiling catches a runaway. Length is an OUTCOME of the
 * beat rubric in rule 7, never an instruction.
 *
 * Do not reintroduce a count here — not "aim for", not "roughly", not a
 * duration the model can divide into slides. That is the whole finding.
 */
export function buildSpecPrompt({ article, allowedSources = [], bodyText = null }) {
  // bodyText is the resolved source text (full-text fetch when available,
  // stored content otherwise). The slice is a safety ceiling, not the
  // constraint — videoFullText already caps at MAX_FULLTEXT_LEN.
  const body = String(bodyText ?? article.content ?? "");
  // THE PROMPT'S CARD LIST IS WHAT THE FLAG GATES. With subject visuals off the
  // model is never told `photo` or `map` exist, so it cannot ask for one and the
  // output is byte-identical to before the feature landed.
  //
  // A `photo` card also needs a photograph. The article either has one or it
  // does not, and that is knowable HERE — offering the card for an article with
  // no image would produce a card the renderer must then drop, which is a worse
  // failure than never offering it.
  const hasPhoto = Boolean(article.image_url);
  // RULE 3'S SECTION PARAGRAPHS DESCRIBE A SHAPE THAT IS NOT ALWAYS THERE
  // (DrJ, 2026-08-15). They explain how to attribute a figure across "PRIMARY
  // SOURCE" and "ADDITIONAL COVERAGE" blocks — and nothing in this codebase has
  // ever built those: resolveVideoSourceText fetches ONE article, and the sole
  // caller passes a single publisher. That was ~1,020 characters of instruction
  // about ATTRIBUTION, the highest-stakes topic in the prompt, describing a
  // structure the model could not see.
  //
  // Kept rather than deleted, and made conditional on the same fact that would
  // produce the sections. The reasoning in them is worth having the day a
  // multi-outlet bundle exists — the event graph already links the other
  // outlets covering a story — and tying both to one condition means the
  // instruction can never again describe material that is not present.
  const multiSource = allowedSources.length > 1;
  const visualsOn = subjectVisualsEnabled();
  const emittable = MODEL_EMITTABLE.filter(t => {
    if (t === "sources") return false;
    if (!SUBJECT_VISUAL_TYPES.includes(t)) return true;
    if (!visualsOn) return false;
    return t === "photo" ? hasPhoto : true;
  });
  const sourceText = [
    `HEADLINE: ${article.title || ""}`,
    article.description ? `SUMMARY: ${article.description}` : "",
    `LEAD PUBLISHER: ${article.source_name || "unknown"}`,
    article.category ? `CATEGORY: ${article.category}` : "",
    body ? `\n${body.slice(0, SPEC_BODY_MAX_CHARS)}` : "",
  ].filter(Boolean).join("\n");

  return `You are a video producer for ScoopFeeds, a news-intelligence product. You do not write prose. You emit a SLIDE SPEC as JSON, which a deterministic renderer turns into a video.

SOURCE MATERIAL — the ONLY information you may use:
"""
${sourceText}
"""

OUTLETS THAT ACTUALLY COVERED THIS STORY — the only names you may ever put in a "source" field:
${allowedSources.length ? allowedSources.map(s => `  - ${s}`).join("\n") : "  (none — you may therefore emit NO stat and NO bars cards at all)"}

CARD TYPES — a CLOSED SET. Emitting any type not on this list makes the entire spec invalid and the story is dropped:
${emittable.map(t => `  ${t}`).join("\n")}

${visualsOn ? `
SUBJECT VISUALS — WHAT THE STORY IS ABOUT DECIDES WHAT IS ON SCREEN.
This is a rule about the SUBJECT, not about the beat. Choose from the subject, in this order:

  a GEOGRAPHIC subject (a country, a region, a set of places)  -> "map"
  a NAMED PERSON or a specific place                            -> "photo"
  an ABSTRACT quantity, comparison or mechanism                 -> "stat", "bars", "diagram"
  nothing concrete to show                                      -> "title", "turn", "kicker"

WHY THIS RULE EXISTS, stated plainly so you can apply it rather than pattern-match it: a story about a TARIFF SYSTEM once ran with a publisher photograph of two people, because the article happened to carry one. The subject was a system covering a continent; the picture showed neither. A map would have shown the subject exactly. Ask what the story is ABOUT, then pick — never pick a card because an image happens to exist.

AT MOST ONE subject-visual card per video. It is the establishing shot, and it belongs early — normally the second or third card. Two of them is a slideshow.
${hasPhoto ? "" : "This article has NO photograph, so \"photo\" is not on your list of card types. Do not ask for one."}
` : ""}CARD GRAMMAR — field names and types are exact:
${cardGrammar({ visualsOn, hasPhoto })}

HARD RULES — violating any of these makes the output unusable:

1. GROUNDING. Every claim must appear in the source material above. Do not add context you happen to know. Do not infer causes, motives or consequences. Do not predict outcomes. If the source does not say why something happened, the spec does not say why either.

2. RESTATE, NEVER REPRODUCE. Every beat and every caption must be written in your OWN WORDS. Do not copy runs of the article's wording. Do not follow the article's ordering or section structure — decide the order the story is best told in and use that. Two specific limits:
   - No verbatim run longer than a short fragment, and any fragment you do carry over must be a genuine quotation that belongs to a named speaker or document.
   - The ONE deliberate exception is the "evidence" field on a beat, which is SUPPOSED to be a short verbatim phrase from the source — that is its job, it is never spoken aloud, and it never appears on screen.
   Grounding (rule 1) constrains WHAT you may say; this rule constrains HOW you may say it. Being faithful to the facts does not license reproducing the prose.

3. NUMBERS NEED A REAL SOURCE. Every "stat" and every "bars" card MUST carry a "source" naming one of the outlets listed above, AND the figure itself must appear in the source material. If you cannot attribute a number to one of those outlets, DO NOT EMIT THE CARD. Do not guess an outlet. Do not write "reports" or "analysts" or the story's subject as the source. A dropped card costs nothing; an invented attribution is unrecoverable.

   THE OUTLET IS CREDITED ALOUD ONCE, AND IT IS ALREADY DONE. A card near the start of the video names the outlet in its narration — you do not write that card, and you must not repeat its credit. So captions on your figure cards carry NO verbal attribution: write "Seventy percent of faults involve anchors", NOT "The Guardian reports that seventy percent of faults involve anchors". The "source" field still names the outlet on every figure card, and that credit is printed on screen; it is the spoken repetition that is unwanted. Hearing the same masthead four times in ninety seconds reads as a disclaimer, not as journalism.

${multiSource ? `   THE ONE EXCEPTION: if a figure comes from a DIFFERENT outlet than the rest of the video, that caption must name it, because a source the viewer has not heard credited is a source that has not been credited.

   THE SOURCE MATERIAL IS ATTRIBUTED. It is divided into labelled sections — one "PRIMARY SOURCE — <outlet>" block and, when other outlets covered the same story, one or more "ADDITIONAL COVERAGE — <outlet>" blocks. Take a figure from whichever section actually contains it, and name THAT outlet in the "source" field. Do not attribute a figure to the lead publisher because it is listed first. Where two outlets report the same figure, either is correct.

   Sections cover ONE story from different newsrooms, so treat them as one body of reporting, not as separate stories: a mechanism explained only in the third section is as usable as one in the first. Where outlets disagree on a number, prefer the one more outlets agree on, and if they cannot be reconciled, drop the card rather than picking a side.` : ""}

4. NO "attribution" CARD. You must never emit a card with "t":"attribution". That card names the outlet, headline and date of the reporting this video is built on, and it is built from the database, not written. A fabricated byline is the worst thing this pipeline could put on screen. If you emit one, the card is discarded.

5. CAPTION IS THE NARRATION. Every card MUST have a "caption": the exact sentence spoken over that slide. It is both the voiceover line and the burned-in subtitle, so they can never drift apart. No markdown, no brackets, no quotation marks, no emoji, no symbols. Write "percent" not "%", and write numbers the way a newsreader would say them.

5b. WRITE IT TO BE SAID, NOT TO BE READ. This is the difference between a sentence that works on a page and one that works in an ear, and it is not a matter of degree — the two are built differently. A caption is heard once, at speed, with no way to go back:

    - USE CONTRACTIONS. "It is not" is written; "it's not" is spoken.
    - ONE IDEA PER CLAUSE. A sentence carrying three subordinate clauses is
      readable and unspeakable. Break it.
    - VARY THE LENGTH DELIBERATELY. A long sentence, then a short one. Uniform
      sentence length is the single thing that makes narration sound automated.
    - FRAGMENTS ARE ALLOWED, sparingly, where speech would use one. "That was
      the plan." is a sentence in the ear.
    - LEAD WITH THE SUBJECT DOING SOMETHING, not with a nominalised summary.
      "A group of firms has committed to construction of" is a report about a
      sentence; "these firms are spending" is the thing itself.

    Three worked examples. The first version of each is grammatical, accurate, and wrong:

    WRITTEN: "A group of major Japanese carriers has begun trialling humanoid robots in airport ground operations amid chronic labour shortages."
    SPOKEN:  "Haneda airport cannot find enough staff. So Japan Airlines is trying something else: humanoid robots, working the ground crew shift alongside people."

    WRITTEN: "Myanmar's former leader Aung San Suu Kyi has been moved from prison to house arrest, according to state media, after being detained since the military coup in 2021."
    SPOKEN:  "She won a Nobel Prize, then her own army took the country back. She has been out of sight four years. Now state media says she is under house arrest."

    WRITTEN: "China will scrap tariffs for all African countries from Friday, except Eswatini, which maintains ties with Taiwan."
    SPOKEN:  "From Friday, China drops tariffs on almost every country in Africa. One is left out, and the reason is Taiwan."

    Note what did NOT change: every figure, every hedge, every attribution survives. Spoken register is a change of SENTENCE CONSTRUCTION, never a licence to lose precision, drop a qualifier, or round a number.

6. THE SLIDE TEXT IS NOT THE CAPTION. On-screen text is short and declarative — a few words, upper case where the grammar shows upper case. The caption is the sentence that explains it. They reinforce each other; they never repeat each other word for word.

7. ACCENT. Within any single card, AT MOST ONE line may have the colour "lime". Every other line is "white". This is a brand invariant, not a preference.

8. ENUMERATE THE BEATS — AS OUTPUT, BEFORE THE SLIDES. Your JSON starts with a "beats" array. A beat is ONE CONCRETE INSTANCE of something the source establishes, never a category:
     - "figure"      — one specific number you can attribute to one of the outlets listed above and find in the source material
     - "mechanism"   — one specific explanation of how something works or came about
     - "turn"        — one point where the obvious reading of the story gives way to a truer one
     - "consequence" — one specific thing that follows, as the source states it
   Each beat is an object: { "kind": "...", "beat": "one sentence stating it", "evidence": "the short verbatim phrase from the source material that grounds it" }.
   These are KINDS, not a checklist. A rich story may have six figures and three consequences; list every instance separately. Two sentences restating the same fact are ONE beat. A quote that adds no new fact is not a beat.

   THEN emit exactly ONE CARD PER BEAT, choosing the card type that fits, wrapped by the opening "title" card and the closing "kicker" card. Do not merge beats to be brief, and do not split or invent beats to be long — how many beats the source holds is a discovery you make, never a decision.

   THE TITLE AND THE KICKER CARRY NO BEAT AND ARE NOT COUNTED. "One card per beat" governs the cards BETWEEN them: every beat you enumerate gets exactly one content card, and no content card exists without a beat. The two wrappers sit outside that arithmetic entirely.

   A NOTE ON THE WORD "CONSEQUENCE", because it names two different things and confusing them is the commonest way this spec fails. A "consequence" BEAT is something the SOURCE STATES follows — it is in the article, it has evidence, and like every other beat it gets its own content card. The CONSEQUENCE the closer delivers (rule 16b) is DERIVED: what this means for someone outside the story, which the source never asserts and which therefore is NOT a beat and gets no content card. If you enumerate the closer's line as a beat, you will have one more beat than you have content cards and the spec is rejected.

   WORKED EXAMPLE of enumeration — a rich single-source story about subsea internet cables. This example is ILLUSTRATIVE ONLY: never reuse its facts, figures, or wording.
   "beats": [
     { "kind": "figure",      "beat": "Nearly all intercontinental data travels by subsea cable.",        "evidence": "99 percent of intercontinental traffic" },
     { "kind": "figure",      "beat": "The whole network is roughly five hundred active cables.",         "evidence": "roughly 500 active cables" },
     { "kind": "mechanism",   "beat": "Data crosses oceans through fibre bundles laid on the seabed.",    "evidence": "fibre bundles laid directly on the seabed" },
     { "kind": "figure",      "beat": "Anchors and fishing gear cause most recorded faults.",             "evidence": "70 percent of recorded faults" },
     { "kind": "mechanism",   "beat": "Dragged anchors sever cables in shallow approaches to shore.",     "evidence": "anchors dragged near landing stations" },
     { "kind": "figure",      "beat": "The network suffers about two hundred faults a year.",             "evidence": "about 200 faults a year" },
     { "kind": "consequence", "beat": "Countries served by a single cable can lose connectivity at once.","evidence": "one cable serves the entire country" },
     { "kind": "turn",        "beat": "The real threat is mundane accidents, not sabotage.",              "evidence": "most damage is accidental" },
     { "kind": "mechanism",   "beat": "Repairs need specialist ships that grapple the cable up.",         "evidence": "grappled the cable to the surface" },
     { "kind": "figure",      "beat": "A mid-ocean repair takes about a month.",                          "evidence": "30 days on average" },
     { "kind": "figure",      "beat": "The global repair fleet is about sixty ships, and it is ageing.",  "evidence": "about 60 cable ships" },
     { "kind": "consequence", "beat": "Operators are rerouting traffic and burying new cable deeper.",    "evidence": "buried deeper in trenches" }
   ]
   Twelve beats, because that source established twelve distinct things — so that spec carries twelve content cards plus its "title" and "kicker". A thinner source might establish four; then you list four and emit four. The enumeration decides.

   AND HERE IS THAT SPEC'S KICKER, so you can see where it comes from:
     { "t":"kicker", "top":"ONE ANCHOR", "bottom":"THIRTEEN COUNTRIES",
       "caption":"The next one will not be sabotage either. It will be a Tuesday, and a ship that did not know what was under it." }
   NOTE WHAT IS NOT THERE: that closer is nowhere in the twelve beats. It is derived — the meaning of the twelve taken together — which is exactly why it is not enumerated and not counted. The list above ends on a "consequence" BEAT ("operators are rerouting traffic"), and that beat still gets its own content card. The closer is a different thing that happens to share the word.

9. STRUCTURE AND MIX. The FIRST card must be "title" and the LAST card must be "kicker". In between, VARY THE CARD TYPES:
   - No card type may take more than about a third of the cards. A wall of number cards is a spreadsheet read aloud, not a video.
   - Never place more than two cards of the same type back to back.
   - "turn" should appear once, near the point where the story's obvious reading gives way to its real one.
   Cards that break these limits are discarded from the video, so a monotonous spec loses most of itself. If a beat could be carried by more than one card type, prefer the type you have used least.

   AT LEAST ONE "diagram" OR "turn" IS REQUIRED. These are the cards that add something the source did not already say in that form — a mechanism drawn as a chain, or the point where the obvious reading gives way. A spec of only headline and figures is a restatement of someone else's article with the numbers pulled out; it is rejected outright. This is the part of the video that is ours.

10. TONE — STANCE, NOT REGISTER. These are two different things and only one of them is neutral.

    The STANCE is neutral and stays neutral: no editorialising, no outrage, no "you won't believe", no manufactured stakes. Interest comes from a specific fact being genuinely interesting, never from sensational phrasing. Preserve the source's hedging: if it says "reportedly" or "officials say", keep that attribution.

    The REGISTER is SPOKEN, per 5b. A wire-service sentence is a neutral stance in a written register, and reading one aloud is what makes narration sound like a machine reciting. Keep the detachment; lose the paperwork.

10b. QUESTIONS ARE ALLOWED, AND THEY ARE THE STRONGEST HOOK YOU HAVE — with one condition. A question is only clickbait when the ANSWER IS WITHHELD. "So who actually pays for this?" followed immediately by who pays is legitimate journalism and the best opening shape available. Leaving it hanging is what makes it cheap.

    So: ask questions on the opener and on any middle beat, PROVIDED the very next beat answers the question you just asked. A question you do not answer is a promise you broke.

    THE ONE PLACE THIS IS FORBIDDEN IS THE CLOSER. Nothing follows the last card, so a question there can never be answered — it is a hanging question by construction, whatever its wording. A caption on the final card that ends with a question mark is REJECTED and you will be asked to write it again. End the closer on the forward implication instead: the consequence that is now in motion, stated as a fact.

10c. NEVER ASSERT WHY SOMEONE DID SOMETHING. Report what happened; attribute what anyone claims about the reason. This is the single hardest line in these rules and it is CHECKED, not trusted — a caption that ascribes intent, purpose or motive without saying whose claim it is will be rejected and you will be asked to write it again.

    The trap is that spoken register makes this easy to do by accident. Compressing "the protection has blocked three attempts to serve papers" into something livelier reaches for "they are using their security to dodge the lawsuit" — and that second sentence asserts a purpose the source never established, about real people, under a real masthead. It is not a stylistic upgrade; it is a different and unsupported claim.

    REFUSED:  The family can use their taxpayer-funded security to keep the lawsuit at bay.
    ALLOWED:  The plaintiffs say the detail is being used to keep the lawsuit at bay.
    ALLOWED:  The protection has blocked three attempts to serve papers.

    The third is what the source said and it is the stronger sentence.

    THIS APPLIES TO ON-SCREEN TYPE TOO, and the display lines are where it matters most. Two words in the largest type on the card carry more framing per word than a whole caption does, and they have no sentence around them to qualify anything. Every string a viewer reads or hears is checked, not just the spoken one.

    The same goes for INTENSIFIERS AND ABSOLUTES. If the article does not say something is indefinite, unprecedented, sweeping, devastating, massive, staggering or shocking, then neither do you — those words are checked against the source and a spec that adds one is rejected. Use the article's own word or use none.

    THE COMMONEST WAY THAT HAPPENS, so watch for it specifically: A LARGE FIGURE NEEDS NO ADJECTIVE. The pull toward an intensifier is strongest exactly where it is least needed — next to a big number — because the number already carries the weight and the adjective feels like it is helping.

      NO:  "The stakes are massive."          "A staggering ten billion dollars."
      YES: "Ten billion dollars."             "Ten billion dollars, on one ruling."

    "Ten billion dollars" IS the stakes. "The stakes are massive" adds nothing the number did not already say, and it trades a fact the source gave you for a judgement it did not. If a figure feels like it needs help, the help it needs is a comparison the source supports — what it is a share of, what it was last year, who pays it — never an adjective.

    One thing the checks CANNOT see, so it is on you: a metaphor that characterises. "THE SECRET SERVICE SHIELD" contains no motive verb and no intensifier, and it still reframes a protective detail as an instrument of obstruction. Compressing for display type is not licence to editorialise — name the thing the article names. When you are tempted to explain a motive, state the obstacle, the sequence or the consequence instead — those are facts, they are usually more concrete, and they need no one's permission.

17. CAPTION LENGTH IS A HARD WRITING CONSTRAINT AT BOTH ENDS: keep every caption at or under ${CAPTION_MAX_CHARS} characters, and at or above ${CAPTION_MIN_CHARS}. The floor is not a style note — the slide is held for exactly as long as its narration, and a caption shorter than that loses one of the slide's reveals to the collapse rule. A one-line fragment is a beat you wrote and the viewer never sees. If a beat genuinely takes fewer words than that, it belongs joined to its neighbour, not standing alone. This is not a style preference — it is the measured width of two lines of burned-in caption at the size they are rendered. A longer caption wraps to a third line and sits higher than the band is designed for. Write shorter sentences; do not compress by deleting the source credit or the figure.

RETENTION STRUCTURE — how the video HOLDS someone, not just what it contains. These decide whether anyone is still watching at ten seconds.

11. THE TITLE CAPTION IS A COLD OPEN. HARD RULE — the spec is REJECTED if it restates the headline.

    The viewer has already read the headline: it is the thumbnail, it is the title of the video, it is why they clicked. Saying it again out loud is the first thing they hear, and it tells them they already know this. The opening caption must instead do ONE of three things:
      - ask the QUESTION the story answers,
      - name the STAKE — what is at risk, who pays, what breaks,
      - state a concrete ANOMALY — the detail that does not fit, the number that should not be possible.
    Whichever you choose, it must make the next sixty seconds feel necessary.

    This is checked mechanically against the headline's own words. A caption that reuses most of the headline's distinctive words is rejected and you will be asked to write it again.

    WORKED EXAMPLES — ILLUSTRATIVE ONLY. Never reuse these facts, figures or wording; the shape is what matters.

    Headline: "Undersea cable damage disrupts internet across West Africa"
      WRONG:   "Damage to undersea cables has disrupted internet access across West Africa."   (the headline, spoken)
      RIGHT:   "Thirteen countries lost the internet on the same afternoon. One ship did it."  (anomaly)

    Headline: "Regulator fines airline $40m over refund delays"
      WRONG:   "The regulator has fined the airline forty million dollars over refund delays." (the headline, spoken)
      RIGHT:   "Passengers waited nine months for money the airline already had."              (stake)

    Headline: "Study finds new drug slows kidney disease progression"
      WRONG:   "A new study has found that the drug slows the progression of kidney disease."  (the headline, spoken)
      RIGHT:   "What if the pill for one disease turned out to work on another?"               (question)

    Notice what the RIGHT versions have in common: none of them could be pasted onto a different article about the same subject, and none of them can be guessed from the headline alone.

12. THE FIRST CONTENT CARD IS THE STRONGEST BEAT — explicitly NOT the article's own ordering. News articles open with context because print readers scan; video viewers leave. Look at the beats you enumerated, pick the one that would make someone stay, and open with it. Chronology can follow.

13. PAY OFF THE THUMBNAIL FIGURE IN THE FIRST TWO CONTENT CARDS. If the packaging promises a number, a viewer who does not meet it almost immediately concludes they were baited, and leaves.

14. ONE STAKES BEAT IN THE FIRST THREE CONTENT CARDS — a consequence or a turn. Who is affected, what breaks, what this costs. Facts without stakes are trivia, and trivia does not hold attention past the novelty.

15. CAPTIONS BRIDGE. Each caption ends with a pull into the next beat: an unanswered question, a tension, a "but", a consequence not yet named. Do not end on a closed, self-contained statement and then start the next one cold.
    FLAT:    "The cable carries 40% of the region's traffic."
    BRIDGED: "The cable carries 40% of the region's traffic — and it had no backup."

15b. EVERY CAPTION AFTER THE FIRST MUST RELATE TO THE ONE BEFORE IT. Read in sequence, your captions must be a story, not a list of correct facts. Each beat has to EXTEND the one before it, COMPLICATE it, or CONTRADICT it — the viewer should never reach a caption and wonder why this fact follows that one. If two adjacent captions could be swapped without the sequence reading any differently, the connection you needed is missing.

    The relationship must come from the FACTS THEMSELVES — this number explains that mechanism, this consequence follows from that figure, this finding undercuts the assumption before it. It does not come from a connecting phrase bolted onto the front.

    DO NOT ADOPT A HOUSE OPENER. There is no approved list of transition words here, and you must not invent one for yourself: five captions that all begin the same way are worse than five that begin flatly, because the formula becomes the only thing the viewer hears. Vary how each caption starts. If you notice yourself reaching for the same construction a third time, the beats are ordered wrongly — reorder them so the connections are real, rather than papering over the gap with a phrase.

    LIST (each fact true, no sequence):
      "The cable carries 40 percent of the region's traffic."
      "Repairs take about 30 days."
      "There are 60 repair ships worldwide."
    SEQUENCE (same three facts, each one earning the next):
      "The cable carries 40 percent of the region's traffic, and nothing else was laid alongside it."
      "So a single break takes about thirty days to mend — thirty days of a region running on what is left."
      "That timeline rests on sixty ageing ships for the whole planet."

16. THE KICKER NEVER WRAPS UP. HARD RULE — the spec is REJECTED if broken. Do not summarise, do not restate what was already said, do not use the register of a conclusion. Never write: "in conclusion", "in summary", "to sum up", "overall", "ultimately", "at the end of the day", "the takeaway", "there you have it", "as we have seen", "the bottom line", "to recap". End on the FORWARD implication or an OPEN QUESTION — what happens next, what is still unknown, what this makes possible or inevitable.
    WRONG: "Ultimately, the takeaway is that infrastructure is fragile."
    RIGHT: "Nobody has said who will pay to bury the next one."

16b. THE KICKER MUST ANSWER "SO WHAT?". Avoiding the summary VOCABULARY above is not enough — a closer that simply says the headline again in different words, or circles back to your own opening caption, ends the video exactly where it began. That is checked mechanically against BOTH the headline and your opening caption, and the spec is REJECTED if the closer restates either one.

    The closer must give the viewer something they did not have at the start. One of:
      - the IMPLICATION — what this means for someone who is not in the story,
      - the CONSEQUENCE — what is now set in motion, or foreclosed,
      - WHAT TO WATCH — the decision, date, or number that will settle it.

    ALL THREE ARE DERIVED, AND NONE OF THEM IS A BEAT. This is the thing the closer is FOR: it says something the article did not, drawn from what the article established. So it is not in your "beats" array, it gets no content card, and the kicker is not counted against the one-card-per-beat arithmetic in rule 8.
    Do not confuse this CONSEQUENCE with rule 8's "consequence" beat kind. That one is a consequence the SOURCE STATES, it carries evidence, and it gets its own content card like every other beat. This one is yours.

    WORKED EXAMPLES — ILLUSTRATIVE ONLY. Never reuse these facts or wording.

    Headline: "Undersea cable damage disrupts internet across West Africa"
    Opening:  "Thirteen countries lost the internet on the same afternoon. One ship did it."
      WRONG:  "Undersea cable damage has cut off internet across West Africa."     (the headline again)
      WRONG:  "One ship took thirteen countries offline in an afternoon."          (your own cold open again)
      RIGHT:  "The next repair ship is three weeks out, and nobody has said who pays for the wait."

    Headline: "Regulator fines airline $40m over refund delays"
    Opening:  "Passengers waited nine months for money the airline already had."
      WRONG:  "The airline has been fined forty million dollars for refund delays." (the headline again)
      RIGHT:  "The fine is smaller than the interest earned on the money it held."

Return ONLY a JSON object, no markdown fence, with exactly this shape — "beats" first, then "slides":

{
  "beats":  [ { "kind": "figure", "beat": "...", "evidence": "..." }, ... ],
  "slides": [ ...cards... ]
}`;
}

// ─── Prompt 2 — packaging ───────────────────────────────────────────────────

export function buildPackagingPrompt({ spec, article }) {
  const script = (spec.slides || [])
    .map((c, i) => `${i + 1}. [${c.t}] ${c.caption}`)
    .join("\n");

  const figures = [];
  for (const c of spec.slides || []) {
    if (c.t === "stat") figures.push(`${c.value}${c.unit || ""} (${c.source})`);
    if (c.t === "bars") for (const b of c.bars || []) figures.push(`${b[0]}: ${b[1]} (${c.source})`);
  }

  return `You are a packaging editor for ScoopFeeds, a news channel on YouTube. The script below is FINISHED and will not change. Your only job is to find the hook that makes someone click it — and that the video then actually delivers.

THE FINISHED SCRIPT, one line per slide:
"""
${script}
"""

FIGURES THE VIDEO ACTUALLY PAYS OFF (the only numbers you may use):
${figures.length ? figures.map(f => `  - ${f}`).join("\n") : "  (none — use no numbers at all)"}

STORY: ${article.title || ""}${article.category ? ` · ${article.category}` : ""}

TITLES — emit exactly 3, each testing a DIFFERENT angle, not different wording of one angle. Available angles: ${THUMBNAIL_ANGLES.join(", ")}.
  - Maximum 60 characters. Search and mobile truncate around there, so the hook must survive truncation.
  - Front-load the concrete noun or the number. Never open with "How", "Why", or the brand name.
  - THE HARD ONE: the title must be a claim the video actually pays off. Do not use a number that is not in the list above. Do not promise a revelation the script does not deliver. A curiosity gap the script leaves open is a trust cost this channel cannot afford.

THUMBNAILS — emit exactly 3, one per title.
  - "hook": ONE to THREE words. Never a sentence. It has to stay legible at 168 pixels wide.
  - "accent": exactly one word taken FROM the hook — the word that gets the accent colour.
  - "kicker": a short supporting line, up to about five words.
  - "angle": one of ${THUMBNAIL_ANGLES.join(", ")}.
  - The thumbnail must NOT restate its title. Title and thumbnail are two halves of one promise, not the same message printed twice.

DESCRIPTION HOOK — one or two sentences. These are the lines that show above the fold and in search, so lead with the hook and the primary keyword. No links, no brand boilerplate; those are appended later.

TAGS — entities and topic terms actually present in the script above. No invented keywords, no generic filler like "news" or "viral". 500 characters total across all tags.

IMAGE QUERY — 2 to 4 CONCRETE NOUNS naming a physical thing that could be photographed, for a stock-photo search. Strip verbs, adjectives and abstractions. If the story has no photographable physical subject, return an empty string.

Return ONLY a JSON object, no markdown fence, with exactly this shape:

{
  "titles": ["...", "...", "..."],
  "thumbnails": [
    { "hook": "...", "kicker": "...", "accent": "...", "angle": "..." },
    { "hook": "...", "kicker": "...", "accent": "...", "angle": "..." },
    { "hook": "...", "kicker": "...", "accent": "...", "angle": "..." }
  ],
  "description_hook": "...",
  "tags": ["...", "..."],
  "image_query": "..."
}`;
}

/** A spec-level error meaning "the article was too thin", which is not retried. */
function isThinnessError(e) {
  return /too thin for a video/.test(e);
}

/**
 * Strip slide counts out of anything the model will read. The retry prompt is
 * still a prompt: a note saying "only 4 slides remain (< 6)" hands the model
 * the exact anchor rule 7 exists to withhold, and it would pad to that number
 * on the second attempt just as it starved to it on the first.
 *
 * Card-level reasons ("3 consecutive stat cards") are left intact — those are
 * adjacency and type facts, not a length instruction.
 */
function stripCounts(error) {
  return String(error)
    .replace(/only \d+ slides remain[^—]*—?\s*/i, "")
    .replace(/too many slides: \d+ > \d+/i, "you emitted far more cards than the source establishes — enumerate the beats again and emit one card per beat")
    .replace(/\((\d+)\/(\d+)\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Corrective note appended to the retry prompt. States what failed in the
 * model's own terms — every spec-level failure is something it can act on
 * (emit the opener, stop inventing attributions, stop malforming cards) —
 * with every slide count removed first.
 */
function buildCorrectionNote(v) {
  const lines = v.errors.map(e => stripCounts(e)).filter(Boolean).map(e => `  - ${e}`);
  const byReason = {};
  for (const d of v.dropped) {
    const key = `${d.kind}: ${String(d.reason).split(";")[0]}`;
    byReason[key] = (byReason[key] || 0) + 1;
  }
  const dropLines = Object.entries(byReason).map(([r, n]) => `  - ${n}x ${r}`);
  return `

YOUR PREVIOUS ATTEMPT WAS REJECTED. Fix these and emit a complete new spec:
${lines.join("\n")}
${dropLines.length ? `\nCards discarded from that attempt:\n${dropLines.join("\n")}` : ""}

Re-read the CARD GRAMMAR above and match the field shapes exactly. Emit the FULL spec again — do not emit a patch or only the corrected cards. Re-enumerate the story's beats and emit one card per beat; do not aim for any particular number of cards.`;
}

/**
 * Inject the title card's badge, date and verbal credit into a PARSED spec,
 * before validation. Returns a new object; leaves a spec with no title alone
 * so the missing-opener rule reports the real cause.
 */
function decorateParsedSpec(parsed, article, attribution) {
  if (!parsed || !Array.isArray(parsed.slides)) return parsed;
  return {
    ...parsed,
    slides: parsed.slides.map(c =>
      c && c.t === "title" ? (decorateTitleCard(c, article, attribution) || c) : c
    ),
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Article → validated slide spec.
 *
 * RETURNS A RESULT OBJECT, NOT null-or-spec. A rejected attempt still SPENT —
 * one Gemini call, two when the regeneration retry fires — and returning null
 * threw that number away, so a published video could not be billed including
 * the articles discarded before it. `{ ok, spec, costUsd, reason, attempts }`
 * makes the loop able to say "this video cost $X across 4 attempts".
 *
 * Never throws, and NEVER RETURNS null — every exit is `{ ok, spec, costUsd,
 * reason, attempts }`. The caller reads `.costUsd` before it reads `.ok`, so a
 * single null exit is a TypeError that aborts the entire cycle rather than
 * skipping one article. A source-walking test pins this.
 *
 * @param {object} article
 * @param {object} opts
 * @param {string[]} opts.allowedSources — outlets that covered this story
 * @param {number}  [opts.targetSeconds=180] — recorded in meta only; the model
 *        never sees it, because a duration is a slide count once divided.
 * @param {number}  [opts.slideCeiling] — VALIDATION ceiling, never shown to the
 *        model. Overrides MAX_SLIDES for the runaway check.
 * @param {string}  [opts.bodyText] — pre-resolved source text. Supply it to skip
 *        the fetch (tests always do, so no test touches the network).
 * @param {boolean} [opts.fetchFullText=true] — fetch the article URL once at
 *        generation time for uncapped text. ON by default: the 5,000-char
 *        stored cap is the measured constraint on beat count, and leaving this
 *        to the caller would mean Section 6 could silently omit it and inherit
 *        the same flat specs.
 *
 * ONE STORY PER VIDEO (§3b). Sibling coverage does NOT enter the prompt — not
 * behind a flag, not by default. The experiment settled it: +13,488 chars from
 * 8 outlets produced Δ beats 0.00. Breadth was never the constraint, and §3b's
 * copyright reasoning makes the same point from the other side — source count
 * is not the variable, how much of ONE publisher's expression you reproduce is.
 * The Phase-2 use for siblings is VERIFICATION (does the lead figure appear in
 * a second outlet before publish), which reads them without ever prompting on
 * them.
 */
export async function writeVideoSpec(article, {
  allowedSources = [],
  targetSeconds = 180,
  slideCeiling = null,
  bodyText = null,
  fetchFullText = true,
  // Resolved once by the caller and passed in so the credit on the card, the
  // SOURCE: line and the validator are the same string. Resolved here if
  // absent, which is the same answer by the same function.
  attribution = null,
} = {}) {
  /**
   * `spec` stays null on every rejection — a rejected spec must never be
   * mistaken for a usable one by a caller reading `.spec`.
   *
   * `rejectedSpec` carries what the model actually produced, for inspection
   * ONLY. Until now a rejected spec was unreadable: the reason said what failed
   * and nothing said what was emitted, so diagnosing the beats/cards mismatch
   * meant reasoning from rule text rather than reading four specs. DrJ:
   * "a rejected spec being unreadable is a real gap and it'll pay for itself on
   * the next one of these."
   *
   * Nothing in the pipeline reads it — scripts/spec-dry-run.mjs prints it.
   */
  const reject = (reason, costUsd = 0, attempts = 0, rejectedSpec = null) =>
    ({ ok: false, spec: null, rejectedSpec, costUsd, reason, attempts });
  if (!isVideoSpecEnabled()) return reject("VIDEO_SPEC_ENABLED not set");
  if (!article?.title) return reject("article has no title");

  const started = Date.now();
  try {
    // ONE request, for the one article already selected, discarded after use.
    // Never fatal: a failed fetch falls back to stored content and the video
    // still ships, shorter.
    let resolved = { text: String(bodyText ?? article.content ?? ""), chars: 0, origin: bodyText ? "supplied" : "stored", reason: null };
    resolved.chars = resolved.text.length;
    if (!bodyText && fetchFullText) {
      const { resolveVideoSourceText } = await import("./videoFullText.js");
      resolved = await resolveVideoSourceText(article);
    }

    // Grounding screens against the SAME text the model was given. Screening
    // against the stored 5,000 chars while prompting with 24,000 would drop
    // every correctly-sourced figure drawn from the part it could not see.
    const sourceText = `${article.title || ""} ${article.description || ""} ${resolved.text}`;
    const basePrompt = buildSpecPrompt({ article, allowedSources, bodyText: resolved.text });
    // ONE resolved publisher, and it feeds BOTH the injected credit and the
    // check for it. preCreditedSources was previously accepted from the caller
    // and then never destructured — it reached nothing, so validateSpec always
    // ran with an empty list and every first figure card had to credit itself.
    // Deriving it here from the same attribution that decorates the card makes
    // the two impossible to disagree.
    const credit = attribution || resolveAttribution(article);
    const validateOpts = {
      allowedSources, sourceText,
      preCreditedSources: [credit?.publisher].filter(Boolean),
      // The arc checks measure the captions against the headline the viewer has
      // already read. The RAW title, not the decorated one — decorateTitleCard
      // injects the outlet and date, and folding those in would make every
      // caption look less like the headline than it is.
      headline: String(article?.title || ""),
      ...(slideCeiling ? { maxSlides: slideCeiling } : {}),
    };

    // ONE regeneration retry on a SPEC-LEVEL rejection. A spec costs well under
    // a cent; discarding an otherwise-good story because the model forgot a
    // kicker card is a worse trade than paying for a second attempt. The retry
    // is told what failed — a blind retry re-rolls the same dice, and the
    // failures here (missing opener, drop rate, sourcing overreach) are all
    // things the model can act on.
    let result = null, v = null, spentUsd = 0, attempts = 0;
    let prompt = basePrompt;

    for (attempts = 1; attempts <= 2; attempts++) {
      result = await callModel(prompt, {
        articleId: article.id, tag: "videoSpec", model: SPEC_MODEL, maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
      // A transport/JSON failure is already logged; its spend is unknowable
      // (the call never returned usage), which is itself worth reporting.
      if (!result) return reject("model call failed (see the rejection line)", spentUsd, attempts);
      spentUsd += result.cost;

      // DECORATE BEFORE VALIDATING. This ran the other way round and cost a
      // live video its figure cards: stat@1 and bars@4 were dropped for "first
      // use of Yahoo Finance carries no verbal credit" on a spec whose title
      // caption receives exactly that credit — from decoration that had not
      // happened yet. The §3b/3 title check needs the injected credit to be
      // present, and the per-figure fallback must only fire for a SECOND,
      // genuinely uncredited source, which is its actual purpose.
      result.parsed = decorateParsedSpec(result.parsed, article, credit);

      v = validateSpec(result.parsed, validateOpts);
      if (v.ok) break;

      // A spec that came back TOO THIN is not retried. The article genuinely
      // did not carry enough beats, and the only thing a retry could teach the
      // model is that more cards were wanted — which is the padding instinct
      // the beat rubric exists to remove. Skip the article silently instead.
      if (v.errors.some(isThinnessError)) {
        logRejection({
          tag: "videoSpec", articleId: article.id, model: SPEC_MODEL,
          reason: `too thin — ${v.errors.filter(isThinnessError).join(" | ")}`,
          len: JSON.stringify(result.parsed).length,
          finishReason: result.finishReason, usage: result.usage,
        });
        // A RESULT OBJECT, never null. This line returned bare null through
        // d7e2c6e — the one path left on the old contract — and the caller
        // reads `r.costUsd` unconditionally, so the first thin article threw
        // TypeError out of the whole cycle instead of being skipped. Every
        // later candidate was then never attempted.
        //
        // It also spent: one model call landed above and `spentUsd` already
        // carries it. Returning null discarded that, which is the exact thing
        // the result contract was introduced to stop.
        return reject(
          `too thin — ${v.errors.filter(isThinnessError).join(" | ")}`,
          spentUsd, attempts,
        );
      }

      if (attempts === 1) {
        logger.warn(
          `🎬 videoSpec [${article.id}]: spec-level rejection on attempt 1, regenerating once — ${v.errors.slice(0, 3).join(" | ")}`
        );
        prompt = basePrompt + buildCorrectionNote(v);
        continue;
      }
      logRejection({
        tag: "videoSpec", articleId: article.id, model: SPEC_MODEL,
        reason: `invalid spec after ${attempts} attempts — ${v.errors.slice(0, 3).join(" | ")}`,
        len: JSON.stringify(result.parsed).length,
        finishReason: result.finishReason, usage: result.usage,
      });
      return reject(v.errors.slice(0, 3).join(" | "), spentUsd, attempts, result.parsed ?? null);
    }

    const { usage, finishReason } = result;
    const cost = spentUsd;

    // The enumeration IS the diagnosis. This line is what distinguishes "the
    // model found five beats" (an input or rubric problem) from "it found
    // fifteen and only emitted five cards" (a compliance problem the count
    // check now rejects) — without it, all we ever see is the slide count.
    const beats = v.spec.beats || [];
    logger.info(
      (`🎬 videoSpec [${article.id}] beats=${beats.length} ${JSON.stringify(v.stats.beatKinds)} — ` +
       beats.map(b => `${b.kind}: ${String(b.beat).slice(0, 48)}`).join(" | ")).slice(0, 1200)
    );

    if (v.dropped.length) {
      // Not a failure here (§3 drops the card); Section 6's gate reads this.
      logger.warn(
        `🎬 videoSpec [${article.id}]: dropped ${v.dropped.length} card(s) — ` +
        v.dropped.map(d => `${d.kind}:${d.t}@${d.index}: ${d.reason}`).join(" | ")
      );
    }

    // THE WHOLE SPEC, on request. Off by default because a spec is a few KB of
    // JSON and every cycle would emit one, but the summary line above says how
    // many cards SURVIVED and never what they were — so a prompt change cannot
    // be reviewed from the log alone. Turn this on for the first cycle after any
    // prompt change, read it, turn it off.
    //
    // scripts/spec-dry-run.mjs is the cheaper path when the article can be
    // chosen: it prints the same JSON without rendering or publishing anything.
    // This flag is for seeing what the LIVE cycle actually produced.
    if (process.env.VIDEO_SPEC_LOG_JSON === "1") {
      logger.info(`🎬 videoSpec [${article.id}] FULL SPEC:\n${JSON.stringify(v.spec, null, 2)}`);
    }

    const spec = {
      ...v.spec,
      meta: {
        model: SPEC_MODEL,
        sourceTextChars: resolved.chars,
        sourceTextOrigin: resolved.origin,
        sourceTextReason: resolved.reason,
        targetSeconds,
        slides: v.stats.slides,
        emitted: v.stats.emitted,
        beats: v.stats.beats,
        beatKinds: v.stats.beatKinds,
        dropRatio: v.stats.dropRatio,
        sourcingDrops: v.stats.sourcingDrops,
        mixDrops: v.stats.mixDrops,
        byType: v.stats.byType,
        captionWords: v.stats.captionWords,
        droppedCards: v.dropped,
        attempts,
        costUsd: Number(cost.toFixed(5)),
        tokensIn: usage.promptTokenCount || 0,
        tokensOut: usage.candidatesTokenCount || 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        finishReason: finishReason ?? null,
        thoughtsTokenCount: usage.thoughtsTokenCount ?? 0,
        ms: Date.now() - started,
      },
    };

    logger.info(
      `🎬 videoSpec [${article.id}] ${spec.meta.slides} slides / ${spec.meta.captionWords}w ` +
      `${spec.meta.tokensOut}tok $${spec.meta.costUsd} ${spec.meta.ms}ms`
    );
    return { ok: true, spec, costUsd: spec.meta.costUsd, reason: null, attempts };
  } catch (err) {
    logger.warn(`🎬 videoSpec [${article?.id}]: unexpected error`, { error: err.message });
    return reject(`unexpected error: ${err.message}`, 0, 0);
  }
}

/**
 * Validated spec → validated packaging. Separate call, run AFTER the spec
 * exists (§5b). Returns null on any failure; never throws.
 */
export async function writePackaging(spec, article) {
  if (!isVideoSpecEnabled()) return null;
  if (!spec?.slides?.length) return null;

  const started = Date.now();
  try {
    const result = await callModel(buildPackagingPrompt({ spec, article }), {
      articleId: article.id, tag: "videoPackaging", model: PACKAGING_MODEL, maxOutputTokens: PACKAGING_MAX_OUTPUT_TOKENS,
    });
    if (!result) return null;

    const { parsed, usage, cost, finishReason } = result;

    const v = validatePackaging(parsed, spec);
    if (!v.ok) {
      logRejection({
        tag: "videoPackaging", articleId: article.id, model: PACKAGING_MODEL,
        reason: `invalid packaging — ${v.errors.slice(0, 3).join(" | ")}`,
        len: JSON.stringify(parsed).length, finishReason, usage,
      });
      return null;
    }
    if (v.dropped?.length) {
      logger.warn(
        `🎬 videoPackaging [${article.id}]: dropped ${v.dropped.length} variant(s) — ` +
        v.dropped.map(d => `${d.kind}@${d.index}: ${d.reason}`).join(" | ")
      );
    }

    const packaging = {
      ...v.packaging,
      meta: {
        model: PACKAGING_MODEL,
        droppedVariants: v.dropped || [],
        warnings: v.warnings || [],
        costUsd: Number(cost.toFixed(5)),
        tokensIn: usage.promptTokenCount || 0,
        tokensOut: usage.candidatesTokenCount || 0,
        maxOutputTokens: PACKAGING_MAX_OUTPUT_TOKENS,
        finishReason: finishReason ?? null,
        thoughtsTokenCount: usage.thoughtsTokenCount ?? 0,
        ms: Date.now() - started,
      },
    };

    logger.info(
      `🎬 videoPackaging [${article.id}] 3 titles / 3 thumbs ` +
      `${packaging.meta.tokensOut}tok $${packaging.meta.costUsd} ${packaging.meta.ms}ms`
    );
    return packaging;
  } catch (err) {
    logger.warn(`🎬 videoPackaging [${article?.id}]: unexpected error`, { error: err.message });
    return null;
  }
}

export const _internals = { decorateParsedSpec,
  buildSpecPrompt, buildPackagingPrompt, cardGrammar,
  extractJsonPayload, stripCounts, isThinnessError, isInvalidArgument,
};
