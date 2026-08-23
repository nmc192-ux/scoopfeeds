// Storyboard — "The Ebola Outbreak Nobody Saw Coming"
//
// 49 beats, 7 chapters. Authored to the STORY SPINE in script.md.
//
//   THROUGH-LINE — the burial on 27 March. Three Red Cross volunteers manage
//   dead bodies on a mission unrelated to Ebola, because no outbreak had been
//   identified. It returns as: the invisible start (1) → who the virus actually
//   kills (17) → the people named (39) → the seven weeks (42) → the answer (47).
//
//   THE QUESTION is asked on card 4 and answered on card 47. Every chapter
//   offers a candidate — a missing vaccine (24), a rare species (23), a tracing
//   protocol (28) — and each is explicitly set aside.
//
//   THE REVEAL is 39-43: a timeline in which the burial precedes the outbreak
//   declaration by seven weeks.
//
// EVERY NUMBER ON SCREEN IS CDC's, ON ONE BASIS, WITH ITS DATE.
//   The earlier cut mixed WHO AFRO's 5,021 (18 Aug) with CDC's series. The two
//   disagree because DRC's health ministry excludes probable cases and has
//   temporarily excluded suspected ones pending investigation, so national
//   surveillance runs ahead of WHO's validated regional figures. script.md §"THE
//   COUNTS DISAGREE" carries the reasoning. Cards 3, 10, 11, 12 are all CDC as
//   of 17 Aug 2026.
//
// EDITORIAL CONSTRAINTS ENCODED HERE:
//   · No card says or implies the vaccine "fails". Card 20 states Ervebo is
//     licensed against Zaire; card 22 quotes CEPI verbatim.
//   · Card 10 states the comparison BASIS on screen (confirmed-to-confirmed),
//     because 3,470 is confirmed+probable and mixing bases would be wrong.
//   · Card 8 is an EARLY-GROWTH comparison and says so on the card — it must
//     never read as "bigger than West Africa", which card 11 immediately
//     corrects with the 28,600 total.
//   · Cards 14-18 are the mandatory risk calibration and must not be cut.
//     Card 18 carries CDC's own risk language.
//   · Card 39 names the volunteers once, from IFRC's own statement. No images.
//   · Card 36 places the commitment and the reported criticism side by side
//     with no causal arrow between them.
//   · Card 34 presents hunger as a PRE-EXISTING condition, per WFP's framing —
//     never as a consequence of this outbreak.

import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const _HERE = path.dirname(fileURLToPath(import.meta.url));
const DOC = (f) => path.join(_HERE, "out/docs", f);

/** No AI-generated imagery in this film. */
export const PHOTOS = {};

/**
 * Real footage. Pexels License — provenance in out/footage/LICENSES.md.
 * Deliberately abstract: no identifiable people, and never presented as DRC
 * footage. WHO/MSF/UNICEF/Red Cross imagery is excluded by licence policy;
 * CDC PHIL and NIAID were excluded because their terms could not be verified.
 */
export const FOOTAGE = {
  1:  { file: "F_LAB",   in: 1 },
  31: { file: "F_ROAD",  in: 1 },
  48: { file: "F_TRIAL", in: 1 },
};
// Seven clips across nine slots, chosen so nothing repeats inside a beat and
// no clip returns within four minutes. Three clips filling nine slots made
// beat 35 cycle road-horizon-road-lab-road in seven seconds.

export const GRADES = {
  default:
    "eq=saturation=0.42:contrast=1.14:brightness=-0.10:gamma=0.94," +
    "colorbalance=rs=-0.06:gs=0.02:bs=-0.08:rm=-0.03:gm=0.03:bm=-0.06,vignette=PI/4.2",
  people:
    "eq=saturation=0.62:contrast=1.10:brightness=-0.07:gamma=0.96," +
    "colorbalance=rs=-0.03:gs=0.02:bs=-0.05:rm=-0.02:gm=0.02:bm=-0.04,vignette=PI/4.6",
  clinical:
    "eq=saturation=0.26:contrast=1.20:brightness=-0.10:gamma=0.94," +
    "colorbalance=rs=-0.05:gs=0.01:bs=0.03:rm=-0.03:gm=0.01:bm=0.02,vignette=PI/4.0",
  warm:
    "eq=saturation=0.38:contrast=1.28:brightness=-0.14:gamma=0.88," +
    "colorbalance=rs=0.03:gs=0.04:bs=-0.10:rm=0.04:gm=0.03:bm=-0.09,vignette=PI/3.6",
};
// Derived from FOOTAGE itself, so renumbering a beat cannot leave this behind.
for (const k of Object.keys(FOOTAGE)) FOOTAGE[k].grade = "clinical";

