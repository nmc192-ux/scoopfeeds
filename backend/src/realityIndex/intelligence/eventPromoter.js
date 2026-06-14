/**
 * eventPromoter — promotes story clusters into first-class Event entities with DURABLE
 * cross-refresh identity (Phase 4). Replaces title-hash (cluster_id) identity with a
 * centroid+overlap matcher: each refresh's cluster is matched to an existing developing
 * event by running-centroid cosine (>= MATCH_TAU) OR shared-article overlap, so a story
 * keeps ONE stable event (id + slug frozen) as its anchor title evolves day to day.
 *
 * Matcher (calibrated, Phase 4):
 *   - candidate events: active|dormant, last_activity within CANDIDATE_WINDOW; each carries
 *     a RUNNING centroid = mean of ALL accumulated member vectors (recomputed each run).
 *   - candidacy: cluster↔event qualifies if centroid cosine >= MATCH_TAU (0.78, calibrated)
 *     OR they share >= 1 article id (overlap = strong signal for overlapping windows).
 *   - assignment: greedy 1-to-1 (argmax) — each cluster gets its single best event, each
 *     event one cluster — NOT absorb-all.
 *   - merge: a cluster qualifying against >= 2 existing events is the TRIGGER to consider
 *     convergence, but a pair only merges if its centroids DIRECTLY agree (>= MERGE_TAU,
 *     0.86) — this confirmation gate stops a borderline bridging cluster from chaining
 *     distinct events into a blob (the over-merge cascade). Survivor = earliest started_at;
 *     absorbed events → status 'merged' with meta.merged_into (id+slug) for URL redirects.
 *   - on match: reuse the row (preserve id, slug, started_at); update title to the latest
 *     anchor, accumulate articles, recompute centroid next run, reactivate if dormant.
 *   - on no match: a new event (UUID id, frozen slug) — the implicit "split"/new-story path.
 *
 * Deferred: explicit split (a leftover unmatched cluster already spawns a new event) and
 * the dead 'resolved' state.
 */

import crypto from "crypto";
import { getDb } from "../../models/database.js";
import { logger } from "../../services/logger.js";

const MIN_ARTICLES       = parseInt(process.env.EVENT_MIN_ARTICLES || "5", 10);
const DORMANT_AFTER_MS   = 7 * 24 * 60 * 60 * 1000;
const MATCH_TAU          = Number.parseFloat(process.env.EVENT_MATCH_TAU || "0.78"); // calibrated (cluster↔event)
const MERGE_TAU          = Number.parseFloat(process.env.EVENT_MERGE_TAU || "0.86"); // event↔event DIRECT-similarity gate to confirm a convergence merge — prevents the cascade where a borderline cluster fuses two distinct events into a blob
const CANDIDATE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const DIMS = 768;

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
}

