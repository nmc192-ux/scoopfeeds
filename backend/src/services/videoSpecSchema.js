/**
 * videoSpecSchema.js — the video slide-spec contract (brief §3) and its validator.
 *
 * The LLM emits a SLIDE SPEC, not prose. This module owns what a valid spec is
 * and refuses everything else. Nothing here renders, selects, or publishes.
 *
 * THREE LOAD-BEARING RULES, all of them refusals:
 *
 *   1. CLOSED CARD SET, enforced by refusing the CARD. A card with an unknown
 *      `t` — or a known type with a malformed shape — is DROPPED and recorded
 *      in `dropped[]`, never rendered. Whole-spec rejection is reserved for
 *      spec-LEVEL failures: an unparseable payload, too few slides after
 *      drops, a missing opener/closer, packaging citing a dropped figure.
 *      Measured live (2026-08-02): under the original fail-everything rule,
 *      two malformed `bars` cards killed an otherwise-valid 22-slide spec —
 *      1/3 yield for no editorial reason. The drop is still a refusal; it is
 *      just scoped to what was actually wrong.
 *
 *   2. NUMBERS NEED A TRACEABLE SOURCE. A `stat` or `bars` card whose `source`
 *      is not one of the outlets that actually covered this story is DROPPED.
 *      Not repaired, not attributed to the article by default — dropped. The
 *      failure mode being designed against is a fluent, plausible, wrong
 *      number under a real masthead, which is the single most expensive thing
 *      this pipeline could publish.
 *
 *   3. WHOSE REPORTING THIS IS, IS CODE-INJECTED, NEVER MODEL-EMITTED. That
 *      used to be a dedicated `attribution` card at position 1. DrJ removed it
 *      (2026-08-03): a whole slide of throat-clearing before the story starts,
 *      paid for out of the opening seconds that decide whether anyone stays.
 *      The TITLE card absorbed it — badge, date, and the video's single verbal
 *      credit in its caption. The card is gone; the rule is not. `outlet` and
 *      `date` on a title are stripped if the model writes them and injected by
 *      decorateTitleCard from the article row, because a model asked whose
 *      reporting this is will answer fluently whether or not it knows, and a
 *      fabricated byline is the worst thing this pipeline could put on screen.
 *
 * NO SCORE FIELD — measured on prod 2026-08-02, and the reason the credit
 * carries none:
 *   - `sources.quality_score` is populated on 0 of 154 sources. Unusable.
 *   - `articles.credibility` is real but coarse: a 4-value tier
 *     (7→13,116 · 9→11,800 · 8→10,045 · 10→4,517). Not a stuck default, but
 *     rendering a 4-value tier as "9.4" is false precision — inventing
 *     resolution the underlying data does not have, on the one card whose
 *     whole purpose is to be trustworthy.
 * So the credit names the outlet and its reporting, and carries NO score.
 * Do not add one back without a measurement that justifies it.
 *
 * BRAND INVARIANT, enforced here rather than in the renderer: accent #dde706
 * appears on EXACTLY ONE element per frame (brief §4). A card may carry at
 * most one "lime" line. Caught at validation, the model gets a retry; caught
 * at render, it's a re-render of the whole batch.
 */

// The ONLY import here, and it stays that way: this module is otherwise pure.
// videoAttribution imports nothing, so there is no cycle.
import { resolveAttribution } from "./videoAttribution.js";
import { restatesAny } from "./textSimilarity.js";
// Country codes are validated against the shipped atlas, not a pattern — see the
// map case below for why a plausible-but-absent code is the dangerous one.
import { knownCountry } from "./videoSubjectVisual.js";

// ─── The closed set ─────────────────────────────────────────────────────────

export const CARD_TYPES = Object.freeze([
  "title",    // opener — headline beat
  "stat",     // one dominant number
  "diagram",  // node chain / flow, optional marker on one node
  "bars",     // small comparison set
  "turn",     // the pivot beat: "but here is what that misses"
  "kicker",   // closer
  // ─── SUBJECT VISUALS ─────────────────────────────────────────────────────
  // The subject decides the visual, not the beat. Both of these carry an image
  // the CODE builds — the model never supplies a URL, a mount or a projection.
  "photo",    // a named person or place: the article's own photograph, mounted
  "map",      // a geographic subject: a locator map built from a country list
]);

// `turn` is DEFINED HERE, not inherited. Brief §3 lists it as
// { "t": "turn", "…": "…" } — genuinely unspecified. Shaped like `title`
// (a statement with an optional under-line) because it plays the same
// structural role at the hinge of the script rather than at its open.
// If the intended shape was different, this is the field list to change.

export const ACCENT_COLORS = Object.freeze(["white", "lime"]);
export const THUMBNAIL_ANGLES = Object.freeze([
  "scale", "number", "myth-break", "consequence", "question",
]);

// LENGTH IS A CEILING, NOT A TARGET. Duration sets the maximum runtime; the
// model is asked for the fewest cards the story genuinely supports. Measured
// 2026-08-02: a Karnataka rail story came back at 26 slides — a story with
// perhaps eight real beats, stretched to fill a quota it read as a target.
// Padding does not just waste runtime, it forces the model to manufacture
// content, which is where invented figures come from.
//
// MIN_SLIDES is therefore a THINNESS TEST, not a length preference: below the
// floor the article does not carry a video and is skipped, never padded up to
// it. Lowered 6 -> 5 on 2026-08-03 when the attribution card was absorbed into
// the title: the floor counted that code-injected card, so keeping 6 would
// have quietly raised the bar on the MODEL by one card overnight.
// ─── Series bounds — what the RENDERER can actually draw ────────────────────
//
// These were unbounded until 2026-08-12: the schema said "an array of 2 or
// more" and stopped there, while videoSlideRenderer did `bars.slice(0, 5)` and
// `nodes.slice(0, 6)`. A model emitting eight bars therefore got five drawn and
// three silently discarded — no error, no `dropped[]` entry, nothing in the
// log. The caption is written against the beat, so it could name a figure that
// is not on screen, and nobody would find out from anything but watching.
//
// Found while drafting the 9:16 layouts, but it is NOT a vertical problem: it
// has been true of the shipped 16:9 renderer since the card types existed.
// Vertical carries the same counts comfortably (measured: bars at a 190px row
// pitch, diagram as a downward rail), so these are the RENDERER's limits, not
// an aspect-ratio compromise.
//
// The upper bound is enforced as a per-card DROP rather than a spec rejection,
// which is rule 1's existing split: a malformed card is refused, the rest of
// the spec survives. Silent truncation is the one thing it must not be.
export const MIN_BARS = 2;
export const MAX_BARS = 5;
export const MIN_NODES = 2;
export const MAX_NODES = 6;

export const MIN_SLIDES = 5;
export const MAX_SLIDES = 34;

// Drop-rate gate. A spec can satisfy every surviving-card rule and still be a
// bad video: measured 2026-08-02, a peptides spec lost 15 of 26 cards and
// passed as ok — 11 slides of what the model planned as 26, with the argument
// it was building silently gutted. Slide-level rules cannot see that, because
// each surviving card is individually fine.
//
// Two independent ceilings, because they mean different things:
//   MAX_DROP_RATIO   — the model did not understand the contract. A spec this
//                      mangled should be regenerated, not salvaged.
//   MAX_SOURCING_DROPS — the model is reaching for numbers it cannot attribute.
//                      Tighter (2) because that is the failure mode Rule 2
//                      exists to stop, and a model doing it three times on one
//                      story is not having an accident.
export const MAX_DROP_RATIO = 0.40;
export const MAX_SOURCING_DROPS = 2;

// Beat kinds — the enumeration vocabulary of prompt rule 7. The model emits a
// `beats` array BEFORE `slides`; each beat is one concrete thing the source
// establishes, grounded by a verbatim phrase. Added 2026-08-02 after the
// prose version of the rubric produced 5 cards from every article: the model
// treated four beat KINDS as a four-item checklist — one card per kind — not
// as categories of instances. Making enumeration an output field forces the
// instances to exist as data, makes "one card per beat" checkable, and lets
// the logs show whether the model found 5 beats or 15.
export const BEAT_KINDS = Object.freeze(["figure", "mechanism", "turn", "consequence"]);

// KICKER REGISTER — a hard rule (DrJ, 2026-08-03).
//
// A kicker that wraps up is a retention leak at the exact moment a viewer
// decides whether to watch anything else: summarising tells them the thing is
// over and they already have it. The closer ends on the FORWARD implication —
// the consequence now in motion — never on a restatement of what was just said.
//
// AND NEVER ON A QUESTION (DrJ, 2026-08-14). This comment used to offer "or an
// open question" as an acceptable ending, which was wrong and was actively
// teaching the failure: a question is only clickbait when the ANSWER IS
// WITHHELD, and nothing follows the last card, so a question there is hanging by
// construction. Questions are welcome on the opener and mid-beats, where the
// next beat answers them — see CLOSER_QUESTION_ERROR and rule 10b.
//
// Enforced as a banned-phrase check rather than a style note because "don't
// summarise" is precisely the instruction models comply with least — it reads
// as a tone preference. These are the register markers, not a blocklist of
// words: matching one means the card is in summary voice.
export const KICKER_BANNED_PHRASES = Object.freeze([
  "in conclusion", "to conclude", "in summary", "to summarise", "to summarize",
  "in short", "all in all", "to sum up", "summing up", "overall",
  "in the end", "at the end of the day", "ultimately",
  "as we have seen", "as we saw", "as mentioned", "as discussed",
  "that is the story", "that's the story", "so there you have it",
  "there you have it", "the takeaway", "key takeaway", "to recap", "recapping",
  "in essence", "essentially then", "the bottom line",
]);

