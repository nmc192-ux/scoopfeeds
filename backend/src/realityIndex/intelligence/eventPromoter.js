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
// Creation freshness: only clusters upserted within this window may spawn NEW events
// (see the guard in the apply loop). Matching/refresh of existing events is unaffected.
const PROMOTE_MAX_CLUSTER_AGE_MS = Number.parseInt(process.env.EVENT_PROMOTE_MAX_CLUSTER_AGE_MS || String(48 * 60 * 60 * 1000), 10);
// R2a temporal bounds: dormant events inactive beyond this are CLOSED — they can never
// match/absorb again (structurally prevents unbounded accretion; new coverage of the
// same story becomes a new episode-event, chained by the storyline layer in R2b).
const CLOSE_ENABLED  = String(process.env.EVENT_CLOSE_ENABLED ?? "false").toLowerCase() === "true";
const CLOSE_AFTER_MS = Number.parseInt(process.env.EVENT_CLOSE_AFTER_MS || String(21 * 24 * 60 * 60 * 1000), 10);
const DIMS = 768;

// ── Entity gate (step 3) ─────────────────────────────────────────────────────
// Adds a rarity-weighted shared-entity requirement to BOTH match and merge: a pair qualifies only
// if entity overlap ≥ EVENT_ENTITY_MIN AND cosine ≥ the cosine floor. EVENT_ENTITY_MIN = 0 → OFF
// (overlap ≥ 0 is always true) → today's behavior EXACTLY. The cosine floors default to the
// existing MATCH_TAU / MERGE_TAU (relaxation is a step-3b knob). Weights come from entity_idf;
// an empty table degrades to UNWEIGHTED overlap rather than blocking everything.
const ENTITY_MIN          = Number.parseFloat(process.env.EVENT_ENTITY_MIN || "0");
const MATCH_COSINE_FLOOR  = process.env.EVENT_MATCH_COSINE_FLOOR ? Number.parseFloat(process.env.EVENT_MATCH_COSINE_FLOOR) : MATCH_TAU;
const MERGE_COSINE_FLOOR  = process.env.EVENT_MERGE_COSINE_FLOOR ? Number.parseFloat(process.env.EVENT_MERGE_COSINE_FLOOR) : MERGE_TAU;
const ENTITY_TOPK         = parseInt(process.env.EVENT_ENTITY_TOPK || "40", 10);
// 3b-1: an EVENT's matching identity = its CORE entities (shared by ≥ CORE_FRAC of members), not
// the blended union of all members' entities. A coherent event has a strong core; a blob has a
// weak/empty core (no entity spans enough of its disparate stories) → it can't absorb cross-story
// clusters. Swept in the harness.
const CORE_FRAC           = Number.parseFloat(process.env.EVENT_ENTITY_CORE_FRAC || "0.3");
// 3b-1b: exclude category-PROMISCUOUS hub entities (cat_span > MAX_CATSPAN) from cores + overlap.
// Document-rarity (IDF) ≠ discriminativeness — a key spanning many categories bridges distinct
// stories regardless of how rare it is. 999 = no exclusion (default; swept in the harness).
const MAX_CATSPAN         = parseInt(process.env.EVENT_ENTITY_MAX_CATSPAN || "999", 10);

// R2a: persist the event's entity signature (top-K keys + idf) while members are ALIVE —
// articles prune at 7d, so this durable copy is the only identity an event keeps after
// its members age out. Upserted on every match/create; R2b chains storylines from it.
function upsertSignature(db, eventId, keySet, idfMap, fallbackIdf, now) {
  if (!keySet || !keySet.size) return;
  const keys = [...keySet]
    .map((k) => ({ k, idf: idfMap.get(k) ?? fallbackIdf }))
    .sort((a, b) => b.idf - a.idf)
    .slice(0, ENTITY_TOPK);
  db.prepare("INSERT INTO event_entity_signature (event_id, keys, updated_at) VALUES (?,?,?) ON CONFLICT(event_id) DO UPDATE SET keys=excluded.keys, updated_at=excluded.updated_at")
    .run(eventId, JSON.stringify(keys), now);
}

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

