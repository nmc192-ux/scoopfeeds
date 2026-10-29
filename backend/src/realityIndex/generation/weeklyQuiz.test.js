/**
 * #271 — weekly quiz "Did you scoop it?": selection, validation, storage, API.
 *
 * Fixtures on makeTestDb() temp DBs with the REAL dossierCoherence and
 * reader-eligibility paths (same seed shapes as whatWeKnow.test.js). The LLM is
 * stubbed by injection, so nothing here touches the network or the budget.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";

// getDb() resolves its data directory at module load, so set it before importing.
process.env.SCOOP_PERSISTENT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "scoop-quiz-"));

const { makeTestDb } = await import("../../testing/testDb.js");
const { getDb } = await import("../../models/database.js");
const { logger } = await import("../../services/logger.js");
const Q = await import("./weeklyQuiz.js");
const { latestWeeklyQuiz, listOriginals } = await import("../dal/originalsDao.js");
const originalsRouter = (await import("../../routes/originals.js")).default;

const HOUR = 3600e3;
const NOW = Date.UTC(2026, 9, 26, 6, 17); // Monday 26 Oct 2026, 06:17 UTC
const WEEK = "2026-10-26";
const T = Date.UTC(2026, 9, 24, 12); // inside the window [19 Oct, 26 Oct)
const ON = { ORIGINALS_QUIZ_ENABLED: "1" };
const LETTERS = "ABCDEFGHIJ";

/** One dossier. Event `ev-<x>`; its reports name mayor "Alba<x>" and say "7 to 2". */
function seed(db, x, { title, keys = "shared", outlets = 4, at = T, articles = true } = {}) {
  const id = `ev-${x}`;
  db.prepare(`INSERT INTO events (id, slug, cluster_id, title, category, status, started_at, last_activity_at, meta, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, `${id}-slug`, null, title ?? `Riverton${x} council approves tram line`, "world", "active", at - HOUR, at, "{}", at - HOUR, at);
  if (!articles) return id;
  const insArt = db.prepare(`INSERT INTO articles (id, title, description, url, source_name, category, published_at, fetched_at) VALUES (?,?,?,?,?,?,?,?)`);
  const insEnt = db.prepare(`INSERT OR IGNORE INTO article_entities (article_id, surface, surface_norm, qid, entity_type, label, created_at) VALUES (?,?,?,?,?,?,?)`);
  const link = db.prepare(`INSERT INTO event_articles (event_id, article_id, relevance, added_at) VALUES (?,?,1.0,?)`);
  for (let o = 0; o < outlets; o++) {
    const aid = `${id}-a${o}`;
    insArt.run(aid, `Riverton${x} council approves tram line`, `The council voted 7 to 2; Mayor Alba${x} backed the plan.`, `https://o${o}.test/${aid}`, `Outlet ${o}`, "world", at - o * 60e3, at);
    const ks = keys === "shared" ? [`${id}-K1`, `${id}-K2`, `${id}-K3`] : keys === "own" ? [`${aid}-X1`, `${aid}-X2`] : [];
    for (const k of ks) insEnt.run(aid, k, k.toLowerCase(), k, "unknown", k, at);
    link.run(id, aid, at - o * 60e3);
  }
  return id;
}

const good = (x) => ({ event: `ev-${x}`, q: `Who is the mayor who backed the Riverton${x} tram line?`, choices: [`Alba${x}`, "Brookfield", "Castellan", "Dunmore"], answer: 0 });

function stub(value, { ok = true, model = "claude-haiku-5-5", nil = false } = {}) {
  const calls = [];
  const fn = async (prompt, opts) => { calls.push({ prompt, opts }); return nil ? null : { ok, value, model }; };
  fn.calls = calls;
  return fn;
}

async function captured(fn) {
  const lines = [];
  const orig = logger.info;
  logger.info = (m, ...rest) => { if (typeof m === "string" && m.startsWith("🧭")) lines.push(m); return orig.call(logger, m, ...rest); };
  try { return { result: await fn(), lines }; } finally { logger.info = orig; }
}

const rows = (db) => db.prepare("SELECT * FROM weekly_quizzes").all();

test("flag off (ORIGINALS_QUIZ_ENABLED=0) → no call, no row", async () => {
  const { db } = makeTestDb();
  for (const x of "ABCDEF") seed(db, x);
  const llm = stub({ questions: [] });
  const r = await Q.runWeeklyQuiz({ db, now: NOW, llm, env: { ORIGINALS_QUIZ_ENABLED: "0" } });
  assert.deepEqual(r, { enabled: false });
  assert.equal(Q.weeklyQuizEnabled({}), true, "unset is on after the flip");
  assert.equal(llm.calls.length, 0);
  assert.equal(rows(db).length, 0);
});

