/**
 * videoSpecSchema.test.js — the refusals, not the happy path.
 *
 * Every test here corresponds to something the pipeline must REFUSE to render.
 * The happy path is covered incidentally (a valid spec has to pass for the
 * refusal tests to mean anything); what matters is that each way of producing
 * a wrong video is closed off, because §6.2's posture is "prefer publishing
 * nothing" and a validator that quietly repairs bad input inverts that.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  validateSpec,
  validatePackaging,
  decorateTitleCard,
  CARD_TYPES,
  MODEL_EMITTABLE,
  MIN_SLIDES,
  MAX_BARS,
  MAX_NODES,
  repeatedOpeningStems,
} from "./videoSpecSchema.js";

const SOURCES = ["Reuters", "BBC News", "Associated Press"];
const TEXT = "Reuters reported that 70 percent of cable faults involve anchors. " +
             "The network spans 500 cables and carries 99 percent of traffic. " +
             "Repairs took 30 days on average across 12 incidents.";

const titleCard  = () => ({ t: "title",  eyebrow: "SUBSEA", lines: [["THE CABLES", "white"], ["500", "lime"]], sub: "what carries the internet", caption: "Five hundred cables carry almost everything. Reported by Reuters." });
const kickerCard = () => ({ t: "kicker", top: "NOT SATELLITE", bottom: "CABLE", sub: "the map is the story", caption: "The internet is a map of cables, not satellites." });
const statCard   = (over = {}) => ({ t: "stat", eyebrow: "FAULTS", value: 70, unit: "%", lines: ["of faults", "involve anchors"], hi: 1, source: "Reuters", caption: "Reuters reports that seventy percent of faults involve anchors.", ...over });
const barsCard   = (over = {}) => ({ t: "bars", eyebrow: "CAUSE", bars: [["anchors", 70], ["nature", 30]], source: "BBC", caption: "The BBC reports anchors outweigh natural causes.", ...over });
// Filler CYCLES through four card types. A pad of identical cards is not a
// realistic spec and, since the mix gate landed, is not a valid one either —
// fixtures have to look like something the model would plausibly emit.
const FILLER_CYCLE = [
  (n) => ({ t: "diagram", eyebrow: `STEP ${n}`, nodes: [["SHORE", "landing"], ["TRUNK", "deep water"]], caption: `Step ${n} of the route runs from shore to trunk line.` }),
  (n) => ({ t: "turn", eyebrow: `TURN ${n}`, lines: [[`POINT ${n}`, "white"]], caption: `But reading ${n} misses what actually cuts the cable.` }),
  (n) => ({ t: "stat", eyebrow: `FIGURE ${n}`, value: 70, unit: "%", lines: ["of faults"], hi: 0, source: "Reuters", caption: `Reuters reports seventy percent again at point ${n}.` }),
  (n) => ({ t: "bars", eyebrow: `SPLIT ${n}`, bars: [["anchors", 70], ["nature", 30]], source: "BBC", caption: `The BBC reports anchors outweigh nature at point ${n}.` }),
];
const fillerCard = (n) => FILLER_CYCLE[n % FILLER_CYCLE.length](n);

// Padding for SMALL specs: alternates two card types that carry no numbers and
// no source, so a test about sourcing or figures measures only the cards it
// deliberately added.
const plainFiller = (n) => FILLER_CYCLE[n % 2](n);

// One beat per content card, matching what a compliant model would emit. The
// "one card per beat" equality is part of the contract now, so every fixture
// has to satisfy it — a fixture without beats is testing the wrong rejection.
const BEAT_KIND_CYCLE = ["figure", "mechanism", "turn", "consequence"];
function beatsFor(slides) {
  return slides
    .filter(c => c && typeof c === "object" && c.t !== "title" && c.t !== "kicker")
    .map((c, i) => ({
      kind: BEAT_KIND_CYCLE[i % 4],
      beat: `Beat ${i} of the story as the source states it.`,
      evidence: "70 percent of cable faults involve anchors",
    }));
}
const withBeats = (slides) => ({ beats: beatsFor(slides), slides });

/** Minimum viable valid spec: title + fillers + kicker, with matching beats. */
function spec(cards = [], { pad = 4, filler = plainFiller } = {}) {
  const mid = [];
  for (let i = 0; i < pad; i++) mid.push(filler(i));
  return withBeats([titleCard(), ...cards, ...mid, kickerCard()]);
}

const opts = { allowedSources: SOURCES, sourceText: TEXT };

// ─── The closed set ─────────────────────────────────────────────────────────

test("valid spec passes and reports stats", () => {
  const v = validateSpec(spec([statCard()]), opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.dropped.length, 0);
  assert.equal(v.stats.slides, 7);
  assert.equal(v.stats.byType.stat, 1);
});

test("unknown card type is DROPPED and recorded — never a render attempt", () => {
  const s = spec([{ t: "carousel", caption: "x" }]);
  const v = validateSpec(s, opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.dropped.length, 1);
  assert.equal(v.dropped[0].kind, "structural");
  assert.match(v.dropped[0].reason, /unknown card type "carousel"/);
  assert.ok(!v.spec.slides.some(c => c.t === "carousel"));
});

test("two malformed bars cards do NOT kill a 22-slide spec — the live 2026-08-02 failure", () => {
  const singleBar = { t: "bars", eyebrow: "X", bars: [["only", 70]], source: "Reuters", caption: "One bar is not a comparison." };
  const v = validateSpec(spec([singleBar, { ...singleBar }], { pad: 18, filler: fillerCard }), opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.dropped.length, 2);
  assert.ok(v.dropped.every(d => d.kind === "structural" && /2 or more/.test(d.reason)));
  assert.equal(v.stats.slides, 20); // 22 raw − 2 dropped
});




// ─── Source traceability — drop, don't invent ───────────────────────────────

test("stat card with an untraceable source is DROPPED, spec survives", () => {
  const v = validateSpec(spec([statCard({ source: "analysts" })]), opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.dropped.length, 1);
  assert.match(v.dropped[0].reason, /untraceable source "analysts"/);
  assert.ok(!v.spec.slides.some(c => c.t === "stat"));
});

test("bars card with an untraceable source is DROPPED", () => {
  const v = validateSpec(spec([barsCard({ source: "industry sources" })]), opts);
  assert.equal(v.ok, true);
  assert.equal(v.dropped.length, 1);
  assert.ok(!v.spec.slides.some(c => c.t === "bars"));
});

test("outlet naming is tolerant both directions — 'BBC' matches 'BBC News'", () => {
  const v = validateSpec(spec([barsCard({ source: "BBC" })]), opts);
  assert.equal(v.dropped.length, 0, JSON.stringify(v.dropped));
});

test("a figure absent from the source text is DROPPED even under a real outlet", () => {
  // Reuters is a legitimate outlet here; 88 is simply not in the article.
  const v = validateSpec(spec([statCard({ value: 88 })]), opts);
  assert.equal(v.ok, true);
  assert.equal(v.dropped.length, 1);
  assert.match(v.dropped[0].reason, /figures absent from source text: 88/);
});

test("with no allowed sources, every numeric card drops", () => {
  const v = validateSpec(spec([statCard(), barsCard()]), { ...opts, allowedSources: [] });
  assert.equal(v.dropped.length, 2);
});

test("dropping below the slide floor turns a drop into a SKIP", () => {
  const s = withBeats([titleCard(), statCard({ source: "nobody" }), kickerCard()]);
  const v = validateSpec(s, { ...opts, minSlides: 3 });
  assert.equal(v.ok, false);
  assert.match(v.errors.join(" "), /only 2 slides remain/);
});

// ─── Drop-rate gate ─────────────────────────────────────────────────────────

test("the peptides case: 15 of 26 dropped now FAILS instead of passing as ok", () => {
  // 26 emitted, 15 structurally malformed → 57.7% > 40%.
  const malformed = () => ({ t: "diagram", nodes: [["ONLY", "one"]], caption: "A diagram needs two nodes." });
  const mid = [];
  for (let i = 0; i < 15; i++) mid.push(malformed());
  for (let i = 0; i < 9; i++)  mid.push(fillerCard(i));
  const s = withBeats([titleCard(), ...mid, kickerCard()]);
  assert.equal(s.slides.length, 26);
  const v = validateSpec(s, opts);
  assert.equal(v.ok, false);
  assert.equal(v.dropped.length, 15);
  assert.match(v.errors.join(" "), /drop rate 58% \(15\/26\) exceeds 40%/);
});

test("a drop rate at or under 40% still passes", () => {
  const malformed = () => ({ t: "diagram", nodes: [["ONLY", "one"]], caption: "A diagram needs two nodes." });
  const mid = [];
  for (let i = 0; i < 4; i++)  mid.push(malformed());
  for (let i = 0; i < 14; i++) mid.push(fillerCard(i));
  const s = withBeats([titleCard(), ...mid, kickerCard()]);  // 4/20 = 20%
  const v = validateSpec(s, opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.stats.dropRatio, 0.2);
  assert.equal(v.stats.emitted, 20);
});

test("more than 2 SOURCING drops fails even at a low overall drop rate", () => {
  const mid = [];
  for (let i = 0; i < 3; i++) mid.push(statCard({ source: "analysts", value: 70 }));
  for (let i = 0; i < 25; i++) mid.push(fillerCard(i));
  const s = withBeats([titleCard(), ...mid, kickerCard()]);  // 3/30 = 10%
  const v = validateSpec(s, { ...opts, maxSlides: 40 });
  assert.equal(v.ok, false);
  assert.equal(v.dropped.filter(d => d.kind === "sourcing").length, 3);
  assert.match(v.errors.join(" "), /3 sourcing drops exceeds 2/);
  assert.ok(!/drop rate/.test(v.errors.join(" ")), "overall rate was fine — only the sourcing ceiling tripped");
});

test("exactly 2 sourcing drops is allowed", () => {
  const mid = [];
  for (let i = 0; i < 2; i++) mid.push(statCard({ source: "analysts", value: 70 }));
  for (let i = 0; i < 16; i++) mid.push(fillerCard(i));
  const s = withBeats([titleCard(), ...mid, kickerCard()]);
  const v = validateSpec(s, opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.stats.sourcingDrops, 2);
});

// ─── Beats enumeration — the plan is part of the contract ───────────────────

test("a spec without beats is rejected spec-level — retryable, never a drop", () => {
  const s = spec([statCard()]);
  delete s.beats;
  const v = validateSpec(s, opts);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(" "), /missing beats enumeration/);
});

