/**
 * EventTimeline — vertical chronological feed for an event dossier.
 * Renders 'article' and 'market_move' entries with kind-specific icons.
 */

import { Newspaper, TrendingUp, TrendingDown, Filter } from "lucide-react";
import { useState } from "react";

const KIND_FILTERS = [
  { id: "",             label: "All" },
  { id: "article",      label: "Articles" },
  { id: "market_move",  label: "Market moves" },
];

function formatTs(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
         " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function importanceDot(importance = 0.5) {
  if (importance >= 0.75) return "bg-red-500";
  if (importance >= 0.55) return "bg-amber-400";
  return "bg-[var(--color-border)]";
}

function ArticleEntry({ entry }) {
  return (
    <div className="flex gap-3 py-3">
      <div className="flex flex-col items-center gap-1 flex-shrink-0 w-6">
        <div className={`w-2 h-2 rounded-full mt-1 ${importanceDot(entry.importance)}`} />
        <div className="w-px flex-1 bg-[var(--color-border)]" />
      </div>
      <div className="flex-1 pb-1">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Newspaper size={12} className="text-[var(--color-text-secondary)]" />
          <span className="text-[10px] text-[var(--color-text-secondary)]">{entry.source_name ?? "Unknown"}</span>
          <span className="text-[10px] text-[var(--color-text-secondary)] ml-auto">{formatTs(entry.ts)}</span>
        </div>
        <p className="text-sm font-medium text-[var(--color-text)] leading-snug">{entry.headline}</p>
        {entry.body && (
          <p className="text-xs text-[var(--color-text-secondary)] mt-1 line-clamp-2">{entry.body}</p>
        )}
      </div>
    </div>
  );
}

function MarketMoveEntry({ entry }) {
  const isUp = entry.headline?.includes("UP");
  const Icon = isUp ? TrendingUp : TrendingDown;
  const color = isUp
    ? "text-green-600 dark:text-green-400"
    : "text-red-500 dark:text-red-400";

  return (
    <div className="flex gap-3 py-3">
      <div className="flex flex-col items-center gap-1 flex-shrink-0 w-6">
        <div className={`w-2 h-2 rounded-full mt-1 ${isUp ? "bg-green-500" : "bg-red-500"}`} />
        <div className="w-px flex-1 bg-[var(--color-border)]" />
      </div>
      <div className="flex-1 pb-1">
        <div className="flex items-center gap-2 mb-1">
          <Icon size={12} className={color} />
          <span className="text-[10px] text-[var(--color-text-secondary)]">{entry.source_name ?? "Polymarket"}</span>
          <span className="text-[10px] text-[var(--color-text-secondary)] ml-auto">{formatTs(entry.ts)}</span>
        </div>
        <p className={`text-sm font-semibold leading-snug ${color}`}>{entry.headline}</p>
        {entry.body && (
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">{entry.body}</p>
        )}
      </div>
    </div>
  );
}

export default function EventTimeline({ entries = [], isLoading = false, onKindChange }) {
  const [activeKind, setActiveKind] = useState("");

  function selectKind(k) {
    setActiveKind(k);
    onKindChange?.(k || undefined);
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 py-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
        ))}
      </div>
    );
  }

  if (!entries.length) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)] py-8 text-center">
        No timeline entries yet — check back as the story develops.
      </p>
    );
  }

  return (
    <div>
      {/* Kind filter */}
      <div className="flex items-center gap-1 mb-4 flex-wrap">
        <Filter size={12} className="text-[var(--color-text-secondary)] mr-1" />
        {KIND_FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => selectKind(f.id)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              activeKind === f.id
                ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Feed */}
      <div className="divide-y divide-[var(--color-border)]">
        {entries.map(entry =>
          entry.kind === "market_move"
            ? <MarketMoveEntry key={entry.id} entry={entry} />
            : <ArticleEntry key={entry.id} entry={entry} />
        )}
      </div>
    </div>
  );
}
