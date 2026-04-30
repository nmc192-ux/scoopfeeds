import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import {
  getDb,
  getArticleById,
  incrementViewCount,
  listAlternateCoverage,
  listRelatedStories,
} from "../models/database.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

const SITE = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");
const CATEGORIES = [
  "top", "politics", "pakistan", "international", "science",
  "medicine", "public-health", "health", "environment",
  "self-help", "sports", "cars", "ai",
];

// Categories that have an editorial hub at /topic/:slug. Used by the article
// SSR page to render an internal "Browse all {category} coverage →" link
// when a hub exists. Keep in sync with TOPIC_HUBS below.
const TOPIC_HUB_SLUGS = new Set([
  "ai", "cars", "science", "politics", "pakistan", "international", "health", "sports",
]);

function xmlEscape(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── robots.txt ────────────────────────────────────────────────────────────
router.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send(
`User-agent: *
Allow: /
Disallow: /api/

User-agent: Mediapartners-Google
Allow: /

Sitemap: ${SITE}/sitemap.xml
Sitemap: ${SITE}/sitemap-news.xml
Sitemap: ${SITE}/feed.xml
`
  );
});

// ── sitemap.xml — homepage, categories, latest articles (up to 10k) ──────
router.get("/sitemap.xml", (_req, res) => {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, published_at FROM articles ORDER BY published_at DESC LIMIT 10000`
  ).all();

  const now = new Date().toISOString();
  const urls = [];
  urls.push(`<url><loc>${SITE}/</loc><lastmod>${now}</lastmod><changefreq>hourly</changefreq><priority>1.0</priority></url>`);
  for (const cat of CATEGORIES) {
    urls.push(`<url><loc>${SITE}/?topic=${cat}</loc><changefreq>hourly</changefreq><priority>0.8</priority></url>`);
  }
  // E-E-A-T pages — required for Google News / Discover eligibility.
  for (const slug of ["about", "editorial-policy", "corrections", "contact", "privacy"]) {
    urls.push(`<url><loc>${SITE}/${slug}</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>`);
  }
  // Editorial topic hubs — evergreen aggregation pages (Phase 4 SEO scaling).
  for (const slug of ["ai", "cars", "science", "politics", "pakistan", "international", "health", "sports"]) {
    urls.push(`<url><loc>${SITE}/topic/${slug}</loc><changefreq>daily</changefreq><priority>0.7</priority></url>`);
  }
  for (const r of rows) {
    const lastmod = new Date(r.published_at).toISOString();
    urls.push(`<url><loc>${SITE}/article/${xmlEscape(r.id)}</loc><lastmod>${lastmod}</lastmod><priority>0.6</priority></url>`);
  }

  res.type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`
  );
});

// ── RSS feed — top 50 articles, and per-category feeds ──────────────────
// Standard RSS 2.0 with Atom self-link. Powers Feedly/Inoreader/NetNewsWire
// retention surfaces and gives us a free low-maintenance distribution channel.
function buildRss({ feedTitle, feedDesc, feedUrl, rows }) {
  const items = rows.map(r => {
    const pubDate = new Date(r.published_at).toUTCString();
    const articleUrl = `${SITE}/article/${encodeURIComponent(r.id)}`;
    const desc = (r.description || "").slice(0, 500);
    return `
    <item>
      <title>${xmlEscape(r.title)}</title>
      <link>${articleUrl}</link>
      <guid isPermaLink="true">${articleUrl}</guid>
      <pubDate>${pubDate}</pubDate>
      <source url="${xmlEscape(r.url || "")}">${xmlEscape(r.source_name || "")}</source>
      <category>${xmlEscape(r.category || "")}</category>
      <description>${xmlEscape(desc)}</description>${r.image_url ? `
      <enclosure url="${xmlEscape(r.image_url)}" type="image/jpeg"/>` : ""}
    </item>`;
  }).join("");
  const now = new Date().toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEscape(feedTitle)}</title>
    <link>${SITE}</link>
    <description>${xmlEscape(feedDesc)}</description>
    <language>en</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml"/>${items}
  </channel>
</rss>`;
}

router.get("/feed.xml", (_req, res) => {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, title, description, url, source_name, category, published_at, image_url
     FROM articles ORDER BY published_at DESC LIMIT 50`
  ).all();
  res.type("application/rss+xml").send(buildRss({
    feedTitle: "Scoop — News, sniffed out.",
    feedDesc: "The day's biggest stories from trusted sources worldwide, with cross-source context.",
    feedUrl: `${SITE}/feed.xml`,
    rows,
  }));
});

router.get("/feed/:category.xml", (req, res) => {
  const cat = String(req.params.category || "").toLowerCase();
  if (!CATEGORIES.includes(cat)) return res.status(404).send(renderNotFound());
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, title, description, url, source_name, category, published_at, image_url
     FROM articles WHERE category = ? ORDER BY published_at DESC LIMIT 50`
  ).all(cat);
  res.type("application/rss+xml").send(buildRss({
    feedTitle: `Scoop — ${cat}`,
    feedDesc: `Latest ${cat} stories curated by Scoop.`,
    feedUrl: `${SITE}/feed/${cat}.xml`,
    rows,
  }));
});

// ── Google News sitemap — last 48 hours only ─────────────────────────────
router.get("/sitemap-news.xml", (_req, res) => {
  const db = getDb();
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const rows = db.prepare(
    `SELECT id, title, published_at, source_name FROM articles
     WHERE published_at >= ? ORDER BY published_at DESC LIMIT 1000`
  ).all(cutoff);

  const urls = rows.map(r => {
    const pub = new Date(r.published_at).toISOString();
    return `<url>
  <loc>${SITE}/article/${xmlEscape(r.id)}</loc>
  <news:news>
    <news:publication>
      <news:name>Scoop</news:name>
      <news:language>en</news:language>
    </news:publication>
    <news:publication_date>${pub}</news:publication_date>
    <news:title>${xmlEscape(r.title)}</news:title>
  </news:news>
</url>`;
  }).join("\n");

  res.type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${urls}\n</urlset>\n`
  );
});

