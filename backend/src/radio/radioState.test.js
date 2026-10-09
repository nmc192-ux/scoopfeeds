/**
 * radioState.test.js — the state builder end to end on a real seeded test DB:
 * screen keys, sample:false, no markets/weather/key, drops logged to radio_dropped,
 * judge error fails closed, LLM wording failure falls back, migration 039 is
 * idempotent, and the state file is written atomically (a concurrent reader never
 * sees a partial file).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { makeTestDb } from "../testing/testDb.js";
import * as m039 from "../db/migrations/039_radio_dropped.js";
import { buildRadioState, writeJsonAtomic, fitHeadline, logDrop, pruneDrops, DROP_RETENTION_MS } from "./radioState.js";

const NOW = Date.UTC(2026, 9, 8, 15, 0, 0);
let seq = 0;
function seed(db, rows) {
  const ins = db.prepare(`INSERT INTO articles (id, title, description, url, source_name, category, credibility, is_duplicate, fetched_at, published_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`);
  for (const r of rows) {
    const id = `t${++seq}`;
    ins.run(id, r.title, r.description || "", `https://example.com/${id}`, r.source, r.category || "international",
      r.credibility ?? 8, NOW - (r.ago ?? 10) * 60_000, NOW - (r.ago ?? 10) * 60_000);
  }
}

const quake = "Magnitude 7.1 earthquake strikes off Japan coast, tsunami warning issued";
const ROWS = [
  ...["NPR News", "BBC News", "Al Jazeera"].map((source) => ({ title: quake, source })),
  { title: "Fed holds interest rates steady as inflation cools", source: "CNBC", category: "business" },
  { title: "EU agrees sweeping new rules for AI chatbots", source: "Politico Europe", category: "politics" },
  { title: "WHO approves malaria vaccine for wider use in Africa", source: "WHO News", category: "health" },
  { title: "NASA delays crewed moon lander test to 2027", source: "NASA News", category: "science" },
  { title: "Apple unveils cheaper laptop line for students", source: "The Verge", category: "tech" },
  { title: "Imran Khan's bail hearing adjourned again", source: "Al Jazeera" },                              // rules drop
  { title: "Pakistan and China sign new rail agreement in Beijing", source: "BBC World" },                   // judge decides
  { title: "Old programme block", source: "CNBC", category: "business", credibility: 3 },                     // low credibility, never a candidate
];

test("migration 039 is idempotent and creates radio_dropped", () => {
  const { db, cleanup } = makeTestDb({ prefix: "radio-mig-" });
  m039.up(db); m039.up(db);                                            // bootstrap already ran it once
  const cols = db.prepare(`PRAGMA table_info(radio_dropped)`).all().map((c) => c.name);
  for (const c of ["id", "article_id", "event_id", "title", "source", "rule", "reason", "created_at"]) assert.ok(cols.includes(c), c);
  cleanup();
});

test("BUILD: screen keys, sample:false, caps, attribution — and no market/weather keys in R2", async () => {
  const { db, cleanup } = makeTestDb({ prefix: "radio-build-" });
  seed(db, ROWS);
  const { state, stats } = await buildRadioState({
    db, now: NOW,
    gateLlm: async (p) => ({ verdicts: [...p.matchAll(/id=(\S+)/g)].map((m) => ({ id: m[1], verdict: "keep" })) }),
    wordLlm: async () => null,                                         // forces the cleanHeadline fallback
  });
  assert.equal(state.sample, false);
  assert.equal(state.updatedAt, NOW);
  for (const k of ["markets", "weather", "key", "weatherLine"]) assert.equal(k in state, false, `${k} must be omitted in R2`);
  assert.equal(state.headline, quake);                                 // three outlets, US-weighted: the lead
  assert.ok(state.headline.length <= 90);
  assert.ok(state.alsoThisHour.length <= 5 && state.alsoThisHour.every((x) => x.h && /^Reported by /.test(x.src)));
  assert.ok(state.music.every((x) => x.cat && x.h && /^Reported by /.test(x.src)));
  assert.match(stats.wording, /^fallback/);
  const text = JSON.stringify(state);
  assert.equal(/Imran Khan/.test(text), false, "a D1 story aired");
  assert.equal(/Old programme block/.test(text), false, "a low-credibility item aired");
  const dropped = db.prepare(`SELECT rule, title FROM radio_dropped`).all();
  assert.ok(dropped.some((d) => d.rule === "radio:pk-politics-names" && /Imran Khan/.test(d.title)), "rules drop not logged");
  cleanup();
});

test("JUDGE ERROR FAILS CLOSED: a Pakistan story picked for air is dropped and logged when the judge throws", async () => {
  const { db, cleanup } = makeTestDb({ prefix: "radio-judge-" });
  seed(db, ROWS);
  const { state } = await buildRadioState({ db, now: NOW, gateLlm: async () => { throw new Error("503 upstream"); }, wordLlm: async () => null });
  assert.equal(/Pakistan and China/.test(JSON.stringify(state)), false, "an unjudged Pakistan story aired");
  const rows = db.prepare(`SELECT rule, reason FROM radio_dropped WHERE title LIKE 'Pakistan and China%'`).all();
  assert.ok(rows.some((r) => r.rule === "radio:judge" && /judge error/.test(r.reason)), JSON.stringify(rows));
  assert.ok(state.headline, "non-Pakistan stories still air when the judge is down");
  cleanup();
});

test("drops are logged once per (article, rule) per day and pruned after 14 days", () => {
  const { db, cleanup } = makeTestDb({ prefix: "radio-drop-" });
  const row = { article_id: "x1", title: "t", source: "s", rule: "radio:judge", reason: "r" };
  assert.equal(logDrop(db, row, NOW), true);
  assert.equal(logDrop(db, row, NOW + 60_000), false);
  assert.equal(logDrop(db, row, NOW + 25 * 3600_000), true);
  assert.equal(pruneDrops(db, NOW + DROP_RETENTION_MS + 1), 1);
  cleanup();
});

test("fitHeadline never truncates mid-sentence and never ends in an ellipsis", () => {
  const long = "The quick brown fox jumps over the lazy dog ".repeat(4).trim();
  assert.equal(fitHeadline(long), "", "no clause boundary → no line, not a cut");
  assert.equal(fitHeadline("Short headline"), "Short headline");
  // over-long, but has a clause boundary that leaves a whole headline
  const clause = "Senate passes the annual defense spending bill after weeks of debate, sending it to the president's desk";
  assert.ok(clause.length > 90);
  assert.equal(fitHeadline(clause), "Senate passes the annual defense spending bill after weeks of debate");
  for (const h of [fitHeadline(clause), fitHeadline("Wrapped up…")]) assert.ok(!h.endsWith("…"));
});

test("LLM-worded lines over the limit are rejected, not cut", async () => {
  const { db, cleanup } = makeTestDb({ prefix: "radio-llm-long-" });
  seed(db, ROWS);
  const { state } = await buildRadioState({
    db, now: NOW,
    gateLlm: async (p) => ({ verdicts: [...p.matchAll(/id=(\S+)/g)].map((m) => ({ id: m[1], verdict: "keep" })) }),
    wordLlm: async (p) => ({ items: [...p.matchAll(/id=(\S+)/g)].map((m) => ({ id: m[1], h: "A reworded headline that goes on and on far past the ninety character limit without ever ending " })) }),
  });
  for (const h of [state.headline, ...state.alsoThisHour.map((x) => x.h), ...state.music.map((x) => x.h)]) {
    assert.ok(h.length <= 90 && !h.endsWith("…") && !h.startsWith("A reworded"), h);
  }
  cleanup();
});

test("a story whose every title is too long to fit whole does not air", async () => {
  const { db, cleanup } = makeTestDb({ prefix: "radio-nofit-" });
  const longTitle = "Officials in several countries continue to discuss a wide ranging set of proposals on regional trade without agreement";
  seed(db, [{ title: longTitle, source: "BBC News" }, ...ROWS]);
  const { state, stats } = await buildRadioState({ db, now: NOW, gateLlm: async () => ({ verdicts: [] }), wordLlm: async () => null });
  const all = [state.headline, ...state.alsoThisHour.map((x) => x.h), ...state.music.map((x) => x.h)];
  assert.ok(!all.some((h) => h.startsWith("Officials in several")));
  assert.equal(stats.drops["radio:no-fitting-headline"], 1);
  cleanup();
});

test("SENSITIVE topics reach News at most — never the music rotator", async () => {
  const { db, cleanup } = makeTestDb({ prefix: "radio-sens-" });
  seed(db, [
    { title: "Suicide is up among Black Americans", source: "NPR News", category: "health" },
    { title: "Fed holds interest rates steady as inflation cools", source: "CNBC", category: "business" },
    { title: "EU agrees sweeping new rules for AI chatbots", source: "Politico Europe", category: "politics" },
    { title: "WHO approves malaria vaccine for wider use in Africa", source: "WHO News", category: "health" },
    { title: "NASA delays crewed moon lander test to 2027", source: "NASA News", category: "science" },
    { title: "Apple unveils cheaper laptop line for students", source: "The Verge", category: "tech" },
    { title: "Mayor opens new bridge across the river", source: "Reuters", category: "international" },
  ]);
  const { state } = await buildRadioState({ db, now: NOW, gateLlm: async () => ({ verdicts: [] }), wordLlm: async () => null });
  assert.ok(!state.music.some((m) => /suicide/i.test(m.h)), "suicide headline in music");
  cleanup();
});

test("ATOMIC WRITE: a reader looping on the file never sees a partial or unparsable file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radio-atomic-"));
  const file = path.join(dir, "state.json");
  writeJsonAtomic(file, { v: 0, pad: "x".repeat(200_000) });
  const reader = new Worker(`
    const { parentPort, workerData } = require("node:worker_threads");
    const fs = require("node:fs");
    let reads = 0, bad = 0, stop = false;
    parentPort.on("message", () => { stop = true; });
    (function loop() {
      for (let i = 0; i < 200 && !stop; i++) {
        try { JSON.parse(fs.readFileSync(workerData, "utf8")); reads++; } catch { bad++; }
      }
      if (stop) parentPort.postMessage({ reads, bad }); else setImmediate(loop);
    })();
  `, { eval: true, workerData: file });
  for (let v = 1; v <= 400; v++) writeJsonAtomic(file, { v, pad: "y".repeat(100_000 + (v % 7) * 30_000) });
  await new Promise((r) => setTimeout(r, 50));
  const result = await new Promise((resolve) => { reader.once("message", resolve); reader.postMessage("stop"); });
  await reader.terminate();
  assert.ok(result.reads > 0, "reader never read");
  assert.equal(result.bad, 0, `reader saw ${result.bad} partial/unparsable reads out of ${result.reads + result.bad}`);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith(".tmp")), [], "temp files left behind");
});

// The screen itself (sample:false never shows the template's sample numbers) is covered by
// frontend/tests/e2e/radio-screen.spec.js (Playwright), which loads the template from disk.

// Tonight's two live leaks (10 Oct 2026), both of which reached the music rotator.
const LEAK_OPINION = "Voters can prevent another Jan. 6 by defeating these Republicans, an opinion piece argues";
const LEAK_EXECUTION = "Vance says he will not watch a live-streamed execution under a Hegseth plan";
const keepAll = async (p) => ({ verdicts: [...p.matchAll(/id=(\S+)/g)].map((m) => ({ id: m[1], verdict: "keep" })) });
const HARD = [
  { title: "Senate passes stopgap bill to avert shutdown", source: "AP News", category: "politics" },
  { title: "Oil prices climb as supply talks stall", source: "CNBC", category: "business" },
  { title: "WHO approves malaria vaccine for wider use in Africa", source: "WHO News", category: "health" },
  { title: "NASA delays crewed moon lander test to 2027", source: "NASA News", category: "science" },
  { title: "EU agrees sweeping new rules for AI chatbots", source: "Politico Europe", category: "tech" },
  { title: "Storm system brings heavy rain across the Gulf Coast", source: "Reuters", category: "international" },
];
/** A headline call that answers every id: verdict from `judge(title)`, h = title. */
const answering = (judge) => async (p) => ({
  items: [...p.matchAll(/id=(\S+) \| (.*)/g)].map(([, id, t]) => ({ id, h: t.slice(0, 90), opinion: false, soft: false, sensitive: false, ...judge(t) })),
});

