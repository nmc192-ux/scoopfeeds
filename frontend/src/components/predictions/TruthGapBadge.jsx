/**
 * TruthGapBadge — compact pill summarizing the signed media-vs-market gap
 * for an event.
 *
 *   gap > 0.15  → "Markets ↑ vs Media" (amber)
 *   gap < -0.15 → "Media ↑ vs Markets" (purple)
 *   else        → "Aligned" (neutral gray)
 *
 * Tooltip text always carries the "useful as a signal, not a verdict" copy.
 */

import { COPY } from "../../lib/copyGuide";
import { useT } from "../../lib/i18n";

function bucket(gap) {
  if (gap == null || !Number.isFinite(gap)) return null;
  if (gap >  0.15) return "over";
  if (gap < -0.15) return "under";
  return "narrow";
}

const STYLE = {
  over:   { bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-300", arrow: "↑M" },
  under:  { bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-700 dark:text-purple-300", arrow: "↑N" },
  narrow: { bg: "bg-gray-100 dark:bg-gray-800",       text: "text-gray-600 dark:text-gray-300",      arrow: "≈"  },
};

const LABEL = {
  over:   "Markets > Media",
  under:  "Media > Markets",
  narrow: "Aligned",
};

export default function TruthGapBadge({ gap, size = "md" }) {
  const { t } = useT();
  const b = bucket(gap);
  if (!b) return null;
  const s = STYLE[b];
  const txt = { sm: "text-[10px] px-1.5 py-0.5", md: "text-xs px-2 py-0.5", lg: "text-sm px-2.5 py-1" }[size];
  return (
    <span
      title={`${LABEL[b]} • ${gap.toFixed(2)} • ${COPY.truthGapTooltip(t)}`}
      className={`inline-flex items-center gap-1 rounded-full ${s.bg} ${s.text} ${txt} font-semibold tabular-nums`}
    >
      <span className="font-mono">{s.arrow}</span>
      <span className="uppercase tracking-wide">{COPY.truthGapTitle(t)}</span>
      <span>{gap > 0 ? "+" : ""}{gap.toFixed(2)}</span>
    </span>
  );
}
