/**
 * eventCarouselCopy — the ONE LLM call behind slides 4, 5 and 6 of the
 * 7-slide event carousel.
 *
 *   slide 4  THE DETAILS       details[3]        ~60 chars each
 *   slide 5  THE NUMBERS       figures[3]        {value, label, source_sentence}
 *   slide 6  WHY IT MATTERS    why_it_matters    <=160 chars
 *
 * Slides 1-3 and 7 are mechanical (event title, events.summary, coverage
 * counts, static CTA) and never touch this module.
 *
 * PROVIDER. Prod has LLM_PROVIDER / LLM_PREMIUM_PROVIDER / CEREBRAS_API_KEY /
 * GROQ_API_KEY all unset (verified 2026-07-28), so llmQueue's auto-detect
 * falls through to gemini. That means rawCallJsonGemini applies
 * buildGeminiGenerationConfig -> thinkingBudget:0, and responseMimeType is
 * already "application/json", so JSON mode is on. The prompt below is written
 * for Gemini accordingly: schema stated once, plainly, with the constraints
 * as rules rather than as few-shot examples.
 *
 * REFUSAL, NOT REPAIR. Every validation failure returns null and the caller
 * falls back to the 3-slide article carousel. Nothing is truncated — not even
 * on a word boundary. Copy that had to be cut is copy the model got wrong, and
 * at ~23 qualifying events/day against a 12/day need we can afford to skip.
 *
 * COST. Generation is on-demand for the single event about to be posted, not
 * a batch over all qualifying events: ~12 calls/day against llmQueue's 2000/day
 * rail. A null from the budget gate means "don't post", never an error.
 */

import crypto from "crypto";
import { getDb } from "../../models/database.js";
import { callJson } from "../llmQueue.js";
import { logger } from "../../services/logger.js";
import { deterministicSeoLine, SEO_STOPWORDS } from "../../services/socialComposer.js";

// Context caps.
//
// articles.content is INCLUDED, reversing the original A1 decision to exclude
// it on token cost. The first live run refused with figures_count_0 because
// the bundle contained no digits at all: it was almost entirely headlines, and
// headlines do not carry figures. Measured over 11,721 prod-snapshot articles:
//   title   contains a digit  27.8%     avg   67 bytes
//   descr   contains a digit  26.3%     avg  146 bytes
//   content contains a digit  43.6%     avg  876 bytes  (80.9% non-empty)
// So content roughly doubles the share of articles carrying any number, and
// carries ~6x the text, which raises numeric DENSITY much further. content is
// already HTML-stripped and capped at 2000 chars at ingest (rssFetcher), so
// this is clean prose, not raw markup. Ten articles at 700 chars is ~1.7k extra
// tokens, ~$0.0005 per carousel — trivial against posting a numberless slide.
const MAX_ARTICLES        = 10;
const MAX_TIMELINE        = 8;
const MAX_DESC_CHARS      = 300;
const MAX_CONTENT_CHARS   = 700;

// Field limits. Enforced as REFUSALS, never as truncation.
const DETAIL_MIN = 20,  DETAIL_MAX = 70;
const VALUE_MAX  = 12,  LABEL_MAX  = 28;
const WHY_MIN    = 60,  WHY_MAX    = 160;

// seo_line is the ONE SOFT FIELD on this call. Everything else here refuses:
// a bad figure means "do not post this event". seo_line instead falls back to
// a deterministic title-derived line, because a keyword line is a discovery
// optimisation and blocking a whole post over one is the wrong trade.
//
// Validation is DELIBERATELY LOOSER than the prompt spec: the prompt asks for
// 4-8 words, the validator accepts 3-10. A spec tighter than its validator is
// the right shape — it aims the model at the middle of the range instead of
// its edge, without rejecting a good line for being one word long.
const SEO_MIN_WORDS = 3, SEO_MAX_WORDS = 10;

