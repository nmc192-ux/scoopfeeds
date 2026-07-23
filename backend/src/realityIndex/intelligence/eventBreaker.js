/**
 * eventBreaker — curative ENTITY-AWARE circuit-breaker (Path A). Post-promotion janitor.
 *
 * For each event with ≥ MIN_ARTICLES members, re-cluster via the UNMODIFIED clusterWindow. clusterWindow
 * splits BOTH genuine multi-story blobs AND a single macro-story's cosine-separable sub-threads, so a raw
 * "≥2 sub-clusters" trigger over-fragments (it shattered the Iran macro-story into ~16 cards). The fix:
 * spin off a sub-cluster ONLY if storyAffinity calls it FOREIGN relative to the largest sub-cluster's
 * core (the same banded measure the promoter uses) — a genuinely foreign absorbed story. Sub-threads
 * that share the core (the Iran peace-deal/oil/Hormuz/nuclear threads) are KEPT. If nothing is foreign, the event
 * is a coherent macro-story → left whole. KEEP-CORE: the kept group retains the event id/slug/URL.
 *
 * Behind EVENT_BREAKER_ENABLED (default OFF → prod-neutral). Mutates events/event_articles.
 */
import crypto from "crypto";
import { getDb } from "../../models/database.js";
import { clusterWindow } from "../clustering/semanticClusterer.js";
import { logger } from "../../services/logger.js";
import {
  buildAffinityCtx, affinity, BANDS, logDecision,
  MIN_CORE_KEYS, MIN_CORE_IDF,
} from "./storyAffinity.js";

const ENABLED      = String(process.env.EVENT_BREAKER_ENABLED ?? "false").toLowerCase() === "true";
const MIN_ARTICLES = parseInt(process.env.EVENT_BREAKER_MIN_ARTICLES || "6", 10);
const DETACH       = String(process.env.EVENT_BREAKER_DETACH ?? "false").toLowerCase() === "true"; // Build B: trim un-clusterable orphan tail from kept events
const MATCH_TAU    = Number.parseFloat(process.env.EVENT_MATCH_TAU || "0.78"); // matcher cosine floor — detach guard (an orphan must be cosine-far AND entity-disjoint)
const MAX_PASSES   = parseInt(process.env.EVENT_BREAKER_MAX_PASSES || "6", 10); // sweep convergence bound (Phase 1 converged in 4)
// A5 facets (Phase 2 revised design — docs/specs/a5_event_facets_design.md): persist
// RENDER-READY facets behind EVENT_FACETS_PERSIST (default OFF → breaker byte-identical).
// The pipeline runs ONCE per sweep after convergence (runFacetPass), not per breaker pass —
// it does a SECOND clustering at EVENT_FACET_TAU plus tombstone queries, so per-pass would be waste.
const FACETS_PERSIST = String(process.env.EVENT_FACETS_PERSIST ?? "false").toLowerCase() === "true";
// Presentation-only facet clustering tau (spike-picked: mega-events separate into real
// angles at ~0.88; the breaker's SPLIT decision stays on clusterWindow's DEFAULT_TAU 0.78
// and is untouched — zero matcher changes).
const FACET_TAU          = Number.parseFloat(process.env.EVENT_FACET_TAU || "0.88");
const FACET_MIN_ARTICLES = parseInt(process.env.FACET_MIN_ARTICLES || "5", 10);
// A facet holding most of the event is a pseudo-event, not an angle (spike: Iran's 67a
// "Hormuz" tombstone = 52% of members; DrJ calibration: 0.6 missed it, 0.5 kills all
// three motivating cases while every genuine spike angle is ≤34% share).
const FACET_MAX_SHARE    = Number.parseFloat(process.env.FACET_MAX_SHARE || "0.5");
// Member-overlap dedup metric = OVERLAP-OVER-MIN (containment), NOT Jaccard — picked on
// the 07-16 COW member sets: tombstone dups are NESTED accretion stages of one story
// (Graham "dies suddenly" 25a vs "US Senator dies" 15a: jac 0.25 misses, ovmin 0.533
// catches; the must-collapse pairs sat at jac 0.22–0.25 / ovmin 0.5–1.0 while genuine
// distinct angles stayed ≤0.36). Greedy size-desc collapse; tombstone label wins ties.
const FACET_DEDUP_OVMIN  = Number.parseFloat(process.env.FACET_DEDUP_OVMIN || "0.5");
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

