/**
 * founderReview.test.js — B.6.4b tests (node --test, offline).
 *
 * The flagged-evidence DAO (json_extract, no migration) + the pure report builder.
 * Temp DB seeded with a flagged evidenced row, a flagged pending-llm row, a NON-flagged
 * evidenced row, and a model-not-validated ops row.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runMigrations } from "../../../db/migrate.js";
import { upsertEvidence, listFlaggedEvidence, listModelNotValidatedEvidence } from "../evidence/evidenceCache.js";
import { buildFlaggedReport } from "./flaggedReport.js";

const NOW = 1_750_000_000_000;

function env() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoring-fr-"));
  const db = new Database(path.join(dir, "t.db"));
  runMigrations(db);
  const sid = db.prepare(`INSERT INTO sources (name,url,source_type,category,region,created_at,updated_at) VALUES ('FlagSrc','https://flag.example/rss','rss','tech','global',?,?)`).run(NOW, NOW).lastInsertRowid;
  return { db, sid, cleanup: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const put = (env, sub, ev) => upsertEvidence(env.sid, sub, { evidenceUrl: null, gatheredAt: NOW, ...ev }, "v1.1", env.db);

// ── DAO ──────────────────────────────────────────────────────────────────────
test("listFlaggedEvidence — returns only founderFlag=1 rows, lowest-confidence first, hydrated", () => {
  const e = env();
  // flagged aggregated judgment (conf 0.48, ungroundedAtSource)
  put(e, "2.3.d", { status: "evidenced", confidence: 0.48, value: { bucket: "mixed", quotes: [{ quote: "cited an expert here", article: "https://flag.example/a" }], ungroundedAtSource: false, founderFlag: true }, evidenceUrl: "https://flag.example/a" });
  // flagged pending-llm split (conf 0)
  put(e, "2.2.c", { status: "pending-llm", confidence: 0, value: { reason: "runs-disagree", founderFlag: true } });
  // NON-flagged evidenced (conf 0.9) — must NOT appear
  put(e, "2.1.d", { status: "evidenced", confidence: 0.9, value: { bucket: "public corrections log", groundingQuotes: ["Public corrections log"], ungrounded: false, founderFlag: false } });
  // model-not-validated ops row (no founderFlag)
  put(e, "2.2.d", { status: "unavailable", confidence: 0, value: { reason: "model-not-validated", model: "llama3.2:latest", basis: "model-guard" } });

  const flagged = listFlaggedEvidence(e.db);
  assert.equal(flagged.length, 2, "only the two founderFlag=1 rows");
  assert.deepEqual(flagged.map((r) => r.sub_criterion), ["2.2.c", "2.3.d"], "lowest-confidence first (0 before 0.48)");
  assert.equal(flagged[0].source_name, "FlagSrc", "source name joined");
  assert.equal(flagged[1].value.bucket, "mixed", "value hydrated");
  assert.ok(!flagged.some((r) => r.sub_criterion === "2.1.d"), "non-flagged excluded");
  assert.ok(!flagged.some((r) => r.sub_criterion === "2.2.d"), "model-not-validated (no founderFlag) excluded");
  e.cleanup();
});

test("listModelNotValidatedEvidence — returns only the ops rows", () => {
  const e = env();
  put(e, "2.3.d", { status: "evidenced", confidence: 0.48, value: { bucket: "mixed", founderFlag: true } });
  put(e, "2.2.d", { status: "unavailable", confidence: 0, value: { reason: "model-not-validated", model: "llama3.2:latest", basis: "model-guard" } });
  const ops = listModelNotValidatedEvidence(e.db);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].sub_criterion, "2.2.d");
  assert.equal(ops[0].value.model, "llama3.2:latest");
  e.cleanup();
});

// ── builder (pure) ────────────────────────────────────────────────────────────
const labels = { "2.3.d": "Quality of sourcing", "2.5.b": "Correction severity", "2.2.c": "Data-journalism methodology" };
const getComponent = (id) => ({ "2.3.d": "DE", "2.5.b": "HA", "2.2.c": "MT", "2.2.d": "MT" }[id] ?? null);

test("buildFlaggedReport — normalizes both grounding shapes; lowest-conf order; json shape", () => {
  const flagged = [
    // aggregated shape (quotes:[{quote,article}])
    { source_name: "Src A", source_id: 1, sub_criterion: "2.3.d", status: "evidenced", confidence: 0.48, evidence_url: "https://a/1", value: { bucket: "mixed", quotes: [{ quote: "an expert said X", article: "https://a/1" }] } },
    // single-page shape (groundingQuotes:[string]), ungrounded
    { source_name: "Src B", source_id: 2, sub_criterion: "2.5.b", status: "evidenced", confidence: 0.4, evidence_url: "https://b/2", value: { bucket: "substantive errors common", groundingQuotes: [], ungrounded: true } },
  ];
  const ops = [
    { source_name: "Src C", source_id: 3, sub_criterion: "2.2.c", status: "unavailable", confidence: 0, evidence_url: null, value: { reason: "model-not-validated", model: "llama3.2:latest" } },
  ];
  const { rows, opsRows, json } = buildFlaggedReport(flagged, ops, { labels, getComponent }, NOW);

  assert.deepEqual(rows.map((r) => r.confidence), [0.4, 0.48], "lowest-confidence first");
  const b = rows.find((r) => r.subCriterion === "2.5.b");
  assert.equal(b.quote, "(ungrounded)", "ungrounded → explicit marker, not blank");
  const a = rows.find((r) => r.subCriterion === "2.3.d");
  assert.equal(a.quote, "an expert said X", "aggregated quote normalized");
  assert.equal(a.label, "Quality of sourcing");
  assert.equal(a.component, "DE");
  assert.equal(opsRows.length, 1);
  assert.equal(opsRows[0].quote, null, "ops rows carry no grounding quote");
  assert.equal(opsRows[0].model, "llama3.2:latest");
  assert.equal(json.flaggedCount, 2);
  assert.equal(json.operationalAnomalyCount, 1);
  assert.equal(json.generatedAt, NOW);
  assert.equal(json.flagged.length, 2);
  assert.equal(json.operationalAnomalies.length, 1);
});

test("buildFlaggedReport — single-page grounded quote (groundingQuotes[0]) normalized + truncated", () => {
  const long = "x".repeat(300);
  const flagged = [{ source_name: "S", source_id: 1, sub_criterion: "2.1.d", status: "evidenced", confidence: 0.3, evidence_url: null, value: { bucket: "no corrections process", groundingQuotes: [long] } }];
  const { rows } = buildFlaggedReport(flagged, [], {}, NOW);
  assert.ok(rows[0].quote.endsWith("…"), "long quote truncated");
  assert.ok(rows[0].quote.length < long.length);
});

test("buildFlaggedReport — empty inputs → empty report (no crash)", () => {
  const { rows, opsRows, json } = buildFlaggedReport([], [], { labels, getComponent }, NOW);
  assert.deepEqual(rows, []);
  assert.deepEqual(opsRows, []);
  assert.equal(json.flaggedCount, 0);
});
