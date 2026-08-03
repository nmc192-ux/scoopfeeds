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
