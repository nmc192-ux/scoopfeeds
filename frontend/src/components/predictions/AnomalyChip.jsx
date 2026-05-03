/**
 * AnomalyChip — inline pill alerting on a recent anomaly.
 *
 * Used inline on event cards / dossier headers when an unacknowledged alert
 * fires within the last hour. Severity controls the visual emphasis.
 */

import { COPY } from "../../lib/copyGuide";
import { AlertTriangle, TrendingUp, Zap, RefreshCw } from "lucide-react";

const ICON = {
  odds_shift:      TrendingUp,
  truth_gap_spike: AlertTriangle,
  viral_no_react:  Zap,
  sentiment_flip:  RefreshCw,
};

function severityStyle(severity) {
  if (severity >= 0.75) return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-300/40";
  if (severity >= 0.45) return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300/40";
  return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-300/40";
}

function summary(anomaly) {
  const p = anomaly.payload || {};
  switch (anomaly.type) {
    case "odds_shift":
      return `${p.delta_pp > 0 ? "+" : ""}${p.delta_pp}pp in 1h`;
    case "truth_gap_spike":
      return `${p.from?.toFixed?.(2)} → ${p.to?.toFixed?.(2)}`;
    case "viral_no_react":
      return `${p.ratio}× volume, market quiet`;
    case "sentiment_flip":
      return `${p.source}: ${p.from?.toFixed?.(2)} → ${p.to?.toFixed?.(2)}`;
    default:
      return "";
  }
}

export default function AnomalyChip({ anomaly, size = "sm" }) {
  if (!anomaly) return null;
  const Icon  = ICON[anomaly.type] ?? AlertTriangle;
  const label = COPY.anomalyLabel?.[anomaly.type] ?? anomaly.type;
  const style = severityStyle(anomaly.severity);
  const txt   = size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-1";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border ${style} ${txt} font-semibold whitespace-nowrap`}
      title={`${label} — ${summary(anomaly)}`}
    >
      <Icon size={size === "sm" ? 9 : 11} />
      <span>{label}</span>
      <span className="font-normal opacity-80 hidden sm:inline">· {summary(anomaly)}</span>
    </span>
  );
}
