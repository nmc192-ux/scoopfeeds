/**
 * EventCard — Polymarket-style card for the /events grid.
 * Shows title, category, top market probability, article count, and activity timestamp.
 */

import { Link } from "react-router-dom";
import { Activity, FileText, Clock } from "lucide-react";
import ProbabilityBar from "../predictions/ProbabilityBar";
import TruthGapBadge  from "../predictions/TruthGapBadge";
import AnomalyChip    from "../predictions/AnomalyChip";

const CATEGORY_COLORS = {
  politics:    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  finance:     "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  tech:        "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  sports:      "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  science:     "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  health:      "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  climate:     "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  geopolitics: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

function severityColor(severity) {
  if (severity >= 0.7) return "bg-red-500";
  if (severity >= 0.4) return "bg-amber-400";
  return "bg-green-500";
}

function relativeTime(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function EventCard({ event }) {
  const {
    slug, title, summary, category, severity = 0,
    article_count = 0, market_count = 0, top_probability,
    truth_gap, latest_anomaly,
    hero_image_url, last_activity_at,
  } = event;

  const catKey    = (category ?? "").toLowerCase();
  const catColor  = CATEGORY_COLORS[catKey] ?? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";

  return (
    <Link
      to={`/events/${slug}`}
      className="group flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] hover:shadow-md transition-all overflow-hidden"
    >
      {/* Hero image */}
      {hero_image_url && (
        <div className="aspect-video overflow-hidden bg-[var(--color-surface-2)]">
          <img
            src={hero_image_url}
            alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        </div>
      )}

      <div className="flex flex-col gap-3 p-4 flex-1">
        {/* Header row: category badge + truth-gap + severity dot */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${catColor}`}>
            {category ?? "General"}
          </span>
          {Number.isFinite(truth_gap) && Math.abs(truth_gap) > 0.15 && (
            <TruthGapBadge gap={truth_gap} size="sm" />
          )}
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ml-auto ${severityColor(severity)}`}
            title={`Severity: ${(severity * 100).toFixed(0)}%`}
          />
        </div>

        {/* Inline anomaly chip — surfaces fresh activity at a glance */}
        {latest_anomaly && (
          <AnomalyChip anomaly={latest_anomaly} size="sm" />
        )}

        {/* Title */}
        <h3 className="font-semibold text-[var(--color-text)] text-sm leading-snug line-clamp-3 group-hover:text-[var(--color-accent)] transition-colors">
          {title}
        </h3>

        {/* Summary */}
        {summary && (
          <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2">{summary}</p>
        )}

        {/* Market probability strip */}
        {top_probability != null && (
          <div className="mt-auto pt-2 border-t border-[var(--color-border)]">
            <p className="text-[10px] text-[var(--color-text-secondary)] mb-1 flex items-center gap-1">
              <Activity size={10} className="text-[var(--color-accent)]" />
              Market probability
            </p>
            <ProbabilityBar yesPrice={top_probability} noPrice={1 - top_probability} size="sm" />
          </div>
        )}

        {/* Footer: article count + time */}
        <div className="flex items-center gap-3 text-[10px] text-[var(--color-text-secondary)] mt-1">
          <span className="flex items-center gap-1">
            <FileText size={10} />
            {article_count} article{article_count !== 1 ? "s" : ""}
          </span>
          {market_count > 0 && (
            <span className="flex items-center gap-1">
              <Activity size={10} />
              {market_count} market{market_count !== 1 ? "s" : ""}
            </span>
          )}
          <span className="flex items-center gap-1 ml-auto">
            <Clock size={10} />
            {relativeTime(last_activity_at)}
          </span>
        </div>
      </div>
    </Link>
  );
}