// Hype denylist. Small and EXPLICIT rather than clever: a general "clickbait
// detector" would reject real headlines, and the failure mode of a missed
// hype line (a slightly tabloid caption) is far cheaper than the failure mode
// of a false positive (silently falling back on good copy, forever, for a
// whole class of stories).
//
// `breaking` is anchored to the START of the line only. Mid-line it is usually
// ordinary English — "breaking point", "record breaking", "breaking ranks" —
// and rejecting those would be exactly the false positive described above.
// Each pattern is NAMED. The reason string ends up in a log line that gets
// grepped and counted — `hype_you_wont_believe` is a tag you can aggregate on,
// whereas a mangled regex source is noise.
const SEO_HYPE_PATTERNS = [
  { name: "breaking_prefix",   re: /^breaking\b/i },
  { name: "you_wont_believe",  re: /\byou won'?t believe\b/i },
  { name: "changes_everything", re: /\bthis changes everything\b/i },
  { name: "what_happened_next", re: /\bwhat happen(?:ed|s) next\b/i },
  { name: "truth_about",       re: /\bthe truth about\b/i },
  { name: "nobody_talking",    re: /\b(?:nobody|no one) is talking about\b/i },
  { name: "need_to_know",      re: /\beverything you need to know\b/i },
  { name: "heres_why",         re: /\bhere'?s why\b/i },
  { name: "shocking",          re: /\bshocking\b/i },
  { name: "jaw_dropping",      re: /\bjaw[- ]dropping\b/i },
  { name: "unbelievable",      re: /\bunbelievable\b/i },
  { name: "must_see",          re: /\bmust[- ]see\b/i },
  { name: "goes_viral",        re: /\bgoes viral\b/i },
  { name: "blow_your_mind",    re: /\bwill blow your mind\b/i },
];

const SEO_HASHTAG_RE = /#/;
const SEO_EMOJI_RE   = /\p{Extended_Pictographic}/u;
const SEO_URL_RE     = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|org|net|io|co|gov|edu|news)\b)/i;

// Attempt ledger, mirroring eventActorExtractor: a persistently-failing event
// must not be re-paid for on every cycle.
const MAX_ATTEMPTS       = 3;
const ATTEMPT_SPACING_MS = [30 * 60 * 1000, 4 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];

// ─── Normalisation for figure grounding ───────────────────────────────────
// Both sides of every substring test go through the same normaliser, so a
// difference in punctuation or spacing cannot manufacture a false rejection —
// or a false pass.
function normText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")   // unicode dashes/minus -> hyphen
    .replace(/[‘’‛]/g, "'")    // curly single quotes
    .replace(/[“”]/g, '"')          // curly double quotes
    .replace(/ /g, " ")                  // nbsp
    .replace(/,/g, "")                        // thousands separators
    .replace(/\s+/g, " ")
    .trim();
}
// Tighter form for numeric values: spaces removed so "8.4 %" matches "8.4%".
function normNum(s) { return normText(s).replace(/\s+/g, ""); }

// ─── Context bundle ───────────────────────────────────────────────────────

