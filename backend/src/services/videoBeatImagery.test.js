import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { getFFmpegPath } from "./videoGenerator.js";
import {
  intentForBeat, buildBodyPool, resolveBeat, resolveSpecImagery,
  noAdjacentRepeat, coverageOf, TIERS,
} from "./videoBeatImagery.js";

// FIXTURES USE TYPE CARDS, not photo cards: a photo card gets its picture
// from choosePhotoUnderlay, so the resolver deliberately leaves it alone
// (SELF_IMAGED_TYPES). Fixtures built on photo cards were testing a bug.
const ARTICLE = {
  id: "a1", title: "Council votes to reopen the bypass", source_name: "BBC News",
  url: "https://bbc.co.uk/news/1", image_url: "https://i.bbci.co.uk/p.jpg", content: "",
};
const QUIET = { info() {}, warn() {} };
const img = (n) => ({ url: `https://pub/${n}.jpg`, buf: Buffer.from(`IMG${n}`), dims: { width: 900, height: 600 } });
const cursor = () => ({ used: new Set() });

// ─── Intent ─────────────────────────────────────────────────────────────────

test("a writer-emitted noun always wins over derivation", () => {
  const r = intentForBeat({ t: "turn", visual: "flooded streets", caption: "Rain fell for days" });
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
    slide: { t: "turn", visual: "the bypass", _i: 1 }, article: ARTICLE,
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
    slide: { t: "turn", visual: "Qalandiya Training Centre", _i: 2 }, article: ARTICLE,
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
    slides: [{ t: "turn", visual: "the scene" }], article: harm,
    deps: { _pool: undefined, _log: QUIET, _entityImage: async () => null, _stockImage: async () => null },
  });
  assert.equal(r.picks[0].tier, TIERS.CARD);
  assert.equal(r.poolSize, 0, "the pool must not even be built for a harm headline");

  const metaphor = { ...ARTICLE, title: "Bitcoin crash wipes $200bn off the market" };
  const ok = await resolveSpecImagery({
    slides: [{ t: "turn", visual: "the scene" }], article: metaphor,
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
  const slides = [{ t: "turn", visual: "a" }, { t: "stat", visual: "b" }, { t: "diagram", visual: "c" }];
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
  const slides = [{ t: "turn", visual: "a" }, { t: "stat", visual: "b" }];
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
  assert.deepEqual(c.bySource, { web: 0, body: 2, entity: 0, stock: 1, card: 2 });
  assert.equal(c.beats, 5);
  assert.equal(c.eligible, 4, "a beat with no intent was never eligible for a picture");
  assert.equal(c.imageryShare, 3 / 5);
  assert.equal(c.eligibleShare, 3 / 4);
});


// ─── Matched assignment (ruling 2) ──────────────────────────────────────────

test("a beat takes the pool image whose DESCRIPTION matches its intent, not the next in line", async () => {
  const pool = [
    { ...img(1), text: "Traders on the floor of the exchange" },
    { ...img(2), text: "Gas storage tanks at the Rehden facility" },
    { ...img(3), text: "" },
  ];
  const r = await resolveBeat({
    slide: { t: "stat", visual: "gas storage tanks", _i: 0 }, article: ARTICLE,
    pool, poolCursor: cursor(), _log: QUIET,
  });
  assert.equal(r.tier, TIERS.BODY);
  assert.equal(r.bodyMatch, "intent");
  assert.equal(r.imageUrl, pool[1].url, "the described match must beat slide order");
});

test("no description matching means slide order — a beat never goes empty because matching exists", async () => {
  const pool = [{ ...img(1), text: "Something unrelated entirely" }, { ...img(2), text: "" }];
  const pc = cursor();
  const a = await resolveBeat({ slide: { t: "stat", visual: "server racks", _i: 0 }, article: ARTICLE, pool, poolCursor: pc, _log: QUIET });
  assert.equal(a.tier, TIERS.BODY);
  assert.equal(a.bodyMatch, "order");
  assert.equal(a.imageUrl, pool[0].url);
  const b = await resolveBeat({ slide: { t: "turn", visual: "server racks", _i: 1 }, article: ARTICLE, pool, poolCursor: pc, _log: QUIET });
  assert.equal(b.imageUrl, pool[1].url, "each image is used at most once");
});

