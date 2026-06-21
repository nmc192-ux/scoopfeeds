/**
 * eventBreaker — curative ENTITY-AWARE circuit-breaker (Path A). Post-promotion janitor.
 *
 * For each event with ≥ MIN_ARTICLES members, re-cluster via the UNMODIFIED clusterWindow. clusterWindow
 * splits BOTH genuine multi-story blobs AND a single macro-story's cosine-separable sub-threads, so a raw
 * "≥2 sub-clusters" trigger over-fragments (it shattered the Iran macro-story into ~16 cards). The fix:
 * spin off a sub-cluster ONLY if it is ENTITY-DISJOINT from the largest sub-cluster's core (rarity-weighted
 * shared-entity overlap < DISJOINT) — a genuinely foreign absorbed story. Sub-threads that share the core
 * (the Iran peace-deal/oil/Hormuz/nuclear threads) are KEPT in the event. If nothing is disjoint, the event
 * is a coherent macro-story → left whole. KEEP-CORE: the kept group retains the event id/slug/URL.
 *
 * Behind EVENT_BREAKER_ENABLED (default OFF → prod-neutral). Mutates events/event_articles.
 */
import crypto from "crypto";
import { getDb } from "../../models/database.js";
import { clusterWindow } from "../clustering/semanticClusterer.js";
import { logger } from "../../services/logger.js";

const ENABLED      = String(process.env.EVENT_BREAKER_ENABLED ?? "false").toLowerCase() === "true";
const MIN_ARTICLES = parseInt(process.env.EVENT_BREAKER_MIN_ARTICLES || "6", 10);
const DISJOINT     = Number.parseFloat(process.env.EVENT_BREAKER_DISJOINT || "0.06"); // core-overlap below this = foreign story → spin off
const MAX_CATSPAN  = parseInt(process.env.EVENT_ENTITY_MAX_CATSPAN || "5", 10);
const TOPK         = parseInt(process.env.EVENT_ENTITY_TOPK || "40", 10);

function slugify(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 80).replace(/^-+|-+$/g, ""); }
function uniqueSlug(db, base) { let slug = base || crypto.randomUUID().slice(0, 8); let i = 2; while (db.prepare("SELECT 1 FROM events WHERE slug = ?").get(slug)) slug = `${base}-${i++}`; return slug; }
const domCat = (m) => { const c = {}; for (const x of m) c[x.category] = (c[x.category] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || "top"; };

function clusterMembers(db, ids) {
  if (!ids.length) return [];
  const set = new Set(ids), ph = ids.map(() => "?").join(",");
  const span = db.prepare(`SELECT MIN(published_at) lo, MAX(published_at) hi FROM articles WHERE id IN (${ph})`).get(...ids);
  if (span.lo == null) return [];
  const win = db.prepare("SELECT id FROM articles WHERE published_at >= ? AND published_at < ? AND is_duplicate = 0").all(span.lo, span.hi + 1).map(r => r.id);
  return clusterWindow({ db, windowStart: span.lo, windowEnd: span.hi + 1, excludeIds: new Set(win.filter(id => !set.has(id))) }).clusters;
}

export function runEventBreaker({ now = Date.now(), minArticles = MIN_ARTICLES, disjoint = DISJOINT, force = false } = {}) {
  if (!ENABLED && !force) return { enabled: false };
  const db = getDb();
  // rarity weights + category-span (hub exclusion) from entity_idf
  const idfMap = new Map(), catSpanMap = new Map();
  for (const r of db.prepare("SELECT key, idf, cat_span FROM entity_idf").all()) { idfMap.set(r.key, r.idf); catSpanMap.set(r.key, r.cat_span); }
  const nw = db.prepare("SELECT n_window FROM entity_idf LIMIT 1").get()?.n_window;
  const fallbackIdf = (idfMap.size && nw) ? Math.log(nw) : 1;
  const entitySet = (ids) => {
    const keys = new Set();
    for (let i = 0; i < ids.length; i += 500) { const ch = ids.slice(i, i + 500); if (!ch.length) continue; const ph = ch.map(() => "?").join(","); for (const r of db.prepare(`SELECT DISTINCT COALESCE(qid, surface_norm) k FROM article_entities WHERE article_id IN (${ph})`).all(...ch)) { if ((catSpanMap.get(r.k) ?? 1) > MAX_CATSPAN) continue; keys.add(r.k); } }
    if (keys.size <= TOPK) return keys;
    return new Set([...keys].sort((a, b) => (idfMap.get(b) ?? 0) - (idfMap.get(a) ?? 0)).slice(0, TOPK));
  };
  const overlap = (A, B) => { if (!A.size || !B.size) return 0; let i = 0, u = 0; for (const k of new Set([...A, ...B])) { const w = idfMap.get(k) ?? fallbackIdf; u += w; if (A.has(k) && B.has(k)) i += w; } return u ? i / u : 0; };

  const candidates = db.prepare(
    `SELECT ea.event_id id FROM event_articles ea JOIN events e ON e.id = ea.event_id
      WHERE e.status IN ('active','dormant') GROUP BY ea.event_id HAVING COUNT(*) >= ?`
  ).all(minArticles);

  const linkArticle = db.prepare("INSERT OR IGNORE INTO event_articles (event_id, article_id, relevance, added_at) VALUES (?,?,1.0,?)");
  const delLinks = db.prepare("DELETE FROM event_articles WHERE event_id = ?");
  const touchEv = db.prepare("UPDATE events SET last_activity_at = ?, updated_at = ? WHERE id = ?");
  const insEvent = db.prepare(`INSERT INTO events (id, slug, cluster_id, title, summary, category, status, severity, hero_image_url, started_at, last_activity_at, meta, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  let split = 0, created = 0, foreignSpun = 0; const splitIds = [];
  for (const b of candidates) {
    const members = db.prepare("SELECT article_id id FROM event_articles WHERE event_id = ?").all(b.id).map(r => r.id);
    const subs = clusterMembers(db, members);
    if (subs.length <= 1) continue; // one story
    const core = entitySet(subs[0].members.map(m => m.id));
    const spin = []; // ENTITY-DISJOINT sub-clusters (foreign stories)
    for (let i = 1; i < subs.length; i++) {
      const ov = overlap(entitySet(subs[i].members.map(m => m.id)), core);
      if (ov < disjoint) spin.push(subs[i]); // foreign → spin off; else same-story sub-thread → keep
    }
    if (!spin.length) continue; // macro-story with sub-threads only → leave whole (the over-fragmentation fix)
    const spinMembers = new Set(spin.flatMap(s => s.members.map(m => m.id)));
    splitIds.push(b.id); split++;
    const apply = db.transaction(() => {
      delLinks.run(b.id);
      for (const m of members) if (!spinMembers.has(m)) linkArticle.run(b.id, m, now); // KEEP core + same-story threads + singletons
      touchEv.run(now, now, b.id);
      for (const sub of spin) {
        const id = crypto.randomUUID();
        const slug = uniqueSlug(db, slugify(sub.members[0]?.title) || id.slice(0, 8));
        insEvent.run(id, slug, null, sub.members[0]?.title ?? id.slice(0, 8), null, domCat(sub.members), "active", 0, null, now, now, "{}", now, now);
        for (const m of sub.members) linkArticle.run(id, m.id, now);
        created++; foreignSpun++;
      }
    });
    apply();
  }
  const stats = { enabled: true, candidates: candidates.length, split, foreignSpun, created, splitIds };
  logger.info?.(`🔪 eventBreaker(entity-aware) — ${JSON.stringify({ ...stats, splitIds: splitIds.length })}`);
  return stats;
}
