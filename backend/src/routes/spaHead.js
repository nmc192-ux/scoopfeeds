/**
 * Per-route head tags for the SPA shell, for EVERY user agent (#178).
 *
 * The SPA's index.html carries the homepage's title, description and canonical. Served as is,
 * every URL presented as the homepage, and only the bot whitelist in seo.js (BOT_UA_RE) got a
 * page of its own; Bing, Apple, DuckDuckGo and most AI crawlers saw "the homepage" everywhere.
 *
 * `headFor()` decides a route's title / description / canonical / robots; `injectHead()` swaps
 * those tags into index.html. The SPA body is untouched. Bots on /article/:id and /topic/:slug
 * still get seo.js's full SSR page first; this is the shell everyone else gets.
 *
 * Rule: two different routes never share a canonical. The canonical is always this route's own
 * path (query string dropped), except a merged dossier, whose canonical is its survivor.
 *
 * Kill switch: SEO_SPA_HEAD=false serves index.html untouched (code default: on).
 */
import { readFileSync, statSync } from "fs";
import { TOPIC_HUBS } from "./seo.js";
import { TOPICS } from "../config/sources.js";
import { firstSentences } from "./readerPayload.js";

export const SITE = (process.env.PRIMARY_SITE_URL || "https://scoopfeeds.com").replace(/\/+$/, "");
export const SITE_NAME = "Scoopfeeds";
export const DEFAULT_DESC = "Scoopfeeds groups every outlet's coverage of a story into one clear event: top stories, developing news and live event dossiers.";

const STATIC = {
  "/":                 { title: `${SITE_NAME} — Intelligent news, curated.`, description: DEFAULT_DESC },
  "/events":           { title: `News — every developing story, every outlet · ${SITE_NAME}`, description: "Every developing story as one dossier: the timeline, which outlets covered it, and how their angles differ." },
  "/briefs":           { title: `Originals — analysis briefs · ${SITE_NAME}`, description: "ScoopFeeds' own analysis briefs, each tied to the evidence and the outlets behind it." },
  "/markets":          { title: `Markets · ${SITE_NAME}`, description: "Markets, macro indicators and the stories moving them." },
  "/live-tv":          { title: `Watch & Listen — ScoopFeeds Radio and live TV · ${SITE_NAME}`, description: "ScoopFeeds Radio and live news channels in one place." },
  "/about":            { title: `About · ${SITE_NAME}`, description: "Who runs ScoopFeeds, how stories are grouped, and where the coverage comes from." },
  "/editorial-policy": { title: `Editorial policy · ${SITE_NAME}`, description: "How ScoopFeeds selects, groups and labels the news." },
  "/privacy":          { title: `Privacy · ${SITE_NAME}`, description: "What ScoopFeeds collects and why." },
  "/terms":            { title: `Terms · ${SITE_NAME}`, description: "The terms of using ScoopFeeds." },
  "/contact":          { title: `Contact · ${SITE_NAME}`, description: "How to reach the ScoopFeeds team." },
  "/newsletter":       { title: `Newsletter — the Morning Scoop · ${SITE_NAME}`, description: "The Morning Scoop: the day's stories, compared across outlets, in your inbox." },
  "/weather":          { title: `Weather · ${SITE_NAME}`, description: "Weather for the cities in the news." },
};
// Personal or query-driven pages: never indexed.
const NOINDEX = new Set(["/search", "/saved", "/dashboard"]);
const NOINDEX_TITLES = { "/search": `Search · ${SITE_NAME}`, "/saved": `Saved stories · ${SITE_NAME}`, "/dashboard": `Your dashboard · ${SITE_NAME}` };

function titleCase(slug) {
  return String(slug).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function topicTitle(slug) {
  const hub = TOPIC_HUBS[slug];
  if (hub?.title) return hub.title;
  const t = TOPICS.find((x) => x.id === slug);
  return t ? t.label : titleCase(slug);
}

/** Normalised path: no query, no trailing slash (except "/"), lower-case-safe percent-encoding kept. */
export function canonicalPath(pathname) {
  let p = String(pathname || "/").split("?")[0].split("#")[0];
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p || "/";
}

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s);