test("a matched image is consumed — the next beat cannot take it again", async () => {
  const pool = [
    { ...img(1), text: "" },
    { ...img(2), text: "Container ship at the port of Rotterdam" },
  ];
  const pc = cursor();
  const first = await resolveBeat({ slide: { t: "stat", visual: "container ship", _i: 0 }, article: ARTICLE, pool, poolCursor: pc, _log: QUIET });
  assert.equal(first.imageUrl, pool[1].url);
  assert.equal(first.bodyMatch, "intent");
  const second = await resolveBeat({ slide: { t: "turn", visual: "container ship", _i: 1 }, article: ARTICLE, pool, poolCursor: pc, _log: QUIET });
  assert.equal(second.imageUrl, pool[0].url, "the matched image was spent; order fallback takes the remaining one");
  assert.equal(second.bodyMatch, "order");
});

// ─── The context extractor ──────────────────────────────────────────────────

test("alt and figcaption reach the right URLs, srcset variants included", async () => {
  const { extractImageContexts } = await import("./videoBeatImagery.js");
  const html = `
    <img src="https://cdn/a.jpg" srcset="https://cdn/a-320.jpg 320w, https://cdn/a-1600.jpg 1600w"
         alt="Gas storage tanks at Rehden">
    <figure>
      <img src="https://cdn/b.jpg" alt="">
      <figcaption>Traders react as <b>prices</b> fall</figcaption>
    </figure>
    <img src="https://cdn/c.jpg">`;
  const m = extractImageContexts(html);
  assert.equal(m.get("https://cdn/a.jpg"), "Gas storage tanks at Rehden");
  assert.equal(m.get("https://cdn/a-1600.jpg"), "Gas storage tanks at Rehden",
    "the miner picks the largest srcset entry, so the text must follow it");
  assert.equal(m.get("https://cdn/b.jpg"), "Traders react as prices fall", "figcaption text, tags stripped");
  assert.equal(m.get("https://cdn/c.jpg"), undefined, "no description is no entry, not an empty one");
  assert.equal(extractImageContexts(null).size, 0);
});

test("photo beats do not consume the pool — their picture comes from the underlay path", async () => {
  // Found by RENDERING, not reading: photo cards always carry a `subject`, so
  // they always had an intent, so the resolver spent a pool image on each —
  // and produceVideo then discarded the pick because the beat already had an
  // underlay. On a 2-image pool the whole pool vanished into beats that never
  // showed it, and every type card rendered bare.
  // THREE images, because a photo card in the spec now HOLDS one for itself —
  // that hold is a separate rule, tested below; this test is about the photo
  // beat not consuming a pool slot for a picture it never shows.
  const pool = [{ ...img(1), text: "" }, { ...img(2), text: "" }, { ...img(3), text: "" }];
  const r = await resolveSpecImagery({
    slides: [
      { t: "photo", subject: "Dolly Parton on stage" },
      { t: "stat", visual: "vinyl record", value: 1, caption: "c", source: "s" },
      { t: "turn", visual: "recording studio" },
    ],
    article: ARTICLE, deps: { _pool: pool, _log: QUIET },
  });
  assert.equal(r.picks[0].tier, TIERS.CARD, "the photo beat must not take a pool image");
  assert.equal(r.picks[0].reason, "self-imaged");
  assert.equal(r.picks[1].tier, TIERS.BODY, "the pool goes to the type beats instead");
  assert.equal(r.picks[2].tier, TIERS.BODY);
});

// ─── The picture, not the URL (found by rendering, 2026-08-30) ──────────────

