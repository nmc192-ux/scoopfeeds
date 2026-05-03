/**
 * WorldMapPage — /world-map — geo-positioned event grid.
 *
 * Renders all active events with geo coordinates as severity-colored
 * markers on an equirectangular world projection. Phase 5's signature
 * visualization, powered today by USGS earthquakes (Phase 5b) and ready
 * for ACLED conflict events / GDELT geocoded items (later additions).
 */
import { useState } from "react";
import { Globe2, RefreshCw } from "lucide-react";
import { useWorldMap } from "../hooks/useEvents";
import WorldMap from "../components/charts/WorldMap";
import { COPY } from "../lib/copyGuide";

const CATEGORY_FILTERS = [
  { id: "",            label: "All" },
  { id: "geo",         label: "Earthquakes" },
  { id: "weather",     label: "Weather" },
  { id: "conflict",    label: "Conflict" },
  { id: "politics",    label: "Politics" },
  { id: "geopolitics", label: "Geopolitics" },
  { id: "climate",     label: "Climate" },
  { id: "health",      label: "Health" },
];

const SEVERITY_FILTERS = [
  { v: 0,    label: "All" },
  { v: 0.45, label: "≥M5 / amber" },
  { v: 0.65, label: "≥M6 / orange" },
  { v: 0.85, label: "≥M7 / crimson" },
];

export default function WorldMapPage() {
  const [category, setCategory]       = useState("");
  const [minSeverity, setMinSeverity] = useState(0);
  const { data, isLoading, refetch } = useWorldMap({ category: category || undefined, minSeverity, limit: 500 });
  const events = data?.events ?? [];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <header className="flex items-start justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Globe2 size={18} className="text-[var(--color-accent)]" />
            <h1 className="font-editorial italic text-2xl text-[var(--color-text)]">World Map</h1>
            <span className="text-[10px] text-[var(--color-text-secondary)] tabular-nums ml-1">
              {events.length} events
            </span>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {COPY.brandTagline} Active events with known coordinates — earthquakes (USGS) plus any geocoded story.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border border-[var(--color-border)] hover:border-[var(--color-accent)]"
        >
          <RefreshCw size={11} className={isLoading ? "animate-spin" : ""} /> Refresh
        </button>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex flex-wrap gap-2">
          {CATEGORY_FILTERS.map(c => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                category === c.id
                  ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 ml-auto">
          {SEVERITY_FILTERS.map(s => (
            <button
              key={s.v}
              onClick={() => setMinSeverity(s.v)}
              className={`text-[10px] px-2 py-1 rounded uppercase tracking-wide ${
                minSeverity === s.v
                  ? "bg-[var(--color-text)] text-[var(--color-surface)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Map */}
      {isLoading ? (
        <div className="aspect-[2/1] w-full rounded-xl bg-[var(--color-surface-2)] animate-pulse" />
      ) : events.length === 0 ? (
        <div className="text-center py-16 flex flex-col items-center gap-3">
          <Globe2 size={32} className="text-[var(--color-text-secondary)]" />
          <p className="text-[var(--color-text-secondary)] text-sm">
            No active events with coordinates in this filter. Try widening or wait for the next USGS pull.
          </p>
        </div>
      ) : (
        <WorldMap events={events} />
      )}

      <p className="text-[10px] text-[var(--color-text-tertiary)] italic mt-6 text-center">
        Equirectangular projection · Hover a marker for the story
      </p>
    </div>
  );
}
