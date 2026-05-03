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

const CATEGORIES = [
  { id: "",            label: "All" },
  { id: "politics",    label: "Politics" },
  { id: "finance",     label: "Finance" },
  { id: "tech",        label: "Tech" },
  { id: "science",     label: "Science" },
  { id: "health",      label: "Health" },
  { id: "sports",      label: "Sports" },
  { id: "geopolitics", label: "Geopolitics" },
  { id: "climate",     label: "Climate" },
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
  pageTitle = "Event Tracker",
  pageSubtitle = null,
  pageIcon: PageIcon = Map,
} = {}) {
  const [chosen, setChosen] = useState("");
  const category = fixedCategory ?? chosen;
  const { data, isLoading, error } = useEvents({ category: category || undefined, limit: 60 });
  const events = data?.events ?? [];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      {/* Header */}
      <header className="mb-7">
        <div className="flex items-center gap-2 mb-1">
          <PageIcon size={18} className="text-[var(--color-accent)]" />
          <h1 className="font-editorial italic text-2xl sm:text-3xl text-[var(--color-text)]">
            {pageTitle}
          </h1>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {pageSubtitle ?? `${COPY.brandTagline} Major stories tracked as live events with market-implied probabilities.`}
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
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm text-red-500 py-6 text-center">
          Failed to load events — please try again.
        </p>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 9 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && !events.length && (
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
