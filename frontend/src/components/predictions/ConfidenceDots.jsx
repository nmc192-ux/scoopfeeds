/**
 * ConfidenceDots — 5-dot indicator for market confidence.
 *
 * Mirrors the existing CredibilityDots pattern in NewsCard to keep visual
 * language consistent (5 dots, color = filled tier).
 *
 * Always shows the value — per the plan's branding rules ("low confidence is
 * a feature, not a flaw"), we never hide low-confidence states.
 */

import clsx from "clsx";
import { COPY } from "../../lib/copyGuide";
import { CONFIDENCE_TIER_COLOR } from "../../lib/predictionFormat";

export default function ConfidenceDots({ confidence, size = "md", className = "" }) {
  if (!confidence) return null;
  const score = typeof confidence === "number" ? confidence : confidence.score;
  const label = typeof confidence === "object" ? confidence.label : (
    score >= 0.7 ? "high" : score >= 0.45 ? "medium" : "low"
  );
  const components = typeof confidence === "object" ? confidence.components : null;

  // Score → 1..5 dots (round up so 0.6 → 3 dots, 0.61 → 4 dots).
  const filled = Math.max(1, Math.min(5, Math.ceil((score ?? 0) * 5)));
  const dotColor = CONFIDENCE_TIER_COLOR[label] || "bg-gray-400";

  const dotSizes = {
    sm: "w-1 h-1 gap-0.5",
    md: "w-1.5 h-1.5 gap-0.5",
    lg: "w-2 h-2 gap-1",
  };
  const wrapperGap = dotSizes[size].split(" ").pop();

  const tooltip = COPY.confidenceTooltip({ score, components });

  return (
    <div
      className={clsx("inline-flex items-center", wrapperGap, className)}
      role="img"
      aria-label={`${COPY.confidenceTitle(label)} (${Math.round((score ?? 0) * 100)}%)`}
      title={tooltip}
    >
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className={clsx(
            "rounded-full",
            dotSizes[size].split(" ").slice(0, 2).join(" "),
            i < filled ? dotColor : "bg-[var(--color-border)]"
          )}
        />
      ))}
    </div>
  );
}
