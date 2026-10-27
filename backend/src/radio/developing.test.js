// #201: developing stories from the event graph (developing.js) and the replay of a recorded day
// (developingReplay.mjs), on a real seeded test DB.
import test from "node:test";
import assert from "node:assert/strict";
import { makeTestDb } from "../testing/testDb.js";
import { buildDeveloping, scoreEvent, devThresholds, developingEnabled, DEV_DEFAULTS } from "./developing.js";
import { replayDay, formatTable } from "./developingReplay.mjs";

const MIN = 60_000, HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 26, 15, 2, 0);
let seq = 0;

function event(db, { id, created = NOW - 2 * HOUR, meta = null, title = "Event" }) {
  db.prepare(`INSERT INTO events (id, slug, title, category, status, started_at, last_activity_at, created_at, updated_at, meta)
              VALUES (?, ?, ?, 'world', 'active', ?, ?, ?, ?, ?)`).run(id, `${id}-slug`, title, created, created, created, created, meta);
}
/** One article linked to `ev` `ago` minutes before NOW. */
function art(db, ev, { title, source, ago, description = "", url = null, category = "international" }) {
  const id = `a${++seq}`;
  const t = NOW - ago * MIN;
  db.prepare(`INSERT INTO articles (id, title, description, url, source_name, category, credibility, is_duplicate, fetched_at, published_at)
              VALUES (?, ?, ?, ?, ?, ?, 8, 0, ?, ?)`).run(id, title, description, url || `https://example.com/${id}`, source, category, t, t);
  db.prepare(`INSERT INTO event_articles (event_id, article_id, relevance, added_at) VALUES (?, ?, 1, ?)`).run(ev, id, t);
  return id;
}
const FIRE = "Large fire at Rotterdam port warehouse, roads closed around the harbour";
const OUTLETS = ["Reuters", "BBC News", "Al Jazeera", "NPR News", "AP"];

test("flag: dark unless RADIO_DEVELOPING_ENABLED is 1 or true", () => {
  assert.equal(developingEnabled({}), false);
  assert.equal(developingEnabled({ RADIO_DEVELOPING_ENABLED: "0" }), false);
  assert.equal(developingEnabled({ RADIO_DEVELOPING_ENABLED: "1" }), true);
  assert.equal(devThresholds({}).minOutlets, DEV_DEFAULTS.minOutlets);
  assert.equal(devThresholds({ RADIO_DEV_MIN_OUTLETS: "5" }).minOutlets, 5);
  assert.equal(devThresholds({ RADIO_DEV_MIN_OUTLETS: "zero" }).minOutlets, DEV_DEFAULTS.minOutlets, "junk falls back to the default");
});

test("a newly promoted event with 5 articles from 5 outlets in 20 minutes fires; its headline is an outlet's own title", () => {
  const { db } = makeTestDb({ prefix: "dev-new-" });
  event(db, { id: "e-new", created: NOW - 25 * MIN, title: "Our own event title" });
  OUTLETS.forEach((source, i) => art(db, "e-new", { title: i === 0 ? FIRE : `${FIRE} (${source})`, source, ago: 20 - i * 4 }));
  const r = buildDeveloping(db, { now: NOW });
  assert.equal(r.fired, 1);
  const e = r.events[0];
  assert.equal(e.id, "e-new"); assert.equal(e.kind, "new"); assert.equal(e.fires, true);
  assert.deepEqual(e.recent, { articles: 5, outlets: 5 });
  assert.notEqual(e.headline, "Our own event title", "never the event graph's title");
  assert.ok(e.outlets.every((o) => o.title.startsWith(FIRE)));
});

test("a long story with a steady trickle does not fire; the same story surging does", () => {
  const { db } = makeTestDb({ prefix: "dev-steady-" });
  event(db, { id: "e-war", created: NOW - 2 * 24 * HOUR });
  // 4 articles every 30 minutes for the 6 hours before, and 4 in the last 30: steady
  for (let k = 0; k < 13; k++) for (let j = 0; j < 4; j++) art(db, "e-war", { title: `Ceasefire talks continue in Cairo, round ${k}`, source: OUTLETS[j], ago: 5 + k * 30 + j });
  const steady = scoreEvent(buildDevelopingRows(db, "e-war"), NOW, devThresholds({}));
  assert.equal(steady.fires, false);
  assert.match(steady.why, /steady/);
  // 12 more in the last 30 minutes: 16 against a baseline of 4 per 30 min -> 4x
  for (let j = 0; j < 12; j++) art(db, "e-war", { title: "Ceasefire agreed in Cairo, officials say", source: OUTLETS[j % 5], ago: 2 + j });
  const surge = buildDeveloping(db, { now: NOW }).events.find((e) => e.id === "e-war");
  assert.equal(surge.fires, true, surge.why);
  assert.equal(surge.kind, "growing");
  assert.ok(surge.ratio >= 3);
});

