/**
 * longformGroundedness.js — fiction cannot pass a figure check (found live).
 *
 * THE INCIDENT THIS EXISTS FOR. The first supervised run produced a script
 * whose every gate passed — structure perfect, zero ungrounded figures —
 * and which was FICTION: an invented analyst, a report as protagonist, "the
 * model already hacked itself" as the reveal. The figure check is vacuous
 * against a script that simply contains no figures, and no structural
 * property distinguishes an invented narrative from a reported one. The
 * prompt-side fix (corpus + NONFICTION rules in the writer) narrows the
 * blind spot; this gate closes it from the measuring side, and it is the
 * condition DrJ set before LONGFORM_AUTOPOST_ENABLED may flip.
 *
 * TWO LAYERS, CHEAP BEFORE EXPENSIVE:
 *
 *   MECHANICAL (free, always on): direct quotations and proper-noun
 *   sequences in the script must appear in the corpus. A quotation the
 *   source never printed is fabrication per se; a named person or
 *   institution the corpus never mentions is an invented actor.
 *
 *   JUDGE (one premium call): a fact-checking pass listing MATERIAL claims
 *   — events, actions, attributions — not supported by the source text.
 *   Framing and transition prose are explicitly out of scope, because a
 *   judge that flags interpretation would drought the pipeline.
 *
 * THE VERDICT RULES ARE THE HOUSE RULES:
 *   - Unmeasured is a FAILURE: a judge that returns nothing after retries
 *     abandons the film. "No degraded long-form is published" includes
 *     degraded checking.
 *   - A failure ABANDONS, never retries-with-feedback: told "not that
 *     claim", a model paraphrases the claim back in — the same reason the
 *     figure check never feeds back. A fresh generation next cycle starts
 *     from the corpus, not from the fiction.
 */

import { logger } from "../logger.js";

/** Words that start sentences and look like names but aren't actors. */
const PROPER_STOP = new Set([
  "The", "A", "An", "In", "On", "At", "But", "And", "Or", "It", "Its", "This",
  "That", "These", "Those", "When", "While", "After", "Before", "As", "By",
  "For", "From", "To", "Of", "With", "Not", "No", "What", "Who", "How", "Why",
  "Here", "There", "Then", "Now", "Today", "Yesterday", "One", "Two", "Three",
  "First", "Second", "Third", "Finally", "Meanwhile", "Instead", "Some", "Each",
  "Every", "Both", "Their", "They", "He", "She", "We", "You", "If", "So",
]);

/**
 * Multi-word capitalized runs — the script's named actors. Single
 * capitalized words are skipped: too many are sentence starts, and a
 * one-word invention ("Svetofor") is almost always accompanied by a
 * multi-word context that IS caught.
 */
