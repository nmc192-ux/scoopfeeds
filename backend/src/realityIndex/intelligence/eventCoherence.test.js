/**
 * #179 — the coherence gate.
 *
 * Fixtures, all on one temp DB (entity_idf left empty → the shared measure runs
 * unweighted, which is the documented degrade, and every key passes the hub
 * filter):
 *   - two EVENTS (u, r) of 6 members, each member carrying its event's three
 *     rare keys, embedded in two orthogonal directions so they never merge.
 *   - a RELATED article carries Q1 plus its own key → AFFINE to the core.
 *   - UNRELATED articles carry only Z keys → FOREIGN to the core.
 *
 * Acceptance from the issue: an unrelated article is held; a related one still
 * merges; the 🧭 lines for existing decisions are byte-identical on the same
 * input with the gate on and off.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoop-coherence-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = dir;

const { runEventPromoter, maybeFollowHeadline, slugOverlap } = await import("./eventPromoter.js");
const { gateAttach, eventCoherence, coherenceLevel, dossierCoherence } = await import("./eventCoherence.js");
const { buildAffinityCtx } = await import("./storyAffinity.js");
const { resolveSlugAlias } = await import("../dal/slugAliases.js");
const { getDb } = await import("../../models/database.js");
const { upsertEmbedding } = await import("../dal/embeddingsDao.js");
const { isVecAvailable } = await import("../schema.js");
const { logger } = await import("../../services/logger.js");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const db = getDb();
// Two different stories need two different directions, or the promoter merges them.
const VEC = {
  u: Array.from({ length: 768 }, (_, i) => (i < 384 ? 1 : 0)),
  r: Array.from({ length: 768 }, (_, i) => (i < 384 ? 0 : 1)),
  w: Array.from({ length: 768 }, (_, i) => (i % 2)),
};

const insArt = db.prepare(`INSERT OR IGNORE INTO articles (id, title, url, source_name, category, published_at, fetched_at) VALUES (?,?,?,?,?,?,?)`);
const insEnt = db.prepare(`INSERT OR IGNORE INTO article_entities (article_id, surface, surface_norm, qid, entity_type, label, created_at) VALUES (?,?,?,?,?,?,?)`);
function article(id, keys, { embed = true, dir = "u" } = {}) {
  insArt.run(id, `Headline ${id}`, `https://x.test/${id}`, "Test", "world", NOW, NOW);
  if (embed && isVecAvailable()) upsertEmbedding({ scope: "article", scope_id: id, model: "test-model", vector: VEC[dir] });
  for (const q of keys) insEnt.run(id, q, q.toLowerCase(), q, "unknown", q, NOW);
}
const CORE = { u: ["U1", "U2", "U3"], r: ["Q1", "Q2", "Q3"] };
const member = (p, i) => `${p}-m${i}`;

function seedEvent(prefix) {
  const ids = Array.from({ length: 6 }, (_, i) => member(prefix, i));
  for (const id of ids) article(id, CORE[prefix], { dir: prefix });
  const quiet = NOW - DAY;
  db.prepare(`INSERT INTO events (id, slug, cluster_id, title, category, status, started_at, last_activity_at, meta, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(`ev-${prefix}`, `${prefix}-story`, null, `Story ${prefix}`, "world", "active", quiet - DAY, quiet, JSON.stringify({ title_cluster_size: 0 }), quiet, quiet);
  const link = db.prepare(`INSERT INTO event_articles (event_id, article_id, relevance, added_at) VALUES (?,?,1.0,?)`);
  for (const id of ids) link.run(`ev-${prefix}`, id, quiet);
  return ids;
}
function seedCluster(id, articleIds) {
  db.prepare(`INSERT INTO story_clusters (id, title, summary, category, keywords, article_ids, article_count, created_at, updated_at, expires_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, `Cluster ${id}`, null, "world", "[]", JSON.stringify(articleIds), articleIds.length, NOW, NOW, NOW + 3600e3);
}
const linked = (eventId) => new Set(db.prepare("SELECT article_id FROM event_articles WHERE event_id = ?").all(eventId).map((r) => r.article_id));

/** Run the promoter, capture every 🧭 line, roll the DB back afterwards. */
async function runCaptured({ gate }) {
  const prev = process.env.EVENT_COHERENCE_GATE;
  process.env.EVENT_COHERENCE_GATE = gate ? "true" : "false";
  const lines = [];
  const orig = logger.info;
  logger.info = (msg, ...rest) => { if (typeof msg === "string" && msg.startsWith("🧭")) lines.push(msg); return orig.call(logger, msg, ...rest); };
  db.exec("SAVEPOINT coh");
  let state;
  try {
    const stats = await runEventPromoter({ now: NOW, _yielder: async () => true });
    state = { stats, unrelated: linked("ev-u"), related: linked("ev-r") };
  } finally {
    db.exec("ROLLBACK TO coh"); db.exec("RELEASE coh");
    logger.info = orig;
    if (prev === undefined) delete process.env.EVENT_COHERENCE_GATE; else process.env.EVENT_COHERENCE_GATE = prev;
  }
  return { lines, ...state };
}

