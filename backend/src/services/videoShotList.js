/**
 * videoShotList.js — the shot list the spec writer emits per card (shot-engine
 * brief, Phase 2), and the checks that make it a contract rather than a hint.
 *
 * THE UNIT IS A SHOT, NOT A CARD (brief §1.1). Each card's narration becomes
 * one to three shots, and each shot starts on a specific spoken word — its
 * ANCHOR. An anchor is an assertion: if the phrase is not in the caption, the
 * spec fails loudly, exactly as the reference engine's `at(phrase)` raises
 * (docs/reference/shot-engine/short.py).
 *
 * DARK. Asked for, and checked, only when VIDEO_SHOT_ENGINE_ENABLED=1. With the
 * flag off the prompt is byte-identical and nothing here runs.
 *
 * THE SHOT LIST IS METADATA ON THE CARDS, NEVER A SECOND STRUCTURE. It cannot
 * add, remove or reorder beats or captions: anchors are cut FROM the caption
 * as written. A leaked length signal has burned this pipeline four times
 * (docs/video-pipeline.md §5), so nothing in here is ever shown to the model
 * as a count of cards or a duration to divide.
 */

// The Phase 4 vocabulary (brief §2, Phase 4). The end card is appended by the
// renderer and is not a spec shot.
export const SHOT_KINDS = Object.freeze([
  "satellite",   // SatZoom — satellite imagery zooming to the subject
  "map",         // MapShot — camera, pins and fills timed to words
  "photo",       // a real photograph: cover, or contain for group/portrait
  "clip",        // real footage, a moving 9:16 crop over 16:9
  "headline",    // recreated headline clipping with a highlight sweep
  "punch",       // deliberate text-only punctuation card ("NOT A SALE.")
  "quote",       // a quote over the speaker's own footage
  "count",       // count-up number
  "graphic",     // simple data graphic
]);

// Where the resolver should look first (brief §1.2's ladder, stated as intent).
export const SOURCE_INTENTS = Object.freeze(["footage", "photo", "satellite", "map", "data", "stock", "card"]);

// Which intents make sense for which kind. A punch card is type, never a
// search; a satellite shot is never stock. Mismatches are a model error, named.
export const KIND_INTENTS = Object.freeze({
  satellite: ["satellite"],
  map:       ["map"],
  photo:     ["photo", "stock"],
  clip:      ["footage", "stock"],
  headline:  ["card"],
  punch:     ["card"],
  quote:     ["footage", "photo"],
  count:     ["data", "card"],
  graphic:   ["data", "card"],
});

export const MAX_SHOTS_PER_CARD = 3;
export const MAX_PUNCH_SHOTS = 2;           // brief §1.2: at most two per short
export const MAX_AVG_SHOT_SECS = 3.0;       // brief §0 — REPORTED at spec time, enforced at render
export const MAX_SUBJECT_WORDS = 8;

/**
 * SUBJECT SPECIFICITY (DrJ, 24 Sep 2026). A shot that goes looking for real
 * imagery needs something SEARCHABLE: a named person, place, organisation,
 * document, vessel or product, or a precise object or event. "money", "ocean"
 * and an outlet's own name find nothing worth showing — the first dry run
 * emitted all three. Generic subjects stay legal for the kinds that draw their
 * own picture from data (count, graphic) and for punch, whose subject is its
 * own words.
 */
export const GENERIC_OK_KINDS = Object.freeze(["count", "graphic", "punch"]);

// Words that name a CATEGORY rather than a thing. A subject made only of these
// (plus articles and prepositions) is generic, however many of them there are:
// "tech executives", "police patrol", "trade deficit" all fail; "sea cucumber"
// passes because "cucumber" is not in here. Kept deliberately to broad heads —
// a precise object ("container ship", "glacial lake") is still precise.
export const GENERIC_NOUNS = new Set(`
  money cash dollars currency funds finance financial economy economic market markets trade trading deficit
  business businesses industry company companies firm firms corporation executives executive tech technology
  ai internet data chart graph graphic statistics numbers figures percent growth prices price inflation cost costs
  people person crowd crowds public citizens residents community communities family families women men children
  kids students workers worker staff employees officials official leaders leader politicians lawmakers government
  governments authorities authority police military army troops soldiers security forces
  world globe earth planet nature environment climate weather sky sea ocean oceans water river land landscape
  country countries nation nations region regions city cities town towns village area areas border borders
  building buildings office offices headquarters street streets road roads home homes house houses
  car cars vehicle vehicles ship ships boat boats plane planes aircraft train trains truck trucks
  phone phones computer computers screen screens device devices
  document documents paper papers report reports news newspaper headline headlines media press outlet
  protest protests rally meeting meetings summit talks negotiations deal deals agreement agreements
  health hospital hospitals school schools food energy oil gas power fishery fisheries farm farms factory factories
  prison prisons court courts law laws crime issue issues problem problems crisis situation event events
  patrol patrols scene
  artificial intelligence relations relationship tensions policy policies sanctions tariff tariffs diplomacy
  cooperation competition conflict war peace security threat threats risk risks future
`.split(/\s+/).filter(Boolean));
const FILLER = new Set(["a", "an", "the", "of", "at", "in", "on", "for", "and", "to", "with", "from", "by", "its", "their", "new", "old", "big", "small", "local", "global", "major", "large", "general"]);

