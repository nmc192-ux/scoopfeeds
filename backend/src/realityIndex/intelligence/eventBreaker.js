/**
 * eventBreaker — curative >5-category circuit-breaker (Path A). Post-promotion janitor: finds
 * events spanning more than EVENT_BREAKER_MAX_CATS categories, re-clusters their members through
 * the UNMODIFIED clusterWindow (the op that produced the 61 coherent sub-clusters), and KEEP-CORE
 * splits them — the LARGEST sub-cluster keeps the event id/slug/URL (durable identity preserved);
 * every other sub-cluster spins off as a new event; non-clustering singletons are dropped.
 *
 * Split-durability (minimal): a coherent (≤MAX_CATS) event is never touched; only a RE-BREACHING
 * event is re-split. No do-not-merge lineage yet — the entity gate is meant to carry most of the
 * load and keep re-accretion rare; this measures whether keep-core + re-split-on-breach is stable.
 *
 * Behind EVENT_BREAKER_ENABLED (default OFF → prod-neutral). Mutates events/event_articles.
 */
import crypto from "crypto";
import { getDb } from "../../models/database.js";
import { clusterWindow } from "../clustering/semanticClusterer.js";
import { logger } from "../../services/logger.js";

const ENABLED   = String(process.env.EVENT_BREAKER_ENABLED ?? "false").toLowerCase() === "true";
// TRIGGER (refined): re-cluster every event with ≥ MIN_ARTICLES members through clusterWindow and
// split ONLY if it yields ≥2 sub-clusters (genuine multi-story over-merge) — NOT >category-count
// (which flags cosine-tight single stories with diverse category tags). clusterWindow is the honest
// arbiter of "is this one story". The size floor bounds the re-cluster cost (tiny events can't blob).
const MIN_ARTICLES = parseInt(process.env.EVENT_BREAKER_MIN_ARTICLES || "6", 10);

function slugify(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 80).replace(/^-+|-+$/g, ""); }
function uniqueSlug(db, base) { let slug = base || crypto.randomUUID().slice(0, 8); let i = 2; while (db.prepare("SELECT 1 FROM events WHERE slug = ?").get(slug)) slug = `${base}-${i++}`; return slug; }
const domCat = (m) => { const c = {}; for (const x of m) c[x.category] = (c[x.category] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || "top"; };

// load-and-cluster lifted from coherenceGuard: window=[min,max published] of the members,
// excludeIds = the window's other is_dup=0 articles → clusterWindow sees exactly the members.
function clusterMembers(db, ids) {
  if (!ids.length) return [];
  const set = new Set(ids), ph = ids.map(() => "?").join(",");
  const span = db.prepare(`SELECT MIN(published_at) lo, MAX(published_at) hi FROM articles WHERE id IN (${ph})`).get(...ids);
  if (span.lo == null) return [];
  const win = db.prepare("SELECT id FROM articles WHERE published_at >= ? AND published_at < ? AND is_duplicate = 0").all(span.lo, span.hi + 1).map(r => r.id);
  return clusterWindow({ db, windowStart: span.lo, windowEnd: span.hi + 1, excludeIds: new Set(win.filter(id => !set.has(id))) }).clusters; // size-desc, size>=2
}

export function runEventBreaker({ now = Date.now(), minArticles = MIN_ARTICLES, force = false } = {}) {
  if (!ENABLED && !force) return { enabled: false };
  const db = getDb();
  const candidates = db.prepare(
    `SELECT ea.event_id id FROM event_articles ea JOIN events e ON e.id = ea.event_id
      WHERE e.status IN ('active','dormant') GROUP BY ea.event_id HAVING COUNT(*) >= ?`
  ).all(minArticles);

  const linkArticle = db.prepare("INSERT OR IGNORE INTO event_articles (event_id, article_id, relevance, added_at) VALUES (?,?,1.0,?)");
  const delLinks = db.prepare("DELETE FROM event_articles WHERE event_id = ?");
  const touchEv = db.prepare("UPDATE events SET last_activity_at = ?, updated_at = ? WHERE id = ?");
  const insEvent = db.prepare(`INSERT INTO events (id, slug, cluster_id, title, summary, category, status, severity, hero_image_url, started_at, last_activity_at, meta, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  let genuineBlobs = 0, created = 0; const splitIds = [];
  for (const b of candidates) {
    const members = db.prepare("SELECT article_id id FROM event_articles WHERE event_id = ?").all(b.id).map(r => r.id);
    const subs = clusterMembers(db, members);
    if (subs.length <= 1) continue; // clusterWindow sees ONE story (coherent / cosine-tight) → leave
    genuineBlobs++; splitIds.push(b.id);
    const apply = db.transaction(() => {
      delLinks.run(b.id);
      for (const m of subs[0].members) linkArticle.run(b.id, m.id, now); // KEEP-CORE: largest keeps the id/slug
      touchEv.run(now, now, b.id);
      for (let i = 1; i < subs.length; i++) {
        const sub = subs[i];
        const id = crypto.randomUUID();
        const slug = uniqueSlug(db, slugify(sub.members[0]?.title) || id.slice(0, 8));
        insEvent.run(id, slug, null, sub.members[0]?.title ?? id.slice(0, 8), null, domCat(sub.members), "active", 0, null, now, now, "{}", now, now);
        for (const m of sub.members) linkArticle.run(id, m.id, now);
        created++;
      }
    });
    apply();
  }
  const stats = { enabled: true, candidates: candidates.length, genuineBlobs, split: genuineBlobs, created, splitIds };
  logger.info?.(`🔪 eventBreaker — ${JSON.stringify({ ...stats, splitIds: splitIds.length })}`);
  return stats;
}