test("one card per beat: a mismatch is a spec-level error carrying the model's own numbers", () => {
  const s = spec([statCard()]);
  s.beats = s.beats.slice(0, s.beats.length - 2); // enumerated fewer than it emitted
  const v = validateSpec(s, opts);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(" "), /enumerated 3 beats but emitted 5 content cards/);
});

test("a beat with an unknown kind, or missing evidence, rejects the spec", () => {
  const a = spec([statCard()]);
  a.beats[0].kind = "revelation";
  assert.match(validateSpec(a, opts).errors.join(" "), /kind must be one of figure\|mechanism\|turn\|consequence/);
  const b = spec([statCard()]);
  delete b.beats[1].evidence;
  assert.match(validateSpec(b, opts).errors.join(" "), /"evidence" must quote the source words/);
});


test("beat stats are reported — count and kind tally", () => {
  const v = validateSpec(spec([statCard()]), opts);
  assert.equal(v.stats.beats, 5);
  const total = Object.values(v.stats.beatKinds).reduce((a, b) => a + b, 0);
  assert.equal(total, 5);
});

// ─── Card-type mix ──────────────────────────────────────────────────────────

test("the Hindu case: 26 slides / 21 stat is dropped down and then rejected", () => {
  // Every card individually valid; the spec is still a spreadsheet read aloud.
  const s = withBeats([titleCard()]);
  for (let i = 0; i < 21; i++) s.slides.push(statCard({ caption: `Reuters reports seventy percent, point ${i}.` }));
  for (let i = 0; i < 3; i++)  s.slides.push(plainFiller(i));
  s.slides.push(kickerCard());
  s.beats = beatsFor(s.slides);
  assert.equal(s.slides.length, 26);

  const v = validateSpec(s, opts);
  const mixDrops = v.dropped.filter(d => d.kind === "mix");
  assert.ok(mixDrops.length >= 18, `expected heavy mix drops, got ${mixDrops.length}`);
  // Dropping is preferred to rejecting per-card, but a spec this monotonous
  // then trips the drop-rate gate and routes to regeneration.
  assert.equal(v.ok, false);
  assert.match(v.errors.join(" "), /drop rate \d+% .* exceeds 40%/);
});

test("no more than 2 of the same type consecutively", () => {
  const s = withBeats([titleCard()]);
  for (let i = 0; i < 4; i++) s.slides.push(statCard({ caption: `Reuters reports run card ${i}.` }));
  for (let i = 0; i < 8; i++) s.slides.push(plainFiller(i));
  s.slides.push(kickerCard());
  s.beats = beatsFor(s.slides);
  const v = validateSpec(s, opts);
  const runDrops = v.dropped.filter(d => /consecutive/.test(d.reason));
  assert.equal(runDrops.length, 2, JSON.stringify(v.dropped));
  // Exactly two of the run survive, in order.
  assert.equal(v.spec.slides.filter(c => c.t === "stat").length, 2);
});

test("a well-mixed spec is untouched by the mix gate", () => {
  const s = withBeats([titleCard()]);
  for (let i = 0; i < 20; i++) s.slides.push(fillerCard(i));
  s.slides.push(kickerCard());
  s.beats = beatsFor(s.slides);
  const v = validateSpec(s, opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.stats.mixDrops, 0, JSON.stringify(v.dropped));
});

test("the mix gate runs at EVERY size — no suspension threshold", () => {
  // 8 cards with 3 stat in a row. The old MIX_MIN_CARDS=9 suspension meant the
  // gate never executed on a spec this size — and every live spec on
  // 2026-08-02 came back at 6 cards, so it never executed at all.
  const s = withBeats([titleCard(), statCard(), statCard(), statCard(), plainFiller(0), plainFiller(1), plainFiller(2), kickerCard()]);
  const v = validateSpec(s, opts);
  assert.equal(v.stats.mixDrops, 1, JSON.stringify(v.dropped));
  assert.match(v.dropped[0].reason, /consecutive "stat" cards/);
});

test("MIN_CARDS_PER_TYPE keeps the share cap safe on small specs", () => {
  // 7 cards, 2 of a type: the exact 1/3 solution would allow only 1 here
  // (floor(5/2) = 2 — but on a 6-card spec it drops to 1). The floor of 2 is
  // what makes the gate safe at every size without a threshold.
  const s = withBeats([titleCard(), statCard(), statCard(), plainFiller(0), plainFiller(1), kickerCard()]);
  const v = validateSpec(s, opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.stats.mixDrops, 0, JSON.stringify(v.dropped));
  assert.equal(v.stats.byType.stat, 2);
});

// ─── Length floor (duration is a ceiling, not a target) ─────────────────────

test("a spec below the floor is skipped as too thin, never padded", () => {
  const s = withBeats([titleCard(), plainFiller(0), plainFiller(1), kickerCard()]);
  const v = validateSpec(s, opts);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(" "), /only 4 slides remain.*< 5.*too thin for a video/);
});

test("exactly 6 surviving cards is enough", () => {
  const s = withBeats([titleCard(), plainFiller(0), plainFiller(1), plainFiller(2), plainFiller(3), kickerCard()]);
  const v = validateSpec(s, opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.stats.slides, 6);
});

// ─── §3b/3 — credit in the narration, not only in the field ─────────────────

test("the FIRST use of a source must be credited aloud — else DROPPED", () => {
  // The field says Reuters; the spoken line presents the figure as ours.
  const v = validateSpec(spec([statCard({ caption: "Seventy percent of faults involve anchors." })]), opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.dropped.length, 1);
  assert.equal(v.dropped[0].kind, "sourcing");
  assert.match(v.dropped[0].reason, /first use of "Reuters" carries no verbal credit/);
});

test("crediting a DIFFERENT outlet does not satisfy the rule", () => {
  const v = validateSpec(spec([statCard({ source: "Reuters", caption: "The BBC reports seventy percent of faults involve anchors." })]), opts);
  assert.equal(v.dropped.length, 1, "a caption must credit its own card's source");
  assert.match(v.dropped[0].reason, /first use of "Reuters" carries no verbal credit/);
});

test("a PRE-CREDITED source needs no verbal credit — §3b/3 as amended", () => {
  // The attribution card is injected ahead of the model's cards and names the
  // outlet aloud once. Figure captions then carry none: hearing the same
  // masthead four times in ninety seconds reads as a disclaimer.
  const v = validateSpec(
    spec([statCard({ caption: "Seventy percent of faults involve anchors." })]),
    { ...opts, preCreditedSources: ["Reuters"] });
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.dropped.filter(d => d.kind === "sourcing").length, 0,
    "a pre-credited source must not require a second spoken mention");
});

test("re-crediting a pre-credited source is a WARNING, not a drop", () => {
  const v = validateSpec(
    spec([statCard({ caption: "Reuters reports that seventy percent of faults involve anchors." })]),
    { ...opts, preCreditedSources: ["Reuters"] });
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.dropped.filter(d => d.kind === "sourcing").length, 0, "verbosity is not a trust failure");
  assert.match(v.warnings.join(" "), /re-credits "Reuters", already named aloud/);
});

test("the rule is SOURCE-KEYED — a second, different outlet must be credited", () => {
  // The future multi-source path: a figure from an outlet the viewer has not
  // heard named is a figure that has not been credited, however many times
  // some OTHER outlet was mentioned.
  const v = validateSpec(
    spec([barsCard({ source: "BBC News", caption: "Anchors outweigh natural causes." })]),
    { ...opts, preCreditedSources: ["Reuters"] });
  assert.equal(v.dropped.filter(d => d.kind === "sourcing").length, 1,
    "a source not yet named aloud still needs its own credit");
  assert.match(v.dropped[0].reason, /first use of "BBC News" carries no verbal credit/);
});

test("crediting the second outlet satisfies it, and does not re-arm the first", () => {
  const v = validateSpec(
    spec([barsCard({ source: "BBC News", caption: "The BBC reports anchors outweigh natural causes." })]),
    { ...opts, preCreditedSources: ["Reuters"] });
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.dropped.filter(d => d.kind === "sourcing").length, 0);
});


test("newsreader shortening is accepted — 'BBC' credits 'BBC News'", () => {
  const v = validateSpec(spec([barsCard({ source: "BBC News", caption: "The BBC reports anchors outweigh nature." })]), opts);
  assert.equal(v.dropped.length, 0, JSON.stringify(v.dropped));
});

test("a generic word from a multi-word outlet does NOT credit it", () => {
  // "News" alone would otherwise satisfy "BBC News", which is no credit at all.
  const v = validateSpec(spec([barsCard({ source: "BBC News", caption: "News of the outage spread quickly." })]), opts);
  assert.equal(v.dropped.length, 1);
});

test("cards carrying no figure are exempt — only stat and bars need the credit", () => {
  const v = validateSpec(spec([{ t: "turn", lines: [["THE REAL CAUSE", "white"]], caption: "But the ordinary explanation is the right one." }]), opts);
  assert.equal(v.dropped.filter(d => d.kind === "sourcing").length, 0,
    `a card with no figure must never be dropped for attribution: ${JSON.stringify(v.dropped)}`);
});

// ─── §3b/5 — the pipeline's own layer ───────────────────────────────────────

test("a spec of only headline and figures is REJECTED — nothing of ours in it", () => {
  const s = withBeats([
    titleCard(),
    statCard(), statCard({ value: 500, caption: "Reuters reports five hundred cables carry the traffic." }),
    barsCard(), barsCard({ caption: "The BBC reports the same split holds offshore." }),
    kickerCard(),
  ]);
  const v = validateSpec(s, opts);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(" "), /no diagram or turn card .* restates the source/);
});

test("one diagram is enough to satisfy the own-layer gate", () => {
  const s = withBeats([
    titleCard(),
    statCard(),
    { t: "diagram", nodes: [["SHORE", "landing"], ["TRUNK", "deep water"]], caption: "The route runs from shore to trunk line." },
    statCard({ value: 500, caption: "Reuters reports five hundred cables carry the traffic." }),
    barsCard(),
    kickerCard(),
  ]);
  const v = validateSpec(s, opts);
  assert.equal(v.ok, true, v.errors.join("; "));
});

test("one turn is equally sufficient", () => {
  const s = withBeats([
    titleCard(),
    statCard(),
    { t: "turn", lines: [["NOT SABOTAGE", "lime"]], caption: "But the mundane explanation is the correct one." },
    barsCard(),
    statCard({ value: 500, caption: "Reuters reports five hundred cables carry the traffic." }),
    kickerCard(),
  ]);
  assert.equal(validateSpec(s, opts).ok, true);
});