// ── entity helpers (step 3) — aggregated canonical-key sets + rarity-weighted overlap ────────
// Key = qid where resolved else surface_norm (article_entities). For large sets, keep the top-K
// most discriminative (highest idf) so a blob can't dilute its own signal. idfMap/fallbackIdf are
// preloaded once per run from entity_idf (fallback = ln(N) for unseen keys; = 1 when the table is
// empty → unweighted, so the gate degrades instead of blocking everything).
function loadEntityKeys(db, ids, idfMap, catSpanMap, topK = ENTITY_TOPK) {
  if (!ids.length) return new Set();
  const keys = new Set();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500); if (!chunk.length) continue;
    const ph = chunk.map(() => "?").join(",");
    for (const r of db.prepare(`SELECT DISTINCT COALESCE(qid, surface_norm) k FROM article_entities WHERE article_id IN (${ph})`).all(...chunk)) {
      if ((catSpanMap.get(r.k) ?? 1) > MAX_CATSPAN) continue; // drop category-promiscuous hubs
      keys.add(r.k);
    }
  }
  if (keys.size <= topK) return keys;
  return new Set([...keys].sort((a, b) => (idfMap.get(b) ?? 0) - (idfMap.get(a) ?? 0)).slice(0, topK));
}
// CORE entity set for an EVENT (3b-1): keys present in ≥ minFrac of the event's member articles —
// the entities members genuinely have IN COMMON. A coherent event → strong core; a blob → weak/empty
// core (no entity spans enough of its stories) → it can't match cross-story clusters against itself.
function loadEventCore(db, ids, idfMap, catSpanMap, minFrac = CORE_FRAC, topK = ENTITY_TOPK) {
  if (!ids.length) return new Set();
  const n = ids.length, count = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500); if (!chunk.length) continue;
    const ph = chunk.map(() => "?").join(",");
    for (const r of db.prepare(`SELECT DISTINCT article_id, COALESCE(qid, surface_norm) k FROM article_entities WHERE article_id IN (${ph})`).all(...chunk)) {
      if ((catSpanMap.get(r.k) ?? 1) > MAX_CATSPAN) continue; // hub entities can't enter a core
      count.set(r.k, (count.get(r.k) || 0) + 1);
    }
  }
  let core = [...count.entries()].filter(([, c]) => c / n >= minFrac).map(([k]) => k);
  if (core.length > topK) core = core.sort((a, b) => (idfMap.get(b) ?? 0) - (idfMap.get(a) ?? 0)).slice(0, topK);
  return new Set(core);
}
function rarityOverlap(A, B, idfMap, fallbackIdf) {
  if (!A || !B || !A.size || !B.size) return 0;
  let inter = 0, uni = 0;
  for (const k of new Set([...A, ...B])) { const w = idfMap.get(k) ?? fallbackIdf; uni += w; if (A.has(k) && B.has(k)) inter += w; }
  return uni ? inter / uni : 0;
}

