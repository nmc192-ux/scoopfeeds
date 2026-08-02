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
  buildSourcesCard,
  CARD_TYPES,
  MODEL_EMITTABLE,
} from "./videoSpecSchema.js";

const SOURCES = ["Reuters", "BBC News", "Associated Press"];
const TEXT = "Reuters reported that 70 percent of cable faults involve anchors. " +
             "The network spans 500 cables and carries 99 percent of traffic. " +
             "Repairs took 30 days on average across 12 incidents.";

const titleCard  = () => ({ t: "title",  eyebrow: "SUBSEA", lines: [["THE CABLES", "white"], ["500", "lime"]], sub: "what carries the internet", caption: "Five hundred cables carry almost everything." });
const kickerCard = () => ({ t: "kicker", top: "NOT SATELLITE", bottom: "CABLE", sub: "the map is the story", caption: "The internet is a map of cables, not satellites." });
const statCard   = (over = {}) => ({ t: "stat", eyebrow: "FAULTS", value: 70, unit: "%", lines: ["of faults", "involve anchors"], hi: 1, source: "Reuters", caption: "Seventy percent of faults involve anchors.", ...over });
const barsCard   = (over = {}) => ({ t: "bars", eyebrow: "CAUSE", bars: [["anchors", 70], ["nature", 30]], source: "BBC", caption: "Anchors outweigh natural causes.", ...over });
// Filler CYCLES through four card types. A pad of identical cards is not a
// realistic spec and, since the mix gate landed, is not a valid one either —
// fixtures have to look like something the model would plausibly emit.
const FILLER_CYCLE = [
  (n) => ({ t: "diagram", eyebrow: `STEP ${n}`, nodes: [["SHORE", "landing"], ["TRUNK", "deep water"]], caption: `Step ${n} of the route runs from shore to trunk line.` }),
  (n) => ({ t: "turn", eyebrow: `TURN ${n}`, lines: [[`POINT ${n}`, "white"]], caption: `But reading ${n} misses what actually cuts the cable.` }),
  (n) => ({ t: "stat", eyebrow: `FIGURE ${n}`, value: 70, unit: "%", lines: ["of faults"], hi: 0, source: "Reuters", caption: `Seventy percent again at point ${n}.` }),
  (n) => ({ t: "bars", eyebrow: `SPLIT ${n}`, bars: [["anchors", 70], ["nature", 30]], source: "BBC", caption: `Anchors outweigh nature at point ${n}.` }),
];
const fillerCard = (n) => FILLER_CYCLE[n % FILLER_CYCLE.length](n);

// Padding for SMALL specs: alternates two card types that carry no numbers and
// no source, so a test about sourcing or figures measures only the cards it
// deliberately added. Small specs sit below MIX_MIN_CARDS, so two types is fine.
const plainFiller = (n) => FILLER_CYCLE[n % 2](n);