test("the own-layer gate is judged on SURVIVORS, not on what was emitted", () => {
  // The only diagram is malformed and gets dropped — the spec must then fail
  // the gate, not pass on the strength of a card that will never render.
  const s = withBeats([
    titleCard(),
    statCard(),
    { t: "diagram", nodes: [["ONLY", "one"]], caption: "A diagram needs two nodes." },
    barsCard(),
    statCard({ value: 500, caption: "Reuters reports five hundred cables carry the traffic." }),
    kickerCard(),
  ]);
  const v = validateSpec(s, opts);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(" "), /no diagram or turn card/);
});

// ─── §3b/2 — publisher images can never reach a renderer ────────────────────

test("a publisher image URL on a card is stripped, not passed through", () => {
  // §3b/2: stock or generated only. The contract has no image field on any
  // card type, so an image_url the model invents is discarded by pruning —
  // the renderer can never receive one.
  const v = validateSpec(spec([statCard({ image_url: "https://publisher.example/wire-photo.jpg" })]), opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  const stat = v.spec.slides.find(c => c.t === "stat");
  assert.equal(stat.image_url, undefined);
  assert.ok(!JSON.stringify(v.spec).includes("wire-photo"));
});

// ─── Brand invariant ────────────────────────────────────────────────────────

test("two lime lines drop the card — accent is one element per frame", () => {
  const s = spec([{ t: "turn", lines: [["ONE", "lime"], ["TWO", "lime"]], caption: "But the real story is different." }]);
  const v = validateSpec(s, opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.dropped.length, 1);
  assert.match(v.dropped[0].reason, /accent is exactly one element per frame/);
});

test("an unknown colour drops the card", () => {
  const s = spec([{ t: "turn", lines: [["ONE", "crimson"]], caption: "But the real story is different." }]);
  const v = validateSpec(s, opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.dropped.length, 1);
  assert.match(v.dropped[0].reason, /color must be one of/);
});

// ─── Structure ──────────────────────────────────────────────────────────────

test("a spec without an opening title fails", () => {
  const s = spec();
  s.slides[0] = fillerCard(99);
  assert.equal(validateSpec(s, opts).ok, false);
});

test("a spec without a closing kicker fails", () => {
  const s = spec();
  s.slides[s.slides.length - 1] = fillerCard(99);
  assert.equal(validateSpec(s, opts).ok, false);
});

test("a card without a caption is dropped — the caption is the narration line", () => {
  const s = spec([{ t: "turn", lines: [["ONE", "white"]] }]);
  const v = validateSpec(s, opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.dropped.length, 1);
  assert.match(v.dropped[0].reason, /missing required field "caption"/);
});

test("out-of-range marker and hi indices drop their cards", () => {
  const a = validateSpec(spec([{ t: "diagram", nodes: [["A", "x"], ["B", "y"]], marker: { on: 7, label: "here" }, caption: "The break is here on the route." }]), opts);
  assert.equal(a.ok, true, a.errors.join("; "));
  assert.match(a.dropped[0].reason, /marker\.on must index into nodes/);
  const b = validateSpec(spec([statCard({ hi: 9 })]), opts);
  assert.equal(b.ok, true, b.errors.join("; "));
  assert.match(b.dropped[0].reason, /"hi" must index into lines/);
});

test("a dropped opener or closer is a spec-level failure — first/last judged on survivors", () => {
  // The title card itself is malformed (no caption) → dropped → the first
  // SURVIVING card is not a title → whole spec fails, legibly.
  const s = spec();
  delete s.slides[0].caption;
  const v = validateSpec(s, opts);
  assert.equal(v.ok, false);
  assert.equal(v.dropped.length, 1);
  assert.match(v.errors.join(" "), /first surviving card must be "title"/);
});

test("a title citing a figure that lives only on a DROPPED card is itself dropped", () => {
  // stat 70 dropped for untraceable sourcing; a title asserting 70 must not
  // ship — the published video no longer pays it off.
  const v0 = validateSpec(spec([statCard({ source: "analysts" })]), opts);
  assert.equal(v0.ok, true);
  assert.equal(v0.dropped.length, 1);
  const p = validatePackaging(packaging({
    titles: ["70 percent of faults are anchors", "Anchors cut more cable than storms", "The map nobody publishes"],
  }), v0.spec);
  assert.equal(p.ok, true, p.errors.join("; "));
  assert.match(p.dropped.map(d => d.reason).join(" "), /figure "70" appears in no slide/);
  assert.ok(!p.packaging.titles.some(t => t.includes("70")));
});

test("fields outside the contract are stripped, not passed through", () => {
  const v = validateSpec(spec([statCard({ background_image: "https://evil.example/x.png" })]), opts);
  assert.equal(v.ok, true);
  const stat = v.spec.slides.find(c => c.t === "stat");
  assert.equal(stat.background_image, undefined);
  assert.equal(stat.value, 70);
});

// ─── Packaging (§5b) ────────────────────────────────────────────────────────

const validSpec = () => validateSpec(spec([statCard()]), opts).spec;

const packaging = (over = {}) => ({
  titles: ["500 cables carry the whole internet", "Anchors cut more cable than storms", "The map nobody publishes"],
  thumbnails: [
    { hook: "500 CABLES", kicker: "THE WHOLE INTERNET", accent: "500", angle: "scale" },
    { hook: "NOT SATELLITE", kicker: "WHERE DATA GOES", accent: "NOT", angle: "myth-break" },
    { hook: "70% ANCHORS", kicker: "WHAT CUTS THE CABLE", accent: "70%", angle: "number" },
  ],
  description_hook: "Almost all intercontinental data moves through seabed cable, not satellites.",
  tags: ["subsea cable", "internet infrastructure", "anchors"],
  image_query: "seabed cable ship",
  ...over,
});

test("valid packaging passes", () => {
  const v = validatePackaging(packaging(), validSpec());
  assert.equal(v.ok, true, v.errors.join("; "));
});

test("a title asserting a figure the video never pays off is DROPPED, payload survives", () => {
  const v = validatePackaging(packaging({
    titles: ["92 percent of traffic runs on cable", "Anchors cut more cable than storms", "The map nobody publishes"],
  }), validSpec());
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.dropped.length, 1);
  assert.equal(v.dropped[0].kind, "title");
  assert.match(v.dropped[0].reason, /figure "92" appears in no slide/);
  // The offending title never ships.
  assert.equal(v.packaging.titles.length, 2);
  assert.ok(!v.packaging.titles.some(t => t.includes("92")));
});

test("when EVERY title is bad, packaging is rejected — nothing left to upload", () => {
  const v = validatePackaging(packaging({
    titles: ["92 percent of traffic runs on cable", "How cables work", "x".repeat(61)],
  }), validSpec());
  assert.equal(v.ok, false);
  assert.match(v.errors.join(" "), /no title survived validation/);
});

test("when EVERY thumbnail is bad, packaging is rejected", () => {
  const bad = { hook: "A B C D E", kicker: "x", accent: "A", angle: "scale" };
  const v = validatePackaging(packaging({ thumbnails: [bad, { ...bad }, { ...bad }] }), validSpec());
  assert.equal(v.ok, false);
  assert.match(v.errors.join(" "), /no thumbnail survived validation/);
});

test("one surviving title and one surviving thumbnail is enough to ship", () => {
  const good = packaging().thumbnails[0];
  const bad  = { hook: "A B C D E", kicker: "x", accent: "A", angle: "scale" };
  const v = validatePackaging(packaging({
    titles: ["Anchors cut more cable than storms", "How cables work", "x".repeat(61)],
    thumbnails: [good, bad, { ...bad }],
  }), validSpec());
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.packaging.titles.length, 1);
  assert.equal(v.packaging.thumbnails.length, 1);
  assert.match(v.warnings.join(" "), /Test & Compare will run with 1 title\(s\) \/ 1 thumbnail\(s\)/);
});

test("a figure that IS paid off by a slide passes", () => {
  const v = validatePackaging(packaging({
    titles: ["70 percent of faults are anchors", "Anchors cut more cable than storms", "The map nobody publishes"],
  }), validSpec());
  assert.equal(v.ok, true, v.errors.join("; "));
});

test("titles over 60 chars, or opening with How/Why/brand, are dropped", () => {
  const drops = (titles) => validatePackaging(packaging({ titles }), validSpec()).dropped.map(d => d.reason).join(" ");
  assert.match(drops(["x".repeat(61), "a", "b"]),        /61 chars > 60/);
  assert.match(drops(["How cables work", "a", "b"]),      /must not open with "How"/);
  assert.match(drops(["ScoopFeeds explains cable", "a", "b"]), /must not open with "ScoopFeeds"/);
});

test("a thumbnail hook longer than 3 words is dropped — it must survive 168px", () => {
  const v = validatePackaging(packaging({
    thumbnails: [
      { hook: "THE CABLES THAT CARRY EVERYTHING", kicker: "x", accent: "CABLES", angle: "scale" },
      ...packaging().thumbnails.slice(1),
    ],
  }), validSpec());
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.match(v.dropped.map(d => d.reason).join(" "), /hook is 5 words, max 3/);
  assert.equal(v.packaging.thumbnails.length, 2);
});

test("an accent word not present in its hook is dropped", () => {
  const v = validatePackaging(packaging({
    thumbnails: [
      { hook: "500 CABLES", kicker: "x", accent: "OCEAN", angle: "scale" },
      ...packaging().thumbnails.slice(1),
    ],
  }), validSpec());
  assert.equal(v.ok, true);
  assert.match(v.dropped.map(d => d.reason).join(" "), /accent "OCEAN" is not part of hook/);
});

test("an unknown thumbnail angle is dropped", () => {
  const v = validatePackaging(packaging({
    thumbnails: [
      { hook: "500 CABLES", kicker: "x", accent: "500", angle: "shock" },
      ...packaging().thumbnails.slice(1),
    ],
  }), validSpec());
  assert.equal(v.ok, true);
  assert.match(v.dropped.map(d => d.reason).join(" "), /angle must be one of/);
});

