/**
 * entityExtractor — NER-then-resolve pipeline (entity-matching build, STEP 1).
 *
 * Per article: detect PERSON/ORG/PLACE over title+description+lead with compromise (chosen over a
 * transformer for KVM-2 fit — pure JS, ~2.6ms/article, no model download; QID resolution
 * canonicalizes surface forms downstream so a heavier detector buys little). Resolve unique
 * normalized surfaces to Wikidata QIDs through surface_qid_cache (positive + negative caching,
 * reusing wikidataClient's retry/backoff/UA). Persist to article_entities; mark processed for
 * idempotency. Unresolved mentions are kept by surface form (they still carry matching value).
 *
 * Does NOT touch the matcher. Wired into the enrich batch behind ENTITY_EXTRACTION_ENABLED
 * (default OFF — production unchanged). Nothing reads article_entities until STEP 3.
 */
import nlp from "compromise";
import { getDb } from "../../models/database.js";
import { resolveEntityMention } from "../../skills/scoring/evidence/wikidataClient.js";
import { logger } from "../../services/logger.js";

// Stoplist for the capitalized fallback. Critically, these break a run even when TITLE-CASED
// (headlines capitalize everything), so "Elon Musk Becomes the World's First Trillionaire" yields
// "elon musk" + "trillionaire" — not the merged "elon musk becomes". Covers function words plus
// the common headline fillers/verbs/adjectives that title-case would otherwise glue into a name.
const FALLBACK_STOP = new Set([
  "the","this","that","these","those","there","they","with","from","after","before","while","during","because","however","also","but","and","for","its","his","her","our","your","who","what","when","where","will","would","could","should","have","has","had","are","was","were","been","said","says","news","report","amid","over","into","than","then","some","such","more","most","like","just",
  "monday","tuesday","wednesday","thursday","friday","saturday","sunday","january","february","march","april","june","july","august","september","october","november","december",
  "becomes","become","became","makes","make","made","sets","set","gets","get","got","goes","launches","launch","raises","raise","seeks","seek","appears","appear","brings","bring","leads","lead",
  "world","first","second","third","new","top","big","how","why","amid","despite","ahead","across","amid","key","major","latest","live","update","breaking","exclusive","watch","video","photos",
]);