function buildDevelopingRows(db, id) {
  const t = devThresholds({});
  const arts = db.prepare(`SELECT ea.added_at, a.* FROM event_articles ea JOIN articles a ON a.id = ea.article_id WHERE ea.event_id = ? AND ea.added_at <= ? AND ea.added_at > ?`)
    .all(id, NOW, NOW - t.windowMin * MIN - t.baselineHours * HOUR);
  return { id, created_at: NOW - 2 * 24 * HOUR, articles: arts };
}

test("thresholds: two outlets is not enough; Rule 0 and opinion pieces do not count", () => {
  const { db } = makeTestDb({ prefix: "dev-floor-" });
  event(db, { id: "e-two", created: NOW - 20 * MIN });
  for (let j = 0; j < 6; j++) art(db, "e-two", { title: `${FIRE} ${j}`, source: OUTLETS[j % 2], ago: 3 + j });
  event(db, { id: "e-op", created: NOW - 20 * MIN });
  for (let j = 0; j < 5; j++) art(db, "e-op", { title: `Why the port fire shows we need new rules ${j}`, source: OUTLETS[j], ago: 3 + j, url: `https://example.com/opinion/${j}` });
  const r = buildDeveloping(db, { now: NOW });
  assert.equal(r.fired, 0);
  assert.ok(!r.events.find((e) => e.id === "e-op"), "opinion pieces are not news: nothing left to list");
  assert.ok(!r.events.find((e) => e.id === "e-two"), "#243: a 2-outlet event is not reader-eligible, so not even followed up");
  assert.match(scoreEvent(buildDevelopingRows(db, "e-two"), NOW, devThresholds({})).why, /2 outlet/);
});

test("Rule 0: an event with a Pakistan signal is dropped whole (the LLM judge does not run here)", () => {
  const { db } = makeTestDb({ prefix: "dev-pk-" });
  event(db, { id: "e-pk", created: NOW - 20 * MIN });
  OUTLETS.forEach((source, i) => art(db, "e-pk", { title: `Flooding closes roads in Karachi and Lahore ${i}`, source, ago: 3 + i }));
  const r = buildDeveloping(db, { now: NOW });
  const e = r.events.find((x) => x.id === "e-pk");
  assert.ok(!e || !e.fires, "never fires");
});

test("machine events count only once they have articles; nothing linked after `now` is visible", () => {
  const { db } = makeTestDb({ prefix: "dev-machine-" });
  event(db, { id: "e-usgs-bare", created: NOW - 10 * MIN, meta: JSON.stringify({ source: "usgs" }) });
  event(db, { id: "e-usgs", created: NOW - 10 * MIN, meta: JSON.stringify({ source: "usgs" }) });
  OUTLETS.forEach((source, i) => art(db, "e-usgs", { title: `Magnitude 6.8 earthquake strikes off the coast of Chile ${i}`, source, ago: 2 + i }));
  const r = buildDeveloping(db, { now: NOW });
  assert.ok(!r.events.find((e) => e.id === "e-usgs-bare"), "no articles: never listed");
  const q = r.events.find((e) => e.id === "e-usgs");
  assert.equal(q.fires, true);
  assert.equal(q.sensitive, true, "an earthquake is a sensitive story: no music bed");
  const earlier = buildDeveloping(db, { now: NOW - 5 * MIN });
  assert.equal(earlier.events.find((e) => e.id === "e-usgs")?.recent.articles ?? 0, 2, "as of 5 minutes ago only two were linked");
});

