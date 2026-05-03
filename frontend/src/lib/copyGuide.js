/**
 * copyGuide — single source of truth for prediction-related UI copy.
 *
 * Section 5D-bis of the plan ("Branding & framing safeguards"):
 *   • Reality Index is always paired with "data-backed estimate, not a certainty".
 *   • Every probability surface carries the "market-implied probability" line.
 *   • Truth Gap: "useful as a signal, not a verdict".
 *   • Avoid the bare word "prediction" in user-facing copy.
 *
 * Importing from one file keeps wording consistent across components.
 */

export const COPY = {
  // Brand and core lexicon
  brandName:        "Reality Index",
  brandTagline:     "A data-backed estimate, not a certainty.",

  // Probability cards / bars
  probabilityLabel: "Market-implied probability",
  probabilityNote:  "Market-implied probability. Not a prediction guarantee.",

  // Reality Index panel header
  panelTitle:       "Reality Index",
  panelSubtitle:    "What prediction markets are pricing in for this story.",

  // Confidence indicator
  confidenceTitle:  (label) => `Confidence: ${label}`,
  confidenceTooltip: ({ score, components }) =>
    `${(score * 100).toFixed(0)}% confidence — based on liquidity ` +
    `(${pct(components?.liquidity)}), volume (${pct(components?.volume)}), ` +
    `spread (${pct(components?.spread)}), history (${pct(components?.history)}).`,

  // Truth gap (Phase 3)
  truthGapTitle:    "Truth Gap",
  truthGapTooltip:  "Difference between media tone and market-implied probability. Useful as a signal, not a verdict.",
  truthGapOver:     "Markets price this higher than media tone suggests.",
  truthGapUnder:    "Media is more confident than markets.",
  truthGapNarrow:   "Media and markets roughly agree.",

  // Reality Index gauge (Phase 3)
  gaugeTitle:       "Reality Index",
  gaugeSubtitle:    "Composite of market, media, and social signals.",

  // Anomaly chip (Phase 3)
  anomalyLabel: {
    odds_shift:      "Market shift",
    truth_gap_spike: "Divergence spike",
    viral_no_react:  "Viral, market quiet",
    sentiment_flip:  "Sentiment flip",
  },

  // Source attribution
  sourceLabel:      (src) => `Source: ${labelFor(src)}`,

  // Empty / no-match state
  noMatchTitle:     "No bound market yet",
  noMatchBody:      "We haven't found a prediction market that captures this story's outcome yet. Check back as coverage develops.",

  // AI brief disclosure (Phase 4)
  briefBadge:       "AI-drafted, editor-reviewed",
};

function pct(v) {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return `${Math.round(v * 100)}%`;
}

function labelFor(src) {
  switch ((src || "").toLowerCase()) {
    case "polymarket": return "Polymarket";
    case "kalshi":     return "Kalshi";
    case "manifold":   return "Manifold";
    case "synthetic":  return "Scoopfeeds Synthetic";
    default:           return src || "Unknown";
  }
}