test("fewer than 5 eligible dossiers → refused row, no call; sensitive, machine, low and unmeasured events never selected", async () => {
  const { db } = makeTestDb();
  for (const x of "ABCD") seed(db, x);
  seed(db, "S", { title: "Gunman kills 5 in school shooting" });
  seed(db, "L", { keys: "own" });
  seed(db, "N", { keys: "none" });
  seed(db, "M", { articles: false });
  seed(db, "O", { at: T - 10 * 24 * HOUR }); // outside the window
  const pick = Q.pickDossiers(db, { ...Q.quizWeek(NOW), now: NOW });
  assert.deepEqual(pick.dossiers.map((d) => d.id).sort(), ["ev-A", "ev-B", "ev-C", "ev-D"]);
  assert.equal(pick.dropped.sensitive, 1);
  // the incoherent event is caught by reader eligibility ("incoherent") or the coherence level, whichever runs first
  assert.equal((pick.dropped["coherence low"] ?? 0) + (pick.dropped["not reader-eligible"] ?? 0), 1);
  assert.equal(pick.dropped["coherence unmeasured"], 1);

  const llm = stub({ questions: [] });
  const { result, lines } = await captured(() => Q.runWeeklyQuiz({ db, now: NOW, llm, env: ON }));
  assert.equal(result.status, "refused");
  assert.equal(llm.calls.length, 0);
  const [row] = rows(db);
  assert.equal(row.week_start, WEEK);
  assert.equal(row.status, "refused");
  assert.match(row.refusal_reason, /too few eligible dossiers/);
  assert.ok(lines.some((l) => /^🧭 quiz-refuse /.test(l)));
});

test("validator drops: outside id, answer not in reports, wrong choice in reports, unverified number, sensitive, 3 or 5 choices", () => {
  const { db } = makeTestDb();
  const ids = [..."ABCDEFGH"].map((x) => seed(db, x));
  const bundles = ids.map((id) => ({ event: { id, slug: `${id}-slug`, title: "t" }, articles: [{ title: `Riverton${id.slice(3)} council approves tram line`, description: `The council voted 7 to 2; Mayor Alba${id.slice(3)} backed the plan.`, source_name: "Outlet 0" }] }));
  const v = Q.validate({
    questions: [
      good("A"),
      { ...good("B"), event: "ev-ZZ" },
      { ...good("C"), choices: ["Zorro", "Brookfield", "Castellan", "Dunmore"] },
      { ...good("D"), choices: ["AlbaD", "Riverton", "Castellan", "Dunmore"] },
      { ...good("E"), q: "Did 9 of the councillors back the RivertonE tram line?" },
      { ...good("F"), q: "Who was killed in the RivertonF shooting?" },
      { ...good("G"), choices: ["AlbaG", "Brookfield", "Castellan"] },
      { ...good("H"), choices: ["AlbaH", "Brookfield", "Castellan", "Dunmore", "Elm"] },
    ],
  }, bundles);
  assert.deepEqual(v.questions.map((q) => q.event.slug), ["ev-A-slug"]);
  const why = Object.fromEntries(v.dropped.map((d) => [d.event, d.why]));
  assert.equal(why["ev-ZZ"], "event outside the bundle");
  assert.equal(why["ev-C"], "correct answer not in the dossier's reports");
  assert.equal(why["ev-D"], "a wrong choice is in the dossier's reports");
  assert.equal(why["ev-E"], "number 9 not in the dossier's reports");
  assert.equal(why["ev-F"], "sensitive");
  assert.equal(why["ev-G"], "3 choices");
  assert.equal(why["ev-H"], "5 choices");
  // a verbatim number passes
  const ok = Q.validate({ questions: [{ ...good("A"), q: "The RivertonA vote was 7 to 2. Which mayor backed it?" }] }, bundles);
  assert.equal(ok.questions.length, 1);
});

test("fewer than 5 survivors → refused row with reasons", async () => {
  const { db } = makeTestDb();
  for (const x of "ABCDEF") seed(db, x);
  const llm = stub({ questions: [good("A"), good("B"), good("C"), { ...good("D"), answer: 1 }, { ...good("E"), event: "nope" }] });
  const r = await Q.runWeeklyQuiz({ db, now: NOW, llm, env: ON });
  assert.equal(r.status, "refused");
  assert.equal(llm.calls.length, 1);
  const [row] = rows(db);
  assert.equal(row.status, "refused");
  assert.equal(row.body_json, null);
  assert.match(row.refusal_reason, /only 3 question/);
});

