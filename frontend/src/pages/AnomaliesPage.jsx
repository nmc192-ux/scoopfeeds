/**
 * AnomaliesPage — /anomalies — full feed of recent unack anomaly_alerts.
 *
 * Type filter (all / odds_shift / truth_gap_spike / viral_no_react /
 * sentiment_flip) + window selector (24h / 7d / 30d). Each row links to
 * the affected event dossier. Self-refreshes via useAnomalies (2-min poll).
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Activity, AlertTriangle, TrendingUp, Zap, RefreshCw } from "lucide-react";
import { useAnomalies } from "../hooks/useTruthGap";
import AnomalyChip from "../components/predictions/AnomalyChip";
import { COPY } from "../lib/copyGuide";

const TYPES = [
  { id: "",                label: "All",            Icon: Bell },
  { id: "odds_shift",      label: "Market shifts",  Icon: TrendingUp },
  { id: "truth_gap_spike", label: "Divergences",    Icon: AlertTriangle },
  { id: "viral_no_react",  label: "Viral, quiet",   Icon: Zap },
  { id: "sentiment_flip",  label: "Sentiment flips", Icon: RefreshCw },
];

const WINDOWS = [
  { id: 24 * 60 * 60 * 1000,      label: "24h" },
  { id: 7 * 24 * 60 * 60 * 1000,  label: "7d"  },
  { id: 30 * 24 * 60 * 60 * 1000, label: "30d" },
];

function relTime(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function summary(anomaly) {
  const p = anomaly.payload || {};
  switch (anomaly.type) {
    case "odds_shift":
      return `Market YES went ${p.from?.toFixed?.(2)} → ${p.to?.toFixed?.(2)} (${p.delta_pp > 0 ? "+" : ""}${p.delta_pp}pp in 1h).`;
    case "truth_gap_spike":
      return `|truth_gap| jumped ${p.jump?.toFixed?.(2)} (${p.from?.toFixed?.(2)} → ${p.to?.toFixed?.(2)}).`;
    case "viral_no_react":
      return `Social volume ${p.ratio}× the 24h baseline (${p.recent_volume} mentions) but the bound market only moved ${p.market_delta_pp}pp.`;
    case "sentiment_flip":
      return `${p.source} polarity flipped ${p.from?.toFixed?.(2)} → ${p.to?.toFixed?.(2)}.`;
    default:
      return "";
  }
}

function Row({ a }) {
  const target = a.event_slug ? `/events/${a.event_slug}` : null;
  const Inner = (
    <>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <AnomalyChip anomaly={a} size="md" />
        <span className="ml-auto text-[10px] text-[var(--color-text-secondary)] tabular-nums">
          {relTime(a.detected_at)}
        </span>
      </div>
      {a.event_title && (
        <p className="text-sm font-medium text-[var(--color-text)] line-clamp-1 mb-1">
          {a.event_title}
        </p>
      )}
      <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
        {summary(a)}
      </p>
    </>
  );
  return target ? (
    <Link to={target} className="block rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] hover:shadow-sm transition-all p-4">
      {Inner}
    </Link>
  ) : (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      {Inner}
    </div>
  );
}

export default function AnomaliesPage() {
  const [type, setType]       = useState("");
  const [windowMs, setWindowMs] = useState(24 * 60 * 60 * 1000);
  const { data, isLoading } = useAnomalies({
    type: type || undefined,
    sinceMs: Date.now() - windowMs,
    limit: 100,
  });
  const items = data?.items ?? [];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Activity size={18} className="text-[var(--color-accent)]" />
          <h1 className="font-editorial italic text-2xl text-[var(--color-text)]">Anomalies</h1>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
          Live alerts when something on a tracked event moves unexpectedly — markets,
          media tone, or social attention.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex flex-wrap gap-2">
          {TYPES.map(t => {
            const Icon = t.Icon;
            return (
              <button
                key={t.id}
                onClick={() => setType(t.id)}
                className={`text-xs px-3 py-1.5 rounded-full border inline-flex items-center gap-1 transition-colors ${
                  type === t.id
                    ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                    : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]"
                }`}
              >
                <Icon size={11} /> {t.label}
              </button>
            );
          })}
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

      {/* Feed */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)] py-12 text-center">
          No anomalies in this window. Try expanding to 7d / 30d.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map(a => <Row key={a.id} a={a} />)}
        </div>
      )}

      <p className="text-[10px] text-[var(--color-text-tertiary)] italic mt-6 text-center">
        {COPY.brandTagline}
      </p>
    </div>
  );
}