/**
 * The head for one request path. `lookup` reads the DB (injected so tests and the shell can run
 * without one): { event(slug) → { title, outlets, status, mergedIntoSlug } | null,
 *                 brief(slug) → { title, thesis } | null }.
 * Returns { title, description, canonical, robots, ogType }.
 */
export function headFor(pathname, lookup = {}) {
  const p = canonicalPath(pathname);
  const own = `${SITE}${p === "/" ? "/" : p}`;
  const base = { title: `${SITE_NAME}`, description: DEFAULT_DESC, canonical: own, robots: "index,follow", ogType: "website" };

  if (NOINDEX.has(p)) return { ...base, title: NOINDEX_TITLES[p], robots: "noindex,follow" };
  if (STATIC[p]) return { ...base, ...STATIC[p] };

  let m;
  if ((m = p.match(/^\/events\/([^/]+)$/))) {
    const slug = decodeURIComponent(m[1]);
    const ev = safe(() => lookup.event?.(slug));
    if (!ev) return { ...base, title: `Story not found · ${SITE_NAME}`, robots: "noindex,follow" };
    const n = Number(ev.outlets) || 0;
    const canonical = ev.mergedIntoSlug ? `${SITE}/events/${encodeURIComponent(ev.mergedIntoSlug)}` : own;
    // Mechanical only, like the dossier header: never the stored LLM summary (CLAUDE.md, contamination class).
    const description = n ? `${ev.title}: the timeline, and how ${n} outlet${n === 1 ? "" : "s"} covered it.` : `${ev.title}: the timeline and the coverage.`;
    return { ...base, title: clip(`${ev.title}${n ? ` · ${n} outlet${n === 1 ? "" : "s"}` : ""} · ${SITE_NAME}`, 110),
      description: clip(description, 300), canonical, ogType: "article" };
  }
  if ((m = p.match(/^\/topic\/([^/]+)(?:\/([^/]+))?$/))) {
    const slug = decodeURIComponent(m[1]).toLowerCase();
    const country = m[2] ? decodeURIComponent(m[2]).toUpperCase() : null;
    const name = topicTitle(slug);
    const hub = TOPIC_HUBS[slug];
    return { ...base, title: `${name}${country ? ` · ${country}` : ""} — latest stories · ${SITE_NAME}`,
      description: clip(hub?.intro || `The latest ${name} stories, grouped by event and compared across outlets.`, 300) };
  }
  if ((m = p.match(/^\/briefs\/([^/]+)$/))) {
    const b = safe(() => lookup.brief?.(decodeURIComponent(m[1])));
    if (!b) return { ...base, title: `Brief not found · ${SITE_NAME}`, robots: "noindex,follow" };
    return { ...base, title: clip(`${b.title} · ${SITE_NAME} Originals`, 110), description: clip(firstSentences(b.thesis || "", 2) || DEFAULT_DESC, 300), ogType: "article" };
  }
  if ((m = p.match(/^\/(source|tag|region|country|trackers)\/([^/]+)$/))) {
    const kind = { source: "Source", tag: "Tag", region: "Region", country: "Country", trackers: "Tracker" }[m[1]];
    return { ...base, title: `${titleCase(decodeURIComponent(m[2]))} — ${kind} · ${SITE_NAME}` };
  }
  // Admin shells are never indexed.
  if (p.startsWith("/scoop-ops")) return { ...base, title: SITE_NAME, robots: "noindex,nofollow" };
  // Anything else: its own canonical and a title from its path, so no two routes collide.
  return { ...base, title: `${titleCase(p.split("/").filter(Boolean).map(decodeURIComponent).join(" · "))} · ${SITE_NAME}` };
}

