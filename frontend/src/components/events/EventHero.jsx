/**
 * EventHero — top section of the event dossier page.
 * Renders title, category, severity bar, summary, and top market probability.
 */

import { Activity, Clock, FileText, TrendingUp } from "lucide-react";
import ProbabilityBar from "../predictions/ProbabilityBar";
import TruthGapBadge  from "../predictions/TruthGapBadge";
import WatchButton    from "../predictions/WatchButton";
import { COPY } from "../../lib/copyGuide";
import { useT } from "../../lib/i18n";

function relativeTime(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function SeverityBar({ value = 0 }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.7 ? "#ef4444" : value >= 0.4 ? "#f59e0b" : "#22c55e";
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
      <span>Signal strength</span>
      <div className="flex-1 h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden max-w-[120px]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span>{pct}%</span>
    </div>
  );
}

export default function EventHero({ event, markets = [], truthGap }) {
  const { t } = useT();
  const {
    id, title, category, severity = 0, summary,
    article_count = 0, market_count = 0, last_activity_at,
    hero_image_url, status,
  } = event;

  const topMarket = markets[0];

  return (
    <div className="rounded-xl overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)] mb-6">
      {/* Hero image */}
      {hero_image_url && (
        <div className="aspect-[3/1] bg-[var(--color-surface-2)] overflow-hidden">
          <img src={hero_image_url} alt="" className="w-full h-full object-cover" loading="eager" />
        </div>
      )}

      <div className="p-5 sm:p-7 flex flex-col gap-4">
        {/* Category + status badges */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)] capitalize">
            {category ?? "General"}
          </span>
          {status === "active" && (
            <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              LIVE
            </span>
          )}
          {Number.isFinite(truthGap) && Math.abs(truthGap) > 0.15 && (
            <TruthGapBadge gap={truthGap} size="sm" />
          )}
          {id && <WatchButton itemType="event" itemId={id} size="sm" className="ml-auto" />}
        </div>

        {/* Title */}
        <h1 className="font-editorial italic text-2xl sm:text-3xl leading-tight text-[var(--color-text)]">
          {title}
        </h1>

        {/* Summary */}
        {summary && (
          <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
            {summary}
          </p>
        )}

        {/* Severity */}
        <SeverityBar value={severity} />

        {/* Market probability */}
        {topMarket && (
          <div className="rounded-lg bg-[var(--color-surface-2)] p-4 flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
              <TrendingUp size={13} className="text-[var(--color-accent)]" />
              <span className="font-medium">{COPY.probabilityLabel}</span>
              <span className="ml-auto text-[10px]">Source: {topMarket.source ?? "Polymarket"}</span>
            </div>
            <ProbabilityBar yesPrice={topMarket.yes_price} noPrice={topMarket.no_price} />
            <p className="text-[10px] text-[var(--color-text-secondary)]">{COPY.probabilityNote(t)}</p>
          </div>
        )}

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--color-text-secondary)] pt-1 border-t border-[var(--color-border)]">
          <span className="flex items-center gap-1">
            <FileText size={12} />
            {article_count} articles
          </span>
          {market_count > 0 && (
            <span className="flex items-center gap-1">
              <Activity size={12} />
              {market_count} market{market_count !== 1 ? "s" : ""}
            </span>
          )}
          <span className="flex items-center gap-1 ml-auto">
            <Clock size={12} />
            Updated {relativeTime(last_activity_at)}
          </span>
        </div>
      </div>
    </div>
  );
}
