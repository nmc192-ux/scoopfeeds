/**
 * semanticClusterer — production semantic clustering over STORED article-vectors.
 *
 * Greedy centroid-cosine grouping at TAU (validated in #119: TAU=0.78 → ~48% grouped,
 * top multi-source stories consolidated), plus a MERGE GUARD (validated in _merge_eval):
 * re-cluster each formed cluster's members at GUARD_TAU=0.84; if that yields ≥2
 * sub-clusters of ≥2, the cluster was a topical mega-merge → replace it with those
 * sub-clusters (its loose tail drops to singletons). A genuine single story yields one
 * dominant sub at 0.84 and survives unchanged.
 *
 * Pure: reads the DB (articles + vec0 embeddings), returns clusters; writes NOTHING and
 * is NOT wired into clusterRecentArticles / the pipeline. Requires sqlite-vec loaded
 * (initRealityIndex) to read the vec0 `embeddings` table.
 */
import { getDb } from "../../models/database.js";

export const DEFAULT_TAU = 0.78;
export const GUARD_TAU = 0.84;
const DIMS = 768;

/** Load window articles (full fields the persist/brief layer needs) + their stored
 *  unit-vectors, in the #119 order (cred desc, pub desc). `excludeIds` (e.g. recurring
 *  templates) are skipped pre-clustering. */
export function loadWindowVectors({ db = getDb(), windowStart, windowEnd, excludeIds = null }) {
  const rows = db.prepare(
    `SELECT a.id, a.title, a.description, a.url, a.source_name, a.category,
            a.published_at, a.credibility, a.image_url, e.embedding AS vec
       FROM articles a
       JOIN embedding_meta m ON m.scope = 'article' AND m.scope_id = a.id
       JOIN embeddings     e ON e.rowid = m.rowid
      WHERE a.published_at >= ? AND a.published_at < ? AND a.is_duplicate = 0
      ORDER BY a.credibility DESC, a.published_at DESC`
  ).all(windowStart, windowEnd);
  const out = [];
  for (const r of rows) {
    if (excludeIds && excludeIds.has(r.id)) continue;
    const buf = r.vec; // Uint8Array, 768*4 bytes (Float32 LE)
    const f = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
    const v = new Float64Array(DIMS);
    let n = 0;
    for (let k = 0; k < DIMS; k++) { v[k] = f[k]; n += f[k] * f[k]; }
    n = Math.sqrt(n) || 1;            // normalize → cosine = dot (bge is already ~unit)
    for (let k = 0; k < DIMS; k++) v[k] /= n;
    out.push({ id: r.id, title: r.title, description: r.description, url: r.url, source_name: r.source_name, category: r.category, published_at: r.published_at, credibility: r.credibility, image_url: r.image_url, vec: v });
  }
  return out;
}

/** Greedy centroid-cosine clustering: each item joins the first cluster whose centroid
 *  cosine ≥ tau (centroid updated on join), else starts a new cluster. Order-dependent. */
function greedy(items, tau) {
  const cl = []; // { sum: Float64Array, norm, members: [item] }
  for (const it of items) {
    const v = it.vec;
    let best = -1, bestSim = -1;
    for (let c = 0; c < cl.length; c++) {
      const C = cl[c];
      let s = 0; for (let k = 0; k < DIMS; k++) s += v[k] * C.sum[k];
      s /= (C.norm || 1);
      if (s > bestSim) { bestSim = s; best = c; }
    }
    if (best >= 0 && bestSim >= tau) {
      const C = cl[best];
      for (let k = 0; k < DIMS; k++) C.sum[k] += v[k];
      C.members.push(it);
      let n = 0; for (let k = 0; k < DIMS; k++) n += C.sum[k] * C.sum[k]; C.norm = Math.sqrt(n);
    } else {
      const sum = Float64Array.from(v);
      let n = 0; for (let k = 0; k < DIMS; k++) n += sum[k] * sum[k];
      cl.push({ sum, norm: Math.sqrt(n), members: [it] });
    }
  }
  return cl;
}

const summarize = (groups, minSize) => {
  const cs = groups.filter((g) => g.length >= minSize)
    .map((m) => ({ members: m.map(({ vec, ...rest }) => rest), size: m.length, sources: new Set(m.map((x) => x.source_name)).size }))
    .sort((a, b) => b.size - a.size);
  const grouped = cs.reduce((s, c) => s + c.size, 0);
  return { clusters: cs, count: cs.length, multiSource: cs.filter((c) => c.sources >= 2).length, grouped };
};

/**
 * clusterWindow → { items, raw, rawStats, clusters, stats, guardSplits }
 *   raw      = clusters before the guard (the #119-comparable view)
 *   clusters = clusters after the merge guard (the production output)
 */
export function clusterWindow({ db = getDb(), windowStart, windowEnd, tau = DEFAULT_TAU, guardTau = GUARD_TAU, minSize = 2, excludeIds = null } = {}) {
  const items = loadWindowVectors({ db, windowStart, windowEnd, excludeIds });

  // 1) raw greedy clustering at TAU
  const rawGroups = greedy(items, tau).map((c) => c.members);
  const rawS = summarize(rawGroups, minSize);

  // 2) merge guard: re-cluster each formed cluster's members at guardTau
  let guardSplits = 0;
  const guarded = [];
  for (const members of rawGroups) {
    if (members.length < minSize) continue;
    const subs = greedy(members, guardTau).map((s) => s.members).filter((m) => m.length >= minSize);
    if (subs.length >= 2) { guardSplits++; for (const s of subs) guarded.push(s); } // mega-merge → split
    else guarded.push(members);                                                     // real story → survives
  }
  const finalS = summarize(guarded, minSize);

  const pct = (g) => (items.length ? g / items.length : 0);
  return {
    items,
    raw: rawS.clusters,
    rawStats: { windowArticles: items.length, clusters: rawS.count, multiSource: rawS.multiSource, grouped: rawS.grouped, groupedPct: pct(rawS.grouped) },
    clusters: finalS.clusters,
    stats: { windowArticles: items.length, clusters: finalS.count, multiSource: finalS.multiSource, grouped: finalS.grouped, groupedPct: pct(finalS.grouped), guardSplits },
  };
}
