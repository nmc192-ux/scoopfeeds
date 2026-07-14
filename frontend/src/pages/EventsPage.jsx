/**
 * EventsPage — /events — Polymarket-style grid of active events.
 *
 * Phase 2: lists all promoted story clusters as first-class events.
 * Filterable by category. Clicking an event opens the full dossier (/events/:slug).
 */

import { useState } from "react";
import { Map, Activity } from "lucide-react";
import { useEvents } from "../hooks/useEvents";
import EventCard from "../components/events/EventCard";
import LiveAnomaliesStrip from "../components/predictions/LiveAnomaliesStrip";
import { COPY } from "../lib/copyGuide";
import { useT } from "../lib/i18n";

// Category chips. labelKey resolves via t() at render so chips translate
// with the active locale (matches the MoreMenu pattern). 4 keys overlap
// with existing MoreMenu nav.* keys (finance/health/sports/climate);
// 5 new keys (all/politics/tech/science/geopolitics) are added to the
// nav.* namespace in this commit.
const CATEGORIES = [
  { id: "",            labelKey: "nav.all" },
  { id: "politics",    labelKey: "nav.politics" },
  { id: "finance",     labelKey: "nav.finance" },
  { id: "tech",        labelKey: "nav.tech" },
  { id: "science",     labelKey: "nav.science" },
  { id: "health",      labelKey: "nav.health" },
  { id: "sports",      labelKey: "nav.sports" },
  { id: "geopolitics", labelKey: "nav.geopolitics" },
  { id: "climate",     labelKey: "nav.climate" },
];

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden animate-pulse">
      <div className="aspect-video bg-[var(--color-surface-2)]" />
      <div className="p-4 flex flex-col gap-3">
        <div className="h-4 w-20 bg-[var(--color-surface-2)] rounded-full" />
        <div className="h-10 bg-[var(--color-surface-2)] rounded" />
        <div className="h-3 bg-[var(--color-surface-2)] rounded w-3/4" />
      </div>
    </div>
  );
}

export default function EventsPage({
  fixedCategory = null,
  // null default => translation-aware default title (nav.event_tracker).
  // Callers that pass a literal string (e.g., category alias pages like
  // HealthEventsPage passing pageTitle="Health") still get their literal —
  // this only changes behavior on the bare /events route where no override
  // is supplied.
  pageTitle = null,
  pageSubtitle = null,
  pageIcon: PageIcon = Map,
} = {}) {
  const { t } = useT();
  const [chosen, setChosen] = useState("");
  const category = fixedCategory ?? chosen;
  const { data, isLoading, error, isSuccess } = useEvents({ category: category || undefined, limit: 60 });
  const events = data?.events ?? [];
  const resolvedTitle = pageTitle ?? t("nav.event_tracker", "Event Tracker");

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      {/* Header */}
      <header className="mb-7">
        <div className="flex items-center gap-2 mb-1">
          <PageIcon size={18} className="text-[var(--color-accent)]" />
          <h1 className="font-editorial italic text-2xl sm:text-3xl text-[var(--color-text)]">
            {resolvedTitle}
          </h1>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {pageSubtitle ?? `${COPY.brandTagline(t)} Major stories tracked as live events with market-implied probabilities.`}
        </p>
      </header>

      {/* Trending now — recent unack anomalies on tracked events */}
      <LiveAnomaliesStrip />

      {/* Category filter — hidden when a fixed category is locked in */}
      {!fixedCategory && (
        <div className="flex flex-wrap gap-2 mb-7">
          {CATEGORIES.map(c => (
            <button
              key={c.id}
              onClick={() => setChosen(c.id)}
              className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                chosen === c.id
                  ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
              }`}
            >
              {t(c.labelKey)}
            </button>
          ))}
        </div>
      )}

      {/* Transient — errored, or a paused offline retry (no data, no error).
          Retry is automatic (useEvents polls at 30s while failing). */}
      {!isLoading && !isSuccess && (
        <p className="text-sm text-[var(--color-text-secondary)] py-6 text-center">
          Temporarily busy — retrying…
        </p>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 9 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Empty state — positive evidence only: requires a successful,
          genuinely-empty response, never inferred from missing data */}
      {!isLoading && isSuccess && !error && !events.length && (
        <div className="text-center py-16 flex flex-col items-center gap-3">
          <Activity size={32} className="text-[var(--color-text-secondary)]" />
          <p className="text-[var(--color-text-secondary)] text-sm">
            No active events yet — they appear automatically as stories gain coverage.
          </p>
        </div>
      )}

      {/* Event grid */}
      {!isLoading && events.length > 0 && (
        <>
          <p className="text-xs text-[var(--color-text-secondary)] mb-4">
            {events.length} active event{events.length !== 1 ? "s" : ""}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {events.map(ev => <EventCard key={ev.id} event={ev} />)}
          </div>
        </>
      )}
    </div>
  );
}
