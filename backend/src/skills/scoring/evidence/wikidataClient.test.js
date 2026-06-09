/**
 * wikidataClient.test.js — B.6.2c-1 tests (node --test, offline).
 *
 * Mocks the Wikidata Action API (wbsearchentities) + SPARQL responses via an
 * injected transport. Covers the resolver crux: strict host-equality + type
 * filter + single-match-or-pending (the Guardian case: article+person+database+
 * publisher → only the publisher resolves), ambiguous → unresolved, none →
 * unresolved, owner/parent capture, and fetchJson behavior.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchJson } from "./httpFetch.js";
import { resolveOrgByDomain } from "./wikidataClient.js";

// ── transport mock: routes by URL (Action API search vs SPARQL) ──────────────
function makeTransport({ search = [], rows = [] }) {
  return async (url, opts) => {
    let payload;
    if (url.includes("/w/api.php")) {
      payload = { search: search.map((s) => ({ id: s.id, label: s.label })) };
    } else if (url.includes("/sparql")) {
      payload = { results: { bindings: rows } };
    } else {
      payload = {};
    }
    const status = 200;
    if (opts.validateStatus && !opts.validateStatus(status)) { const e = new Error("s"); e.response = { status }; throw e; }
    return { status, data: JSON.stringify(payload), headers: { "content-type": "application/json" }, finalUrl: url };
  };
}
// SPARQL binding-row builder.
function row({ qid, label, website, isOrg = false, isMedia = false, isHuman = false, p31, owner, ownerLabel, parent, parentLabel }) {
  const b = {
    item: { value: `http://www.wikidata.org/entity/${qid}` },
    itemLabel: { value: label },
    website: { value: website },
    isOrg: { datatype: "http://www.w3.org/2001/XMLSchema#boolean", value: String(isOrg) },
    isMedia: { datatype: "http://www.w3.org/2001/XMLSchema#boolean", value: String(isMedia) },
    isHuman: { datatype: "http://www.w3.org/2001/XMLSchema#boolean", value: String(isHuman) },
  };
  if (p31) b.p31Label = { value: p31 };
  if (owner) { b.owner = { value: `http://www.wikidata.org/entity/${owner}` }; b.ownerLabel = { value: ownerLabel }; }
  if (parent) { b.parent = { value: `http://www.wikidata.org/entity/${parent}` }; b.parentLabel = { value: parentLabel }; }
  return b;
}

test("happy path — clean org (host==domain, isMedia, owner) → resolved with owner", async () => {
  const transport = makeTransport({
    search: [{ id: "Q5614018", label: "TheGuardian.com" }],
    rows: [row({ qid: "Q5614018", label: "TheGuardian.com", website: "https://www.theguardian.com/", isMedia: true, p31: "online newspaper", owner: "Q1242240", ownerLabel: "Guardian Media Group" })],
  });
  const r = await resolveOrgByDomain("theguardian.com", { transport });
  assert.equal(r.resolved, true);
  assert.equal(r.entity.qid, "Q5614018");
  assert.equal(r.owner.label, "Guardian Media Group");
});

test("type filter (the Guardian case) — article + person + database + publisher → only the publisher resolves", async () => {
  const transport = makeTransport({
    search: [{ id: "Q5614018" }, { id: "Q134301382" }, { id: "Q58195680" }, { id: "Q116082602" }],
    rows: [
      row({ qid: "Q134301382", label: "There is no noise…", website: "https://www.theguardian.com/x", p31: "photographic essay" }),       // creative work
      row({ qid: "Q58195680", label: "Zoë Corbyn", website: "https://www.theguardian.com/profile/z", isHuman: true, p31: "human" }),       // person
      row({ qid: "Q116082602", label: "The Counted", website: "https://www.theguardian.com/db", p31: "database" }),                        // database
      row({ qid: "Q5614018", label: "TheGuardian.com", website: "https://www.theguardian.com/", isMedia: true, p31: "online newspaper", owner: "Q1242240", ownerLabel: "Guardian Media Group" }), // publisher
    ],
  });
  const r = await resolveOrgByDomain("theguardian.com", { transport });
  assert.equal(r.resolved, true);
  assert.equal(r.entity.qid, "Q5614018", "only the org-typed exact-host entity resolves");
  assert.equal(r.owner.label, "Guardian Media Group");
});

test("host-equality — a candidate on a different/subdomain host is excluded", async () => {
  const transport = makeTransport({
    search: [{ id: "Q9531" }],
    rows: [row({ qid: "Q9531", label: "BBC", website: "https://www.bbc.co.uk/", isOrg: true, p31: "public broadcaster" })], // bbc.co.uk ≠ bbc.com
  });
  const r = await resolveOrgByDomain("bbc.com", { transport });
  assert.equal(r.resolved, false);
  assert.equal(r.reason, "no-entity");
});

test("ambiguous — two org-typed exact-host candidates → unresolved (NEVER pick one)", async () => {
  const transport = makeTransport({
    search: [{ id: "Q100" }, { id: "Q200" }],
    rows: [
      row({ qid: "Q100", label: "Outlet A", website: "https://example.com/", isOrg: true, p31: "newspaper" }),
      row({ qid: "Q200", label: "Outlet B", website: "https://www.example.com/", isMedia: true, p31: "online newspaper" }),
    ],
  });
  const r = await resolveOrgByDomain("example.com", { transport });
  assert.equal(r.resolved, false);
  assert.equal(r.reason, "ambiguous");
  assert.equal(r.candidates.length, 2);
});

test("none — no search candidates → unresolved no-entity", async () => {
  const r = await resolveOrgByDomain("nowhere.example", { transport: makeTransport({ search: [], rows: [] }) });
  assert.equal(r.resolved, false);
  assert.equal(r.reason, "no-entity");
});

test("owner + parent capture — P127 + P749 both present", async () => {
  const transport = makeTransport({
    search: [{ id: "Q300" }],
    rows: [row({ qid: "Q300", label: "Outlet", website: "https://outlet.example/", isMedia: true, p31: "online newspaper", owner: "Q301", ownerLabel: "Immediate Owner", parent: "Q302", parentLabel: "Parent Co" })],
  });
  const r = await resolveOrgByDomain("outlet.example", { transport });
  assert.equal(r.owner.label, "Immediate Owner");
  assert.equal(r.parent.label, "Parent Co");
});

test("org resolved but NO owner → resolved, owner null (B.6.2c-2 maps this)", async () => {
  const transport = makeTransport({
    search: [{ id: "Q400" }],
    rows: [row({ qid: "Q400", label: "Indie Outlet", website: "https://indie.example/", isOrg: true, p31: "nonprofit organization" })],
  });
  const r = await resolveOrgByDomain("indie.example", { transport });
  assert.equal(r.resolved, true);
  assert.equal(r.owner, null);
});

// ── retry + backoff (#116, scoped to the Wikidata client) ───────────────────────
test("retry — transient (timeout) on search retries then succeeds", async () => {
  let attempts = 0;
  const transport = async (url) => {
    if (url.includes("/w/api.php")) {
      attempts += 1;
      if (attempts < 3) { const e = new Error("aborted"); e.code = "ECONNABORTED"; throw e; } // → timeout
      return { status: 200, data: JSON.stringify({ search: [{ id: "Q300" }] }), headers: {}, finalUrl: url };
    }
    return { status: 200, data: JSON.stringify({ results: { bindings: [row({ qid: "Q300", label: "Outlet", website: "https://outlet.example/", isMedia: true, p31: "online newspaper", owner: "Q301", ownerLabel: "Owner Co" })] } }), headers: {}, finalUrl: url };
  };
  const r = await resolveOrgByDomain("outlet.example", { transport, wikidataBackoffMs: 0 });
  assert.equal(attempts, 3, "two transient failures + success = 3 attempts");
  assert.equal(r.resolved, true);
  assert.equal(r.owner.label, "Owner Co");
});

test("retry — exhausts on persistent transient (dns) → query-failed:dns after maxAttempts", async () => {
  let attempts = 0;
  const transport = async (url) => {
    if (url.includes("/w/api.php")) { attempts += 1; const e = new Error("dns"); e.code = "EAI_AGAIN"; throw e; } // → dns
    return { status: 200, data: "{}", headers: {}, finalUrl: url };
  };
  const r = await resolveOrgByDomain("flaky.example", { transport, wikidataBackoffMs: 0 });
  assert.equal(attempts, 3, "1 initial + 2 retries");
  assert.equal(r.resolved, false);
  assert.equal(r.reason, "query-failed:dns");
});

test("retry — NON-transient (404 not-found) is NOT retried", async () => {
  let attempts = 0;
  const transport = async (url) => {
    if (url.includes("/w/api.php")) { attempts += 1; const e = new Error("nf"); e.response = { status: 404 }; throw e; } // → not-found
    return { status: 200, data: "{}", headers: {}, finalUrl: url };
  };
  const r = await resolveOrgByDomain("x.example", { transport, wikidataBackoffMs: 0 });
  assert.equal(attempts, 1, "non-transient → single attempt");
  assert.equal(r.reason, "query-failed:not-found");
});

test("retry — successful-but-empty search is not a failure (no retry → no-entity)", async () => {
  let attempts = 0;
  const transport = async (url) => {
    attempts += 1;
    if (url.includes("/w/api.php")) return { status: 200, data: JSON.stringify({ search: [] }), headers: {}, finalUrl: url };
    return { status: 200, data: "{}", headers: {}, finalUrl: url };
  };
  const r = await resolveOrgByDomain("nowhere.example", { transport, wikidataBackoffMs: 0 });
  assert.equal(attempts, 1, "a clean empty response is not retried");
  assert.equal(r.reason, "no-entity");
});

// ── fetchJson ─────────────────────────────────────────────────────────────────
test("fetchJson — parses JSON; HTML body → parse-error; bad URL → unsafe-url", async () => {
  const okT = async () => ({ status: 200, data: '{"a":1}', headers: {}, finalUrl: "u" });
  assert.deepEqual((await fetchJson("https://x.example/api", { transport: okT })).json, { a: 1 });
  const htmlT = async () => ({ status: 200, data: "<html></html>", headers: {}, finalUrl: "u" });
  const r = await fetchJson("https://x.example/api", { transport: htmlT });
  assert.equal(r.ok, false); assert.equal(r.reason, "parse-error");
  const bad = await fetchJson("http://127.0.0.1/api", {});
  assert.equal(bad.ok, false); assert.equal(bad.reason, "unsafe-url");
});
