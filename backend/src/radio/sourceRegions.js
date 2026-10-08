/**
 * sourceRegions.js — which audience region each outlet belongs to, and what that
 * outlet's coverage is worth to ScoopFeeds Radio's ranking.
 *
 * WHY WEIGHTS. Radio is US-first (DrJ, R2 gate, 8 Oct 2026). A story's score is
 * the weighted count of DISTINCT outlets covering it, so five US outlets beat five
 * outlets from elsewhere, without any one outlet being able to push a story up on
 * its own (an outlet counts once per story however many items it files).
 *
 *   US                          1.5
 *   UK / Europe                 1.2
 *   Gulf / Middle East English  1.2
 *   everyone else               1.0   (also the default for an unknown name)
 *
 * BUILT FROM config/sources.js, not a second list. Each RSS source already carries
 * a `region`. Most are tagged "global", which says nothing about where the outlet
 * is, so OVERRIDES below place the global-tagged outlets by name. A source added
 * to config/sources.js later lands at its own region if it has a specific one,
 * and at 1.0 otherwise: never silently boosted.
 *
 * The Indian-outlet list used by the D1 rules is exported from here too, so the
 * two can never disagree about which outlets are Indian.
 */
import { RSS_SOURCES } from "../config/sources.js";

export const REGION_WEIGHTS = Object.freeze({
  us: 1.5,
  europe: 1.2,
  middle_east: 1.2,
  other: 1.0,
});

// config/sources.js region code → radio audience region.
const REGION_FROM_CODE = {
  "us": "us", "us-east": "us", "us-west": "us", "us-midwest": "us",
  "eu": "europe", "fr": "europe", "de": "europe", "uk": "europe",
  "sa": "middle_east", "il": "middle_east", "ae": "middle_east", "qa": "middle_east",
};

// Outlets tagged region:"global" in config/sources.js, placed by where they are
// published. Anything global and not listed stays "other" (WHO, Investing.com…).
const OVERRIDES = {
  // UK / Europe
  "BBC News": "europe", "BBC Politics": "europe", "BBC World": "europe", "BBC Sport": "europe",
  "BBC Business": "europe", "The Guardian": "europe", "The Guardian Environment": "europe",
  "Financial Times": "europe", "The Economist": "europe", "New Scientist": "europe",
  "Nature News": "europe", "Top Gear": "europe", "Carbon Brief": "europe",
  "Climate Home News": "europe", "BMJ News": "europe", "DW English": "europe", "France 24": "europe",
  // Gulf / Middle East (English)
  "Al Jazeera": "middle_east",
  // US
  "Science Daily": "us", "NASA News": "us", "Scientific American": "us", "Medical News Today": "us",
  "WebMD": "us", "Healthline": "us", "Harvard Health": "us", "Mind Body Green": "us",
  "Verywell Mind": "us", "Inside Climate News": "us", "Car and Driver": "us", "MotorTrend": "us",
  "Road & Track": "us", "MIT Technology Review": "us", "VentureBeat AI": "us", "The Verge AI": "us",
  "Wired": "us", "TechCrunch AI": "us", "Hacker News": "us", "IEEE Spectrum": "us", "TechCrunch": "us",
  "Ars Technica": "us", "Anthropic Blog": "us", "OpenAI Blog": "us", "The Verge": "us",
  "Engadget": "us", "CNET": "us", "Gizmodo": "us", "MacRumors": "us", "9to5Mac": "us",
  "Bloomberg Tech": "us", "Bloomberg Markets": "us", "Forbes": "us", "Fortune": "us",
  "Fast Company": "us", "Foreign Affairs": "us", "The Atlantic": "us", "Smithsonian": "us",
  "The New Yorker": "us", "CoinDesk": "us", "The Block": "us", "Decrypt": "us", "Grist": "us",
  "Defense News": "us", "War on the Rocks": "us", "Foreign Policy": "us", "STAT News": "us",
};

function buildMap() {
  const map = new Map();
  for (const s of RSS_SOURCES) {
    if (!s?.name) continue;
    const code = String(s.region || "").toLowerCase();
    const region = OVERRIDES[s.name] || REGION_FROM_CODE[code] || "other";
    map.set(s.name, { region, code });
  }
  return map;
}

const SOURCES = buildMap();

/** The audience region for an outlet name ("us" | "europe" | "middle_east" | "other"). */
export function regionOf(sourceName) {
  return SOURCES.get(String(sourceName || ""))?.region || "other";
}

/** The ranking weight for an outlet name. Unknown names are 1.0. */
export function weightOf(sourceName) {
  return REGION_WEIGHTS[regionOf(sourceName)] ?? 1.0;
}

/**
 * Indian outlets: every source config/sources.js tags region "in", plus Indian
 * wires that can arrive through aggregators under these names.
 */
export const INDIAN_OUTLETS = Object.freeze([...new Set([
  ...RSS_SOURCES.filter((s) => String(s.region || "").toLowerCase() === "in").map((s) => s.name),
  "The Hindu", "Times of India", "Indian Express", "Hindustan Times", "NDTV", "India Today",
  "News18", "Zee News", "Republic World", "The Print", "ThePrint", "Firstpost", "WION",
  "Economic Times", "The Economic Times", "Deccan Herald", "Deccan Chronicle", "The Tribune India",
  "PTI", "ANI", "IANS", "Scroll.in", "The Wire", "Mint", "Livemint", "Business Standard",
  "India TV", "Aaj Tak", "OpIndia", "Swarajya",
])]);

const INDIAN_SET = new Set(INDIAN_OUTLETS.map((n) => n.toLowerCase()));

/** True when the outlet name is one of INDIAN_OUTLETS (case-insensitive). */
export function isIndianOutlet(sourceName) {
  return INDIAN_SET.has(String(sourceName || "").trim().toLowerCase());
}

export const _internals = { OVERRIDES, REGION_FROM_CODE, SOURCES };