export function runEventBreaker({ now = Date.now(), minArticles = MIN_ARTICLES, force = false } = {}) {
  if (!ENABLED && !force) return { enabled: false };
  const db = getDb();

  const candidates = db.prepare(
    `SELECT ea.event_id id FROM event_articles ea JOIN events e ON e.id = ea.event_id
      WHERE e.status IN ('active','dormant') GROUP BY ea.event_id HAVING COUNT(*) >= ?`
  ).all(minArticles);

  const linkArticle = db.prepare("INSERT OR IGNORE INTO event_articles (event_id, article_id, relevance, added_at) VALUES (?,?,1.0,?)");
  const touchEv = db.prepare("UPDATE events SET last_activity_at = ?, updated_at = ? WHERE id = ?");
  const insEvent = db.prepare(`INSERT INTO events (id, slug, cluster_id, title, summary, category, status, severity, hero_image_url, started_at, last_activity_at, meta, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  // The spin decision comes from the SAME banded measure the promoter uses — a
  // sub-cluster spins off only when FOREIGN (AMBIGUOUS holds; hysteresis is the
  // armistice). The apply is SURGICAL: only spun members' links are removed — kept
  // links keep their added_at (the old delete-all-and-relink stamped every link with
  // "now" each split, destroying the provenance the 2026-07 diagnosis depended on).
  const affCtx = buildAffinityCtx(db);
  const delLink = db.prepare("DELETE FROM event_articles WHERE event_id = ? AND article_id = ?");

  let split = 0, created = 0, foreignSpun = 0; const splitIds = [];
  for (const b of candidates) {
    const members = db.prepare("SELECT article_id id FROM event_articles WHERE event_id = ?").all(b.id).map(r => r.id);
    const subs = clusterMembers(db, members);
    if (subs.length <= 1) continue; // one story
    const anchorIds = subs[0].members.map(m => m.id);
    const core = affCtx.entitySet(anchorIds);
    const spin = []; // FOREIGN sub-clusters (genuinely absorbed foreign stories)
    for (let i = 1; i < subs.length; i++) {
      const subIds = subs[i].members.map(m => m.id);
      const { ent, band } = affinity(affCtx, affCtx.entitySet(subIds), core);
      if (band === BANDS.FOREIGN) { spin.push(subs[i]); }
      else logDecision("breaker-keep", { event: b.id.slice(0, 8), sub: i, subSize: subIds.length, band, ent: +ent.toFixed(3) });
    }
    if (!spin.length) continue; // macro-story with sub-threads only → leave whole (the over-fragmentation fix)
    const spinMembers = new Set(spin.flatMap(s => s.members.map(m => m.id)));
    splitIds.push(b.id); split++;
    const apply = db.transaction(() => {
      for (const m of spinMembers) delLink.run(b.id, m); // surgical: kept links untouched
      touchEv.run(now, now, b.id);
      for (const sub of spin) {
        const id = crypto.randomUUID();
        const slug = uniqueSlug(db, slugify(sub.members[0]?.title) || id.slice(0, 8));
        insEvent.run(id, slug, null, sub.members[0]?.title ?? id.slice(0, 8), null, domCat(sub.members), "active", 0, null, now, now, "{}", now, now);
        for (const m of sub.members) linkArticle.run(id, m.id, now);
        created++; foreignSpun++;
        logDecision("breaker-split", { event: b.id.slice(0, 8), spunSlug: slug.slice(0, 44), spunSize: sub.members.length, band: BANDS.FOREIGN });
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
 * category span without belonging to its story). Detach an orphan ONLY if it is BOTH (i) FOREIGN to
 * the kept core under storyAffinity AND (ii) cosine-far from the kept centroid
 * (cos < MATCH_TAU). The AND is the safety guard: an entity-sparse but cosine-close article (a real facet
 * with few named entities) STAYS. Detached articles are UN-EVENTED (link removed) — not spun into
 * 1-article events; they remain in articles/feeds and the entity gate keeps them from re-merging.
 *
 * Scoped to the events passed in (the kept events the breaker just curated). Conservative: when in doubt, keep.
 */
export function detachOrphans({ eventIds = [], now = Date.now() } = {}) {
  const db = getDb();
  const affCtx = buildAffinityCtx(db);
  const memIds = (id) => db.prepare("SELECT article_id id FROM event_articles WHERE event_id = ?").all(id).map(r => r.id);
  const delLink = db.prepare("DELETE FROM event_articles WHERE event_id = ? AND article_id = ?");
  const touchEv = db.prepare("UPDATE events SET last_activity_at = ?, updated_at = ? WHERE id = ?");
  let detached = 0; const touched = [];
  for (const eid of new Set(eventIds)) {
    const members = memIds(eid);
    const subs = clusterMembers(db, members);
    if (!subs.length) continue;                                   // ghost/empty → nothing to clean
    const coreIds = subs[0].members.map(m => m.id);
    const coreSet = affCtx.entitySet(coreIds);                    // hoisted: was recomputed per orphan
    const centroid = meanVec([...loadVecs(db, coreIds).values()]);
    if (!centroid) continue;
    const clustered = new Set(subs.flatMap(s => s.members.map(m => m.id))); // anything in a ≥2 sub-cluster is a real thread → never detach
    const orphans = members.filter(m => !clustered.has(m));
    if (!orphans.length) continue;
    const ovec = loadVecs(db, orphans);
    const drop = [];
    for (const a of orphans) {
      // Detach only what the unified measure calls FOREIGN...
      const { band } = affinity(affCtx, affCtx.entitySet([a]), coreSet);
      if (band !== BANDS.FOREIGN) continue;                        // (i) not foreign → keep
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

// ═══ A5 facets — Phase 2 revised pipeline (presentation/persistence only) ═══════════
// Dual source per event: (A) merged tombstones — each keeps its event_articles, so a
// tombstone is a labeled article-subset of its survivor (covers the accreted PAST);
// (B) sub-clusters at FACET_TAU (covers the FUTURE — post-Wave-1 merges mint few
// tombstones). Gate (size / share / coherent core) → member-overlap dedup → hybrid
// mechanical labels. Only RENDER-READY facets are persisted; the shelf reads them dumb.

function clusterMembersAt(db, ids, tau) {
  if (!ids.length) return [];
  const set = new Set(ids), ph = ids.map(() => "?").join(",");
  const span = db.prepare(`SELECT MIN(published_at) lo, MAX(published_at) hi FROM articles WHERE id IN (${ph})`).get(...ids);
  if (span.lo == null) return [];
  const win = db.prepare("SELECT id FROM articles WHERE published_at >= ? AND published_at < ? AND is_duplicate = 0").all(span.lo, span.hi + 1).map(r => r.id);
  return clusterWindow({ db, windowStart: span.lo, windowEnd: span.hi + 1, tau, guardTau: Math.max(tau, 0.84), excludeIds: new Set(win.filter(id => !set.has(id))) }).clusters;
}

// Display name per canonical entity key: Wikidata label when resolved, else the most
// common raw surface. One query per event, reused for all its facets.
function facetDisplayNames(db, ids) {
  const names = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const ch = ids.slice(i, i + 500); if (!ch.length) continue;
    const ph = ch.map(() => "?").join(",");
    for (const r of db.prepare(`SELECT COALESCE(qid, surface_norm) k, COALESCE(label, surface) name, COUNT(*) c
      FROM article_entities WHERE article_id IN (${ph}) GROUP BY k, name ORDER BY c`).all(...ch)) {
      names.set(r.k, r.name); // last row per key = most common
    }
  }
  return names;
}

// ENT eyebrow: top-2 DISTINCTIVE core entities (facet-unique keys rank before
// event-shared ones, idf desc). Variant-dedup ("Graham" vs "Lindsey Graham" → one)
// + per-part length cap (kills the sentence-length Wikidata surfaces the spike hit).
const FACET_LABEL_PART_MAX = 28;
function facetEntityLabel(coreKeys, eventTopCore, names, idfMap) {
  const ranked = [...coreKeys].sort((a, b) => {
    const da = eventTopCore.has(a) ? 0 : 1, dbn = eventTopCore.has(b) ? 0 : 1;
    if (da !== dbn) return dbn - da;
    return (idfMap.get(b) ?? 0) - (idfMap.get(a) ?? 0);
  });
  const parts = [];
  for (const k of ranked) {
    const n = names.get(k); if (!n || n.length > FACET_LABEL_PART_MAX) continue;
    const ln = n.toLowerCase();
    if (parts.some(p => { const lp = p.toLowerCase(); return lp.includes(ln) || ln.includes(lp); })) continue;
    parts.push(n);
    if (parts.length >= 2) break;
  }
  return parts.join(" · ") || null;
}

// Entity-sanity check for the primary label: a candidate headline must mention at least
// one entity its member articles actually carry, else the title lies about the members
// (the spike's Graham tombstone titled "Hormuz Route Open…" whose members were all
// Graham articles). Checked against the members' UNFILTERED entity surfaces — hubs
// ("Iran", "Ukraine") are excluded from cores to stop cross-story bridging, but they are
// perfectly good evidence that a headline describes these articles. Token-prefix match
// (≥4 chars) so "Zelensky" in a headline matches the entity "Volodymyr Zelenskyy".
function facetSanityNames(db, ids) {
  const out = new Set();
  for (let i = 0; i < ids.length; i += 500) {
    const ch = ids.slice(i, i + 500); if (!ch.length) continue;
    const ph = ch.map(() => "?").join(",");
    for (const r of db.prepare(`SELECT DISTINCT COALESCE(label, surface) n FROM article_entities WHERE article_id IN (${ph})`).all(...ch)) {
      if (r.n) out.add(r.n.toLowerCase());
    }
  }
  return out;
}
function facetLabelSane(label, sanityNames) {
  const labelToks = String(label || "").toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4);
  if (!labelToks.length) return false;
  for (const name of sanityNames) {
    for (const et of name.split(/[^a-z0-9]+/)) {
      if (et.length < 4) continue;
      for (const lt of labelToks) {
        if (lt.startsWith(et.slice(0, 4)) && (lt.startsWith(et) || et.startsWith(lt))) return true;
      }
    }
  }
  return false;
}

/**
 * Compute RENDER-READY facets for one event. Pure compute (no writes) so harnesses can
 * run it read-only. ev = { id, slug, title }. Returns [] when nothing qualifies —
 * partial coverage is the accepted A3 stance (absent ≠ broken).
 */
export function computeEventFacets(db, affCtx, ev, now = Date.now()) {
  const memberIds = db.prepare("SELECT article_id id FROM event_articles WHERE event_id = ?").all(ev.id).map(r => r.id);
  const total = memberIds.length;
  const minTotal = Math.ceil(FACET_MIN_ARTICLES / FACET_MAX_SHARE); // below this no facet can pass both size + share
  if (total < minTotal) return [];
  const live = new Set(memberIds);
  const baseSlug  = (s) => String(s || "").replace(/-\d+$/, "");
  const normTitle = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  // ── candidates: Source B (fine-tau sub-clusters) ──
  const candidates = [];
  for (const s of clusterMembersAt(db, memberIds, FACET_TAU)) {
    const rep = s.members.reduce((a, m) => ((m.credibility ?? 0) > (a.credibility ?? 0) ? m : a), s.members[0]);
    candidates.push({ source: "tau", ids: s.members.map(m => m.id), sources: s.sources, labelCand: (rep?.title || "").trim() });
  }
  // ── shared gate: size, share (pseudo-event cap), coherent hub-filtered core ──
  const maxSize = Math.floor(total * FACET_MAX_SHARE);
  const gateEval = (ids) => {
    if (ids.length < FACET_MIN_ARTICLES || ids.length > maxSize) return null;
    const core = affCtx.coreSet(ids);
    if (core.size < MIN_CORE_KEYS) return null;
    let mass = 0; for (const k of core) mass += affCtx.idfMap.get(k) ?? affCtx.fallbackIdf;
    if (mass < MIN_CORE_IDF) return null;
    return { core, mass };
  };

  // ── candidates: Source A (tombstones), sibling-guard dedup within the source ──
  // 2a churn minted MANY tombstone instances per story (same/near-same title at
  // different accretion stages). Per title/slug family keep the LARGEST instance that
  // PASSES THE FULL GATE — larger stages are progressively contaminated (COW check:
  // the 25a "trade fire" instance has an EMPTY core; the coherent one is 8a), and
  // first-seen order is arbitrary, so either naive pick silently kills real angles.
  const selfSlug = baseSlug(ev.slug), selfTitle = normTitle(ev.title);
  const tombFamilies = new Map(); // family key → [{title, ids}] all instances
  for (const t of db.prepare(`SELECT id, slug, title FROM events WHERE status='merged' AND json_extract(meta,'$.merged_into') = ?`).all(ev.id)) {
    const bs = baseSlug(t.slug), nt = normTitle(t.title);
    if (bs === selfSlug || (nt && nt === selfTitle)) continue; // duplicate of the event itself
    const ids = db.prepare("SELECT article_id id FROM event_articles WHERE event_id = ?").all(t.id).map(r => r.id).filter(a => live.has(a));
    if (ids.length < FACET_MIN_ARTICLES) continue;
    const key = nt || bs;
    if (!tombFamilies.has(key)) tombFamilies.set(key, []);
    tombFamilies.get(key).push({ title: (t.title || "").trim(), ids });
  }
  for (const insts of tombFamilies.values()) {
    insts.sort((a, b) => b.ids.length - a.ids.length);
    for (const inst of insts) {                       // largest-first, first gate-passer wins
      const g = gateEval(inst.ids);
      if (g) { candidates.push({ source: "tombstone", ids: inst.ids, sources: null, labelCand: inst.title, pregated: g }); break; }
    }
  }

  // ── gate the remaining (tau) candidates; tombstone picks arrive pre-gated ──
  const gated = [];
  for (const c of candidates) {
    const g = c.pregated ?? gateEval(c.ids);
    if (!g) continue;
    gated.push({ ...c, core: g.core, coreIdfMass: g.mass, idSet: new Set(c.ids) });
  }

  // ── dedup: greedy size-desc (tombstone label wins ties), overlap-over-min ≥ threshold collapses ──
  gated.sort((a, b) => b.ids.length - a.ids.length || (a.source === "tombstone" ? -1 : 1));
  const kept = [];
  for (const c of gated) {
    let dup = false;
    for (const k of kept) {
      let inter = 0; for (const x of c.idSet) if (k.idSet.has(x)) inter++;
      if (inter / Math.min(c.idSet.size, k.idSet.size) >= FACET_DEDUP_OVMIN) { dup = true; break; }
    }
    if (!dup) kept.push(c);
  }
  if (!kept.length) return [];

  // ── labels (mechanical, no LLM): headline primary w/ entity-sanity fallback; ENT eyebrow ──
  const names = facetDisplayNames(db, memberIds);
  const eventTopCore = affCtx.entitySet(memberIds);
  const rows = kept.map((c) => {
    const entLabel = facetEntityLabel(c.core, eventTopCore, names, affCtx.idfMap);
    const sane = facetLabelSane(c.labelCand, facetSanityNames(db, c.ids));
    const primary = sane ? c.labelCand : (entLabel || c.labelCand);
    const sources = c.sources ?? db.prepare(`SELECT COUNT(DISTINCT source_name) n FROM articles WHERE id IN (${c.ids.map(() => "?").join(",")}) AND source_name IS NOT NULL AND source_name <> ''`).get(...c.ids).n;
    const keys = [...c.core].sort();
    const facetKey = crypto.createHash("sha1").update(keys.join("|")).digest("hex").slice(0, 16);
    const facetId = crypto.createHash("sha1").update(ev.id + "|" + facetKey).digest("hex").slice(0, 20);
    return {
      facetId, facetKey, source: c.source, size: c.ids.length, sources,
      share: +(c.ids.length / total).toFixed(3), coreKeys: keys, coreIdfMass: +c.coreIdfMass.toFixed(2),
      label: primary.slice(0, 200),
      // eyebrow is redundant when the primary already IS the entity label (fallback case)
      labelEntity: entLabel && entLabel !== primary ? entLabel : null,
      memberIds: c.ids,
    };
  });
  // Final display-level collapse: a tau sub and a tombstone of ONE thread can both
  // survive when their member sets diverged below the ovmin bar (different accretion
  // stages). Two signals identify them as the same thread: identical primary label, or
  // identical ENT eyebrow (same top-2 distinctive core entities — the COW's dup case
  // was two Sinner/Zverev cards with the same eyebrow). Keep the largest per key.
  const seen = new Map();
  for (const r of rows.sort((a, b) => b.size - a.size)) {
    const keys = [r.label.toLowerCase()];
    if (r.labelEntity) keys.push("e:" + r.labelEntity.toLowerCase());
    if (keys.some(k => seen.has(k))) continue;
    for (const k of keys) seen.set(k, r);
  }
  return [...new Set(seen.values())].sort((a, b) => b.size - a.size);
}

// UPSERT render-ready rows (stable facet_id → members ACCUMULATE across sweeps), then
// prune rows for this event NOT seen this sweep — the table mirrors current
// qualification, so the shelf never renders a facet that stopped earning its slot.
export function persistFacetRows(db, eventId, rows, now) {
  const upsert = db.prepare(`
    INSERT INTO event_facets (facet_id, event_id, facet_key, is_anchor, size, sources, ent, band, core_keys, label, created_at, updated_at, last_seen_at, source, label_entity, core_idf_mass, share)
    VALUES (?,?,?,0,?,?,NULL,NULL,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(facet_id) DO UPDATE SET
      size=excluded.size, sources=excluded.sources, core_keys=excluded.core_keys, label=excluded.label,
      updated_at=excluded.updated_at, last_seen_at=excluded.last_seen_at, source=excluded.source,
      label_entity=excluded.label_entity, core_idf_mass=excluded.core_idf_mass, share=excluded.share`);
  const link = db.prepare("INSERT OR IGNORE INTO event_facet_articles (facet_id, article_id, added_at) VALUES (?,?,?)");
  const tx = db.transaction(() => {
    for (const r of rows) {
      upsert.run(r.facetId, eventId, r.facetKey, r.size, r.sources, JSON.stringify(r.coreKeys), r.label, now, now, now, r.source, r.labelEntity, r.coreIdfMass, r.share);
      for (const a of r.memberIds) link.run(r.facetId, a, now);
    }
    db.prepare("DELETE FROM event_facet_articles WHERE facet_id IN (SELECT facet_id FROM event_facets WHERE event_id = ? AND last_seen_at < ?)").run(eventId, now);
    db.prepare("DELETE FROM event_facets WHERE event_id = ? AND last_seen_at < ?").run(eventId, now);
  });
  tx();
}

/** One facet pass over all candidate events. Called after sweep convergence. */
export function runFacetPass({ now = Date.now(), force = false } = {}) {
  if (!FACETS_PERSIST && !force) return { enabled: false };
  const db = getDb();
  const affCtx = buildAffinityCtx(db);
  const minTotal = Math.ceil(FACET_MIN_ARTICLES / FACET_MAX_SHARE);
  const candidates = db.prepare(`
    SELECT e.id, e.slug, e.title FROM events e JOIN event_articles ea ON ea.event_id = e.id
    WHERE e.status IN ('active','dormant') GROUP BY e.id HAVING COUNT(*) >= ?`).all(minTotal);
  let facets = 0, eventsWith = 0, tomb = 0;
  for (const ev of candidates) {
    try {
      const rows = computeEventFacets(db, affCtx, ev, now);
      persistFacetRows(db, ev.id, rows, now);
      if (rows.length) { eventsWith++; facets += rows.length; tomb += rows.filter(r => r.source === "tombstone").length; }
    } catch (e) { logger.warn(`facet pass failed for ${ev.slug}: ${e.message}`); }
  }
  const stats = { enabled: true, candidates: candidates.length, eventsWithFacets: eventsWith, facets, tombstoneSourced: tomb, tau: FACET_TAU };
  logDecision("facet-pass", stats);
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
  // A5 facets: ONE render-ready facet pass after the graph settles (post-convergence,
  // post-detach). Flag-gated inside; presentation/persistence only.
  let facetStats = null;
  if (FACETS_PERSIST) {
    try { facetStats = runFacetPass({ now }); }
    catch (e) { logger.warn(`facet pass failed: ${e.message}`); }
  }
  const stats = { enabled: true, passes, split, created, keptEvents: keptIds.size, detached, touchedEvents, facets: facetStats?.facets ?? 0 };
  logger.info?.(`🔁 eventBreakerSweep — ${JSON.stringify(stats)}`);
  return stats;
}
