/**
 * radioRules.test.js — the D1 gate for ScoopFeeds Radio. Fixture titles for each
 * D1 category must be DROPPED; neutral stories pass; the judge fails closed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { radioRulesVerdict, judgeItems, hasPakistanSignal } from "./radioRules.js";

const A = (title, source = "BBC World", category = "international", description = "") =>
  ({ id: title.slice(0, 20), title, source_name: source, category, description });

const DROPS = [
  ["d1:category (imported isVideoEligible)", A("Budget session opens in Islamabad", "Dawn News", "pakistan"), /^d1:category$/],
  ["d1:term (imported isVideoEligible)", A("National Assembly passes amendment after late-night session", "Reuters World", "politics"), /^d1:term$/],
  ["named politician", A("Imran Khan's bail hearing adjourned again", "Al Jazeera"), /^radio:pk-politics-names$/],
  ["named general", A("Asim Munir meets Gulf leaders on investment", "Arab News"), /^radio:pk-politics-names$/],
  ["named party (D1 term list catches it first)", A("PTI supporters gather outside court", "BBC World"), /^(d1:term|radio:pk-politics-names)$/],
  ["Indian outlet about Pakistan (neutral wording)", A("Pakistan announces new cricket coach", "The Hindu", "sports"), /^radio:indian-outlet-pk$/],
  ["Indian outlet about Pakistan (another outlet name)", A("Karachi port traffic rises in September", "Times of India"), /^radio:indian-outlet-pk$/],
  ["critical of Pakistan, any outlet", A("Pakistan accused of harbouring militants near border", "BBC World"), /^radio:critical-of-pk$/],
  ["critical of the army", A("Rights groups condemn Pakistani army over disappearances", "The Guardian"), /^radio:critical-of-pk$/],
  ["critical: economy framing", A("Pakistan's debt trap deepens as IMF talks stall", "Financial Times", "business"), /^radio:critical-of-pk$/],
];

for (const [label, article, rule] of DROPS) {
  test(`D1 DROPS: ${label} — "${article.title}"`, () => {
    const v = radioRulesVerdict(article);
    assert.equal(v.allowed, false, `expected a drop, got ${JSON.stringify(v)}`);
    assert.match(v.rule, rule);
  });
}

const KEEPS = [
  A("Fed holds rates steady as inflation cools", "CNBC", "business"),
  A("Magnitude 6.2 earthquake shakes northern Pakistan, no casualties reported", "Al Jazeera"),   // neutral, non-Indian
  A("Indian Space Research Organisation launches weather satellite", "The Hindu", "science"),     // Indian outlet, no Pakistan
  A("European Commissioner sets out AI rules", "Politico Europe", "international"),               // "commissioner " guarded by global category
];
for (const article of KEEPS) {
  test(`rules ALLOW: "${article.title}" (${article.source_name})`, () => {
    assert.equal(radioRulesVerdict(article).allowed, true);
  });
}

test("Pakistan signal: present for Pakistan mentions, absent otherwise", () => {
  assert.equal(hasPakistanSignal(A("Lahore smog closes schools")), true);
  assert.equal(hasPakistanSignal(A("Tokyo smog closes schools")), false);
});

const pkItem = A("Pakistan and China sign rail agreement", "Reuters World");
const plain = A("Tokyo hosts robotics fair", "NHK World");

test("JUDGE: an error drops every Pakistan-signal item (fail closed); non-PK items are not judged", async () => {
  const v = await judgeItems([pkItem, plain], async () => { throw new Error("429 quota"); });
  assert.equal(v.get(pkItem.id).allowed, false);
  assert.match(v.get(pkItem.id).reason, /judge error/);
  assert.equal(v.has(plain.id), false);
});

test("JUDGE: a null / malformed answer drops (fail closed)", async () => {
  for (const ans of [null, {}, { verdicts: "keep" }]) {
    const v = await judgeItems([pkItem], async () => ans);
    assert.equal(v.get(pkItem.id).allowed, false, `answer ${JSON.stringify(ans)} should drop`);
  }
});

test("JUDGE: unsure, missing or non-'keep' verdicts drop; only an explicit keep airs", async () => {
  const other = A("Pakistan wins hockey bronze", "BBC Sport", "sports");
  const v = await judgeItems([pkItem, other], async () => ({ verdicts: [{ id: pkItem.id, verdict: "unsure" }] }));
  assert.equal(v.get(pkItem.id).allowed, false);
  assert.equal(v.get(other.id).allowed, false, "an item the judge did not answer for must drop");
  const ok = await judgeItems([pkItem], async () => ({ verdicts: [{ id: pkItem.id, verdict: "keep", reason: "neutral trade news" }] }));
  assert.equal(ok.get(pkItem.id).allowed, true);
});

// ─── hard news only ─────────────────────────────────────────────────────────
import { softNewsVerdict, isRadioSensitive } from "./radioRules.js";

test("SOFT news is dropped, each by its own named rule", () => {
  const cases = [
    ["I only bought one thing on Amazon this year and it was worth it", "radio:soft-first-person"],
    ["Prime Day 2026: the best early deals on laptops", "radio:soft-shopping"],
    ["Smart TV on sale for half price at Walmart", "radio:soft-shopping"],
    ["5 things to know before you buy a house", "radio:soft-listicle"],
    ["10 ways to save on groceries", "radio:soft-listicle"],
    ["How a new tax rule changes what you owe", "radio:soft-howto"],
    ["How to fix a leaky faucet", "radio:soft-howto"],
    ["Samsung Galaxy S27 review: a small step forward", "radio:soft-review"],
  ];
  for (const [title, rule] of cases) assert.equal(softNewsVerdict({ title }).rule, rule, title);
});

test("hard news that shares a soft word is kept", () => {
  for (const title of [
    "Supreme Court to review ruling on voting maps",
    "Pentagon review of the strike finds no violations",
    "Iran bans fuel exports as sanctions bite",
    "Senate passes five-year farm bill",
  ]) assert.equal(softNewsVerdict({ title }).allowed, true, title);
});

test("SENSITIVE: the exact headlines that must never sit under music", () => {
  for (const t of [
    "Suicide is up among Black Americans",
    "Teen self-harm cases rise sharply, hospitals report",
    "Overdose deaths fall for the first time in years",
    "Fatal overdoses climb in three states",
    "Sexual abuse claims widen at youth program",
    "Child abuse investigators open new probe",
    "Mass shooting at a shopping centre leaves several hurt",
    "Terror attack foiled in European capital, police say",
  ]) assert.equal(isRadioSensitive(t), true, t);
  for (const t of ["Fed holds interest rates steady as inflation cools", "NASA delays crewed moon lander test to 2027"]) assert.equal(isRadioSensitive(t), false, t);
  assert.equal(isRadioSensitive(""), true, "empty fails closed");
});

test("LIVE LEAKS 10 Oct 2026: opinion and roundups are dropped by rule; executions are sensitive", () => {
  const opinion = [
    "Voters can prevent another Jan. 6 by defeating these Republicans, an opinion piece argues",
    "Opinion | Voters Can Prevent Another Jan. 6",
    "Op-Ed: The Fed is moving too slowly",
    "Editorial: A budget that ducks the hard choices",
    "Columnist argues the AI boom is a bubble",
  ];
  for (const title of opinion) {
    const v = softNewsVerdict({ title });
    assert.equal(v.allowed, false, title);
    assert.equal(v.rule, "radio:soft-opinion", title);
  }
  for (const title of ["9to5Mac Daily: October 8, 2026 — iPad mini rumors, iCloud+", "The Daily podcast: inside the shutdown", "Live updates: Hurricane makes landfall"]) {
    assert.equal(softNewsVerdict({ title }).rule, "radio:soft-roundup", title);
  }
  for (const title of [
    "Vance says he will not watch a live-streamed execution under a Hegseth plan",
    "Texas carries out execution by lethal injection",
    "Man on death row granted last-minute stay",
  ]) assert.equal(isRadioSensitive(title), true, title);
  // Hard news that shares a word stays.
  for (const title of ["Firm improves trade execution speed", "Executive order on tariffs signed", "Analysts expect the Fed to hold rates", "Opinion polls show a tight Senate race"]) {
    assert.equal(softNewsVerdict({ title }).allowed, true, title);
  }
  for (const title of ["Firm improves trade execution speed", "Executive order on tariffs signed"]) {
    assert.equal(isRadioSensitive(title), false, title);
  }
});