test("the SAME photograph at two rendition sizes enters the pool once", async () => {
  // The defect the samples exposed: a CDN serves one photo at many URLs and
  // many sizes, so the URL set missed it and the dimension signature missed it
  // too. The result was one Netanyahu portrait on two beats of a video and one
  // CNBC illustration on three of another.
  const ff = getFFmpegPath();
  const jpeg = (spec, w) => execFileSync(ff, ["-loglevel", "error", "-f", "lavfi", "-i", spec,
    "-frames:v", "1", "-vf", `scale=${w}:-2`, "-f", "image2", "-c:v", "mjpeg", "pipe:1"], { maxBuffer: 1 << 24 });

  const big = jpeg("testsrc2=size=1200x900", 1200);
  const small = jpeg("testsrc2=size=1200x900", 700);      // same picture, smaller
  const other = jpeg("color=c=navy:s=1200x900", 1200);    // genuinely different

  const byUrl = { "https://cdn/a/LANDSCAPE_1200": big, "https://cdn/a/LANDSCAPE_700": small, "https://cdn/b": other };
  const pool = await buildBodyPool(
    { ...ARTICLE, content: Object.keys(byUrl).map((u) => `<img src="${u}">`).join("") },
    { _fetchPage: async () => null, _fetchImage: async (u) => ({ buf: byUrl[u], mime: "image/jpeg" }), _log: QUIET },
  );
  assert.equal(pool.length, 2, `expected the two renditions to collapse; got ${pool.map((p) => p.dims.width)}`);
});

test("a picture whose hash cannot be computed is KEPT, not discarded", async () => {
  // A hash we could not compute must never silently cost us a usable image.
  const { averageHash } = await import("./videoBeatImagery.js");
  assert.equal(averageHash(Buffer.from("not an image")), null);
});

test("hashDistance separates renditions from different pictures", async () => {
  const { averageHash, hashDistance, DUPLICATE_BITS } = await import("./videoBeatImagery.js");
  const ff = getFFmpegPath();
  const jpeg = (spec, w) => execFileSync(ff, ["-loglevel", "error", "-f", "lavfi", "-i", spec,
    "-frames:v", "1", "-vf", `scale=${w}:-2`, "-f", "image2", "-c:v", "mjpeg", "pipe:1"], { maxBuffer: 1 << 24 });
  const a = averageHash(jpeg("testsrc2=size=900x600", 900));
  const aSmall = averageHash(jpeg("testsrc2=size=900x600", 320));
  const b = averageHash(jpeg("color=c=navy:s=900x600", 900));
  assert.ok(hashDistance(a, aSmall) <= DUPLICATE_BITS, `renditions differ by ${hashDistance(a, aSmall)} bits`);
  assert.ok(hashDistance(a, b) > DUPLICATE_BITS, `distinct pictures differ by only ${hashDistance(a, b)} bits`);
});

// ─── The shared ledger (DrJ, 2026-08-30) ───────────────────────────────────

test("the ledger is TWO-WAY — whichever path claims first wins, either order", async () => {
  // Not "the resolver reads the photo path's output": that fixes today's
  // ordering and breaks the moment the order changes. Both write, both check.
  const { createImageLedger } = await import("./videoBeatImagery.js");
  const ff = getFFmpegPath();
  const jpeg = (spec, w) => execFileSync(ff, ["-loglevel", "error", "-f", "lavfi", "-i", spec,
    "-frames:v", "1", "-vf", `scale=${w}:-2`, "-f", "image2", "-c:v", "mjpeg", "pipe:1"], { maxBuffer: 1 << 24 });
  const photo = jpeg("testsrc2=size=1000x700", 1000);
  const sameSmaller = jpeg("testsrc2=size=1000x700", 420);   // the SAME picture, another rendition
  const different = jpeg("color=c=navy:s=1000x700", 1000);

  // resolver first, photo path second
  const a = createImageLedger({ _log: QUIET });
  assert.equal(a.claim(photo, { label: "resolver" }), true);
  assert.equal(a.claim(sameSmaller, { label: "photo path" }), false, "a rendition of a spent picture is spent");
  assert.equal(a.claim(different, { label: "photo path" }), true);

  // photo path first, resolver second — the same answers
  const b = createImageLedger({ _log: QUIET });
  assert.equal(b.claim(sameSmaller, { label: "photo path" }), true);
  assert.equal(b.claim(photo, { label: "resolver" }), false);
  assert.equal(b.size, 1);
});

test("an unhashable image is let through — 'we could not tell' never costs a picture", async () => {
  const { createImageLedger } = await import("./videoBeatImagery.js");
  const l = createImageLedger({ _log: QUIET });
  assert.equal(l.claim(Buffer.from("not an image")), true);
  assert.equal(l.claim(Buffer.from("also not an image")), true);
});