// ─── ARC: the cold open (B1) ────────────────────────────────────────────────
//
// The title caption used to restate the headline. Read aloud, that makes the
// first ten seconds redundant with the thumbnail a viewer has already read —
// and ten seconds is where the retention decision is made.
//
// A REJECTION, NOT A DROP, and that distinction is load-bearing. Content cards
// must equal beats.length exactly (see the beats pass), so dropping the title
// card to punish its caption would trip "first surviving card must be title"
// one check later and report the wrong cause. Arc violations are spec-level:
// they consume the EXISTING single regeneration retry and add no second budget.
//
// Measured with the SAME similarity function the selector uses to answer "is
// this the same story I already published?" — restatement is restatement, and a
// second, differently-computed overlap measure is how the event graph's
// create-merge-split treadmill started. See textSimilarity.js.
export const HOOK_RESTATES_ERROR = "hook_restates_headline";

// ─── MOTIVE ASCRIBED TO A NAMED PERSON ──────────────────────────────────────
//
// THE FAILURE (DrJ, 2026-08-15, from a live dry run). The source said a
// protective detail HAS BLOCKED service of a lawsuit — a fact about an obstacle.
// The caption said a court must decide whether the family can "use taxpayer-
// funded security to keep a lawsuit at bay" — a PURPOSE, ascribed to three named
// living people, that the article never establishes. Conversational syntax
// turning into judgement.
//
// WHY WORD-GROUNDING CANNOT CATCH THIS, and it was the first thing I tried:
// every word in that caption IS in the source. "Lawsuit", "security",
// "protection" all appear. What was invented is the RELATION between them —
// effect reframed as intent. No overlap measure sees the difference, and a
// general "is this motive supported?" test is an inference problem a regex has
// no business pretending to solve.
//
// SO THE RULE IS NOT "IS IT SUPPORTED" BUT "WHO SAYS SO". A caption may not
// ascribe intent, purpose or motive to a NAMED party unless it also attributes
// that claim to someone. This is ordinary wire practice — you report that a
// filing alleges a motive, you do not assert the motive yourself — and it gives
// the model a legitimate route to the same content rather than banning the idea:
//
//   REFUSED  "The family can use their security detail to keep the suit at bay."
//   ALLOWED  "The plaintiffs say the detail is being used to keep the suit at bay."
//   ALLOWED  "The protection has blocked three attempts to serve papers."
//
// The last is what the source actually said, and it is the stronger sentence.
// THE BARE INFINITIVE OF PURPOSE, BY CLASS.
//
// "Trump has already scaled back his claims TO PROTECT his own business empire"
// (DrJ, 2026-08-16) turns a sequence into a purpose — the source says he
// narrowed them AFTER the BBC subpoenaed financial documents. The gate did not
// fire, and the reason was not the exemption: `protect` was simply not here.
//
// Every verb this list held was an EVASION verb, because the list was written
// from a live failure about evading service. That is the same mistake as the
// intensifier list, in the same week: a register was named by way of the one
// word that had happened to appear. The model is not reaching for "avoid", it
// is reaching for a purpose clause, and the purposes ascribed to people in news
// copy come in three recognisable flavours. So the CLASSES are named — here and
// in rule 10c, which `videoPromptCoverage.test.js` now checks.
//
// Adding the two new classes widens what the gate catches, and therefore what it
// can catch wrongly ("the law was written TO PROTECT tenants" is a statute's
// purpose, not a person's hidden one). For now that is cushioned by
// motiveIsReported: a purpose the source states is exempt, and a statute's
// purpose is invariably stated. Anyone closing LEAK 3 must re-check this — the
// cushion goes away with it.
export const PURPOSE_EVASION = Object.freeze(
  ["avoid", "evade", "dodge", "escape", "sidestep", "stall", "frustrate"]);
export const PURPOSE_PROTECTIVE = Object.freeze(
  ["protect", "shield", "safeguard", "preserve", "defend", "insulate", "secure"]);
export const PURPOSE_COERCIVE = Object.freeze(
  ["force", "pressure", "punish", "discredit", "silence"]);
export const PURPOSE_VERBS = Object.freeze(
  [...PURPOSE_EVASION, ...PURPOSE_PROTECTIVE, ...PURPOSE_COERCIVE]);

/** A photo `subject` offering alternatives instead of naming one thing. */
export const SUBJECT_HEDGE = /\s+or\s+|\s*\/\s*|\beither\b/i;

const MOTIVE_MARKERS = new RegExp([
  /\bin order to\b/, /\bso as to\b/, /\bin an effort to\b/, /\bin a bid to\b/,
  /\bas a way to\b/, /\bas a means to\b/, /\bdeliberately\b/, /\bintentionally\b/,
  /\bon purpose\b/, /\btrying to\b/, /\bseeking to\b/, /\baiming to\b/,
  /\bhoping to\b/, /\bintends? to\b/, /\bintended to\b/, /\bdesigned to\b/,
  /\bmeant to\b/, /\brefus(?:e|es|ing) to\b/, /\bwants? to\b/,
  // The shape the live failure took: an instrument put to a purpose.
  /\bus(?:e|es|ing) [^.]{0,60}? to \w+/,
  new RegExp(`\\bto (?:${PURPOSE_VERBS.join("|")})\\b`),
  /\bto keep [^.]{0,40}? at bay\b/,
].map(r => r.source).join("|"), "i");

// Saying WHOSE claim it is. Deliberately generous: the point is to make
// attribution the easy path, not to police how it is phrased.
const ATTRIBUTION_MARKERS =
  /\b(say|says|said|saying|according to|alleges?|alleged|claims?|claimed|argues?|argued|accus\w+|contends?|maintains?|reportedly|denies|denied|filing|lawsuit (?:says|alleges|argues)|court heard)\b/i;

// NO "IS ANYONE NAMED HERE" TEST, and the live failure is why. The first draft
// required a proper noun in the caption, on the theory that exposure needs a
// named party. It did not fire on the sentence that prompted this rule: the
// caption said "the Foreman family" — one capitalised surname followed by a
// lowercase noun — and the three individuals were named ELSEWHERE in the video,
// not in the offending caption. A subject introduced two cards earlier is just
// as identifiable to a viewer as one named in the sentence.
//
// So the rule is unconditional: no caption asserts a motive on its own
// authority. Attribution is always available, always cheap, and always better
// journalism, so the gate costs a rewrite rather than the idea.

// ─── REPORTED INTENT IS NOT ASSERTED INTENT ─────────────────────────────────
//
// THE FALSE POSITIVES (DrJ, 2026-08-15). Two of three flags on a live run were
// wrong, and they killed the article:
//
//   "The broadcaster wants to use certified mail"
//   "To prove what Trump actually intended that day, the broadcaster…"
//
// Both are the BBC's OWN filed position, stated in the filing the article
// reports. The gate fired on the verb without asking whose intent it was or
// whether anyone had stated it — and a party's own stated purpose is reporting,
// not an assertion. It would have hit legal and political stories hardest:
// exactly the ones where parties put their intentions on the record.
//
// THE DISTINCTION THAT IS ACTUALLY CHECKABLE. Not "who is the grammatical
// subject" — that needs parsing this codebase has no business attempting — but
// DOES THE SOURCE ITSELF PUT THIS INTENT ON THE RECORD. A source sentence that
// (a) states a purpose or a speech/filing act AND (b) is about the same thing
// the caption is about, means the intent came from the reporting rather than
// from us.
//
//   BBC filing:  "The BBC has asked the court for alternative means of service,
//                 such as certified mail…"  -> request verb + shares "certified",
//                 "mail" with the caption -> REPORTED, allowed.
//   Secret Service: "Their protective detail has blocked three attempts to serve
//                 papers."  -> no purpose, no speech act -> ASSERTED, refused.
//
// It is deliberately asymmetric. A false positive kills an article; a false
// negative leaves one motive claim for rule 10c and a human to catch. After
// this run the asymmetry runs the other way from where it started.
const REPORTED_SPEECH = /\b(say|says|said|told|asks?|asked|request(?:s|ed)?|argu(?:e|es|ed)|fil(?:e|es|ed|ing)|seek(?:s|ing)?|sought|urge[sd]?|appl(?:y|ies|ied)|claim(?:s|ed)?|alleg(?:e|es|ed)|deni(?:es|ed)|propos(?:e|es|ed)|plans?|intends?|wants?|according to|in (?:its|their|his|her) (?:filing|petition|submission|statement))\b/i;

/** Content words, long enough to be about something. Mirrors tooSimilar's >4. */
const contentWords = (s) => [...new Set(
  String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 4)
)];

/**
 * Is this intent already ON THE RECORD in the source?
 *
 * Needs BOTH: a source sentence that states a purpose or a speech/filing act,
 * and enough shared subject matter that it is plainly the same claim. Two
 * content words is the bar — one is a coincidence in a long article.
 */
export function motiveIsReported(text, sourceText) {
  if (!sourceText) return false;
  const terms = new Set(contentWords(text));
  if (terms.size === 0) return false;
  // A TWO-SENTENCE WINDOW, not a single sentence. A filing is routinely reported
  // across a pair — "asked the court for alternative means, such as certified
  // mail. In its filing the broadcaster said it needs the deposition to prove…"
  // — and a single-sentence test failed exactly there: "broadcaster" and
  // "certified" were one sentence apart, so the real case scored 1 and the
  // article died.
  const sentences = String(sourceText).split(/(?<=[.!?])\s+/);
  // And the bar is min(2, terms) so a short caption is not impossible to clear:
  // "The broadcaster wants to use certified mail" carries two content words in
  // total, and requiring three of two is a gate nothing can pass.
  const need = Math.min(2, terms.size);
  for (let i = 0; i < sentences.length; i++) {
    const window = sentences.slice(i, i + 2).join(" ");
    if (!MOTIVE_MARKERS.test(window) && !REPORTED_SPEECH.test(window)) continue;
    let shared = 0;
    for (const w of contentWords(window)) if (terms.has(w) && ++shared >= need) return true;
  }
  return false;
}

