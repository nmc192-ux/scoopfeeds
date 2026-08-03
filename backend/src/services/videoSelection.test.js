/**
 * videoSelection.test.js — the blocking gates.
 *
 * Pure-function gates only; the DB-backed cooldowns are covered in
 * videoAutopost.test.js where a real schema exists. What matters here is that
 * each gate refuses the thing it names and does NOT refuse its neighbours —
 * a stock-commentary rule that also blocks "Fed holds rates" would quietly
 * remove finance as a subject.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { staticGate, tooSimilar, diversifyByPublisher, dominantCompany, _internals } from "./videoSelection.js";

const art = (over = {}) => ({ id: "a1", title: "T", description: "", category: "world", source_name: "Reuters", ...over });

// ─── Sport ──────────────────────────────────────────────────────────────────

test("sport is blocked by category", () => {
  for (const c of ["sports", "sport", "football", "nba"]) {
    const g = staticGate(art({ category: c }));
    assert.equal(g.ok, false, c);
    assert.equal(g.gate, "sport");
  }
});

test("a world story is not sport", () => {
  assert.equal(staticGate(art({ category: "world" })).ok, true);
});

// ─── Live blogs ─────────────────────────────────────────────────────────────

test("live blogs are blocked — rolling updates have no stable narrative", () => {
  for (const t of [
    "Ukraine war live: Zelensky addresses parliament",
    "Budget 2026 live updates",
    "Election night as it happened",
    "Middle East crisis — rolling coverage",
  ]) {
    const g = staticGate(art({ title: t }));
    assert.equal(g.ok, false, t);
    assert.equal(g.gate, "live-blog");
  }
});

test("an ordinary headline containing 'live' is NOT a live blog", () => {
  // The regex anchors on "live:" / "live updates" / "as it happened", not on
  // the word alone — otherwise "Live music venues face closure" would go.
  for (const t of [
    "Live music venues face closure after funding cut",
    "How long do queen bees live?",
    "Residents live without power for a third day",
  ]) {
    assert.equal(staticGate(art({ title: t })).ok, true, t);
  }
});

// ─── Individual stock commentary ────────────────────────────────────────────

test("individual stock commentary is blocked", () => {
  for (const t of [
    "Forget Nvidia: 3 AI stocks to buy before December",
    "Is Tesla stock a buy after the earnings miss?",
    "5 undervalued dividend stocks for 2026",
    "Analyst raises Apple price target to $310",
    "My top stock pick for the next decade",
  ]) {
    const g = staticGate(art({ title: t }));
    assert.equal(g.ok, false, t);
    assert.equal(g.gate, "stock-commentary");
  }
});

test("finance as a SUBJECT survives — the gate targets the genre, not the topic", () => {
  // If this ever starts failing, the rule has widened from "a security is
  // being recommended to the viewer" into "anything about markets", and the
  // channel loses economics coverage.
  for (const t of [
    "Fed holds rates steady as inflation cools",
    "Nvidia reports record quarterly revenue",
    "European stocks fall after the ECB decision",
    "What the bond selloff means for mortgages",
    "Tesla recalls 400,000 vehicles over a steering fault",
  ]) {
    assert.equal(staticGate(art({ title: t })).ok, true, t);
  }
});

test("the gate reads the description too, not only the title", () => {
  const g = staticGate(art({ title: "Markets wrap", description: "Here are 3 top stocks to buy now." }));
  assert.equal(g.ok, false);
  assert.equal(g.gate, "stock-commentary");
});

// ─── tooSimilar, recovered from 01638c7 ─────────────────────────────────────

const wordSet = (s) => new Set(_internals.norm(s).split(" ").filter(w => w.length > 4));

test("a near-identical headline under another masthead is caught", () => {
  const published = "Subsea cable faults traced to dragged anchors in shallow water";
  const candidate = "Dragged anchors traced as cause of subsea cable faults in shallow water";
  assert.equal(tooSimilar(candidate, [wordSet(published)]), true);
});

test("a genuinely different story is not caught", () => {
  const published = "Subsea cable faults traced to dragged anchors in shallow water";
  const candidate = "European Parliament adopts revised liability rules for high-risk systems";
  assert.equal(tooSimilar(candidate, [wordSet(published)]), false);
});

test("an empty or trivial headline is refused rather than passed", () => {
  assert.equal(tooSimilar("", [wordSet("anything at all here")]), true);
});

test("it is the SAME measure the source bundle used — recovered, not rewritten", () => {
  // A second, subtly different similarity measure is how the create-merge-split
  // treadmill started on the event graph. 60% content-word overlap, words > 4.
  const a = "the quick brown foxes jumped over the lazy sleeping hounds";
  assert.equal(tooSimilar(a, [wordSet(a)]), true);
  assert.equal(tooSimilar("completely unrelated vocabulary appearing nowhere", [wordSet(a)]), false);
});

// ─── Content-level rating language (the SoundHound miss) ────────────────────
//
// THE REGRESSION. "SoundHound AI Stock: Why Analysts Predict 100% Gains"
// passed every title pattern on 2026-08-03 while its beats were analyst price
// targets and buy ratings. Under a live loop that publishes investment
// promotion under the brand.
//
// The fix reads the BODY for rating vocabulary, which is far harder to
// paraphrase away than a headline formula — you cannot write about price
// targets without naming them. It needs BOTH halves: single-ticker focus in
// the title AND rating language in the body.

const withBody = (title, content) => art({ title, content, category: "business" });

test("THE REGRESSION: SoundHound AI Stock + analyst price targets is blocked", () => {
  const g = staticGate(withBody(
    "SoundHound AI Stock: Why Analysts Predict 100% Gains",
    "Analysts covering the stock raised their price target after the quarter.",
  ));
  assert.equal(g.ok, false);
  assert.equal(g.gate, "stock-commentary");
  assert.match(g.reason, /title focus/);
});

test("rating vocabulary is caught in several forms", () => {
  for (const [t, c] of [
    ["Is Palantir Stock Worth Holding?", "The consensus rating is hold with an average target of $32."],
    ["Rigetti Computing (NASDAQ: RGTI) climbs", "Wall Street analysts lifted price targets sharply."],
    ["Why AMD Shares Could Double", "The average analyst target implies 100% upside."],
    ["Coinbase Stock After the Print", "Two banks upgraded the stock to overweight."],
  ]) {
    const g = staticGate(withBody(t, c));
    assert.equal(g.ok, false, t);
    assert.equal(g.gate, "stock-commentary", t);
  }
});

test("finance as a SUBJECT still survives — the survival set is unchanged", () => {
  // DrJ's standing list, now with rating language deliberately in the BODY:
  // an earnings report or a recall that happens to quote an analyst is not a
  // stock tip, and the title-side ticker focus is what protects it.
  for (const [t, c] of [
    ["Fed holds rates steady as inflation cools", "Officials signalled patience."],
    ["Nvidia reports record quarterly revenue", "Several analysts raised their price target after the print."],
    ["Tesla recalls 400,000 vehicles over a steering fault", "One analyst cut their price target on the news."],
    ["European stocks fall after the ECB decision", "Analysts said the consensus rating across the index was unchanged."],
    ["What the bond selloff means for mortgages", "Rates moved sharply this week."],
  ]) {
    const g = staticGate(withBody(t, c));
    assert.equal(g.ok, true, `${t} — ${g.reason || ""}`);
  }
});

test("BOTH halves are required — ticker focus alone is a company story", () => {
  // This is what keeps the gate on the GENRE rather than on the subject. Same
  // company, same "Stock" in the title, no rating language: it is news.
  const g = staticGate(withBody(
    "SoundHound AI Stock jumps on a defence contract",
    "The company said the deal runs for five years and covers three sites.",
  ));
  assert.equal(g.ok, true, g.reason);
});

test("rating language alone, under a market-wide headline, is ordinary reporting", () => {
  const g = staticGate(withBody(
    "Analysts turn cautious on the tech rally",
    "Several price targets were cut across the sector this week.",
  ));
  assert.equal(g.ok, true, g.reason);
});

// ─── Publisher diversity at SELECTION ───────────────────────────────────────
//
// Length-first ordering handed the window to whoever writes longest: Yahoo
// Finance took 5 of 7 candidates, then 2 of 2. The publish-time cooldown
// cannot help — it refuses the second VIDEO, long after the cycle has spent
// every attempt inside one masthead and found nothing.

const src = (source_name, id) => ({ id, source_name });

test("no more than 2 candidates from one publisher", () => {
  const { kept, dropped } = diversifyByPublisher([
    src("Yahoo Finance", "y1"), src("Yahoo Finance", "y2"), src("Yahoo Finance", "y3"),
    src("Reuters", "r1"), src("Yahoo Finance", "y4"), src("BBC News", "b1"),
  ]);
  // Round-robin: one per publisher before anyone gets a second.
  assert.deepEqual(kept.map(a => a.id), ["y1", "r1", "b1", "y2"]);
  assert.deepEqual(dropped.map(a => a.id), ["y3", "y4"]);
});

test("ORDER is preserved — substance still decides which two survive", () => {
  // The cap drops the surplus; it never reshuffles. The length-first ordering
  // upstream is what picks WHICH two of a publisher's articles are kept.
  const { kept } = diversifyByPublisher([
    src("Yahoo Finance", "best"), src("Reuters", "r1"), src("Yahoo Finance", "second"),
    src("Yahoo Finance", "third"),
  ]);
  assert.deepEqual(kept.map(a => a.id), ["best", "r1", "second"]);
});

test("the cap is per publisher, not global", () => {
  const { kept, dropped } = diversifyByPublisher([
    src("A", "a1"), src("B", "b1"), src("C", "c1"), src("D", "d1"), src("E", "e1"),
  ]);
  assert.equal(kept.length, 5);
  assert.equal(dropped.length, 0);
});

test("publisher matching is case-insensitive and survives a missing name", () => {
  const { kept } = diversifyByPublisher([
    src("Yahoo Finance", "y1"), src("YAHOO FINANCE", "y2"), src("yahoo finance", "y3"),
    src(null, "n1"), src(undefined, "n2"), src("", "n3"),
  ]);
  assert.deepEqual(kept.map(a => a.id), ["y1", "n1", "y2", "n2"],
    "case variants are one publisher, and unnamed sources are capped together");
});


test("ROUND-ROBIN: one masthead cannot own the front of the queue", () => {
  // Capping the COUNT was not enough. Both Yahoo Finance survivors were still
  // attempts 1 and 2, so a cycle that found its video early never reached BBC,
  // The Hindu or ABC at all — the cap decided who was in the room, not who
  // spoke first.
  const { kept } = diversifyByPublisher([
    src("Yahoo Finance", "y1"), src("Yahoo Finance", "y2"), src("Yahoo Finance", "y3"),
    src("BBC News", "b1"), src("The Hindu", "h1"), src("BBC News", "b2"),
  ]);
  assert.deepEqual(kept.map(a => a.id), ["y1", "b1", "h1", "y2", "b2"]);
  const firstThree = kept.slice(0, 3).map(a => a.source_name);
  assert.equal(new Set(firstThree).size, 3, "the first three attempts must be three publishers");
});

test("the highest-ranked article overall still goes FIRST", () => {
  // Length-first ordering still decides which articles survive per publisher
  // AND which single article opens the cycle. Round-robin only governs who
  // follows.
  const { kept } = diversifyByPublisher([
    src("The Hindu", "densest"), src("Yahoo Finance", "y1"), src("The Hindu", "h2"),
  ]);
  assert.equal(kept[0].id, "densest");
});

// ─── Body-side ticker focus (the second SoundHound miss) ────────────────────

test("an exchange ticker anywhere in the BODY establishes focus", () => {
  const g = staticGate(withBody(
    "Why This AI Company Could Soar",
    "SoundHound AI (NASDAQ: SOUN) reported growth. Every analyst covering the company rates it a buy.",
  ));
  assert.equal(g.ok, false);
  assert.match(g.reason, /exchange-ticker focus/);
});

test("one company dominating the body establishes WEAK focus, needing 2 signals", () => {
  // The headline names no company at all. Title-only was always going to lose
  // this race — a headline is the most re-skinnable surface in an article.
  const g = staticGate(withBody(
    "A Quiet Winner In Voice AI",
    "SoundHound has expanded. SoundHound stock rose. Analysts covering SoundHound raised their " +
    "price target. SoundHound now carries a consensus rating of buy and SoundHound shares trade " +
    "below the average target.",
  ));
  assert.equal(g.ok, false);
  assert.match(g.reason, /body-dominant focus/);
});

test("the WEAK path needs TWO signals — this is what protects earnings coverage", () => {
  // An earnings story is dominated by its company and mentions a price target
  // once in passing. A rating note is BUILT out of rating language. Without the
  // asymmetry the whole survival set would fall to the body-dominance rule.
  for (const [t, c] of [
    ["Nvidia reports record quarterly revenue",
     "Nvidia said revenue rose. Nvidia data-centre sales doubled. Nvidia expects growth. " +
     "Nvidia shipped more units. Several analysts raised their price target after the print."],
    ["Tesla recalls 400,000 vehicles over a steering fault",
     "Tesla said the recall covers three model years. Tesla will replace the part. Tesla " +
     "notified regulators. Tesla shares fell. One analyst cut their price target."],
  ]) {
    const g = staticGate(withBody(t, c));
    assert.equal(g.ok, true, `${t} — ${g.reason || ""}`);
  }
});

// ─── The real evasion, as a permanent fixture ───────────────────────────────
//
// The article the gate passed twice on 2026-08-03, verbatim:
//
//   "SoundHound AI's Next Earnings Report on Aug. 5 Could Send the Stock
//    Soaring. Here's Why."
//   Yahoo Finance — finance.yahoo.com/markets/stocks/articles/
//   soundhound-ais-next-earnings-report-214501723.html
//
// WHY IT EVADED: the company is named at the START of the headline and referred
// to as "the Stock" later, so nothing is ADJACENT. Every "<Company> stock"
// pattern needs the two touching, and this headline never puts them together.
// DrJ called this exactly.

const SOUNDHOUND_TITLE =
  "SoundHound AI’s Next Earnings Report on Aug. 5 Could Send the Stock Soaring. Here’s Why.";

// Realistic Yahoo Finance body: analyst ratings, a price target, SoundHound
// dominant. No exchange ticker — these pieces usually omit it, which is why the
// strongest signal is unavailable here.
const SOUNDHOUND_BODY = [
  "SoundHound AI reports second-quarter results on Aug. 5, and the setup looks unusually favourable.",
  "SoundHound has beaten revenue expectations in three of the last four quarters, and management raised full-year guidance in May.",
  "Wall Street is broadly constructive. Every analyst covering the company rates it a buy, and the average price target implies roughly 40% upside from where SoundHound shares trade today.",
  "One firm upgraded the stock to overweight last month, citing the automotive pipeline.",
  "SoundHound ended the quarter with a record backlog. If SoundHound converts even part of that into recognised revenue, the consensus rating is unlikely to move lower.",
].join("\n\n");

const soundhound = () => art({
  title: SOUNDHOUND_TITLE, content: SOUNDHOUND_BODY,
  source_name: "Yahoo Finance", category: "business",
  url: "https://finance.yahoo.com/markets/stocks/articles/soundhound-ais-next-earnings-report-214501723.html",
});

test("THE REAL EVASION is blocked, and the reason names the signal", () => {
  const g = staticGate(soundhound());
  assert.equal(g.ok, false, "the article that evaded the gate twice must not evade it again");
  assert.equal(g.gate, "stock-commentary");
  assert.match(g.reason, /title focus \("the Stock"\)/,
    `the reason must say WHICH signal caught it — got: ${g.reason}`);
  assert.match(g.reason, /rating signal/);
});

test("the ADJACENT pattern genuinely cannot see this headline", () => {
  // Pinned so nobody later "simplifies" THE_STOCK_RE away believing the older
  // pattern already covers it. It does not, and this is the proof.
  assert.equal(_internals.TICKER_FOCUS_RE.test(SOUNDHOUND_TITLE), false,
    "if this ever passes, the adjacency pattern changed and THE_STOCK_RE may look redundant — it is not");
  assert.equal(_internals.titleTickerFocus(SOUNDHOUND_TITLE), "the Stock");
});

test("body dominance catches it TOO — two independent signals, not one", () => {
  // Defence in depth: the title rule is exact, the body rule is statistical,
  // and each alone is enough. A rewrite of the headline loses the first; a
  // shorter piece with fewer mentions loses the second.
  assert.ok(dominantCompany(SOUNDHOUND_BODY), "SoundHound must dominate the body");
  const headlineRewritten = { ...soundhound(), title: "An Earnings Setup Worth Watching Next Week" };
  const g = staticGate(headlineRewritten);
  assert.equal(g.ok, false, "a re-skinned headline must still be caught by the body");
  assert.match(g.reason, /body-dominant focus/);
});

test("\"the stock market\" is NOT single-security focus", () => {
  // The exclusion that keeps the new title rule from swallowing market
  // coverage. Without it, "What the stock market decline means for pensions"
  // plus any analyst quote would be blocked.
  const g = staticGate(withBody(
    "What the stock market decline means for pensions",
    "The Wall Street selloff continued. Analysts cut price targets across the board.",
  ));
  assert.equal(g.ok, true, g.reason);
  assert.equal(_internals.THE_STOCK_RE.test("what the stock market decline means"), false);
});