export async function runEventPromoter({ now = Date.now() } = {}) {
  const db = getDb();

  // Entity gate (step 3): preload the windowed-IDF map once. Empty table → fallbackIdf = 1 so the
  // overlap degrades to UNWEIGHTED rather than blocking every match. Only when the gate is ON.
  let idfMap = new Map(), catSpanMap = new Map(), fallbackIdf = 1;
  if (ENTITY_MIN > 0) {
    for (const r of db.prepare("SELECT key, idf, cat_span FROM entity_idf").all()) { idfMap.set(r.key, r.idf); catSpanMap.set(r.key, r.cat_span); }
    const nw = db.prepare("SELECT n_window FROM entity_idf LIMIT 1").get()?.n_window;
    fallbackIdf = (idfMap.size && nw) ? Math.log(nw) : 1; // unseen key → maximally rare; empty table → unweighted
  }

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
  // Merged tombstones release their cluster_id claim: merged events are excluded from the
  // match-candidate set, so a kept claim permanently squats the title-hash identity — every
  // future recurrence of that anchor title then fails match AND collides on INSERT
  // (UNIQUE events.cluster_id), which is how prod reached promoted=0 / ~290 collisions per
  // cycle. The absorbing survivor owns the story; the tombstone keeps id/slug/dossier only.
  const markMerged   = db.prepare(`UPDATE events SET status = 'merged', cluster_id = NULL, meta = ?, updated_at = ? WHERE id = ?`);
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
    eventState.set(e.id, { id: e.id, slug: e.slug, started_at: e.started_at, status: e.status, ids: new Set(aids), centroid: meanCentroid([...vmap.values()]), core: ENTITY_MIN > 0 ? loadEventCore(db, aids, idfMap, catSpanMap) : null, titleClusterSize });
  }

  // ── 3. Cluster centroids + article sets ─────────────────────────────────────
  const clusters = eligible.map((c) => {
    let aids = []; try { aids = JSON.parse(c.article_ids || "[]"); } catch { /* skip */ }
    const vmap = loadArticleVectors(db, aids);
    return { c, aids, idSet: new Set(aids), centroid: meanCentroid([...vmap.values()]), entKeys: ENTITY_MIN > 0 ? loadEntityKeys(db, aids, idfMap, catSpanMap) : null, market_count: c.market_count };
  });

  // qualifies — entity gate (step 3): every accept path ALSO requires entity overlap ≥ ENTITY_MIN.
  // ENTITY_MIN <= 0 → entityOk always true → today's behavior EXACTLY (shared-article force-match;
  // else cosine ≥ floor). Gating the shared-article path too is the point: a shared article between
  // title-disjoint distinct stories no longer force-merges when their rare entities don't overlap.
  const qualifies = (cl, ev) => {
    const entityOk = ENTITY_MIN <= 0 || rarityOverlap(cl.entKeys, ev.core, idfMap, fallbackIdf) >= ENTITY_MIN; // cluster's full entities vs event's CORE
    const cos = cosine(cl.centroid, ev.centroid);
    for (const a of cl.idSet) if (ev.ids.has(a)) return entityOk ? { ok: true, score: Math.max(cos, 1.0) } : { ok: false };
    return (cos >= MATCH_COSINE_FLOOR && entityOk) ? { ok: true, score: cos } : { ok: false };
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
    if (cosine(ea.centroid, eb.centroid) < MERGE_COSINE_FLOOR) return; // distinct stories — do NOT merge
    if (ENTITY_MIN > 0 && rarityOverlap(ea.core, eb.core, idfMap, fallbackIdf) < ENTITY_MIN) return; // entity gate (step 3) — core↔core
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
    if (ev) { ev.centroid = meanCentroid([...loadArticleVectors(db, [...ev.ids]).values()]); if (ENTITY_MIN > 0) ev.core = loadEventCore(db, [...ev.ids], idfMap, catSpanMap); }
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
  let promoted = 0, matched = 0, reactivated = 0, skippedStale = 0;
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
        if (ENTITY_MIN > 0) upsertSignature(db, eventId, eventState.get(eventId)?.core, idfMap, fallbackIdf, now);
      } else {
        // Freshness guard on CREATION only: promote a new event only from a cluster the
        // analysis layer still asserts (recently upserted). story_clusters accumulates —
        // stale rows linger with old updated_at, and eligibility's market-link path keeps
        // them in the top-300 long after their story ended. Before this guard they merely
        // collided on UNIQUE(cluster_id); with squatted identities now released, promoting
        // them would flood the graph with resurrected stale events. Matching is untouched:
        // a stale cluster can still refresh an existing event, it just can't spawn one.
        if (now - (c.updated_at || 0) > PROMOTE_MAX_CLUSTER_AGE_MS) { skippedStale++; return; }
        eventId = crypto.randomUUID();
        const slug = uniqueSlug(db, slugify(c.title) || eventId.slice(0, 8));
        // Reclaim a squatted cluster_id: if an event still holds this title-hash claim yet was
        // NOT matched above (merged tombstone, hollow event whose members were pruned → empty
        // entity core, aged out of the candidate window, or a gate-rejected distinct story with
        // the same anchor-title hash), transfer the claim — the new event is the CURRENT one for
        // this cluster. The old event keeps its id/slug/dossier; it only loses the pointer.
        // Without this, the INSERT below throws UNIQUE(events.cluster_id) and the cluster can
        // never promote again.
        const squatter = db.prepare("SELECT id, status FROM events WHERE cluster_id = ?").get(c.id);
        // ADOPT, don't steal, when the holder is alive and shares an article with this
        // cluster: those articles were linked to it by a prior cycle, so it IS this
        // cluster's event — the matcher just couldn't see that (e.g. the cluster's
        // articles carry no entity keys, so the entity gate fails even against its own
        // event). Stealing here would spawn a duplicate event EVERY cycle (churn). No
        // over-merge surface: adoption requires already-shared articles, so it can't
        // bridge stories that weren't already linked.
        if (squatter && squatter.status !== "merged" && cl.aids.length) {
          const ph = cl.aids.map(() => "?").join(",");
          const shares = db.prepare(`SELECT 1 FROM event_articles WHERE event_id = ? AND article_id IN (${ph}) LIMIT 1`).get(squatter.id, ...cl.aids);
          if (shares) {
            updateKeepTitle.run(summary, severity, hero, now, now, squatter.id);
            eventId = squatter.id;
            matched++;
            if (ENTITY_MIN > 0) upsertSignature(db, eventId, cl.entKeys, idfMap, fallbackIdf, now); // cluster keys ≈ the adopted event's live identity

            for (const aid of cl.aids) linkArticle.run(eventId, aid, now);
            for (const cm of db.prepare("SELECT * FROM cluster_market_links WHERE cluster_id = ? ORDER BY rank").all(c.id)) {
              linkMarket.run(eventId, cm.market_id, cm.weight, cm.rank, now);
            }
            return;
          }
        }
        if (squatter) db.prepare("UPDATE events SET cluster_id = NULL, updated_at = ? WHERE id = ?").run(now, squatter.id);
        insertEvent.run(eventId, slug, c.id, c.title, summary, c.category, "active", severity, hero, c.created_at, now,
          JSON.stringify({ title_cluster_size: clusterSize }), now, now);
        eventState.set(eventId, { id: eventId, slug, started_at: c.created_at, status: "active", ids: new Set(), centroid: cl.centroid, core: ENTITY_MIN > 0 ? loadEventCore(db, cl.aids, idfMap, catSpanMap) : null, titleClusterSize: clusterSize });
        promoted++;
        if (ENTITY_MIN > 0) upsertSignature(db, eventId, eventState.get(eventId)?.core, idfMap, fallbackIdf, now);
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
  // R2a temporal bounds: dormant → closed after CLOSE_AFTER_MS of inactivity. Closed events
  // are excluded from every consumer (candidates, breaker, crons all filter active/dormant),
  // so an event's lifecycle is now bounded — recurrence becomes a new episode-event (R2b
  // chains episodes into storylines). Flag-gated; OFF = byte-identical behavior.
  let closed = 0;
  if (CLOSE_ENABLED) {
    closed = db.prepare(
      `UPDATE events SET status = 'closed', updated_at = ? WHERE status = 'dormant' AND last_activity_at < ?`
    ).run(now, now - CLOSE_AFTER_MS).changes;
  }

  const stats = { eligible: eligible.length, promoted, matched, merged: merges.length, reactivated, dormanted, closed, skippedStale };
  logger.info(`🗂️  eventPromoter done — ${JSON.stringify(stats)}`);
  return stats;
}