// ─── Entity tokens for seo_line grounding ─────────────────────────────────
//
// REUSES the event's durable signature — the same event_entity_signature row
// the carousel selection bar counts keys from — rather than re-deriving
// entities. But the signature cannot be matched against a caption directly:
// a key is `COALESCE(qid, surface_norm)` (eventPromoter.loadEntityKeys), so a
// RESOLVED entity is stored as a Wikidata QID like "Q7747", which will never
// appear in a sentence a human would type. Matching the raw keys would
// therefore silently reject every seo_line about a well-known entity — the
// most important stories — while passing the obscure ones.
//
// So QID keys are mapped back to text through surface_qid_cache
// (surface_norm -> qid, plus a human `label`), and non-QID keys are already
// surface forms. Both halves are then reduced to word tokens.
//
// This is a GROUNDING HEURISTIC, not a proof. A token drawn from "united
// states" would also match "United Airlines". That is accepted: the cost of a
// false pass is a slightly-off keyword line, not a false factual claim — very
// different from the figure grounding above, which is exact by construction.
function entityTokensFor(db, eventId) {
  let raw = [];
  try {
    const row = db.prepare(`SELECT keys FROM event_entity_signature WHERE event_id = ?`).get(eventId);
    raw = JSON.parse(row?.keys || "[]");
  } catch { raw = []; }

  const keys = (Array.isArray(raw) ? raw : []).map(x => String(x?.k ?? "")).filter(Boolean);
  if (!keys.length) return new Set();

  const surfaces = [];
  const qids     = [];
  for (const k of keys) (/^Q\d+$/i.test(k) ? qids : surfaces).push(k);

  if (qids.length) {
    try {
      const ph = qids.map(() => "?").join(",");
      for (const r of db.prepare(
        `SELECT surface_norm, label FROM surface_qid_cache WHERE qid IN (${ph})`
      ).all(...qids)) {
        if (r.surface_norm) surfaces.push(r.surface_norm);
        if (r.label)        surfaces.push(r.label);
      }
    } catch { /* cache table absent or unreadable — surfaces half still works */ }
  }

  const tokens = new Set();
  for (const s of surfaces) {
    for (const t of normText(s).split(/[^a-z0-9]+/)) {
      // >=3 chars and not a function word, so "the" from "the guardian" cannot
      // ground a line that has nothing to do with the event.
      if (t.length >= 3 && !SEO_STOPWORDS.has(t)) tokens.add(t);
    }
  }
  return tokens;
}

function buildContext(db, event) {
  const timeline = db.prepare(`
    SELECT headline, source_name, ts
    FROM event_timeline
    WHERE event_id = ? AND kind = 'article' AND headline IS NOT NULL
    ORDER BY ts DESC LIMIT ?
  `).all(event.id, MAX_TIMELINE);

  // content is where the numbers actually live — see MAX_CONTENT_CHARS.
  const articles = db.prepare(`
    SELECT a.title, a.description, a.content, a.source_name
    FROM event_articles ea JOIN articles a ON a.id = ea.article_id
    WHERE ea.event_id = ?
    ORDER BY a.credibility DESC, a.published_at DESC
    LIMIT ?
  `).all(event.id, MAX_ARTICLES);

  // sources[i] is the outlet snippets[i] came from, or null where there is no
  // single owning outlet (the event summary is synthesised across the dossier).
  // This is what lets slide 5 print the source beside each figure: the scope a
  // label can drop — "peak audience" vs "peak audience / BBC" — then comes from
  // the data by construction rather than from the model's judgment.
  const snippets = [];
  const sources  = [];
  const push = (text, source) => { snippets.push(text); sources.push(source || null); };

  if (String(event.summary || "").trim()) push(event.summary.trim(), null);
  for (const t of timeline) if (t.headline) push(t.headline.trim(), t.source_name || null);
  for (const a of articles) {
    if (a.title) push(a.title.trim(), a.source_name);
    if (a.description) push(String(a.description).slice(0, MAX_DESC_CHARS).trim(), a.source_name);
    // Truncate on a SENTENCE boundary, never mid-sentence: the model is
    // required to quote a whole sentence verbatim as a figure's grounding, and
    // a sentence chopped by the cap could never be matched back against the
    // corpus — it would silently look like a hallucination to the validator.
    if (a.content) {
      const c = String(a.content).trim();
      const cut = c.length <= MAX_CONTENT_CHARS ? c : c.slice(0, MAX_CONTENT_CHARS);
      const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
      const safe = (c.length <= MAX_CONTENT_CHARS) ? cut
                 : (lastStop > 120 ? cut.slice(0, lastStop + 1) : cut);
      if (safe) push(safe.trim(), a.source_name);
    }
  }

  // The corpus is EXACTLY what the model is shown. Grounding is checked
  // against this and nothing else, so the model cannot be blamed for — or get
  // away with — a figure sourced from text it never saw.
  return {
    event, snippets, sources,
    corpus: normText(snippets.join(" \n ")),
    entityTokens: entityTokensFor(db, event.id),
  };
}