test("good response → published row (≤ 8 questions, slugs); second run same week does nothing; prompt holds only eligible dossiers", async () => {
  const { db } = makeTestDb();
  for (const x of "ABCDEFGHIJ") seed(db, x);
  seed(db, "S", { title: "Gunman kills 5 in school shooting", outlets: 6 });
  seed(db, "L", { keys: "own", outlets: 6 });
  const llm = stub({ questions: [...LETTERS].map(good) });
  const { result, lines } = await captured(() => Q.runWeeklyQuiz({ db, now: NOW, llm, env: ON }));
  assert.equal(result.status, "published");
  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0].opts.task, "weekly-quiz");
  assert.equal(llm.calls[0].opts.maxOutputTokens, 1200);
  assert.ok(!llm.calls[0].prompt.includes("ev-S") && !llm.calls[0].prompt.includes("ev-L"));
  assert.ok(lines.some((l) => /^🧭 quiz-publish /.test(l)));
  const [row] = rows(db);
  assert.equal(row.status, "published");
  assert.equal(row.model, "claude-haiku-5-5");
  const body = JSON.parse(row.body_json);
  assert.ok(body.questions.length >= 5 && body.questions.length <= Q.MAX_DOSSIERS);
  assert.ok(body.questions.every((q) => /^ev-[A-J]-slug$/.test(q.event.slug)));
  assert.equal(body.disclosure, Q.DISCLOSURE);

  const again = stub({ questions: [...LETTERS].map(good) });
  const r2 = await Q.runWeeklyQuiz({ db, now: NOW + HOUR, llm: again, env: ON });
  assert.equal(r2.status, "skip");
  assert.equal(again.calls.length, 0);
  assert.equal(rows(db).length, 1);

  // DAL: served, without event ids or internal fields
  const quiz = latestWeeklyQuiz({ now: NOW, db });
  assert.equal(quiz.week_start, WEEK);
  assert.deepEqual(Object.keys(quiz.questions[0].event).sort(), ["slug", "title"]);
  assert.deepEqual(listOriginals({ now: NOW, db }).quiz, { week_start: WEEK, count: body.questions.length });
  assert.equal(latestWeeklyQuiz({ now: NOW + 20 * 24 * HOUR, db }), null, "older than 14 days → not served");
});

test("callJson returning null (LLM unavailable) writes nothing", async () => {
  const { db } = makeTestDb();
  for (const x of "ABCDEF") seed(db, x);
  const llm = stub(null, { nil: true });
  const r = await Q.runWeeklyQuiz({ db, now: NOW, llm, env: ON });
  assert.equal(r.status, "skip");
  assert.equal(r.reason, "llm unavailable");
  assert.equal(llm.calls.length, 1);
  assert.equal(rows(db).length, 0);
});

test("GET /api/originals/quiz: 404 with only a refused row; latest published row otherwise; never refusal_reason", async () => {
  const db = getDb();
  const week = new Date(Date.now() - 2 * 24 * HOUR).toISOString().slice(0, 10);
  const older = new Date(Date.now() - 9 * 24 * HOUR).toISOString().slice(0, 10);
  db.prepare("INSERT INTO weekly_quizzes (week_start, generated_at, status, refusal_reason) VALUES (?, ?, 'refused', 'SECRET-REASON')").run(week, Date.now());
  const app = express();
  app.use("/api/originals", originalsRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api/originals`;
  try {
    let res = await fetch(`${base}/quiz`);
    assert.equal(res.status, 404);
    assert.ok(!(await res.text()).includes("SECRET-REASON"));

    const body = { questions: [{ ...good("A"), event: { id: "ev-A", slug: "ev-A-slug", title: "Tram" } }], disclosure: Q.DISCLOSURE };
    db.prepare("INSERT INTO weekly_quizzes (week_start, generated_at, status, body_json, model) VALUES (?, ?, 'published', ?, 'm')").run(older, Date.now(), JSON.stringify(body));
    res = await fetch(`${base}/quiz`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") || "", /max-age=300/);
    const text = await res.text();
    assert.ok(!text.includes("SECRET-REASON") && !text.includes("refusal_reason") && !text.includes('"ev-A"'));
    const json = JSON.parse(text);
    assert.equal(json.week_start, older);
    assert.equal(json.questions[0].event.slug, "ev-A-slug");
    assert.equal(json.disclosure, Q.DISCLOSURE);

    const list = await (await fetch(base)).json();
    assert.deepEqual(list.quiz, { week_start: older, count: 1 });
  } finally {
    server.close();
  }
});
