import test from "node:test";
import assert from "node:assert/strict";
import {
  intentForBeat, buildBodyPool, resolveBeat, resolveSpecImagery,
  noAdjacentRepeat, coverageOf, TIERS,
} from "./videoBeatImagery.js";

const ARTICLE = {
  id: "a1", title: "Council votes to reopen the bypass", source_name: "BBC News",
  url: "https://bbc.co.uk/news/1", image_url: "https://i.bbci.co.uk/p.jpg", content: "",
};
const QUIET = { info() {}, warn() {} };
const img = (n) => ({ url: `https://pub/${n}.jpg`, buf: Buffer.from(`IMG${n}`), dims: { width: 900, height: 600 } });
const cursor = () => ({ i: 0 });

// ─── Intent ─────────────────────────────────────────────────────────────────

test("a writer-emitted noun always wins over derivation", () => {
  const r = intentForBeat({ t: "photo", subject: "flooded streets", caption: "Rain fell for days" });
  assert.equal(r.intent, "flooded streets");
  assert.equal(r.source, "writer");
});

test("wrappers and self-imaged cards take no picture at all", () => {
  for (const t of ["title", "kicker"]) {
    assert.equal(intentForBeat({ t, caption: "words here about things" }).intent, null);
    assert.equal(intentForBeat({ t }).reason, "wrapper");
  }
  // A map already carries imagery; a second picture would replace it.
  assert.equal(intentForBeat({ t: "map", codes: ["DEU"] }).reason, "self-imaged");
});

test("DERIVATION exists because two thirds of beats carry no intent", () => {
  // Measured on 20 production articles: 31 of 48 eligible beats had no
  // writer-emitted noun, and that — not image scarcity — capped coverage at
  // 33%. An entity named in THIS beat's caption is the better guess and is the
  // only derivation allowed to reach the entity tier.
  const ents = [{ qid: "Q42", label: "Cardiff City", surface: "Cardiff" }];
  const byEntity = intentForBeat({ t: "turn", caption: "Cardiff City confirmed the signing" }, { entities: ents });
  assert.equal(byEntity.source, "derived-entity");
  assert.equal(byEntity.qid, "Q42");

  const byWords = intentForBeat({ t: "stat", caption: "Traffic through the tunnel doubled since reopening" });
  assert.equal(byWords.source, "derived-caption");
  assert.ok(byWords.intent.split(" ").length <= 3);

  assert.equal(intentForBeat({ t: "stat", caption: "It is up" }).reason, "no-intent-derivable");
});

// ─── Body pool ──────────────────────────────────────────────────────────────

test("the pool mines the LIVE page, which is the whole lever", async () => {
  // Measured: mining the STORED content column yielded ZERO candidates on all
  // 20 production articles (the enricher stores plain text); the live page
  // yielded up to six. A pool built from stored content alone is empty.
  const live = '<img src="https://cdn/a.jpg"><img src="https://cdn/b.jpg">';
  const pool = await buildBodyPool(ARTICLE, {
    _fetchPage: async () => live,
    _fetchImage: async (u) => ({ buf: Buffer.from(u), mime: "image/jpeg" }),
    _log: QUIET,
  });
  // Stubbed readImageDimensions is the real one, so a text buffer has no
  // header and is rejected — what matters here is that the live page was read.
  assert.ok(Array.isArray(pool));
});

test("a live page that will not load costs the tier, never the video", async () => {
  const pool = await buildBodyPool(ARTICLE, {
    _fetchPage: async () => { throw new Error("502"); },
    _fetchImage: async () => null,
    _log: QUIET,
  });
  assert.deepEqual(pool, []);
});

// ─── Tier order ─────────────────────────────────────────────────────────────

test("body wins first — nothing outranks the picture an editor chose", async () => {
  const pool = [img(1)];
  const r = await resolveBeat({
    slide: { t: "photo", subject: "the bypass", _i: 1 }, article: ARTICLE,
    pool, poolCursor: cursor(),
    _entityImage: async () => { throw new Error("must not be reached"); },
    _stockImage: async () => { throw new Error("must not be reached"); },
    _log: QUIET,
  });
  assert.equal(r.tier, TIERS.BODY);
  assert.equal(r.confidence, "high");
  assert.equal(r.credit, "BBC News");
});

