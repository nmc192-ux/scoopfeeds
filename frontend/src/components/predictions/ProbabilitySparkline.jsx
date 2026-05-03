/**
 * ProbabilitySparkline — tiny inline line chart for a market's history.
 *
 * Pure SVG, no Recharts overhead — sized for inline use in cards and tables.
 * Defaults: 120×28 px, current value endpoint highlighted.
 */

import { useMemo } from "react";
import { probabilityColor } from "../../lib/predictionFormat";

export default function ProbabilitySparkline({
  points = [],
  width = 120,
  height = 28,
  strokeWidth = 1.5,
  showEndDot = true,
  className = "",
  ariaLabel = "Probability history",
}) {
  const series = useMemo(
    () => (points || [])
      .map(p => ({ ts: p.ts, y: typeof p === "number" ? p : p.yes_price }))
      .filter(p => Number.isFinite(p.y)),
    [points]
  );

  if (series.length < 2) {
    return (
      <svg width={width} height={height} className={className} aria-label="No data" />
    );
  }

  const xMin = series[0].ts;
  const xMax = series[series.length - 1].ts;
  const xRange = Math.max(1, xMax - xMin);
  // Y is always 0..1 — fixed range so multiple sparklines compare visually.
  const padTop = 2, padBottom = 2;

  const xScale = (ts) => ((ts - xMin) / xRange) * (width - 2) + 1;
  const yScale = (y)  => padTop + (1 - y) * (height - padTop - padBottom);

  const d = series.map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.ts).toFixed(1)} ${yScale(p.y).toFixed(1)}`).join(" ");
  const last = series[series.length - 1];
  const color = probabilityColor(last.y);

  return (
    <svg
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={`${ariaLabel}: now ${(last.y * 100).toFixed(0)}%`}
    >
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      {showEndDot && (
        <circle cx={xScale(last.ts)} cy={yScale(last.y)} r={2.2} fill={color} />
      )}
    </svg>
  );
}
