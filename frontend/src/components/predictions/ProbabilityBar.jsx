/**
 * ProbabilityBar — horizontal YES/NO bar for a market's implied probability.
 *
 * Visual:
 *   ┌─────────────────────────────────────────┐
 *   │  YES 63% ████████████████░░░░░░░░  37% NO │
 *   └─────────────────────────────────────────┘
 *           "Market-implied probability. Not a prediction guarantee."
 *
 * Always pairs with the disclaimer (per copyGuide). Caller can hide the
 * disclaimer when the parent already renders one.
 */

import { formatProbability, probabilityColor } from "../../lib/predictionFormat";
import { COPY } from "../../lib/copyGuide";
import { useT } from "../../lib/i18n";

export default function ProbabilityBar({
  yesPrice,
  noPrice,
  size = "md",
  showLabel = true,
  showDisclaimer = false,
  className = "",
}) {
  const { t } = useT();
  const yes = Number.isFinite(yesPrice) ? yesPrice : null;
  const no  = Number.isFinite(noPrice)  ? noPrice  : (yes != null ? 1 - yes : null);

  if (yes == null) {
    return (
      <div className={`text-xs text-[var(--color-text-tertiary)] ${className}`}>
        No live price
      </div>
    );
  }

  const yesPct = Math.max(0, Math.min(100, yes * 100));
  // Display NO as the complement of the displayed YES so YES% + NO% always
  // sums to 100 in the UI (raw yes+no can be off by ~1% from upstream rounding).
  const yesPctRounded = Math.round(yesPct);
  const noPctDisplay  = 1 - Math.max(0, Math.min(1, yesPctRounded / 100));
  const yesColor = probabilityColor(yes);

  const heights = { sm: "h-1.5", md: "h-2.5", lg: "h-3.5" };
  const text    = { sm: "text-xs", md: "text-sm", lg: "text-base" };

  return (
    <div className={className}>
      {showLabel && (
        <div className={`flex justify-between items-baseline mb-1 ${text[size]}`}>
          <span className="font-semibold tracking-tight" style={{ color: yesColor }}>
            YES {formatProbability(yes)}
          </span>
          <span className="text-[var(--color-text-secondary)] tabular-nums">
            NO {formatProbability(noPctDisplay)}
          </span>
        </div>
      )}
      <div
        className={`w-full rounded-full overflow-hidden bg-[var(--color-surface2)] ${heights[size]}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(yesPct)}
        aria-label={`${COPY.probabilityLabel}: ${formatProbability(yes)} yes, ${formatProbability(noPctDisplay)} no`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${yesPct}%`, backgroundColor: yesColor }}
        />
      </div>
      {showDisclaimer && (
        <p className="mt-1 text-[10px] text-[var(--color-text-tertiary)] italic">
          {COPY.probabilityNote(t)}
        </p>
      )}
    </div>
  );
}