test("repeated thumbnail angles WARN — variants must differ in angle, not wording", () => {
  const v = validatePackaging(packaging({
    thumbnails: [
      { hook: "CABLE MAP", kicker: "THE REAL ROUTE", accent: "MAP", angle: "scale" },
      { hook: "SEABED FIBRE", kicker: "NOT ORBIT", accent: "FIBRE", angle: "scale" },
      { hook: "ANCHOR DRAG", kicker: "WHAT BREAKS IT", accent: "ANCHOR", angle: "scale" },
    ],
  }), validSpec());
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.match(v.warnings.join(" "), /repeat angle\(s\) scale/);
});

test("two or more bare-count hooks WARN, but still publish", () => {
  // The brief's own example set: "500 CABLES" and "70% ANCHORS" both lead with
  // a numeral — the set is testing one idea, that a number is the hook.
  const v = validatePackaging(packaging(), validSpec());
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.match(v.warnings.join(" "), /2 thumbnails are bare counts/);
});

test("a single bare-count hook is fine", () => {
  const v = validatePackaging(packaging({
    thumbnails: [
      { hook: "500 CABLES", kicker: "THE WHOLE INTERNET", accent: "500", angle: "scale" },
      { hook: "NOT SATELLITE", kicker: "WHERE DATA GOES", accent: "NOT", angle: "myth-break" },
      { hook: "ANCHOR DRAG", kicker: "WHAT CUTS IT", accent: "ANCHOR", angle: "consequence" },
    ],
  }), validSpec());
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.ok(!v.warnings.some(w => /bare counts/.test(w)), v.warnings.join("; "));
  assert.ok(!v.warnings.some(w => /repeat angle/.test(w)), v.warnings.join("; "));
});

test("tags over 500 chars are rejected", () => {
  const v = validatePackaging(packaging({ tags: Array.from({ length: 40 }, (_, i) => `tag-number-${i}-padding`) }), validSpec());
  assert.equal(v.ok, false);
  assert.match(v.errors.join(" "), /chars > 500/);
});

test("a thumbnail that adds nothing beyond its title WARNS, it does not reject", () => {
  // Trust failures reject; style failures warn. This pairing is weak, not
  // dishonest, and a weak thumbnail is not a reason to publish nothing.
  const v = validatePackaging(packaging({
    titles: ["500 cables carry the whole internet", "b", "c"],
    thumbnails: [
      { hook: "500 CABLES", kicker: "THE WHOLE INTERNET", accent: "500", angle: "scale" },
      ...packaging().thumbnails.slice(1),
    ],
  }), validSpec());
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.match(v.warnings.join(" "), /adds nothing beyond its title/);
});

test("a thumbnail carrying a fresh noun produces no overlap warning", () => {
  const v = validatePackaging(packaging({
    titles: ["500 cables carry the whole internet", "b", "c"],
    thumbnails: [
      { hook: "NOT SATELLITE", kicker: "SEABED FIBRE", accent: "NOT", angle: "myth-break" },
      ...packaging().thumbnails.slice(1),
    ],
  }), validSpec());
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.ok(!v.warnings.some(w => /adds nothing beyond its title/.test(w)), v.warnings.join("; "));
});

test("a short-but-valid variant set ships — fewer than 3 is a warning, not a failure", () => {
  // Test & Compare prefers 3, but 2 good variants beat discarding a finished
  // spec. Only an empty set is fatal.
  const v = validatePackaging(packaging({ titles: ["Anchors cut more cable than storms", "The map nobody publishes"] }), validSpec());
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.packaging.titles.length, 2);

  assert.match(validatePackaging(packaging({ thumbnails: [] }), validSpec()).errors.join(" "), /no thumbnail survived/);
  assert.match(validatePackaging(packaging({ titles: "nope" }), validSpec()).errors.join(" "), /titles: expected an array/);
});

// ─── The code-injected sources card ─────────────────────────────────────────


test("ONE publisher is enough — the credit survives a single-source scoop", () => {
  // The plural `sources` card needed 2+ outlets and vanished on exactly the
  // stories most in need of attribution. The title credit has no such floor.
  const card = decorateTitleCard(
    { t: "title", lines: [["X", "white"]], caption: "A single-source scoop." },
    { source_name: "Reuters", url: "https://www.reuters.com/x" },
  );
  assert.match(card.caption, /Reported by Reuters\.$/);
});




// ─── The attribution card, absorbed into the title (DrJ, 2026-08-03) ────────

test("the `attribution` card type no longer exists", () => {
  assert.ok(!CARD_TYPES.includes("attribution"));
  assert.ok(!MODEL_EMITTABLE.includes("attribution"));
});

test("MIN_SLIDES drops to 5 — the floor counted the card that is now gone", () => {
  // Keeping 6 would have quietly raised the bar on the MODEL by one card,
  // because the code-injected attribution slide used to count toward the floor.
  assert.equal(MIN_SLIDES, 5);
});

test("decorateTitleCard injects badge, date and the one verbal credit", () => {
  const card = decorateTitleCard(
    { t: "title", lines: [["ANCHORS", "lime"]], caption: "Two anchors cut a continent's bandwidth." },
    { source_name: "Reuters", url: "https://www.reuters.com/world/x", published_at: Date.UTC(2026, 7, 2) },
  );
  assert.equal(card.outlet, "Reuters");
  assert.equal(card.date, "2026-08-02");
  assert.match(card.caption, /^Two anchors cut a continent's bandwidth\. Reported by Reuters\.$/);
  assert.equal(card.t, "title");
  assert.ok(!("score" in card), "no score field — the data does not support one");
});

test("a model-written outlet/date on the title is STRIPPED before injection", () => {
  // Same rule as the old code-injected card: a model asked whose reporting this
  // is answers fluently whether or not it knows.
  const card = decorateTitleCard(
    { t: "title", lines: [["X", "white"]], caption: "A claim.", outlet: "Invented Wire", date: "1999-01-01" },
    { source_name: "Reuters", url: "https://www.reuters.com/x", published_at: Date.UTC(2026, 7, 2) },
  );
  assert.equal(card.outlet, "Reuters");
  assert.equal(card.date, "2026-08-02");
});

test("the credit is not said twice when the caption already names the outlet", () => {
  const card = decorateTitleCard(
    { t: "title", lines: [["X", "white"]], caption: "Reuters found two anchors were to blame." },
    { source_name: "Reuters", url: "https://www.reuters.com/x" },
  );
  assert.equal((card.caption.match(/Reuters/g) || []).length, 1);
});

test("§3b/3 now targets the TITLE caption — a title that credits nobody is rejected", () => {
  const s2 = spec([]);
  const t = s2.slides.find(c => c.t === "title");
  t.caption = "A claim with no credit in it.";
  const v = validateSpec(s2, { allowedSources: ["Reuters"], preCreditedSources: ["Reuters"] });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /title caption does not credit/.test(e)), JSON.stringify(v.errors));
});

test("a kicker in summary register is REJECTED — hard rule", () => {
  for (const bad of ["In conclusion, the system is fragile.", "So there you have it.", "The bottom line is simple."]) {
    const s2 = spec([]);
    s2.slides[s2.slides.length - 1].caption = bad;
    const v = validateSpec(s2, { allowedSources: ["Reuters"] });
    assert.ok(v.errors.some(e => /summary register/.test(e)), `${bad} -> ${JSON.stringify(v.errors)}`);
  }
});

test("a forward-looking kicker passes", () => {
  const s2 = spec([]);
  s2.slides[s2.slides.length - 1].caption = "Nobody has said who will pay to bury the next one.";
  const v = validateSpec(s2, { allowedSources: ["Reuters"] });
  assert.ok(!v.errors.some(e => /summary register/.test(e)), JSON.stringify(v.errors));
});

test("flat captions WARN and never reject", () => {
  const s2 = spec([]);
  for (const c of s2.slides) if (c.t !== "title") c.caption = "A closed self contained statement.";
  const v = validateSpec(s2, { allowedSources: ["Reuters"] });
  assert.ok(v.warnings.some(w => /captions read flat/.test(w)), JSON.stringify(v.warnings));
  assert.ok(!v.errors.some(e => /flat/.test(e)), "bridging must never be a reject");
});

// ─── ARC: the cold open (B1) ────────────────────────────────────────────────
//
// The opening caption used to restate the headline, which spends the ten
// seconds where retention is decided telling the viewer something the thumbnail
// already told them. These tests pin the gate AND its two abstentions — a gate
// that fires when it cannot actually judge is worse than no gate, because it
// costs a whole video on a caption nobody can see the fault in.

const HEADLINE = "Undersea cable damage disrupts internet across West Africa";

const arcSpec = (caption) => {
  const slides = [
    { ...titleCard(), caption },
    plainFiller(0), plainFiller(1), plainFiller(2),
    kickerCard(),
  ];
  return withBeats(slides);
};
const arcOpts = (over = {}) => ({
  allowedSources: SOURCES, sourceText: TEXT, headline: HEADLINE, ...over,
});

test("a title caption that restates the headline is REJECTED, not dropped", () => {
  const v = validateSpec(arcSpec("Undersea cable damage has disrupted internet across West Africa."), arcOpts());
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => e.includes("hook_restates_headline")), v.errors.join(" | "));
  // A DROP would break the beats equality and be reported as a missing opener,
  // which is the wrong cause and unactionable in the retry note.
  assert.equal(v.dropped.filter(d => d.t === "title").length, 0);
});

test("a hook that asks the question, names the stake, or states the anomaly passes", () => {
  for (const caption of [
    "Thirteen countries lost the internet on the same afternoon. One ship did it.",
    "What happens when a continent's bandwidth rests on a single strand?",
    "Nobody planned for the moment one anchor could unplug a nation.",
  ]) {
    const v = validateSpec(arcSpec(caption), arcOpts());
    assert.equal(v.ok, true, `expected pass for "${caption}": ${v.errors.join(" | ")}`);
  }
});

test("the gate ABSTAINS when it has no headline to measure against", () => {
  // Callers without a headline get no arc gate rather than a guess. The schema's
  // own older fixtures rely on this, and so would any future caller.
  const v = validateSpec(arcSpec("Undersea cable damage has disrupted internet across West Africa."), arcOpts({ headline: "" }));
  assert.equal(v.ok, true, v.errors.join(" | "));
});

test("the gate ABSTAINS on a caption with no content words — the measure cannot judge", () => {
  // tooSimilar returns TRUE for an empty content-word set, which is the safe
  // direction for candidate selection and exactly wrong here: a short punchy
  // hook shares nothing with the headline and must not be read as restating it.
  const v = validateSpec(arcSpec("So who pays now?"), arcOpts());
  assert.equal(v.ok, true, v.errors.join(" | "));
});