// ── fixtures ────────────────────────────────────────────────────────────────
const uMembers = seedEvent("u");
const rMembers = seedEvent("r");
// Unrelated cluster: shares ONE article with event u, the other five are a different story.
const unrelated = ["u-x1", "u-x2", "u-x3", "u-x4", "u-x5"];
for (const id of unrelated) article(id, ["Z1", "Z2", "Z3"]);
seedCluster("cl-unrelated", [uMembers[0], ...unrelated]);
// Related cluster: shares one article with event r, the other five carry the core key Q1.
const related = ["r-y1", "r-y2", "r-y3", "r-y4", "r-y5"];
for (const id of related) article(id, ["Q1", `R-${id}`], { dir: "r" });
seedCluster("cl-related", [rMembers[0], ...related]);

// ── pure gate ───────────────────────────────────────────────────────────────
test("gateAttach holds FOREIGN incoming articles once the event would fall below the floor", () => {
  const ctx = buildAffinityCtx(db);
  const g = gateAttach(ctx, db, { existingIds: uMembers, incomingIds: [uMembers[0], ...unrelated], floor: 0.6 });
  assert.equal(g.before, 1);
  assert.equal(g.projected, +(6 / 11).toFixed(3));
  assert.deepEqual(new Set(g.held), new Set(unrelated));
  assert.deepEqual(g.keep, [uMembers[0]]);
  assert.equal(g.after, 1);
});

test("gateAttach keeps a related batch whole", () => {
  const ctx = buildAffinityCtx(db);
  const g = gateAttach(ctx, db, { existingIds: rMembers, incomingIds: [rMembers[0], ...related], floor: 0.6 });
  assert.deepEqual(g.held, []);
  assert.equal(g.keep.length, 6);
  assert.equal(g.projected, 1);
});

test("unmeasured is neither a pass nor a fail: articles without entities are never held, tiny sets score null", () => {
  const ctx = buildAffinityCtx(db);
  for (const id of ["n-1", "n-2"]) article(id, [], { embed: false });
  const g = gateAttach(ctx, db, { existingIds: uMembers, incomingIds: ["n-1", "n-2"], floor: 0.99 });
  assert.deepEqual(g.held, []);
  const tiny = eventCoherence(ctx, db, ["n-1", "n-2"]);
  assert.equal(tiny.score, null);
  assert.equal(coherenceLevel(null), null);
  assert.equal(coherenceLevel(0.4, 0.6), "low");
  assert.equal(coherenceLevel(0.8, 0.6), "ok");
});

