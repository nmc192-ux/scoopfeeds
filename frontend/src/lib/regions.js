/**
 * Regions + Countries metadata for `/region/:slug` and `/country/:iso` pages.
 *
 * Each entry maps to a search keyword used against /api/news?search=… so we
 * can ship country/region pages without per-source country tagging on every
 * RSS feed. US and PK use the dedicated `tab=local&country=…` path because
 * those have proper region tags wired up in the source catalog.
 *
 * `query` — full-text search keyword. Single phrase since the news API
 *           doesn't support OR queries; pick the highest-recall name.
 */

export const REGIONS = [
  {
    slug: "world",
    label: "World",
    emoji: "🌍",
    blurb: "Global wire stories from major international newsrooms.",
    query: null, // null → all global wire (no search filter)
  },
  {
    slug: "americas",
    label: "Americas",
    emoji: "🌎",
    blurb: "News from North, Central, and South America.",
    query: "America",
  },
  {
    slug: "europe",
    label: "Europe",
    emoji: "🇪🇺",
    blurb: "Coverage from across the European Union, UK, and beyond.",
    query: "Europe",
  },
  {
    slug: "asia",
    label: "Asia",
    emoji: "🌏",
    blurb: "Stories from East, South, Southeast, and Central Asia.",
    query: "Asia",
  },
  {
    slug: "mena",
    label: "MENA",
    emoji: "🕌",
    blurb: "Middle East and North Africa coverage.",
    query: "Middle East",
  },
  {
    slug: "africa",
    label: "Africa",
    emoji: "🌍",
    blurb: "News from across the African continent.",
    query: "Africa",
  },
  {
    slug: "oceania",
    label: "Oceania",
    emoji: "🌊",
    blurb: "Australia, New Zealand, and Pacific island nations.",
    query: "Australia",
  },
];

export const REGION_BY_SLUG = Object.fromEntries(REGIONS.map(r => [r.slug, r]));

/* ─── Countries ──────────────────────────────────────────────────────────── */
// Curated set covering the largest user markets. Each maps to a search
// keyword for the news API. ISO codes lowercased in URLs (/country/jp).

export const COUNTRIES = [
  { iso: "us", name: "United States",   flag: "🇺🇸", query: null,           useLocalTab: true },
  { iso: "gb", name: "United Kingdom",  flag: "🇬🇧", query: "Britain" },
  { iso: "ca", name: "Canada",          flag: "🇨🇦", query: "Canada" },
  { iso: "au", name: "Australia",       flag: "🇦🇺", query: "Australia" },
  { iso: "nz", name: "New Zealand",     flag: "🇳🇿", query: "New Zealand" },
  { iso: "de", name: "Germany",         flag: "🇩🇪", query: "Germany" },
  { iso: "fr", name: "France",          flag: "🇫🇷", query: "France" },
  { iso: "it", name: "Italy",           flag: "🇮🇹", query: "Italy" },
  { iso: "es", name: "Spain",           flag: "🇪🇸", query: "Spain" },
  { iso: "nl", name: "Netherlands",     flag: "🇳🇱", query: "Netherlands" },
  { iso: "se", name: "Sweden",          flag: "🇸🇪", query: "Sweden" },
  { iso: "no", name: "Norway",          flag: "🇳🇴", query: "Norway" },
  { iso: "ch", name: "Switzerland",     flag: "🇨🇭", query: "Switzerland" },
  { iso: "ie", name: "Ireland",         flag: "🇮🇪", query: "Ireland" },
  { iso: "ua", name: "Ukraine",         flag: "🇺🇦", query: "Ukraine" },
  { iso: "ru", name: "Russia",          flag: "🇷🇺", query: "Russia" },
  { iso: "tr", name: "Türkiye",         flag: "🇹🇷", query: "Turkey" },
  // Asia
  { iso: "in", name: "India",           flag: "🇮🇳", query: "India" },
  { iso: "pk", name: "Pakistan",        flag: "🇵🇰", query: null,           useLocalTab: true },
  { iso: "bd", name: "Bangladesh",      flag: "🇧🇩", query: "Bangladesh" },
  { iso: "lk", name: "Sri Lanka",       flag: "🇱🇰", query: "Sri Lanka" },
  { iso: "cn", name: "China",           flag: "🇨🇳", query: "China" },
  { iso: "jp", name: "Japan",           flag: "🇯🇵", query: "Japan" },
  { iso: "kr", name: "South Korea",     flag: "🇰🇷", query: "Korea" },
  { iso: "tw", name: "Taiwan",          flag: "🇹🇼", query: "Taiwan" },
  { iso: "hk", name: "Hong Kong",       flag: "🇭🇰", query: "Hong Kong" },
  { iso: "sg", name: "Singapore",       flag: "🇸🇬", query: "Singapore" },
  { iso: "my", name: "Malaysia",        flag: "🇲🇾", query: "Malaysia" },
  { iso: "id", name: "Indonesia",       flag: "🇮🇩", query: "Indonesia" },
  { iso: "ph", name: "Philippines",     flag: "🇵🇭", query: "Philippines" },
  { iso: "th", name: "Thailand",        flag: "🇹🇭", query: "Thailand" },
  { iso: "vn", name: "Vietnam",         flag: "🇻🇳", query: "Vietnam" },
  // MENA
  { iso: "ae", name: "UAE",             flag: "🇦🇪", query: "UAE" },
  { iso: "sa", name: "Saudi Arabia",    flag: "🇸🇦", query: "Saudi" },
  { iso: "qa", name: "Qatar",           flag: "🇶🇦", query: "Qatar" },
  { iso: "il", name: "Israel",          flag: "🇮🇱", query: "Israel" },
  { iso: "ir", name: "Iran",            flag: "🇮🇷", query: "Iran" },
  { iso: "eg", name: "Egypt",           flag: "🇪🇬", query: "Egypt" },
  // Africa
  { iso: "ng", name: "Nigeria",         flag: "🇳🇬", query: "Nigeria" },
  { iso: "za", name: "South Africa",    flag: "🇿🇦", query: "South Africa" },
  { iso: "ke", name: "Kenya",           flag: "🇰🇪", query: "Kenya" },
  { iso: "et", name: "Ethiopia",        flag: "🇪🇹", query: "Ethiopia" },
  { iso: "gh", name: "Ghana",           flag: "🇬🇭", query: "Ghana" },
  // Latin America
  { iso: "br", name: "Brazil",          flag: "🇧🇷", query: "Brazil" },
  { iso: "mx", name: "Mexico",          flag: "🇲🇽", query: "Mexico" },
  { iso: "ar", name: "Argentina",       flag: "🇦🇷", query: "Argentina" },
  { iso: "cl", name: "Chile",           flag: "🇨🇱", query: "Chile" },
  { iso: "co", name: "Colombia",        flag: "🇨🇴", query: "Colombia" },
];

export const COUNTRY_BY_ISO = Object.fromEntries(COUNTRIES.map(c => [c.iso, c]));
