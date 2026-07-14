/**
 * LiveAnomaliesStrip — horizontally scrollable strip of recent anomalies.
 *
 * Mounted above the /events grid (and reusable elsewhere) so users can see
 * "what's moving right now" at a glance. Each pill links to the affected
 * event dossier. Auto-refreshes via the underlying useAnomalies hook
 * (default 2-min polling).
 *
 * Self-hides when no recent unack anomalies exist so the page stays clean
 * on quiet news days.
 */

import { Link } from "react-router-dom";
import { Activity, ChevronRight } from "lucide-react";
import { useAnomalies } from "../../hooks/useTruthGap";
import AnomalyChip from "./AnomalyChip";

function relTime(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3600_000)}h ago`;
}

export default function LiveAnomaliesStrip({ limit = 8, className = "" }) {
  // useAnomalies quantizes sinceMs into 10-min buckets; without that, a raw
  // Date.now() here changes the queryKey every render and fetches unboundedly.
  const { data, isLoading } = useAnomalies({ limit, sinceMs: Date.now() - 6 * 60 * 60 * 1000 });
  const items = data?.items ?? [];

  if (isLoading) {
    return (
      <div className={`mb-6 h-12 rounded-lg bg-[var(--color-surface-2)] animate-pulse ${className}`} />
    );
  }
  if (!items.length) return null;

  return (
    <div className={`mb-6 ${className}`}>
      <div className="flex items-center gap-2 mb-2 text-xs text-[var(--color-text-secondary)]">
        <Activity size={13} className="text-[var(--color-accent)]" />
        <span className="uppercase tracking-wide font-semibold">Trending now</span>
        <span className="text-[10px]">— last 6h on tracked events</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scroll-smooth"
           style={{ scrollbarWidth: "thin" }}>
        {items.filter(a => a.event_slug).map(a => (
          <Link
            key={a.id}
            to={`/events/${a.event_slug}`}
            className="flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] hover:shadow-sm transition-all group max-w-xs"
          >
            <AnomalyChip anomaly={a} size="sm" />
            <span className="text-xs font-medium text-[var(--color-text)] line-clamp-1 group-hover:text-[var(--color-accent)] transition-colors">
              {a.event_title}
            </span>
            <span className="text-[10px] text-[var(--color-text-tertiary)] tabular-nums whitespace-nowrap">
              {relTime(a.detected_at)}
            </span>
            <ChevronRight size={11} className="text-[var(--color-text-tertiary)] group-hover:text-[var(--color-accent)] transition-colors flex-shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}