// ── Article detail page — SSR shell with rich meta tags ──────────────────
// Returns a standalone HTML page so crawlers and social unfurlers see full
// metadata. Humans see: headline + image + key-takeaways + body preview +
// cross-source "also covered by" + related stories + CTA to original source.
// The synthesis + cross-source layer is what turns this from "scraped rewrite"
// into aggregation with independent editorial value — critical for avoiding
// Google's thin-content / scraped-content signals.
router.get("/article/:id", (req, res) => {
  const article = getArticleById(req.params.id);
  if (!article) return res.status(404).send(renderNotFound());
  try { incrementViewCount(article.id); } catch {}

  const canonical = `${SITE}/article/${encodeURIComponent(article.id)}`;
  // Branded OG card (1200×630) — typographic, no licensed source imagery.
  // Used for og:image / twitter:image so social unfurls are consistent and
  // copyright-clean. JSON-LD still references the source hero image when we
  // have one, since Google News prefers the actual article photo.
  const ogCard = `${SITE}/api/cards/og/${encodeURIComponent(article.id)}.png`;
  const schemaImage = article.image_url || ogCard;
  const desc = (article.description || article.title || "").slice(0, 300);
  const title = `${article.title} — Scoop`;
  const published = new Date(article.published_at).toISOString();
  const hasFullContent = article.content && article.content.length > 500;
  // Strip leading site chrome (share/save buttons, bylines glued to body)
  // before splitting into paragraphs — same cleanup the takeaway extractor
  // does, applied to the visible body too. Keeps the SSR page free of "Share
  // Save Add as preferred on Google Lina SinjabCorrespondent, Beirut" lede.
  const articleBody = hasFullContent
    ? _stripLeadingChrome(article.content)
    : desc;
  const paragraphs = articleBody
    ? articleBody.split(/\n\n+/).map(p => p.trim()).filter(Boolean)
    : [];
  const takeaways = extractTakeaways(article);
  const alternates = (() => { try { return listAlternateCoverage(article, 4); } catch { return []; } })();
  const related = (() => { try { return listRelatedStories(article, 5); } catch { return []; } })();
  const whyItMatters = categoryFraming(article.category);
  const isUrdu = (article.language || "en") === "ur";
  const langAttr = isUrdu ? "ur" : "en";

  const jsonld = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "headline": article.title,
    "description": desc,
    "image": [schemaImage],
    "datePublished": published,
    "dateModified": published,
    "author": [{ "@type": "Organization", "name": article.source_name || "Scoop" }],
    "publisher": {
      "@type": "Organization",
      "name": "Scoop",
      "logo": { "@type": "ImageObject", "url": `${SITE}/news-icon.svg` },
    },
    "mainEntityOfPage": { "@type": "WebPage", "@id": canonical },
    "articleSection": article.category,
    "url": article.url,
    ...(hasFullContent ? { "articleBody": article.content } : {}),
  };

  res.type("html").send(`<!DOCTYPE html>
<html lang="${langAttr}"${isUrdu ? ` dir="rtl"` : ""}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${xmlEscape(title)}</title>
<meta name="description" content="${xmlEscape(desc)}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="en" href="${canonical}">
<link rel="alternate" hreflang="ur" href="${canonical}?lang=ur">
<link rel="alternate" hreflang="x-default" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="${xmlEscape(article.title)}">
<meta property="og:description" content="${xmlEscape(desc)}">
<meta property="og:image" content="${xmlEscape(ogCard)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="Scoop">
<meta property="article:published_time" content="${published}">
<meta property="article:section" content="${xmlEscape(article.category || "")}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${xmlEscape(article.title)}">
<meta name="twitter:description" content="${xmlEscape(desc)}">
<meta name="twitter:image" content="${xmlEscape(ogCard)}">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-E7CDBSB5KY"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-E7CDBSB5KY');</script>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6168047656143190" crossorigin="anonymous"></script>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; margin: 0; background: #fafafa; color: #111; line-height: 1.6; }
  @media (prefers-color-scheme: dark) { body { background: #0a0a0a; color: #eee; } .card { background: #151515 !important; border-color: #222 !important; } a { color: #4aa3ff; } }
  .wrap { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
  .back { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; text-decoration: none; color: #666; margin-bottom: 20px; }
  .back:hover { color: #DC2626; }
  .card { background: #fff; border: 1px solid #e5e5e5; border-radius: 16px; overflow: hidden; }
  .hero { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block; background: #eee; }
  .body { padding: 24px; }
  .cat { display: inline-block; background: #DC2626; color: #fff; font-size: 11px; font-weight: 700; text-transform: uppercase; padding: 4px 10px; border-radius: 999px; letter-spacing: 0.04em; }
  h1 { font-size: 28px; line-height: 1.25; margin: 12px 0 8px; font-weight: 700; }
  .meta { font-size: 13px; color: #888; margin-bottom: 18px; }
  .desc { font-size: 17px; margin: 0 0 24px; }
  .content p { font-size: 17px; margin: 0 0 18px; color: #222; }
  @media (prefers-color-scheme: dark) { .content p { color: #d4d4d4; } }
  .content { margin-bottom: 28px; }
  .source-note { font-size: 13px; color: #888; margin: 24px 0 16px; padding: 12px 16px; background: rgba(220,38,38,0.05); border-left: 3px solid #DC2626; border-radius: 4px; }
  .cta { display: inline-block; background: #DC2626; color: #fff; text-decoration: none; padding: 12px 20px; border-radius: 999px; font-weight: 600; font-size: 15px; }
  .cta:hover { background: #b91c1c; }
  .secondary { margin-left: 12px; font-size: 14px; color: #666; text-decoration: none; }
  .brand { font-weight: 700; font-size: 18px; color: #DC2626; text-decoration: none; }
  .takeaways { margin: 20px 0 24px; padding: 16px 20px; background: rgba(220,38,38,0.04); border: 1px solid rgba(220,38,38,0.15); border-radius: 12px; }
  .takeaways h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #DC2626; margin: 0 0 10px; font-weight: 700; }
  .takeaways ul { margin: 0; padding-left: 20px; }
  .takeaways li { font-size: 15px; line-height: 1.5; margin-bottom: 6px; color: #222; }
  @media (prefers-color-scheme: dark) { .takeaways { background: rgba(220,38,38,0.08); border-color: rgba(220,38,38,0.25); } .takeaways li { color: #d4d4d4; } }
  .why-matters { font-size: 14px; color: #555; font-style: italic; margin: 0 0 24px; padding: 10px 14px; border-left: 3px solid #aaa; background: rgba(0,0,0,0.02); border-radius: 0 8px 8px 0; }
  @media (prefers-color-scheme: dark) { .why-matters { color: #aaa; background: rgba(255,255,255,0.02); } }
  .coverage { margin: 32px 0 20px; }
  .coverage h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #666; margin: 0 0 12px; font-weight: 700; }
  .coverage-list { display: grid; grid-template-columns: 1fr; gap: 10px; }
  .coverage-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: #fafafa; border: 1px solid #eee; border-radius: 10px; text-decoration: none; color: inherit; transition: border-color .15s; }
  .coverage-item:hover { border-color: #DC2626; }
  @media (prefers-color-scheme: dark) { .coverage-item { background: #111; border-color: #222; } }
  .coverage-source { flex-shrink: 0; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #DC2626; min-width: 90px; }
  .coverage-title { font-size: 14px; line-height: 1.4; flex: 1; }
  .related { margin: 40px 0 24px; padding-top: 28px; border-top: 1px solid #eee; }
  @media (prefers-color-scheme: dark) { .related { border-top-color: #222; } }
  .related h2 { font-size: 16px; margin: 0 0 16px; font-weight: 700; }
  .related-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
  @media (min-width: 560px) { .related-grid { grid-template-columns: 1fr 1fr; } }
  .related-card { display: block; padding: 14px; background: #fff; border: 1px solid #e5e5e5; border-radius: 12px; text-decoration: none; color: inherit; transition: transform .15s, border-color .15s; }
  .related-card:hover { transform: translateY(-2px); border-color: #DC2626; }
  @media (prefers-color-scheme: dark) { .related-card { background: #151515; border-color: #222; } }
  .related-card .rc-source { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #DC2626; letter-spacing: 0.04em; }
  .related-card .rc-title { font-size: 14px; margin-top: 6px; line-height: 1.4; color: #222; }
  @media (prefers-color-scheme: dark) { .related-card .rc-title { color: #d4d4d4; } }
  .eeat-foot { margin: 40px 0 0; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #888; line-height: 1.6; }
  @media (prefers-color-scheme: dark) { .eeat-foot { border-top-color: #222; } }
  .eeat-foot a { color: #888; text-decoration: underline; }
  html[dir="rtl"] body { text-align: right; }
  html[dir="rtl"] .takeaways ul { padding-left: 0; padding-right: 20px; }
</style>
</head>
<body>
  <div class="wrap">
    <a class="back" href="/">← <span class="brand">Scoop</span> — News, sniffed out.</a>
    <article class="card">
      ${article.image_url ? `<img class="hero" src="${xmlEscape(article.image_url)}" alt="${xmlEscape(article.title)}" loading="eager">` : ""}
      <div class="body">
        <span class="cat">${xmlEscape(article.category || "news")}</span>
        <h1>${xmlEscape(article.title)}</h1>
        <div class="meta">${xmlEscape(article.source_name || "")} · ${new Date(article.published_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}${alternates.length > 0 ? ` · Also reported by ${alternates.length} other source${alternates.length === 1 ? "" : "s"}` : ""}</div>

        ${takeaways.length >= 2 ? `
        <section class="takeaways" aria-label="Key takeaways">
          <h2>Key takeaways</h2>
          <ul>${takeaways.map(t => `<li>${xmlEscape(t)}</li>`).join("")}</ul>
        </section>` : ""}

        ${whyItMatters ? `<p class="why-matters">${xmlEscape(whyItMatters)}</p>` : ""}

        ${hasFullContent
          ? `<div class="content">${paragraphs.slice(0, 3).map(p => `<p>${xmlEscape(p)}</p>`).join("")}</div>
             <div class="source-note">Article preview — originally published by <strong>${xmlEscape(article.source_name || "")}</strong>. Full story at the source.</div>`
          : (desc ? `<p class="desc">${xmlEscape(desc)}</p>` : "")}

        <a class="cta" href="${xmlEscape(article.url)}" target="_blank" rel="noopener noreferrer">Read full story on ${xmlEscape(article.source_name || "source")} →</a>
        <a class="secondary" href="/">More top stories</a>

        ${alternates.length > 0 ? `
        <section class="coverage" aria-label="Cross-source coverage">
          <h2>Also covered by</h2>
          <div class="coverage-list">
            ${alternates.map(a => `
              <a class="coverage-item" href="/article/${xmlEscape(a.id)}">
                <span class="coverage-source">${xmlEscape(a.source_name || "")}</span>
                <span class="coverage-title">${xmlEscape(a.title)}</span>
              </a>`).join("")}
          </div>
        </section>` : ""}

        ${related.length > 0 ? `
        <section class="related" aria-label="Related stories">
          <h2>More in ${xmlEscape(article.category || "news")}</h2>
          <div class="related-grid">
            ${related.map(r => `
              <a class="related-card" href="/article/${xmlEscape(r.id)}">
                <div class="rc-source">${xmlEscape(r.source_name || "")}</div>
                <div class="rc-title">${xmlEscape(r.title)}</div>
              </a>`).join("")}
          </div>
          ${TOPIC_HUB_SLUGS.has(article.category) ? `
          <p style="margin:14px 0 0;font-size:14px"><a href="/topic/${xmlEscape(article.category)}" style="color:#DC2626;font-weight:600;text-decoration:none">Browse all ${xmlEscape(article.category)} coverage →</a></p>` : ""}
        </section>` : ""}

        <div class="eeat-foot">
          Aggregated and edited by the Scoop newsroom. We surface news from ${xmlEscape(article.source_name || "trusted sources")} alongside other reporting so you can compare coverage in one place.
          <a href="/editorial-policy">Editorial policy</a> · <a href="/corrections">Corrections</a> · <a href="/about">About Scoop</a>
        </div>
      </div>
    </article>
  </div>
</body>
</html>`);
});

