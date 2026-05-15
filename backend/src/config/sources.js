/**
 * RSS Feed Sources + YouTube Channel Sources + X (Twitter) Account Curation
 * Each source: name, url, category, credibility (1-10), region
 * isVideo: true marks YouTube channel RSS feeds
 */

export const RSS_SOURCES = [
  // ─── TOP NEWS / GENERAL ───────────────────────────────────────────
  // Note: Reuters topNews + Associated Press apf-topnews removed
  // 2026-05-15 (Phase A source audit Phase 2 / Sprint 4.3).
  // feeds.reuters.com decommissioned (NXDOMAIN); apnews.com/apf-*
  // returns HTML hub page, no public RSS replacement exists.
  // Wire-service category needs Phase B Track 1 rebuild.
  { name: "BBC News",        url: "https://feeds.bbci.co.uk/news/rss.xml",               category: "top",     credibility: 10, region: "global" },
  { name: "NPR News",        url: "https://feeds.npr.org/1001/rss.xml",                  category: "top",     credibility: 9,  region: "us"     },
  { name: "The Guardian",    url: "https://www.theguardian.com/world/rss",               category: "top",     credibility: 9,  region: "global" },

  // ─── POLITICS ─────────────────────────────────────────────────────
  { name: "Politico",        url: "https://rss.politico.com/politics-news.xml",          category: "politics", credibility: 9,  region: "us"     },
  { name: "The Hill",        url: "https://thehill.com/news/feed/",                      category: "politics", credibility: 8,  region: "us"     },
  { name: "NPR Politics",    url: "https://feeds.npr.org/1014/rss.xml",                  category: "politics", credibility: 9,  region: "us"     },
  { name: "BBC Politics",    url: "https://feeds.bbci.co.uk/news/politics/rss.xml",      category: "politics", credibility: 10, region: "global" },

  // ─── INTERNATIONAL ────────────────────────────────────────────────
  { name: "BBC World",       url: "https://feeds.bbci.co.uk/news/world/rss.xml",         category: "international", credibility: 10, region: "global" },
  { name: "Al Jazeera",      url: "https://www.aljazeera.com/xml/rss/all.xml",           category: "international", credibility: 8,  region: "global" },
  { name: "DW English",      url: "https://rss.dw.com/rdf/rss-en-all",                  category: "international", credibility: 9,  region: "global" },
  { name: "France 24",       url: "https://www.france24.com/en/rss",                    category: "international", credibility: 9,  region: "global" },

  // ─── PAKISTAN ─────────────────────────────────────────────────────
  { name: "Dawn News",       url: "https://www.dawn.com/feed",                           category: "pakistan", credibility: 9,  region: "pk"     },
  { name: "The News Intl",   url: "https://www.thenews.com.pk/rss/1/8",                 category: "pakistan", credibility: 8,  region: "pk"     },
  { name: "Geo News",        url: "https://www.geo.tv/rss/1/1",                         category: "pakistan", credibility: 8,  region: "pk"     },
  { name: "ARY News",        url: "https://arynews.tv/feed/",                            category: "pakistan", credibility: 8,  region: "pk"     },
  { name: "Express Tribune",url: "https://tribune.com.pk/feed",                          category: "pakistan", credibility: 8,  region: "pk"     },
  { name: "Business Recorder",url: "https://www.brecorder.com/feed",                    category: "pakistan", credibility: 8,  region: "pk"     },
  { name: "Pakistan Observer",url: "https://pakobserver.net/feed/",                     category: "pakistan", credibility: 7,  region: "pk"     },

  // ─── SPORTS ───────────────────────────────────────────────────────
  { name: "ESPN",            url: "https://www.espn.com/espn/rss/news",                 category: "sports",  credibility: 9,  region: "us"     },
  { name: "BBC Sport",       url: "https://feeds.bbci.co.uk/sport/rss.xml",             category: "sports",  credibility: 10, region: "global" },
  { name: "Sports Illustrated", url: "https://www.si.com/rss/si_topstories.rss",        category: "sports",  credibility: 8,  region: "us"     },

  // ─── SCIENCE ──────────────────────────────────────────────────────
  { name: "Science Daily",   url: "https://www.sciencedaily.com/rss/all.xml",           category: "science", credibility: 9,  region: "global" },
  { name: "NASA News",       url: "https://www.nasa.gov/rss/dyn/breaking_news.rss",     category: "science", credibility: 10, region: "global" },
  { name: "New Scientist",   url: "https://www.newscientist.com/feed/home/",            category: "science", credibility: 9,  region: "global" },
  { name: "Nature News",     url: "https://www.nature.com/news.rss",                   category: "science", credibility: 10, region: "global" },
  { name: "Scientific American", url: "https://rss.sciam.com/ScientificAmerican-Global", category: "science", credibility: 10, region: "global" },

  // ─── MEDICINE & HEALTH ────────────────────────────────────────────
  { name: "Medical News Today", url: "https://www.medicalnewstoday.com/rss/wordsinthenews.xml", category: "medicine", credibility: 8, region: "global" },
  { name: "WHO News",        url: "https://www.who.int/rss-feeds/news-english.xml",     category: "medicine", credibility: 10, region: "global" },
  { name: "NIH News",        url: "https://www.nih.gov/news-events/feed.xml",           category: "medicine", credibility: 10, region: "us"     },
  { name: "WebMD",           url: "https://rssfeeds.webmd.com/rss/rss.aspx?RSSSource=RSS_PUBLIC", category: "health", credibility: 8, region: "global" },
  { name: "Healthline",      url: "https://www.healthline.com/rss/health-news",         category: "health",  credibility: 8,  region: "global" },
  { name: "Harvard Health",  url: "https://www.health.harvard.edu/blog/feed",           category: "health",  credibility: 9,  region: "global" },

  // ─── PUBLIC HEALTH ────────────────────────────────────────────────
  { name: "CDC Newsroom",    url: "https://tools.cdc.gov/api/v2/resources/media/403372.rss", category: "public-health", credibility: 10, region: "us" },

  // ─── SELF HELP ────────────────────────────────────────────────────
  { name: "Psychology Today",url: "https://www.psychologytoday.com/us/front-page/rss.xml", category: "self-help", credibility: 8, region: "us" },
  { name: "Mind Body Green", url: "https://www.mindbodygreen.com/rss.xml",              category: "self-help", credibility: 7,  region: "global" },
  { name: "Verywell Mind",   url: "https://www.verywellmind.com/rss",                  category: "self-help", credibility: 8,  region: "global" },

  // ─── ENVIRONMENT ──────────────────────────────────────────────────
  { name: "The Guardian Environment", url: "https://www.theguardian.com/environment/rss", category: "environment", credibility: 9, region: "global" },
  { name: "Inside Climate News", url: "https://insideclimatenews.org/feed/",            category: "environment", credibility: 8, region: "global" },
  { name: "Carbon Brief",    url: "https://www.carbonbrief.org/feed",                  category: "environment", credibility: 9, region: "global" },

  // ─── WEATHER — now a real widget; RSS removed ─────────────────────
  // (Weather data served via /api/weather → OpenWeatherMap proxy)

  // ─── CARS & AUTOMOTIVE ────────────────────────────────────────────
  { name: "PakWheels Blog",  url: "https://www.pakwheels.com/blog/feed/",               category: "cars",    credibility: 8,  region: "pk"     },
  { name: "Car and Driver",  url: "https://www.caranddriver.com/rss/all.xml",           category: "cars",    credibility: 9,  region: "global" },
  { name: "Top Gear",        url: "https://www.topgear.com/car-news/rss",               category: "cars",    credibility: 9,  region: "global" },
  { name: "MotorTrend",      url: "https://www.motortrend.com/rss/all.xml",             category: "cars",    credibility: 8,  region: "global" },
  { name: "Road & Track",    url: "https://www.roadandtrack.com/rss/",                  category: "cars",    credibility: 8,  region: "global" },

  // ─── AI ───────────────────────────────────────────────────────────
  { name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/",      category: "ai",      credibility: 10, region: "global" },
  { name: "VentureBeat AI",  url: "https://feeds.feedburner.com/venturebeat/SZYF",     category: "ai",      credibility: 8,  region: "global" },
  { name: "The Verge AI",    url: "https://www.theverge.com/ai-artificial-intelligence/rss/index.xml", category: "ai", credibility: 8, region: "global" },
  { name: "Wired",           url: "https://www.wired.com/feed/rss",                    category: "ai",      credibility: 9,  region: "global" },
  { name: "TechCrunch AI",   url: "https://techcrunch.com/category/artificial-intelligence/feed/", category: "ai", credibility: 8, region: "global" },

  // ─── COMPUTER SCIENCE ─────────────────────────────────────────────
  { name: "Hacker News",     url: "https://news.ycombinator.com/rss",                  category: "computer-science", credibility: 8, region: "global" },
  { name: "IEEE Spectrum",   url: "https://spectrum.ieee.org/feeds/feed.rss",          category: "computer-science", credibility: 9, region: "global" },
  { name: "TechCrunch",      url: "https://techcrunch.com/feed/",                      category: "computer-science", credibility: 8, region: "global" },
  { name: "Ars Technica",    url: "https://feeds.arstechnica.com/arstechnica/index",   category: "computer-science", credibility: 9, region: "global" },

  // ─── AGENTIC AI ───────────────────────────────────────────────────
  { name: "Anthropic Blog",  url: "https://www.anthropic.com/news/rss.xml",            category: "agentic-ai", credibility: 10, region: "global" },
  { name: "OpenAI Blog",     url: "https://openai.com/blog/rss.xml",                  category: "agentic-ai", credibility: 10, region: "global" },
  { name: "LessWrong",       url: "https://www.lesswrong.com/feed.xml",               category: "agentic-ai", credibility: 8,  region: "global" },
  { name: "The Gradient",    url: "https://thegradient.pub/rss/",                     category: "agentic-ai", credibility: 9,  region: "global" },

  // ─── LOCAL ────────────────────────────────────────────────────────
  { name: "LA Times",        url: "https://www.latimes.com/rss2.0.xml",               category: "local",   credibility: 9,  region: "us-west" },
  { name: "NY Times Local",  url: "https://rss.nytimes.com/services/xml/rss/nyt/NYRegion.xml", category: "local", credibility: 10, region: "us-east" },
  { name: "Chicago Tribune", url: "https://www.chicagotribune.com/arcio/rss/",        category: "local",   credibility: 8,  region: "us-midwest" },

  // ─── TECH ─────────────────────────────────────────────────────────
  { name: "The Verge",       url: "https://www.theverge.com/rss/index.xml",           category: "tech",    credibility: 9,  region: "global" },
  { name: "Engadget",        url: "https://www.engadget.com/rss.xml",                 category: "tech",    credibility: 8,  region: "global" },
  { name: "CNET",            url: "https://www.cnet.com/rss/news/",                   category: "tech",    credibility: 8,  region: "global" },
  { name: "Gizmodo",         url: "https://gizmodo.com/rss",                          category: "tech",    credibility: 7,  region: "global" },
  { name: "MacRumors",       url: "https://feeds.macrumors.com/MacRumors-All",        category: "tech",    credibility: 8,  region: "global" },
  { name: "9to5Mac",         url: "https://9to5mac.com/feed/",                        category: "tech",    credibility: 8,  region: "global" },
  { name: "Bloomberg Tech",  url: "https://feeds.bloomberg.com/technology/news.rss",  category: "tech",    credibility: 10, region: "global" },

  // ─── BUSINESS ─────────────────────────────────────────────────────
  { name: "BBC Business",    url: "https://feeds.bbci.co.uk/news/business/rss.xml",   category: "business", credibility: 10, region: "global" },
  { name: "CNBC",            url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", category: "business", credibility: 9, region: "us" },
  { name: "Forbes",          url: "https://www.forbes.com/business/feed/",            category: "business", credibility: 8,  region: "global" },
  { name: "Bloomberg Markets",url: "https://feeds.bloomberg.com/markets/news.rss",    category: "business", credibility: 10, region: "global" },
  { name: "Financial Times",  url: "https://www.ft.com/?format=rss",                 category: "business", credibility: 10, region: "global" },
  { name: "Fortune",         url: "https://fortune.com/feed/",                       category: "business", credibility: 8,  region: "global" },
  { name: "Fast Company",    url: "https://www.fastcompany.com/latest/rss",           category: "business", credibility: 8,  region: "global" },

  // ─── PUBLICATIONS / MAGAZINES ─────────────────────────────────────
  { name: "The Economist",      url: "https://www.economist.com/the-world-this-week/rss.xml", category: "publications", credibility: 10, region: "global" },
  { name: "Foreign Affairs",    url: "https://www.foreignaffairs.com/rss.xml",        category: "publications", credibility: 10, region: "global" },
  { name: "The Atlantic",       url: "https://www.theatlantic.com/feed/all/",         category: "publications", credibility: 9,  region: "global" },
  { name: "Smithsonian",        url: "https://www.smithsonianmag.com/rss/latest_articles/", category: "publications", credibility: 9, region: "global" },
  { name: "NY Times",           url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", category: "publications", credibility: 10, region: "us" },
  { name: "The New Yorker",     url: "https://www.newyorker.com/feed/everything",     category: "publications", credibility: 10, region: "global" },

  // ═══ Phase 5: Global coverage expansion ═══════════════════════════
  // ~30 curated additions selected for: regional balance (India, MENA,
  // LatAm, AsiaPac, Africa), domain depth (finance, climate, defense,
  // geopolitics, crypto). All free RSS, no auth.

  // ─── INDIA ────────────────────────────────────────────────────────
  { name: "The Hindu",          url: "https://www.thehindu.com/news/feeder/default.rss",         category: "international", credibility: 9, region: "in" },
  { name: "Times of India",     url: "https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms", category: "international", credibility: 7, region: "in" },
  { name: "Indian Express",     url: "https://indianexpress.com/feed/",                          category: "international", credibility: 8, region: "in" },

  // ─── MENA ─────────────────────────────────────────────────────────
  { name: "Times of Israel",    url: "https://www.timesofisrael.com/feed/",                      category: "international", credibility: 8, region: "il" },
  { name: "Haaretz",            url: "https://www.haaretz.com/cmlink/1.628752",                  category: "international", credibility: 9, region: "il" },
  { name: "Arab News",          url: "https://www.arabnews.com/rss.xml",                         category: "international", credibility: 7, region: "sa" },

  // ─── EUROPE (non-UK) ──────────────────────────────────────────────
  { name: "Le Monde (English)", url: "https://www.lemonde.fr/en/rss/une.xml",                    category: "international", credibility: 9, region: "fr" },
  { name: "Der Spiegel (Eng)",  url: "https://www.spiegel.de/international/index.rss",           category: "international", credibility: 9, region: "de" },
  { name: "Politico Europe",    url: "https://www.politico.eu/feed/",                            category: "international", credibility: 9, region: "eu" },
  { name: "Euronews",           url: "https://www.euronews.com/rss",                             category: "international", credibility: 8, region: "eu" },

  // ─── ASIA-PACIFIC ─────────────────────────────────────────────────
  { name: "ABC Australia",      url: "https://www.abc.net.au/news/feed/45910/rss.xml",           category: "international", credibility: 9, region: "au" },
  { name: "NHK World",          url: "https://www3.nhk.or.jp/nhkworld/en/news/feeds/",           category: "international", credibility: 9, region: "jp" },
  { name: "Korea Herald",       url: "https://www.koreaherald.com/rss/0",                        category: "international", credibility: 7, region: "kr" },

  // ─── LATIN AMERICA ────────────────────────────────────────────────
  { name: "Folha (English)",    url: "https://www1.folha.uol.com.br/internacional/en/rss091.xml", category: "international", credibility: 8, region: "br" },
  { name: "MercoPress",         url: "https://en.mercopress.com/rss/",                           category: "international", credibility: 7, region: "latam" },

  // ─── AFRICA ───────────────────────────────────────────────────────
  { name: "Mail & Guardian",    url: "https://mg.co.za/feed/",                                   category: "international", credibility: 8, region: "za" },
  { name: "Daily Nation",       url: "https://nation.africa/kenya/rss",                          category: "international", credibility: 7, region: "ke" },

  // ─── FINANCE (deeper) ─────────────────────────────────────────────
  { name: "MarketWatch",        url: "https://feeds.marketwatch.com/marketwatch/topstories/",    category: "business", credibility: 8, region: "us" },
  { name: "Yahoo Finance",      url: "https://finance.yahoo.com/news/rssindex",                  category: "business", credibility: 7, region: "us" },
  { name: "Investing.com",      url: "https://www.investing.com/rss/news.rss",                   category: "business", credibility: 7, region: "global" },

  // ─── CRYPTO ───────────────────────────────────────────────────────
  { name: "CoinDesk",           url: "https://www.coindesk.com/arc/outboundfeeds/rss/",          category: "business", credibility: 8, region: "global" },
  { name: "The Block",          url: "https://www.theblock.co/rss.xml",                          category: "business", credibility: 8, region: "global" },
  { name: "Decrypt",            url: "https://decrypt.co/feed",                                  category: "business", credibility: 7, region: "global" },

  // ─── CLIMATE / ENERGY ─────────────────────────────────────────────
  // Note: Inside Climate News duplicate removed 2026-05-15 (Phase A
  // source audit Phase 2). Canonical entry retained at the Environment
  // section above (credibility 8 per first-occurrence discipline).
  { name: "Grist",              url: "https://grist.org/feed/",                                  category: "environment", credibility: 8, region: "global" },
  { name: "Climate Home News",  url: "https://www.climatechangenews.com/feed/",                  category: "environment", credibility: 8, region: "global" },

  // ─── DEFENSE / GEOPOLITICS ────────────────────────────────────────
  { name: "Defense News",       url: "https://www.defensenews.com/arc/outboundfeeds/rss/category/global/",       category: "international", credibility: 8, region: "global" },
  { name: "War on the Rocks",   url: "https://warontherocks.com/feed/",                          category: "international", credibility: 9, region: "global" },
  { name: "Foreign Policy",     url: "https://foreignpolicy.com/feed/",                          category: "publications", credibility: 9, region: "global" },

  // ─── HEALTH (extended) ────────────────────────────────────────────
  { name: "STAT News",          url: "https://www.statnews.com/feed/",                           category: "health", credibility: 9, region: "global" },
  { name: "BMJ News",           url: "https://www.bmj.com/feed",                                 category: "health", credibility: 10, region: "global" },
];

// ─── YouTube Channel Sources ──────────────────────────────────────────────
// Free RSS feed, no API key required
// Format: https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID
export const YOUTUBE_SOURCES = [
  // Top / Breaking News
  { name: "BBC News",         channelId: "UC16niRr50-MSBwiU3Q1QZDg", category: "top",              region: "global" },
  { name: "CNN",              channelId: "UCupvZG-5ko_eiXAupbDfxWw", category: "top",              region: "global" },
  { name: "Al Jazeera",       channelId: "UCNye-wNBqNL5ZzHSJj3l8Bg", category: "top",              region: "global" },
  { name: "Reuters",          channelId: "UCvz5BcaRJCsH3iN9Dc_nxiQ", category: "top",              region: "global" },
  { name: "MSNBC",            channelId: "UCaXsmwf5A3yMIaGlL7gBFYA", category: "top",              region: "us"     },
  { name: "ABC News",         channelId: "UCBi2mrWuNuyYy4gbM6fU18Q", category: "top",              region: "us"     },

  // Politics
  { name: "PBS NewsHour",     channelId: "UC6ZFN9Tx6xh-skXCuRHCDpQ", category: "politics",         region: "us"     },
  { name: "C-SPAN",           channelId: "UCb8UzmHMlBmFTkBg-gHHXmg", category: "politics",         region: "us"     },

  // Pakistan News
  { name: "ARY News",         channelId: "UCQBFfksJlM13HVtITUppkjQ", category: "pakistan",         region: "pk"     },
  { name: "Geo News",         channelId: "UCxKj5OJM26Kue68JrXjmYxg", category: "pakistan",         region: "pk"     },
  { name: "Dawn News",        channelId: "UCt6R53G62ZG2AxGGHYU3RcA", category: "pakistan",         region: "pk"     },
  { name: "SAMAA TV",         channelId: "UCiK1Q8aP_9ij8SVFMLMR53Q", category: "pakistan",         region: "pk"     },
  { name: "DW Urdu",          channelId: "UC-_7b9VLxjf0LwqVsT_RBOA", category: "pakistan",         region: "pk"     },
  { name: "BBC News Urdu",    channelId: "UCg9rRnGVfqODa9jcuAv5REQ", category: "pakistan",         region: "pk"     },

  // International
  { name: "DW News",          channelId: "UCknLrEdhRCp1aegoMqRaCZg", category: "international",    region: "global" },
  { name: "France 24 English",channelId: "UCQfwfsi5VrQ8yKZ-UWmAEFg", category: "international",    region: "global" },

  // Science
  { name: "NASA",             channelId: "UCP4bf6IHJJQehibu6ai__cg", category: "science",          region: "global" },
  { name: "Veritasium",       channelId: "UCHnyfMqiRRG1u-2MsSQLbXA", category: "science",          region: "global" },
  { name: "Kurzgesagt",       channelId: "UCsXVk37bltHxD1rDPwtNM8Q", category: "science",          region: "global" },
  { name: "TED",              channelId: "UCAuUUnT6oDeKwE6v1NGQxug", category: "science",          region: "global" },
  { name: "SciShow",          channelId: "UCZYTClx2T1of7BRZ86-8fow", category: "science",          region: "global" },

  // AI & Agentic AI
  { name: "Lex Fridman",      channelId: "UCSHZKyawb77ixDdsGog4iWA", category: "ai",               region: "global" },
  { name: "Two Minute Papers",channelId: "UCbfYPyITQ-7l4upoX8nvctg", category: "ai",               region: "global" },
  { name: "Yannic Kilcher",   channelId: "UCZHmQk67mSJgfCCTn7xBfew", category: "ai",               region: "global" },
  { name: "Fireship",         channelId: "UCsBjURrPoezykLs9EqgamOA", category: "computer-science", region: "global" },
  { name: "OpenAI",           channelId: "UCXZCJLpBC6CgFP_6p3Zs47A", category: "agentic-ai",       region: "global" },

  // Sports
  { name: "ESPN",             channelId: "UCiWLfSweyRNmLpgEHekhoAg", category: "sports",           region: "us"     },
  { name: "Sky Sports",       channelId: "UCNAf1k0yIjyGu3k9BwAg3lg", category: "sports",           region: "global" },
  { name: "NFL",              channelId: "UCDVYQ4Zhbm3S2dlz7P1GBDg", category: "sports",           region: "us"     },

  // Health
  { name: "Doctor Mike",      channelId: "UC0dvN9QLRCrHIEBUFaJuIjg", category: "health",           region: "global" },
  { name: "Mayo Clinic",      channelId: "UCAFgXM7VGm25XEHX8r57tSA", category: "health",           region: "global" },

  // Environment
  { name: "DW Planet A",      channelId: "UCYkOEFO3qLh1IiLJJPAR5jA", category: "environment",      region: "global" },
  { name: "National Geographic",channelId: "UCpVm7bg6pXKo1Pr6k5kxG9A", category: "environment",   region: "global" },

  // Weather
  { name: "The Weather Channel",channelId: "UCEKpDkCIExCLXlKH7jRQTxw", category: "weather",        region: "us"     },

  // Tech
  { name: "Marques Brownlee (MKBHD)", channelId: "UCBJycsmduvYEL83R_U4JriQ", category: "tech",    region: "global" },
  { name: "Linus Tech Tips",  channelId: "UCXuqSBlHAE6Xw-yeJA0Tunw", category: "tech",            region: "global" },
  { name: "Unbox Therapy",    channelId: "UCsTcErHg8oDvUnTzoqsYeNw", category: "tech",            region: "global" },
  { name: "The Verge",        channelId: "UCddiUEpeqJcYeBxX1IVBKvQ", category: "tech",            region: "global" },
  { name: "Dave2D",           channelId: "UCVYamHliCI9rw1tHR1xbkfw", category: "tech",            region: "global" },
  { name: "CNET",             channelId: "UCOmcA3f_RrH6b9NmcNa4tdg", category: "tech",            region: "global" },

  // Business / Finance
  { name: "Bloomberg Originals",channelId: "UChLynHKFOBCPHb8JMmQZiXA", category: "business",     region: "global" },
  { name: "CNBC",             channelId: "UCrp_UI8XB08h07wjgHnKqWA", category: "business",        region: "us"     },
  { name: "Yahoo Finance",    channelId: "UCEAZeUIeJs0IjQiqTCdVSIg", category: "business",        region: "global" },
  { name: "Graham Stephan",   channelId: "UCV6KDgJskWaEckne5aPA0aQ", category: "business",        region: "us"     },
];

// ─── X (Twitter) Curated Accounts by Topic ───────────────────────────────
export const X_ACCOUNTS = {
  top: [
    { handle: "Reuters",        name: "Reuters",          desc: "Global news wire",         verified: true  },
    { handle: "BBCBreaking",    name: "BBC Breaking",     desc: "Breaking news",            verified: true  },
    { handle: "AP",             name: "Associated Press", desc: "Non-profit news agency",   verified: true  },
    { handle: "nytimes",        name: "NY Times",         desc: "All the news fit to print",verified: true  },
    { handle: "guardian",       name: "The Guardian",     desc: "Independent journalism",   verified: true  },
  ],
  politics: [
    { handle: "politico",       name: "POLITICO",         desc: "Politics & policy",        verified: true  },
    { handle: "thehill",        name: "The Hill",         desc: "Political news",           verified: true  },
    { handle: "NPR",            name: "NPR",              desc: "Public radio news",        verified: true  },
    { handle: "BBCPolitics",    name: "BBC Politics",     desc: "UK & world politics",      verified: true  },
  ],
  international: [
    { handle: "AJEnglish",      name: "Al Jazeera",       desc: "Independent global news",  verified: true  },
    { handle: "DWNews",         name: "DW News",          desc: "German broadcaster",       verified: true  },
    { handle: "France24_en",    name: "France 24",        desc: "French intl news",         verified: true  },
    { handle: "BBCWorld",       name: "BBC World",        desc: "World news service",       verified: true  },
  ],
  pakistan: [
    { handle: "dawn_com",       name: "Dawn",             desc: "Pakistan's leading paper", verified: true  },
    { handle: "GeoNews",        name: "Geo News",         desc: "Leading TV news channel",  verified: true  },
    { handle: "ARYNewsAlerts",  name: "ARY News",         desc: "24/7 news channel",        verified: true  },
    { handle: "etribune",       name: "Express Tribune",  desc: "English-language paper",   verified: true  },
    { handle: "thenewspk",      name: "The News Intl",    desc: "English daily newspaper",  verified: true  },
    { handle: "ImranKhanPTI",   name: "Imran Khan",       desc: "Former PM of Pakistan",    verified: true  },
    { handle: "CMShehbaz",      name: "Shehbaz Sharif",   desc: "PM of Pakistan",           verified: true  },
  ],
  sports: [
    { handle: "espn",           name: "ESPN",             desc: "Sports entertainment",     verified: true  },
    { handle: "SkySports",      name: "Sky Sports",       desc: "UK sports broadcaster",    verified: true  },
    { handle: "BBCSport",       name: "BBC Sport",        desc: "BBC sports coverage",      verified: true  },
    { handle: "NFL",            name: "NFL",              desc: "National Football League", verified: true  },
  ],
  science: [
    { handle: "NASA",           name: "NASA",             desc: "Space & science agency",   verified: true  },
    { handle: "NewScientist",   name: "New Scientist",    desc: "Science & technology",     verified: true  },
    { handle: "SciAm",          name: "Scientific American", desc: "Science magazine",      verified: true  },
    { handle: "nature",         name: "Nature",           desc: "Science journal",          verified: true  },
  ],
  medicine: [
    { handle: "WHO",            name: "World Health Org", desc: "Global health agency",     verified: true  },
    { handle: "CDCgov",         name: "CDC",              desc: "US disease control",       verified: true  },
    { handle: "NIH",            name: "NIH",              desc: "US health institutes",     verified: true  },
  ],
  health: [
    { handle: "WebMD",          name: "WebMD",            desc: "Health information",       verified: false },
    { handle: "HarvardHealth",  name: "Harvard Health",   desc: "Harvard Med School",       verified: true  },
    { handle: "DrMikeEvans",    name: "Dr. Mike Evans",   desc: "Health educator",          verified: false },
  ],
  ai: [
    { handle: "OpenAI",         name: "OpenAI",           desc: "AI research company",      verified: true  },
    { handle: "AnthropicAI",    name: "Anthropic",        desc: "AI safety company",        verified: true  },
    { handle: "ylecun",         name: "Yann LeCun",       desc: "Meta's Chief AI Scientist",verified: true  },
    { handle: "sama",           name: "Sam Altman",       desc: "OpenAI CEO",               verified: true  },
    { handle: "GoogleDeepMind", name: "Google DeepMind",  desc: "AI research lab",          verified: true  },
    { handle: "lexfridman",     name: "Lex Fridman",      desc: "AI researcher & host",     verified: true  },
  ],
  "computer-science": [
    { handle: "TechCrunch",     name: "TechCrunch",       desc: "Startup & tech news",      verified: true  },
    { handle: "Wired",          name: "WIRED",            desc: "Tech & culture magazine",  verified: true  },
    { handle: "ycombinator",    name: "Y Combinator",     desc: "Startup accelerator",      verified: true  },
    { handle: "arstechnica",    name: "Ars Technica",     desc: "Tech news & analysis",     verified: true  },
  ],
  "agentic-ai": [
    { handle: "AnthropicAI",    name: "Anthropic",        desc: "Claude & AI safety",       verified: true  },
    { handle: "OpenAI",         name: "OpenAI",           desc: "GPT & agents",             verified: true  },
    { handle: "LangChainAI",    name: "LangChain",        desc: "LLM orchestration",        verified: true  },
    { handle: "hwchase17",      name: "Harrison Chase",   desc: "LangChain founder",        verified: false },
    { handle: "karpathy",       name: "Andrej Karpathy",  desc: "AI researcher",            verified: true  },
  ],
  environment: [
    { handle: "guardianeco",    name: "Guardian Env",     desc: "Environmental journalism", verified: true  },
    { handle: "CarbonBrief",    name: "Carbon Brief",     desc: "Climate science",          verified: false },
    { handle: "IPCC_CH",        name: "IPCC",             desc: "Climate change panel",     verified: true  },
    { handle: "GretaThunberg",  name: "Greta Thunberg",   desc: "Climate activist",         verified: true  },
  ],
  weather: [
    { handle: "NWS",            name: "Nat'l Weather Svc",desc: "US weather forecasts",     verified: true  },
    { handle: "weatherchannel", name: "Weather Channel",  desc: "Weather forecasts",        verified: true  },
    { handle: "NOAAClimate",    name: "NOAA Climate",     desc: "Climate monitoring",       verified: true  },
  ],
  cars: [
    { handle: "PakWheels",      name: "PakWheels",        desc: "Pakistan's car marketplace",verified: true  },
    { handle: "caranddriver",   name: "Car and Driver",   desc: "Car reviews & news",       verified: true  },
    { handle: "TopGear",        name: "Top Gear",         desc: "BBC motoring show",        verified: true  },
    { handle: "MotorTrend",     name: "MotorTrend",       desc: "Auto news & reviews",      verified: true  },
  ],
  "self-help": [
    { handle: "TonyRobbins",    name: "Tony Robbins",     desc: "Life & business coach",    verified: true  },
    { handle: "BreneBrown",     name: "Brené Brown",      desc: "Vulnerability researcher", verified: true  },
    { handle: "psychtoday",     name: "Psychology Today", desc: "Mental health magazine",   verified: false },
  ],
  "public-health": [
    { handle: "WHO",            name: "WHO",              desc: "World Health Org",         verified: true  },
    { handle: "CDCgov",         name: "CDC",              desc: "Disease control",          verified: true  },
    { handle: "PAHO_WHO",       name: "PAHO",             desc: "Pan American Health",      verified: true  },
  ],
  local: [
    { handle: "latimes",        name: "LA Times",         desc: "Los Angeles news",         verified: true  },
    { handle: "nytimes",        name: "NY Times",         desc: "New York news",            verified: true  },
    { handle: "chicagotribune", name: "Chicago Tribune",  desc: "Chicago news",             verified: true  },
  ],
  tech: [
    { handle: "verge",          name: "The Verge",        desc: "Tech, science & culture",  verified: true  },
    { handle: "MKBHD",          name: "Marques Brownlee", desc: "Tech reviewer & creator",  verified: true  },
    { handle: "engadget",       name: "Engadget",         desc: "Consumer electronics",     verified: true  },
    { handle: "cnet",           name: "CNET",             desc: "Tech product reviews",     verified: true  },
    { handle: "Gizmodo",        name: "Gizmodo",          desc: "Tech news & gadgets",      verified: false },
    { handle: "MacRumors",      name: "MacRumors",        desc: "Apple news & rumors",      verified: false },
  ],
  business: [
    { handle: "business",       name: "Reuters Business", desc: "Global business news",     verified: true  },
    { handle: "BBCBusiness",    name: "BBC Business",     desc: "Business & economy",       verified: true  },
    { handle: "CNBC",           name: "CNBC",             desc: "Financial news network",   verified: true  },
    { handle: "Forbes",         name: "Forbes",           desc: "Business & entrepreneurship", verified: true },
    { handle: "FT",             name: "Financial Times",  desc: "Global business news",     verified: true  },
    { handle: "brecorder",      name: "Business Recorder",desc: "Pakistan business news",   verified: false },
  ],
  publications: [
    { handle: "TheEconomist",   name: "The Economist",    desc: "Weekly global analysis",   verified: true  },
    { handle: "ForeignAffairs", name: "Foreign Affairs",  desc: "International relations",  verified: true  },
    { handle: "TheAtlantic",    name: "The Atlantic",     desc: "Ideas, politics & culture",verified: true  },
    { handle: "smithsonianmag", name: "Smithsonian",      desc: "Arts, science & history",  verified: true  },
    { handle: "nytimes",        name: "NY Times",         desc: "All the news fit to print",verified: true  },
    { handle: "NewYorker",      name: "The New Yorker",   desc: "Long-form journalism",     verified: true  },
  ],
};

// ─── Topic Definitions ────────────────────────────────────────────────────
// These are the *user-facing tabs* (9 total). The old flat list of 20 was
// noisy and duplicative — now each tab maps to one or many underlying
// article categories via TAB_CATEGORIES below.
//
// "live" is a virtual tab served by the /api/events router (Phase B dossiers)
// and returns nothing through /api/news.
//
// "local" is virtual too: the news route resolves it to `region IN (…)` using
// COUNTRY_REGIONS and the user's detected (or overridden) country code.
export const TOPICS = [
  { id: "top",      label: "Top",              emoji: "🔥", color: "#FF3B30" },
  { id: "live",     label: "Live",             emoji: "🔴", color: "#EF4444" },
  { id: "local",    label: "Local",            emoji: "📍", color: "#FF9500" },
  { id: "world",    label: "World",            emoji: "🌍", color: "#5856D6" },
  { id: "politics", label: "Politics",         emoji: "🏛️", color: "#007AFF" },
  { id: "business", label: "Business",         emoji: "💼", color: "#F59E0B" },
  { id: "tech",     label: "Tech & AI",        emoji: "🤖", color: "#0EA5E9" },
  { id: "science",  label: "Science & Health", emoji: "🔬", color: "#5AC8FA" },
  { id: "sports",   label: "Sports",           emoji: "🏆", color: "#34C759" },
];

// Maps a user-facing tab → the underlying article.category values the DB
// stores. Empty array means "no category filter" (e.g. "top" is the mixed
// editorial feed; "local" filters by region instead; "live" is served by a
// different route).
//
// Merging rationale:
//   - tech     → absorbs the ai / agentic-ai / computer-science sources
//                (users think of it as one thing)
//   - science  → absorbs medicine / health / public-health / environment
//                (all "how the world works" content)
//   - business → absorbs cars (niche) and publications (essays & analysis)
//   - world    → renamed from "international"
export const TAB_CATEGORIES = {
  top:      [],
  live:     [],
  local:    [],
  world:    ["international"],
  politics: ["politics"],
  business: ["business", "cars", "publications"],
  tech:     ["tech", "ai", "agentic-ai", "computer-science"],
  science:  ["science", "medicine", "health", "public-health", "environment"],
  sports:   ["sports"],
};

// Country code → list of article.region values that count as "local".
// Sources carry a region tag (e.g. "us-west", "pk", "uk"). For the Local tab
// we look up the user's country (from /api/geo or their override) and match
// any source whose region appears here. "global" is never local.
//
// Add more entries as you onboard regional sources. Unknown countries fall
// back to an empty list → Local tab shows "no local sources yet for X, try
// picking a country".
export const COUNTRY_REGIONS = {
  US: ["us", "us-west", "us-east", "us-midwest", "us-south"],
  PK: ["pk"],
  GB: ["uk", "gb"],
  IN: ["in"],
  CA: ["ca"],
  AU: ["au"],
  AE: ["ae"],
  SA: ["sa"],
};