// Bump whenever the PROMPT RULES or the validator change. content_hash covers
// the dossier INPUTS, so without this a rules fix would not invalidate a single
// cached row: every event already generated would keep serving copy written
// under the old, weaker rules. (Exactly the card-cache trap one layer up — see
// the warning above scoopMarksForSlide in cardRenderer.)
//   v1 -> v2: standalone-label rule (a label must be true and complete to a
//             reader who never sees the source) and the no-strengthening rule
//             for why_it_matters.
//   v2 -> v3: figures carry `source`, the outlet their grounding sentence came
//             from, rendered beside the value on slide 5. Cached v2 rows have
//             no source field, so they must regenerate rather than render a
//             blank attribution line.
//   v3 -> v4: seo_line, the keyword-first caption line, added as a fourth
//             field on this same call. Without this bump every event already
//             in the cache would keep its v3 row, whose seo_line column is
//             NULL, and the new field would be invisible in production for
//             exactly the events most likely to be posted — the ones already
//             generated. This is the cache trap the paragraph above describes,
//             hit for the third time on this project.
const COPY_RULES_VER = "v4";

// `ver` is a parameter rather than a closed-over constant so the version's role
// in cache identity is directly demonstrable: hashing the same ctx under "v3"
// and "v4" must produce different digests, which is the whole mechanism that
// forces regeneration. Production always calls it with the default.
function contentHashOf(ctx, ver = COPY_RULES_VER) {
  return crypto.createHash("sha1")
    .update(ver)
    .update("|").update(String(ctx.event.id))
    .update("|").update(String(ctx.event.title || ""))
    .update("|").update(String(ctx.event.summary || ""))
    .update("|").update(ctx.snippets.join(" ~ "))
    .digest("hex");
}

function buildPrompt(ctx) {
  const numbered = ctx.snippets.map((s, i) => `[${i + 1}] ${s}`).join("\n");
  return `You are a news editor writing an Instagram carousel about one ongoing story.

SOURCE MATERIAL (the ONLY facts you may use):
${numbered}

Return JSON with exactly this shape:
{
  "details": ["...", "...", "..."],
  "figures": [
    {"value": "...", "label": "...", "source_sentence": "..."},
    {"value": "...", "label": "...", "source_sentence": "..."},
    {"value": "...", "label": "...", "source_sentence": "..."}
  ],
  "why_it_matters": "...",
  "seo_line": "..."
}

RULES

details — exactly 3. Each is one plain sentence of ${DETAIL_MIN}-${DETAIL_MAX} characters stating a
concrete fact from the source material. Three DIFFERENT facts. Do not restate
the story's headline. No preamble, no "the article says".

figures — exactly 3, and this is the strictest rule in the task:
  - "value" is a number COPIED EXACTLY as it is written in the source material,
    including its unit or symbol. Examples of copying: 8.4% -> "8.4%",
    $94 -> "$94", 3 -> "3". Maximum ${VALUE_MAX} characters.
  - Do NOT compute, convert, sum, average, round, or infer a number. If the
    source says "3.5 million" you write "3.5 million", never "3,500,000".
  - Do NOT invent a number that is not written in the source material.
  - "source_sentence" is the sentence from the source material that contains
    that number, copied VERBATIM, word for word. It must contain the value.
  - "label" is what the number counts, ${LABEL_MAX} characters or fewer. It must be TRUE
    AND COMPLETE ON ITS OWN, read by someone who never sees the sentence. It
    must carry whatever qualifier makes it accurate — the subject, and any
    limit on scope such as a place, a broadcaster, a company or a time.
      WRONG "minutes"        RIGHT "when Spain scored"
      WRONG "years old"      RIGHT "Messi's age"
      WRONG "peak audience"  RIGHT "BBC UK peak audience"
        (the source said "peak audience of 15.8 million on BBC One and BBC
         iPlayer" — that is a UK broadcaster figure. Labelled just "peak
         audience" on a slide it reads as the global audience for the match,
         which is more than a billion. Dropping the scope makes a true number
         into a false claim.)
    A label that is only a unit — "minutes", "years old", "people", "percent" —
    is always wrong, because it names no subject.
  - The 3 values must be different from each other.
  - If the source material does not contain 3 distinct real numbers, return
    fewer figures. Returning fewer is CORRECT; inventing one is a serious
    error.

why_it_matters — one claim of ${WHY_MIN}-${WHY_MAX} characters explaining the consequence
of this story, grounded in the source material. No questions.

  Do NOT strengthen what the source attributes or hedges. If the source says
  people believe something, expect something, or hope for something, then the
  claim is that they believe, expect or hope it — not that it is so. Keep the
  attribution or the hedge; do not convert it into a fact.
      SOURCE "For many fans, the victory cemented a belief that something
              promising is happening."
      WRONG  "Spain's victory marks a significant cultural and economic
              revival."      (an attributed belief asserted as fact)
      RIGHT  "For many fans the win confirmed a sense that something promising
              is under way."  (the belief stays a belief)

seo_line — 4-8 words. This is NOT a headline and NOT a hook. It is the phrase a
person would type into a search box to find this story. Name the actor(s) and
the topic in plain language. Sentence case. No emoji, no hashtag, no URL, no
trailing punctuation.

  RIGHT  Iran oil sanctions explained
  RIGHT  Nvidia earnings and the AI trade
  WRONG  You won't believe what happened next
  WRONG  BREAKING
  WRONG  This changes everything

  At least one word must be a name or term from the source material above —
  a person, place, organisation or subject. A line of only generic news words
  is not searchable and will be discarded.

Return only the JSON object.`;
}