test("the rejection names the fault in terms the model can act on", () => {
  const v = validateSpec(arcSpec("Undersea cable damage has disrupted internet across West Africa."), arcOpts());
  const err = v.errors.find(e => e.includes("hook_restates_headline"));
  assert.match(err, /question, a stake, or a concrete anomaly/);
  assert.match(err, /headline/);
});

test("the arc gate cannot fire on a spec whose first card is not the title", () => {
  // Ordering failures have their own error. Two errors for one fault would send
  // a confused correction note into the single retry.
  const slides = [plainFiller(0), plainFiller(1), plainFiller(2), kickerCard()];
  const v = validateSpec(withBeats(slides), arcOpts());
  assert.equal(v.ok, false);
  assert.ok(!v.errors.some(e => e.includes("hook_restates_headline")), v.errors.join(" | "));
});

// ─── ARC: connective tissue (B2) ────────────────────────────────────────────
//
// A WARNING, never a gate. The thing being watched for is five captions that
// all open the same way; the thing being avoided is rejecting a video because
// three captions legitimately begin with the subject's name.

test("repeatedOpeningStems finds a stem carried by more than two captions", () => {
  const hits = repeatedOpeningStems([
    "But here's the catch, the cable had no backup.",
    "But here's the catch, repairs take a month.",
    "But here's the catch, there are sixty ships.",
    "Anchors cause most of the damage.",
  ]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].stem, "but here s");   // punctuation is stripped, not kept
  assert.equal(hits[0].count, 3);
});

test("exactly two shared stems is NOT flagged — two is the permitted repeat", () => {
  const hits = repeatedOpeningStems([
    "The cable carries most of the traffic.",
    "The cable was laid in 2012.",
    "Anchors cause most of the damage.",
  ]);
  assert.deepEqual(hits, []);
});

test("captions shorter than the stem length are skipped, not padded", () => {
  // A two-word caption has no three-word opening; inventing one would create a
  // stem that is not there and could push a real stem over the threshold.
  const hits = repeatedOpeningStems(["Who pays?", "Who pays?", "Who pays?", "Who pays?"]);
  assert.deepEqual(hits, []);
});

test("stems are compared case- and punctuation-insensitively", () => {
  const hits = repeatedOpeningStems([
    "So, what happens next is the real question.",
    "So what happens — nobody has said.",
    "So what happens now that the money is gone?",
  ]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].count, 3);
});

test("a monotonous spec WARNS and still validates — B2 is never a gate", () => {
  const slides = [
    { ...titleCard(), caption: "Thirteen countries lost the internet on one afternoon." },
    { ...plainFiller(0), caption: "But here is the catch, the route had no backup." },
    { ...plainFiller(1), caption: "But here is the catch, repairs take a month." },
    { ...plainFiller(2), caption: "But here is the catch, the fleet is ageing." },
    kickerCard(),
  ];
  const v = validateSpec(withBeats(slides), arcOpts());
  assert.equal(v.ok, true, v.errors.join(" | "));
  const warn = v.warnings.find(w => w.includes("open with the same three words"));
  assert.ok(warn, v.warnings.join(" | "));
  assert.match(warn, /but here is/);
  assert.match(warn, /^3 captions/);
  assert.match(warn, /nothing was refused on it/);
});

test("a varied spec produces no repetition warning", () => {
  const slides = [
    { ...titleCard(), caption: "Thirteen countries lost the internet on one afternoon." },
    { ...plainFiller(0), caption: "One anchor, dragged across a shallow shelf, did all of it." },
    { ...plainFiller(1), caption: "Repairs need a specialist ship, and the nearest was busy." },
    { ...plainFiller(2), caption: "Thirty days later the region was still running on what was left." },
    kickerCard(),
  ];
  const v = validateSpec(withBeats(slides), arcOpts());
  assert.equal(v.ok, true, v.errors.join(" | "));
  assert.equal(v.warnings.filter(w => w.includes("open with the same three words")).length, 0);
});

// ─── ARC: the closer (B3) ───────────────────────────────────────────────────
//
// KICKER_BANNED_PHRASES catches a closer that ANNOUNCES it is summarising.
// These cover the one that simply does it — restating the headline, or circling
// back to the video's own cold open.

const closerSpec = (kickerCaption, openCaption = "Thirteen countries lost the internet on one afternoon.") =>
  withBeats([
    { ...titleCard(), caption: openCaption },
    plainFiller(0), plainFiller(1), plainFiller(2),
    { ...kickerCard(), caption: kickerCaption },
  ]);

test("a kicker that restates the HEADLINE is rejected as closer_restates", () => {
  const v = validateSpec(closerSpec("Undersea cable damage has disrupted internet across West Africa."), arcOpts());
  assert.equal(v.ok, false);
  const err = v.errors.find(e => e.includes("closer_restates"));
  assert.ok(err, v.errors.join(" | "));
  assert.match(err, /the article headline/);
});

test("a kicker that circles back to its OWN OPENING CAPTION is rejected too", () => {
  // The video ending where it began is the same editorial failure as restating
  // the headline, so it shares the error code — but the message must name which.
  const v = validateSpec(
    closerSpec("Thirteen countries lost their internet in a single afternoon."),
    arcOpts(),
  );
  assert.equal(v.ok, false);
  const err = v.errors.find(e => e.includes("closer_restates"));
  assert.ok(err, v.errors.join(" | "));
  assert.match(err, /its own opening caption/);
});

test("a forward-looking closer passes", () => {
  for (const caption of [
    "The next repair ship is three weeks out, and nobody has said who pays for the wait.",
    "Whether anyone buries the replacement deeper is a decision still unmade.",
  ]) {
    const v = validateSpec(closerSpec(caption), arcOpts());
    assert.equal(v.ok, true, `expected pass for "${caption}": ${v.errors.join(" | ")}`);
  }
});

test("the register check and the restatement check never both fire", () => {
  // Two errors for one fault would send a confused correction note into the
  // single regeneration retry.
  const v = validateSpec(
    closerSpec("In conclusion, undersea cable damage has disrupted internet across West Africa."),
    arcOpts(),
  );
  assert.equal(v.ok, false);
  assert.equal(v.errors.filter(e => e.includes("summary register")).length, 1);
  assert.equal(v.errors.filter(e => e.includes("closer_restates")).length, 0);
});

test("the closer gate abstains with no headline, but still checks the opening caption", () => {
  const restatesOpen = closerSpec("Thirteen countries lost their internet in a single afternoon.");
  const v = validateSpec(restatesOpen, arcOpts({ headline: "" }));
  assert.equal(v.ok, false, "the opening-caption arm does not need a headline");
  assert.match(v.errors.find(e => e.includes("closer_restates")), /its own opening caption/);
});

test("a short closer with no content words is not read as a restatement", () => {
  // Was "So who pays now?" until 2026-08-14 — a HANGING closer question, which
  // the closer ban now correctly rejects. The subject here is the restatement
  // check, so the fixture keeps its content-word-free shape without the device.
  const v = validateSpec(closerSpec("So now they wait."), arcOpts());
  assert.equal(v.ok, true, v.errors.join(" | "));
});

// ─── Series bounds — the silent-truncation defect (2026-08-12) ──────────────
//
// The schema said "2 or more" and stopped; the renderer did slice(0,5) and
// slice(0,6). Eight bars became five with no error, no dropped[] entry and
// nothing in the log — and the caption, written against the whole beat, could
// name a figure that was never drawn. Found while drafting the 9:16 layouts,
// but it has been true of the shipped 16:9 renderer the whole time.

test("a bars card with more entries than the renderer can draw is DROPPED", () => {
  const over = barsCard({ bars: [["a", 9], ["b", 8], ["c", 7], ["d", 6], ["e", 5], ["f", 4]] });
  assert.equal(over.bars.length, MAX_BARS + 1);
  const slides = [titleCard(), over, plainFiller(0), plainFiller(1), plainFiller(2), kickerCard()];
  const v = validateSpec(withBeats(slides), { allowedSources: SOURCES, sourceText: TEXT });
  const drop = v.dropped.find(d => d.t === "bars");
  assert.ok(drop, `expected a bars drop; got ${JSON.stringify(v.dropped)}`);
  assert.equal(drop.kind, "structural");
  assert.match(drop.reason, new RegExp(`exceeds the ${MAX_BARS}`));
});

test("a diagram card with too many nodes is DROPPED", () => {
  const nodes = Array.from({ length: MAX_NODES + 1 }, (_, i) => [`N${i}`, `sub ${i}`]);
  const over = { t: "diagram", eyebrow: "HOW", nodes, caption: "A caption about the chain." };
  const slides = [titleCard(), over, plainFiller(0), plainFiller(1), plainFiller(2), kickerCard()];
  const v = validateSpec(withBeats(slides), { allowedSources: SOURCES, sourceText: TEXT });
  const drop = v.dropped.find(d => d.t === "diagram");
  assert.ok(drop, `expected a diagram drop; got ${JSON.stringify(v.dropped)}`);
  assert.equal(drop.kind, "structural");
  assert.match(drop.reason, new RegExp(`exceeds the ${MAX_NODES}`));
});

test("exactly at the cap is VALID — the bound is inclusive", () => {
  // An off-by-one here would quietly cost every five-bar comparison card.
  const atCap = barsCard({ bars: [["a", 9], ["b", 8], ["c", 7], ["d", 6], ["e", 5]] });
  const nodes = Array.from({ length: MAX_NODES }, (_, i) => [`N${i}`, `sub ${i}`]);
  const slides = [
    titleCard(), atCap,
    { t: "diagram", eyebrow: "HOW", nodes, caption: "A caption about the chain." },
    plainFiller(0), plainFiller(1), kickerCard(),
  ];
  const v = validateSpec(withBeats(slides), { allowedSources: SOURCES, sourceText: TEXT });
  assert.equal(v.dropped.length, 0, JSON.stringify(v.dropped));
  assert.equal(v.ok, true, v.errors.join(" | "));
});

test("the drop is per-card — the rest of the spec survives", () => {
  // Rule 1's split. An over-long bars card must not take a good spec with it.
  const over = barsCard({ bars: [["a", 9], ["b", 8], ["c", 7], ["d", 6], ["e", 5], ["f", 4]] });
  const slides = [titleCard(), over, plainFiller(0), plainFiller(1), plainFiller(2), plainFiller(3), kickerCard()];
  const v = validateSpec(withBeats(slides), { allowedSources: SOURCES, sourceText: TEXT });
  assert.equal(v.ok, true, v.errors.join(" | "));
  assert.ok(!v.spec.slides.some(c => c.t === "bars" && c.bars.length > MAX_BARS));
});

