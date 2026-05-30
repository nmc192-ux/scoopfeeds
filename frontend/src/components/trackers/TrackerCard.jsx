/**
 * TrackerCard — Layer 1 card for the Tracker Auto-Detection Engine
 * (Sprint 1.5.2). Mirrors EventCard.jsx's aesthetic exactly (Tailwind +
 * var(--color-*) custom properties + lucide-react icons + the same
 * rounded-xl border/hover treatment) so it feels native inside the existing
 * events UI rather than introducing a new design language.
 *
 * Two display states:
 *   • metrics present → per-template headline figure + confidence flag
 *     (conflict + environmental get precise §5 treatment; the other 6 use a
 *     graceful generic headline — first preferred metric present).
 *   • metrics EMPTY (the common production case — wire-density quartet and
 *     every freshly-detected tracker start here) → the Q3 empty-state:
 *     "Tracking · no data yet" pill. Designed as a first-class state, NOT a
 *     broken-looking blank card.
 *
 * Provenance indicator (Q4) is subtle: a small muted "source-verified" vs
 * "wire-sourced" line driven by data_source_provenance.
 *
 * i18n: structural labels go through t() (lib/i18n.js static-key system,
 * keys in locales/*.json); each t() call passes an English fallback so
 * untranslated locales degrade to readable English rather than raw keys.
 * Mirrors EventCard's choice to render the (dynamic) title raw.
 *
 * Display helpers (resolveHeadline / provenanceLabel / confidenceBadgeClass /
 * relativeTime / capitalize) live in lib/trackerFormat.js — the single source
 * of truth shared with the Layer 2 page (TrackerPage, /trackers/:id). The
 * provenance logic in particular was bug-fixed during 1.5.2 review, so it
 * must not be duplicated here (it would drift).
 *
 * Link target is /trackers/:id — the Layer 2 tracker page (Sprint 1.5.3).
 */

import { Link } from "react-router-dom";
import { Activity, Clock, Radar } from "lucide-react";
import { useT } from "../../lib/i18n";
import {
  resolveHeadline,
  provenanceLabel,
  confidenceBadgeClass,
  relativeTime,
  capitalize,
} from "../../lib/trackerFormat";

export default function TrackerCard({ tracker }) {
  const { t } = useT();
  if (!tracker) return null;

  const { id, template_type, status, last_updated_at, data_source_provenance } = tracker;
  const headline = resolveHeadline(tracker);
  const provLabel = provenanceLabel(data_source_provenance, t);

  const typeLabel = t(`tracker.type.${template_type}`, capitalize(template_type));

  return (
    <Link
      to={`/trackers/${id}`}
      className="group flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] hover:shadow-md transition-all overflow-hidden"
    >
      <div className="flex flex-col gap-3 p-4 flex-1">
        {/* Header row: template-type badge + Radar marker (tracker affordance) */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium px-2 py-0.5 rounded-full capitalize bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">
            {typeLabel}
          </span>
          <Radar size={12} className="text-[var(--color-accent)] flex-shrink-0 ml-auto" aria-hidden="true" />
        </div>

        {/* Headline area */}
        {headline ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="text-lg font-semibold text-[var(--color-text)] leading-tight">
                {headline.value}
              </span>
              {headline.label && (
                <span className="text-xs text-[var(--color-text-secondary)]">{headline.label}</span>
              )}
            </div>
            {headline.confidence && (
              <span className={`self-start text-[10px] font-medium px-2 py-0.5 rounded-full ${confidenceBadgeClass(headline.confidence)}`}>
                {t(`tracker.confidence.${headline.confidence}`, headline.confidence)}
              </span>
            )}
          </div>
        ) : (
          /* Q3 empty-state — the common case. Deliberate, honest "tracking,
             no quantified data yet" treatment; reads as intentional, not broken. */
          <div className="flex flex-col gap-1">
            <span className="self-start text-xs font-medium px-2.5 py-1 rounded-full border border-dashed border-[var(--color-border)] text-[var(--color-text-secondary)] flex items-center gap-1.5">
              <Activity size={11} className="text-[var(--color-accent)]" />
              {t("tracker.no_data", "Tracking · no data yet")}
            </span>
          </div>
        )}

        {/* Footer: provenance (subtle) + last-updated */}
        <div className="flex items-center gap-3 text-[10px] text-[var(--color-text-secondary)] mt-auto pt-1">
          {provLabel && (
            <span className="truncate" title={provLabel}>{provLabel}</span>
          )}
          <span className="flex items-center gap-1 ml-auto">
            <Clock size={10} />
            {relativeTime(last_updated_at)}
          </span>
        </div>
      </div>
    </Link>
  );
}