// ─── Standalone-label test ────────────────────────────────────────────────
//
// A slide-5 label is read by someone who will never see the source sentence,
// so it must be true and complete ON ITS OWN. Two distinct failures were found
// on the first human read of live output:
//
//   (a) CONTEXTLESS — "106 / minutes" (of what?), "39 / years old" (who?).
//       The sentences said Ferran Torres scored at 106 minutes and Messi is 39;
//       the labels dropped the subject entirely. This IS mechanically
//       detectable: the label consists only of unit and measure words, with no
//       token naming a subject. That is what this function catches.
//
//   (b) UNDER-QUALIFIED — "15.8 million / peak audience", where the source said
//       "peak audience of 15.8 million ON BBC ONE AND BBC IPLAYER". That is a
//       UK broadcaster figure; standalone on a slide it reads as the World Cup
//       final's global audience, which is over a billion. This is NOT
//       mechanically detectable: the number is real, the label's words all
//       appear in the sentence, and every syntactic check passes. Deciding
//       that "peak audience" needs "BBC UK" attached requires knowing what a
//       reader would infer. It is a prompt rule (see buildPrompt) and,
//       ultimately, the reason a human reads the preview before we post.
//
// Kept deliberately narrow — it rejects only labels made ENTIRELY of these
// words, so "Messi's age" and "BBC UK audience" pass while "years old" does not.
const BARE_UNIT_WORDS = new Set([
  "second", "seconds", "minute", "minutes", "hour", "hours", "day", "days",
  "week", "weeks", "month", "months", "year", "years", "old", "age", "aged",
  "percent", "pct", "percentage", "point", "points", "million", "billion",
  "thousand", "trillion", "dollar", "dollars", "usd", "euro", "euros",
  "pound", "pounds", "people", "person", "total", "count", "number", "amount",
  "figure", "figures", "value", "rate", "level", "size", "share", "price",
  "cost", "sum", "times", "each", "per", "of", "the", "a", "an", "in", "at",
  "and", "or", "to", "for",
]);
function isBareUnitLabel(label) {
  const tokens = normText(label).split(/[^a-z0-9%$]+/).filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every(t => BARE_UNIT_WORDS.has(t));
}