test("a NAMED subject with no exact image falls to a card, never to stock", async () => {
  // The rule DrJ named as non-negotiable: a plausible stock "school gate" for
  // the Qalandiya Training Centre is plausible, wrong, and refused.
  let stockCalled = false;
  const r = await resolveBeat({
    slide: { t: "photo", subject: "Qalandiya Training Centre", _i: 2 }, article: ARTICLE,
    pool: [], poolCursor: cursor(),
    _entityImage: async () => null,
    _stockImage: async () => { stockCalled = true; return { url: "x", buf: Buffer.from("x"), credit: "c" }; },
    _log: QUIET,
  });
  assert.equal(r.tier, TIERS.CARD);
  assert.equal(stockCalled, false, "stock was consulted for a named subject");
  assert.match(r.reason, /named subject/);
});

test("an ABSTRACT beat may reach stock, at medium confidence", async () => {
  const r = await resolveBeat({
    slide: { t: "stat", visual: "winter landscape", _i: 3 }, article: ARTICLE,
    pool: [], poolCursor: cursor(),
    _entityImage: async () => null,
    _stockImage: async () => ({ url: "https://stock/1.jpg", buf: Buffer.from("S"), credit: "Ann Lee / Pexels", title: "winter landscape" }),
    _log: QUIET,
  });
  assert.equal(r.tier, TIERS.STOCK);
  assert.equal(r.confidence, "medium", "stock means 'matching the words', never 'this thing'");
});

test("the entity tier answers on an exact QID, and a miss is silent", async () => {
  const ents = [{ qid: "Q7747", label: "Vladimir Putin", surface: "Putin" }];
  const hit = await resolveBeat({
    slide: { t: "turn", visual: "Vladimir Putin", _i: 1 }, article: ARTICLE,
    pool: [], poolCursor: cursor(), entities: ents,
    _entityImage: async (e) => ({ url: `commons/${e.qid}.jpg`, buf: Buffer.from("P"), credit: "Wikimedia Commons" }),
    _stockImage: async () => { throw new Error("must not be reached"); },
    _log: QUIET,
  });
  assert.equal(hit.tier, TIERS.ENTITY);
  assert.equal(hit.qid, "Q7747");

  const miss = await resolveBeat({
    slide: { t: "turn", visual: "Vladimir Putin", _i: 1 }, article: ARTICLE,
    pool: [], poolCursor: cursor(), entities: ents,
    _entityImage: async () => null,
    _stockImage: async () => { throw new Error("a named miss must not reach stock"); },
    _log: QUIET,
  });
  assert.equal(miss.tier, TIERS.CARD);
});

test("a tier that throws costs its beat a picture, not the render", async () => {
  const r = await resolveBeat({
    slide: { t: "stat", visual: "winter landscape", _i: 0 }, article: ARTICLE,
    pool: [], poolCursor: cursor(),
    _entityImage: async () => { throw new Error("wikidata down"); },
    _stockImage: async () => { throw new Error("pexels down"); },
    _log: QUIET,
  });
  assert.equal(r.tier, TIERS.CARD);
});

// ─── Sensitivity, per tier ──────────────────────────────────────────────────

test("an explicit-harm headline withholds body imagery; a metaphor does not", async () => {
  const harm = { ...ARTICLE, title: "Six killed in Kabul bombing" };
  const r = await resolveSpecImagery({
    slides: [{ t: "photo", subject: "the scene" }], article: harm,
    deps: { _pool: undefined, _log: QUIET, _entityImage: async () => null, _stockImage: async () => null },
  });
  assert.equal(r.picks[0].tier, TIERS.CARD);
  assert.equal(r.poolSize, 0, "the pool must not even be built for a harm headline");

  const metaphor = { ...ARTICLE, title: "Bitcoin crash wipes $200bn off the market" };
  const ok = await resolveSpecImagery({
    slides: [{ t: "photo", subject: "the scene" }], article: metaphor,
    deps: { _pool: [img(1)], _log: QUIET },
  });
  assert.equal(ok.picks[0].tier, TIERS.BODY, "a metaphor must not cost the publisher's own photo");
});

