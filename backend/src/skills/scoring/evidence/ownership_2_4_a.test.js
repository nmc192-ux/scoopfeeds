/**
 * ownership_2_4_a.test.js — B.6.2c-2 tests (node --test, offline).
 *
 * Integration: temp DB (source + articles → editorial domain) + mocked Wikidata
 * transport (wbsearchentities + VALUES-SPARQL). Covers the ruled mapping and the
 * owner-convergence disambiguation incl. the genuine-unanimity guardrail.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runMigrations } from "../../../db/migrate.js";
import ownership from "./modules/ownership_2_4_a.js";

const NOW = Date.now();
const DOMAIN = "testoutlet.example";

// SPARQL binding row.
function row({ qid, label, host = DOMAIN, isOrg = false, isMedia = false, isHuman = false, p31, owner, ownerLabel, parent, parentLabel }) {
  const b = {
    item: { value: `http://www.wikidata.org/entity/${qid}` },
    itemLabel: { value: label },
    website: { value: `https://www.${host}/` },
    isOrg: { value: String(isOrg) }, isMedia: { value: String(isMedia) }, isHuman: { value: String(isHuman) },
  };
  if (p31) b.p31Label = { value: p31 };
  if (owner) { b.owner = { value: `http://www.wikidata.org/entity/${owner}` }; b.ownerLabel = { value: ownerLabel }; }
  if (parent) { b.parent = { value: `http://www.wikidata.org/entity/${parent}` }; b.parentLabel = { value: parentLabel }; }
  return b;
}

// Transport mock: routes Action-API search vs SPARQL; apiStatus simulates Wikidata-down.
function makeTransport({ search = [], rows = [], apiStatus = 200 }) {
  return async (url, opts) => {
    let status = 200, payload;
    if (url.includes("/w/api.php")) { status = apiStatus; payload = { search: search.map((s) => ({ id: s.id, label: s.label || s.id })) }; }
    else if (url.includes("/sparql")) { payload = { results: { bindings: rows } }; }
    else payload = {};
    if (opts.validateStatus && !opts.validateStatus(status)) { const e = new Error("s" + status); e.response = { status }; throw e; }
    return { status, data: JSON.stringify(payload), headers: { "content-type": "application/json" }, finalUrl: url };
  };
}

function makeEnv(wd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoring-own-"));
  const db = new Database(path.join(dir, "t.db"));
  runMigrations(db);
  db.exec(`CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, url TEXT, source_name TEXT NOT NULL, published_at INTEGER NOT NULL, is_duplicate INTEGER DEFAULT 0);`);
  const sid = db.prepare(`INSERT INTO sources (name,url,source_type,category,region,created_at,updated_at) VALUES ('TestOutlet','https://feeds.testoutlet.example/rss','rss','tech','global',?,?)`).run(NOW, NOW).lastInsertRowid;
  const ins = db.prepare(`INSERT INTO articles (id,url,source_name,published_at,is_duplicate) VALUES (?,?,?,?,0)`);
  for (let i = 0; i < 5; i++) ins.run(`a${i}`, `https://${DOMAIN}/news/${i}`, "TestOutlet", NOW - i * 86400000);
  return { db, sid, transport: makeTransport(wd), cleanup: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const run = async (env) => ownership.gather({ id: env.sid, name: "TestOutlet" }, { db: env.db, now: NOW, transport: env.transport, methodologyVersion: "v1.1" });

// ── ruled mapping ─────────────────────────────────────────────────────────────
test("resolved + owner → EVIDENCED with named owner", async () => {
  const env = makeEnv({ search: [{ id: "Q1" }], rows: [row({ qid: "Q1", label: "TestOutlet", isMedia: true, p31: "online newspaper", owner: "Q2", ownerLabel: "Owner Co" })] });
  const ev = await run(env);
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.owner.label, "Owner Co");
  assert.equal(ev.value.basis, "wikidata");
  assert.match(ev.evidenceUrl, /Q1$/);
  env.cleanup();
});

test("resolved + structural type (nonprofit) → EVIDENCED via type", async () => {
  const env = makeEnv({ search: [{ id: "Q1" }], rows: [row({ qid: "Q1", label: "Indie", isOrg: true, p31: "nonprofit organization" })] });
  const ev = await run(env);
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.owner, null);
  assert.ok(ev.value.structuralType.some((t) => /nonprofit/i.test(t)));
  env.cleanup();
});

test("resolved + no owner + no structural type → PENDING", async () => {
  const env = makeEnv({ search: [{ id: "Q1" }], rows: [row({ qid: "Q1", label: "PrivateCo", isOrg: true, p31: "business enterprise" })] });
  const ev = await run(env);
  assert.equal(ev.status, "pending");
  assert.match(ev.value.note, /no owner/i);
  env.cleanup();
});

test("no-entity → PENDING", async () => {
  const env = makeEnv({ search: [], rows: [] });
  const ev = await run(env);
  assert.equal(ev.status, "pending");
  assert.equal(ev.value.reason, "no-entity");
  env.cleanup();
});

test("Wikidata unreachable (API 500) → BLOCKED (not false-absence)", async () => {
  const env = makeEnv({ search: [{ id: "Q1" }], apiStatus: 500 });
  const ev = await run(env);
  assert.equal(ev.status, "blocked");
  assert.match(ev.value.reason, /query-failed/);
  env.cleanup();
});

// ── owner-convergence ─────────────────────────────────────────────────────────
test("ambiguous + ALL candidates share the same owner → EVIDENCED (owner-convergence)", async () => {
  const env = makeEnv({
    search: [{ id: "Q1" }, { id: "Q2" }],
    rows: [
      row({ qid: "Q1", label: "Outlet (newspaper)", isMedia: true, p31: "newspaper", owner: "Q9", ownerLabel: "Shared Owner" }),
      row({ qid: "Q2", label: "Outlet.com (website)", isOrg: true, p31: "online newspaper", owner: "Q9", ownerLabel: "Shared Owner" }),
    ],
  });
  const ev = await run(env);
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.ownershipBasis, "owner-convergence");
  assert.equal(ev.value.entityAmbiguous, true);
  assert.equal(ev.value.resolvedOwner.label, "Shared Owner");
  env.cleanup();
});

test("ambiguous + CONFLICTING owners → PENDING (ambiguous-conflicting-owners)", async () => {
  const env = makeEnv({
    search: [{ id: "Q1" }, { id: "Q2" }],
    rows: [
      row({ qid: "Q1", label: "Outlet A", isMedia: true, p31: "newspaper", owner: "Q9", ownerLabel: "Owner Nine" }),
      row({ qid: "Q2", label: "Outlet B", isOrg: true, p31: "online newspaper", owner: "Q8", ownerLabel: "Owner Eight" }),
    ],
  });
  const ev = await run(env);
  assert.equal(ev.status, "pending");
  assert.equal(ev.value.reason, "ambiguous-conflicting-owners");
  env.cleanup();
});

test("GUARDRAIL — 2-of-3 agree but one has NO owner → CONFLICT → PENDING (never majority)", async () => {
  const env = makeEnv({
    search: [{ id: "Q1" }, { id: "Q2" }, { id: "Q3" }],
    rows: [
      row({ qid: "Q1", label: "A", isMedia: true, p31: "newspaper", owner: "Q9", ownerLabel: "Owner Nine" }),
      row({ qid: "Q2", label: "B", isMedia: true, p31: "newspaper", owner: "Q9", ownerLabel: "Owner Nine" }),
      row({ qid: "Q3", label: "C", isOrg: true, p31: "magazine" }), // no owner → breaks unanimity
    ],
  });
  const ev = await run(env);
  assert.equal(ev.status, "pending", "majority agreement is NOT convergence — any null/differing owner → pending");
  assert.equal(ev.value.reason, "ambiguous-conflicting-owners");
  env.cleanup();
});

test("ambiguous + no owners but ALL share a parent → EVIDENCED (parent-convergence)", async () => {
  const env = makeEnv({
    search: [{ id: "Q1" }, { id: "Q2" }],
    rows: [
      row({ qid: "Q1", label: "Edition A", isMedia: true, p31: "newspaper", parent: "Q5", parentLabel: "Parent Org" }),
      row({ qid: "Q2", label: "Edition B", isMedia: true, p31: "newspaper", parent: "Q5", parentLabel: "Parent Org" }),
    ],
  });
  const ev = await run(env);
  assert.equal(ev.status, "evidenced");
  assert.equal(ev.value.ownershipBasis, "parent-convergence");
  assert.equal(ev.value.resolvedParent.label, "Parent Org");
  env.cleanup();
});

test("evidence-only — sources.quality_score stays NULL", async () => {
  const env = makeEnv({ search: [{ id: "Q1" }], rows: [row({ qid: "Q1", label: "X", isMedia: true, p31: "newspaper", owner: "Q2", ownerLabel: "Owner" })] });
  await run(env);
  assert.equal(env.db.prepare("SELECT quality_score FROM sources WHERE id=?").get(env.sid).quality_score, null);
  env.cleanup();
});
