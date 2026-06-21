/**
 * eventGrouping — DISPLAY-LAYER story consolidation (read-only, stateless). Groups the homepage's
 * prominence-sorted top-N events into one card per story, WITHOUT touching the durable graph.
 *
 * 3b-2 proved entity-overlap can't durably merge a macro-story's facets (oil/nuclear/Hormuz) without
 * blobbing/oscillating. But the facets ARE one story by the trusted arbiter: pooled, they re-cluster
 * to clusterWindow = 1. So consolidate at render — a mis-group is one cosmetic card, never a blob.
 *
 *   PROPOSE  — agglomerate the top-N by centroid cosine ≥ GROUP_TAU (single-linkage).
 *   CONFIRM  — pool each proposed component's articles through clusterWindow (the arbiter). Map each
 *              event to the sub-cluster holding most of its members; events in the SAME sub-cluster
 *              are one story → one card. Distinct same-domain stories land in different sub-clusters
 *              → separate cards. (Per-sub assignment, so a chained foreigner can't fuse a real group.)
 *   EMIT     — head = highest-prominence member; the rest become related[] (each keeps its OWN slug/
 *              dossier). Folded members are removed from the top level (shown only under the head).
 *
 * Behind HOMEPAGE_GROUPING (default OFF → prod-neutral). No DB writes; durable events/dossiers unchanged.
 */
import { clusterWindow } from "../clustering/semanticClusterer.js";

const DIMS = 768;
const ENABLED   = String(process.env.HOMEPAGE_GROUPING ?? "false").toLowerCase() === "true";
const GROUP_TAU = Number.parseFloat(process.env.HOMEPAGE_GROUP_TAU || "0.86");

function loadVecs(db, ids) {
  const m = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const ch = ids.slice(i, i + 500); if (!ch.length) continue;
    const ph = ch.map(() => "?").join(",");
    for (const r of db.prepare(`SELECT m.scope_id id, e.embedding v FROM embedding_meta m JOIN embeddings e ON e.rowid=m.rowid WHERE m.scope='article' AND m.scope_id IN (${ph})`).all(...ch)) {
      const b = r.v, f = new Float32Array(b.buffer, b.byteOffset, b.length / 4), u = new Float64Array(DIMS);
      let n = 0; for (let k = 0; k < DIMS; k++) { u[k] = f[k]; n += f[k] * f[k]; } n = Math.sqrt(n) || 1; for (let k = 0; k < DIMS; k++) u[k] /= n;
      m.set(r.id, u);
    }
  }
  return m;
}
const mean = (vs) => { if (!vs.length) return null; const m = new Float64Array(DIMS); for (const v of vs) for (let k = 0; k < DIMS; k++) m[k] += v[k]; let n = 0; for (let k = 0; k < DIMS; k++) n += m[k] * m[k]; n = Math.sqrt(n) || 1; for (let k = 0; k < DIMS; k++) m[k] /= n; return m; };
const cos = (a, b) => { if (!a || !b) return -1; let s = 0; for (let k = 0; k < DIMS; k++) s += a[k] * b[k]; return s; };
function clusterMembers(db, ids) {
  if (!ids.length) return [];
  const set = new Set(ids), ph = ids.map(() => "?").join(",");
  const sp = db.prepare(`SELECT MIN(published_at) lo, MAX(published_at) hi FROM articles WHERE id IN (${ph})`).get(...ids);
  if (sp.lo == null) return [];
  const win = db.prepare("SELECT id FROM articles WHERE published_at>=? AND published_at<? AND is_duplicate=0").all(sp.lo, sp.hi + 1).map(r => r.id);
  return clusterWindow({ db, windowStart: sp.lo, windowEnd: sp.hi + 1, excludeIds: new Set(win.filter(id => !set.has(id))) }).clusters;
}
const rel = (e) => ({ id: e.id, title: e.title, slug: e.slug, source_count: e.source_count });

/**
 * groupTopEvents(db, events, {tau}) → grouped list (heads with related[], + singletons), prominence-sorted.
 *   events: [{ id, ids:[article_id...], prominence, title, slug, source_count, ... }] sorted by prominence desc.
 *   Returns the same objects with an added related[] (empty for singletons). Folded members removed.
 */
export function groupTopEvents(db, events, { tau = GROUP_TAU } = {}) {
  if (!ENABLED || events.length < 2) return events.map(e => ({ ...e, related: [] }));
  const cen = events.map(e => mean([...loadVecs(db, e.ids).values()]));
  const parent = events.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) if (cos(cen[i], cen[j]) >= tau) parent[find(i)] = find(j);
  const comps = new Map(); events.forEach((_, i) => { const r = find(i); (comps.get(r) ?? comps.set(r, []).get(r)).push(i); });

  const out = [];
  for (const idxs of comps.values()) {
    if (idxs.length === 1) { out.push({ ...events[idxs[0]], related: [] }); continue; }
    const pooled = [...new Set(idxs.flatMap(i => events[i].ids))];
    const subs = clusterMembers(db, pooled);
    if (subs.length <= 1) {
      const ord = [...idxs].sort((a, b) => events[b].prominence - events[a].prominence);
      out.push({ ...events[ord[0]], related: ord.slice(1).map(i => rel(events[i])) });
    } else {
      // assign each event to the sub-cluster holding most of its members (clusterWindow = arbiter)
      const art2sub = new Map(); subs.forEach((s, si) => s.members.forEach(m => art2sub.set(m.id, si)));
      const bySub = new Map();
      for (const i of idxs) {
        const cnt = {}; for (const a of events[i].ids) { const si = art2sub.get(a); if (si != null) cnt[si] = (cnt[si] || 0) + 1; }
        const best = Object.entries(cnt).sort((x, y) => y[1] - x[1])[0];
        const key = best ? best[0] : `solo${i}`;
        (bySub.get(key) ?? bySub.set(key, []).get(key)).push(i);
      }
      for (const g of bySub.values()) { const ord = g.sort((a, b) => events[b].prominence - events[a].prominence); out.push({ ...events[ord[0]], related: ord.slice(1).map(i => rel(events[i])) }); }
    }
  }
  out.sort((a, b) => b.prominence - a.prominence);
  return out;
}