const RECTS_PATH = path.join(_HERE, "out/docs/rects.json");
const RECTS = existsSync(RECTS_PATH) ? JSON.parse(readFileSync(RECTS_PATH, "utf8")) : {};
const mkDoc = (key, eyebrow, src) => (RECTS[key] ? {
  card: "doc", image: DOC(key + ".png"),
  imgW: RECTS[key].w, imgH: RECTS[key].h, rects: RECTS[key].rects, eyebrow, src,
} : null);

export const DOCS = {
  cepi: mkDoc("cepi",
    "The wording · CEPI",
    "CEPI — Bundibugyo virus: what it is and what it is not"),
  who_don: mkDoc("who_don",
    "The outbreak notice · World Health Organization · 12 Aug 2026",
    "WHO Disease Outbreak News DON615 — Bundibugyo virus, DRC"),
  who_quote: mkDoc("who_quote",
    "The assessment · WHO, via UN News · May 2026",
    "WHO Director-General on tracing contacts in Ituri"),
};

const SRC_WHO   = "WHO Disease Outbreak News DON615 · 12 August 2026";
const SRC_CDC   = "US CDC · History of Ebola Outbreaks";
const SRC_NOW   = "US CDC · Ebola Outbreak: Current Situation · DRC data as of 17 Aug 2026";
const SRC_100   = "US CDC · first-100-days series (DRC INSP, WHO) · DRC data as of 19 Aug 2026";
const SRC_WFP   = "World Food Programme · How does Ebola affect food security?";
const FIRST100  = JSON.parse(readFileSync(path.join(_HERE, "out/cdc-first100.json"), "utf8"));
const SRC_CEPI  = "CEPI · Bundibugyo virus: what it is and what it is not";
const SRC_IFRC  = "IFRC statement · 23 May 2026";
const SRC_UN    = "UN News · WHO · May 2026";

export const TITLE_SEGMENT = {
  after: 5,
  seconds: 3.2,
  spec: {
    card: "title", kicker: "ScoopFeeds · Long-form",
    lines: ["THE EBOLA OUTBREAK", "NOBODY SAW COMING"],
    sub: "The fastest-growing Ebola outbreak on record. The missing vaccine is the headline — not the cause.",
  },
};

