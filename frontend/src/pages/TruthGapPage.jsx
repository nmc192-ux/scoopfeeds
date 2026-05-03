/**
 * TruthGapPage — /truth-gap — top divergences between market-implied
 * probability and media tone over the last 24h.
 *
 * Header explains the metric ("useful as a signal, not a verdict").
 * Body is a sortable list with TruthGapBadge per row + click-through to
 * the event dossier.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpDown, Activity } from "lucide-react";
import { useTruthGap } from "../hooks/useTruthGap";
import TruthGapBadge from "../components/predictions/TruthGapBadge";
import { COPY } from "../lib/copyGuide";

const DIRECTIONS = [
  { id: "both",  label: "All divergences" },
  { id: "over",  label: "Markets > Media" },
  { id: "under", label: "Media > Markets" },
];

const WINDOWS = [
  { id: 24 * 60 * 60 * 1000,        label: "24h" },
  { id: 7  * 24 * 60 * 60 * 1000,   label: "7d"  },
  { id: 30 * 24 * 60 * 60 * 1000,   label: "30d" },
];

function fmtPct(v) {
  if (!Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

function fmtPolarity(v) {
  if (!Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

function relTime(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 3600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function Row({ item }) {
  return (
    <Link
      to={`/events/${item.slug}`}
      className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] hover:shadow-sm transition-all"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          {item.category && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)] capitalize">
              {item.category}
            </span>
          )}
          <TruthGapBadge gap={item.truth_gap} size="sm" />
        </div>
        <p className="text-sm font-medium text-[var(--color-text)] line-clamp-2 leading-snug">
          {item.title}
        </p>
        <div className="flex items-center gap-3 mt-1 text-[10px] text-[var(--color-text-secondary)] tabular-nums">
          <span>Market <span className="font-semibold">{fmtPct(item.market_probability)}</span></span>
          <span>Media <span className="font-semibold">{fmtPolarity(item.media_sentiment)}</span></span>
          <span className="ml-auto">Updated {relTime(item.ts)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:w-44 sm:justify-end text-xs text-[var(--color-text-secondary)]">
        <Activity size={11} className="text-[var(--color-accent)]" />
        Composite{" "}
        <span className="font-semibold tabular-nums text-[var(--color-text)]">
          {fmtPct(item.reality_score)}
        </span>
      </div>
    </Link>
  );
}

export default function TruthGapPage() {
  const [direction, setDirection] = useState("both");
  const [windowMs,  setWindowMs]  = useState(24 * 60 * 60 * 1000);
  const { data, isLoading } = useTruthGap({ direction, windowMs, limit: 50 });
  const items = data?.items ?? [];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <ArrowUpDown size={18} className="text-[var(--color-accent)]" />
          <h1 className="font-editorial italic text-2xl text-[var(--color-text)]">{COPY.truthGapTitle}</h1>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
          {COPY.truthGapTooltip}
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex flex-wrap gap-2">
          {DIRECTIONS.map(d => (
            <button
              key={d.id}
              onClick={() => setDirection(d.id)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                direction === d.id
                  ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 ml-auto">
          {WINDOWS.map(w => (
            <button
              key={w.id}
              onClick={() => setWindowMs(w.id)}
              className={`text-[10px] px-2 py-1 rounded uppercase tracking-wide ${
                windowMs === w.id
                  ? "bg-[var(--color-text)] text-[var(--color-surface)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* Rows */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)] py-12 text-center">
          No tracked events meet the confidence floor in this window. Try a longer window.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map(it => <Row key={it.event_id} item={it} />)}
        </div>
      )}

      <p className="text-[10px] text-[var(--color-text-tertiary)] italic mt-6 text-center">
        {COPY.brandTagline}
      </p>
    </div>
  );
}