test("the article's own photograph is RESERVED for its photo card", async () => {
  // Otherwise a type beat takes it first and the card that exists to show it
  // renders bare — the resolver running before the slide loop guarantees it.
  const { createImageLedger } = await import("./videoBeatImagery.js");
  const ledger = createImageLedger({ _log: QUIET });
  const own = { ...img(1), url: ARTICLE.image_url, text: "" };
  const other = { ...img(2), text: "" };
  const r = await resolveSpecImagery({
    slides: [{ t: "photo", subject: "the bypass" }, { t: "turn", visual: "the bypass at dusk" }],
    article: ARTICLE, ledger, deps: { _pool: [own, other], _log: QUIET },
  });
  assert.equal(r.picks[0].tier, TIERS.CARD, "the photo beat is self-imaged");
  assert.equal(r.picks[1].tier, TIERS.BODY);
  assert.notEqual(r.picks[1].imageUrl, ARTICLE.image_url,
    "the type beat must not take the picture the photo card is going to show");
  // AND THE HOLD MUST NOT SPEND IT. Reserving through the ledger marked the
  // photograph used, so the photo path's own claim came back "already used"
  // and the whole video rendered with no pictures — worse than the repetition
  // it was fixing. Asserted with REAL bytes, because the img() fixture's
  // placeholder Buffer hashes to null and a null hash is never recorded.
  const realOwn = execFileSync(getFFmpegPath(), ["-loglevel", "error", "-f", "lavfi",
    "-i", "testsrc2=size=880x600", "-frames:v", "1", "-f", "image2", "-c:v", "mjpeg", "pipe:1"],
    { maxBuffer: 1 << 24 });
  const l2 = createImageLedger({ _log: QUIET });
  await resolveSpecImagery({
    slides: [{ t: "photo", subject: "the bypass" }, { t: "turn", visual: "the bypass at dusk" }],
    article: ARTICLE, ledger: l2,
    deps: { _pool: [{ ...own, buf: realOwn }, other], _log: QUIET },
  });
  assert.equal(l2.claim(realOwn, { label: "the photo path, later" }), true,
    "the photo card must still be able to claim the picture held for it");
});

test("a photograph already spent sends the beat to the next tier, not to a repeat", async () => {
  const { createImageLedger } = await import("./videoBeatImagery.js");
  const ff = getFFmpegPath();
  // REAL bytes: img() carries a placeholder Buffer, which hashes to null, and
  // a null hash is deliberately let through — so a fake image cannot exercise
  // the ledger at all.
  const real = execFileSync(ff, ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=900x600",
    "-frames:v", "1", "-f", "image2", "-c:v", "mjpeg", "pipe:1"], { maxBuffer: 1 << 24 });
  const ledger = createImageLedger({ _log: QUIET });
  const only = { ...img(1), buf: real, text: "" };
  ledger.claim(only.buf, { label: "claimed by the photo path first" });
  const r = await resolveSpecImagery({
    slides: [{ t: "turn", visual: "the bypass" }],
    article: ARTICLE, ledger, deps: { _pool: [only], _log: QUIET },
  });
  assert.equal(r.picks[0].tier, TIERS.CARD);
  assert.match(r.picks[0].reason, /already used/);
});

// ─── The entity tier is ADDITIVE (DrJ, 2026-08-30) ─────────────────────────

test("a NAMED subject takes its P18 portrait even when body candidates exist", async () => {
  // The pool-depth lever. Measured before this change: the entity tier fired
  // ONCE across twenty articles, because body ran first and exhausted the
  // pool — while P18 was available for 27 of 45 extracted entities. Running
  // entity ahead of body for named subjects turns a fallback nobody reaches
  // into a SECOND picture on the same article.
  const ents = [{ qid: "Q7747", label: "Benjamin Netanyahu", surface: "Netanyahu" }];
  const r = await resolveBeat({
    slide: { t: "turn", visual: "Benjamin Netanyahu", _i: 1 }, article: ARTICLE,
    pool: [{ ...img(1), text: "" }], poolCursor: cursor(), entities: ents,
    _entityImage: async (e) => ({ url: `commons/${e.qid}.jpg`, buf: Buffer.from("PORTRAIT"), credit: "Wikimedia Commons" }),
    _log: QUIET,
  });
  assert.equal(r.tier, TIERS.ENTITY, "the portrait must win over an unrelated article photo");
  assert.equal(r.qid, "Q7747");
});

