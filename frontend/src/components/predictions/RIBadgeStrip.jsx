/**
 * RIBadgeStrip — compact one-line summary of an article's Reality Index
 * signals, designed to slot into NewsCard between the description and the
 * action bar. Renders nothing when no signals are present, so feed cards
 * for unbound articles look identical to today.
 *
 * Signals (in order of priority, emit only what's available):
 *   • ProbabilityBar (if top market exists)
 *   • TruthGapBadge  (if |truth_gap| > 0.15)
 *   • AnomalyChip    (if a fresh unack anomaly fired)
 * + a hairline link to the bound event dossier.
 */

import { Link } from "react-router-dom";
import { Activity } from "lucide-react";
import ProbabilityBar from "./ProbabilityBar";
import TruthGapBadge  from "./TruthGapBadge";
import AnomalyChip    from "./AnomalyChip";

export default function RIBadgeStrip({ badge }) {
  if (!badge) return null;

  const hasMarket   = Number.isFinite(badge.top_yes);
  const hasTruthGap = Number.isFinite(badge.truth_gap) && Math.abs(badge.truth_gap) > 0.15;
  const hasAnomaly  = badge.latest_anomaly?.type;

  if (!hasMarket && !hasTruthGap && !hasAnomaly) return null;

  return (
    <div
      className="mt-2 pt-2 border-t border-[var(--color-border)] flex flex-col gap-1.5"
      onClick={e => e.stopPropagation()}
    >
      {/* Top row: chips */}
      {(hasTruthGap || hasAnomaly) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {hasAnomaly  && <AnomalyChip   anomaly={badge.latest_anomaly} size="sm" />}
          {hasTruthGap && <TruthGapBadge gap={badge.truth_gap}          size="sm" />}
        </div>
      )}

      {/* Probability bar */}
      {hasMarket && (
        <ProbabilityBar
          yesPrice={badge.top_yes}
          noPrice={1 - badge.top_yes}
          size="sm"
          showLabel={true}
          showDisclaimer={false}
        />
      )}

      {/* Footer: source attribution + dossier link */}
      <div className="flex items-center justify-between text-[10px] text-[var(--color-text-tertiary)]">
        <span>{badge.source ? `Source: ${badge.source}` : ""}</span>
        {badge.event_slug && (
          <Link
            to={`/events/${badge.event_slug}`}
            onClick={e => e.stopPropagation()}
            className="inline-flex items-center gap-0.5 hover:text-[var(--color-accent)] transition-colors"
          >
            <Activity size={9} />
            Event dossier →
          </Link>
        )}
      </div>
    </div>
  );
}
