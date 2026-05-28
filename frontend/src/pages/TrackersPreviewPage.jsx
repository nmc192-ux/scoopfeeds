/**
 * TrackersPreviewPage — /trackers-preview — TEMPORARY review surface for
 * Sprint 1.5.2.
 *
 * ⚠️ TEMPORARY — not production-intended. This page exists so the TrackerCard
 * Layer 1 component can be visually verified against real /api/ri/trackers
 * data during review. The production placement of tracker cards (homepage
 * strip, category pages, event-dossier panels) is decided in Sprint 1.5.3 /
 * frontend-integration work. Remove or repurpose this route once cards have
 * a permanent home.
 *
 * Mirrors EventsPage's grid + loading/empty structure.
 */

import { Activity } from "lucide-react";
import { useTrackers } from "../hooks/useTrackers";
import TrackerCard from "../components/trackers/TrackerCard";

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden animate-pulse">
      <div className="p-4 flex flex-col gap-3">
        <div className="h-4 w-20 bg-[var(--color-surface-2)] rounded-full" />
        <div className="h-8 bg-[var(--color-surface-2)] rounded" />
        <div className="h-3 bg-[var(--color-surface-2)] rounded w-1/2" />
      </div>
    </div>
  );
}

export default function TrackersPreviewPage() {
  const { data, isLoading, error } = useTrackers({ limit: 60 });
  const trackers = data?.trackers ?? [];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">Tracker cards — preview</h1>
        <p className="text-xs text-[var(--color-text-secondary)] mt-1">
          Temporary Sprint 1.5.2 review surface. Live tracker_instances rendered as Layer 1 cards.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-500 py-6 text-center">
          Failed to load trackers — please try again.
        </p>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 9 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {!isLoading && !error && !trackers.length && (
        <div className="text-center py-16 flex flex-col items-center gap-3">
          <Activity size={32} className="text-[var(--color-text-secondary)]" />
          <p className="text-[var(--color-text-secondary)] text-sm">
            No active trackers yet — they appear automatically as the detection engine fires.
          </p>
        </div>
      )}

      {!isLoading && trackers.length > 0 && (
        <>
          <p className="text-xs text-[var(--color-text-secondary)] mb-4">
            {trackers.length} active tracker{trackers.length !== 1 ? "s" : ""}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {trackers.map(tr => <TrackerCard key={tr.id} tracker={tr} />)}
          </div>
        </>
      )}
    </div>
  );
}