test("LIVE LEAKS 10 Oct 2026: neither leaked headline can reach music — rules floor, even if Claude calls them safe", async () => {
  const { db, cleanup } = makeTestDb({ prefix: "radio-leak-" });
  seed(db, [...HARD, { title: LEAK_OPINION, source: "NY Times", category: "politics" }, { title: LEAK_EXECUTION, source: "The Hill", category: "politics" }]);
  // Worst case: Claude says both are fine. The keyword floor must still hold.
  const { state, stats } = await buildRadioState({ db, now: NOW, gateLlm: keepAll, wordLlm: answering(() => ({})) });
  const text = JSON.stringify(state);
  assert.equal(text.includes("an opinion piece argues"), false, "the opinion leak aired at all");
  assert.equal(state.music.some((m) => /execution/i.test(m.h)), false, "the execution leak reached music");
  assert.ok(stats.drops["radio:soft-opinion"] >= 1, "opinion floor did not log a drop");
  assert.ok(state.music.length > 0, "music emptied although every story had a verdict");
  cleanup();
});

test("CLAUDE VERDICT ADDS to the rules: opinion/soft are dropped, sensitive is raised", async () => {
  const { db, cleanup } = makeTestDb({ prefix: "radio-verdict-" });
  seed(db, [...HARD,
    { title: "Lawmakers trade blame as the deadline nears and voters lose patience", source: "The Hill", category: "politics" },
    { title: "Governor signs order on prison policy after court ruling", source: "Reuters", category: "politics" },
  ]);
  const { state, stats } = await buildRadioState({
    db, now: NOW, gateLlm: keepAll,
    wordLlm: answering((t) => ({ opinion: /voters lose patience/.test(t), sensitive: /prison/.test(t) })),
  });
  assert.equal(/voters lose patience/.test(JSON.stringify(state)), false, "a Claude-opinion item aired");
  assert.equal(state.music.some((m) => /prison/.test(m.h)), false, "a Claude-sensitive item reached music");
  assert.match(stats.wording, /^llm:/);
  assert.ok(db.prepare(`SELECT 1 FROM radio_dropped WHERE rule = 'radio:llm-opinion'`).get(), "verdict drop not logged");
  cleanup();
});

