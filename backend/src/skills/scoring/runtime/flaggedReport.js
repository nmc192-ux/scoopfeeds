/**
 * flaggedReport.js — pure builder for the founder-review surface (B.6.4b).
 *
 * Turns the DAO's flagged + model-not-validated rows into display rows + a JSON report.
 * Deterministic, no I/O — unit-testable. Normalizes the two grounding shapes:
 *   single-page judgments → value.groundingQuotes:[string]   (2.1.d/2.4.b/2.5.b)
 *   aggregated judgments  → value.quotes:[{quote, article}]  (2.2.a/2.3.d/2.2.c/2.2.d)
 * Missing/ungrounded → an explicit "(ungrounded)" marker, never a blank.
 */

const QUOTE_DISPLAY_CAP = 160;

function normalizeQuote(value) {
  if (Array.isArray(value?.groundingQuotes) && value.groundingQuotes.length) return value.groundingQuotes[0] || null;
  if (Array.isArray(value?.quotes) && value.quotes.length) return value.quotes[0]?.quote || null;
  return null;
}
function truncate(s, n = QUOTE_DISPLAY_CAP) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function rowFrom(e, { labels = {}, getComponent } = {}, kind = "flagged") {
  const v = e.value || {};
  const q = normalizeQuote(v);
  return {
    source: e.source_name,
    sourceId: e.source_id,
    subCriterion: e.sub_criterion,
    label: labels[e.sub_criterion] ?? null,
    component: getComponent ? getComponent(e.sub_criterion) ?? null : null,
    status: e.status,
    bucketOrReason: v.bucket ?? v.reason ?? e.status,
    confidence: e.confidence,
    reason: v.reason ?? null,
    model: v.model ?? null, // populated on model-not-validated ops rows
    ungrounded: v.ungrounded === true || v.ungroundedAtSource === true || q == null,
    // ops rows aren't grounding judgments → no quote; flagged rows show the locus quote
    quote: kind === "ops" ? null : (q ? truncate(q) : "(ungrounded)"),
    evidenceUrl: e.evidence_url ?? null,
  };
}

/**
 * buildFlaggedReport(flagged, ops, {labels, getComponent}, now)
 *   → { rows, opsRows, json:{ generatedAt, flaggedCount, operationalAnomalyCount, flagged, operationalAnomalies } }
 * `flagged` arrives confidence-asc from the DAO; re-sorted defensively (nulls last).
 */
export function buildFlaggedReport(flagged = [], ops = [], opts = {}, now) {
  const rows = flagged.map((e) => rowFrom(e, opts, "flagged"))
    .sort((a, b) => (a.confidence ?? Infinity) - (b.confidence ?? Infinity));
  const opsRows = ops.map((e) => rowFrom(e, opts, "ops"));
  return {
    rows,
    opsRows,
    json: {
      generatedAt: now ?? Date.now(),
      flaggedCount: rows.length,
      operationalAnomalyCount: opsRows.length,
      flagged: rows,
      operationalAnomalies: opsRows,
    },
  };
}
