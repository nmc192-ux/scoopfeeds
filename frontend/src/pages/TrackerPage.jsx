/**
 * TrackerPage — /trackers/:id — Layer 2 full tracker page for the Tracker
 * Auto-Detection Engine (Sprint 1.5.3, the engine finale).
 *
 * Mirrors EventPage.jsx structurally: max-w-3xl single column, useParams,
 * loading skeleton, !data → 404 + ChevronLeft back-link, stacked <section>s
 * fronted by a local SectionHeader, conditional-section gating (empty
 * sections don't render — the right idiom for metrics-empty-dominant data).
 *
 * SCOPE (ruled): this is the GENERIC Layer 2 shared by all 8 template types —
 * the shared core only:
 *   • header (type + title + headline confidence + provenance + last-updated)
 *   • full all-metrics list (every metric with label + value + confidence +
 *     source + as_of) — the genuinely-new surface vs Layer 1, which shows
 *     only the single headline metric
 *   • the deliberate empty-state ("Tracking · no data yet") for the common
 *     no-metrics case
 *   • revision-history timeline (conditional — only when revisions exist)
 *   • back-link to the parent event (via event_slug, new in the 1.5.3 payload)
 *
 * DELIBERATELY DEFERRED (dark-deliberate, NOT forgotten): rich per-template
 * panels — time-series charts, geographic maps, conflict dispute panels,
 * election vote-breakdown/seat-allocation, study replication/citation
 * timelines (template §5 "full tracker page" specs). Each needs data infra we
 * don't have yet (dense metric-history for charts, sub-national geo
 * granularity for maps, multi-party metric shapes for dispute/vote panels) and
 * would be untested dead code against today's data (4 of 8 template types have
 * zero production trackers; the live ones are mostly empty metrics:{}). Build
 * per-template richness when the data to populate it exists.
 *
 * Display helpers come from lib/trackerFormat.js — the single source of truth
 * shared with TrackerCard (Layer 1), so the two layers never drift.
 */

import { useParams, Link } from "react-router-dom";
import { ChevronLeft, Activity, Radar, Clock, History } from "lucide-react";
import { useT } from "../lib/i18n";
import { useTracker } from "../hooks/useTrackers";
import { useEvent } from "../hooks/useEvents";
import {
  resolveHeadline,
  provenanceLabel,
  confidenceBadgeClass,
  relativeTime,
  formatMetricValue,
  METRIC_LABELS,
  humanize,
  capitalize,
} from "../lib/trackerFormat";

function SectionHeader({ icon: Icon, label }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon size={15} className="text-[var(--color-accent)]" />
      <h2 className="font-semibold text-base text-[var(--color-text)]">{label}</h2>
    </div>
  );
}