test("a blob of unrelated stories scores 0 (low); a real event scores 1 (ok)", () => {
  const ctx = buildAffinityCtx(db);
  assert.equal(eventCoherence(ctx, db, rMembers).score, 1);
  // Four disjoint stories, three articles each: no key reaches 30% of members.
  const blob = [];
  for (const [p, keys] of [["b1", ["A1", "A2"]], ["b2", ["B1", "B2"]], ["b3", ["C1", "C2"]], ["b4", ["D1", "D2"]]]) {
    for (let i = 0; i < 3; i++) { article(`${p}-${i}`, keys, { embed: false }); blob.push(`${p}-${i}`); }
  }
  const s = eventCoherence(ctx, db, blob);
  assert.equal(s.coreSize, 0, "no key is shared by 30% of a four-story blob");
  assert.equal(s.score, 0, "an empty core over enough keyed members is incoherent, not unmeasured");
  assert.equal(coherenceLevel(s.score, 0.6), "low");
  // The documented limit: a minority story holding >= 30% of members enters the core.
  const mixed = eventCoherence(ctx, db, [...blob.slice(0, 3), ...uMembers]);
  assert.equal(mixed.score, 1, "two stories each >= CORE_FRAC read coherent — the breaker's case, not this score's");
});

// ── promoter: the acceptance criteria ───────────────────────────────────────
test("promoter, gate ON: the unrelated articles are held out, the related cluster still merges", async (t) => {
  if (!isVecAvailable()) { t.skip("sqlite-vec unavailable — the promoter cannot load centroids without it"); return; }
  const on = await runCaptured({ gate: true });
  for (const id of unrelated) assert.ok(!on.unrelated.has(id), `${id} must be held out of ev-u`);
  for (const id of related) assert.ok(on.related.has(id), `${id} must merge into ev-r`);
  const holds = on.lines.filter((l) => l.startsWith("🧭 coherence-hold "));
  assert.equal(holds.length, 1, "exactly one coherence-hold line, for the unrelated cluster");
  const payload = JSON.parse(holds[0].slice("🧭 coherence-hold ".length));
  assert.equal(payload.event, "u-story");
  assert.equal(payload.held, 5);
  assert.equal(payload.floor, 0.6);
  assert.equal(on.stats.coherenceHeld, 5);
});

test("promoter, gate OFF: today's behaviour — everything links, no coherence-hold, no new stats key", async (t) => {
  if (!isVecAvailable()) { t.skip("sqlite-vec unavailable"); return; }
  const off = await runCaptured({ gate: false });
  for (const id of unrelated) assert.ok(off.unrelated.has(id));
  for (const id of related) assert.ok(off.related.has(id));
  assert.equal(off.lines.filter((l) => l.includes("coherence-hold")).length, 0);
  assert.equal("coherenceHeld" in off.stats, false);
});

test("the 🧭 lines for existing decisions are byte-identical with the gate on and off", async (t) => {
  if (!isVecAvailable()) { t.skip("sqlite-vec unavailable"); return; }
  const off = await runCaptured({ gate: false });
  const on = await runCaptured({ gate: true });
  assert.ok(off.lines.length > 0, "precondition: the fixture must produce decision lines");
  // The one decision the gate CHANGES is the trimmed cluster's rename of u-story
  // (held articles must not retitle the event). Every other line is untouched.
  const changedByGate = (l) => l.startsWith("🧭 promoter-match ") && l.includes('"cluster":"cl-unrelated"');
  assert.deepEqual(on.lines.filter((l) => !l.startsWith("🧭 coherence-hold ")), off.lines.filter((l) => !changedByGate(l)));
  assert.equal(off.lines.filter(changedByGate).length, 1, "precondition: with the gate off the unrelated cluster renames u-story");
});

test("a trimmed cluster does not rename the event", async (t) => {
  if (!isVecAvailable()) { t.skip("sqlite-vec unavailable"); return; }
  process.env.EVENT_COHERENCE_GATE = "true";
  db.exec("SAVEPOINT ren");
  try {
    await runEventPromoter({ now: NOW, _yielder: async () => true });
    assert.equal(db.prepare("SELECT title FROM events WHERE id='ev-u'").get().title, "Story u");
    assert.equal(db.prepare("SELECT title FROM events WHERE id='ev-r'").get().title, "Cluster cl-related", "an untrimmed match still adopts");
  } finally {
    db.exec("ROLLBACK TO ren"); db.exec("RELEASE ren");
    delete process.env.EVENT_COHERENCE_GATE;
  }
});