// ─── seo_line validation ──────────────────────────────────────────────────
//
// Returns { ok:true, value } or { ok:false, reason }. NEVER repairs and NEVER
// fails the surrounding copy — the caller substitutes a deterministic line.
// Rejection here is a normal outcome, not an error.
//
// Checks are ordered cheapest-and-most-specific first so the logged reason
// names the actual defect rather than whichever check happened to run.
function validateSeoLine(raw, ctx) {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "absent" };
  const line = raw.trim();

  if (SEO_HASHTAG_RE.test(line)) return { ok: false, reason: "has_hashtag" };
  if (SEO_EMOJI_RE.test(line))   return { ok: false, reason: "has_emoji" };
  if (SEO_URL_RE.test(line))     return { ok: false, reason: "has_url" };

  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < SEO_MIN_WORDS || words.length > SEO_MAX_WORDS) {
    return { ok: false, reason: `words_${words.length}` };
  }

  for (const p of SEO_HYPE_PATTERNS) {
    if (p.re.test(line)) return { ok: false, reason: `hype_${p.name}` };
  }

  // Grounding. An event with no usable signature CANNOT be verified, so it is
  // rejected rather than waved through: the fallback is deterministic and safe,
  // and passing an unverifiable line is the failure mode that has no floor.
  // In practice unreachable for a carousel — qualifiesForCarousel already
  // requires >= 2 signature keys — which is precisely why failing open here
  // would create a silent path nobody would ever see exercised.
  const tokens = ctx.entityTokens;
  if (!tokens || !tokens.size) return { ok: false, reason: "no_signature" };

  const lineTokens = new Set(normText(line).split(/[^a-z0-9]+/).filter(Boolean));
  let hit = null;
  for (const t of lineTokens) if (tokens.has(t)) { hit = t; break; }
  if (!hit) return { ok: false, reason: "no_entity_token" };

  return { ok: true, value: line };
}

// ─── Validation ───────────────────────────────────────────────────────────
// Returns { ok:true, copy, seoReason } or { ok:false, reason }. Never repairs.

function validateCopy(parsed, ctx) {
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "not_an_object" };

  const title = normText(ctx.event.title);

  // details ---------------------------------------------------------------
  const details = Array.isArray(parsed.details) ? parsed.details.map(d => String(d ?? "").trim()) : [];
  if (details.length !== 3) return { ok: false, reason: `details_count_${details.length}` };
  for (const d of details) {
    if (d.length < DETAIL_MIN || d.length > DETAIL_MAX) return { ok: false, reason: `detail_length_${d.length}` };
    if (normText(d) === title) return { ok: false, reason: "detail_repeats_title" };
  }
  if (new Set(details.map(normText)).size !== 3) return { ok: false, reason: "details_not_distinct" };

  // figures ---------------------------------------------------------------
  const figures = Array.isArray(parsed.figures) ? parsed.figures : [];
  if (figures.length !== 3) return { ok: false, reason: `figures_count_${figures.length}` };

  const clean = [];
  for (const f of figures) {
    const value = String(f?.value ?? "").trim();
    const label = String(f?.label ?? "").trim();
    const sent  = String(f?.source_sentence ?? "").trim();

    if (!value || !label || !sent)        return { ok: false, reason: "figure_missing_field" };
    if (isBareUnitLabel(label))           return { ok: false, reason: `label_not_standalone_${label.replace(/\s+/g, "_")}` };
    if (value.length > VALUE_MAX)         return { ok: false, reason: `value_too_long_${value.length}` };
    if (label.length > LABEL_MAX)         return { ok: false, reason: `label_too_long_${label.length}` };
    if (!/\d/.test(value))                return { ok: false, reason: "value_has_no_digit" };

    // GROUNDING, two steps. Checking the value against the whole corpus would
    // be far too weak — a bare "3" appears inside "2035". Instead:
    //   1. the quoted sentence must really exist in what we showed the model
    //   2. the value must appear in THAT sentence
    // Together these mean a figure can only survive if it was copied out of a
    // real sentence, which also gives the label a verifiable context.
    const nSent = normText(sent);
    if (nSent.length < 12)                       return { ok: false, reason: "source_sentence_too_short" };
    if (!ctx.corpus.includes(nSent))             return { ok: false, reason: "source_sentence_not_in_corpus" };
    if (!normNum(nSent).includes(normNum(value))) return { ok: false, reason: "value_not_in_source_sentence" };

    // Attribute the figure to the outlet whose snippet contains the grounding
    // sentence. This is the mitigation for the under-qualified-label failure
    // that no validation rule can catch: printing "BBC" beside "peak audience"
    // restores the scope the label dropped, and it is true BY CONSTRUCTION —
    // we know which article the sentence came from, so the model is not being
    // asked to be honest about it. null when the sentence came from the
    // synthesised event summary, which has no single owning outlet.
    const ownerIdx = ctx.snippets.findIndex(s => normText(s).includes(nSent));
    const source = ownerIdx >= 0 ? (ctx.sources?.[ownerIdx] || null) : null;

    clean.push({ value, label, source_sentence: sent, source });
  }
  if (new Set(clean.map(f => normNum(f.value))).size !== 3) return { ok: false, reason: "figure_values_not_distinct" };

  // why_it_matters --------------------------------------------------------
  const why = String(parsed.why_it_matters ?? "").trim();
  if (why.length < WHY_MIN || why.length > WHY_MAX) return { ok: false, reason: `why_length_${why.length}` };
  if (normText(why) === title) return { ok: false, reason: "why_repeats_title" };

  // seo_line LAST, and non-fatally. Every check above can refuse the copy;
  // this one cannot. A rejected or absent seo_line becomes the deterministic
  // title-derived line, so no post is ever blocked by it.
  const seo = validateSeoLine(parsed.seo_line, ctx);
  const seo_line = seo.ok ? seo.value : deterministicSeoLine(ctx.event.title);

  return {
    ok: true,
    copy: { details, figures: clean, why_it_matters: why, seo_line },
    seoReason: seo.ok ? null : seo.reason,
  };
}