/**
 * The gate's full reasoning, not just its answer: WHICH branch decided, and for
 * an exemption, what granted it.
 *
 * Built for the false-positive corpus (DrJ, 2026-08-16). A harvest that yields
 * only captions is a pile of sentences somebody still has to re-judge; a harvest
 * that yields VERDICTS is something that can be checked. It also separates the
 * two open leaks in live data — `exempt_attribution` is LEAK 2 and names the
 * word that did it, `exempt_reported` is LEAK 3 — so their real blast radii can
 * be counted before either fix is designed.
 *
 * `unattributedMotive` DELEGATES to this rather than duplicating it. A separate
 * diagnostic would be a second implementation of the gate, free to drift from
 * the real one, and a corpus labelled by a drifting copy is worse than no corpus
 * — it would look empirical while being wrong, which is the whole failure this
 * corpus exists to avoid.
 *
 *   no_caption          nothing to judge
 *   no_motive           no motive marker present
 *   exempt_attribution  the caption says whose claim it is  (`by`: the word)
 *   exempt_no_source    nothing to accuse against
 *   exempt_reported     the source puts this intent on the record
 *   fired               an unattributed motive
 */
export function motiveVerdict(caption, sourceText = "") {
  const c = String(caption || "").trim();
  if (!c) return { verdict: "no_caption", motive: null };
  const motive = c.match(MOTIVE_MARKERS);
  if (!motive) return { verdict: "no_motive", motive: null };
  const found = motive[0];
  const attributed = c.match(ATTRIBUTION_MARKERS);
  if (attributed) return { verdict: "exempt_attribution", motive: found, by: attributed[0] };
  // WITHOUT A SOURCE THERE IS NO CASE. The gate accuses the script of inventing
  // an intent; with nothing to compare against, that accusation cannot be made
  // fairly — and firing on absent evidence is how the first version killed an
  // article whose motive was in the filing all along.
  if (!sourceText) return { verdict: "exempt_no_source", motive: found };
  if (motiveIsReported(c, sourceText)) return { verdict: "exempt_reported", motive: found };
  return { verdict: "fired", motive: found };
}

/**
 * Does this caption assert a motive without saying whose claim it is?
 * Returns the offending phrase, or null.
 */
export function unattributedMotive(caption, sourceText = "") {
  const v = motiveVerdict(caption, sourceText);
  return v.verdict === "fired" ? v.motive : null;
}
export const MOTIVE_ERROR = "unattributed_motive";

/**
 * Every string a VIEWER READS OR HEARS on this card.
 *
 * The motive gate originally checked `caption` alone, and DrJ's second reading
 * found why that is not enough: the display type was "THE SECRET SERVICE
 * SHIELD" and the closer said "indefinitely". A two-word display line carries
 * more framing per word than a caption does — it is on screen, in the largest
 * type on the card, with no sentence around it to qualify it.
 */
export function displayStrings(card) {
  if (!card || typeof card !== "object") return [];
  const out = [];
  const push = (v) => { if (typeof v === "string" && v.trim()) out.push(v); };
  push(card.caption); push(card.sub); push(card.top); push(card.bottom);
  for (const ln of Array.isArray(card.lines) ? card.lines : []) {
    // `lines` is [text, colour] pairs on title/turn/photo/map, and plain
    // strings on stat. Both shapes are display type and both count.
    push(Array.isArray(ln) ? ln[0] : ln);
  }
  for (const b of Array.isArray(card.bars) ? card.bars : []) push(Array.isArray(b) ? b[0] : null);
  for (const n of Array.isArray(card.nodes) ? card.nodes : []) {
    if (Array.isArray(n)) { push(n[0]); push(n[1]); }
  }
  if (card.marker && typeof card.marker === "object") { push(card.marker.label); push(card.marker.sub); }
  return out;
}

// ─── ABSOLUTES AND INTENSIFIERS ─────────────────────────────────────────────
//
// The second half of DrJ's reading: the closer said the detention could continue
// "indefinitely", which no beat's evidence supported. That is a DIFFERENT defect
// from an invented motive and it needs a different test — and, unlike a motive,
// it is genuinely checkable, because an intensifier is a WORD rather than a
// relation. Either the source says the thing is indefinite or we decided it was.
//
// Deliberately a short list of words that RAISE A CLAIM rather than describe
// one. "All" and "every" are excluded despite being absolutes: "all but one
// African nation" is the accurate phrasing of a real policy, and a gate that
// fires on accurate reporting teaches people to route around it.
//
// Matched by STEM, so "indefinite" in the source licenses "indefinitely" in the
// script — this checks that the idea came from the article, not morphology.
//
// EXPORTED FOR THE PROMPT-COVERAGE GUARD, and for nothing else in production.
// Every stem here must be named in the prompt: a word this list rejects and the
// prompt never mentions is a rejection loop the model cannot escape, because it
// has no way to learn the rule from the outside. It reaches for a neighbouring
// word and is rejected again. `videoPromptCoverage.test.js` fails when a stem is
// added without prompt text, which is the only thing that keeps the two in step.
export const INTENSIFIER_STEMS = Object.freeze([
  "indefinit", "forever", "permanent", "unprecedent", "historic", "massiv",
  "enormous", "catastroph", "devastat", "crippl", "soar", "plummet",
  "sweeping", "endless", "unparallel", "staggering", "shocking", "damning",
  "utterly", "completely", "entirely", "totally",
]);

/**
 * Intensifiers used in the script that the source never used. Returns the
 * offending stems, or an empty array.
 */
export function unsupportedIntensifiers(strings, sourceText) {
  if (!sourceText) return [];
  const src = String(sourceText).toLowerCase();
  const hay = strings.join(" ").toLowerCase();
  return INTENSIFIER_STEMS.filter(stem => hay.includes(stem) && !src.includes(stem));
}
export const INTENSIFIER_ERROR = "unsupported_intensifier";


// ─── ARC: the closer (B3) ───────────────────────────────────────────────────
//
// KICKER_BANNED_PHRASES already catches summary REGISTER ("in conclusion", "the
// takeaway"). It cannot catch a closer that summarises without announcing it —
// one that simply says the headline again in different words, or circles back
// to the opening caption. That closes the loop at the exact moment the video
// should be opening one, and it is the commonest shape the model reaches for.
//
// Checked against BOTH the headline and the opening caption, and either match
// rejects. Restating the headline and restating your own cold open are the same
// editorial failure — the video ends where it began — so they share an error
// code, and `restatesAny` reports WHICH one matched so the retry note can say.
export const CLOSER_RESTATES_ERROR = "closer_restates";