test("create path: a brand-new event is minted without the cluster's own outliers", async (t) => {
  if (!isVecAvailable()) { t.skip("sqlite-vec unavailable"); return; }
  const core = ["n-c0", "n-c1", "n-c2", "n-c3"];
  const odd = ["n-o0", "n-o1", "n-o2", "n-o3", "n-o4", "n-o5"];
  for (const id of core) article(id, ["V1", "V2"], { dir: "w" });
  odd.forEach((id, i) => article(id, [`W${i}`], { dir: "w" })); // six different one-off stories
  db.exec("SAVEPOINT cre");
  process.env.EVENT_COHERENCE_GATE = "true";
  try {
    seedCluster("cl-new", [...core, ...odd]);
    await runEventPromoter({ now: NOW, _yielder: async () => true });
    const ev = db.prepare("SELECT id FROM events WHERE cluster_id = 'cl-new'").get();
    assert.ok(ev, "the event is still created");
    assert.deepEqual(linked(ev.id), new Set(core));
  } finally {
    delete process.env.EVENT_COHERENCE_GATE;
    db.exec("ROLLBACK TO cre"); db.exec("RELEASE cre");
  }
});

// ── slug follows headline ───────────────────────────────────────────────────
test("slug follows headline: off by default, on it mints a new slug and the old one resolves", () => {
  db.prepare(`INSERT INTO events (id, slug, title, category, status, started_at, last_activity_at, meta, created_at, updated_at)
              VALUES ('ev-s', 'flood-in-lahore', 'Flood in Lahore', 'world', 'active', ?, ?, '{}', ?, ?)`).run(NOW, NOW, NOW, NOW);
  delete process.env.EVENT_SLUG_FOLLOWS_HEADLINE;
  assert.equal(maybeFollowHeadline(db, "ev-s", "flood-in-lahore", "Karachi port strike enters third day", NOW), null);

  process.env.EVENT_SLUG_FOLLOWS_HEADLINE = "true";
  try {
    // A headline that keeps the story's words is not a material change.
    assert.equal(maybeFollowHeadline(db, "ev-s", "flood-in-lahore", "Lahore flood death toll rises", NOW), null);
    const next = maybeFollowHeadline(db, "ev-s", "flood-in-lahore", "Karachi port strike enters third day", NOW);
    assert.equal(next, "karachi-port-strike-enters-third-day");
    assert.equal(db.prepare("SELECT slug FROM events WHERE id='ev-s'").get().slug, next);
    assert.equal(resolveSlugAlias(db, "flood-in-lahore"), next);
    // Renamed twice: both old slugs still answer the CURRENT one in one hop.
    const third = maybeFollowHeadline(db, "ev-s", next, "Senate passes budget after all-night session", NOW);
    assert.equal(resolveSlugAlias(db, "flood-in-lahore"), third);
    assert.equal(resolveSlugAlias(db, next), third);
    assert.equal(resolveSlugAlias(db, third), null, "a live slug is not an alias");
  } finally {
    delete process.env.EVENT_SLUG_FOLLOWS_HEADLINE;
  }
  assert.ok(slugOverlap("flood-in-lahore", "lahore-flood-toll-rises") >= 0.5);
  assert.ok(slugOverlap("flood-in-lahore-2", "karachi-port-strike") < 0.5);
});

test("dossierCoherence reports score, level and floor; the kill switch removes it", () => {
  const c = dossierCoherence(db, "ev-r");
  assert.equal(c.score, 1);
  assert.equal(c.level, "ok");
  assert.equal(c.floor, 0.6);
  process.env.EVENT_COHERENCE_API = "false";
  try { assert.equal(dossierCoherence(db, "ev-r"), undefined); }
  finally { delete process.env.EVENT_COHERENCE_API; }
});
