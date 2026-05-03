/**
 * RealityGauge — 4-component breakdown of the Reality Index composite.
 *
 * Renders the composite score (0..1) front-and-centre, then a horizontal
 * stacked-bar showing how each of the four lanes contributed:
 *
 *   ┌─ Market 0.50 ───────────────┬─ Media 0.20 ──┬─ Social 0.20 ──┬─ Econ 0.10 ─┐
 *   │ ████████████████████████░░░ │ ██████░░░░░   │ ████████░░░    │ ░░░░░░░░░░  │
 *   └────────────────────────────┴───────────────┴────────────────┴─────────────┘
 *
 * Each lane is shaded by its own score (0..1) within its allocation. Width
 * is the lane weight; alpha is the lane confidence. Disclaimer follows.
 */

import { COPY } from "../../lib/copyGuide";
import { useT } from "../../lib/i18n";

const LANE_COLOR = {
  market: "var(--color-accent)",
  media:  "#7c3aed",
  social: "#0ea5e9",
  econ:   "#10b981",
};

function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

function fmtPolarity(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}`;
}

function laneValue(lane, components) {
  const c = components?.[lane];
  if (!c) return null;
  // Market is already in [0..1]; sentiment lanes are in [-1..+1] → normalize.
  if (lane === "market") return Number.isFinite(c.value) ? c.value : null;
  const pol = c.polarity ?? c.value;
  return Number.isFinite(pol) ? (pol + 1) / 2 : null;
}

function Lane({ name, label, weight, value, sublabel }) {
  const w = Math.max(0.05, weight ?? 0);
  const v = value ?? 0;
  const present = value != null;
  return (
    <div className="flex flex-col gap-1" style={{ flex: w }}>
      <div className="flex items-baseline justify-between gap-1 text-[10px] text-[var(--color-text-secondary)] uppercase tracking-wide">
        <span className="font-semibold">{label}</span>
        <span className="tabular-nums">{Math.round(w * 100)}%</span>
      </div>
      <div className="h-2 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width:           present ? `${Math.max(4, v * 100)}%` : "0%",
            backgroundColor: LANE_COLOR[name],
            opacity:         present ? 0.9 : 0.3,
          }}
        />
      </div>
      <div className="text-[10px] text-[var(--color-text-tertiary)] tabular-nums">
        {sublabel}
      </div>
    </div>
  );
}

export default function RealityGauge({ snapshot }) {
  const { t } = useT();
  if (!snapshot) return null;
  const {
    reality_score, confidence, truth_gap,
    market_probability, media_sentiment, social_sentiment,
    components,
  } = snapshot;

  const score   = Number.isFinite(reality_score) ? reality_score : null;
  const weights = components?.weights ?? { market: 0.5, media: 0.2, social: 0.2, econ: 0.1 };

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5 flex flex-col gap-4">
      {/* Header + composite score */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm text-[var(--color-text)]">{COPY.gaugeTitle(t)}</h3>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{COPY.gaugeSubtitle}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl sm:text-3xl font-editorial italic tabular-nums text-[var(--color-text)]">
            {score != null ? fmtPct(score) : "—"}
          </div>
          <div className="text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-wide">
            Composite
          </div>
        </div>
      </div>

      {/* Lane breakdown */}
      <div className="flex gap-2">
        <Lane
          name="market" label="Market" weight={weights.market}
          value={laneValue("market", components)}
          sublabel={market_probability != null ? `YES ${fmtPct(market_probability)}` : "no market"}
        />
        <Lane
          name="media" label="Media" weight={weights.media}
          value={laneValue("media", components)}
          sublabel={media_sentiment != null ? fmtPolarity(media_sentiment) : "—"}
        />
        <Lane
          name="social" label="Social" weight={weights.social}
          value={laneValue("social", components)}
          sublabel={social_sentiment != null ? fmtPolarity(social_sentiment) : "—"}
        />
        <Lane
          name="econ" label="Econ" weight={weights.econ}
          value={laneValue("econ", components)}
          sublabel="Phase 5"
        />
      </div>

      {/* Footer: confidence + truth gap quick-reads */}
      <div className="flex items-center justify-between text-[10px] text-[var(--color-text-secondary)] pt-2 border-t border-[var(--color-border)]">
        <span>
          Confidence{" "}
          <span className="font-semibold text-[var(--color-text)] tabular-nums">
            {confidence != null ? fmtPct(confidence) : "—"}
          </span>
        </span>
        {truth_gap != null && (
          <span>
            Truth Gap{" "}
            <span className="font-semibold tabular-nums" style={{
              color: truth_gap > 0.15 ? "var(--color-accent)" :
                     truth_gap < -0.15 ? "#dc2626" : "var(--color-text-secondary)"
            }}>
              {fmtPolarity(truth_gap)}
            </span>
          </span>
        )}
      </div>

      <p className="text-[10px] text-[var(--color-text-tertiary)] italic">
        {COPY.brandTagline(t)}
      </p>
    </div>
  );
}