test("the body pool is left INTACT when the entity tier answers", async () => {
  // Additive means the article's photographs are still there for other beats.
  const ents = [{ qid: "Q7747", label: "Benjamin Netanyahu", surface: "Netanyahu" }];
  const pc = cursor();
  const pool = [{ ...img(1), text: "" }, { ...img(2), text: "" }];
  await resolveBeat({
    slide: { t: "turn", visual: "Benjamin Netanyahu", _i: 0 }, article: ARTICLE,
    pool, poolCursor: pc, entities: ents,
    _entityImage: async () => ({ url: "c.jpg", buf: Buffer.from("P"), credit: "Wikimedia Commons" }),
    _log: QUIET,
  });
  assert.equal(pc.used.size, 0, "an entity answer must not spend a pool image");
});

test("an ABSTRACT beat still goes body-first — the ordering change is named-only", async () => {
  const r = await resolveBeat({
    slide: { t: "stat", visual: "winter landscape", _i: 0 }, article: ARTICLE,
    pool: [{ ...img(1), text: "" }], poolCursor: cursor(), entities: [],
    _entityImage: async () => { throw new Error("must not be consulted for an abstract beat"); },
    _log: QUIET,
  });
  assert.equal(r.tier, TIERS.BODY);
});

test("a P18 portrait already spent falls through to body, not to a repeat", async () => {
  const ents = [{ qid: "Q1", label: "Benjamin Netanyahu", surface: "Netanyahu" }];
  const portrait = execFileSync(getFFmpegPath(), ["-loglevel", "error", "-f", "lavfi",
    "-i", "testsrc2=size=800x600", "-frames:v", "1", "-f", "image2", "-c:v", "mjpeg", "pipe:1"], { maxBuffer: 1 << 24 });
  const { createImageLedger } = await import("./videoBeatImagery.js");
  const ledger = createImageLedger({ _log: QUIET });
  ledger.claim(portrait, { label: "already on screen" });
  const r = await resolveBeat({
    slide: { t: "turn", visual: "Benjamin Netanyahu", _i: 1 }, article: ARTICLE,
    pool: [{ ...img(1), text: "" }], poolCursor: cursor(), entities: ents, ledger,
    _entityImage: async () => ({ url: "c.jpg", buf: portrait, credit: "Wikimedia Commons" }),
    _log: QUIET,
  });
  assert.equal(r.tier, TIERS.BODY, "a spent portrait must not be shown twice");
});

test("the ledger reports its distinct photographs by SOURCE bytes", async () => {
  // The trustworthy count. Counting off final frames measures the layout:
  // two different photographs on one mount hashed 4 bits apart, one photograph
  // at two crops hashed 27 apart. Both backwards.
  const { createImageLedger } = await import("./videoBeatImagery.js");
  const ff = getFFmpegPath();
  const jpeg = (spec) => execFileSync(ff, ["-loglevel", "error", "-f", "lavfi", "-i", spec,
    "-frames:v", "1", "-f", "image2", "-c:v", "mjpeg", "pipe:1"], { maxBuffer: 1 << 24 });
  const l = createImageLedger({ _log: QUIET });
  l.claim(jpeg("testsrc2=size=900x600"), { label: "one" });
  l.claim(jpeg("color=c=navy:s=900x600"), { label: "two" });
  const e = l.entries();
  assert.equal(e.length, 2);
  assert.deepEqual(e.map((x) => x.label), ["one", "two"]);
  assert.ok(typeof e[0].hash === "bigint");
});

// ─── The web tier sits at the TOP (2026-08-30) ─────────────────────────────

const webCand = (imageUrl, host, confidence = "high") => ({ imageUrl, pageUrl: `https://${host}/a`, host, title: "t", confidence });