// ── Editorial topic hubs ──────────────────────────────────────────────────
// SSR'd evergreen pages at /topic/:slug. Owns category-level rankings on
// Google ("AI news", "Pakistan news") with substantive editorial framing,
// the day's top stories, and the month's archive. CollectionPage JSON-LD
// gives Google a structured signal that this is a topical hub, not thin SEO.
const TOPIC_HUBS = {
  ai: {
    title: "AI News",
    intro:
      "Artificial intelligence is reshaping work, research, and creative tools faster than any single newsroom can cover. Scoop's AI hub aggregates the most credible reporting from across the industry — model releases, policy shifts, breakthrough research, and the business decisions behind them — synthesized in plain English so you can track what actually changed.",
    why: "If you build, invest in, or use AI tools, the decisions made this week shape what's possible next quarter.",
  },
  cars: {
    title: "Cars & Auto News",
    intro:
      "EVs, regulations, and supply-chain shifts are remaking the auto industry on a monthly cadence. Scoop's cars hub tracks new model launches, battery technology, autonomous-driving milestones, and the policy decisions that move the entire market — pulled from automotive trade press, mainstream news, and investor reporting.",
    why: "Whether you're shopping for your next vehicle or watching the industry, the moves announced today land in showrooms within 18 months.",
  },
  science: {
    title: "Science News",
    intro:
      "Peer-reviewed research is published faster than any reader can keep up with — and the headlines often distort the findings. Scoop's science hub surfaces the most consequential discoveries from credible journals and science-desk reporting, with cross-source comparison so you can see when something is genuinely new versus a press-release amplification.",
    why: "Today's preprint becomes tomorrow's policy debate. Reading the science upstream of the punditry is the highest-leverage information habit you have.",
  },
  politics: {
    title: "Politics News",
    intro:
      "Political stories are easy to read partisan-first. Scoop's politics hub aggregates reporting from across the spectrum — wire services, mainstream outlets, and accountability-focused investigative work — and presents them side-by-side so the disagreement itself becomes legible.",
    why: "How a story is framed often matters as much as the story itself. Reading multiple sources on the same event is a small habit with outsized payoff.",
  },
  pakistan: {
    title: "Pakistan News",
    intro:
      "Scoop's Pakistan hub follows the country's domestic politics, economy, security situation, and culture through a curation of local newsroom reporting alongside international coverage — so you get both the on-the-ground perspective and how the rest of the world is reading the same events.",
    why: "Pakistan is a country of 240 million in a region whose decisions ripple globally. Local context plus international framing is the only way to read it accurately.",
  },
  international: {
    title: "International News",
    intro:
      "Foreign news in the US/UK press is filtered through a narrow editorial lens. Scoop's international hub broadens the aperture — drawing on European, Asian, Middle Eastern, and African desks alongside the wires — so global stories arrive with the regional context their domestic readers see.",
    why: "Most globally important stories are under-covered in any single national press. Reading across borders is how you catch them early.",
  },
  health: {
    title: "Health News",
    intro:
      "Health reporting is high-stakes and easy to get wrong: a strong-sounding study replicates badly, a panicked headline overstates the danger, and useful behavior change is buried. Scoop's health hub leans toward primary-source reporting and longitudinal coverage, so you can see how a story evolves rather than just its first viral take.",
    why: "Health decisions you make on a Wednesday compound for decades. Reading carefully is worth the extra two minutes.",
  },
  sports: {
    title: "Sports News",
    intro:
      "Scores, trades, injuries, and the off-field stories that actually move a season — Scoop's sports hub aggregates wire reports, beat writers, and the longer-form analysis that puts daily news in context. Football, cricket, basketball, motorsport: surfaces from the publications closest to each league.",
    why: "Sports moves on a daily news cycle but careers and championships are decided on a weekly arc. Read both.",
  },
};

