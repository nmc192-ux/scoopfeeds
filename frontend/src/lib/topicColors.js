/**
 * ─── Cobalt Intelligence — Topic color system ────────────────────────────
 * Single source of truth for category accent colors used by NewsCard,
 * FeaturedCard, NewsGrid, MostReadSidebar, VideoCard, XFeedSection,
 * TopicNav, and the App side cards.
 *
 * Anchored on the cobalt palette (#2563EB primary, #1E3A8A secondary)
 * with distinct hues for each topic. Live/breaking stays red (#EF4444)
 * because that's a functional alert convention readers expect.
 */
export const COBALT_PRIMARY   = "#2563EB";
export const COBALT_SECONDARY = "#1E3A8A";
export const COBALT_LIGHT     = "#60A5FA";
export const COBALT_DEEP      = "#1D4ED8";

export const TOPIC_COLORS = {
  // ── Cobalt-anchored core ────────────────────────────
  top:                COBALT_PRIMARY,    // #2563EB
  ai:                 "#3B82F6",         // cobalt-500
  "agentic-ai":       COBALT_DEEP,       // #1D4ED8
  weather:            COBALT_LIGHT,      // #60A5FA
  local:              COBALT_SECONDARY,  // #1E3A8A
  saved:              COBALT_PRIMARY,

  // ── Functional alerts (kept red) ─────────────────────
  live:               "#EF4444",
  breaking:           "#EF4444",

  // ── Distinct categorical hues ────────────────────────
  world:              "#7C3AED",  // violet
  international:      "#7C3AED",
  pakistan:           "#01411C",  // PK green (national identity)
  politics:           "#0EA5E9",  // sky
  business:           "#F59E0B",  // amber
  tech:               "#06B6D4",  // cyan
  "computer-science": "#06B6D4",
  science:            "#8B5CF6",  // purple
  sports:             "#10B981",  // emerald
  medicine:           "#EC4899",  // pink
  health:             "#14B8A6",  // teal
  "public-health":    "#14B8A6",
  "self-help":        "#A855F7",  // light purple
  environment:        "#22C55E",  // green
  entertainment:      "#EC4899",  // pink
};

export const TOPIC_LABELS = {
  top:                "Top",
  live:               "Live",
  local:              "Local",
  world:              "World",
  international:      "World",
  pakistan:           "Pakistan",
  politics:           "Politics",
  business:           "Business",
  tech:               "Tech",
  "computer-science": "Tech",
  science:            "Science",
  sports:             "Sports",
  medicine:           "Medicine",
  health:             "Health",
  "public-health":    "Public Health",
  "self-help":        "Wellness",
  environment:        "Environment",
  weather:            "Weather",
  ai:                 "AI",
  "agentic-ai":       "Agentic AI",
  entertainment:      "Entertainment",
};

export const TOPIC_EMOJIS = {
  top: "📰", politics: "🏛️", international: "🌍", world: "🌍", pakistan: "🇵🇰",
  local: "📍", sports: "🏆", science: "🔬", medicine: "💊",
  health: "💪", "public-health": "🏥", "self-help": "🌟",
  environment: "🌱", weather: "🌤️", ai: "🤖", business: "💼",
  tech: "💻", "computer-science": "💻", "agentic-ai": "🤖",
  entertainment: "🎬", live: "🔴",
};

export function topicColor(category) {
  return TOPIC_COLORS[category] || COBALT_PRIMARY;
}

export function topicLabel(category) {
  return TOPIC_LABELS[category] || category;
}

export function topicEmoji(category) {
  return TOPIC_EMOJIS[category] || "📰";
}
