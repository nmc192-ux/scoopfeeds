/**
 * trackerFormat — shared display helpers for the Tracker Auto-Detection
 * Engine UI (Sprint 1.5.3).
 *
 * Single source of truth for tracker formatting logic, extracted from
 * TrackerCard.jsx (Sprint 1.5.2) so both Layer 1 (TrackerCard) and Layer 2
 * (TrackerPage, /trackers/:id) render from the SAME functions. Critical for
 * provenanceLabel in particular: its _origin-precedence rule was bug-fixed
 * during 1.5.2 review (wire-density conflict trackers carry
 * _ingester_status:"live" but must label as "wire-sourced", not
 * "source-verified") — duplicating that logic would let the two layers drift.
 *
 * All functions here are pure (string/data → string/data); the only React
 * coupling is that confidenceBadgeClass / provenanceLabel emit Tailwind class
 * strings / take a t() translator. No JSX lives here.
 */

import { confidenceStrength } from "./trackerRank";

// Per-template ordered headline-metric preference (from each template's §5
// Layer 1 spec). resolveHeadline walks the list and uses the first metric
// block present. conflict + environmental are precise; the rest are
// reasonable primaries with a generic fallback below.
export const PREFERRED_METRICS = Object.freeze({
  conflict:      ["casualties_killed", "casualties_wounded", "event_count"],
  environmental: ["magnitude_intensity", "affected_population", "affected_area"],
  outbreak:      ["confirmed_cases", "deaths", "suspected_cases"],
  incident:      ["casualties_killed", "people_affected", "casualties_injured"],
  sports:        ["score", "series_state"],
  election:      ["votes_by_contestant", "count_completion_pct"],
  entertainment: ["box_office_opening", "box_office_cumulative", "worldwide_total"],
  study:         ["finding_summary", "study_type"],
});

// Short human label per metric_name (English source; t() can localize).
export const METRIC_LABELS = Object.freeze({
  casualties_killed:  "killed",
  casualties_wounded: "wounded",
  casualties_injured: "injured",
  people_affected:    "affected",
  event_count:        "events",
  affected_population: "affected",
  confirmed_cases:    "confirmed cases",
  deaths:             "deaths",
  suspected_cases:    "suspected cases",
  count_completion_pct: "% counted",
  box_office_opening: "opening",
  box_office_cumulative: "cumulative",
  worldwide_total:    "worldwide",
});

// Confidence strength → badge color (matches EventCard's dark-aware badge
// palette). Strength ordinal (0–3) comes from trackerRank (single source of
// truth, shared with the multi-tracker headline ranking). 3=strong/green,
// 2=medium/amber, 1=weak/gray.
export function confidenceBadgeClass(confidence) {
  const s = confidenceStrength(confidence);
  if (s >= 3) return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
  if (s === 2) return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";
}

export function relativeTime(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// Returns { value, label, confidence } for the headline figure, or null when
// no metric is renderable (→ empty-state). environmental magnitude carries a
// scale qualifier; conflict/others use a count + short label.
export function resolveHeadline(tracker) {
  const metrics = tracker?.metrics ?? {};
  const keys = PREFERRED_METRICS[tracker?.template_type] ?? [];

  // Try the template's preferred metrics first.
  for (const k of keys) {
    const block = metrics[k];
    if (block && block.value != null && block.value !== "") {
      return formatHeadline(k, block, tracker.template_type);
    }
  }
  // Generic fallback: first metric with a usable value.
  for (const [k, block] of Object.entries(metrics)) {
    if (block && block.value != null && block.value !== "") {
      return formatHeadline(k, block, tracker.template_type);
    }
  }
  return null; // empty-state
}

export function formatHeadline(metricName, block, templateType) {
  // environmental magnitude: render value + scale (e.g. "7.2 Mw"); no label.
  if (templateType === "environmental" && metricName === "magnitude_intensity") {
    const scale = block.scale ? ` ${block.scale}` : "";
    return { value: `${block.value}${scale}`, label: "magnitude", confidence: block.confidence };
  }
  // sports score / study finding / election leader: value is a string/object;
  // render its string form with no numeric label.
  if (typeof block.value === "object") {
    return { value: summarizeObject(block.value), label: METRIC_LABELS[metricName] ?? "", confidence: block.confidence };
  }
  return { value: String(block.value), label: METRIC_LABELS[metricName] ?? humanize(metricName), confidence: block.confidence };
}

function summarizeObject(obj) {
  // votes_by_contestant style { "Party A": "54%", ... } → leading entry.
  const entries = Object.entries(obj);
  if (entries.length === 0) return "";
  const [name, val] = entries[0];
  return `${name}: ${val}`;
}

export function humanize(s) {
  return String(s).replace(/_/g, " ");
}

/**
 * formatMetricValue — full value rendering for the Layer 2 all-metrics list
 * (Sprint 1.5.3). Unlike resolveHeadline (which picks ONE headline and
 * truncates objects to a leading entry), this renders a single metric's
 * value in full: arrays joined, objects expanded to "k: v" pairs,
 * environmental magnitude carrying its scale. Additive — does NOT change the
 * Layer 1 headline path.
 */
export function formatMetricValue(metricName, block, templateType) {
  const v = block?.value;
  if (v == null || v === "") return "—";
  if (templateType === "environmental" && metricName === "magnitude_intensity" && block.scale) {
    return `${v} ${block.scale}`;
  }
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") {
    return Object.entries(v).map(([k, val]) => `${k}: ${val}`).join(" · ");
  }
  return String(v);
}

// Provenance (Q4) — subtle source-verified vs wire-sourced.
//
// _origin is the authoritative PER-TRACKER signal (how THIS tracker was
// created): "wire-density" vs a source-feed value ("source-feed" / "acled" /
// "usgs" / "noaa"). _ingester_status is only the TEMPLATE-level availability
// ("live" = the template has some live ingester) and must NOT override
// _origin — a conflict tracker created by wire-density carries
// _ingester_status:"live" (ACLED exists for conflict) but _origin:
// "wire-density", and the honest label is "wire-sourced", not
// "source-verified". So _origin wins; _ingester_status is only a fallback
// when _origin is absent.
export function provenanceLabel(prov, t) {
  if (!prov) return null;
  if (prov._origin === "wire-density") {
    return t("tracker.provenance.wire", "wire-sourced");
  }
  if (prov._origin) {
    // Any non-wire-density origin is a source feed (source-feed/acled/usgs/noaa).
    return t("tracker.provenance.verified", "source-verified");
  }
  // No _origin recorded — fall back to template-level ingester status.
  if (prov._ingester_status === "wire-aggregation-only") {
    return t("tracker.provenance.wire", "wire-sourced");
  }
  if (prov._ingester_status === "live") {
    return t("tracker.provenance.verified", "source-verified");
  }
  return null;
}

export function capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