function safe(fn) { try { return fn() || null; } catch { return null; } }

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Tags index.html carries for the homepage, which every route replaces.
const STRIP = [
  /<title>[\s\S]*?<\/title>\s*/i,
  /<meta\s+name="description"[^>]*>\s*/gi,
  /<meta\s+name="robots"[^>]*>\s*/gi,
  /<meta\s+property="og:(?:title|description|url|type)"[^>]*>\s*/gi,
  /<meta\s+name="twitter:(?:title|description)"[^>]*>\s*/gi,
  /<link\s+rel="canonical"[^>]*>\s*/gi,
  /<link\s+rel="alternate"\s+hreflang="[^"]*"[^>]*>\s*/gi,   // English only (plan v7): no Urdu alternates
];

/** index.html with this route's head tags in place of the homepage's. */
export function injectHead(html, head) {
  let out = String(html);
  for (const re of STRIP) out = out.replace(re, "");
  const tags = [
    `<title>${esc(head.title)}</title>`,
    `<meta name="description" content="${esc(head.description)}" />`,
    `<meta name="robots" content="${esc(head.robots)}" />`,
    `<link rel="canonical" href="${esc(head.canonical)}" />`,
    `<meta property="og:type" content="${esc(head.ogType || "website")}" />`,
    `<meta property="og:title" content="${esc(head.title)}" />`,
    `<meta property="og:description" content="${esc(head.description)}" />`,
    `<meta property="og:url" content="${esc(head.canonical)}" />`,
    `<meta name="twitter:title" content="${esc(head.title)}" />`,
    `<meta name="twitter:description" content="${esc(head.description)}" />`,
  ].join("\n    ");
  return out.replace(/<head([^>]*)>/i, (m) => `${m}\n    ${tags}`);
}

/** The DB-backed lookup the server uses. */
export function dbLookup(db) {
  const evQ = db.prepare(`
    SELECT e.title, e.status, e.meta,
           (SELECT COUNT(DISTINCT a.source_name) FROM event_articles ea JOIN articles a ON a.id = ea.article_id WHERE ea.event_id = e.id) AS outlets
    FROM events e WHERE e.slug = ?`);
  let brQ = null;
  try { brQ = db.prepare("SELECT title, thesis, status FROM generated_briefs WHERE slug = ?"); } catch { /* table absent */ }
  return {
    event(slug) {
      const r = evQ.get(slug);
      if (!r) return null;
      let meta = {}; try { meta = JSON.parse(r.meta || "{}") || {}; } catch { /* ignore */ }
      return { title: r.title, outlets: r.outlets, status: r.status, mergedIntoSlug: meta.merged_into_slug || null };
    },
    brief(slug) {
      const r = brQ?.get(slug);
      return r && r.status === "published" ? r : null;
    },
  };
}

export function spaHeadEnabled(env = process.env) {
  return String(env.SEO_SPA_HEAD ?? "").toLowerCase() !== "false";
}

/**
 * The SPA catch-all (server.js). index.html is re-read when its mtime changes (a new build), the
 * DB lookup is prepared once. Any failure serves the plain shell: head tags never cost a page.
 */
export function spaShellHandler({ indexFile, getDb, log = console, env = process.env }) {
  let shell = { mtimeMs: -1, html: "" };
  let lookup = null;
  return (req, res) => {
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    if (!spaHeadEnabled(env)) return res.sendFile(indexFile);
    try {
      const st = statSync(indexFile);
      if (st.mtimeMs !== shell.mtimeMs) shell = { mtimeMs: st.mtimeMs, html: readFileSync(indexFile, "utf8") };
      if (!lookup) lookup = dbLookup(getDb());
      res.type("html").send(injectHead(shell.html, headFor(req.path, lookup)));
    } catch (err) {
      log.warn?.(`spa head: ${err.message}; serving the plain shell`);
      res.sendFile(indexFile);
    }
  };
}
