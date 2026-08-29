import test from "node:test";
import assert from "node:assert/strict";
import {
  isSensitiveHeadline, isExplicitHarmHeadline,
  TRAGEDY_KEYWORDS, EXPLICIT_HARM_KEYWORDS, AMBIGUOUS_HARM_KEYWORDS,
} from "./editorialSensitivity.js";

// ─── The ordering invariant ─────────────────────────────────────────────────

test("the narrow tier is a STRICT SUBSET of the broad one — the tiers cannot invert", () => {
  // The load-bearing property. If a headline could ever withhold the
  // publisher's own photo while permitting stock footage, the gate would be
  // backwards in exactly the way it was built to fix.
  const corpus = [
    "Six killed in Kabul bombing", "Veteran actor dies aged 88", "500 deaths confirmed",
    "Gunman opens fire, six dead", "Plane crash kills 200", "Nation mourns after massacre",
    "Bitcoin crash wipes $200bn off the market", "Cyber attack downs booking system",
    "Netflix begins shooting season three", "A PR disaster for the conference",
    "Fatal flaw in the chip design", "Senate advances health funding",
    "German economy posts modest growth", "Coroner rules death was accidental",
    "Bus crash leaves dozens injured", "Man stabbed outside stadium",
    "Two drowned in harbour rescue", "Funeral held for former premier",
  ];
  for (const h of corpus) {
    if (isExplicitHarmHeadline(h)) {
      assert.equal(isSensitiveHeadline(h), true,
        `"${h}" withholds the publisher photo but would allow stock — the tiers are inverted`);
    }
  }
});

test("every keyword from the original single list survives somewhere in the broad tier", () => {
  // The broad guard must never have got LOOSER. These are the exact words the
  // pre-split regex carried; each still has to suppress third-party imagery.
  for (const w of ["dies", "die", "killed", "death", "murdered", "fatal", "tragedy",
                   "massacre", "crash", "attack", "shooting", "terror", "disaster",
                   "funeral", "mourns", "mourn", "stabbed", "drowned"]) {
    assert.equal(isSensitiveHeadline(`report says ${w} in the city`), true,
      `the broad tier lost "${w}"`);
  }
});

// ─── What the split is FOR ──────────────────────────────────────────────────

test("metaphors keep the publisher's photograph and still refuse stock", () => {
  // The reason for the narrow tier. A picture editor chose an image for a
  // market-crash story; a keyword firing on "crash" there is more likely wrong
  // than right. Stock still gets the broad refusal — nobody vetted it.
  for (const h of [
    "Bitcoin crash wipes $200bn off crypto market",
    "Cyber attack takes down airline booking system",
    "A PR disaster for the party conference",
    "Fatal flaw in the chip design, engineers say",
  ]) {
    assert.equal(isExplicitHarmHeadline(h), false, `publisher photo should survive: ${h}`);
    assert.equal(isSensitiveHeadline(h), true, `third-party imagery must not: ${h}`);
  }
});

test("explicit harm withholds EVERY picture, publisher's included", () => {
  for (const h of [
    "Six killed in Kabul bombing",
    "Veteran actor dies aged 88",
    "Nation mourns after massacre",
    "Norway mourns King Harald as Haakon VIII ascends throne",
    "Coroner rules death was accidental",
    "Man stabbed outside the stadium",
  ]) {
    assert.equal(isExplicitHarmHeadline(h), true, `expected explicit harm: ${h}`);
    assert.equal(isSensitiveHeadline(h), true);
  }
});

// ─── The inflection gaps, which are why this is not a pure partition ────────

test("INFLECTIONS: the gaps the polysemous words were accidentally covering", () => {
  // Measured before the split: "Plane crash kills 200" matched ONLY on `crash`,
  // because the list carried `killed` and not `kills`. Moving `crash` to the
  // broad tier would have silently stopped suppressing the publisher photo on
  // a plane crash — the split REQUIRED closing these, it did not merely tidy.
  for (const h of [
    "Plane crash kills 200 in Nepal",
    "At least 500 deaths confirmed in Himalayan flood",
    "Gunman opens fire at school, six dead",
    "Israeli strike killing 12, medics say",
    "Two children drowning in the harbour",
  ]) {
    assert.equal(isExplicitHarmHeadline(h), true,
      `inflection gap reopened — the narrow tier misses: ${h}`);
  }
});

test("ordinary news keeps its photograph under BOTH tiers", () => {
  for (const h of [
    "Senate panel advances health funding package",
    "German economy posts modest quarterly growth",
    "Mastercard is letting AI bots spend your money",
    "EU gas stores at their lowest level in 13 years",
    "Fossils show huge carbon emissions harm forests",
  ]) {
    assert.equal(isExplicitHarmHeadline(h), false, `expected ordinary: ${h}`);
    assert.equal(isSensitiveHeadline(h), false, `expected ordinary: ${h}`);
  }
});

test("a missing headline takes the safe path in BOTH tiers", () => {
  for (const v of ["", null, undefined, "   "]) {
    assert.equal(isSensitiveHeadline(v), true);
    assert.equal(isExplicitHarmHeadline(v), true, "no headline to judge is not a licence to guess");
  }
});

test("the exported regexes are usable by importers, and disjoint in intent", () => {
  // socialComposer imports TRAGEDY_KEYWORDS directly rather than the function.
  for (const r of [TRAGEDY_KEYWORDS, EXPLICIT_HARM_KEYWORDS, AMBIGUOUS_HARM_KEYWORDS]) {
    assert.ok(r instanceof RegExp);
  }
  assert.equal(TRAGEDY_KEYWORDS.test("three killed"), true);
  assert.equal(TRAGEDY_KEYWORDS.test("three elected"), false);
  // A word may not sit in both sets — that would make the tiers meaningless.
  assert.equal(AMBIGUOUS_HARM_KEYWORDS.test("crash"), true);
  assert.equal(EXPLICIT_HARM_KEYWORDS.test("crash"), false);
});

test("the known gap is a GAP, and is documented as one", () => {
  // Stated so it fails loudly if someone later believes this is a classifier.
  // A graphic story phrased without any keyword passes both tiers.
  assert.equal(isExplicitHarmHeadline("Bodies recovered after ferry sinks"), false);
  assert.equal(isSensitiveHeadline("Bodies recovered after ferry sinks"), false);
});