// ─── Ledger ───────────────────────────────────────────────────────────────

function shouldAttempt(db, eventId, hash, now) {
  const led = db.prepare(
    `SELECT attempts, last_attempt_at, content_hash, succeeded_at FROM event_carousel_copy WHERE event_id = ?`
  ).get(eventId);

  if (!led) return { proceed: true };
  if (led.content_hash !== hash) return { proceed: true };   // inputs changed -> fresh budget
  if (led.succeeded_at) return { proceed: false, cached: true }; // never re-pay
  if (led.attempts >= MAX_ATTEMPTS) return { proceed: false, reason: "attempts_exhausted" };
  const wait = ATTEMPT_SPACING_MS[Math.min(led.attempts, ATTEMPT_SPACING_MS.length - 1)];
  if (now - led.last_attempt_at < wait) return { proceed: false, reason: "backoff" };
  return { proceed: true };
}

function recordAttempt(db, eventId, hash, now, { copy = null, model = null } = {}) {
  db.prepare(`
    INSERT INTO event_carousel_copy
      (event_id, content_hash, details_json, figures_json, why_it_matters, seo_line, model,
       attempts, last_attempt_at, succeeded_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      -- a changed hash restarts the attempt count; same hash increments it
      attempts        = CASE WHEN event_carousel_copy.content_hash = excluded.content_hash
                             THEN event_carousel_copy.attempts + 1 ELSE 1 END,
      content_hash    = excluded.content_hash,
      details_json    = excluded.details_json,
      figures_json    = excluded.figures_json,
      why_it_matters  = excluded.why_it_matters,
      seo_line        = excluded.seo_line,
      model           = excluded.model,
      last_attempt_at = excluded.last_attempt_at,
      succeeded_at    = excluded.succeeded_at,
      updated_at      = excluded.updated_at
  `).run(
    eventId, hash,
    copy ? JSON.stringify(copy.details) : null,
    copy ? JSON.stringify(copy.figures) : null,
    copy ? copy.why_it_matters : null,
    copy ? (copy.seo_line || null) : null,
    model, now, copy ? now : null, now, now
  );
}

