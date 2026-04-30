/**
 * Curated source catalog for `/source/:slug` pages. Maps URL slug → the
 * exact source name string used by the backend's news-source field.
 *
 * Adding a new entry: pick a kebab-case slug, set `name` to the exact value
 * the backend stores in articles.source_name, and pick a region for grouping
 * in the picker UI.
 */
export const SOURCES = [
  // ── Wire / global ────────────────────────────────────────────────────
  { slug: "reuters",         name: "Reuters",            region: "global", flag: "🌍" },
  { slug: "associated-press",name: "Associated Press",   region: "global", flag: "🇺🇸" },
  { slug: "bbc-news",        name: "BBC News",           region: "europe", flag: "🇬🇧" },
  { slug: "guardian",        name: "The Guardian",       region: "europe", flag: "🇬🇧" },
  { slug: "al-jazeera",      name: "Al Jazeera English", region: "mena",   flag: "🌍" },
  // ── US ──────────────────────────────────────────────────────────────
  { slug: "npr",             name: "NPR News",           region: "americas", flag: "🇺🇸" },
  { slug: "politico",        name: "Politico",           region: "americas", flag: "🇺🇸" },
  { slug: "the-hill",        name: "The Hill",           region: "americas", flag: "🇺🇸" },
  { slug: "bloomberg",       name: "Bloomberg",          region: "americas", flag: "🇺🇸" },
  // ── Europe ──────────────────────────────────────────────────────────
  { slug: "france-24",       name: "France 24",          region: "europe", flag: "🇫🇷" },
  { slug: "dw",              name: "Deutsche Welle",     region: "europe", flag: "🇩🇪" },
  { slug: "euronews",        name: "Euronews",           region: "europe", flag: "🇪🇺" },
  // ── Asia ────────────────────────────────────────────────────────────
  { slug: "nhk",             name: "NHK World",          region: "asia",   flag: "🇯🇵" },
  { slug: "japan-times",     name: "The Japan Times",    region: "asia",   flag: "🇯🇵" },
  { slug: "channel-news-asia",name:"Channel News Asia",  region: "asia",   flag: "🇸🇬" },
  { slug: "south-china-morning-post", name: "South China Morning Post", region: "asia", flag: "🇭🇰" },
  { slug: "wion",            name: "WION",               region: "asia",   flag: "🇮🇳" },
  { slug: "ndtv",            name: "NDTV",               region: "asia",   flag: "🇮🇳" },
  { slug: "the-hindu",       name: "The Hindu",          region: "asia",   flag: "🇮🇳" },
  { slug: "dawn",            name: "Dawn",               region: "asia",   flag: "🇵🇰" },
  { slug: "geo-news",        name: "Geo News",           region: "asia",   flag: "🇵🇰" },
  // ── Tech ────────────────────────────────────────────────────────────
  { slug: "techcrunch",      name: "TechCrunch",         region: "tech",   flag: "💻" },
  { slug: "the-verge",       name: "The Verge",          region: "tech",   flag: "💻" },
  { slug: "ars-technica",    name: "Ars Technica",       region: "tech",   flag: "💻" },
  { slug: "wired",           name: "Wired",              region: "tech",   flag: "💻" },
  { slug: "hacker-news",     name: "Hacker News",        region: "tech",   flag: "💻" },
  // ── Africa / LatAm ─────────────────────────────────────────────────
  { slug: "africanews",      name: "Africa News",        region: "africa", flag: "🌍" },
  { slug: "globo",           name: "Globo",              region: "americas", flag: "🇧🇷" },
];

export const SOURCE_BY_SLUG = Object.fromEntries(SOURCES.map(s => [s.slug, s]));