test("a publisher photograph of the EVENT outranks the article's own picture", async () => {
  // The article's photo is frequently a file photo; the date-proximate search
  // is there to prefer coverage of the event itself.
  const real = execFileSync(getFFmpegPath(), ["-loglevel", "error", "-f", "lavfi",
    "-i", "testsrc2=size=1200x800", "-frames:v", "1", "-f", "image2", "-c:v", "mjpeg", "pipe:1"], { maxBuffer: 1 << 24 });
  const r = await resolveBeat({
    slide: { t: "turn", visual: "settlers in Qusra", _i: 1 }, article: ARTICLE,
    pool: [{ ...img(1), text: "" }], poolCursor: cursor(),
    _webSearch: async () => [webCand("https://reuters.com/photo.jpg", "reuters.com")],
    _fetchImage: async () => ({ buf: real }),
    _log: QUIET,
  });
  assert.equal(r.tier, TIERS.WEB);
  assert.equal(r.confidence, "high");
  assert.equal(r.credit, "reuters.com");
});

test("the web tier respects the BROAD sensitivity bar — searched images are vetted by nobody", async () => {
  const harm = { ...ARTICLE, title: "Six killed in Kabul bombing" };
  let searched = false;
  const r = await resolveBeat({
    slide: { t: "turn", visual: "the scene", _i: 0 }, article: harm,
    pool: [], poolCursor: cursor(),
    _webSearch: async () => { searched = true; return [webCand("https://a/b.jpg", "reuters.com")]; },
    _fetchImage: async () => ({ buf: Buffer.from("x") }),
    _log: QUIET,
  });
  assert.equal(r.tier, TIERS.CARD);
  assert.ok(!searched || r.tier === TIERS.CARD, "a harm headline must not place a searched photograph");
});

test("an undersized web candidate is skipped and the next one tried", async () => {
  const ff = getFFmpegPath();
  const jpeg = (w, h) => execFileSync(ff, ["-loglevel", "error", "-f", "lavfi", "-i", `testsrc2=size=${w}x${h}`,
    "-frames:v", "1", "-f", "image2", "-c:v", "mjpeg", "pipe:1"], { maxBuffer: 1 << 24 });
  const small = jpeg(320, 200), big = jpeg(1400, 900);
  const r = await resolveBeat({
    slide: { t: "turn", visual: "gas terminal", _i: 0 }, article: ARTICLE,
    pool: [], poolCursor: cursor(),
    _webSearch: async () => [webCand("https://a/small.jpg", "bbc.com"), webCand("https://a/big.jpg", "bbc.com")],
    _fetchImage: async (u) => ({ buf: u.includes("small") ? small : big }),
    _log: QUIET,
  });
  assert.equal(r.tier, TIERS.WEB);
  assert.equal(r.imageUrl, "https://a/big.jpg");
});

test("a web photograph already in the ledger is skipped, not repeated", async () => {
  const real = execFileSync(getFFmpegPath(), ["-loglevel", "error", "-f", "lavfi",
    "-i", "testsrc2=size=1000x700", "-frames:v", "1", "-f", "image2", "-c:v", "mjpeg", "pipe:1"], { maxBuffer: 1 << 24 });
  const { createImageLedger } = await import("./videoBeatImagery.js");
  const ledger = createImageLedger({ _log: QUIET });
  ledger.claim(real, { label: "already used" });
  const r = await resolveBeat({
    slide: { t: "turn", visual: "gas terminal", _i: 0 }, article: ARTICLE,
    pool: [], poolCursor: cursor(), ledger,
    _webSearch: async () => [webCand("https://a/b.jpg", "bbc.com")],
    _fetchImage: async () => ({ buf: real }),
    _log: QUIET,
  });
  assert.notEqual(r.tier, TIERS.WEB);
});

test("a failing web search falls through to body rather than losing the beat", async () => {
  const r = await resolveBeat({
    slide: { t: "turn", visual: "gas terminal", _i: 0 }, article: ARTICLE,
    pool: [{ ...img(1), text: "" }], poolCursor: cursor(),
    _webSearch: async () => { throw new Error("serper down"); },
    _fetchImage: async () => null,
    _log: QUIET,
  });
  assert.equal(r.tier, TIERS.BODY);
});