export function normSurface(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

// fallback proper-noun-run extractor — used only when compromise finds nothing, to lift coverage
// toward ~100% (uses runs of capitalized tokens; POS-free, so cheaper than compromise).
function capitalizedFallback(text) {
  const out = new Map(); let run = [];
  const flush = () => {
    if (run.length) { const surf = run.join(" "); const n = normSurface(surf); if (n.length >= 2 && !FALLBACK_STOP.has(n) && !out.has(n)) out.set(n, { surface: surf.slice(0, 200), surface_norm: n, entity_type: "unknown" }); }
    run = [];
  };
  for (const raw of (text || "").split(/\s+/)) {
    const w = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    const cap = (/^[A-Z][a-z]{2,}/.test(w)) || (/^[A-Z0-9]{2,5}$/.test(w) && /[A-Z]/.test(w));
    if (cap && !FALLBACK_STOP.has(w.toLowerCase())) run.push(w); else flush(); // stoplist breaks the run even when title-cased
  }
  flush();
  return [...out.values()];
}

/** extractArticleEntities({title,description,content}) → [{surface, surface_norm, entity_type}] (deduped by norm) */
export function extractArticleEntities({ title, description, content } = {}) {
  const text = `${title || ""}. ${description || ""} ${(content || "").slice(0, 500)}`;
  const out = new Map();
  const add = (arr, type) => {
    for (const e of arr) { const n = normSurface(e); if (n.length < 2 || /^\d+$/.test(n)) continue; if (!out.has(n)) out.set(n, { surface: String(e).trim().slice(0, 200), surface_norm: n, entity_type: type }); }
  };
  try { const d = nlp(text); add(d.people().out("array"), "person"); add(d.organizations().out("array"), "org"); add(d.places().out("array"), "place"); }
  catch (err) { logger.debug?.(`entityExtractor: compromise failed — ${err.message}`); }
  if (out.size === 0) for (const f of capitalizedFallback(text)) if (!out.has(f.surface_norm)) out.set(f.surface_norm, f);
  return [...out.values()];
}

/**
 * extractWithCandidates(article) → { entities, candidates }
 *   entities   — the step-1 set (compromise; surface-fallback only when compromise is empty). KEPT
 *                as-is — these were never the problem.
 *   candidates — the hardened fallback's MULTI-WORD runs compromise MISSED. The batch keeps each
 *                ONLY if it resolves to a QID (a real canonical name like "Elon Musk"→Q317521),
 *                never as raw surface noise (step-2a: the blunt supplement's unresolved fragments
 *                lowered the floor). This recovers out-of-lexicon names without re-inflating distinct.
 */
export function extractWithCandidates(article = {}) {
  const entities = extractArticleEntities(article);
  const baseKeys = new Set(entities.map((e) => e.surface_norm));
  const { title, description, content } = article;
  const text = `${title || ""}. ${description || ""} ${(content || "").slice(0, 500)}`;
  const candidates = capitalizedFallback(text).filter((f) => f.surface_norm.includes(" ") && !baseKeys.has(f.surface_norm));
  return { entities, candidates };
}

/** resolve a normalized surface via the cache (positive+negative). Returns {qid,label,hit}.
 *  A TRANSIENT resolver failure (network/rate-limit, reported via .error) is NOT cached — caching
 *  it would permanently poison the surface. Only a genuine empty result is negative-cached. */
export async function resolveSurfaceCached(db, surface_norm, ctx = {}) {
  const c = db.prepare("SELECT qid, label FROM surface_qid_cache WHERE surface_norm = ?").get(surface_norm);
  if (c) return { qid: c.qid, label: c.label, hit: true };
  const r = await resolveEntityMention(surface_norm, ctx);
  if (r.error) return { qid: null, label: null, hit: false, transient: true }; // retry next batch; do NOT cache
  const qid = r.qid ?? null, label = r.label ?? null;
  db.prepare("INSERT OR REPLACE INTO surface_qid_cache (surface_norm, qid, label, resolved_at) VALUES (?,?,?,?)")
    .run(surface_norm, qid, label, Date.now());
  return { qid, label, hit: false };
}

// bounded-concurrency map (politeness to Wikidata; cap defaults low for the prod batch)
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

/**
 * runEntityExtractionBatch(opts) — the enrich-batch stage. Idempotent.
 *   limit          — max not-yet-processed articles to process (when articleIds not given)
 *   articleIds     — explicit article set (validation/backfill); still skips already-processed
 *   resolve        — resolve surfaces → QIDs (default true)
 *   concurrency    — Wikidata resolution concurrency (default 3; polite)
 *   resolveMinDf   — only resolve surfaces appearing in ≥ this many articles THIS batch (default 1)
 *   resolveCap     — cap on number of unique surfaces resolved this batch (by descending df; 0 = no cap)
 * Surfaces not resolved (below df / over cap / cache-negative) persist with qid NULL.
 */
export async function runEntityExtractionBatch({ limit = 100, articleIds = null, resolve = true, concurrency = 3, resolveMinDf = 1, resolveCap = 0 } = {}) {
  const db = getDb();
  let rows;
  if (articleIds && articleIds.length) {
    const ph = articleIds.map(() => "?").join(",");
    rows = db.prepare(`SELECT id, title, description, content FROM articles WHERE id IN (${ph}) AND id NOT IN (SELECT article_id FROM article_entity_processed)`).all(...articleIds);
  } else {
    rows = db.prepare(`SELECT id, title, description, content FROM articles WHERE is_duplicate = 0 AND id NOT IN (SELECT article_id FROM article_entity_processed) ORDER BY published_at DESC LIMIT ?`).all(limit);
  }
  const stats = { articles: 0, entities: 0, resolved: 0, surfacesResolved: 0, cacheHits: 0, calls: 0 };
  if (!rows.length) return stats;

  const perArticle = rows.map((a) => { const { entities, candidates } = extractWithCandidates(a); return { a, ents: entities, cands: candidates }; });

  if (resolve) {
    // Resolve base-entity surfaces AND supplement candidates — candidates must be resolved to decide
    // keep/drop (resolve-gated supplement); non-resolving junk negative-caches so it isn't re-queried.
    const df = new Map();
    for (const { ents, cands } of perArticle) for (const e of [...ents, ...cands]) df.set(e.surface_norm, (df.get(e.surface_norm) || 0) + 1);
    let surfaces = [...df.entries()].filter(([, n]) => n >= resolveMinDf).sort((x, y) => y[1] - x[1]).map(([s]) => s);
    if (resolveCap > 0) surfaces = surfaces.slice(0, resolveCap);
    await mapLimit(surfaces, concurrency, async (s) => {
      const r = await resolveSurfaceCached(db, s);
      if (r.hit) stats.cacheHits++; else stats.calls++;
      if (r.qid) stats.surfacesResolved++;
    });
  }

  const insEnt = db.prepare("INSERT OR IGNORE INTO article_entities (article_id, surface, surface_norm, qid, entity_type, label, created_at) VALUES (?,?,?,?,?,?,?)");
  const insProc = db.prepare("INSERT OR IGNORE INTO article_entity_processed (article_id, processed_at, entity_count) VALUES (?,?,?)");
  const cacheGet = db.prepare("SELECT qid, label FROM surface_qid_cache WHERE surface_norm = ?");
  const now = Date.now();
  let suppl = 0;
  const persist = db.transaction(() => {
    for (const { a, ents, cands } of perArticle) {
      const seen = new Set();
      let count = 0;
      for (const e of ents) {
        if (seen.has(e.surface_norm)) continue; seen.add(e.surface_norm);
        const c = resolve ? cacheGet.get(e.surface_norm) : null;
        const qid = c?.qid ?? null, label = c?.label ?? null;
        insEnt.run(a.id, e.surface, e.surface_norm, qid, e.entity_type, label, now);
        if (qid) stats.resolved++;
        stats.entities++; count++;
      }
      // resolve-gated supplement: keep a candidate ONLY if it resolved to a QID (else drop as noise)
      for (const e of cands) {
        if (seen.has(e.surface_norm)) continue;
        const c = resolve ? cacheGet.get(e.surface_norm) : null;
        if (!c?.qid) continue;
        seen.add(e.surface_norm);
        insEnt.run(a.id, e.surface, e.surface_norm, c.qid, e.entity_type, c.label ?? null, now);
        stats.resolved++; stats.entities++; count++; suppl++;
      }
      insProc.run(a.id, now, count);
      stats.articles++;
    }
  });
  persist();
  stats.supplemented = suppl;
  return stats;
}
