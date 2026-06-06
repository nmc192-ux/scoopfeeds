/**
 * scoring-flagged.mjs — founder-review surface CLI (B.6.4b).
 *
 * Prints the corpus-wide flagged judgments (founderFlag=1, lowest-confidence first) +
 * a separate operational-anomalies section (model-not-validated), and writes a JSON
 * report to data/scoring-flagged-report.json (SEPARATE from the dashboard's status.json).
 *
 * SURFACE-ONLY: read/render. No LLM, no migration, no override-write. Run:
 *   npm run scoring:flagged
 */

import "../src/config/env.js";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/models/database.js";
import { logger } from "../src/services/logger.js";
import { listFlaggedEvidence, listModelNotValidatedEvidence } from "../src/skills/scoring/evidence/evidenceCache.js";
import { getModule } from "../src/skills/scoring/evidence/registry.js";
import { buildFlaggedReport } from "../src/skills/scoring/runtime/flaggedReport.js";

// Sub-criterion id → human label (from the methodology). Unknown ids fall back to the id.
const SUBCRITERION_LABELS = {
  "2.1.d": "Functioning corrections process",
  "2.4.b": "Funding mix transparent",
  "2.2.a": "Source attribution",
  "2.3.d": "Quality of sourcing within the beat",
  "2.2.c": "Methodology disclosure on data journalism",
  "2.2.d": "Conflicts of interest disclosed",
  "2.5.b": "Correction rate and severity",
};
const getComponent = (id) => getModule(id)?.component ?? null;

const db = getDb();

// The scoring tables may not exist yet in this DB (#112 — migrations 006/007 unapplied).
const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scoring_evidence_cache'").get();
if (!hasTable) {
  console.log("scoring evidence not initialized in this DB (migrations 006/007 not applied — #112). Nothing to review yet.");
  process.exit(0);
}

const flagged = listFlaggedEvidence(db);
const ops = listModelNotValidatedEvidence(db);
const { rows, opsRows, json } = buildFlaggedReport(flagged, ops, { labels: SUBCRITERION_LABELS, getComponent }, Date.now());

console.log(`\n🔎 FOUNDER REVIEW — ${rows.length} flagged judgment(s) (lowest confidence first)\n`);
if (!rows.length) console.log("  (none)");
for (const r of rows) {
  const label = r.label ? ` (${r.label})` : "";
  console.log(`  [conf ${String(r.confidence ?? "—").padStart(4)}] ${r.source} · ${r.subCriterion}${label} [${r.component ?? "?"}]`);
  console.log(`        verdict: ${r.bucketOrReason}${r.evidenceUrl ? `   · ${r.evidenceUrl}` : ""}`);
  console.log(`        quote:   ${r.quote}`);
}

console.log(`\n⚙  OPERATIONAL ANOMALIES — ${opsRows.length} model-not-validated (gated judgment did not run; #109)\n`);
if (!opsRows.length) console.log("  (none)");
for (const r of opsRows) {
  console.log(`  ${r.source} · ${r.subCriterion} → ${r.reason} (model: ${r.model ?? "?"})`);
}

const dataDir = process.env.SCOOP_PERSISTENT_DATA_DIR ? path.resolve(process.env.SCOOP_PERSISTENT_DATA_DIR) : path.resolve(process.cwd(), "data");
const out = path.join(dataDir, "scoring-flagged-report.json"); // NOT the dashboard's status.json
try {
  fs.writeFileSync(out, JSON.stringify(json, null, 2));
  console.log(`\n📄 report written: ${out}`);
} catch (e) {
  logger.warn(`could not write flagged report (${out}): ${e.message}`);
}