test("replay: a recorded day lists the bulletins that would have fired, with times, within 15 minutes and 20 minutes apart", () => {
  const { db } = makeTestDb({ prefix: "dev-replay-" });
  // two stories surge 6 minutes apart
  event(db, { id: "e-a", created: NOW - 40 * MIN });
  OUTLETS.forEach((source, i) => art(db, "e-a", { title: `${FIRE} ${i}`, source, ago: 30 - i * 2 }));
  event(db, { id: "e-b", created: NOW - 30 * MIN });
  OUTLETS.forEach((source, i) => art(db, "e-b", { title: `Bridge collapses over the Danube in Budapest ${i}`, source, ago: 24 - i * 2 }));
  const r = replayDay(db, { from: NOW - 60 * MIN, to: NOW + 60 * MIN, stepMin: 5 });
  assert.equal(r.bulletins.length + r.missed.length, 2);
  assert.ok(r.bulletins.length >= 1);
  for (const b of r.bulletins) assert.ok(b.airsAt - b.detectedAt <= 15 * MIN, `${b.headline}: ${b.delayMin} min`);
  const at = r.bulletins.map((b) => b.airsAt).sort((x, y) => x - y);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 20 * MIN, "never two interruptions inside 20 minutes");
  const table = formatTable(r);
  assert.match(table, /\| detected \(UTC\) \| on air \(UTC\) \|/);
  assert.match(table, /Assumed:/);
});

test("the radio cycle writes developing.json only when RADIO_DEVELOPING_ENABLED is on, and never fails the state for it", async () => {
  const os = await import("node:os"); const fs = await import("node:fs"); const path = await import("node:path");
  const { runRadioStateCycle } = await import("./radioState.js");
  const { db } = makeTestDb({ prefix: "dev-cycle-" });
  event(db, { id: "e-c", created: NOW - 25 * MIN });
  OUTLETS.forEach((source, i) => art(db, "e-c", { title: `${FIRE} ${i}`, source, ago: 20 - i * 4 }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-cycle-"));
  const deps = { db, now: NOW, file: path.join(dir, "state.json"), developingFile: path.join(dir, "developing.json"),
    gateLlm: async (p) => ({ verdicts: [...p.matchAll(/id=(\S+)/g)].map((m) => ({ id: m[1], verdict: "keep" })) }), wordLlm: async () => null };
  const keep = { RADIO_ENABLED: process.env.RADIO_ENABLED, RADIO_DEVELOPING_ENABLED: process.env.RADIO_DEVELOPING_ENABLED };
  try {
    process.env.RADIO_ENABLED = "true"; delete process.env.RADIO_DEVELOPING_ENABLED;
    const off = await runRadioStateCycle(deps);
    assert.equal(off.phase, "complete"); assert.equal(off.developing, undefined);
    assert.equal(fs.existsSync(deps.developingFile), false);
    process.env.RADIO_DEVELOPING_ENABLED = "1";
    const on = await runRadioStateCycle(deps);
    assert.equal(on.phase, "complete");
    assert.deepEqual(on.developing, { considered: 1, fired: 1, listed: 1 });
    assert.equal(JSON.parse(fs.readFileSync(deps.developingFile, "utf8")).events[0].id, "e-c");
  } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("#243: an event a reader may not be shown (one outlet dominating) never fires; with the gate off it would", () => {
  const { db } = makeTestDb({ prefix: "dev-elig-" });
  event(db, { id: "e-blob", created: NOW - 25 * MIN });
  // 3 outlets in the window, but one outlet supplies 9 of the event's 11 articles (> 70%)
  ["Reuters", "BBC News"].forEach((source, i) => art(db, "e-blob", { title: `${FIRE} ${source}`, source, ago: 10 + i }));
  for (let j = 0; j < 9; j++) art(db, "e-blob", { title: `${FIRE} wire ${j}`, source: "Wire One", ago: 2 + j });
  const keep = process.env.EVENT_READER_ELIGIBILITY;
  try {
    delete process.env.EVENT_READER_ELIGIBILITY;
    const on = buildDeveloping(db, { now: NOW });
    assert.equal(on.fired, 0); assert.equal(on.events.length, 0); assert.equal(on.ineligible, 1);
    process.env.EVENT_READER_ELIGIBILITY = "false";
    const off = buildDeveloping(db, { now: NOW });
    assert.equal(off.fired, 1, "the gate is what held it, not the thresholds");
  } finally {
    if (keep === undefined) delete process.env.EVENT_READER_ELIGIBILITY; else process.env.EVENT_READER_ELIGIBILITY = keep;
  }
});