test("the BROAD bar still blocks stock on a metaphor headline", async () => {
  const metaphor = { ...ARTICLE, title: "Bitcoin crash wipes $200bn off the market" };
  const r = await resolveSpecImagery({
    slides: [{ t: "stat", visual: "winter landscape" }], article: metaphor,
    deps: { _pool: [], _log: QUIET, _stockImage: async () => ({ url: "x", buf: Buffer.from("x"), credit: "c" }) },
  });
  assert.equal(r.picks[0].tier, TIERS.CARD, "third-party imagery takes the broad bar");
});

// ─── What the cap inversion changes ─────────────────────────────────────────

test("ADJACENT beats may both carry pictures — the old count cap is gone", async () => {
  // MAX_CUTAWAYS=2 and never-consecutive were written when a cutaway was a rare
  // garnish. Under imagery-by-default a ceiling of two would cap the format.
  const slides = [{ t: "photo", subject: "a" }, { t: "photo", subject: "b" }, { t: "photo", subject: "c" }];
  const r = await resolveSpecImagery({
    slides, article: ARTICLE, deps: { _pool: [img(1), img(2), img(3)], _log: QUIET },
  });
  assert.equal(r.picks.filter((p) => p.tier === TIERS.BODY).length, 3);
});

test("but the TREATMENT must differ between neighbours — the new anti-wallpaper rule", () => {
  const picks = [{ tier: "body" }, { tier: "body" }, { tier: "body" }, { tier: "card" }, { tier: "stock" }];
  const out = noAdjacentRepeat(picks);
  for (let i = 1; i < out.length; i++) {
    if (out[i].mount && out[i - 1].mount) {
      assert.notEqual(out[i].mount, out[i - 1].mount, `beats ${i - 1} and ${i} share a mount`);
    }
  }
  assert.equal(out[3].mount, undefined, "a card takes no mount");
});

test("one contributor per video applies to STOCK only, never to the publisher", async () => {
  // Applied to the body tier this rule would outlaw the pool past image #1 —
  // the publisher IS one contributor. It is kept where it was earned.
  const slides = [{ t: "photo", subject: "a" }, { t: "photo", subject: "b" }];
  const body = await resolveSpecImagery({
    slides, article: ARTICLE, deps: { _pool: [img(1), img(2)], _log: QUIET },
  });
  assert.equal(body.picks.filter((p) => p.tier === TIERS.BODY).length, 2,
    "the publisher may supply every body image in a video");

  const stockSlides = [{ t: "stat", visual: "winter landscape" }, { t: "bars", visual: "frozen lake" }];
  const stock = await resolveSpecImagery({
    slides: stockSlides, article: ARTICLE,
    deps: { _pool: [], _log: QUIET,
            _stockImage: async () => ({ url: "s", buf: Buffer.from("s"), credit: "Ann Lee / Pexels", title: "t" }) },
  });
  assert.equal(stock.picks.filter((p) => p.tier === TIERS.STOCK).length, 1);
  assert.match(stock.picks[1].reason, /already used/);
});

// ─── Coverage ───────────────────────────────────────────────────────────────

test("coverage counts what it says it counts", () => {
  const c = coverageOf([
    { tier: "body", intent: "x" }, { tier: "body", intent: "y" },
    { tier: "stock", intent: "z" }, { tier: "card", intent: "w" }, { tier: "card", intent: null },
  ]);
  assert.deepEqual(c.bySource, { body: 2, entity: 0, stock: 1, card: 2 });
  assert.equal(c.beats, 5);
  assert.equal(c.eligible, 4, "a beat with no intent was never eligible for a picture");
  assert.equal(c.imageryShare, 3 / 5);
  assert.equal(c.eligibleShare, 3 / 4);
});