export const STORYBOARD = {
  // EVERY CARD BELONGS TO ITS OWN BEAT'S NARRATION.
  // The first cut drifted because each chapter divider sat on a beat that
  // carried a real content line, so the divider absorbed it and every later
  // card ran one beat behind — at ~7s a beat, that read as the voice running
  // five to seven seconds ahead of the picture. Chapter cards carry only the
  // chapter's opening line, and no card duplicates a fact another card showed.

  // ── COLD OPEN — the latest ─────────────────────────────────────────────
  1: { footage: "F_LAB" },
  2: { card: "statement", lines: ["NOBODY KNEW THERE WAS", "AN OUTBREAK, BECAUSE", "*NOBODY HAD FOUND IT."] },
  3: { card: "stat", kicker: "Confirmed cases · DRC · as of 17 August 2026", figure: "5,105", unit: "CASES",
       label: "And 2,420 confirmed deaths.", src: SRC_NOW },
  4: { card: "statement", lines: ["THE FASTEST-GROWING", "EBOLA OUTBREAK ON RECORD.", "*SO WHY NOW?"] },
  5: { card: "statement", lines: ["THERE IS NO VACCINE.", "THAT IS TRUE.", "*IT IS NOT THE REASON."] },

  // ── CHAPTER 01 ─────────────────────────────────────────────────────────
  6:  { card: "chapter", n: "01", name: "What is\nactually happening" },
  7:  { card: "map", variant: "drc", kicker: "Declared 15 May 2026 · Ituri province",
        title: "Fifty-four health zones, almost all in the east",
        note: "More than 97% of cases are in Ituri, North Kivu and South Kivu.",
        src: "Boundaries: Natural Earth (public domain) · " + SRC_WHO },
  // The claim "fastest-growing on record" was asserted for the whole first cut
  // and never shown. This is CDC's own five-outbreak series, redrawn from the
  // accessible data table published beneath their chart — not read off a
  // picture. The subtitle does the work the legend would otherwise have to.
  8:  { card: "multiline", kicker: "Cases reported in each outbreak's first 100 days",
        title: "One of these is not like the others",
        series: [
          { name: "Liberia 2014",      values: FIRST100.lib14 },
          { name: "Sierra Leone 2014", values: FIRST100.sl14 },
          { name: "DRC 2018",          values: FIRST100.drc18 },
          { name: "Guinea 2014",       values: FIRST100.gui14 },
          { name: "DRC 2026", values: FIRST100.drc26, hot: true, endLabel: "5,105" },
        ],
        xMax: 100, yMax: 5500, xLabel: "Days since the first case",
        note: "Early growth only — not total size. West Africa 2014–16 ended above 28,600.",
        src: SRC_100 },
  9:  { card: "stat", kicker: "Days from response activation to 1,000 confirmed cases",
        figure: "40", unit: "DAYS",
        label: "The 2018 outbreak, in the same country, took about 235.", src: SRC_NOW },
  10: { card: "bars", kicker: "Confirmed cases only — like for like",
        title: "Against the previous largest in DRC",
        items: [
          { label: "2018–20, Kivu", value: 3317, display: "3,317" },
          { label: "2026, Bundibugyo", value: 5105, display: "5,105", hot: true },
        ], src: SRC_CDC + " · confirmed-only basis, excludes probable cases" },
  11: { card: "bars", kicker: "But not the largest ever recorded",
        title: "West Africa, 2014–16",
        items: [
          { label: "2026, DRC", value: 5105, display: "5,105" },
          { label: "2014–16, West Africa", value: 28600, display: "28,600+", hot: true },
        ], src: SRC_CDC + " · CDC calls the 2026 outbreak the second largest on record" },
  12: { card: "linechart", kicker: "Crude case fatality rate · with dates",
        title: "Reported deaths as a share of reported cases",
        points: [
          { label: "30 July", v: 44.0, display: "44%" },
          { label: "12 August", v: 46.8, display: "46.8%" },
          { label: "17 August", v: 47.4, display: "47.4%", hot: true },
        ], yMin: 35, yMax: 55, ySuffix: "%",
        note: "2,420 of 5,105 confirmed cases, on 17 August.",
        src: "WHO, 30 Jul & 12 Aug 2026 · " + SRC_NOW },
  13: { card: "statement", lines: ["A RISING RATE CAN MEAN", "BETTER COUNTING —", "*NOT A DEADLIER VIRUS."] },

  // ── CHAPTER 02 — mandatory risk calibration ────────────────────────────
  14: { card: "chapter", n: "02", name: "What that number\ndoes not mean" },
  15: { card: "ledger", kicker: SRC_CEPI, title: "What Ebola is not",
        rows: [
          { who: "NOT AIRBORNE", what: "It does not travel through air." },
          { who: "NOT CASUAL CONTACT", what: "Proximity is not transmission." },
          { who: "NOT A PANDEMIC RISK", what: "Not considered to have pandemic potential.", hot: true },
        ], src: SRC_CEPI },
  16: { card: "equation", kicker: "How it actually spreads",
        numerator: "DIRECT CONTACT", denominator: "BLOOD OR BODY FLUIDS",
        result: "TRANSMISSION",
        note: "From someone who is sick — or someone who has died." },
  17: { card: "statement", lines: ["SO THE PEOPLE MOST AT RISK", "ARE THOSE CARING FOR THE SICK,", "*AND BURYING THE DEAD."] },
  // CDC's own words, and the reason this beat is here: a 47% figure with no
  // denominator of exposure is the number people carry away from a film.
  18: { card: "ledger", kicker: "Outside the affected region · US CDC, 20 August 2026",
        title: "What has left the region",
        rows: [
          { who: "FRANCE", what: "One exported confirmed case." },
          { who: "UNITED STATES", what: "No confirmed cases." },
          { who: "CDC'S ASSESSMENT", what: "Risk to the American public and travelers: low.", hot: true },
        ], src: "US CDC · Ebola Outbreak: Current Situation · 20 August 2026" },

  // ── CHAPTER 03 — the headline ──────────────────────────────────────────
  19: { card: "chapter", n: "03", name: "The\nheadline" },
  20: { card: "stat", kicker: "The licensed vaccine", figure: "ERVEBO", unit: "",
        label: "Licensed against Zaire ebolavirus. Used at scale, and it works." },
  21: { card: "statement", lines: ["THIS OUTBREAK", "IS NOT ZAIRE.", "*IT IS BUNDIBUGYO."] },
  22: { doc: "cepi" },
  23: { card: "ledger", kicker: "Every previous Bundibugyo outbreak", title: "Twice before, both small",
        rows: [
          { who: "2007 · UGANDA", what: "56 cases. Species identified here." },
          { who: "2012 · DR CONGO", what: "59 cases." },
        ], src: SRC_CDC },
  24: { doc: "who_don" },

  // ── CHAPTER 04 — what replaces a vaccine ───────────────────────────────
  25: { card: "chapter", n: "04", name: "What you do when\nthere is no vaccine" },
  26: { card: "pipeline", kicker: "Contact tracing", title: "The whole method",
        stages: [{ name: "FIND\nCONTACTS" }, { name: "VISIT\nDAILY" }, { name: "21 DAYS" }, { name: "ISOLATE\nON FEVER" }],
        broken: -1, note: "You start by finding everyone the patient touched." },
  27: { card: "stat", kicker: "For every single contact", figure: "21", unit: "DAYS",
        label: "The outer edge of the incubation period." },
  28: { card: "ledger", kicker: "What each step quietly assumes", title: "Three assumptions",
        rows: [
          { who: "FIND THEM", what: "Still where you last saw them." },
          { who: "REACH THEM", what: "The route is safe to travel." },
          { who: "THEY ANSWER", what: "They trust you enough to open.", hot: true },
        ] },

  // ── CHAPTER 05 — the thesis ────────────────────────────────────────────
  29: { card: "chapter", n: "05", name: "Why that\nfails here" },
  30: { card: "stat", kicker: "Across the affected provinces", figure: "4.4M", unit: "DISPLACED",
        label: "People who move cannot be revisited daily for three weeks.", src: SRC_UN },
  31: { footage: "F_ROAD" },
  32: { card: "ledger", kicker: "What the response is operating inside", title: "The conditions",
        rows: [
          { who: "RESPONDERS DETAINED", what: "Five held briefly, late July.", hot: true },
          { who: "FACILITIES ATTACKED", what: "Health facilities hit." },
        ], src: "OCHA · 27 July 2026" },
  // The film's thesis, stated by the agency responding to it. The last row is
  // the one that cannot be bought: it is the door in card 28 not opening.
  33: { card: "ledger", kicker: "Why the response is failing · US CDC", title: "CDC's own list",
        rows: [
          { who: "VIOLENCE", what: "Against health workers, who are being infected." },
          { who: "NO EQUIPMENT", what: "Shortages of protective equipment." },
          { who: "NO TRUST", what: "Lack of trust in government, and misinformation.", hot: true },
        ], src: "US CDC · Ebola Outbreak: Current Situation · 20 August 2026" },
  // WFP frames these as conditions the outbreak LANDS ON, not as its effects.
  // The card must not imply Ebola caused them.
  34: { card: "stat", kicker: "Before the outbreak arrived · WFP", figure: "8.7M", unit: "AT CRISIS HUNGER",
        label: "In the eastern provinces. 26.5m are acutely food insecure countrywide.",
        src: SRC_WFP },
  35: { doc: "who_quote" },
  36: { card: "ledger", kicker: "Both of these are on the record", title: "Money committed, and money criticised",
        rows: [
          { who: "COMMITTED", what: "UK £20m · EU €15m · US past $512m." },
          { who: "REPORTED", what: "Aid groups say earlier US cuts weakened the response beforehand." },
        ], src: "US State Dept, 5 Aug 2026 · CNN, 22 May 2026" },
  37: { card: "title", lines: ["THE SHORTAGE THAT MATTERS", "IS NOT ONLY MONEY."],
        sub: "It is sending someone to a door, safely, every day, for three weeks." },

  // ── CHAPTER 06 — the reveal ────────────────────────────────────────────
  38: { card: "chapter", n: "06", name: "The seven\nweeks" },
  39: { card: "ledger", kicker: SRC_IFRC, title: "DRC Red Cross, Mongbwalu branch",
        rows: [
          { who: "AJIKO CHANDIRU VIVIANE", what: "5 May 2026" },
          { who: "SEZABO KATANABO", what: "15 May 2026" },
          { who: "ALIKANA UDUMUSI AUGUSTIN", what: "16 May 2026" },
        ], src: SRC_IFRC },
  40: { card: "statement", lines: ["THEY HANDLED THE BODIES", "ON 27 MARCH. ALL THREE WERE", "*DEAD WITHIN SEVEN WEEKS."] },
  41: { card: "stat", kicker: "The first case anyone recognised", figure: "24 APR", unit: "2026",
        label: "A nurse, in Bunia." },
  42: { card: "pipeline", kicker: "What the timeline actually looks like", title: "Seven weeks of nothing",
        stages: [{ name: "27 MAR\nBURIAL" }, { name: "24 APR\nFIRST CASE" }, { name: "15 MAY\nDECLARED" }],
        broken: 0, note: "The virus was already moving. No system existed to see it." },
  43: { card: "title", lines: ["THAT IS THE GAP.", "NOT THE VACCINE.", "*THE SEEING."] },

  // ── CHAPTER 07 — forward ───────────────────────────────────────────────
  44: { card: "chapter", n: "07", name: "What\nhappens now" },
  45: { card: "ledger", kicker: "Uganda · declared over 28 July 2026", title: "It never left the capital",
        rows: [
          { who: "20 CONFIRMED", what: "All in Kampala. Two deaths." },
          { who: "NO COMMUNITY SPREAD", what: "Last case confirmed in June, linked to travel.", hot: true },
        ], src: SRC_NOW },
  46: { card: "statement", lines: ["NOT BECAUSE A VACCINE", "IS MISSING —", "*THOUGH ONE IS."] },
  47: { card: "title", lines: ["CONTAINMENT IS", "AN ADMINISTRATIVE ACT."],
        sub: "Attempted where administration is hardest." },
  48: { footage: "F_TRIAL" },
  49: { card: "ledger", kicker: "What is being built now", title: "None of it arrives in time for this outbreak",
        rows: [
          { who: "TREATMENT TRIAL", what: "Running in Ituri." },
          { who: "TWO VACCINES", what: "First human trials, Britain and Canada.", hot: true },
          { who: "UNTIL THEN", what: "The knocking on doors." },
        ] },
};

/**
 * IMAGERY ONLY — never a text card. All three keys are footage beats.
 */
export const INSERTS = {
  1:  [{ at: 0.42, dur: 1.2, footage: "F_MICRO" },
       { at: 0.55, dur: 1.1, footage: "F_VIAL" }],
  // 0.9s on the second: this beat's tail is too short to hold two 1.1s
  // cutaways, so the engine was silently dropping it. A shorter flash cut fits.
  31: [{ at: 0.36, dur: 1.1, footage: "F_CLOUDS" },
       { at: 0.50, dur: 0.9, footage: "F_DOOR", clipIn: 0 }],
  // The trials beat had F_HORIZON as its main with F_VIAL and F_CLOUDS as
  // cutaways — and all three had already been seen. Nine seconds of nothing new
  // at the point the film makes its closing argument. Its own three clips now.
  48: [{ at: 0.32, dur: 1.2, footage: "F_PIPETTE", clipIn: 1 },
       { at: 0.50, dur: 1.1, footage: "F_TUBE",    clipIn: 2 }],
};
