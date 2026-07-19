/**
 * eventTimelineLog — A6 v1: the dossier timeline as an EVENT LOG (occurrence-deduped).
 *
 * The stored event_timeline is one row per ARTICLE, so six outlets covering one
 * occurrence produce six rows and the chronology can't be read. This read-layer
 * builder groups an event's articles into OCCURRENCES: near-duplicate articles
 * (centroid-cosine ≥ TAU) that fall within a bounded TIME WINDOW of each other.
 *
 * The time window is load-bearing: plain near-dup clustering chains distinct beats
 * across days (GROUND: 78 articles / 100h collapsed into one lying row). Bounding each
 * occurrence's span to WINDOW_H hours keeps distinct strike rounds / matches separate
 * (GROUND: W=6h separates two same-day strike rounds that W=12h wrongly merged).
 *
 * MECHANICAL ONLY — embedding cosine + timestamp. No LLM, no writes, no graph changes.
 * Presentation/read-layer: how articles bind to events is untouched. Semantic relabelling
 * of beats is deferred to Phase C.
 */

import { getDb } from "../../models/database.js";

const DIMS = 768, H = 3600000;
const TAU      = Number.parseFloat(process.env.EVENT_TL_DEDUP_TAU || "0.88");
const WINDOW_H = Number.parseFloat(process.env.EVENT_TL_DEDUP_WINDOW_H || "6");
// Thin-event guard (GROUND): below this, dedup is a no-op — each article is its own row,
// so a 2-article event never over-collapses two distinct-but-similar pieces into one.
const MIN_DEDUP = parseInt(process.env.EVENT_TL_MIN_DEDUP || "4", 10);
const MAX_OUTLETS = 6; // attribution list cap ("— A, B, C … +N")

function loadEventArticleVectors(db, eventId) {
  const rows = db.prepare(`
    SELECT a.id, a.title, a.url, a.source_name, a.published_at, a.credibility, e.embedding vec
    FROM event_articles ea
    JOIN articles a ON a.id = ea.article_id
    JOIN embedding_meta m ON m.scope = 'article' AND m.scope_id = a.id
    JOIN embeddings e ON e.rowid = m.rowid
    WHERE ea.event_id = ? AND a.is_duplicate = 0 AND a.published_at IS NOT NULL
    ORDER BY a.published_at ASC`).all(eventId);
  return rows.map(r => {
    const f = new Float32Array(r.vec.buffer, r.vec.byteOffset, r.vec.length / 4);
    const v = new Float64Array(DIMS); let n = 0;
    for (let k = 0; k < DIMS; k++) { v[k] = f[k]; n += f[k] * f[k]; }
    n = Math.sqrt(n) || 1;
    for (let k = 0; k < DIMS; k++) v[k] /= n;
    return { id: r.id, title: r.title, url: r.url, source_name: r.source_name, published_at: r.published_at, credibility: r.credibility, vec: v };
  });
}

// Time-bounded centroid-cosine greedy (the semanticClusterer core + a span cap).
// Items MUST be time-sorted ascending. An item joins the best cluster whose centroid
// cosine ≥ tau AND whose earliest member is within windowMs — else it seeds a new one.
function clusterOccurrences(items, tau, windowMs) {
  const cl = [];
  for (const it of items) {
    let best = -1, bestSim = -1;
    for (let c = 0; c < cl.length; c++) {
      const C = cl[c];
      if (windowMs && (it.published_at - C.t0) > windowMs) continue; // span cap
      let s = 0; for (let k = 0; k < DIMS; k++) s += it.vec[k] * C.sum[k];
      s /= (C.norm || 1);
      if (s > bestSim) { bestSim = s; best = c; }
    }
    if (best >= 0 && bestSim >= tau) {
      const C = cl[best];
      for (let k = 0; k < DIMS; k++) C.sum[k] += it.vec[k];
      C.members.push(it);
      let n = 0; for (let k = 0; k < DIMS; k++) n += C.sum[k] * C.sum[k]; C.norm = Math.sqrt(n);
    } else {
      const sum = Float64Array.from(it.vec);
      let n = 0; for (let k = 0; k < DIMS; k++) n += sum[k] * sum[k];
      cl.push({ sum, norm: Math.sqrt(n), members: [it], t0: it.published_at });
    }
  }
  return cl.map(c => c.members);
}

/**
 * Occurrence rows for an event, newest-first. Each row:
 *   { id, ts, headline, url, source_name, outlets[], outlet_count, article_count, is_beat }
 * ts = EARLIEST article time ("when first reported"). headline/url/source = the
 * highest-credibility outlet's article (tie → earliest); url is a real ARTICLE url, so
 * the row links to journalism, not an event slug (no 302). is_beat = multi-outlet
 * occurrence (what happened) vs single-outlet analysis (what someone wrote).
 * `significance` = outlet_count (the ranking signal the shelf uses for its top-N).
 */
export function buildOccurrenceTimeline(eventId, { db = getDb(), tau = TAU, windowH = WINDOW_H } = {}) {
  const items = loadEventArticleVectors(db, eventId);
  if (!items.length) return [];
  const groups = items.length < MIN_DEDUP
    ? items.map(it => [it])                                   // thin-event guard
    : clusterOccurrences(items, tau, windowH * H);
  const rows = groups.map(members => {
    const rep = [...members].sort((a, b) =>
      (b.credibility ?? 0) - (a.credibility ?? 0) || a.published_at - b.published_at)[0];
    const outlets = [...new Set(members.map(m => m.source_name).filter(Boolean))];
    const ts = Math.min(...members.map(m => m.published_at));
    return {
      id: rep.id, ts, headline: rep.title, url: rep.url, source_name: rep.source_name,
      outlets: outlets.slice(0, MAX_OUTLETS), outlet_count: outlets.length,
      article_count: members.length, significance: outlets.length, is_beat: outlets.length >= 2,
    };
  });
  rows.sort((a, b) => b.ts - a.ts);
  return rows;
}
