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
const DETACH       = String(process.env.EVENT_BREAKER_DETACH ?? "false").toLowerCase() === "true"; // Build B: trim un-clusterable orphan tail from kept events
const MATCH_TAU    = Number.parseFloat(process.env.EVENT_MATCH_TAU || "0.78"); // matcher cosine floor — detach guard (an orphan must be cosine-far AND entity-disjoint)
const MAX_PASSES   = parseInt(process.env.EVENT_BREAKER_MAX_PASSES || "6", 10); // sweep convergence bound (Phase 1 converged in 4)
const DIMS         = 768;

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

// rarity-weighted entity context (idf + cat_span hub exclusion) — shared by the breaker and the detach pass.
function buildEntityCtx(db) {
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
  return { idfMap, catSpanMap, fallbackIdf, entitySet, overlap };
}

// embedding helpers — only used by the detach guard (cosine-far test).
function loadVecs(db, ids) {
  const m = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const ch = ids.slice(i, i + 500); if (!ch.length) continue;
    const ph = ch.map(() => "?").join(",");
    for (const r of db.prepare(`SELECT mt.scope_id id, e.embedding v FROM embedding_meta mt JOIN embeddings e ON e.rowid=mt.rowid WHERE mt.scope='article' AND mt.scope_id IN (${ph})`).all(...ch)) {
      const b = r.v, f = new Float32Array(b.buffer, b.byteOffset, b.length / 4), u = new Float64Array(DIMS);
      let n = 0; for (let k = 0; k < DIMS; k++) { u[k] = f[k]; n += f[k] * f[k]; } n = Math.sqrt(n) || 1; for (let k = 0; k < DIMS; k++) u[k] /= n;
      m.set(r.id, u);
    }
  }
  return m;
}
const meanVec = (vs) => { if (!vs.length) return null; const m = new Float64Array(DIMS); for (const v of vs) for (let k = 0; k < DIMS; k++) m[k] += v[k]; let n = 0; for (let k = 0; k < DIMS; k++) n += m[k] * m[k]; n = Math.sqrt(n) || 1; for (let k = 0; k < DIMS; k++) m[k] /= n; return m; };
const cosVec = (a, b) => { if (!a || !b) return -1; let s = 0; for (let k = 0; k < DIMS; k++) s += a[k] * b[k]; return s; };

export function runEventBreaker({ now = Date.now(), minArticles = MIN_ARTICLES, disjoint = DISJOINT, force = false } = {}) {
  if (!ENABLED && !force) return { enabled: false };
  const db = getDb();
  // rarity weights + category-span (hub exclusion) from entity_idf
  const { entitySet, overlap } = buildEntityCtx(db);

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

/**
 * Build B — singleton-detach. After spin-off, a kept event can carry a tail of UN-CLUSTERABLE orphans
 * (articles with no cosine peer ≥ tau, so clusterWindow never groups them; they inflate the kept event's
 * category span without belonging to its story). Detach an orphan ONLY if it is BOTH (i) entity-disjoint
 * from the kept core (rarity-weighted overlap < disjoint) AND (ii) cosine-far from the kept centroid
 * (cos < MATCH_TAU). The AND is the safety guard: an entity-sparse but cosine-close article (a real facet
 * with few named entities) STAYS. Detached articles are UN-EVENTED (link removed) — not spun into
 * 1-article events; they remain in articles/feeds and the entity gate keeps them from re-merging.
 *
 * Scoped to the events passed in (the kept events the breaker just curated). Conservative: when in doubt, keep.
 */
export function detachOrphans({ eventIds = [], now = Date.now(), disjoint = DISJOINT } = {}) {
  const db = getDb();
  const { entitySet, overlap } = buildEntityCtx(db);
  const memIds = (id) => db.prepare("SELECT article_id id FROM event_articles WHERE event_id = ?").all(id).map(r => r.id);
  const delLink = db.prepare("DELETE FROM event_articles WHERE event_id = ? AND article_id = ?");
  const touchEv = db.prepare("UPDATE events SET last_activity_at = ?, updated_at = ? WHERE id = ?");
  let detached = 0; const touched = [];
  for (const eid of new Set(eventIds)) {
    const members = memIds(eid);
    const subs = clusterMembers(db, members);
    if (!subs.length) continue;                                   // ghost/empty → nothing to clean
    const coreIds = subs[0].members.map(m => m.id);
    const core = entitySet(coreIds);
    const centroid = meanVec([...loadVecs(db, coreIds).values()]);
    if (!centroid) continue;
    const clustered = new Set(subs.flatMap(s => s.members.map(m => m.id))); // anything in a ≥2 sub-cluster is a real thread → never detach
    const orphans = members.filter(m => !clustered.has(m));
    if (!orphans.length) continue;
    const ovec = loadVecs(db, orphans);
    const drop = [];
    for (const a of orphans) {
      if (overlap(entitySet([a]), core) >= disjoint) continue;     // (i) entity-close → keep
      const v = ovec.get(a);
      if (v && cosVec(v, centroid) >= MATCH_TAU) continue;         // (ii) cosine-close → keep
      drop.push(a);
    }
    if (!drop.length) continue;
    const apply = db.transaction(() => { for (const a of drop) delLink.run(eid, a); touchEv.run(now, now, eid); });
    apply();
    detached += drop.length; touched.push({ id: eid, n: drop.length });
  }
  const stats = { detached, touchedEvents: touched.length };
  logger.info?.(`🧹 detachOrphans — ${JSON.stringify(stats)}`);
  return stats;
}

/**
 * Build A — curative SWEEP for the scheduler. Runs the breaker over ALL active durable events (not just
 * those touched this cycle) to CONVERGENCE (bounded by MAX_PASSES) so a pre-existing blob fully dissolves
 * in one enabled cycle rather than lingering partially-split. Then, if EVENT_BREAKER_DETACH is on, trims
 * the un-clusterable orphan tail from the kept events. keep-core preserves event ids/slugs throughout.
 *
 * Behind EVENT_BREAKER_ENABLED (default OFF → scheduler unchanged). force bypasses the flag for harness use.
 */
export function runEventBreakerSweep({ now = Date.now(), maxPasses = MAX_PASSES, force = false } = {}) {
  if (!ENABLED && !force) return { enabled: false };
  let passes = 0, split = 0, created = 0; const keptIds = new Set();
  for (let p = 0; p < maxPasses; p++) {
    const s = runEventBreaker({ now, force: true }); // gated once at the sweep level; force the inner passes
    passes++;
    split += s.split || 0; created += s.created || 0;
    for (const id of (s.splitIds || [])) keptIds.add(id);
    if (!s.split) break; // converged — no event split this pass
  }
  let detached = 0, touchedEvents = 0;
  if (DETACH && keptIds.size) { const d = detachOrphans({ eventIds: [...keptIds], now }); detached = d.detached; touchedEvents = d.touchedEvents; }
  const stats = { enabled: true, passes, split, created, keptEvents: keptIds.size, detached, touchedEvents };
  logger.info?.(`🔁 eventBreakerSweep — ${JSON.stringify(stats)}`);
  return stats;
}