test("the renderer NEVER truncates silently", async () => {
  // The validator drops over-long cards, so this path should be unreachable in
  // production — but the renderer is called directly by harnesses and fixtures,
  // and the failure being fixed was precisely that it said nothing.
  const { statesForCard } = await import("./videoSlideRenderer.js");
  const { logger } = await import("./logger.js");
  const saved = logger.warn;
  const warns = [];
  logger.warn = (m) => warns.push(String(m));
  try {
    statesForCard(
      { t: "bars", eyebrow: "X", bars: [["a", 9], ["b", 8], ["c", 7], ["d", 6], ["e", 5], ["f", 4]], source: "Reuters", caption: "c" },
      { outlet: "Reuters", slideIndex: 2, slideCount: 7 },
    );
  } finally { logger.warn = saved; }
  assert.equal(warns.length, 1, `expected one warning, got ${JSON.stringify(warns)}`);
  assert.match(warns[0], /DISCARDING 1/);
  assert.match(warns[0], /bypassed validation/);
});

// ─── The closer question ban ────────────────────────────────────────────────
//
// DrJ's ruling, 2026-08-14: "A question is only clickbait when the answer is
// withheld." Permitted on the opener and mid-beats, where the next beat answers
// it; rejected on the closer, where nothing follows.

const { CLOSER_QUESTION_ERROR, TRAILING_QUESTION, captionBridges } = await import("./videoSpecSchema.js");
const { readFileSync } = await import("node:fs");

function specWithKicker(kicker, extra = {}) {
  return {
    slides: [
      { t: "title", eyebrow: "B", lines: [["A", "white"], ["B", "lime"]], sub: "s",
        caption: "So who actually pays for this? The households buying the imported goods do." },
      { t: "diagram", eyebrow: "H", nodes: [["A", "x"], ["B", "y"]], marker: { on: 1, label: "M" },
        caption: "The route runs through three countries before anything reaches a shelf here." },
      { t: "turn", eyebrow: "BUT", lines: [["X", "white"], ["Y", "lime"]],
        caption: "But the tariff is only part of what makes those goods expensive at the till." },
      kicker,
    ],
    ...extra,
  };
}
const KICKER_OK = { t: "kicker", top: "WHAT NOW", bottom: "THE BILL LANDS",
  caption: "The cost lands with the importer first, and it reaches the shelf within about a month." };

test("a closer ending on a question is REJECTED", () => {
  const r = validateSpec(specWithKicker({ ...KICKER_OK,
    caption: "So who actually gains from all of this, and how long before anyone finds out?" }),
    { headline: "Tariffs cut for most of Africa" });
  const err = (r.errors || []).join(" | ");
  assert.match(err, new RegExp(CLOSER_QUESTION_ERROR), `expected a closer_question error, got: ${err}`);
  assert.match(err, /the answer can never arrive/);
});

test("a question ASKED AND ANSWERED inside the closer is allowed", () => {
  // The whole subtlety of trailing-only matching. This is the legitimate shape:
  // the answer arrives immediately, in the same breath.
  const r = validateSpec(specWithKicker({ ...KICKER_OK,
    caption: "So who pays? Households do, through the price of everything imported from there." }),
    { headline: "Tariffs cut for most of Africa" });
  assert.ok(!(r.errors || []).join(" ").includes(CLOSER_QUESTION_ERROR),
    "a self-answered question is the shape DrJ asked to keep");
});

test("questions on the OPENER and mid-beats are untouched", () => {
  // The opener in the fixture ends its question then answers it; the point is
  // that no rule anywhere fires on a non-final card carrying "?".
  const r = validateSpec(specWithKicker(KICKER_OK), { headline: "Tariffs cut for most of Africa" });
  assert.ok(!(r.errors || []).join(" ").includes(CLOSER_QUESTION_ERROR));
});

test("the ON-SCREEN last line counts too, not just the narration", () => {
  const r = validateSpec(specWithKicker({ ...KICKER_OK, bottom: "WHO PAYS?" }),
    { headline: "Tariffs cut for most of Africa" });
  assert.match((r.errors || []).join(" | "), new RegExp(CLOSER_QUESTION_ERROR),
    "the last words left on screen end the video just as the narration does");
});

test("TRAILING_QUESTION matches only at the END, through closing punctuation", () => {
  for (const yes of ["who pays?", "who pays? ", 'he asked "who pays?"', "who pays?)", "who pays?”"]) {
    assert.ok(TRAILING_QUESTION.test(yes), `should match: ${yes}`);
  }
  for (const no of ["who pays? Households do.", "the 40% question is settled", "who pays? They do"]) {
    assert.ok(!TRAILING_QUESTION.test(no), `should NOT match: ${no}`);
  }
});

test("BRIDGE_PUNCT still counts a trailing question as a bridge", () => {
  // DrJ: "keep BRIDGE_PUNCT as it is — it was right and rule 10 was over-broad."
  assert.equal(captionBridges("So who actually pays for this?"), true);
});

test("nothing in the schema still RECOMMENDS ending on a question", () => {
  // The kicker's own error message used to say the closer may end on "an open
  // question" — it was teaching the failure this now rejects.
  const src = readFileSync(new URL("./videoSpecSchema.js", import.meta.url), "utf8");
  const recommending = src.split("\n").filter(l =>
    /or an open question/.test(l) && !/used to (say|offer)/.test(l));
  assert.deepEqual(recommending, [], "a stale recommendation would argue with the new gate");
});

// ─── B3: subject visuals ────────────────────────────────────────────────────
//
// The subject decides the visual, not the beat. A story about a tariff SYSTEM
// once ran with a publisher photograph of two people, because the article
// happened to carry one — the failure this whole feature exists to prevent.

const { SUBJECT_VISUAL_TYPES } = await import("./videoSpecSchema.js");
const { knownCountry, MOUNT_NAMES, buildLocatorMap } = await import("./videoSubjectVisual.js");

// MIN_SLIDES is 5, at least one card must be an OWN_LAYER type (diagram or
// turn), and a spec needs its `beats` enumeration — so a three-card wrapper is
// rejected at the SPEC level and `spec` comes back null. `withBeats` is the
// helper this file already uses for exactly that; reused rather than re-derived.
const wrap = (card) => withBeats([
  { t: "title", lines: [["A", "white"]], caption: "x".repeat(80) },
  card,
  { t: "diagram", eyebrow: "H", nodes: [["A", "a"], ["B", "b"]], caption: "d".repeat(80) },
  { t: "turn", eyebrow: "BUT", lines: [["X", "white"]], caption: "t".repeat(80) },
  { t: "kicker", top: "A", bottom: "B", caption: "y".repeat(80) },
]);
const droppedFor = (card) => validateSpec(wrap(card), { headline: "H" })
  .dropped.filter(d => d.t === card.t);

test("the schema knows photo and map UNCONDITIONALLY — that is what makes the flag safe", () => {
  // The prompt flag decides whether the model is ASKED. If the contract were
  // flagged too, a card emitted with the flag off would be dropped instead of
  // drawn, and the two-stage deploy would need a temporary tolerance.
  assert.deepEqual([...SUBJECT_VISUAL_TYPES], ["photo", "map"]);
  for (const t of SUBJECT_VISUAL_TYPES) assert.ok(CARD_TYPES.includes(t), `${t} must be in the closed set`);
});

test("an unknown country code invalidates the map card", () => {
  // Checked against the real atlas rather than a pattern: a plausible-looking
  // code the atlas lacks would draw an EMPTY map — a card that renders, says
  // nothing, and tells nobody a country is missing.
  const d = droppedFor({ t: "map", eyebrow: "W", codes: ["DZA", "ZZZ"], caption: "z".repeat(80) });
  assert.equal(d.length, 1);
  assert.match(d[0].reason, /unknown country code\(s\) "ZZZ"/);
});

test("an exception outside the drawn set is refused", () => {
  // "All of these except that one" means nothing if that one is not among them.
  const d = droppedFor({ t: "map", eyebrow: "W", codes: ["DZA"], exception: "EGY", caption: "z".repeat(80) });
  assert.equal(d.length, 1);
  assert.match(d[0].reason, /not among "codes"/);
});

test("a valid map and a valid photo card survive", () => {
  assert.equal(droppedFor({ t: "map", eyebrow: "W", codes: ["DZA", "EGY", "SWZ"], exception: "SWZ", caption: "z".repeat(80) }).length, 0);
  assert.equal(droppedFor({ t: "photo", eyebrow: "W", subject: "Aung San Suu Kyi",
    lines: [["A", "white"], ["B", "lime"]], caption: "z".repeat(80) }).length, 0);
});

test("a photo card cannot smuggle in its own image", () => {
  // The photograph is the article's own and the treatment is a design decision.
  // pruneCard drops anything outside the contract, so a model-supplied URL never
  // reaches a renderer.
  const v = validateSpec(wrap({ t: "photo", lines: [["A", "white"]], subject: "Aung San Suu Kyi",
    caption: "z".repeat(80), image_url: "https://evil.test/x.jpg", mount: "polaroid" }), { headline: "H" });
  const photo = v.spec.slides.find(c => c.t === "photo");
  assert.ok(photo, "the card itself is fine");
  assert.equal(photo.image_url, undefined, "a model-supplied image must be stripped");
  assert.equal(photo.mount, undefined, "the mount is art direction, not content");
});

// A HEDGED SUBJECT MEANS THE MODEL DID NOT CHOOSE (DrJ, 2026-08-16). The field
// declares ONE thing to photograph; "Donald Trump Jr. or Trump Tower" is six
// words, cleared the length check, and hands the renderer an instruction it
// cannot act on — there is no rule by which it could break the tie.
// It DROPS the card rather than failing the spec, which is the proportionate
// call: an ambiguous subject costs one photo card, and the other five are fine.
// Contrast the motive gate, which is an error precisely because dropping the
// card would ship the rest of a spec that had already editorialised.
test("a hedged photo subject is dropped", () => {
  for (const s of [
    "Donald Trump Jr. or Trump Tower",
    "the Port of Mombasa or the container yard",
    "Aung San Suu Kyi / the courthouse",
    "either the chancellor or the budget document",
  ]) {
    const d = droppedFor({ t: "photo", lines: [["A", "white"]], subject: s, caption: "z".repeat(80) });
    assert.ok(d.some(x => /hedges between alternatives/.test(x.reason)), `hedge not caught: ${s}`);
  }
});

