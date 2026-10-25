/**
 * #250 — "What we know" generator, validation, ledger and API field.
 *
 * Fixtures on a makeTestDb() temp DB, with the REAL dossierCoherence and
 * reader-eligibility paths (entity_idf left empty → the shared measure runs
 * unweighted, the documented degrade):
 *   - "ok" event: 4 outlets, every member carries the same three keys → coherent.
 *   - "low" event: 4 outlets, every member carries only its own keys → incoherent.
 *   - "null" event: 4 outlets, no entity keys at all → unmeasured.
 * The LLM is stubbed by injection (the generator's `llm` option), so nothing
 * here touches the network or the daily budget.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { makeTestDb } from "../../testing/testDb.js";
import { logger } from "../../services/logger.js";
import {
  generateForEvent, runWhatWeKnow, validate, buildBundle, whatWeKnowForApi,
  ledgerDecision, REFRESH_AFTER_MS, DISCLOSURE,
} from "./whatWeKnow.js";
import { dossierCoherence } from "../intelligence/eventCoherence.js";

const HOUR = 3600e3;
const NOW = Date.UTC(2026, 9, 25, 12);

function seed(db, eventId, { title = `Story ${eventId}`, keys = "shared", outlets = 4, perOutlet = 1, desc } = {}) {
  const insArt = db.prepare(`INSERT INTO articles (id, title, description, url, source_name, category, published_at, fetched_at) VALUES (?,?,?,?,?,?,?,?)`);
  const insEnt = db.prepare(`INSERT OR IGNORE INTO article_entities (article_id, surface, surface_norm, qid, entity_type, label, created_at) VALUES (?,?,?,?,?,?,?)`);
  db.prepare(`INSERT INTO events (id, slug, cluster_id, title, category, status, started_at, last_activity_at, meta, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(eventId, `${eventId}-slug`, null, title, "world", "active", NOW - 2 * HOUR, NOW - HOUR, "{}", NOW - 2 * HOUR, NOW - HOUR);
  const link = db.prepare(`INSERT INTO event_articles (event_id, article_id, relevance, added_at) VALUES (?,?,1.0,?)`);
  const ids = [];
  let k = 0;
  for (let o = 0; o < outlets; o++) {
    for (let p = 0; p < perOutlet; p++) {
      const id = `${eventId}-a${k++}`;
      insArt.run(id, `Port strike enters day 3 in ${eventId} ${id}`, desc ?? "Workers walked out on Monday; 1,200 staff joined, the union said.", `https://o${o}.test/${id}`, `Outlet ${o}`, "world", NOW - k * 60e3, NOW);
      const ks = keys === "shared" ? [`${eventId}-K1`, `${eventId}-K2`, `${eventId}-K3`] : keys === "own" ? [`${id}-X1`, `${id}-X2`] : [];
      for (const q of ks) insEnt.run(id, q, q.toLowerCase(), q, "unknown", q, NOW);
      link.run(eventId, id, NOW - k * 60e3);
      ids.push(id);
    }
  }
  return ids;
}

/** Capture 🧭 lines while running fn. */
async function captured(fn) {
  const lines = [];
  const orig = logger.info;
  logger.info = (m, ...rest) => { if (typeof m === "string" && m.startsWith("🧭")) lines.push(m); return orig.call(logger, m, ...rest); };
  try { return { result: await fn(), lines }; } finally { logger.info = orig; }
}

function stub(value, { ok = true, model = "claude-haiku-5-5" } = {}) {
  const calls = [];
  const fn = async (prompt, opts) => { calls.push({ prompt, opts }); return { ok, value, model }; };
  fn.calls = calls;
  return fn;
}

// The bundle is round-robin over outlets, newest first: with 4 outlets × 1 article, [1]..[4] = Outlet 0..3.
const GOOD = {
  facts: [
    { text: "Port workers walked out on Monday.", sources: [1, 2] },
    { text: "About 1,200 staff joined the strike, the union said.", sources: [2, 3] },
    { text: "The strike entered its third day.", sources: [3, 4] },
  ],
  unknown: ["How long the strike will last."],
};