// One metric row in the Layer 2 all-metrics list. Label + full value +
// confidence badge + source + as_of. This is the genuinely-new Layer 2
// surface: Layer 1 shows only the headline metric, Layer 2 shows them all.
function MetricRow({ name, block, templateType, t }) {
  const label = METRIC_LABELS[name] ?? humanize(name);
  const value = formatMetricValue(name, block, templateType);
  return (
    <div className="flex flex-col gap-1.5 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
          {label}
        </span>
        {block?.confidence && (
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${confidenceBadgeClass(block.confidence)}`}>
            {t(`tracker.confidence.${block.confidence}`, block.confidence)}
          </span>
        )}
      </div>
      <span className="text-lg font-semibold text-[var(--color-text)] leading-tight break-words">
        {value}
      </span>
      <div className="flex items-center gap-3 text-[10px] text-[var(--color-text-secondary)] flex-wrap">
        {block?.source && (
          <span className="truncate" title={String(block.source)}>
            {t("tracker.detail.source", "source")}: {block.source}
          </span>
        )}
        {block?.as_of && (
          <span className="flex items-center gap-1 ml-auto">
            <Clock size={10} />
            {t("tracker.detail.updated", "updated")} {relativeTime(block.as_of)}
          </span>
        )}
      </div>
    </div>
  );
}

// One revision in the history timeline: which metric changed, prev → new
// (value-level), why, and when.
function RevisionRow({ rev, templateType, t }) {
  const metricLabel = METRIC_LABELS[rev.metric_name] ?? humanize(rev.metric_name);
  const prev = rev.prev_block ? formatMetricValue(rev.metric_name, rev.prev_block, templateType) : null;
  const next = rev.new_block ? formatMetricValue(rev.metric_name, rev.new_block, templateType) : "—";
  return (
    <li className="flex flex-col gap-1 border-l-2 border-[var(--color-border)] pl-4 py-1 relative">
      <span className="absolute -left-[5px] top-2 w-2 h-2 rounded-full bg-[var(--color-accent)]" aria-hidden="true" />
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-sm font-medium text-[var(--color-text)]">{metricLabel}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">
          {t(`tracker.reason.${rev.reason}`, humanize(rev.reason))}
        </span>
        <span className="text-[10px] text-[var(--color-text-secondary)] ml-auto">
          {relativeTime(rev.changed_at)}
        </span>
      </div>
      <div className="text-xs text-[var(--color-text-secondary)]">
        {prev != null ? (
          <span><span className="line-through opacity-70">{prev}</span> → <span className="text-[var(--color-text)]">{next}</span></span>
        ) : (
          <span className="text-[var(--color-text)]">{next}</span>
        )}
      </div>
    </li>
  );
}

export default function TrackerPage() {
  const { id } = useParams();
  const { t } = useT();
  const { data, isLoading } = useTracker(id);

  const tracker = data?.tracker ?? null;
  const revisions = data?.revisions ?? [];

  // The parent event's slug rides in on the 1.5.3 payload (event_slug); fetch
  // the event for its human title + the back-link label. Defensive — if the
  // event can't be resolved, the page still works (falls back to a generic
  // "Back to events" link and a type-derived heading).
  const eventSlug = tracker?.event_slug ?? null;
  const { data: event } = useEvent(eventSlug);

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="h-64 rounded-xl bg-[var(--color-surface-2)] animate-pulse" />
      </div>
    );
  }

  if (!tracker) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-[var(--color-text-secondary)] text-sm">
          {t("tracker.detail.not_found", "Tracker not found.")}
        </p>
        <Link to="/events" className="mt-4 inline-flex items-center gap-1 text-sm text-[var(--color-accent)] hover:underline">
          <ChevronLeft size={14} /> {t("tracker.detail.back_events", "Back to events")}
        </Link>
      </div>
    );
  }

  const { template_type, status, last_updated_at, data_source_provenance, metrics } = tracker;
  const typeLabel = t(`tracker.type.${template_type}`, capitalize(template_type));
  const headline = resolveHeadline(tracker);
  const provLabel = provenanceLabel(data_source_provenance, t);
  const metricEntries = Object.entries(metrics ?? {});
  const heading = event?.title || `${typeLabel} ${t("tracker.detail.heading_suffix", "tracker")}`;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      {/* Back link → parent event (or generic events list if slug unresolved) */}
      <Link
        to={eventSlug ? `/events/${eventSlug}` : "/events"}
        className="inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] mb-5 transition-colors"
      >
        <ChevronLeft size={13} />{" "}
        {event?.title
          ? `${t("tracker.detail.back", "Back to event")}: ${event.title}`
          : t("tracker.detail.back_events", "Back to events")}
      </Link>

      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="text-xs font-medium px-2 py-0.5 rounded-full capitalize bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">
            {typeLabel}
          </span>
          {status && status !== "active" && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] capitalize">
              {t(`tracker.status.${status}`, status)}
            </span>
          )}
          <Radar size={14} className="text-[var(--color-accent)] ml-auto" aria-hidden="true" />
        </div>

        <h1 className="font-editorial italic text-2xl sm:text-3xl text-[var(--color-text)] leading-tight">
          {heading}
        </h1>

        {/* Headline figure (if any metric is renderable) or the deliberate
            empty-state. Carries the header-level confidence. */}
        {headline ? (
          <div className="flex items-baseline gap-2 flex-wrap mt-3">
            <span className="text-2xl font-semibold text-[var(--color-text)]">{headline.value}</span>
            {headline.label && (
              <span className="text-sm text-[var(--color-text-secondary)]">{headline.label}</span>
            )}
            {headline.confidence && (
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${confidenceBadgeClass(headline.confidence)}`}>
                {t(`tracker.confidence.${headline.confidence}`, headline.confidence)}
              </span>
            )}
          </div>
        ) : (
          <div className="mt-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border border-dashed border-[var(--color-border)] text-[var(--color-text-secondary)]">
              <Activity size={11} className="text-[var(--color-accent)]" />
              {t("tracker.no_data", "Tracking · no data yet")}
            </span>
          </div>
        )}

        {/* Provenance + last-updated subline */}
        <div className="flex items-center gap-3 text-[11px] text-[var(--color-text-secondary)] mt-3">
          {provLabel && <span>{provLabel}</span>}
          {last_updated_at && (
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {t("tracker.detail.updated", "updated")} {relativeTime(last_updated_at)}
            </span>
          )}
        </div>
      </header>

      {/* All-metrics — every metric, full value. Conditional: empty trackers
          (the common case) show only the header empty-state above. */}
      {metricEntries.length > 0 && (
        <section className="mb-8">
          <SectionHeader icon={Activity} label={t("tracker.detail.metrics", "Metrics")} />
          {/* Q2 (study evidence-quality badge, spec §3.4) is DEFERRED here:
              derived at render from study_type + sample_size + tier +
              hierarchy_rank — but study trackers = 0 and the detector writes
              empty template_meta for study, so there is nothing to derive
              from today. When a study ingester lands and populates study_type/
              sample_size, render the badge in this section. Dark-deliberate. */}
          <div className="grid sm:grid-cols-2 gap-3">
            {metricEntries.map(([name, block]) => (
              <MetricRow key={name} name={name} block={block} templateType={template_type} t={t} />
            ))}
          </div>
        </section>
      )}

      {/* Revision history — conditional (empty-metrics trackers have none) */}
      {revisions.length > 0 && (
        <section className="mb-8">
          <SectionHeader icon={History} label={t("tracker.detail.history", "Revision history")} />
          <ul className="flex flex-col gap-3">
            {revisions.map((rev, i) => (
              <RevisionRow key={`${rev.metric_name}-${rev.changed_at}-${i}`} rev={rev} templateType={template_type} t={t} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