function uniqueSlug(db, base) {
  let slug = base;
  let i = 2;
  while (db.prepare("SELECT 1 FROM events WHERE slug = ?").get(slug)) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

function firstImageFromCluster(db, articleIds) {
  if (!articleIds.length) return null;
  const placeholders = articleIds.map(() => "?").join(",");
  const row = db
    .prepare(`SELECT image_url FROM articles WHERE id IN (${placeholders}) AND image_url IS NOT NULL LIMIT 1`)
    .get(...articleIds);
  return row?.image_url ?? null;
}

function severityFromCluster(cluster, marketCount) {
  const artScore    = Math.min(cluster.article_count / 30, 1) * 0.6;
  const marketScore = Math.min(marketCount / 3, 1) * 0.4;
  return Math.round((artScore + marketScore) * 100) / 100;
}

function summaryFromCluster(cluster) {
  try {
    const briefs = JSON.parse(cluster.brief || "[]");
    return briefs[0]?.text ?? cluster.summary ?? null;
  } catch {
    return cluster.summary ?? null;
  }
}

// ── vector helpers (stored article vectors → centroid) ───────────────────────
function loadArticleVectors(db, ids) {
  const map = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    if (!chunk.length) continue;
    const ph = chunk.map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT m.scope_id AS id, e.embedding AS vec FROM embedding_meta m
       JOIN embeddings e ON e.rowid = m.rowid
       WHERE m.scope = 'article' AND m.scope_id IN (${ph})`
    ).all(...chunk);
    for (const r of rows) {
      const buf = r.vec; const f = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
      const v = new Float64Array(DIMS); let n = 0;
      for (let k = 0; k < DIMS; k++) { v[k] = f[k]; n += f[k] * f[k]; }
      n = Math.sqrt(n) || 1; for (let k = 0; k < DIMS; k++) v[k] /= n;
      map.set(r.id, v);
    }
  }
  return map;
}
function meanCentroid(vecs) {
  if (!vecs.length) return null;
  const m = new Float64Array(DIMS);
  for (const v of vecs) for (let k = 0; k < DIMS; k++) m[k] += v[k];
  let n = 0; for (let k = 0; k < DIMS; k++) n += m[k] * m[k]; n = Math.sqrt(n) || 1;
  for (let k = 0; k < DIMS; k++) m[k] /= n;
  return m;
}
function cosine(a, b) { if (!a || !b) return -1; let s = 0; for (let k = 0; k < DIMS; k++) s += a[k] * b[k]; return s; }

export async function runEventPromoter({ now = Date.now() } = {}) {
  const db = getDb();

  // ── 1. Eligible clusters (>= MIN_ARTICLES OR a bound market) ─────────────────
  const eligible = db.prepare(`
    SELECT sc.*,
           (SELECT COUNT(*) FROM cluster_market_links cml WHERE cml.cluster_id = sc.id) AS market_count
    FROM story_clusters sc
    WHERE sc.article_count >= ?
       OR (SELECT COUNT(*) FROM cluster_market_links cml WHERE cml.cluster_id = sc.id) >= 1
    ORDER BY sc.updated_at DESC
    LIMIT 300
  `).all(MIN_ARTICLES);

  const insertEvent = db.prepare(`
    INSERT INTO events (id, slug, cluster_id, title, summary, category, status, severity,
      hero_image_url, started_at, last_activity_at, meta, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  // Title stability: a 1-to-1 match ALWAYS refreshes activity/severity/hero, but only RENAMES the
  // event when the matching cluster is at least as large as the cluster that currently sources the
  // title (meta.title_cluster_size). A small/diffuse tail can't hijack a durable event's title
  // (e.g. a 6-article markets grab-bag renaming a 60-article Musk-trial event to "Susie Wolff F1").
  const updateKeepTitle = db.prepare(`
    UPDATE events SET summary = COALESCE(?, summary), severity = ?,
      hero_image_url = COALESCE(?, hero_image_url), last_activity_at = ?, updated_at = ?,
      status = CASE WHEN status = 'dormant' THEN 'active' ELSE status END
    WHERE id = ?
  `);
  const updateNewTitle = db.prepare(`
    UPDATE events SET title = ?, summary = COALESCE(?, summary), severity = ?,
      hero_image_url = COALESCE(?, hero_image_url), last_activity_at = ?, updated_at = ?,
      meta = ?, status = CASE WHEN status = 'dormant' THEN 'active' ELSE status END
    WHERE id = ?
  `);
  const markMerged   = db.prepare(`UPDATE events SET status = 'merged', meta = ?, updated_at = ? WHERE id = ?`);
  const linkArticle  = db.prepare(`INSERT OR IGNORE INTO event_articles (event_id, article_id, relevance, added_at) VALUES (?, ?, 1.0, ?)`);
  const linkMarket   = db.prepare(`INSERT OR REPLACE INTO event_market_links (event_id, market_id, weight, rank, matched_at) VALUES (?, ?, ?, ?, ?)`);

  // ── 2. Candidate events with running centroids ──────────────────────────────
  const eventState = new Map(); // id → { id, slug, started_at, status, ids:Set, centroid, titleClusterSize }
  for (const e of db.prepare(
    `SELECT id, slug, started_at, status, meta FROM events WHERE status IN ('active','dormant') AND last_activity_at >= ?`
  ).all(now - CANDIDATE_WINDOW_MS)) {
    const aids = db.prepare("SELECT article_id FROM event_articles WHERE event_id = ?").all(e.id).map(r => r.article_id);
    const vmap = loadArticleVectors(db, aids);
    let titleClusterSize = 0; try { titleClusterSize = JSON.parse(e.meta || "{}").title_cluster_size || 0; } catch { /* default 0 → legacy events rename on first match */ }
    eventState.set(e.id, { id: e.id, slug: e.slug, started_at: e.started_at, status: e.status, ids: new Set(aids), centroid: meanCentroid([...vmap.values()]), titleClusterSize });
  }

  // ── 3. Cluster centroids + article sets ─────────────────────────────────────
  const clusters = eligible.map((c) => {
    let aids = []; try { aids = JSON.parse(c.article_ids || "[]"); } catch { /* skip */ }
    const vmap = loadArticleVectors(db, aids);
    return { c, aids, idSet: new Set(aids), centroid: meanCentroid([...vmap.values()]), market_count: c.market_count };
  });

  const qualifies = (cl, ev) => {
    for (const a of cl.idSet) if (ev.ids.has(a)) return { ok: true, score: Math.max(cosine(cl.centroid, ev.centroid), 1.0) };
    const cos = cosine(cl.centroid, ev.centroid);
    return cos >= MATCH_TAU ? { ok: true, score: cos } : { ok: false };
  };

  // ── 4. MERGE: a cluster qualifying against >=2 events → converge into earliest-started ──
  const parent = new Map();
  const find = (id) => { let r = id; while (parent.has(r)) r = parent.get(r); return r; };
  const merges = [];
  // A cluster matching >=2 events is the TRIGGER to consider convergence; but only merge a
  // pair whose centroids DIRECTLY agree (>= MERGE_TAU). This confirmation gate stops a
  // borderline bridging cluster from chaining distinct events into a blob (the cascade).
  const tryMerge = (aId, bId) => {
    const a = find(aId), b = find(bId);
    if (a === b) return;
    const ea = eventState.get(a), eb = eventState.get(b);
    if (!ea || !eb) return;
    if (cosine(ea.centroid, eb.centroid) < MERGE_TAU) return; // distinct stories — do NOT merge
    const survivor = ea.started_at <= eb.started_at ? a : b;
    const absorbed = survivor === a ? b : a;
    parent.set(absorbed, survivor);
    merges.push({ survivor, absorbed });
  };
  for (const cl of clusters) {
    const evs = [...new Set([...eventState.values()].filter((ev) => qualifies(cl, ev).ok).map((ev) => find(ev.id)))];
    for (let i = 0; i < evs.length; i++) for (let j = i + 1; j < evs.length; j++) tryMerge(evs[i], evs[j]);
  }
  for (const { survivor, absorbed } of merges) {
    const sEv = eventState.get(survivor), aEv = eventState.get(absorbed);
    if (!sEv || !aEv) continue;
    for (const aid of aEv.ids) { linkArticle.run(survivor, aid, now); sEv.ids.add(aid); }
    markMerged.run(JSON.stringify({ merged_into: survivor, merged_into_slug: sEv.slug }), now, absorbed);
    eventState.delete(absorbed);
  }
  for (const { survivor } of merges) {
    const ev = eventState.get(survivor);
    if (ev) ev.centroid = meanCentroid([...loadArticleVectors(db, [...ev.ids]).values()]);
  }

  // ── 5. Greedy 1-to-1 assignment (argmax) ────────────────────────────────────
  const pairs = [];
  clusters.forEach((cl, ci) => { for (const ev of eventState.values()) { const q = qualifies(cl, ev); if (q.ok) pairs.push({ ci, eventId: ev.id, score: q.score }); } });
  pairs.sort((a, b) => b.score - a.score);
  const clusterDone = new Set(), eventTaken = new Set();
  const assignment = new Map();
  for (const p of pairs) {
    if (clusterDone.has(p.ci) || eventTaken.has(p.eventId)) continue;
    assignment.set(p.ci, p.eventId); clusterDone.add(p.ci); eventTaken.add(p.eventId);
  }

  // ── 6. Apply: matched (reuse row) or new event ──────────────────────────────
  let promoted = 0, matched = 0, reactivated = 0;
  clusters.forEach((cl, ci) => {
    try {
      const c = cl.c;
      const severity = severityFromCluster(c, cl.market_count);
      const summary  = summaryFromCluster(c);
      const hero     = firstImageFromCluster(db, cl.aids.slice(0, 10));
      const clusterSize = cl.aids.length;
      let eventId = assignment.get(ci);
      if (eventId) {
        const ev = eventState.get(eventId);
        if (ev && ev.status === "dormant") reactivated++;
        if (clusterSize >= (ev?.titleClusterSize || 0)) {
          // strong continuation → adopt the new anchor title and record its cluster size
          updateNewTitle.run(c.title, summary, severity, hero, now, now,
            JSON.stringify({ title_cluster_size: clusterSize }), eventId); // preserves id, slug, started_at
          if (ev) ev.titleClusterSize = clusterSize;
        } else {
          // small/diffuse tail → keep the durable title, just refresh activity/severity/hero
          updateKeepTitle.run(summary, severity, hero, now, now, eventId);
        }
        matched++;
      } else {
        eventId = crypto.randomUUID();
        const slug = uniqueSlug(db, slugify(c.title) || eventId.slice(0, 8));
        insertEvent.run(eventId, slug, c.id, c.title, summary, c.category, "active", severity, hero, c.created_at, now,
          JSON.stringify({ title_cluster_size: clusterSize }), now, now);
        eventState.set(eventId, { id: eventId, slug, started_at: c.created_at, status: "active", ids: new Set(), centroid: cl.centroid, titleClusterSize: clusterSize });
        promoted++;
      }
      for (const aid of cl.aids) linkArticle.run(eventId, aid, now);
      for (const cm of db.prepare("SELECT * FROM cluster_market_links WHERE cluster_id = ? ORDER BY rank").all(c.id)) {
        linkMarket.run(eventId, cm.market_id, cm.weight, cm.rank, now);
      }
    } catch (err) {
      logger.warn(`eventPromoter: cluster ${cl.c.id} failed — ${err.message}`);
    }
  });

  // ── 7. Demote stale events ──────────────────────────────────────────────────
  const { changes: dormanted } = db.prepare(
    `UPDATE events SET status = 'dormant', updated_at = ? WHERE status = 'active' AND last_activity_at < ?`
  ).run(now, now - DORMANT_AFTER_MS);

  const stats = { eligible: eligible.length, promoted, matched, merged: merges.length, reactivated, dormanted };
  logger.info(`🗂️  eventPromoter done — ${JSON.stringify(stats)}`);
  return stats;
}
