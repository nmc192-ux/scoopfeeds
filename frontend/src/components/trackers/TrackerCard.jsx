/**
 * TrackerCard — Layer 1 card for the Tracker Auto-Detection Engine
 * (Sprint 1.5.2). Mirrors EventCard.jsx's aesthetic exactly (Tailwind +
 * var(--color-*) custom properties + lucide-react icons + the same
 * rounded-xl border/hover treatment) so it feels native inside the existing
 * events UI rather than introducing a new design language.
 *
 * Two display states:
 *   • metrics present → per-template headline figure + confidence flag
 *     (conflict + environmental get precise §5 treatment; the other 6 use a
 *     graceful generic headline — first preferred metric present).
 *   • metrics EMPTY (the common production case — wire-density quartet and
 *     every freshly-detected tracker start here) → the Q3 empty-state:
 *     "Tracking · no data yet" pill. Designed as a first-class state, NOT a
 *     broken-looking blank card.
 *
 * Provenance indicator (Q4) is subtle: a small muted "source-verified" vs
 * "wire-sourced" line driven by data_source_provenance.
 *
 * i18n: structural labels go through t() (lib/i18n.js static-key system,
 * keys in locales/*.json); each t() call passes an English fallback so
 * untranslated locales degrade to readable English rather than raw keys.
 * Mirrors EventCard's choice to render the (dynamic) title raw.
 *
 * Link target is /trackers/:id — the Layer 2 tracker page that Sprint 1.5.3
 * builds. Until 1.5.3 ships that route, clicks land on the SPA fallback;
 * the card's purpose here is Layer 1 rendering, navigation arrives next.
 */

import { Link } from "react-router-dom";
import { Activity, Clock, Radar } from "lucide-react";
import { useT } from "../../lib/i18n";
import { confidenceStrength } from "../../lib/trackerRank";

// Per-template ordered headline-metric preference (from each template's §5
// Layer 1 spec). resolveHeadline walks the list and uses the first metric
// block present. conflict + environmental are precise; the rest are
// reasonable primaries with a generic fallback below.
const PREFERRED_METRICS = Object.freeze({
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
const METRIC_LABELS = Object.freeze({
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
function confidenceBadgeClass(confidence) {
  const s = confidenceStrength(confidence);
  if (s >= 3) return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
  if (s === 2) return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";
}

function relativeTime(ms) {
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
function resolveHeadline(tracker) {
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

function formatHeadline(metricName, block, templateType) {
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

function humanize(s) {
  return String(s).replace(/_/g, " ");
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
function provenanceLabel(prov, t) {
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

export default function TrackerCard({ tracker }) {
  const { t } = useT();
  if (!tracker) return null;

  const { id, template_type, status, last_updated_at, data_source_provenance } = tracker;
  const headline = resolveHeadline(tracker);
  const provLabel = provenanceLabel(data_source_provenance, t);

  const typeLabel = t(`tracker.type.${template_type}`, capitalize(template_type));

  return (
    <Link
      to={`/trackers/${id}`}
      className="group flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] hover:shadow-md transition-all overflow-hidden"
    >
      <div className="flex flex-col gap-3 p-4 flex-1">
        {/* Header row: template-type badge + Radar marker (tracker affordance) */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium px-2 py-0.5 rounded-full capitalize bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">
            {typeLabel}
          </span>
          <Radar size={12} className="text-[var(--color-accent)] flex-shrink-0 ml-auto" aria-hidden="true" />
        </div>

        {/* Headline area */}
        {headline ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="text-lg font-semibold text-[var(--color-text)] leading-tight">
                {headline.value}
              </span>
              {headline.label && (
                <span className="text-xs text-[var(--color-text-secondary)]">{headline.label}</span>
              )}
            </div>
            {headline.confidence && (
              <span className={`self-start text-[10px] font-medium px-2 py-0.5 rounded-full ${confidenceBadgeClass(headline.confidence)}`}>
                {t(`tracker.confidence.${headline.confidence}`, headline.confidence)}
              </span>
            )}
          </div>
        ) : (
          /* Q3 empty-state — the common case. Deliberate, honest "tracking,
             no quantified data yet" treatment; reads as intentional, not broken. */
          <div className="flex flex-col gap-1">
            <span className="self-start text-xs font-medium px-2.5 py-1 rounded-full border border-dashed border-[var(--color-border)] text-[var(--color-text-secondary)] flex items-center gap-1.5">
              <Activity size={11} className="text-[var(--color-accent)]" />
              {t("tracker.no_data", "Tracking · no data yet")}
            </span>
          </div>
        )}

        {/* Footer: provenance (subtle) + last-updated */}
        <div className="flex items-center gap-3 text-[10px] text-[var(--color-text-secondary)] mt-auto pt-1">
          {provLabel && (
            <span className="truncate" title={provLabel}>{provLabel}</span>
          )}
          <span className="flex items-center gap-1 ml-auto">
            <Clock size={10} />
            {relativeTime(last_updated_at)}
          </span>
        </div>
      </div>
    </Link>
  );
}

function capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
