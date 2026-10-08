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

test("fitHeadline caps at 90 characters on a word boundary", () => {
  const long = "The quick brown fox jumps over the lazy dog ".repeat(4).trim();
  const h = fitHeadline(long);
  assert.ok(h.length <= 90, `${h.length}`);
  assert.ok(h.endsWith("…"));
  assert.equal(fitHeadline("Short headline"), "Short headline");
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