/** Cached copy for an event, or null. Read-only — never generates. */
export function readCachedCopy(eventId) {
  const row = getDb().prepare(
    `SELECT details_json, figures_json, why_it_matters, seo_line FROM event_carousel_copy
      WHERE event_id = ? AND succeeded_at IS NOT NULL`
  ).get(eventId);
  if (!row) return null;
  try {
    return {
      details: JSON.parse(row.details_json || "[]"),
      figures: JSON.parse(row.figures_json || "[]"),
      why_it_matters: row.why_it_matters || "",
      // "" rather than null on a pre-v4 row. Those are unreachable in practice
      // (the version bump regenerates them), but the caption layer treats an
      // empty seo_line as "derive one from the title" — so an old row degrades
      // to the deterministic line instead of printing a blank first line.
      seo_line: row.seo_line || "",
    };
  } catch { return null; }
}

/**
 * Get carousel copy for an event, generating it once if needed.
 *
 * Returns the copy object, or null meaning "do not post this event" — which
 * covers every failure: budget refused, model returned nothing, validation
 * failed, attempts exhausted, still in backoff.
 *
 * callJsonFn is injectable so tests can assert the invocation COUNT (the cache
 * property) rather than infer it.
 */
export async function ensureEventCarouselCopy(eventId, { callJsonFn = callJson } = {}) {
  const db = getDb();
  const event = db.prepare(
    `SELECT id, slug, title, summary, category FROM events WHERE id = ?`
  ).get(eventId);
  if (!event) return null;

  const ctx  = buildContext(db, event);
  const hash = contentHashOf(ctx);
  const now  = Date.now();

  const gate = shouldAttempt(db, eventId, hash, now);
  if (!gate.proceed) {
    if (gate.cached) return readCachedCopy(eventId);
    logger.info(`🎠 carousel copy skipped for ${eventId.slice(0, 8)}: ${gate.reason}`);
    return null;
  }

  const parsed = await callJsonFn(buildPrompt(ctx), {
    tier: "standard",
    task: "event-carousel",
    temperature: 0.2,
    maxOutputTokens: 900,
  });

  // null = daily budget rail refused, LLM disabled, or provider failure. Not
  // an error condition: the caller simply does not post this event.
  //
  // Deliberately does NOT record an attempt. A null means we never got a
  // response to judge, and the cause is infrastructure, not this event.
  // Burning one of its 3 attempts here would let a provider outage or a
  // budget-capped afternoon permanently blacklist events that are perfectly
  // fine. Validation failures below DO record — there the model answered and
  // the answer was unusable, which is a property of the event's own corpus.
  if (parsed == null) {
    logger.info(`🎠 carousel copy unavailable for ${eventId.slice(0, 8)} (llm returned null)`);
    return null;
  }

  const v = validateCopy(parsed, ctx);
  if (!v.ok) {
    recordAttempt(db, eventId, hash, now);
    logger.info(`🎠 carousel copy REFUSED for ${eventId.slice(0, 8)}: ${v.reason}`);
    return null;
  }

  recordAttempt(db, eventId, hash, now, { copy: v.copy, model: "gemini" });
  // seo_line provenance is logged, never persisted: a "fallback" that becomes
  // the norm is a prompt problem, and the only way to see that is a log line
  // that names the rejection reason each time it happens.
  const seoNote = v.seoReason ? `seo_line FALLBACK (${v.seoReason})` : "seo_line ok";
  logger.info(`🎠 carousel copy ready for ${eventId.slice(0, 8)} (${v.copy.figures.length} grounded figures, ${seoNote}): "${v.copy.seo_line}"`);
  return v.copy;
}

// Exported for tests and for a future ops preview route.
export const __test__ = {
  validateCopy, buildContext, buildPrompt, normText, normNum,
  validateSeoLine, entityTokensFor, contentHashOf, COPY_RULES_VER,
};