/**
 * Is this subject specific enough to search for? Specific when it carries a
 * proper name (a capitalised word that is not a generic noun), a number (a year,
 * a model, a flight), or at least one content word that is not a category.
 * An outlet named as the subject is never specific — the outlet is the source
 * of the story, not a thing on screen.
 *
 * A HEURISTIC, AND ITS KNOWN LIMIT: a proper name attached to an abstraction
 * ("US-China relations") passes, because the names are real and searchable.
 * The list catches bare categories, which is what the dry runs produced.
 */
export function subjectIsSpecific(subject, { outlets = [] } = {}) {
  const raw = String(subject || "").trim();
  if (!raw) return false;
  const low = raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  for (const o of outlets) {
    const n = String(o || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    if (n && (low === n || low === n.replace(/ (english|news|online)$/, ""))) return false;
  }
  if (/\d/.test(raw)) return true;
  const words = raw.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9'-]/g, "")).filter(Boolean);
  // A capital on the FIRST word may just be sentence case ("Artificial
  // intelligence"), so it only counts as a name when the word is not a category
  // word; later capitals ("Indian coast guard" -> Indian) count as names.
  if (words.some((w) => /^[A-Z]/.test(w) && !GENERIC_NOUNS.has(w.toLowerCase()) && !FILLER.has(w.toLowerCase()))) return true;
  const content = words.map((w) => w.toLowerCase()).filter((w) => !FILLER.has(w));
  return content.some((w) => !GENERIC_NOUNS.has(w) && !GENERIC_NOUNS.has(w.replace(/s$/, "")));
}

export function shotEngineEnabled() {
  return process.env.VIDEO_SHOT_ENGINE_ENABLED === "1";
}

const isStr = (v) => typeof v === "string" && v.trim().length > 0;
export const tokens = (s) => String(s || "").toLowerCase().split(/\s+/)
  .map((w) => w.replace(/[^a-z0-9]/g, "")).filter(Boolean);

/**
 * Where a phrase starts in the caption, as a word index — the reference's
 * `at()`, on the caption instead of the alignment. Returns -1 when absent.
 * `from` lets the Nth anchor be searched after the previous one, so a repeated
 * word ("the") resolves to the occurrence the shot sequence actually means.
 */
export function anchorIndex(caption, anchor, from = 0) {
  const c = tokens(caption), a = tokens(anchor);
  if (!a.length) return -1;
  for (let i = from; i + a.length <= c.length; i++) {
    let ok = true;
    for (let j = 0; j < a.length; j++) if (c[i + j] !== a[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

/**
 * Check every card's shots and the video-level bars.
 *
 * @returns {{ errors: string[], warnings: string[], stats: { shots, punch, spokenSecs, avgShotSecs, byKind, byIntent } }}
 *   errors are SPEC-LEVEL (they route into the regeneration retry): a shot list
 *   that does not line up with its captions cannot be salvaged card by card
 *   without the renderer guessing where cuts go.
 */
export function shotListErrors(slides, { wpm = 150, outlets = [] } = {}) {
  const errors = [];
  const warnings = [];
  let shots = 0, punch = 0, words = 0;
  const byKind = {}, byIntent = {};

  (slides || []).forEach((card, idx) => {
    const at = `slides[${idx}] (${card?.t})`;
    const caption = String(card?.caption || "");
    const capWords = tokens(caption).length;
    words += capWords;
    const list = card?.shots;
    if (!Array.isArray(list) || list.length === 0) {
      errors.push(`${at}: missing "shots" — every card carries its shot list`);
      return;
    }
    if (list.length > MAX_SHOTS_PER_CARD) {
      errors.push(`${at}: ${list.length} shots — a card's narration is cut into at most ${MAX_SHOTS_PER_CARD}`);
    }
    let prev = -1;
    list.forEach((s, j) => {
      const sat = `${at} shots[${j}]`;
      if (!s || typeof s !== "object") { errors.push(`${sat}: not an object`); return; }
      shots++;
      if (!SHOT_KINDS.includes(s.kind)) {
        errors.push(`${sat}: unknown kind ${JSON.stringify(s.kind)} (closed set: ${SHOT_KINDS.join(", ")})`);
      } else {
        byKind[s.kind] = (byKind[s.kind] || 0) + 1;
        if (s.kind === "punch") punch++;
      }
      if (!SOURCE_INTENTS.includes(s.source_intent)) {
        errors.push(`${sat}: unknown source_intent ${JSON.stringify(s.source_intent)} (one of: ${SOURCE_INTENTS.join(", ")})`);
      } else {
        byIntent[s.source_intent] = (byIntent[s.source_intent] || 0) + 1;
        if (KIND_INTENTS[s.kind] && !KIND_INTENTS[s.kind].includes(s.source_intent)) {
          errors.push(`${sat}: a "${s.kind}" shot cannot have source_intent "${s.source_intent}" ` +
            `(allowed: ${KIND_INTENTS[s.kind].join(", ")})`);
        }
      }
      if (!isStr(s.subject)) {
        errors.push(`${sat}: "subject" must name the one thing on screen`);
      } else {
        const n = s.subject.trim().split(/\s+/).length;
        if (n > MAX_SUBJECT_WORDS) errors.push(`${sat}: "subject" is a noun phrase, not a sentence — got ${n} words`);
        if (/\s+or\s+|\s*\/\s*|\beither\b/i.test(s.subject)) {
          errors.push(`${sat}: "subject" hedges between alternatives ("${s.subject.trim()}") — name ONE thing`);
        } else if (!GENERIC_OK_KINDS.includes(s.kind) && !subjectIsSpecific(s.subject, { outlets })) {
          errors.push(`${sat}: "subject" "${s.subject.trim()}" is too generic for a ${s.kind} shot — name the specific ` +
            `person, place, organisation, document, vessel, product or event it shows (generic subjects are only ` +
            `allowed on count and graphic shots)`);
        }
      }
      if (!isStr(s.anchor)) { errors.push(`${sat}: "anchor" must be the words the shot starts on`); return; }
      // THE ANCHOR IS AN ASSERTION. Verbatim in THIS card's caption, in order.
      const pos = anchorIndex(caption, s.anchor, prev + 1);
      if (pos < 0) {
        const anywhere = anchorIndex(caption, s.anchor) >= 0;
        errors.push(anywhere
          ? `${sat}: anchor "${s.anchor}" is out of order — each shot starts after the one before it`
          : `${sat}: anchor "${s.anchor}" is not verbatim in the caption "${caption.slice(0, 80)}"`);
        return;
      }
      if (j === 0 && pos !== 0) {
        errors.push(`${sat}: the first shot's anchor must be the caption's opening words — "${s.anchor}" starts at word ${pos + 1}`);
      }
      prev = pos;
    });
  });

  if (punch > MAX_PUNCH_SHOTS) {
    errors.push(`${punch} punctuation cards — at most ${MAX_PUNCH_SHOTS} per video; the rest should show something real`);
  }
  // REPORT-ONLY (DrJ, 24 Sep 2026). Estimated from word count at the writer's
  // WPM, because no audio exists at spec time. The spec names only the REAL
  // picture changes; the <= 3 s pace is enforced at render (Phase 4) by
  // sub-cutting any longer shot into a closer or alternate view of the same
  // subject, and measured from the word timings in Phase 6. Gating it here
  // made the model pad with repeat shots of one subject (dry run, 24 Sep).
  const spokenSecs = words / (wpm / 60);
  const avgShotSecs = shots ? spokenSecs / shots : 0;
  if (shots && avgShotSecs > MAX_AVG_SHOT_SECS) {
    warnings.push(`estimated average shot length ${avgShotSecs.toFixed(1)}s is over ${MAX_AVG_SHOT_SECS}s — ` +
      `the renderer will sub-cut long shots; report only, nothing was refused on it`);
  }
  return {
    errors, warnings,
    stats: { shots, punch, spokenSecs: Number(spokenSecs.toFixed(1)), avgShotSecs: Number(avgShotSecs.toFixed(2)), byKind, byIntent },
  };
}
