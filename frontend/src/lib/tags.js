/**
 * Curated entity-tag catalog for `/tag/:slug`. Each entry maps a slug to a
 * search keyword that finds related stories via the existing news API
 * (?search=…). These are evergreen "what's happening with X" pages — long-tail
 * SEO targets that compound over time.
 *
 * Adding a tag: pick a kebab-case slug, write a 1-line descriptor, choose
 * the highest-recall single keyword, and add a flag/emoji.
 */
export const TAGS = [
  // ── Tech & AI ───────────────────────────────────────────────────────
  { slug: "openai",      name: "OpenAI",        emoji: "🤖", group: "tech",     query: "OpenAI",
    blurb: "GPT, ChatGPT, Sam Altman, and OpenAI's latest moves." },
  { slug: "google",      name: "Google",        emoji: "🔍", group: "tech",     query: "Google",
    blurb: "Gemini, Search, Cloud, Android — Google news." },
  { slug: "apple",       name: "Apple",         emoji: "🍎", group: "tech",     query: "Apple",
    blurb: "iPhone, Mac, Vision Pro, Apple Intelligence." },
  { slug: "microsoft",   name: "Microsoft",     emoji: "🪟", group: "tech",     query: "Microsoft",
    blurb: "Windows, Copilot, Azure, OpenAI partnership." },
  { slug: "meta",        name: "Meta",          emoji: "📘", group: "tech",     query: "Meta",
    blurb: "Facebook, Instagram, WhatsApp, Reality Labs." },
  { slug: "tesla",       name: "Tesla",         emoji: "🔋", group: "tech",     query: "Tesla",
    blurb: "EVs, FSD, Robotaxi, Cybertruck, energy storage." },
  { slug: "spacex",      name: "SpaceX",        emoji: "🚀", group: "tech",     query: "SpaceX",
    blurb: "Starship, Falcon, Starlink, Mars program." },
  { slug: "nvidia",      name: "Nvidia",        emoji: "🟩", group: "tech",     query: "Nvidia",
    blurb: "GPUs, AI chips, data center demand." },

  // ── Politics & World ────────────────────────────────────────────────
  { slug: "ukraine",     name: "Ukraine",       emoji: "🇺🇦", group: "politics", query: "Ukraine",
    blurb: "War, diplomacy, reconstruction, NATO support." },
  { slug: "israel-gaza", name: "Israel & Gaza", emoji: "🕊️", group: "politics", query: "Israel",
    blurb: "Conflict updates, hostage talks, regional response." },
  { slug: "china",       name: "China",         emoji: "🇨🇳", group: "politics", query: "China",
    blurb: "Beijing's politics, economy, and global influence." },
  { slug: "trump",       name: "Trump",         emoji: "🇺🇸", group: "politics", query: "Trump",
    blurb: "Trump administration policy, statements, legal." },
  { slug: "us-elections",name: "US Elections",  emoji: "🗳️", group: "politics", query: "election",
    blurb: "Polls, primaries, and US electoral politics." },
  { slug: "eu",          name: "European Union",emoji: "🇪🇺", group: "politics", query: "European Union",
    blurb: "EU policy, parliament, and member states." },
  { slug: "brexit",      name: "Brexit",        emoji: "🇬🇧", group: "politics", query: "Brexit",
    blurb: "Post-Brexit trade, Northern Ireland, regulatory divergence." },

  // ── Climate & Science ──────────────────────────────────────────────
  { slug: "climate",     name: "Climate",       emoji: "🌍", group: "science",  query: "climate",
    blurb: "Climate change, COP, energy transition, extreme weather." },
  { slug: "space",       name: "Space",         emoji: "🌌", group: "science",  query: "space",
    blurb: "NASA, telescopes, exoplanets, asteroid science." },
  { slug: "artificial-intelligence", name: "AI", emoji: "🧠", group: "science", query: "artificial intelligence",
    blurb: "AI research, models, policy, and industry impact." },

  // ── Business & Markets ─────────────────────────────────────────────
  { slug: "stocks",      name: "Stocks",        emoji: "📈", group: "business", query: "stocks",
    blurb: "Equity markets, IPOs, earnings, and analyst calls." },
  { slug: "crypto",      name: "Crypto",        emoji: "🪙", group: "business", query: "Bitcoin",
    blurb: "Bitcoin, Ethereum, regulation, market moves." },
  { slug: "fed",         name: "Federal Reserve",emoji: "🏛️", group: "business", query: "Federal Reserve",
    blurb: "Rate decisions, inflation, monetary policy." },
  { slug: "oil",         name: "Oil & Energy",  emoji: "🛢️", group: "business", query: "oil",
    blurb: "Brent/WTI prices, OPEC, sanctions, gas markets." },

  // ── Sports & Culture ───────────────────────────────────────────────
  { slug: "olympics",    name: "Olympics",      emoji: "🏅", group: "sports",   query: "Olympics",
    blurb: "Olympic Games coverage and athlete stories." },
  { slug: "world-cup",   name: "World Cup",     emoji: "⚽", group: "sports",   query: "World Cup",
    blurb: "Football World Cup qualifiers, draw, and tournament." },
  { slug: "premier-league", name: "Premier League", emoji: "⚽", group: "sports", query: "Premier League",
    blurb: "English Premier League fixtures, transfers, results." },
  { slug: "nba",         name: "NBA",           emoji: "🏀", group: "sports",   query: "NBA",
    blurb: "NBA season, playoffs, trades, and player news." },
];

export const TAG_BY_SLUG = Object.fromEntries(TAGS.map(t => [t.slug, t]));