/** Minimum viable valid spec: title + fillers + kicker. */
function spec(cards = [], { pad = 4, filler = plainFiller } = {}) {
  const mid = [];
  for (let i = 0; i < pad; i++) mid.push(filler(i));
  return { slides: [titleCard(), ...cards, ...mid, kickerCard()] };
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

test("the closed set excludes `sources` from what the model may emit", () => {
  assert.ok(CARD_TYPES.includes("sources"));
  assert.ok(!MODEL_EMITTABLE.includes("sources"));
});

test("a model-emitted sources card is DROPPED, never rendered", () => {
  const s = spec([{ t: "sources", eyebrow: "WHO", items: [["BBC", 3], ["Reuters", 2]], caption: "Two outlets covered this." }]);
  const v = validateSpec(s, opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.dropped.length, 1);
  assert.match(v.dropped[0].reason, /code-injected from event_articles/);
  assert.ok(!v.spec.slides.some(c => c.t === "sources"));
});

test("the same sources card passes when the code path injects it", () => {
  const s = spec([{ t: "sources", eyebrow: "WHO", items: [["BBC", 3], ["Reuters", 2]], caption: "Two outlets covered this." }]);
  const v = validateSpec(s, { ...opts, allowSourcesCard: true });
  assert.equal(v.ok, true, v.errors.join("; "));
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
  const s = { slides: [titleCard(), statCard({ source: "nobody" }), kickerCard()] };
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
  const s = { slides: [titleCard(), ...mid, kickerCard()] };
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
  const s = { slides: [titleCard(), ...mid, kickerCard()] };  // 4/20 = 20%
  const v = validateSpec(s, opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.stats.dropRatio, 0.2);
  assert.equal(v.stats.emitted, 20);
});

test("more than 2 SOURCING drops fails even at a low overall drop rate", () => {
  const mid = [];
  for (let i = 0; i < 3; i++) mid.push(statCard({ source: "analysts", value: 70 }));
  for (let i = 0; i < 25; i++) mid.push(fillerCard(i));
  const s = { slides: [titleCard(), ...mid, kickerCard()] };  // 3/30 = 10%
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
  const s = { slides: [titleCard(), ...mid, kickerCard()] };
  const v = validateSpec(s, opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.stats.sourcingDrops, 2);
});

// ─── Card-type mix ──────────────────────────────────────────────────────────

test("the Hindu case: 26 slides / 21 stat is dropped down and then rejected", () => {
  // Every card individually valid; the spec is still a spreadsheet read aloud.
  const s = { slides: [titleCard()] };
  for (let i = 0; i < 21; i++) s.slides.push(statCard({ caption: `Seventy percent, point ${i}.` }));
  for (let i = 0; i < 3; i++)  s.slides.push(plainFiller(i));
  s.slides.push(kickerCard());
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
  const s = { slides: [titleCard()] };
  for (let i = 0; i < 4; i++) s.slides.push(statCard({ caption: `Run card ${i}.` }));
  for (let i = 0; i < 8; i++) s.slides.push(plainFiller(i));
  s.slides.push(kickerCard());
  const v = validateSpec(s, opts);
  const runDrops = v.dropped.filter(d => /consecutive/.test(d.reason));
  assert.equal(runDrops.length, 2, JSON.stringify(v.dropped));
  // Exactly two of the run survive, in order.
  assert.equal(v.spec.slides.filter(c => c.t === "stat").length, 2);
});

test("a well-mixed spec is untouched by the mix gate", () => {
  const s = { slides: [titleCard()] };
  for (let i = 0; i < 20; i++) s.slides.push(fillerCard(i));
  s.slides.push(kickerCard());
  const v = validateSpec(s, opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.stats.mixDrops, 0, JSON.stringify(v.dropped));
});

test("the mix gate runs at EVERY size — no suspension threshold", () => {
  // 8 cards with 3 stat in a row. The old MIX_MIN_CARDS=9 suspension meant the
  // gate never executed on a spec this size — and every live spec on
  // 2026-08-02 came back at 6 cards, so it never executed at all.
  const s = { slides: [titleCard(), statCard(), statCard(), statCard(), plainFiller(0), plainFiller(1), plainFiller(2), kickerCard()] };
  const v = validateSpec(s, opts);
  assert.equal(v.stats.mixDrops, 1, JSON.stringify(v.dropped));
  assert.match(v.dropped[0].reason, /consecutive "stat" cards/);
});

test("MIN_CARDS_PER_TYPE keeps the share cap safe on small specs", () => {
  // 7 cards, 2 of a type: the exact 1/3 solution would allow only 1 here
  // (floor(5/2) = 2 — but on a 6-card spec it drops to 1). The floor of 2 is
  // what makes the gate safe at every size without a threshold.
  const s = { slides: [titleCard(), statCard(), statCard(), plainFiller(0), plainFiller(1), kickerCard()] };
  const v = validateSpec(s, opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.stats.mixDrops, 0, JSON.stringify(v.dropped));
  assert.equal(v.stats.byType.stat, 2);
});

// ─── Length floor (duration is a ceiling, not a target) ─────────────────────

test("a spec below the 6-card floor is skipped as too thin, never padded", () => {
  const s = { slides: [titleCard(), plainFiller(0), plainFiller(1), kickerCard()] };
  const v = validateSpec(s, opts);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(" "), /only 4 slides remain.*< 6.*too thin for a video/);
});

test("exactly 6 surviving cards is enough", () => {
  const s = { slides: [titleCard(), plainFiller(0), plainFiller(1), plainFiller(2), plainFiller(3), kickerCard()] };
  const v = validateSpec(s, opts);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.equal(v.stats.slides, 6);
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

test("buildSourcesCard emits outlet names and counts, and NO score field", () => {
  const card = buildSourcesCard([
    { source_name: "Reuters", article_count: 4 },
    { source_name: "BBC News", article_count: 2 },
  ]);
  assert.equal(card.t, "sources");
  assert.deepEqual(card.items, [["Reuters", 4], ["BBC News", 2]]);
  // The measured reason: quality_score is 0/154 populated, and credibility is a
  // 4-value tier that would render as false precision.
  const flat = JSON.stringify(card);
  assert.ok(!/score|credibility/i.test(flat), `no score field may appear: ${flat}`);
});

test("buildSourcesCard returns null below two outlets — omit, never single-source", () => {
  assert.equal(buildSourcesCard([{ source_name: "Reuters", article_count: 4 }]), null);
  assert.equal(buildSourcesCard([]), null);
  assert.equal(buildSourcesCard(null), null);
});

test("a card built by buildSourcesCard validates under the injection flag", () => {
  const card = buildSourcesCard([
    { source_name: "Reuters", article_count: 4 },
    { source_name: "BBC News", article_count: 2 },
  ]);
  const v = validateSpec(spec([card]), { ...opts, allowSourcesCard: true });
  assert.equal(v.ok, true, v.errors.join("; "));
});
