/**
 * ─── Electric Signal — Brand color system ────────────────────────────────
 * Single source of truth for brand + topic accent colors used by NewsCard,
 * FeaturedCard, NewsGrid, MostReadSidebar, VideoCard, XFeedSection,
 * TopicNav, and the App side cards.
 *
 * Electric Signal palette (per AI Studio brand spec):
 *   primary   = Electric Blue   #3B82F6  (cobalt-500)
 *   secondary = Midnight Blue   #1E3A8A  (cobalt-800)
 *   accent    = Vivid Orange    #F97316  (CTAs, highlights, hearts)
 *   status    = Emerald         #10B981  (live / online indicator)
 *   alert     = Red             #EF4444  (true alerts only)
 *
 * Backward-compat aliases (COBALT_*) preserved so existing imports keep
 * working — they now map to the Electric Signal equivalents.
 */
export const ELECTRIC_PRIMARY   = "#3B82F6";
export const ELECTRIC_SECONDARY = "#1E3A8A";
export const ELECTRIC_ACCENT    = "#F97316";
export const ELECTRIC_LIGHT     = "#60A5FA";
export const ELECTRIC_DEEP      = "#1D4ED8";
export const STATUS_LIVE        = "#10B981";
export const COLOR_ALERT        = "#EF4444";

// Legacy aliases — keep imports working
export const COBALT_PRIMARY   = ELECTRIC_PRIMARY;
export const COBALT_SECONDARY = ELECTRIC_SECONDARY;
export const COBALT_LIGHT     = ELECTRIC_LIGHT;
export const COBALT_DEEP      = ELECTRIC_DEEP;

export const TOPIC_COLORS = {
  // ── Brand-anchored core ─────────────────────────────
  top:                ELECTRIC_PRIMARY,   // #3B82F6
  ai:                 ELECTRIC_PRIMARY,   // #3B82F6
  "agentic-ai":       ELECTRIC_DEEP,      // #1D4ED8
  weather:            ELECTRIC_LIGHT,     // #60A5FA
  local:              ELECTRIC_SECONDARY, // #1E3A8A
  saved:              ELECTRIC_PRIMARY,

  // ── Functional alerts (red kept for true alerts) ─────
  live:               COLOR_ALERT,
  breaking:           COLOR_ALERT,

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
  return TOPIC_COLORS[category] || ELECTRIC_PRIMARY;
}

export function topicLabel(category) {
  return TOPIC_LABELS[category] || category;
}

export function topicEmoji(category) {
  return TOPIC_EMOJIS[category] || "📰";
}