// ─── ARC: the hanging closer question (DrJ, 2026-08-14) ─────────────────────
//
// THE RULING: a question is only clickbait when the answer is withheld. "So who
// actually pays for this?" answered by the next beat is the strongest hook shape
// available; the same question left hanging is the cheap one. So questions are
// PERMITTED on the opener and mid-beats — BRIDGE_PUNCT counts a trailing "?" as
// a valid bridge and that was right all along — and FORBIDDEN on the closer,
// where nothing follows and the answer therefore cannot arrive.
//
// TRAILING-ONLY, and that is the whole subtlety. "So who pays? Households do."
// on the closer is a question ASKED AND ANSWERED inside one caption, which is
// exactly the legitimate shape; its "?" is not at the end. Matching anywhere in
// the string would reject the good version along with the bad one.
export const CLOSER_QUESTION_ERROR = "closer_question";
export const TRAILING_QUESTION = /\?["'\u201d\u2019)\]]*\s*$/;

// ─── ARC: opening-stem repetition (B2) ──────────────────────────────────────
//
// A WARNING, NEVER A REJECT — deliberately the opposite of B1.
//
// The failure this makes visible is five captions all opening "But here's the
// catch". The obvious fix is what CAUSES it: give the model a list of approved
// openers and it picks one and reuses it; ban a phrase and it finds one
// synonym and reuses that. So the prompt prescribes NO openers at all and
// states the requirement as a relationship between adjacent beats, and this
// check exists only so the monotony shows up in the harness when it happens.
//
// It cannot be a gate. There is no threshold separating "monotonous" from
// "three captions legitimately begin with the subject's name", and a false
// rejection costs a whole video — while a false warning costs a log line.
export const MAX_SHARED_STEM = 2;
export const STEM_WORDS = 3;

/**
 * Opening stems carried by more than `max` captions, commonest first.
 *
 * Captions shorter than the stem length are skipped rather than padded — a
 * two-word caption has no three-word opening, and padding one would invent a
 * stem that isn't there.
 *
 * @returns {Array<{stem: string, count: number}>}
 */
export function repeatedOpeningStems(captions, { stemWords = STEM_WORDS, max = MAX_SHARED_STEM } = {}) {
  const counts = new Map();
  for (const c of captions) {
    const words = String(c || "")
      .toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim()
      .split(/\s+/).filter(Boolean);
    if (words.length < stemWords) continue;
    const stem = words.slice(0, stemWords).join(" ");
    counts.set(stem, (counts.get(stem) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n > max)
    .sort((a, b) => b[1] - a[1])
    .map(([stem, count]) => ({ stem, count }));
}

// CAPTION BRIDGING — a STYLE SIGNAL, never a reject.
//
// Each caption should end with a pull into the next beat. This cannot be
// detected reliably, so it is deliberately not a gate: the check looks for
// forward-pointing devices and warns only when MOST content captions carry
// none. It is a nudge in the logs for prompt tuning, and a false warning costs
// nothing because nothing is refused on it.
const BRIDGE_MARKERS = /\b(but|yet|until|unless|however|still|though|because|which is why|that is why|so far|not yet|next|then|now|what happens|the problem|the catch|the question|turns out|except)\b/i;
const BRIDGE_PUNCT = /[?:…]\s*$|—\s*$/;
export const MIN_BRIDGE_SHARE = 0.5;

export function captionBridges(caption) {
  const c = String(caption || "").trim();
  if (!c) return false;
  return BRIDGE_PUNCT.test(c) || BRIDGE_MARKERS.test(c);
}

// CAPTION LENGTH — a WRITING CONSTRAINT, never a gate (DrJ, 2026-08-03).
//
// DERIVED FROM MEASUREMENT, not chosen. At the rendered caption size (34px)
// against the caption band's usable width (1608px), measured through the real
// font via renderCore.measureTextWidth:
//   - average advance on caption prose: 16.88px/char
//   - two-line budget: 1608 x 2 = 3216px -> 190 chars theoretical
//   - longest real-prose prefix still wrapping to two lines: 192 chars
//   - natural captions in the corpus run 120-145 chars and fit comfortably
// 160 sits above natural sentence length and below the measured ceiling, so it
// binds only on genuinely long captions and leaves room for the word-boundary
// waste that wrapping causes at the end of each line.
//
// NO VALIDATION CEILING, deliberately. A three-line caption sits slightly
// higher than the band intends; discarding an otherwise good video over one
// long sentence is a far larger cost. videoAssembler keeps its warning — which
// is now a TRUE report, since wrapCaption measures through the real font
// rather than predicting from character count — and nothing is refused on it.
export const CAPTION_MAX_CHARS = 160;

// CAPTION FLOOR — the other end of the same writing constraint, and a gate for
// exactly as long as the ceiling is: never.
//
// SLIDE DURATION IS AUDIO DURATION (§5), so a short caption is a short slide,
// and a short slide loses beats. Measured through the real fitStatesToDuration
// at ~2.6 words/sec, across every card type:
//
//   caption chars   secs   states kept
//   150 ... 70      9.5 ... 4.4   all of them
//   60              3.8           4 of 5 — a beat is dropped
//
// So 70 is where the collapse rule starts eating content rather than pacing.
// It becomes load-bearing the moment captions move to a spoken register, which
// is naturally shorter than the written prose the corpus was measured on: the
// ceiling used to be the only edge anyone could hit, and now there are two.
//
// NOT VALIDATED, deliberately, for the same reason as the ceiling — discarding
// an otherwise good video over one terse sentence costs far more than the
// dropped beat does. It needs no separate warning either: fitStatesToDuration
// already logs every collapse, so a caption under this floor announces itself
// in the cycle log as the beat it dropped.
export const CAPTION_MIN_CHARS = 70;

// §3b/5 — THE PIPELINE'S OWN LAYER. A spec made only of title + stat + kicker
// is a restatement of someone else's article with numbers pulled out: no
// analysis added, nothing that is ours. §3b names this as BOTH the
// transformative element (the copyright argument) and the differentiator (the
// editorial one), which is why it is a gate rather than a preference. At least
// one card must be a diagram or a turn — the two types that exist to say
// something the source did not say in that form.
export const OWN_LAYER_TYPES = Object.freeze(["diagram", "turn"]);

// Card-type mix. See the mix pass in validateSpec for the derivation.
export const MAX_TYPE_SHARE = 1 / 3;
export const MAX_CONSECUTIVE_SAME_TYPE = 2;
// Any type may always keep at least this many cards. This floor is what lets
// the gate run at EVERY size instead of being suspended below a threshold:
// the exact 1/3 solution is aggressive at small n (on a 6-card spec it caps a
// type at 1), and a floor of 2 pairs naturally with the run limit — two of a
// kind is exactly what MAX_CONSECUTIVE_SAME_TYPE already permits.
//
// The previous MIX_MIN_CARDS=9 suspension is REMOVED. Measured 2026-08-02:
// every live spec came back at 6 cards, so the gate never executed once — a
// dormant gate is indistinguishable from no gate.
export const MIN_CARDS_PER_TYPE = 2;
// Structural singletons, pinned by the first/last rules. Exempt from the
// share cap only — they are still subject to every per-card rule.
const SHARE_EXEMPT_TYPES = new Set(["title", "kicker"]);

// Per-type: required fields, and the optional ones we accept. Anything not
// listed is stripped rather than passed through to the renderer — an unknown
// field is either model noise or a contract drift, and both should be visible
// as a diff against this table rather than silently reaching a layout function.
const CARD_FIELDS = {
  // `outlet` and `date` are CODE-INJECTED onto the title by decorateTitleCard,
  // never model-emitted — they are the absorbed attribution card (see below).
  title:   { required: ["lines", "caption"],                 optional: ["eyebrow", "sub", "outlet", "date"] },
  // `visual` is the optional cutaway hint: a concrete noun naming something the
  // beat makes visible, resolved at render time against the curated library.
  // It is offered ONLY on the four type-only cards. `photo` and `map` already
  // carry imagery of their own, and a cutaway over them would replace the
  // picture the card exists to show; `title` and `kicker` are the wrappers.
  // Most beats have no visual, and that is the normal case — see the selection
  // rules in videoStockLibrary.js.
  stat:    { required: ["value", "caption", "source"],       optional: ["eyebrow", "unit", "lines", "hi", "visual"] },
  diagram: { required: ["nodes", "caption"],                 optional: ["eyebrow", "marker", "visual"] },
  bars:    { required: ["bars", "caption", "source"],        optional: ["eyebrow", "source_note", "visual"] },
  turn:    { required: ["lines", "caption"],                 optional: ["eyebrow", "sub", "visual"] },
  kicker:  { required: ["top", "bottom", "caption"],         optional: ["sub"] },
  // `photo` carries NO image field. The photograph is the article's own
  // (image_url), and the MOUNT is a design decision made in code — a model
  // choosing between a polaroid and a torn cutting is a model art-directing.
  // `subject` is REQUIRED and is the whole point of the card: it declares what
  // the photograph is expected to SHOW. Without it the renderer takes image_url
  // on trust and nothing anywhere can notice a mismatch — which is the tariffs
  // failure with a new name (DrJ, 2026-08-15).
  photo:   { required: ["lines", "caption", "subject"],      optional: ["eyebrow", "sub"] },
  // `codes` are ISO 3166-1 alpha-3. `exception` is the ONE member of the set
  // the story excludes — the "all but one" case, which is unreadable without a
  // callout because the excepted country is often a couple of pixels wide.
  map:     { required: ["codes", "caption"],                 optional: ["eyebrow", "exception", "lines"] },
};

// Card types the MODEL is allowed to emit. The `attribution` card is GONE —
// the title card absorbed its badge, date and verbal credit (DrJ, 2026-08-03),
// which removes a whole slide of throat-clearing before the story starts.
// What the model still may not write are the title's `outlet` and `date`
// fields; those are stripped and code-injected. See decorateTitleCard.
export const MODEL_EMITTABLE = Object.freeze([...CARD_TYPES]);

// The two types whose content is an IMAGE the code builds. The schema and the
// renderer know them unconditionally — that is what makes shipping them behind a
// prompt flag safe, because a card the model somehow emits with the flag off
// still validates and still draws. What the FLAG gates is whether the prompt
// asks for them at all. See videoSpecWriter.subjectVisualsEnabled.
export const SUBJECT_VISUAL_TYPES = Object.freeze(["photo", "map"]);
export const CODE_INJECTED_TITLE_FIELDS = Object.freeze(["outlet", "date"]);

// ─── Small helpers ──────────────────────────────────────────────────────────

const isStr    = (v) => typeof v === "string" && v.trim().length > 0;
const isNum    = (v) => typeof v === "number" && Number.isFinite(v);
const isArr    = (v) => Array.isArray(v);
const norm     = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Digits only, punctuation stripped — mirrors scriptWriter.verifyGrounding. */
const bareDigits = (s) => String(s).replace(/[^\d]/g, "");

/**
 * Outlet-name match, both directions. The model writes "BBC News" where the
 * DB says "BBC", and vice versa; requiring equality would drop cards that are
 * correctly attributed, which trains exactly the wrong instinct into the
 * prompt. Substring-either-way on the normalised form, with a 3-char floor so
 * "AP" doesn't match "Sport".
 */
function sourceMatches(claimed, allowed) {
  const c = norm(claimed);
  if (c.length < 2) return false;
  for (const a of allowed) {
    const n = norm(a);
    if (!n) continue;
    if (c === n) return true;
    if (c.length >= 3 && n.includes(c)) return true;
    if (n.length >= 3 && c.includes(n)) return true;
  }
  return false;
}

// Words that appear in so many mastheads that they identify none of them.
// Matching on one of these is how "News of the outage spread" would credit
// "BBC News" — the appearance of attribution with none of the substance.
const GENERIC_MASTHEAD_WORDS = new Set([
  "news", "the", "times", "post", "daily", "press", "media", "wire",
  "journal", "herald", "tribune", "gazette", "review", "report", "reports",
  "today", "online", "network", "service", "agency", "group", "and",
]);

/**
 * Does this caption actually say the outlet's name?
 *
 * Mirrors sourceMatches' tolerance in one direction only: "BBC" in the caption
 * satisfies a source of "BBC News", because that is how a newsreader says it.
 * The reverse is NOT accepted — a caption saying "News" would otherwise credit
 * "BBC News", which is no credit at all. Short outlet names (AP, PA) are
 * matched on a word boundary so they cannot be satisfied by a substring.
 */
function captionCreditsSource(caption, source) {
  const cap = norm(caption);
  const src = norm(source);
  if (!cap || !src) return false;
  if (cap.includes(src)) return true;
  // A single word only credits the outlet if it IDENTIFIES it. "BBC" credits
  // "BBC News"; "News" does not, and would otherwise let a caption about
  // "news of the outage" pass as attribution to any masthead with News in it.
  return src.split(" ")
    .filter(w => w.length >= 3 && !GENERIC_MASTHEAD_WORDS.has(w))
    .some(w => new RegExp(`\\b${w}\\b`).test(cap));
}

// ─── Per-card validation ────────────────────────────────────────────────────

/**
 * Shape check for one card. Returns an array of error strings — empty is valid.
 * Structural only; source traceability and numeric grounding are separate
 * passes because they carry different consequences (drop vs fail).
 */
function validateCardShape(card, idx) {
  const e = [];
  const at = `slides[${idx}]`;

  if (!card || typeof card !== "object") return [`${at}: not an object`];

  const t = card.t;
  if (!isStr(t))                 return [`${at}: missing card type "t"`];
  if (!CARD_TYPES.includes(t))   return [`${at}: unknown card type "${t}" (closed set: ${CARD_TYPES.join(", ")})`];

  const spec = CARD_FIELDS[t];
  for (const f of spec.required) {
    if (card[f] === undefined || card[f] === null) e.push(`${at} (${t}): missing required field "${f}"`);
  }

  // caption is the narration line — brief §3. An empty caption means a slide
  // with no voiceover, which desynchronises everything after it.
  if (card.caption !== undefined && !isStr(card.caption)) e.push(`${at} (${t}): "caption" must be a non-empty string`);

  // `visual` is TYPE-checked here and no more. Whether the noun is usable — a
  // short phrase, not a hedge — and whether anything in the library matches it
  // are decided at selection, which is where the log line naming the noun is
  // emitted. Judging it here would mean either dropping a good content card
  // over an optional hint, or stripping the field silently; the selection path
  // reports it by name instead, and an unusable visual simply yields no cutaway.
  if (card.visual !== undefined && !isStr(card.visual)) {
    e.push(`${at} (${t}): "visual" must be a string naming one concrete thing, or be omitted`);
  }

  switch (t) {
    case "title":
    case "turn":
    // `photo` carries the same [text, colour] line pair over its mounted
    // photograph. Sharing the case rather than copying it means the lime
    // invariant is checked in one place for all three.
    case "photo": {
      if (t === "photo") {
        if (card.subject !== undefined && !isStr(card.subject)) {
          e.push(`${at} (photo): "subject" must be a non-empty string naming what the photograph should show`);
        } else if (isStr(card.subject) && card.subject.trim().split(/\s+/).length > 8) {
          // A subject is a noun phrase — "Aung San Suu Kyi", "the Port of
          // Mombasa". A sentence here means the model is describing the beat
          // again rather than naming a thing that can be looked for.
          e.push(`${at} (photo): "subject" is a noun phrase, not a sentence — got ${card.subject.trim().split(/\s+/).length} words`);
        } else if (isStr(card.subject) && SUBJECT_HEDGE.test(card.subject)) {
          // A HEDGE MEANS THE MODEL DID NOT CHOOSE (DrJ, 2026-08-16). "Donald
          // Trump Jr. or Trump Tower" is six words and passed the length check,
          // but the field declares ONE thing to photograph — a disjunction hands
          // the renderer an ambiguous instruction and there is no rule by which
          // it could pick. The word count could never catch this, because the
          // defect is the shape rather than the length.
          //
          // " or " and a bare slash only. NOT " and ", which is ordinary inside
          // real names — "Health and Human Services", "Marks and Spencer" — and
          // would reject correct subjects far more often than it caught hedges.
          e.push(`${at} (photo): "subject" hedges between alternatives ("${card.subject.trim()}") — name ONE thing to photograph`);
        }
      }
      // Code-injected on `title` only (the absorbed attribution card). Shape is
      // still checked, because injection is code and code has bugs.
      if (card.outlet !== undefined && !isStr(card.outlet)) e.push(`${at} (${t}): "outlet" must be a non-empty string`);
      if (card.date   !== undefined && !isStr(card.date))   e.push(`${at} (${t}): "date" must be a string when present`);
      if (card.lines !== undefined) {
        if (!isArr(card.lines) || card.lines.length === 0) {
          e.push(`${at} (${t}): "lines" must be a non-empty array`);
        } else {
          let limeCount = 0;
          card.lines.forEach((ln, i) => {
            if (!isArr(ln) || ln.length !== 2) { e.push(`${at} (${t}): lines[${i}] must be [text, color]`); return; }
            const [text, color] = ln;
            if (!isStr(text))                       e.push(`${at} (${t}): lines[${i}] text must be a non-empty string`);
            if (!ACCENT_COLORS.includes(color))     e.push(`${at} (${t}): lines[${i}] color must be one of ${ACCENT_COLORS.join("|")}`);
            if (color === "lime") limeCount++;
          });
          // Brand invariant — accent on exactly one element per frame.
          if (limeCount > 1) e.push(`${at} (${t}): ${limeCount} lime lines — accent is exactly one element per frame`);
        }
      }
      break;
    }
    case "stat": {
      if (card.value !== undefined && !isNum(card.value)) e.push(`${at} (stat): "value" must be a number`);
      if (card.unit  !== undefined && typeof card.unit !== "string") e.push(`${at} (stat): "unit" must be a string`);
      if (card.lines !== undefined) {
        if (!isArr(card.lines) || !card.lines.every(isStr)) e.push(`${at} (stat): "lines" must be an array of non-empty strings`);
      }
      if (card.hi !== undefined) {
        const n = isArr(card.lines) ? card.lines.length : 0;
        if (!Number.isInteger(card.hi) || card.hi < 0 || card.hi >= n) {
          e.push(`${at} (stat): "hi" must index into lines (0..${Math.max(0, n - 1)})`);
        }
      }
      break;
    }
    case "diagram": {
      if (card.nodes !== undefined) {
        if (!isArr(card.nodes) || card.nodes.length < MIN_NODES) {
          e.push(`${at} (diagram): "nodes" must be an array of ${MIN_NODES} or more`);
        } else if (card.nodes.length > MAX_NODES) {
          // DROPPED, not trimmed. The renderer draws MAX_NODES and used to
          // discard the rest without a word; the caption is written against the
          // whole chain, so a quietly shortened one can describe a step the
          // viewer never sees.
          e.push(`${at} (diagram): ${card.nodes.length} nodes exceeds the ${MAX_NODES} the renderer can draw — split the mechanism across two cards rather than losing steps`);
        } else {
          card.nodes.forEach((nd, i) => {
            if (!isArr(nd) || nd.length !== 2 || !isStr(nd[0])) {
              e.push(`${at} (diagram): nodes[${i}] must be [label, sub]`);
            }
          });
        }
      }
      if (card.marker !== undefined) {
        const n = isArr(card.nodes) ? card.nodes.length : 0;
        if (typeof card.marker !== "object" || card.marker === null) {
          e.push(`${at} (diagram): "marker" must be an object`);
        } else {
          if (!Number.isInteger(card.marker.on) || card.marker.on < 0 || card.marker.on >= n) {
            e.push(`${at} (diagram): marker.on must index into nodes (0..${Math.max(0, n - 1)})`);
          }
          if (!isStr(card.marker.label)) e.push(`${at} (diagram): marker.label must be a non-empty string`);
        }
      }
      break;
    }
    case "bars": {
      if (card.bars !== undefined) {
        if (!isArr(card.bars) || card.bars.length < MIN_BARS) {
          e.push(`${at} (bars): "bars" must be an array of ${MIN_BARS} or more`);
        } else if (card.bars.length > MAX_BARS) {
          e.push(`${at} (bars): ${card.bars.length} bars exceeds the ${MAX_BARS} the renderer can draw — keep the ${MAX_BARS} that carry the comparison rather than losing the tail silently`);
        } else {
          card.bars.forEach((b, i) => {
            if (!isArr(b) || b.length !== 2 || !isStr(b[0]) || !isNum(b[1])) {
              e.push(`${at} (bars): bars[${i}] must be [label, number]`);
            }
          });
        }
      }
      break;
    }
    case "kicker": {
      if (card.top    !== undefined && !isStr(card.top))    e.push(`${at} (kicker): "top" must be a non-empty string`);
      if (card.bottom !== undefined && !isStr(card.bottom)) e.push(`${at} (kicker): "bottom" must be a non-empty string`);
      break;
    }

    case "photo_subject_unused": break;
    case "map": {
      // COUNTRY CODES ARE CHECKED AGAINST THE ACTUAL GEOMETRY, not a regex. A
      // plausible-looking code the atlas does not carry would draw an empty map,
      // which is worse than no map: the card would render, say nothing, and
      // nobody would know a country was missing. An unknown code invalidates the
      // card, and the card is dropped with the offending codes named.
      if (card.codes !== undefined) {
        if (!isArr(card.codes) || card.codes.length === 0) {
          e.push(`${at} (map): "codes" must be a non-empty array of ISO 3166-1 alpha-3 codes`);
        } else {
          const bad = card.codes.filter(c => !isStr(c) || !knownCountry(c));
          if (bad.length) {
            e.push(`${at} (map): unknown country code(s) ${bad.map(b => JSON.stringify(b)).join(", ")}`);
          }
        }
      }
      if (card.exception !== undefined && card.exception !== null) {
        if (!isStr(card.exception) || !knownCountry(card.exception)) {
          e.push(`${at} (map): "exception" ${JSON.stringify(card.exception)} is not a known country code`);
        } else if (isArr(card.codes) &&
                   !card.codes.some(c => String(c).toUpperCase() === String(card.exception).toUpperCase())) {
          // "All of these EXCEPT that one" only means something if that one is
          // in the set being drawn. Outside it, the callout points at nothing.
          e.push(`${at} (map): "exception" ${card.exception} is not among "codes"`);
        }
      }
      break;
    }
  }

  return e;
}

/** Strip fields not in the contract for this card type. */
function pruneCard(card) {
  const spec = CARD_FIELDS[card.t];
  const out = { t: card.t };
  for (const f of [...spec.required, ...spec.optional]) {
    if (card[f] !== undefined) out[f] = card[f];
  }
  return out;
}

// ─── Spec validation ────────────────────────────────────────────────────────

/**
 * Validate a model-emitted slide spec.
 *
 * @param {object} spec                 — { beats: [...], slides: [...] }
 * @param {object} opts
 * @param {string[]} opts.allowedSources — outlet names that actually covered
 *        this story (article.source_name plus siblings via event_articles).
 *        Required: with an empty list every stat/bars card drops, which is the
 *        correct behaviour but should be a deliberate caller decision.
 * @param {string} [opts.sourceText]    — article title+description+content. When
 *        supplied, numbers on stat/bars cards are additionally checked to
 *        appear in it. Mirrors scriptWriter.verifyGrounding's normalisation.
 * @param {string[]} [opts.preCreditedSources] — the outlet the TITLE caption is
 *        expected to credit aloud. Verified against that caption, not assumed.
 *
 * @returns {{ok, spec, errors, dropped, stats}}
 *   ok=false means SKIP THE ARTICLE. `dropped` lists every refused card, each
 *   tagged kind: "structural" (unknown type, malformed shape, model-emitted
 *   attribution), "sourcing" (untraceable outlet, ungrounded figure), or "mix"
 *   (over-represented or over-repeated card type). A spec
 *   can be ok with drops; Section 6's publish gate reads `dropped` and
 *   decides whether any drop is itself disqualifying — the §3 / §6.2 tension,
 *   kept open on purpose (see videoSpecWriter.js module docs).
 */
export function validateSpec(spec, {
  allowedSources = [],
  sourceText = "",
  // The outlet whose credit the TITLE caption must carry — the video's single
  // verbal source mention (§3b/3). Previously this was trusted blindly, because
  // the attribution card at position 1 was guaranteed to say it. With that card
  // absorbed into the title, the claim is VERIFIED against the title caption
  // instead of assumed, and only counts as pre-credited once it checks out.
  preCreditedSources = [],
  // The article headline, for the arc checks. Optional: when it is absent the
  // cold-open gate cannot run and says nothing, rather than guessing. Callers
  // that have it (writeVideoSpec always does) get the gate; the schema's own
  // fixtures mostly do not, and must stay valid without it.
  headline = "",
  minSlides = MIN_SLIDES,
  maxSlides = MAX_SLIDES,
  maxDropRatio = MAX_DROP_RATIO,
  maxSourcingDrops = MAX_SOURCING_DROPS,
} = {}) {
  const errors   = [];
  const dropped  = [];
  const warnings = [];
  // §3b/3 NOW TARGETS THE TITLE CAPTION. The attribution card that used to
  // guarantee the video's one spoken credit is gone; the title absorbed it. So
  // the credit is CHECKED where it now lives rather than taken on trust — a
  // caller passing preCreditedSources whose title caption does not actually
  // name that outlet would otherwise suppress the per-figure credit rule and
  // ship a video that credits nobody aloud at all.
  const creditedSources = new Set();
  {
    const titleCard = Array.isArray(spec?.slides)
      ? spec.slides.find(c => c && typeof c === "object" && c.t === "title") : null;
    for (const src of preCreditedSources.filter(Boolean).map(String)) {
      if (titleCard && captionCreditsSource(titleCard.caption, src)) {
        creditedSources.add(src);
      } else {
        errors.push(
          `title caption does not credit "${src}" aloud — §3b/3 puts the video's ` +
          `single verbal source mention on the title card`
        );
      }
    }
  }

  if (!spec || typeof spec !== "object") {
    return { ok: false, spec: null, errors: ["spec is not an object"], warnings, dropped, stats: null };
  }
  if (!isArr(spec.slides)) {
    return { ok: false, spec: null, errors: ["spec.slides is not an array"], warnings, dropped, stats: null };
  }
  // A runaway is spec-level: trimming 60 slides to 34 would render a
  // different video than the model described, silently.
  if (spec.slides.length > maxSlides) {
    return { ok: false, spec: null, errors: [`too many slides: ${spec.slides.length} > ${maxSlides}`], warnings, dropped, stats: null };
  }

  // ── Beats enumeration — the plan is part of the contract ───────────────
  // Spec-level (retryable), never a drop: a spec without its enumeration, or
  // whose cards don't correspond to it, wasn't produced by the process the
  // prompt mandates, and no amount of card-level salvage fixes that. The
  // count check runs on EMITTED cards, before drops — drops are this
  // validator's own doing and must not create a mismatch. `attribution` cards are
  // excluded so the Section 6 code-injected card never breaks the equality.
  const beats = spec.beats;
  if (!isArr(beats) || beats.length === 0) {
    errors.push(`missing beats enumeration — emit the "beats" array before "slides", one entry per beat found in the source`);
  } else {
    beats.forEach((b, i) => {
      if (!b || typeof b !== "object") { errors.push(`beats[${i}]: not an object`); return; }
      if (!BEAT_KINDS.includes(b.kind)) errors.push(`beats[${i}]: kind must be one of ${BEAT_KINDS.join("|")}`);
      if (!isStr(b.beat))               errors.push(`beats[${i}]: "beat" must be a non-empty sentence`);
      if (!isStr(b.evidence))           errors.push(`beats[${i}]: "evidence" must quote the source words that ground it`);
    });
    const contentCards = spec.slides.filter(c =>
      c && typeof c === "object" && c.t !== "title" && c.t !== "kicker"
    ).length;
    if (contentCards !== beats.length) {
      errors.push(`one card per beat: enumerated ${beats.length} beats but emitted ${contentCards} content cards`);
    }
  }

  // Per-card pass. A wrong CARD — unknown type, malformed shape, model-emitted
  // attribution, untraceable or ungrounded numbers — is DROPPED and recorded, and
  // the pass moves on; two bad cards must not kill a 22-slide spec (rule 1).
  // `kind` separates structural from sourcing drops because Section 6's gate
  // may weigh them differently.
  const normSource = bareDigits(sourceText);
  const survivors = [];
  for (let i = 0; i < spec.slides.length; i++) {
    const card = spec.slides[i];

    const shapeErrors = validateCardShape(card, i);
    if (shapeErrors.length) {
      dropped.push({ index: i, t: card?.t ?? "?", kind: "structural", reason: shapeErrors.join("; ") });
      continue;
    }

    // MOTIVE. An ERROR rather than a card drop, deliberately: dropping the card
    // would quietly delete a beat and publish the rest, whereas this routes into
    // the regeneration retry with the phrase named, and the model can either
    // attribute the claim or state the effect instead. If it will not, the
    // article is skipped — which is the correct failure direction for an
    // unattributed assertion about what someone intended.
    // EVERY string the viewer reads or hears, not just the spoken one.
    const shown = displayStrings(card);
    const motiveIn = shown.map(str => [str, unattributedMotive(str, sourceText)]).find(([, mm]) => mm);
    if (motiveIn) {
      errors.push(
        `${MOTIVE_ERROR}: slides[${i}] (${card.t}) asserts a motive — "${motiveIn[1]}" in ` +
        `"${motiveIn[0].slice(0, 60)}" — on its own authority. Say WHOSE claim it is ("the filing ` +
        `alleges…", "prosecutors say…"), or state what happened instead of why someone meant it to.`
      );
    }
    if (sourceText) {
      const loud = unsupportedIntensifiers(shown, sourceText);
      if (loud.length) {
        errors.push(
          // THE RETRY READS THIS, so it says what to do instead rather than only
          // what was wrong. "massive" killed the same article on two separate
          // attempts: the model reaches for an intensifier next to a large
          // figure, and "drop it" alone left it with a number it felt needed
          // help and no sanctioned way to help it.
          `${INTENSIFIER_ERROR}: slides[${i}] (${card.t}) uses ${loud.map(w => `"${w}…"`).join(", ")}, ` +
          `which the source never does. An intensifier the article did not use is a claim you added. ` +
          `If it is sitting next to a figure, delete it — the number already carries the weight, and ` +
          `"ten billion dollars" IS the stakes. If the figure genuinely needs help, use a comparison ` +
          `the source supports (what it is a share of, what it was last year, who pays it), never an adjective.`
        );
      }
    }

    // Traceability + grounding (§3: "no source → drop the card, do not invent one").
    if (card.t === "stat" || card.t === "bars") {
      if (!sourceMatches(card.source, allowedSources)) {
        dropped.push({ index: i, t: card.t, kind: "sourcing", reason: `untraceable source "${card.source}"` });
        continue;
      }
      // §3b/3 AS AMENDED (2026-08-02) — ONE verbal source mention per video,
      // not one per figure card. The on-screen SOURCE: credit stays on every
      // figure card; only the SPOKEN redundancy is removed. Hearing "Reuters
      // reports" four times in ninety seconds reads as a disclaimer, not as
      // attribution.
      //
      // SOURCE-KEYED, not count-keyed. The rule is "credit a source the first
      // time it is used, and again whenever the source CHANGES" — which is
      // already correct for a future multi-source video, where a second outlet
      // genuinely needs its own mention. A counter would silently do the wrong
      // thing there.
      //
      // The TITLE caption carries the primary outlet's credit and runs before
      // any figure card, so callers pass that outlet in `preCreditedSources`
      // and the model's figure captions correctly carry none. It is seeded
      // only after the title caption is confirmed to say it.
      const already = [...creditedSources].some(c => sourceMatches(card.source, [c]));
      if (!already) {
        if (!captionCreditsSource(card.caption, card.source)) {
          dropped.push({
            index: i, t: card.t, kind: "sourcing",
            reason: `first use of "${card.source}" carries no verbal credit (§3b/3)`,
          });
          continue;
        }
        creditedSources.add(String(card.source));
      } else if (captionCreditsSource(card.caption, card.source)) {
        // Style, not trust: the figure is correctly sourced on screen and the
        // outlet was already named aloud. Repeating it is verbose, not wrong.
        warnings.push(
          `slides[${i}] (${card.t}): caption re-credits "${card.source}", already named aloud — ` +
          `one verbal mention per source (§3b/3)`
        );
      }
      if (sourceText) {
        const claims = card.t === "stat" ? [card.value] : card.bars.map(b => b[1]);
        const missing = claims
          .map(v => bareDigits(v))
          .filter(d => d.length >= 2 && !normSource.includes(d));
        if (missing.length) {
          dropped.push({ index: i, t: card.t, kind: "sourcing", reason: `figures absent from source text: ${missing.join(", ")}` });
          continue;
        }
      }
    }

    survivors.push({ card: pruneCard(card), index: i });
  }

  // ── Card-type mix ──────────────────────────────────────────────────────
  // Measured 2026-08-02: a Hindu spec came back 26 slides / 21 of them "stat".
  // Every card was individually valid, so no per-card rule could see it — but
  // twenty-one consecutive number cards is not a video, it is a spreadsheet
  // read aloud. Two independent limits, both DROPPING rather than rejecting,
  // consistent with the rest of this function:
  //
  //   run limit   — no more than 2 of a type back to back, which is what the
  //                 viewer actually experiences.
  //   share limit — no type above ~1/3 of survivors. Solved exactly rather
  //                 than approximated: keeping k cards of a type against
  //                 nOther of every other type satisfies k/(k+nOther) <= 1/3
  //                 precisely when k <= nOther/2, so the cap is self-consistent
  //                 after the drops rather than drifting as the denominator
  //                 shrinks. Floored at MIN_CARDS_PER_TYPE so it is safe on
  //                 small specs and needs no size threshold.
  //
  // Earliest occurrences are kept: the model front-loads its strongest
  // material, and the alternative — scoring cards for "quality" — is a
  // judgment this module has no business making.
  //
  // "title" and "kicker" are exempt from the share limit. They are structural
  // singletons pinned by the first/last rules, and capping them on a small
  // spec is arithmetic, not editorial.
  const afterRuns = [];
  let runType = null, runLen = 0;
  for (const entry of survivors) {
    const t = entry.card.t;
    if (t === runType) runLen++; else { runType = t; runLen = 1; }
    if (runLen > MAX_CONSECUTIVE_SAME_TYPE) {
      dropped.push({
        index: entry.index, t, kind: "mix",
        reason: `${runLen} consecutive "${t}" cards (max ${MAX_CONSECUTIVE_SAME_TYPE} in a row)`,
      });
      runLen--;              // a dropped card does not extend the run
      continue;
    }
    afterRuns.push(entry);
  }

  const counts = {};
  for (const e of afterRuns) counts[e.card.t] = (counts[e.card.t] || 0) + 1;

  const kept = [];
  const taken = {};
  for (const e of afterRuns) {
    const t = e.card.t;
    if (!SHARE_EXEMPT_TYPES.has(t)) {
      const allowed = Math.max(MIN_CARDS_PER_TYPE, Math.floor((afterRuns.length - counts[t]) / 2));
      taken[t] = (taken[t] || 0) + 1;
      if (taken[t] > allowed) {
        dropped.push({
          index: e.index, t, kind: "mix",
          reason: `"${t}" over-represented (${counts[t]} of ${afterRuns.length} cards; max ${allowed} at a ${Math.round(MAX_TYPE_SHARE * 100)}% share)`,
        });
        continue;
      }
    }
    kept.push(e.card);
  }

  // Spec-level checks, judged on what SURVIVED. A spec that fell below the
  // floor is too thin to carry a video and is skipped, never padded; one that
  // lost its opener or closer starts mid-argument or stops without landing —
  // an unusable asset either way, whichever card's drop caused it.
  if (kept.length < minSlides) {
    errors.push(`only ${kept.length} slides remain after dropping ${dropped.length} (< ${minSlides}) — too thin for a video`);
  }
  if (kept.length > 0) {
    if (kept[0].t !== "title") errors.push(`first surviving card must be "title", got "${kept[0].t}"`);
    const last = kept[kept.length - 1];
    if (last.t !== "kicker")   errors.push(`final surviving card must be "kicker", got "${last.t}"`);

    // KICKER REGISTER — hard rule. A closer in summary voice tells the viewer
    // the thing is over at the one moment retention is decided. Spec-level, not
    // a card drop: dropping the kicker would only trip "missing closer" one line
    // above and report the wrong cause. This routes into the regeneration retry
    // with the offending phrase named, which the model can act on.
    if (last.t === "kicker") {
      const hay = [last.caption, last.top, last.bottom, last.sub]
        .filter(Boolean).map(String).join(" ").toLowerCase();
      const hit = KICKER_BANNED_PHRASES.find(ph => hay.includes(ph));
      if (hit) {
        errors.push(
          `kicker is in summary register ("${hit}") — the closer must end on the ` +
          `forward implication, never restate what was said`
        );
      }

      // ARC / THE CLOSER (B3). The register check above catches a closer that
      // ANNOUNCES it is summarising. This catches one that simply does it —
      // saying the headline again in other words, or circling back to the cold
      // open. Both end the video where it began.
      //
      // A HANGING QUESTION ON THE CLOSER. Checked on the caption (the spoken
      // line, always present) and on `bottom` (the last words left on screen) —
      // both of them end the video, so either one hanging is the same failure.
      const hanging = !hit && [last.caption, last.bottom]
        .filter(Boolean).map(String).find(t => TRAILING_QUESTION.test(t.trim()));
      if (hanging) {
        errors.push(
          `${CLOSER_QUESTION_ERROR}: the closer ends on a question ("${hanging.trim().slice(-60)}") — ` +
          `nothing follows the last card, so the answer can never arrive. Questions are welcome ` +
          `earlier, where the next beat answers them. End on the forward implication instead.`
        );
      }

      // Only when neither check above fired: two errors for one fault would
      // send a confused correction note into the single retry.
      if (!hit && !hanging) {
        const r = restatesAny(last.caption, [
          { label: "the article headline", text: headline },
          // kept[0] is the title card — guaranteed by the ordering check above,
          // and skipped entirely on a one-card spec where opener IS closer.
          ...(kept.length > 1 ? [{ label: "its own opening caption", text: kept[0].caption }] : []),
        ]);
        if (r.restates) {
          errors.push(
            `${CLOSER_RESTATES_ERROR}: the kicker restates ${r.matched} — the closer must ` +
            `answer "so what?" with an implication, a consequence, or what to watch next, ` +
            `not return to where the video started`
          );
        }
      }
    }

    // ARC / COLD OPEN (B1). The opening caption must create the question the
    // next sixty seconds answer, not repeat the thumbnail. Spec-level so it
    // routes into the single regeneration retry with a reason the model can act
    // on; never a drop, because dropping the title breaks the beats equality
    // and misreports the cause as a missing opener.
    if (kept[0].t === "title" && headline) {
      const r = restatesAny(kept[0].caption, [{ label: "the article headline", text: headline }]);
      if (r.restates) {
        errors.push(
          `${HOOK_RESTATES_ERROR}: the opening caption restates ${r.matched} — open on a ` +
          `question, a stake, or a concrete anomaly that makes the next sixty seconds ` +
          `feel necessary, not on the headline the viewer has already read`
        );
      }
    }

    // ARC / OPENING-STEM REPETITION (B2). Style only — see MAX_SHARED_STEM for
    // why this can never become a gate. Measured across EVERY caption including
    // the title and kicker: a video whose opener and closer share the stem of
    // three middle captions is exactly the monotony being watched for.
    for (const { stem, count } of repeatedOpeningStems(kept.map(c => c.caption))) {
      warnings.push(
        `${count} captions open with the same three words ("${stem}") — the beats are ` +
        `being joined by a formula instead of by their own relationship. Style signal ` +
        `only; nothing was refused on it.`
      );
    }

    // CAPTION BRIDGING — style only, never a reject. See MIN_BRIDGE_SHARE.
    const contentCaps = kept.filter(c => c.t !== "title").map(c => c.caption);
    if (contentCaps.length >= 3) {
      const bridged = contentCaps.filter(captionBridges).length;
      if (bridged / contentCaps.length < MIN_BRIDGE_SHARE) {
        warnings.push(
          `captions read flat: ${bridged}/${contentCaps.length} end with a pull into ` +
          `the next beat (want >= ${Math.round(MIN_BRIDGE_SHARE * 100)}%). Style signal only — ` +
          `nothing was refused on it.`
        );
      }
    }
  }

  // §3b/5 — the pipeline's own layer must exist.
  if (kept.length > 0 && !kept.some(c => OWN_LAYER_TYPES.includes(c.t))) {
    errors.push(
      `no ${OWN_LAYER_TYPES.join(" or ")} card — a spec of only headline and figures restates the source ` +
      `without adding the pipeline's own layer (§3b/5)`
    );
  }

  // Drop-rate gate — see MAX_DROP_RATIO. Measured against cards the model
  // EMITTED, not survivors, so gutting a large spec cannot hide behind a
  // still-respectable surviving count.
  const emitted = spec.slides.length;
  const ratio = emitted > 0 ? dropped.length / emitted : 0;
  if (ratio > maxDropRatio) {
    errors.push(
      `drop rate ${(ratio * 100).toFixed(0)}% (${dropped.length}/${emitted}) exceeds ${(maxDropRatio * 100).toFixed(0)}% — regenerate rather than salvage`
    );
  }
  const sourcingDrops = dropped.filter(d => d.kind === "sourcing").length;
  if (sourcingDrops > maxSourcingDrops) {
    errors.push(
      `${sourcingDrops} sourcing drops exceeds ${maxSourcingDrops} — the model is reaching for numbers it cannot attribute`
    );
  }

  if (errors.length) return { ok: false, spec: null, errors, warnings, dropped, stats: null };

  const byType = {};
  for (const c of kept) byType[c.t] = (byType[c.t] || 0) + 1;

  return {
    ok: true,
    spec: { ...spec, slides: kept },
    errors: [],
    warnings,
    dropped,
    stats: {
      slides: kept.length,
      emitted,
      dropRatio: Number(ratio.toFixed(3)),
      sourcingDrops,
      mixDrops: dropped.filter(d => d.kind === "mix").length,
      beats: beats.length,
      beatKinds: beats.reduce((m, b) => { m[b.kind] = (m[b.kind] || 0) + 1; return m; }, {}),
      byType,
      captionWords: kept.reduce((n, c) => n + String(c.caption).trim().split(/\s+/).length, 0),
    },
  };
}

// ─── Packaging validation (brief §5b) ───────────────────────────────────────

const TITLE_MAX      = 60;   // API cap is 100; search and mobile truncate ~60
const TAGS_MAX_CHARS = 500;
const BANNED_TITLE_OPENERS = [/^how\b/i, /^why\b/i, /^scoopfeeds\b/i, /^scoop\b/i];

/**
 * Validate the packaging payload against the FINISHED spec.
 *
 * The load-bearing check is the figure test: a title may not assert a number
 * the slides never pay off. A curiosity gap the script doesn't close is a
 * trust cost a news channel can't afford, and YouTube treats systematic
 * mismatch as misleading metadata — so an offending title is always removed,
 * never shipped with a warning.
 *
 * Rejection is VARIANT-LEVEL: a bad title is dropped into `dropped[]` and the
 * rest of the payload survives. Only an empty title set or an empty thumbnail
 * set is fatal, because only then is there nothing to upload.
 *
 * @returns {{ok, packaging, errors, warnings, dropped}}
 */
export function validatePackaging(packaging, validatedSpec) {
  const errors   = [];
  // TRUST failures reject; STYLE failures warn. The split is deliberate: an
  // invented figure is a reason to publish nothing, but a thumbnail that leans
  // on its title is a weaker video, not a dishonest one. Rejecting the whole
  // payload — and therefore the video — over a stylistic near-miss would make
  // the strict-refusal posture unaffordable, and the first thing to get
  // loosened under that pressure would be a gate that actually matters.
  const warnings = [];
  if (!packaging || typeof packaging !== "object") {
    return { ok: false, packaging: null, errors: ["packaging is not an object"], warnings };
  }

  const { titles, thumbnails, description_hook, tags, image_query } = packaging;

  // Every figure the video actually pays off. Walks the WHOLE card, not just
  // captions and numeric values: a number set in 200pt display type on slide 1
  // is paid off just as surely as one that is spoken, so scanning captions
  // alone rejects titles that the video demonstrably delivers.
  const paidOff = new Set();
  const harvest = (v) => {
    if (v === null || v === undefined) return;
    if (typeof v === "number") { paidOff.add(bareDigits(v)); return; }
    if (typeof v === "string") {
      for (const m of v.match(/\d[\d,.]*/g) || []) paidOff.add(bareDigits(m));
      return;
    }
    if (isArr(v)) { v.forEach(harvest); return; }
    if (typeof v === "object") { Object.values(v).forEach(harvest); }
  };
  for (const c of validatedSpec?.slides || []) harvest(c);

  // VARIANT-LEVEL rejection. A bad title is a bad TITLE, not a bad payload:
  // dropping variant 2 leaves a shippable video with two Test & Compare
  // variants instead of three, whereas rejecting the payload discards a
  // finished spec that already cost a generation. Only an empty survivor set
  // is fatal — with no title or no thumbnail there is nothing to upload.
  const dropped = [];
  const keptTitles = [];
  const keptThumbs = [];

  if (!isArr(titles)) {
    errors.push(`titles: expected an array, got ${typeof titles}`);
  } else {
    titles.forEach((t, i) => {
      const bad = [];
      if (!isStr(t)) bad.push("must be a non-empty string");
      else {
        if (t.length > TITLE_MAX) bad.push(`${t.length} chars > ${TITLE_MAX}`);
        for (const re of BANNED_TITLE_OPENERS) {
          if (re.test(t.trim())) bad.push(`must not open with "${t.trim().split(/\s+/)[0]}"`);
        }
        for (const m of t.match(/\d[\d,.]*/g) || []) {
          const d = bareDigits(m);
          if (d.length >= 2 && !paidOff.has(d)) {
            bad.push(`figure "${m}" appears in no slide — the video does not pay this off`);
          }
        }
      }
      if (bad.length) dropped.push({ kind: "title", index: i, reason: bad.join("; ") });
      else keptTitles.push({ index: i, value: t });
    });
  }

  if (!isArr(thumbnails)) {
    errors.push(`thumbnails: expected an array, got ${typeof thumbnails}`);
  } else {
    thumbnails.forEach((th, i) => {
      const bad = [];
      if (!th || typeof th !== "object") {
        dropped.push({ kind: "thumbnail", index: i, reason: "not an object" });
        return;
      }
      if (!isStr(th.hook)) {
        dropped.push({ kind: "thumbnail", index: i, reason: '"hook" required' });
        return;
      }
      const words = th.hook.trim().split(/\s+/);
      // 1-3 words, never a sentence — the hook has to survive 168px.
      if (words.length > 3) bad.push(`hook is ${words.length} words, max 3`);
      if (!isStr(th.kicker)) bad.push('"kicker" required');
      if (!isStr(th.accent)) bad.push('"accent" required');
      else if (!norm(th.hook).split(" ").includes(norm(th.accent)) && !norm(th.hook).includes(norm(th.accent))) {
        bad.push(`accent "${th.accent}" is not part of hook "${th.hook}"`);
      }
      if (!THUMBNAIL_ANGLES.includes(th.angle)) {
        bad.push(`angle must be one of ${THUMBNAIL_ANGLES.join("|")}`);
      }
      // Title and thumbnail are two halves of one promise, not one message
      // printed twice. Compared against the PAIRED title (variant i), and only
      // when hook AND kicker together add nothing the title didn't already say
      // — a 1-3 word hook sharing one noun with its title is normal and good,
      // which is why the naive per-word version of this check flagged the
      // brief's own "500 CABLES" example.
      const paired = isArr(titles) ? titles[i] : null;
      if (isStr(paired) && isStr(th.kicker)) {
        const titleWords = new Set(norm(paired).split(" ").filter(w => w.length > 3));
        const thumbWords = norm(`${th.hook} ${th.kicker}`).split(" ").filter(w => w.length > 3);
        const fresh = thumbWords.filter(w => !titleWords.has(w));
        if (thumbWords.length && fresh.length === 0) {
          warnings.push(`thumbnails[${i}]: "${th.hook} / ${th.kicker}" adds nothing beyond its title "${paired}"`);
        }
      }

      if (bad.length) dropped.push({ kind: "thumbnail", index: i, reason: bad.join("; ") });
      else keptThumbs.push({ index: i, value: th });
    });
  }

  // The only fatal variant condition: nothing left to ship.
  if (isArr(titles) && keptTitles.length === 0) {
    errors.push(`no title survived validation (${titles.length} dropped)`);
  }
  if (isArr(thumbnails) && keptThumbs.length === 0) {
    errors.push(`no thumbnail survived validation (${thumbnails.length} dropped)`);
  }
  if (dropped.length && keptTitles.length && keptThumbs.length) {
    warnings.push(`${dropped.length} variant(s) dropped — Test & Compare will run with ${keptTitles.length} title(s) / ${keptThumbs.length} thumbnail(s)`);
  }

  // Variant DIVERSITY. Test & Compare measures which promise pulls best, so
  // three variants that make the same promise in different words measure
  // nothing — the test burns impressions to learn a rewording. Warned, not
  // rejected: a low-diversity set still publishes a correct video, and this
  // is a judgment about experiment design rather than about truth.
  if (keptThumbs.length >= 2) {
    const angles = keptThumbs.map(t => String(t.value.angle));
    const repeated = [...new Set(angles.filter((a, i) => angles.indexOf(a) !== i))];
    if (repeated.length) {
      warnings.push(`thumbnails repeat angle(s) ${repeated.join(", ")} — variants must differ in angle, not just wording`);
    }
    // A "bare count" hook leads with a numeral. One is a strong thumbnail;
    // two or more means the set is testing the same idea — that a number is
    // the hook — rather than testing different promises.
    const bare = keptThumbs.filter(t => /^\s*\d/.test(String(t.value.hook)));
    if (bare.length >= 2) {
      warnings.push(`${bare.length} thumbnails are bare counts (${bare.map(t => `"${t.value.hook}"`).join(", ")}) — vary the promise, not just the number`);
    }
  }

  if (!isStr(description_hook)) errors.push(`description_hook: required, non-empty`);

  if (!isArr(tags) || tags.length === 0) {
    errors.push(`tags: required, non-empty array`);
  } else {
    const total = tags.join(",").length;
    if (total > TAGS_MAX_CHARS) errors.push(`tags: ${total} chars > ${TAGS_MAX_CHARS}`);
  }

  // §5c — 2-4 concrete nouns driving the stock query. Not fatal on its own;
  // a missing query means the hero-image chain starts at generation instead
  // of stock, which is a routing consequence, not a correctness one.
  if (image_query !== undefined && !isStr(image_query)) {
    errors.push(`image_query: must be a string when present`);
  }

  if (errors.length) return { ok: false, packaging: null, errors, warnings, dropped };

  return {
    ok: true,
    packaging: {
      titles: keptTitles.map(t => t.value),
      thumbnails: keptThumbs.map(t => t.value),
      description_hook,
      tags,
      ...(isStr(image_query) ? { image_query } : {}),
    },
    errors: [],
    warnings,
    dropped,
  };
}

/**
 * Fold "whose reporting this is" into the TITLE card.
 *
 * Replaces buildAttributionCard (DrJ, 2026-08-03). The dedicated attribution
 * card spent a whole slide — and several of the opening seconds that decide
 * whether anyone stays — saying something the title can carry as a badge, a
 * date and one clause of narration.
 *
 * Three things are injected, all from the article row, none from the model:
 *   - `outlet` — drives the on-screen source badge
 *   - `date`   — ISO day only; a timestamp reads as machine output, and the
 *                publication DAY is what a viewer needs to judge currency
 *   - the credit clause appended to `caption` — THE video's single verbal
 *     source mention (§3b/3), and what validateSpec now checks for.
 *
 * The model's own `outlet`/`date` are STRIPPED first. A model asked whose
 * reporting this is answers fluently whether or not it knows.
 *
 * Returns a NEW card; never mutates. Returns the card unchanged when there is
 * no publisher to name, and null for a non-title card, so a caller cannot
 * quietly decorate the wrong slide.
 */
export function decorateTitleCard(card, article, attribution = null) {
  if (!card || card.t !== "title") return null;
  const resolved = attribution || resolveAttribution(article);
  const outlet = String(resolved?.publisher || "").trim();

  const { outlet: _drop1, date: _drop2, ...clean } = card;
  if (!outlet) return clean;

  let date = null;
  const raw = article?.published_at ?? article?.date ?? null;
  if (raw != null) {
    const d = new Date(typeof raw === "number" ? raw : String(raw));
    if (!Number.isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
  }

  // Phrased as a broadcast credit, not a legal disclosure: "Reported by
  // Reuters" is what a presenter says; "This report is based on Reuters'
  // reporting" is what a contract says, and it reads as hedging aloud.
  // Appended rather than prepended — the caption's FIRST clause is the story's
  // sharpest claim and must not be pushed behind a credit.
  const base = String(clean.caption || "").trim();
  const credit = `Reported by ${outlet}.`;
  const caption = captionCreditsSource(base, outlet)
    ? base                                   // already says it; do not say it twice
    : (base ? `${base} ${credit}` : credit);

  return { ...clean, outlet, ...(date ? { date } : {}), caption };
}