export function properNounRuns(text) {
  const runs = new Set();
  // "and" is NOT an internal connector: "the UN and Red Cross" is two
  // sourced actors, and gluing them makes one name no corpus contains.
  for (const m of String(text).matchAll(/\b([A-Z][\w'-]+(?:\s+(?:of|the|for)\s+|\s+)){1,5}[A-Z][\w'-]+\b/g)) {
    const run = m[0].trim();
    const words = run.split(/\s+/);
    const meaningful = words.filter((w) => /^[A-Z]/.test(w) && !PROPER_STOP.has(w));
    if (meaningful.length >= 2) runs.add(run);
  }
  return [...runs];
}

/**
 * Direct quotations of substance (short scare-quotes are not citations).
 * DOUBLE quotes only: an apostrophe is not a quote delimiter — treating it
 * as one captured everything between two possessives ("the institute's …
 * the site's") as a phantom quotation, and the real published script was
 * convicted of fabricating its own prose. A quotation must also stay on one
 * line; a match spanning beats is the same phantom.
 */
export function quotations(text) {
  const out = [];
  for (const m of String(text).matchAll(/["“”]([^"“”\n]{20,300})["“”]/g)) out.push(m[1].trim());
  return out;
}

const normalize = (s) => String(s).toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

/**
 * How much of a beat's own wording the corpus contains, as a bigram
 * fraction. This is the ARBITER of judge flags: measured on the real
 * published film, the judge's two false positives (paraphrase beats it
 * flagged as unsupported) scored 0.50 while every reconstructed fiction
 * beat scored 0.00-0.12 — a beat whose wording substantially lives in the
 * corpus is a paraphrase, whatever the judge thinks of it.
 */
export const FLAG_DISMISS_FRACTION = 1 / 3;
export function corpusBigramFraction(beatText, corpusNorm) {
  const w = normalize(beatText).split(" ").filter((x) => x.length > 2);
  let grams = 0, hits = 0;
  for (let i = 0; i + 1 < w.length; i++) {
    grams++;
    if (corpusNorm.includes(`${w[i]} ${w[i + 1]}`)) hits++;
  }
  return grams ? hits / grams : 0;
}

/**
 * The mechanical layer. Returns problems; empty means this layer is clean.
 */
export function mechanicalGroundedness({ beats = [], spine = {}, sourceText = "" } = {}) {
  const problems = [];
  const corpus = normalize(sourceText);
  const scriptText = [
    ...beats.map((b) => b?.text || ""),
    spine.throughLine || "", spine.reveal || "",
  ].join("\n");

  for (const q of quotations(scriptText)) {
    if (!corpus.includes(normalize(q))) {
      problems.push(`quotation not in any source: "${q.slice(0, 80)}" — a quote the source never printed is fabrication per se`);
    }
  }
  for (const run of properNounRuns(scriptText)) {
    // The CORE of the name, not its casing accidents: strip leading
    // stopwords ("The EU's Artificial Intelligence Act" → the Act itself)
    // and possessives before deciding the corpus never mentions it —
    // "the EU's X" vs the corpus's "the EU X" is one apostrophe, not an
    // invented institution.
    const words = run.split(/\s+/);
    while (words.length > 2 && PROPER_STOP.has(words[0])) words.shift();
    // Qualifiers narrow, tails name: "The EU's Artificial Intelligence
    // Act" is sourced when the corpus prints "Artificial Intelligence Act".
    // Accept any suffix of the run that keeps >= 2 meaningful words; a name
    // whose EVERY such suffix is absent ("Global Threat Assessment Bureau",
    // "Threat Assessment Bureau", "Assessment Bureau") is the invention.
    const strip = (w) => normalize(w.join(" ").replace(/['’]s\b/g, ""));
    let sourced = false;
    for (let from = 0; words.length - from >= 2 && !sourced; from++) {
      const tail = words.slice(from);
      if (corpus.includes(strip(tail)) || corpus.includes(normalize(tail.join(" ")))) sourced = true;
    }
    if (!sourced) {
      problems.push(`named actor not in any source: "${run}" — an invented name is an invented fact`);
    }
  }
  return problems;
}

export function buildJudgePrompt({ beats = [], spine = {}, sourceText = "" }) {
  return `You are fact-checking a news-film narration against its ONLY permitted sources, before publication.

Return ONE JSON object and nothing else:
{ "unsupported": [ { "beat": <number>, "claim": "...", "why": "..." } ] }

List every MATERIAL claim in the narration that the SOURCE TEXT does not support:
- events that the sources do not report happening
- actions attributed to a person or organisation that the sources do not attribute
- causal or intent claims ("X did this to achieve Y") absent from the sources
- the reveal, if it reframes the story in a way the sources do not

Explicitly OUT of scope — do not list:
- framing, transitions, rhetorical questions, and the narrator's structure
- restatements and reasonable paraphrase of sourced material
- claims of the form "the sources/report says X" where X is in the sources

If everything material is supported, return { "unsupported": [] }.

NARRATION (numbered beats)
${beats.map((b, i) => `${i + 1}. ${b?.text || ""}`).join("\n")}

SPINE REVEAL (check this hardest — it is where invention concentrates)
${spine.reveal || "(none)"}

SOURCE TEXT (the only permitted basis)
${String(sourceText).slice(0, 24_000)}`;
}

/**
 * The full gate. Returns { grounded, problems, measured }.
 * Callers abandon on !grounded AND on !measured — unmeasured is a failure.
 */
export async function groundednessVerdict({ beats, spine, sourceText, call, slug = "untitled" } = {}) {
  const mech = mechanicalGroundedness({ beats, spine, sourceText });
  if (mech.length) {
    // No judge call for a script the free layer already convicted.
    return { grounded: false, measured: true, problems: mech };
  }
  if (!call) throw new Error("groundednessVerdict: call is required");

  // MAJORITY OF THREE. Measured on the real published film: a single judge
  // pass produces ~2 false flags per 79 grounded beats, and they MOVE
  // between runs (beats 29+70 one run, 19+the-reveal the next), while every
  // fiction beat is flagged in every run. A flag that cannot repeat is
  // noise; one that repeats is a finding. Three passes cost three premium
  // calls per ACCEPTED script — the film reaches this point once.
  const verdicts = [];
  for (let i = 1; i <= 5 && verdicts.length < 3; i++) {
    try {
      const r = await call(buildJudgePrompt({ beats, spine, sourceText }),
        { task: "longform-groundedness", tier: "premium", priority: "low",
          maxOutputTokens: 24_000, timeoutMs: 300_000 });
      if (r && Array.isArray(r.unsupported)) verdicts.push(r);
      else logger.warn(`🎬 ${slug}: unusable groundedness verdict (try ${i}/5)`);
    } catch (e) {
      logger.warn(`🎬 ${slug}: groundedness judge failed (try ${i}/5) — ${e.message}`);
    }
  }
  if (verdicts.length < 2) {
    return { grounded: false, measured: false,
      problems: [`groundedness UNVERIFIED: only ${verdicts.length} usable judge verdict(s) of the 2 a majority needs — unmeasured is a failure, not a pass`] };
  }

  // Key flags by WHERE they land. An out-of-range beat number is the spine
  // reveal (the prompt lists it after the beats and judges number it as the
  // next beat), and it must arbitrate against the reveal's own text — an
  // unmappable flag would otherwise stand unconditionally.
  // A non-numeric beat ("spine", "reveal") is the reveal too — judges name
  // it as often as they number it.
  const isReveal = (n) => !Number.isFinite(Number(n)) || Number(n) > (beats?.length || 0);
  const textAt = (n) => (isReveal(n) ? String(spine?.reveal || "") : (beats?.[Number(n) - 1]?.text || ""));
  const keyAt = (n) => (isReveal(n) ? "reveal" : `beat ${Number(n)}`);

  const tally = new Map();
  for (const v of verdicts) {
    const seen = new Set();
    for (const u of v.unsupported) {
      const k = keyAt(u.beat);
      if (seen.has(k)) continue;   // one vote per verdict per location
      seen.add(k);
      const t = tally.get(k) || { votes: 0, beat: u.beat, claim: u.claim, why: u.why };
      t.votes++;
      tally.set(k, t);
    }
  }
  const needed = Math.ceil(verdicts.length / 2 + 0.01);

  const corpusNorm = normalize(sourceText);
  const problems = [];
  for (const [k, t] of tally) {
    if (t.votes < needed) {
      logger.info(`🎬 ${slug}: groundedness flag DISMISSED by majority (${k}: ${t.votes}/${verdicts.length} votes) — ${String(t.claim).slice(0, 90)}`);
      continue;
    }
    // THE CORPUS ARBITRATES THE JUDGES: a location whose own wording
    // substantially appears in the corpus is a paraphrase, whatever the
    // panel thinks of it. Dismissals are logged — they are the calibration
    // corpus for FLAG_DISMISS_FRACTION.
    const text = textAt(t.beat);
    const f = corpusBigramFraction(text, corpusNorm);
    if (text && f >= FLAG_DISMISS_FRACTION) {
      logger.info(`🎬 ${slug}: groundedness flag DISMISSED by corpus (${k}, ${(f * 100).toFixed(0)}% of its bigrams sourced) — ${String(t.claim).slice(0, 90)}`);
      continue;
    }
    problems.push(`${k}: unsupported claim (${t.votes}/${verdicts.length} judges) — ${String(t.claim).slice(0, 140)}${t.why ? ` (${String(t.why).slice(0, 100)})` : ""}`);
  }
  return { grounded: problems.length === 0, measured: true, problems };
}
