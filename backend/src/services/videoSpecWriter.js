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
 *   GEMINI_GENERATION_MODEL     — shared pin (default gemini-3.1-flash-lite)
 *   VIDEO_SPEC_MAX_OUTPUT_TOKENS — output cap (default 8192, see below)
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
  MODEL_EMITTABLE, THUMBNAIL_ANGLES, MIN_SLIDES, MAX_SLIDES,
  validateSpec, validatePackaging,
} from "./videoSpecSchema.js";

// Same shared pin as scriptWriter and igSummaryService. Never a "-latest" alias.
const MODEL = process.env.GEMINI_GENERATION_MODEL || "gemini-3.1-flash-lite";
const ENDPOINT = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;

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

const WPM = Number.parseInt(process.env.VIDEO_SPEC_WPM || "150", 10);

export function isVideoSpecEnabled() {
  return process.env.VIDEO_SPEC_ENABLED === "1" && !!process.env.GEMINI_API_KEY;
}

// ─── Rejection logging (same four fields as scriptWriter) ───────────────────

function logRejection(tag, articleId, reason, len, finishReason, usage) {
  logger.warn(
    `🎬 ${tag}: rejected article ${articleId} — ${reason} (len=${len}, ` +
    `model=${MODEL}, finishReason=${finishReason ?? "?"}, ` +
    `thoughtsTokenCount=${usage?.thoughtsTokenCount ?? "?"})`
  );
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

async function callModel(prompt, { articleId, tag, maxOutputTokens }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  logger.info(`🎬 ${tag}: Gemini model=${MODEL} for article ${articleId} (cap=${maxOutputTokens})`);

  // Each retry class has its own single-use (or bounded) budget so no
  // combination can loop: transient 5xx/429 gets two backoff retries,
  // thinking-rejection and non-JSON get one immediate retry each.
  const RETRY_DELAYS_MS = [4000, 9000];
  let transientUsed = 0;
  let thinkingRetryUsed = false;
  let jsonRetryUsed = false;
  let promptText = prompt;

  while (true) {
    try {
      const { data } = await axios.post(
        ENDPOINT(key),
        {
          contents: [{ role: "user", parts: [{ text: promptText }] }],
          generationConfig: buildGeminiGenerationConfig({
            // Lower than scriptWriter's 0.4: this is a structured artifact with
            // hard field constraints, not prose that needs phrasing variety.
            temperature: 0.3,
            responseMimeType: "application/json",
            maxOutputTokens,
          }),
        },
        { timeout: TIMEOUT_MS }
      );

      const candidate    = data?.candidates?.[0];
      const finishReason = candidate?.finishReason;
      const usage        = data?.usageMetadata || {};
      const text         = candidate?.content?.parts?.[0]?.text;

      if (!text) {
        logRejection(tag, articleId, "empty", 0, finishReason, usage);
        return null;
      }
      // HARD rejection. A truncated 25-slide spec that happens to parse is a
      // video that stops mid-argument with narration that references slides
      // which were never emitted.
      if (finishReason === "MAX_TOKENS") {
        logRejection(tag, articleId, "truncated_max_tokens", text.length, finishReason, usage);
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
        logRejection(tag, articleId, "unparseable_json", text.length, finishReason, usage);
        return null;
      }

      const cost =
        ((usage.promptTokenCount || 0) / 1e6) * RATE_IN_PER_M +
        ((usage.candidatesTokenCount || 0) / 1e6) * RATE_OUT_PER_M;

      return { parsed, usage, cost, finishReason };
    } catch (err) {
      if (isGeminiThinkingRejection(err) && !thinkingRetryUsed) {
        thinkingRetryUsed = true;
        markGeminiThinkingRejected(logger);
        continue;
      }
      if (isGeminiModelGone(err)) { markGeminiModelGone(MODEL, logger); return null; }
      const status = err.response?.status;
      const transient = status === 503 || status === 429 ||
                        err.code === "ECONNRESET" || err.code === "ETIMEDOUT";
      if (transient && transientUsed < RETRY_DELAYS_MS.length) {
        logger.warn(`🎬 ${tag}: ${status || err.code} — retry in ${RETRY_DELAYS_MS[transientUsed]}ms`);
        await sleep(RETRY_DELAYS_MS[transientUsed]);
        transientUsed++;
        continue;
      }
      logger.warn(`🎬 ${tag}: call failed`, { status, model: MODEL, error: err.message });
      return null;
    }
  }
}

// ─── Prompt 1 — the slide spec ──────────────────────────────────────────────

const CARD_GRAMMAR = `
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
"bars"    — a COMPARISON of 2 to 5 labelled quantities. { "t":"bars", "eyebrow":"...", "bars":[["label",70],["label",30]], "source":"OUTLET NAME", "caption":"..." }
            "bars" MUST contain AT LEAST 2 entries — a single number is never a "bars" card; use "stat" for a single number.
"turn"    — the pivot beat, where the obvious reading gives way to the real one.
            { "t":"turn", "eyebrow":"...", "lines":[["TEXT","white"],["TEXT","lime"]], "sub":"one line", "caption":"..." }
"kicker"  — the closer. { "t":"kicker", "top":"...", "bottom":"...", "sub":"...", "caption":"..." }
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
export function buildSpecPrompt({ article, allowedSources = [] }) {
  const sourceText = [
    `HEADLINE: ${article.title || ""}`,
    article.description ? `SUMMARY: ${article.description}` : "",
    article.content ? `BODY: ${String(article.content).slice(0, 12000)}` : "",
    `PUBLISHER: ${article.source_name || "unknown"}`,
    article.category ? `CATEGORY: ${article.category}` : "",
  ].filter(Boolean).join("\n");

  return `You are a video producer for ScoopFeeds, a news-intelligence product. You do not write prose. You emit a SLIDE SPEC as JSON, which a deterministic renderer turns into a video.

SOURCE MATERIAL — the ONLY information you may use:
"""
${sourceText}
"""

OUTLETS THAT ACTUALLY COVERED THIS STORY — the only names you may ever put in a "source" field:
${allowedSources.length ? allowedSources.map(s => `  - ${s}`).join("\n") : "  (none — you may therefore emit NO stat and NO bars cards at all)"}

CARD TYPES — a CLOSED SET. Emitting any type not on this list makes the entire spec invalid and the story is dropped:
${MODEL_EMITTABLE.filter(t => t !== "sources").map(t => `  ${t}`).join("\n")}

CARD GRAMMAR — field names and types are exact:
${CARD_GRAMMAR}

HARD RULES — violating any of these makes the output unusable:

1. GROUNDING. Every claim must appear in the source material above. Do not add context you happen to know. Do not infer causes, motives or consequences. Do not predict outcomes. If the source does not say why something happened, the spec does not say why either.

2. NUMBERS NEED A REAL SOURCE. Every "stat" and every "bars" card MUST carry a "source" naming one of the outlets listed above, AND the figure itself must appear in the source material. If you cannot attribute a number to one of those outlets, DO NOT EMIT THE CARD. Do not guess an outlet. Do not write "reports" or "analysts" or the story's subject as the source. A dropped card costs nothing; an invented attribution is unrecoverable.

3. NO "sources" CARD. You must never emit a card with "t":"sources". That card is built from the database, not written. If you emit one, the spec is rejected.

4. CAPTION IS THE NARRATION. Every card MUST have a "caption": the exact sentence spoken over that slide. It is both the voiceover line and the burned-in subtitle, so they can never drift apart. Write captions as plain spoken prose: no markdown, no brackets, no quotation marks, no emoji, no symbols. Write "percent" not "%", and write numbers the way a newsreader would say them. One or two spoken sentences per caption — say the beat and stop.

5. THE SLIDE TEXT IS NOT THE CAPTION. On-screen text is short and declarative — a few words, upper case where the grammar shows upper case. The caption is the sentence that explains it. They reinforce each other; they never repeat each other word for word.

6. ACCENT. Within any single card, AT MOST ONE line may have the colour "lime". Every other line is "white". This is a brand invariant, not a preference.

7. LENGTH IS DECIDED BY SUBSTANCE. Work the story before you write it.

   FIRST, enumerate the story's distinct BEATS from the source material. A beat is one thing the source actually establishes:
     - a FIGURE you can attribute to one of the outlets listed above and also find in the source material
     - a MECHANISM — how something works, or how it came about
     - a TURN — a point where the obvious reading of the story gives way to a truer one
     - a CONSEQUENCE — what follows, as the source states it
   Two sentences restating the same fact are ONE beat, not two. A quote that adds no new fact is not a beat.

   THEN emit one card per beat, choosing the card type that fits that beat, wrapped by the opening "title" card and the closing "kicker" card.

   Do not merge beats to make the video tighter. Do not restate, split, or invent a beat to make it longer. A story that establishes little yields a short spec, and that is the correct result; a story that establishes a great deal yields a long one. The length of your output is a consequence of how much the source establishes, and it is never something you decide up front.

8. STRUCTURE AND MIX. The FIRST card must be "title" and the LAST card must be "kicker". In between, VARY THE CARD TYPES:
   - No card type may take more than about a third of the cards. A wall of number cards is a spreadsheet read aloud, not a video.
   - Never place more than two cards of the same type back to back.
   - "turn" should appear once, near the point where the story's obvious reading gives way to its real one.
   Cards that break these limits are discarded from the video, so a monotonous spec loses most of itself. If a beat could be carried by more than one card type, prefer the type you have used least.

9. TONE. Neutral wire-service register. No editorialising, no outrage, no rhetorical questions, no "you won't believe". Interest comes from a specific fact being genuinely interesting, never from sensational phrasing. Preserve the source's hedging: if it says "reportedly" or "officials say", keep that attribution.

Return ONLY a JSON object, no markdown fence, with exactly this shape:

{ "slides": [ ...cards... ] }`;
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

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Article → validated slide spec. Returns null on ANY failure; the caller
 * skips the article. Never throws.
 *
 * @param {object} article
 * @param {object} opts
 * @param {string[]} opts.allowedSources — outlets that covered this story
 * @param {number}  [opts.targetSeconds=180] — recorded in meta only; the model
 *        never sees it, because a duration is a slide count once divided.
 * @param {number}  [opts.slideCeiling] — VALIDATION ceiling, never shown to the
 *        model. Overrides MAX_SLIDES for the runaway check.
 */
export async function writeVideoSpec(article, {
  allowedSources = [],
  targetSeconds = 180,
  slideCeiling = null,
} = {}) {
  if (!isVideoSpecEnabled()) return null;
  if (!article?.title) return null;

  const started = Date.now();
  try {
    const sourceText = `${article.title || ""} ${article.description || ""} ${article.content || ""}`;
    const basePrompt = buildSpecPrompt({ article, allowedSources });
    const validateOpts = {
      allowedSources, sourceText,
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
        articleId: article.id, tag: "videoSpec", maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
      if (!result) return null;            // transport/JSON failure already logged
      spentUsd += result.cost;

      v = validateSpec(result.parsed, validateOpts);
      if (v.ok) break;

      // A spec that came back TOO THIN is not retried. The article genuinely
      // did not carry enough beats, and the only thing a retry could teach the
      // model is that more cards were wanted — which is the padding instinct
      // the beat rubric exists to remove. Skip the article silently instead.
      if (v.errors.some(isThinnessError)) {
        logRejection("videoSpec", article.id, `too thin — ${v.errors.filter(isThinnessError).join(" | ")}`,
          JSON.stringify(result.parsed).length, result.finishReason, result.usage);
        return null;
      }

      if (attempts === 1) {
        logger.warn(
          `🎬 videoSpec [${article.id}]: spec-level rejection on attempt 1, regenerating once — ${v.errors.slice(0, 3).join(" | ")}`
        );
        prompt = basePrompt + buildCorrectionNote(v);
        continue;
      }
      logRejection("videoSpec", article.id,
        `invalid spec after ${attempts} attempts — ${v.errors.slice(0, 3).join(" | ")}`,
        JSON.stringify(result.parsed).length, result.finishReason, result.usage);
      return null;
    }

    const { usage, finishReason } = result;
    const cost = spentUsd;
    if (v.dropped.length) {
      // Not a failure here (§3 drops the card); Section 6's gate reads this.
      logger.warn(
        `🎬 videoSpec [${article.id}]: dropped ${v.dropped.length} card(s) — ` +
        v.dropped.map(d => `${d.kind}:${d.t}@${d.index}: ${d.reason}`).join(" | ")
      );
    }

    const spec = {
      ...v.spec,
      meta: {
        model: MODEL,
        targetSeconds,
        slides: v.stats.slides,
        emitted: v.stats.emitted,
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
    return spec;
  } catch (err) {
    logger.warn(`🎬 videoSpec [${article?.id}]: unexpected error`, { error: err.message });
    return null;
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
      articleId: article.id, tag: "videoPackaging", maxOutputTokens: PACKAGING_MAX_OUTPUT_TOKENS,
    });
    if (!result) return null;

    const { parsed, usage, cost, finishReason } = result;

    const v = validatePackaging(parsed, spec);
    if (!v.ok) {
      logRejection("videoPackaging", article.id, `invalid packaging — ${v.errors.slice(0, 3).join(" | ")}`,
        JSON.stringify(parsed).length, finishReason, usage);
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
        model: MODEL,
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

export const _internals = {
  buildSpecPrompt, buildPackagingPrompt, CARD_GRAMMAR,
  extractJsonPayload, stripCounts, isThinnessError,
};