test("FAIL SAFE: no verdict means sensitive — a failed, null, malformed or partial headline call never lets music through", async () => {
  const cases = {
    throws: async () => { throw new Error("529 overloaded"); },
    null: async () => null,
    malformed: async () => ({ nope: true }),
    "no flags": async (p) => ({ items: [...p.matchAll(/id=(\S+) \| (.*)/g)].map(([, id, t]) => ({ id, h: t.slice(0, 90) })) }),
    "string flags": async (p) => ({ items: [...p.matchAll(/id=(\S+)/g)].map((m) => ({ id: m[1], opinion: "false", soft: "false", sensitive: "false" })) }),
  };
  for (const [name, wordLlm] of Object.entries(cases)) {
    const { db, cleanup } = makeTestDb({ prefix: "radio-failsafe-" });
    seed(db, HARD);
    const { state, stats } = await buildRadioState({ db, now: NOW, gateLlm: keepAll, wordLlm });
    assert.equal(state.music.length, 0, `${name}: music aired without a verdict`);
    assert.ok(state.headline, `${name}: news must still air on the cleaned titles`);
    assert.ok(stats.noVerdict > 0, `${name}: noVerdict not reported`);
    cleanup();
  }
  // Partial answer: only the stories WITH a verdict may reach music.
  const { db, cleanup } = makeTestDb({ prefix: "radio-partial-" });
  seed(db, HARD);
  const onlyOil = async (p) => ({ items: [...p.matchAll(/id=(\S+) \| (.*)/g)].filter(([, , t]) => /Oil/.test(t)).map(([, id, t]) => ({ id, h: t, opinion: false, soft: false, sensitive: false })) });
  const { state } = await buildRadioState({ db, now: NOW, gateLlm: keepAll, wordLlm: onlyOil });
  assert.ok(state.music.every((m) => /Oil/.test(m.h)), "a story without a verdict reached music");
  cleanup();
});

test("the headline call is logged under task radio-headline", async () => {
  const src = fs.readFileSync(new URL("./radioState.js", import.meta.url), "utf8");
  assert.match(src, /callJson\(p, \{ task: "radio-headline"/);
  assert.equal(/radio-screen/.test(src), false, "a separate radio-screen task crept back in");
});