test("a subject with 'and' inside a real name is NOT a hedge", () => {
  // " and " is ordinary inside proper nouns, so it is deliberately not matched:
  // rejecting it would kill correct subjects far more often than it caught hedges.
  for (const s of [
    "the Department of Health and Human Services",
    "Marks and Spencer",
    "Aung San Suu Kyi",
    "the Port of Mombasa",
  ]) {
    const d = droppedFor({ t: "photo", lines: [["A", "white"]], subject: s, caption: "z".repeat(80) });
    assert.ok(!d.some(x => /hedges between alternatives/.test(x.reason)), `false positive on: ${s}`);
  }
});

test("THE MAP ANNOTATES THE EXCEPTION, not just the set", () => {
  // DrJ, 2026-08-15: "Eswatini was 2px wide and it was the whole story."
  const svg = buildLocatorMap({ codes: ["DZA", "EGY", "ZAF", "SWZ"], exception: "SWZ" });
  assert.ok(svg, "a map should build");
  assert.match(svg, /ESWATINI/, "the excepted country must be NAMED, not merely coloured differently");
  assert.match(svg, /<circle/, "and pointed at");
  assert.match(svg, /<line /, "with a leader, since the country itself is a couple of pixels");
  const plain = buildLocatorMap({ codes: ["DZA", "EGY"] });
  assert.ok(!/<circle/.test(plain), "no exception, no callout");
});

test("the 50m atlas carries the small island states 110m dropped", () => {
  // The reason for the heavier file: at 110m these five are simply absent, so a
  // map of Africa silently omitted five members of the set it claimed to show.
  for (const c of ["CPV", "COM", "MUS", "STP", "SYC"]) {
    assert.ok(knownCountry(c), `${c} must resolve at 50m`);
  }
  assert.ok(!knownCountry("ZZZ"));
});

test("taped is NOT in the mount library", () => {
  // It has no border, so the print's dark edges meet the ground with nothing
  // between them — the one mount of the four that still risked reading as a
  // hole. It needs a bone border before it belongs.
  assert.deepEqual([...MOUNT_NAMES].sort(), ["cutting", "pinned", "polaroid"]);
});

// ─── Motive, and the photo card's declared subject ──────────────────────────
//
// DrJ, 2026-08-15, reading a live dry run: the source said a protective detail
// HAS BLOCKED service of a lawsuit. The caption said the family could "use
// taxpayer-funded security to keep a lawsuit at bay" — a purpose, ascribed to
// three named living people, that the article never establishes.

const { unattributedMotive, MOTIVE_ERROR } = await import("./videoSpecSchema.js");

// A source that reports an OBSTACLE and nobody's purpose. The gate now requires
// a source to accuse against — "without a source there is no case" — so these
// tests supply the shape the gate exists for rather than passing nothing.
const NO_MOTIVE_SOURCE =
  "Craig and Lindsay Foreman face a ten-year sentence. " +
  "Their protective detail has blocked three attempts to serve papers in the civil case.";

test("THE LIVE FAILURE: an unattributed motive is refused", () => {
  assert.ok(unattributedMotive(
    "A court must decide whether the Foreman family can use taxpayer-funded security to keep a lawsuit at bay.",
    NO_MOTIVE_SOURCE),
    "this is the sentence the rule exists for");
});

test("attribution is the escape, and stating the effect needs none", () => {
  // The rule costs a rewrite, never the idea.
  assert.equal(unattributedMotive("The plaintiffs say the detail is being used to keep the suit at bay.", NO_MOTIVE_SOURCE), null);
  assert.equal(unattributedMotive("The protection has blocked three attempts to serve papers.", NO_MOTIVE_SOURCE), null);
  assert.equal(unattributedMotive("Beijing says the policy is designed to increase African exports.", NO_MOTIVE_SOURCE), null);
});

test("ordinary reporting is untouched", () => {
  for (const c of [
    "China drops tariffs on almost every country in Africa from Friday.",
    "Fifty-three countries, duty free, until twenty twenty-eight.",
    "She has been out of sight four years. Now state media says she is under house arrest.",
    "Seventy percent of recorded faults come down to a ship dragging its anchor.",
  ]) assert.equal(unattributedMotive(c, NO_MOTIVE_SOURCE), null, `false positive on: ${c}`);
});

// ─── LEAK 1: the purpose classes (DrJ, 2026-08-16) ──────────────────────────
//
// "Trump has already scaled back his claims TO PROTECT his own business empire
// from BBC subpoenas" passed a clean spec. The source says he narrowed them
// AFTER the BBC used them to subpoena documents — a sequence, turned into his
// purpose. The gate never fired: every bare-infinitive verb it knew was an
// EVASION verb, because the list was written from a live failure about evading
// service. Naming the register rather than the one word that appeared is the
// same lesson the intensifier list taught in the same week.

test("LEAK 1: protective and coercive purposes are motives too", () => {
  for (const c of [
    "Trump scaled back the lawsuit to protect his business empire.",
    "The company narrowed the disclosure to shield its executives.",
    "The ministry redacted the report to safeguard its position.",
    "The agency delayed the review to preserve its funding.",
    "The board rewrote the terms to defend the chairman.",
    "The trust restructured the holding to insulate the family.",
    "The bank moved the assets to secure its own position.",
    "The department leaked the memo to force a resignation.",
    "The committee subpoenaed the records to pressure the witness.",
    "The regulator published the fine to punish the operator.",
    "The campaign released the tape to discredit the mayor.",
    "The publisher settled the case to silence the reporter.",
  ]) assert.ok(unattributedMotive(c, NO_MOTIVE_SOURCE), `missed a purpose clause: ${c}`);
});

test("LEAK 1: the evasion class it already had still fires", () => {
  for (const v of ["avoid", "evade", "dodge", "escape", "sidestep", "stall", "frustrate"]) {
    assert.ok(unattributedMotive(`The firm restructured the deal to ${v} the inquiry.`, NO_MOTIVE_SOURCE),
      `evasion verb regressed: ${v}`);
  }
});

test("LEAK 1: attribution is still the escape, on the new classes too", () => {
  // Widening what the gate catches must not narrow the way out of it. The rule
  // costs a rewrite, never the idea — that has to hold for all three classes.
  assert.equal(unattributedMotive(
    "The plaintiffs say he scaled back the lawsuit to protect his business empire.", NO_MOTIVE_SOURCE), null);
  assert.equal(unattributedMotive(
    "According to the filing, the memo was leaked to force a resignation.", NO_MOTIVE_SOURCE), null);
});

// ─── The verdict view, for the false-positive corpus ────────────────────────
//
// The corpus leak 3 must clear is harvested from live logs, and its value
// depends entirely on the labels being the REAL gate's. So unattributedMotive
// delegates to motiveVerdict rather than the diagnostic reimplementing it, and
// this test pins that: if the two ever disagree, the corpus is mislabelled and
// looks empirical while being wrong.
const { motiveVerdict } = await import("./videoSpecSchema.js");

test("motiveVerdict and unattributedMotive can never disagree", () => {
  const src = "The BBC has asked the court for alternative means of service. " +
    "Trump narrowed his claims after the BBC used them to subpoena documents.";
  for (const sourceText of ["", NO_MOTIVE_SOURCE, src]) {
    for (const c of [
      "",
      "China drops tariffs on almost every country in Africa from Friday.",
      "Trump narrowed the scope to avoid BBC subpoenas.",
      "Trump narrowed his claims to avoid BBC subpoenas.",
      "The plaintiffs say the detail is being used to keep the suit at bay.",
      "Trump has already scaled back his claims to protect his own business empire.",
      "The company narrowed the disclosure to shield its executives.",
    ]) {
      const v = motiveVerdict(c, sourceText);
      const expected = v.verdict === "fired" ? v.motive : null;
      assert.equal(unattributedMotive(c, sourceText), expected,
        `verdict "${v.verdict}" disagrees with the gate on: ${c}`);
    }
  }
});

test("the verdict names WHICH branch exempted, and LEAK 2 names the word", () => {
  // This is what makes the harvest checkable: exempt_attribution is LEAK 2 and
  // exempt_reported is LEAK 3, countable separately in a day of live specs.
  assert.equal(motiveVerdict("China drops tariffs on Friday.", NO_MOTIVE_SOURCE).verdict, "no_motive");
  assert.equal(motiveVerdict("Trump narrowed the scope to avoid subpoenas.", NO_MOTIVE_SOURCE).verdict, "fired");
  assert.equal(motiveVerdict("Trump narrowed the scope to avoid subpoenas.", "").verdict, "exempt_no_source");

  const leak2 = motiveVerdict("Trump narrowed his claims to avoid BBC subpoenas.", NO_MOTIVE_SOURCE);
  assert.equal(leak2.verdict, "exempt_attribution");
  assert.equal(leak2.by, "claims", "the corpus must name the word that switched the gate off");

  const leak3 = motiveVerdict(
    "Trump scaled back the lawsuit to protect his business empire.",
    "He scaled back the lawsuit to protect the business, his spokesman said.");
  assert.equal(leak3.verdict, "exempt_reported");
});

// KNOWN OPEN — LEAK 2, held by DrJ's ruling to close the leaks one at a time and
// watch what each does. Recorded as a passing test rather than a comment so that
// closing LEAK 2 FAILS HERE and forces this file to be updated, instead of
// leaving a stale note nobody reads.
//
// ATTRIBUTION_MARKERS is caption-scoped and matches `claims?` and `filing` as
// bare words. Both are ordinary legal NOUNS, so on litigation stories — the
// exact stories this gate exists for — a reporting word in one clause excuses a
// motive in another. The ruling when we get there: clause-scoped attribution,
// and "claims that" counts where a bare "claims" does not.
test("LEAK 2 is still open: a legal noun switches the gate off", () => {
  const caught  = "Trump narrowed the scope to avoid BBC subpoenas.";
  const escapes = "Trump narrowed his claims to avoid BBC subpoenas.";
  assert.ok(unattributedMotive(caught, NO_MOTIVE_SOURCE), "the control must still fire");
  assert.equal(unattributedMotive(escapes, NO_MOTIVE_SOURCE), null,
    "LEAK 2 CLOSED? Good — now delete this test and add the real one: a bare " +
    "'claims'/'filing' noun must no longer exempt, while 'claims that' still does.");
});