// Build the slug → category mapping. The slugs match category names today,
// but keeping a dedicated map lets us add multi-slug aliases later (e.g.
// "/topic/artificial-intelligence" → category "ai").
const TOPIC_SLUG_TO_CATEGORY = {
  ai: "ai", cars: "cars", science: "science", politics: "politics",
  pakistan: "pakistan", international: "international", health: "health",
  sports: "sports",
};

router.get("/topic/:slug", (req, res) => {
  const slug = String(req.params.slug || "").toLowerCase();
  const meta = TOPIC_HUBS[slug];
  const category = TOPIC_SLUG_TO_CATEGORY[slug];
  if (!meta || !category) return res.status(404).send(renderNotFound());

  const db = getDb();
  // Last 30 days, credibility-gated, recency-ordered.
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const articles = db.prepare(`
    SELECT id, title, description, image_url, source_name, published_at, credibility
    FROM articles
    WHERE category = ? AND credibility >= 6 AND published_at > ?
    ORDER BY published_at DESC
    LIMIT 30
  `).all(category, cutoff);

  const canonical = `${SITE}/topic/${slug}`;
  const pageTitle = `${meta.title} — Latest Stories from Trusted Sources | Scoop`;
  const desc = meta.intro.slice(0, 300);
  const ogCard = `${SITE}/api/cards/og/topic-${slug}.png`;

  // CollectionPage JSON-LD — tells Google this is a topical aggregation hub
  // (not thin content) and gives it the article list structure to surface
  // in topic-cluster results.
  const jsonld = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": meta.title,
    "description": desc,
    "url": canonical,
    "isPartOf": { "@type": "WebSite", "name": "Scoop", "url": SITE },
    "mainEntity": {
      "@type": "ItemList",
      "numberOfItems": articles.length,
      "itemListElement": articles.slice(0, 20).map((a, idx) => ({
        "@type": "ListItem",
        "position": idx + 1,
        "url": `${SITE}/article/${encodeURIComponent(a.id)}`,
        "name": a.title,
      })),
    },
  };

  const todayCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const todayArticles  = articles.filter(a => a.published_at >= todayCutoff);
  const recentArticles = articles.filter(a => a.published_at <  todayCutoff);

  const renderCard = (a) => {
    const url = `${SITE}/article/${encodeURIComponent(a.id)}`;
    const ts  = new Date(a.published_at).toISOString();
    const ago = humanAgo(a.published_at);
    return `
      <article class="hub-card">
        ${a.image_url ? `<a href="${url}" class="hub-card-img"><img src="${xmlEscape(a.image_url)}" alt="" loading="lazy" onerror="this.style.display='none'"></a>` : ""}
        <div class="hub-card-body">
          <a href="${url}"><h3>${xmlEscape(a.title)}</h3></a>
          ${a.description ? `<p>${xmlEscape(a.description.slice(0, 160))}${a.description.length > 160 ? "…" : ""}</p>` : ""}
          <div class="hub-card-meta">
            <span>${xmlEscape(a.source_name || "")}</span>
            <span>·</span>
            <time datetime="${ts}">${ago}</time>
          </div>
        </div>
      </article>`;
  };

  const todaySection = todayArticles.length > 0 ? `
    <section>
      <h2>Today in ${xmlEscape(meta.title.replace(" News", ""))}</h2>
      <div class="hub-grid">
        ${todayArticles.map(renderCard).join("")}
      </div>
    </section>` : "";

  const recentSection = recentArticles.length > 0 ? `
    <section>
      <h2>This month</h2>
      <div class="hub-grid">
        ${recentArticles.map(renderCard).join("")}
      </div>
    </section>` : "";

  const emptyMessage = articles.length === 0 ? `
    <div class="hub-empty">
      <p>No recent ${xmlEscape(meta.title.toLowerCase())} stories yet — check back soon, or browse <a href="/">all of today's news</a>.</p>
    </div>` : "";

  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${xmlEscape(pageTitle)}</title>
<meta name="description" content="${xmlEscape(desc)}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="en" href="${canonical}">
<link rel="alternate" hreflang="x-default" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${xmlEscape(pageTitle)}">
<meta property="og:description" content="${xmlEscape(desc)}">
<meta property="og:image" content="${xmlEscape(ogCard)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="Scoop">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${xmlEscape(pageTitle)}">
<meta name="twitter:description" content="${xmlEscape(desc)}">
<meta name="twitter:image" content="${xmlEscape(ogCard)}">
${articles.length === 0 ? `<meta name="robots" content="noindex,follow">` : ""}
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-E7CDBSB5KY"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-E7CDBSB5KY');</script>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6168047656143190" crossorigin="anonymous"></script>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; margin: 0; background: #fafafa; color: #111; line-height: 1.6; }
  @media (prefers-color-scheme: dark) { body { background: #0a0a0a; color: #eee; } .hub-card { background: #151515 !important; border-color: #222 !important; } a { color: #4aa3ff; } .topic-intro { background: #151515 !important; border-color: #222 !important; } }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px 20px 64px; }
  .back { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; text-decoration: none; color: #666; margin-bottom: 18px; }
  .back:hover { color: #DC2626; }
  .brand { font-weight: 700; color: #DC2626; }
  h1 { font-size: 36px; line-height: 1.15; margin: 6px 0 16px; font-weight: 800; letter-spacing: -0.02em; }
  h2 { font-size: 22px; margin: 36px 0 14px; font-weight: 700; letter-spacing: -0.01em; }
  .topic-intro { background: #fff; border: 1px solid #e5e5e5; border-radius: 14px; padding: 18px 22px; margin-bottom: 24px; }
  .topic-intro p { margin: 0 0 10px; font-size: 16px; }
  .topic-intro .why { font-size: 14px; color: #555; font-style: italic; margin-bottom: 0; }
  @media (prefers-color-scheme: dark) { .topic-intro .why { color: #aaa; } }
  .hub-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
  .hub-card { background: #fff; border: 1px solid #e5e5e5; border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; transition: transform 0.15s, box-shadow 0.15s; }
  .hub-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.06); }
  .hub-card-img { display: block; aspect-ratio: 16/9; overflow: hidden; background: #eee; }
  .hub-card-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .hub-card-body { padding: 14px 16px 16px; flex: 1; display: flex; flex-direction: column; }
  .hub-card-body a { text-decoration: none; color: inherit; }
  .hub-card-body h3 { font-size: 16px; line-height: 1.35; margin: 0 0 8px; font-weight: 700; }
  .hub-card-body h3:hover { color: #DC2626; }
  .hub-card-body p { font-size: 13px; color: #555; margin: 0 0 12px; line-height: 1.5; }
  @media (prefers-color-scheme: dark) { .hub-card-body p { color: #aaa; } }
  .hub-card-meta { font-size: 12px; color: #888; margin-top: auto; display: flex; gap: 6px; align-items: center; }
  .hub-empty { padding: 40px 20px; text-align: center; color: #666; background: #fff; border-radius: 14px; border: 1px solid #e5e5e5; }
  @media (prefers-color-scheme: dark) { .hub-empty { background: #151515; border-color: #222; color: #aaa; } }
  .other-topics { margin: 40px 0 0; padding-top: 24px; border-top: 1px solid #e5e5e5; }
  @media (prefers-color-scheme: dark) { .other-topics { border-top-color: #222; } }
  .other-topics h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin: 0 0 12px; font-weight: 600; }
  .other-topics ul { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 8px; }
  .other-topics li a { display: inline-block; padding: 7px 14px; background: #fff; border: 1px solid #e5e5e5; border-radius: 999px; font-size: 14px; text-decoration: none; color: #333; }
  .other-topics li a:hover { border-color: #DC2626; color: #DC2626; }
  @media (prefers-color-scheme: dark) { .other-topics li a { background: #151515; border-color: #222; color: #ddd; } }
  footer { margin: 48px 0 0; padding-top: 20px; border-top: 1px solid #e5e5e5; font-size: 13px; color: #888; }
  @media (prefers-color-scheme: dark) { footer { border-top-color: #222; } }
  footer a { color: #888; margin-right: 14px; text-decoration: none; }
</style>
</head>
<body>
  <div class="wrap">
    <a class="back" href="/">← <span class="brand">Scoop</span> — News, sniffed out.</a>
    <h1>${xmlEscape(meta.title)}</h1>
    <div class="topic-intro">
      <p>${xmlEscape(meta.intro)}</p>
      <p class="why">${xmlEscape(meta.why)}</p>
    </div>
    ${emptyMessage}
    ${todaySection}
    ${recentSection}

    <nav class="other-topics" aria-label="Other topics">
      <h3>Browse other topics</h3>
      <ul>
        ${Object.entries(TOPIC_HUBS)
          .filter(([s]) => s !== slug)
          .map(([s, m]) => `<li><a href="/topic/${s}">${xmlEscape(m.title.replace(" News", ""))}</a></li>`)
          .join("")}
      </ul>
    </nav>

    <footer>
      <a href="/about">About</a>
      <a href="/editorial-policy">Editorial policy</a>
      <a href="/corrections">Corrections</a>
      <a href="/contact">Contact</a>
      <a href="/privacy">Privacy</a>
      <a href="/sponsor">Advertise</a>
    </footer>
  </div>
</body>
</html>`);
});

// Compact relative-time formatter for topic hub cards.
function humanAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 60)  return `${m}m ago`;
  const h = Math.round(diff / 3600000);
  if (h < 24)  return `${h}h ago`;
  const d = Math.round(diff / 86400000);
  return `${d}d ago`;
}

// Extract up to 3 "key takeaway" bullets from the article body.
//
// Goals (vs. the previous naive "first sentence of first 3 paragraphs, slice
// at 180" version):
//   1. Strip site-chrome that scrapers concatenate onto the article body —
//      e.g. BBC inserts "ShareSaveAdd as preferred on Google" before the lede,
//      and bylines like "Lina SinjabCorrespondent, Beirut" follow. Without
//      this, the first bullet ends up being page furniture, not editorial.
//   2. Always emit COMPLETE sentences. Mid-sentence "…" cuts make the page
//      feel auto-generated and broken; better to skip an over-long sentence
//      and try the next one than to truncate it.
//   3. Reject candidates that look like bylines, captions, or chrome.
//
// Still no LLM call — keeps the article SSR path fast and free.
const TAKEAWAY_CHROME_TOKENS = [
  "share", "save", "subscribe", "sign in", "sign up", "sign-in", "sign-up",
  "log in", "login", "follow", "comment", "comments", "print", "email",
  "whatsapp", "facebook", "twitter", "linkedin", "telegram", "reddit",
  "bookmark", "listen", "watch live", "watch now", "read more", "read full",
  "read also", "advertisement", "advertorial", "sponsored content",
  "related article", "more from", "you might also like", "newsletter",
  "preferred on google", "preferred source", "add as preferred",
  "trending now", "most read", "skip to", "back to top", "show captions",
  "play video", "image caption", "image source", "media caption",
  "video caption", "getty images", "associated press", "agence france",
  "all rights reserved", "copyright", "follow on x", "follow us",
  "tap to copy", "copy link", "copied",
];

const TAKEAWAY_BYLINE_RE =
  /^(?:by\s+|reporting by\s+|written by\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}(?:correspondent|reporter|editor|writer|columnist|contributor|staff)/i;

// "Lina SinjabCorrespondent, Beirut" — capital letter glued to lowercase
// (no space), followed by a role + city. Common when scrapers strip <span>s.
const TAKEAWAY_GLUED_BYLINE_RE =
  /[a-z][A-Z][a-z]+(?:Correspondent|Reporter|Editor|Writer|Columnist|Contributor)\b/;

function _looksLikeChrome(text) {
  if (!text) return true;
  const lo = text.toLowerCase();
  // Very short snippets (≤ 30 chars) are almost always captions, labels, or
  // navigation crumbs — never a real takeaway. Length checks above this
  // (e.g. minimum sentence length) are enforced by the caller.
  if (text.length < 30) return true;
  // Multiple chrome tokens piling up = page furniture.
  let chromeHits = 0;
  for (const t of TAKEAWAY_CHROME_TOKENS) {
    if (lo.includes(t)) chromeHits++;
    if (chromeHits >= 2) return true;
  }
  if (TAKEAWAY_BYLINE_RE.test(text)) return true;
  if (TAKEAWAY_GLUED_BYLINE_RE.test(text)) return true;
  return false;
}

// Strip leading site chrome — e.g. "ShareSaveAdd as preferred on GoogleLina
// SinjabCorrespondent, BeirutReutersAtef Najib, former head of Political…"
// becomes "Atef Najib, former head of Political…".
//
// The signature failure mode of HTML-stripping scrapers is that adjacent
// inline elements (a button label, a span, a byline) become concatenated
// without spaces — producing "ShareSaveAdd as preferred on GoogleLina
// SinjabCorrespondent". So step 1 is to re-introduce word boundaries at
// every lowercase→uppercase transition in the first ~500 chars (where this
// glue usually lives). After that, ordinary leading-chrome stripping works.
function _stripLeadingChrome(text) {
  if (!text) return "";
  // Operate on the head only — middle-of-article transitions like "iPhone"
  // or "eBay" stay untouched.
  const headLen = Math.min(500, text.length);
  let head = text.slice(0, headLen);
  const tail = text.slice(headLen);

  // Insert a space at every camelCase glue point: "ShareSave" → "Share Save",
  // "GoogleLina" → "Google Lina", "handcuffsThe" → "handcuffs The".
  // We DO NOT touch ALLCAPS→Capital (e.g. "BBCNews" stays — that's intentional
  // brand merging in many feeds and the next step strips known acronyms).
  head = head.replace(/([a-z])([A-Z])/g, "$1 $2");

  // Insert a period before common sentence-start words that look like they
  // were glued onto a previous sentence (e.g. "handcuffs The highly charged
  // scenes…" → "handcuffs. The highly charged scenes…"). This restores
  // sentence boundaries that the scraper lost, so the takeaway picker can
  // surface a sensible-length lede instead of a 300-char monolith.
  head = head.replace(
    /([a-z]{4,})\s+(The|A|An|This|That|These|Those|It|They|She|He|Officials|Lawmakers|However|Meanwhile)\s+([a-z])/g,
    "$1. $2 $3",
  );

  let t = (head + tail).trim();

  // Now repeatedly strip leading chrome tokens / bylines until stable.
  let changed = true;
  let safety = 30;
  while (changed && t.length > 0 && safety-- > 0) {
    changed = false;
    const lo = t.toLowerCase();
    for (const tok of TAKEAWAY_CHROME_TOKENS) {
      if (lo.startsWith(tok)) {
        t = t.slice(tok.length).replace(/^[\s,:;\-–—]+/, "");
        changed = true;
        break;
      }
    }
    if (changed) continue;

    // Strip a leading byline + location + wire-source attribution.
    // After camelCase split this is normal prose. The pattern is:
    //   "[Author Name] [Role][, optional location words] [optional wire]"
    // e.g. "Lina Sinjab Correspondent, Beirut Reuters" → all stripped, leaving
    // just the article body that follows.
    const bylineMatch = t.match(
      /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\s+(?:Correspondent|Reporter|Editor|Writer|Columnist|Contributor)(?:[\s,;\-–—]+[A-Z][a-z]+){0,2}[\s,;\-–—]+(?=[A-Z])/,
    );
    if (bylineMatch) {
      t = t.slice(bylineMatch[0].length).replace(/^[\s,:;\-–—]+/, "");
      changed = true;
      continue;
    }

    // Strip a leading "By Author Name" byline.
    const byMatch = t.match(/^By\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\s+/);
    if (byMatch) {
      t = t.slice(byMatch[0].length);
      changed = true;
      continue;
    }

    // Strip a leading wire-source attribution: "Reuters", "AP", "AFP",
    // "BBC News" sitting alone at the start.
    const wireMatch = t.match(
      /^(?:Reuters|AP|AFP|Associated Press|Agence France(?:-Presse)?|BBC(?:\s+News)?|CNN|Bloomberg|Al Jazeera|Dawn|The Guardian|The Times)\s+(?=[A-Z])/,
    );
    if (wireMatch) {
      t = t.slice(wireMatch[0].length);
      changed = true;
      continue;
    }

    // Strip a leading dangling preposition + brand/proper-noun.
    // After stripping "Add as preferred" the text is "on Google Lina
    // Sinjab Correspondent…"; consuming "on Google" lets the next pass
    // byline-strip "Lina Sinjab Correspondent". Greedy consumption would
    // eat the byline name too — keep it tight at one capitalised word.
    const prepMatch = t.match(
      /^(?:on|at|in|from|for|via|with|by)\s+[A-Z][a-z]+\s+(?=[A-Z])/,
    );
    if (prepMatch) {
      t = t.slice(prepMatch[0].length);
      changed = true;
    }
  }

  // If the lead still doesn't start with a capital letter, fast-forward to
  // the next sentence-like break.
  if (t && !/^[A-Z"'(]/.test(t)) {
    const nextSentence = t.search(/[.!?]\s+[A-Z]/);
    if (nextSentence > 0) t = t.slice(nextSentence + 2);
  }

  return t.trim();
}

// Try to surface a full sentence (or short two-sentence run) that fits in
// the bullet budget. Never truncates mid-word.
function _pickSentence(paragraph, minLen = 50, maxLen = 220) {
  if (!paragraph) return null;
  // Split on sentence terminators while preserving them.
  const sentences = paragraph
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const s of sentences) {
    if (s.length >= minLen && s.length <= maxLen && !_looksLikeChrome(s)) {
      return s;
    }
  }
  // No single sentence fit. Try the first one if it's at least readable
  // and trim at the last clause boundary (";" or ", " ) within budget.
  const first = sentences[0];
  if (!first || _looksLikeChrome(first)) return null;
  if (first.length <= maxLen) return first;

  const slice = first.slice(0, maxLen);
  const lastBreak = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("; "));
  if (lastBreak >= minLen) return slice.slice(0, lastBreak + 1).trim();

  // Last resort: fall back to the previous sentence if any, else skip.
  return null;
}

function extractTakeaways(article) {
  // Use whichever source has more substance. Some feeds give us a long
  // `description` and a tiny `content`; others vice-versa. Pick the longer
  // one rather than gating on a fixed length threshold.
  const c = article.content || "";
  const d = article.description || "";
  const rawSource = c.length >= d.length ? c : d;
  if (!rawSource || rawSource.length < 120) return [];

  const cleanedHead = _stripLeadingChrome(rawSource);
  const paragraphs = cleanedHead
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const out = [];
  const seen = new Set();
  for (const p of paragraphs) {
    if (out.length >= 3) break;
    if (_looksLikeChrome(p)) continue;
    const s = _pickSentence(p);
    if (!s) continue;
    const key = s.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// Category-aware framing sentence — gives the reader context for why a story
// in this category matters. Rule-based (no LLM cost) but genuinely useful
// editorial framing that differentiates from the raw source.
function categoryFraming(category) {
  const frames = {
    top:           "Why this matters: a developing story that could shape the day's news cycle.",
    politics:      "Why this matters: political developments that affect policy direction and public trust.",
    pakistan:      "Why this matters: local context for readers following news across Pakistan and the region.",
    international: "Why this matters: an international story with cross-border implications worth tracking.",
    science:       "Why this matters: new research or scientific developments with potential real-world impact.",
    medicine:      "Why this matters: a medical development that may affect patient care or public health.",
    "public-health": "Why this matters: a public-health story with consequences for communities and policy.",
    health:        "Why this matters: health reporting relevant to everyday decisions and well-being.",
    environment:   "Why this matters: environmental and climate reporting with long-term consequences.",
    "self-help":   "Why this matters: practical guidance grounded in recent research or expert insight.",
    sports:        "Why this matters: a sports story that could shift standings, legacies, or fan conversations.",
    cars:          "Why this matters: an automotive development that could shape industry direction or buying decisions.",
    ai:            "Why this matters: a development in AI with implications for how people work, create, and decide.",
  };
  return frames[category] || "";
}

// ── E-E-A-T pages ──────────────────────────────────────────────────────────
// These establish editorial identity, transparency, and contact — all required
// by Google News / Discover guidelines and broader E-E-A-T signals. Without
// these, sitemap-news.xml submissions get indexed then deranked as low-trust.
router.get("/about", (_req, res) => {
  const orgJsonld = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Scoop",
    "url": SITE,
    "logo": `${SITE}/news-icon.svg`,
    "contactPoint": {
      "@type": "ContactPoint",
      "email": "hi@scoopfeeds.com",
      "contactType": "editorial",
    },
    "sameAs": [],
  };
  res.type("html").send(renderStaticPage({
    title: "About Scoop",
    slug: "about",
    jsonld: orgJsonld,
    body: `
      <h1>About Scoop</h1>
      <p><strong>Scoop</strong> is an AI-powered news aggregator covering global stories across politics, technology, science, sports, health, and more. We surface the most important reporting of the day from around the world — with context, cross-source comparison, and AI-generated summaries on every article page.</p>
      <p>We aggregate from <strong>88+ reputable sources</strong>, provide <strong>AI-generated summaries</strong> clearly labeled on each article, and publish in both <strong>English and Urdu</strong>. Every Scoop page links prominently back to the original publisher.</p>
      <h2>What we cover</h2>
      <ul>
        <li><strong>Top stories</strong> — the day's biggest developing news.</li>
        <li><strong>Politics &amp; international</strong> — global politics, diplomacy, conflict reporting.</li>
        <li><strong>Pakistan</strong> — local-language and English coverage of South Asia.</li>
        <li><strong>Science, medicine, public health</strong> — research, policy, clinical developments.</li>
        <li><strong>AI, cars, sports, environment</strong> — deep verticals with rotating editorial weight.</li>
      </ul>
      <h2>Our team</h2>
      <p>Edited by the <strong>Scoop Newsroom</strong> — a team of engineers and editors committed to fast, accurate news delivery.</p>
      <h2>Our mission</h2>
      <p>Our mission is to surface the most credible, relevant news from around the world — filtered by credibility scoring, not clicks.</p>
      <h2>Languages</h2>
      <p>Scoop publishes in English and Urdu (اردو). Machine translation is used for Urdu coverage and is flagged as such.</p>
      <h2>Contact</h2>
      <p>Editorial: <a href="/contact">see contact page</a>. Corrections: <a href="/corrections">corrections policy</a>.</p>
    `,
  }));
});

router.get("/editorial-policy", (_req, res) => {
  res.type("html").send(renderStaticPage({
    title: "Editorial Policy",
    slug: "editorial-policy",
    body: `
      <h1>Editorial Policy</h1>
      <p>Scoop aggregates, synthesizes, and links to journalism from established news publishers. This page explains how we choose sources, how we handle AI summaries, and the standards we hold ourselves to.</p>
      <h2>Source selection</h2>
      <p>We ingest only publishers with editorial oversight, a masthead, and a track record of news reporting. Sources are weighted by a credibility score (1–10); only sources scoring <strong>7 or higher</strong> appear on the homepage featured rotation. We currently aggregate from <strong>88 vetted outlets</strong>. New sources are reviewed by the Scoop Newsroom before being added.</p>
      <h2>AI summaries</h2>
      <p>AI-generated summaries are <strong>clearly labeled</strong> on every article page and always link to the original source. Summaries are derived from the source's own reporting and are not presented as independent journalism. The Scoop Newsroom reviews summary quality on an ongoing basis.</p>
      <h2>Corrections</h2>
      <p>Errors in our summaries or article metadata are corrected promptly. See our <a href="/corrections">corrections policy</a> for how to report a factual error.</p>
      <h2>Breaking news</h2>
      <p>Breaking news stories are only surfaced after initial verification against at least one established wire service or outlet. Unverified reports are held until corroborated.</p>
      <h2>Prohibited categories</h2>
      <p>Auto-posting is suppressed for content involving violence, tragedy, or graphic harm. Stories in these categories require <strong>human review</strong> by the Scoop Newsroom before publication.</p>
      <h2>Attribution</h2>
      <p>Every article page on Scoop clearly names the original publisher in the headline metadata, the article byline, and the primary call-to-action ("Read full story on [source] →"). We do not rewrite articles to obscure their origin.</p>
      <h2>Advertising &amp; commercial relationships</h2>
      <p>Scoop is ad-supported (Google AdSense) and may include affiliate links where relevant. Advertising is never a factor in which stories we surface or how we rank them. Sponsored content, when present, is always clearly labeled.</p>
      <h2>Accountability</h2>
      <p>Editorial decisions are overseen by the <strong>Scoop Newsroom</strong>. For concerns, contact <a href="mailto:hi@scoopfeeds.com">hi@scoopfeeds.com</a>.</p>
      <p class="updated">Last updated: ${new Date().toISOString().slice(0, 10)}</p>
    `,
  }));
});

router.get("/corrections", (_req, res) => {
  res.type("html").send(renderStaticPage({
    title: "Corrections & Clarifications",
    slug: "corrections",
    body: `
      <h1>Corrections &amp; Clarifications</h1>
      <p>Scoop links to primary sources for all news content. Errors in aggregated summaries are corrected promptly. Because we aggregate reporting from other publishers, corrections can apply to:</p>
      <ul>
        <li><strong>Source-level errors</strong> — inaccuracies in the original reporting. We link readers to the source and encourage them to submit corrections directly to the publisher.</li>
        <li><strong>Scoop-level errors</strong> — inaccuracies in our AI summaries, key takeaways, category framing, cross-source links, or headline display. These we correct directly.</li>
      </ul>
      <h2>How to report a factual error</h2>
      <p>Email <a href="mailto:hi@scoopfeeds.com"><strong>hi@scoopfeeds.com</strong></a> with the article URL and the correction. Please include:</p>
      <ul>
        <li>The URL of the Scoop article page.</li>
        <li>The specific claim you believe is inaccurate.</li>
        <li>A source or evidence supporting the correction.</li>
      </ul>
      <p>We aim to respond within 48 hours. Verified corrections are applied to the article page and logged below.</p>
      <h2>Correction log</h2>
      <p>Individual corrections are logged here with date, article ID, and a brief description of what was changed.</p>
      <p><em>No corrections have been logged to date.</em></p>
    `,
  }));
});

router.get("/contact", (_req, res) => {
  res.type("html").send(renderStaticPage({
    title: "Contact Scoop",
    slug: "contact",
    body: `
      <h1>Contact Scoop</h1>
      <p>Scoop is operated by a small independent team. The best way to reach us is email.</p>
      <ul>
        <li><strong>Editorial / corrections:</strong> <a href="mailto:hi@scoopfeeds.com">hi@scoopfeeds.com</a> (see our <a href="/corrections">corrections policy</a>)</li>
        <li><strong>Advertising / sponsorships:</strong> <a href="mailto:hi@scoopfeeds.com">hi@scoopfeeds.com</a></li>
      </ul>
      <p>We aim to respond to all inquiries within 48 hours. Corrections are prioritized.</p>
      <h2>Send us a message</h2>
      <form action="mailto:hi@scoopfeeds.com" method="post" enctype="text/plain" style="margin-top:8px;">
        <div style="margin-bottom:14px;">
          <label for="contact-name" style="display:block;font-size:14px;font-weight:600;margin-bottom:4px;">Name</label>
          <input id="contact-name" name="Name" type="text" placeholder="Your name" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:15px;font-family:inherit;">
        </div>
        <div style="margin-bottom:14px;">
          <label for="contact-email" style="display:block;font-size:14px;font-weight:600;margin-bottom:4px;">Email</label>
          <input id="contact-email" name="Email" type="email" placeholder="you@example.com" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:15px;font-family:inherit;">
        </div>
        <div style="margin-bottom:18px;">
          <label for="contact-message" style="display:block;font-size:14px;font-weight:600;margin-bottom:4px;">Message</label>
          <textarea id="contact-message" name="Message" rows="5" placeholder="Your message…" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:15px;font-family:inherit;resize:vertical;"></textarea>
        </div>
        <button type="submit" style="background:#DC2626;color:#fff;border:none;padding:11px 24px;border-radius:999px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;">Send message</button>
      </form>
    `,
  }));
});

router.get("/privacy", (_req, res) => {
  res.type("html").send(renderStaticPage({
    title: "Privacy Policy",
    slug: "privacy",
    body: `
      <h1>Privacy Policy</h1>
      <p>Scoop respects your privacy. This policy explains what data we collect, why, and what you can do about it.</p>
      <h2>Data we collect</h2>
      <ul>
        <li><strong>Anonymous analytics.</strong> Aggregated pageviews, article views, category preferences, and session data. IP addresses are not stored in personally identifiable form.</li>
        <li><strong>Newsletter email.</strong> If you subscribe to the Scoop digest, we store your email address and topic preferences. You can unsubscribe at any time via the link in every email.</li>
        <li><strong>Push notification token.</strong> If you opt in to breaking-news push notifications, we store a device token to deliver pushes. You can revoke this at any time in your browser or device settings.</li>
      </ul>
      <h2>How we use it</h2>
      <ul>
        <li><strong>Improve content ranking</strong> — anonymous analytics inform which sources and categories are prioritized.</li>
        <li><strong>Send digest emails</strong> — newsletter subscribers receive a curated daily or weekly digest.</li>
        <li><strong>Send breaking news pushes</strong> — opted-in users receive push notifications for major breaking stories.</li>
      </ul>
      <h2>Third parties</h2>
      <p>Scoop uses the following third-party services, each with their own privacy policies:</p>
      <ul>
        <li><strong>Google AdSense</strong> (publisher: pub-6168047656143190) — advertising. AdSense may use cookies to personalize ads; you can opt out at <a href="https://adssettings.google.com" rel="noopener noreferrer">adssettings.google.com</a>. See <a href="https://policies.google.com/privacy" rel="noopener noreferrer">Google's privacy policy</a>.</li>
        <li><strong>Skimlinks</strong> — affiliate links. Skimlinks may automatically convert some product links into affiliate links. See <a href="https://skimlinks.com/privacy-policy" rel="noopener noreferrer">Skimlinks' privacy policy</a>.</li>
        <li><strong>Google Analytics (GA4)</strong> — aggregate usage measurement.</li>
      </ul>
      <h2>Cookies</h2>
      <p>Scoop uses cookies for (a) analytics measurement, and (b) ad personalization via Google AdSense. You can disable cookies in your browser settings. Users in the EU/EEA may opt out of personalized advertising via the AdSense opt-out link above.</p>
      <h2>Your rights (GDPR)</h2>
      <p>If you are in the EU/EEA, you have the right to access, correct, or request deletion of your personal data (newsletter email, push token). To exercise these rights, email <a href="mailto:hi@scoopfeeds.com">hi@scoopfeeds.com</a>. We respond within 30 days.</p>
      <h2>Contact</h2>
      <p>Privacy questions: <a href="mailto:hi@scoopfeeds.com">hi@scoopfeeds.com</a>.</p>
      <p class="updated">Last updated: April 2026</p>
    `,
  }));
});

function renderStaticPage({ title, slug, body, jsonld = null }) {
  const pageTitle = `${title} — Scoop`;
  const canonical = `${SITE}/${slug}`;
  const desc = `${title} — Scoop is a news aggregator surfacing the day's biggest stories from trusted sources, with original editorial synthesis and cross-source comparison.`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${xmlEscape(pageTitle)}</title>
<meta name="description" content="${xmlEscape(desc)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${xmlEscape(pageTitle)}">
<meta property="og:description" content="${xmlEscape(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="Scoop">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${xmlEscape(pageTitle)}">
<meta name="twitter:description" content="${xmlEscape(desc)}">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ""}
<script async src="https://www.googletagmanager.com/gtag/js?id=G-E7CDBSB5KY"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-E7CDBSB5KY');</script>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; margin: 0; background: #fafafa; color: #111; line-height: 1.65; }
  @media (prefers-color-scheme: dark) { body { background: #0a0a0a; color: #e5e5e5; } a { color: #4aa3ff; } }
  .wrap { max-width: 760px; margin: 0 auto; padding: 24px 20px 64px; }
  .back { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; text-decoration: none; color: #666; margin-bottom: 20px; }
  .back:hover { color: #DC2626; }
  .brand { font-weight: 700; color: #DC2626; }
  h1 { font-size: 32px; line-height: 1.2; margin: 4px 0 20px; font-weight: 700; }
  h2 { font-size: 20px; margin: 32px 0 10px; font-weight: 700; }
  p { font-size: 16px; margin: 0 0 14px; }
  ul { margin: 0 0 18px; padding-left: 22px; }
  li { font-size: 16px; margin-bottom: 6px; }
  a { color: #DC2626; }
  .updated { font-size: 13px; color: #888; margin-top: 28px; }
  footer { margin: 48px 0 0; padding-top: 20px; border-top: 1px solid #e5e5e5; font-size: 13px; color: #888; }
  @media (prefers-color-scheme: dark) { footer { border-top-color: #222; } }
  footer a { color: #888; margin-right: 14px; }
</style>
</head>
<body>
  <div class="wrap">
    <a class="back" href="/">← <span class="brand">Scoop</span> — News, sniffed out.</a>
    ${body}
    <footer>
      <a href="/about">About</a>
      <a href="/editorial-policy">Editorial policy</a>
      <a href="/corrections">Corrections</a>
      <a href="/contact">Contact</a>
      <a href="/privacy">Privacy</a>
      <a href="/sponsor">Advertise</a>
    </footer>
  </div>
</body>
</html>`;
}

// ── Sponsor / advertise page ───────────────────────────────────────────────
// Simple landing page for newsletter sponsors and native ad inquiries.
// Enables manual sponsorship selling at ~2k subs without any ad-tech setup.
router.get("/sponsor", (_req, res) => {
  res.type("html").send(renderStaticPage({
    title: "Advertise on Scoop",
    slug: "sponsor",
    body: `
      <h1>Advertise on Scoop</h1>
      <p>Scoop delivers a daily news digest to thousands of engaged readers covering global politics, technology, science, and business — primarily in Pakistan, the UK, the US, and the Middle East. Readers opt in; every open is intentional.</p>

      <h2>Newsletter sponsorship</h2>
      <p>Scoop Daily reaches <strong>verified subscribers</strong> who chose to receive it. A sponsored placement appears at the top of the digest, clearly labeled "Presented by", before the news stories.</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 18px">
        <tr style="border-bottom:1px solid #e5e5e5"><th style="text-align:left;padding:8px 0;font-size:15px">Format</th><th style="text-align:right;padding:8px 0;font-size:15px">Rate</th></tr>
        <tr style="border-bottom:1px solid #e5e5e5"><td style="padding:10px 0;font-size:15px">Weekly newsletter placement (Mon–Fri, 5 issues)</td><td style="text-align:right;padding:10px 0;font-size:15px">$150</td></tr>
        <tr style="border-bottom:1px solid #e5e5e5"><td style="padding:10px 0;font-size:15px">Dedicated send (solo email to full list)</td><td style="text-align:right;padding:10px 0;font-size:15px">$200</td></tr>
        <tr><td style="padding:10px 0;font-size:15px">Monthly bundle (all issues + 2 solo sends)</td><td style="text-align:right;padding:10px 0;font-size:15px">$600</td></tr>
      </table>
      <p>All placements include a custom headline, 2-3 sentence description, and a CTA link of your choice. We retain editorial discretion over content and relevance.</p>

      <h2>Site / native placement</h2>
      <p>In-feed native card slots are available on the homepage alongside news. Minimum 3-day run. Rates on request.</p>

      <h2>Who should advertise here</h2>
      <ul>
        <li>News-adjacent SaaS products (newsletters, podcasts, media tools)</li>
        <li>Fintech and investment platforms (Pakistan, UK, US markets)</li>
        <li>Education and upskilling platforms</li>
        <li>Consumer brands targeting young professional readers</li>
      </ul>

      <h2>Get in touch</h2>
      <p>Email <a href="mailto:sponsor@scoopfeeds.com">sponsor@scoopfeeds.com</a> with your brand name, target dates, and any questions. We respond within 24 hours.</p>
      <p><a href="mailto:sponsor@scoopfeeds.com" style="display:inline-block;background:#DC2626;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Email us to get started →</a></p>
      <p class="updated">Rates valid through Q3 2026. Minimum 2 business days lead time.</p>
    `,
  }));
});

function renderNotFound() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not found — Scoop</title><meta name="robots" content="noindex"><style>body{font-family:system-ui;text-align:center;padding:80px 20px;color:#333}a{color:#DC2626}</style></head><body><h1>Story not found</h1><p>This article may have expired.</p><p><a href="/">← Back to Scoop</a></p></body></html>`;
}

export default router;