test("fixtures: real coherence reads ok / low / null on the three seeded shapes", () => {
  const { db } = makeTestDb();
  seed(db, "ev-ok"); seed(db, "ev-low", { keys: "own" }); seed(db, "ev-null", { keys: "none" });
  assert.equal(dossierCoherence(db, "ev-ok").level, "ok");
  assert.equal(dossierCoherence(db, "ev-low").level, "low");
  assert.equal(dossierCoherence(db, "ev-null").level, null);
});

test("coherence low → no call, wwk-skip; null → no call; sensitive → no call; few outlets → no call", async () => {
  const { db } = makeTestDb();
  seed(db, "ev-low", { keys: "own" });
  seed(db, "ev-null", { keys: "none" });
  seed(db, "ev-sens", { title: "Gunman kills 5 in school shooting" });
  seed(db, "ev-few", { outlets: 2, perOutlet: 3 });
  const llm = stub(GOOD);
  const { lines } = await captured(async () => {
    for (const id of ["ev-low", "ev-null", "ev-sens", "ev-few"]) {
      const ev = db.prepare("SELECT id, title FROM events WHERE id = ?").get(id);
      const r = await generateForEvent(db, ev, { now: NOW, llm });
      assert.equal(r.called, false, `${id} must not call the LLM`);
    }
  });
  assert.equal(llm.calls.length, 0);
  assert.match(lines.find((l) => l.includes("ev-low")), /wwk-skip .*coherence low/);
  assert.match(lines.find((l) => l.includes("ev-null")), /wwk-skip .*coherence unmeasured/);
  assert.match(lines.find((l) => l.includes("ev-sens")), /wwk-skip .*sensitive/);
  assert.match(lines.find((l) => l.includes("ev-few")), /wwk-skip .*few outlets/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM event_what_we_know").get().n, 0);
});

test("ok event → one call, stored ok block with resolved sources, wwk-generate; served by the API with the disclosure", async () => {
  const { db } = makeTestDb();
  seed(db, "ev-ok");
  const llm = stub(GOOD);
  const { result, lines } = await captured(() => generateForEvent(db, { id: "ev-ok", title: "Story ev-ok" }, { now: NOW, llm }));
  assert.deepEqual(result, { called: true, status: "ok" });
  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0].opts.task, "what-we-know");
  assert.equal(llm.calls[0].opts.maxOutputTokens, 600);
  assert.ok(lines.some((l) => /^🧭 wwk-generate /.test(l)));
  const api = whatWeKnowForApi(db, "ev-ok", dossierCoherence(db, "ev-ok"));
  assert.equal(api.facts.length, 3);
  assert.equal(api.disclosure, DISCLOSURE);
  assert.equal(api.model, "claude-haiku-5-5");
  assert.equal(api.generated_at, NOW);
  assert.deepEqual(api.unknown, ["How long the strike will last."]);
  const s = api.facts[0].sources;
  assert.equal(s.length, 2);
  assert.ok(s.every((x) => x.article_id && x.source_name && /^https:\/\//.test(x.url)));
});

test("unchanged content hash → no second call; changed hash after 6 h → exactly one call", async () => {
  const { db } = makeTestDb();
  seed(db, "ev-ok");
  const llm = stub(GOOD);
  const ev = { id: "ev-ok", title: "Story ev-ok" };
  await generateForEvent(db, ev, { now: NOW, llm });
  const again = await captured(() => generateForEvent(db, ev, { now: NOW + 10 * HOUR, llm }));
  assert.equal(llm.calls.length, 1, "same articles: never re-paid");
  assert.match(again.lines[0], /wwk-skip .*unchanged/);

  // A new article from a new outlet changes the bundle (and its hash).
  db.prepare(`INSERT INTO articles (id, title, description, url, source_name, category, published_at, fetched_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run("ev-ok-new", "Port strike day 3", "Workers walked out on Monday.", "https://o9.test/new", "Outlet 9", "world", NOW + HOUR, NOW + HOUR);
  for (const q of ["ev-ok-K1", "ev-ok-K2", "ev-ok-K3"]) db.prepare(`INSERT INTO article_entities (article_id, surface, surface_norm, qid, entity_type, label, created_at) VALUES (?,?,?,?,?,?,?)`).run("ev-ok-new", q, q.toLowerCase(), q, "unknown", q, NOW);
  db.prepare(`INSERT INTO event_articles (event_id, article_id, relevance, added_at) VALUES (?,?,1.0,?)`).run("ev-ok", "ev-ok-new", NOW + HOUR);

  const early = await captured(() => generateForEvent(db, ev, { now: NOW + 2 * HOUR, llm }));
  assert.equal(llm.calls.length, 1, "changed hash but the good block is under 6 h old: no call");
  assert.match(early.lines[0], /wwk-skip .*fresh/);

  await generateForEvent(db, ev, { now: NOW + REFRESH_AFTER_MS + HOUR, llm });
  assert.equal(llm.calls.length, 2, "changed hash after 6 h: one call");
  await generateForEvent(db, ev, { now: NOW + REFRESH_AFTER_MS + 2 * HOUR, llm });
  assert.equal(llm.calls.length, 2);
});

test("validation drops a missing id, a one-outlet fact and an unsupported number", () => {
  const { db } = makeTestDb();
  seed(db, "ev-ok");
  const bundle = buildBundle(db, "ev-ok");
  const v = validate({
    facts: [
      { text: "Port workers walked out on Monday.", sources: [1, 2] },          // kept
      { text: "Workers walked out on Monday.", sources: [1, 99] },             // id outside the bundle
      { text: "Workers walked out on Monday.", sources: [1] },                 // one outlet
      { text: "About 5,000 staff joined the strike.", sources: [1, 2] },       // number not in the inputs
      { text: "1,200 staff joined.", sources: [2, 3] },                        // number verbatim: kept
    ],
  }, bundle);
  assert.deepEqual(v.facts.map((f) => f.text), ["Port workers walked out on Monday.", "1,200 staff joined."]);
  assert.deepEqual(v.dropped.map((d) => d.why), ["cites an id outside the bundle", "fewer than 2 outlets", "number 5,000 not in a cited report"]);
});

test("validation: a number must be whole — neither '200' nor '20' is supported by '1,200', nor '30.5' by '30'", () => {
  const { db } = makeTestDb();
  seed(db, "ev-ok", { desc: "About 1,200 staff joined after 30 hours." });
  const v = validate({ facts: [
    { text: "200 staff joined.", sources: [1, 2] },
    { text: "About 20 staff joined.", sources: [1, 2] },
    { text: "It took 30.5 hours.", sources: [1, 2] },
    { text: "It took 30 hours.", sources: [1, 2] },
  ] }, buildBundle(db, "ev-ok"));
  assert.deepEqual(v.facts.map((f) => f.text), ["It took 30 hours."]);
});

test("fewer than 3 surviving facts → refused, wwk-refuse, and the API serves nothing", async () => {
  const { db } = makeTestDb();
  seed(db, "ev-ok");
  const llm = stub({ facts: [
    { text: "Port workers walked out on Monday.", sources: [1, 2] },
    { text: "About 9,999 staff joined.", sources: [2, 3] },
    { text: "Something.", sources: [4] },
  ] });
  const { result, lines } = await captured(() => generateForEvent(db, { id: "ev-ok", title: "Story ev-ok" }, { now: NOW, llm }));
  assert.deepEqual(result, { called: true, status: "refused" });
  assert.ok(lines.some((l) => /^🧭 wwk-refuse /.test(l)));
  const row = db.prepare("SELECT status, refusal_reason, body_json, attempts FROM event_what_we_know WHERE event_id = 'ev-ok'").get();
  assert.equal(row.status, "refused");
  assert.match(row.refusal_reason, /only 1 fact/);
  assert.equal(row.body_json, null);
  assert.equal(whatWeKnowForApi(db, "ev-ok", dossierCoherence(db, "ev-ok")), undefined);
});

test("refused content retries at most 3 times, spaced 0 / 6 h / 24 h", async () => {
  const { db } = makeTestDb();
  seed(db, "ev-ok");
  const llm = stub({ facts: [] });
  const ev = { id: "ev-ok", title: "Story ev-ok" };
  await generateForEvent(db, ev, { now: NOW, llm });                       // attempt 1
  await generateForEvent(db, ev, { now: NOW + 5 * HOUR, llm });            // too early
  await generateForEvent(db, ev, { now: NOW + 6 * HOUR, llm });            // attempt 2
  await generateForEvent(db, ev, { now: NOW + 20 * HOUR, llm });           // too early
  await generateForEvent(db, ev, { now: NOW + 30 * HOUR, llm });           // attempt 3
  await generateForEvent(db, ev, { now: NOW + 300 * HOUR, llm });          // exhausted
  assert.equal(llm.calls.length, 3);
});

test("API omits the block when live coherence is low even if a stored ok row exists", async () => {
  const { db } = makeTestDb();
  seed(db, "ev-low", { keys: "own" });
  db.prepare(`INSERT INTO event_what_we_know (event_id, content_hash, body_json, model, generated_at, attempts, last_attempt_at, status)
              VALUES ('ev-low', 'h', ?, 'm', ?, 1, ?, 'ok')`)
    .run(JSON.stringify({ facts: GOOD.facts.map((f) => ({ text: f.text, sources: [] })), unknown: [] }), NOW, NOW);
  assert.equal(dossierCoherence(db, "ev-low").level, "low");
  assert.equal(whatWeKnowForApi(db, "ev-low", dossierCoherence(db, "ev-low")), undefined);
  // Same row with an "ok" verdict is served: it is the live verdict that withholds it.
  assert.ok(whatWeKnowForApi(db, "ev-low", { level: "ok" }));
  // Kill switch.
  process.env.WHAT_WE_KNOW_API = "false";
  try { assert.equal(whatWeKnowForApi(db, "ev-low", { level: "ok" }), undefined); }
  finally { delete process.env.WHAT_WE_KNOW_API; }
});

test("cycle: off unless WHAT_WE_KNOW_ENABLED=1; per-cycle cap counts LLM calls only", async () => {
  const { db } = makeTestDb();
  seed(db, "ev-ok"); seed(db, "ev-ok2"); seed(db, "ev-ok3"); seed(db, "ev-low", { keys: "own" });
  const llm = stub(GOOD);
  delete process.env.WHAT_WE_KNOW_ENABLED;
  assert.deepEqual(await runWhatWeKnow({ db, now: NOW, llm }), { enabled: false });
  assert.equal(llm.calls.length, 0);
  process.env.WHAT_WE_KNOW_ENABLED = "true";   // only the literal "1" switches it on
  assert.deepEqual(await runWhatWeKnow({ db, now: NOW, llm }), { enabled: false });
  process.env.WHAT_WE_KNOW_ENABLED = "1";
  process.env.WHAT_WE_KNOW_PER_CYCLE = "2";
  try {
    const s = await runWhatWeKnow({ db, now: NOW, llm });
    assert.equal(s.llm_calls, 2);
    assert.equal(llm.calls.length, 2);
    const s2 = await runWhatWeKnow({ db, now: NOW + 60e3, llm });
    assert.equal(s2.llm_calls, 1, "the remaining ok event; settled ones are not re-paid");
  } finally { delete process.env.WHAT_WE_KNOW_ENABLED; delete process.env.WHAT_WE_KNOW_PER_CYCLE; }
});

test("ledgerDecision: no row → proceed; unchanged ok → never", () => {
  assert.equal(ledgerDecision(undefined, "h", NOW).proceed, true);
  assert.deepEqual(ledgerDecision({ content_hash: "h", status: "ok", generated_at: NOW - 1e9 }, "h", NOW), { proceed: false, reason: "unchanged" });
});