test("LEAK 1: a purpose the SOURCE states is still exempt", () => {
  // The cushion that makes the two new classes safe to add tonight: a statute's
  // or an agency's stated purpose is reported, not ascribed. This is the
  // exemption LEAK 3 will have to preserve.
  const src = "The law was written to protect tenants from eviction, the department said.";
  assert.equal(unattributedMotive("The law was written to protect tenants.", src), null);
});

test("it does NOT require a name in the caption — the live case had none", () => {
  // The first draft required a proper noun and missed the sentence that
  // prompted the rule: "the Foreman family" is one capitalised surname plus a
  // lowercase noun, and the individuals were named two cards earlier. A subject
  // introduced earlier is just as identifiable to a viewer.
  assert.ok(unattributedMotive("The family is trying to avoid being served.", NO_MOTIVE_SOURCE));
  assert.ok(unattributedMotive("The policy is designed to increase exports.", NO_MOTIVE_SOURCE));
});

test("the motive gate is an ERROR, not a silent card drop", () => {
  // Dropping the card would delete a beat and publish the rest. An error routes
  // into the regeneration retry with the phrase named, so the model can
  // attribute the claim or state the effect instead.
  const v = validateSpec(wrap({ t: "turn", eyebrow: "BUT", lines: [["X", "white"]],
    caption: "The family can use their security detail to keep the lawsuit at bay for years." }),
    { headline: "H", sourceText: NO_MOTIVE_SOURCE });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => e.includes(MOTIVE_ERROR)), v.errors.join(" | "));
  assert.ok(v.errors.some(e => /Say WHOSE claim it is/.test(e)), "the fix must be in the message");
});

test("a photo card MUST declare what the photograph should show", () => {
  // Without it the renderer takes image_url on trust and nothing anywhere can
  // notice a mismatch — the tariffs failure with a new name.
  const d = droppedFor({ t: "photo", eyebrow: "W", lines: [["A", "white"]], caption: "z".repeat(80) });
  assert.equal(d.length, 1);
  assert.match(d[0].reason, /missing required field "subject"/);
});

test("the subject is a noun phrase, not the beat restated", () => {
  const d = droppedFor({ t: "photo", eyebrow: "W", lines: [["A", "white"]], caption: "z".repeat(80),
    subject: "a photograph of the family standing outside the courthouse after the hearing ended" });
  assert.equal(d.length, 1);
  assert.match(d[0].reason, /noun phrase, not a sentence/);
});

// ─── Display type is checked too ────────────────────────────────────────────
//
// DrJ's second reading, 2026-08-15: the caption gate passed, and the card still
// said "THE SECRET SERVICE SHIELD" over a closer promising "indefinitely".

const { displayStrings, unsupportedIntensifiers, INTENSIFIER_ERROR } = await import("./videoSpecSchema.js");

test("every string the viewer reads or hears is collected, not just the caption", () => {
  assert.deepEqual(displayStrings({ t: "kicker", top: "HELD", bottom: "INDEFINITELY", sub: "s", caption: "c" }),
    ["c", "s", "HELD", "INDEFINITELY"]);
  // [text, colour] pairs and stat's plain strings are both display type.
  assert.deepEqual(displayStrings({ t: "title", lines: [["A", "white"], ["B", "lime"]], caption: "c" }), ["c", "A", "B"]);
  assert.deepEqual(displayStrings({ t: "stat", lines: ["one", "two"], caption: "c" }), ["c", "one", "two"]);
  assert.ok(displayStrings({ t: "diagram", nodes: [["SHIP", "drags"]], marker: { label: "BREAK" }, caption: "c" })
    .includes("BREAK"), "a marker label is on screen too");
});

test("a motive in a DISPLAY LINE is caught, not only in the caption", () => {
  const v = validateSpec(wrap({ t: "turn", eyebrow: "BUT", lines: [["USING SECURITY TO DODGE IT", "white"]],
    caption: "The case has stalled." }), { headline: "H", sourceText: NO_MOTIVE_SOURCE });
  assert.ok(v.errors.some(e => e.includes(MOTIVE_ERROR)), v.errors.join(" | "));
});

test("AN INTENSIFIER THE SOURCE NEVER USED IS REFUSED", () => {
  const src = "Their protective detail has blocked three attempts to serve papers.";
  assert.deepEqual(unsupportedIntensifiers(["HELD INDEFINITELY"], src), ["indefinit"]);
  // The source's own word licenses it — this checks provenance, not morphology.
  assert.deepEqual(unsupportedIntensifiers(["HELD INDEFINITELY"], src + " Lawyers call it indefinite detention."), []);
});

test("accurate absolutes are NOT swept up", () => {
  // "all" and "every" are excluded on purpose: "all but one African nation" is
  // the accurate phrasing of a real policy, and a gate that fires on accurate
  // reporting teaches people to route around it.
  const src = "China will scrap tariffs for all African countries except Eswatini.";
  assert.deepEqual(unsupportedIntensifiers(["ZERO TARIFFS", "FOR EVERY COUNTRY", "all but one"], src), []);
});

test("the intensifier check needs a source, and stays quiet without one", () => {
  // validateSpec is called without sourceText in several places; a gate that
  // fires on absent evidence would reject specs for the wrong reason.
  assert.deepEqual(unsupportedIntensifiers(["HELD INDEFINITELY"], ""), []);
});

test("A METAPHOR IS NOT CAUGHT, and that is stated rather than implied", () => {
  // "THE SECRET SERVICE SHIELD" carries no motive verb and no intensifier, and
  // it still reframes a protective detail as an instrument of obstruction.
  // Neither gate sees it. The prompt carries that one explicitly, because a
  // check that half-works is worse than a rule that is honest about its edge.
  const line = "THE SECRET SERVICE SHIELD";
  assert.equal(unattributedMotive(line, NO_MOTIVE_SOURCE), null);
  assert.deepEqual(unsupportedIntensifiers([line], "Their protective detail has blocked service."), []);
  const src = readFileSync(new URL("./videoSpecWriter.js", import.meta.url), "utf8");
  assert.match(src, /THE SECRET SERVICE SHIELD/, "the prompt must name the case the checks cannot see");
});

// ─── Reported intent is not asserted intent ─────────────────────────────────
//
// DrJ, 2026-08-15: two of three flags on a live run were FALSE POSITIVES and
// they killed the article. "The broadcaster wants to use certified mail" is the
// BBC's own filed request; "to prove what the president intended" is its own
// stated purpose. Reporting a party's OWN stated position is not asserting a
// hidden motive — and the first gate fired on the verb regardless.

const { motiveIsReported } = await import("./videoSpecSchema.js");
const { buildSpecPrompt } = await import("./videoSpecWriter.js");

const BBC_FILING =
  "The BBC has asked the court for alternative means of service, such as certified mail. " +
  "In its filing the broadcaster said it needs the deposition to prove what the president actually intended that day.";
const SECRET_SERVICE =
  "Craig and Lindsay Foreman face a ten-year sentence. " +
  "Their protective detail has blocked three attempts to serve papers in the civil case.";

test("THE FALSE POSITIVES: a party's own filed purpose is reporting", () => {
  for (const c of [
    "The broadcaster wants to use certified mail.",
    "To prove what the president actually intended that day, the broadcaster needs the deposition.",
    "The broadcaster is seeking to serve papers by certified mail.",
  ]) assert.equal(unattributedMotive(c, BBC_FILING), null, `must be allowed: ${c}`);
});

test("THE TRUE POSITIVE still fires: intent nobody put on the record", () => {
  for (const c of [
    "The family can use their taxpayer-funded security to keep a lawsuit at bay.",
    "The detail is designed to frustrate service of the papers.",
    "The Foremans are trying to avoid the civil case entirely.",
  ]) assert.ok(unattributedMotive(c, SECRET_SERVICE), `must be refused: ${c}`);
});

test("the source must be about the SAME thing, not merely contain a purpose", () => {
  // A long article almost always states some purpose somewhere. Sharing the
  // subject matter is what separates "the reporting says this" from "the
  // article happens to contain the word".
  const tariffs = "China will scrap tariffs for all African countries from Friday, except Eswatini. " +
    "Analysts say tariffs are rarely the main obstacle for exporters.";
  assert.ok(unattributedMotive("Beijing is using the tariff cut to buy influence across the continent.", tariffs),
    "an unrelated purpose elsewhere in the article must not license a new one");
});

test("a two-sentence WINDOW, because filings are reported across a pair", () => {
  // The single-sentence version scored 1 on the real case and killed it:
  // "broadcaster" and "certified" were one sentence apart.
  assert.ok(motiveIsReported("The broadcaster wants to use certified mail.", BBC_FILING));
  const split = "The BBC has asked the court for alternative means of service, such as certified mail.";
  assert.ok(!motiveIsReported("The broadcaster wants to use unrelated methods.", split),
    "the window widens the evidence, it does not remove the need for any");
});

test("WITHOUT A SOURCE THERE IS NO CASE", () => {
  // The gate accuses the script of inventing an intent. With nothing to compare
  // against, that accusation cannot be made fairly — and firing on absent
  // evidence is how the first version killed an article whose motive was in the
  // filing all along.
  assert.equal(unattributedMotive("The family is trying to avoid being served.", ""), null);
  assert.equal(unattributedMotive("The family is trying to avoid being served.", undefined), null);
});

test("in-caption attribution still short-circuits everything", () => {
  assert.equal(unattributedMotive("The plaintiffs say the detail is being used to keep the suit at bay.", SECRET_SERVICE), null);
});

// ─── Rule 3's section paragraphs are conditional ────────────────────────────

test("the prompt describes labelled sections ONLY when there are several outlets", () => {
  // Nothing in this codebase builds "PRIMARY SOURCE" / "ADDITIONAL COVERAGE"
  // blocks: resolveVideoSourceText fetches one article and the sole caller
  // passes one publisher. ~1,020 characters of instruction about ATTRIBUTION
  // described a structure the model could not see.
  const article = { id: "a", title: "T", description: "d", content: "c".repeat(400), source_name: "R", category: "world" };
  const one = buildSpecPrompt({ article, allowedSources: ["Reuters"] });
  const two = buildSpecPrompt({ article, allowedSources: ["Reuters", "BBC News"] });
  assert.ok(!/ADDITIONAL COVERAGE/.test(one), "one outlet, no sections to describe");
  assert.ok(/ADDITIONAL COVERAGE/.test(two), "several outlets, the rules must appear");
  assert.ok(one.length < two.length - 900, `the single-source prompt should shed ~1kB, shed ${two.length - one.length}`);
});
