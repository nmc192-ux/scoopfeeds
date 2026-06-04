/**
 * wikidataClient.js — Wikidata entity resolver for the Source Scoring Service
 * (B.6.2c-1). POLICY-NEUTRAL (like siteFetch): it resolves an outlet to its
 * Wikidata organization entity + ownership, or it honestly DOESN'T — the 2.4.a
 * module (B.6.2c-2) maps the result to evidence status.
 *
 * ★ THE CRUX — a wrong-entity match is a FALSE-EVIDENCED, worse than pending. ★
 * The live probe proved naive resolution fails: name search is ambiguous
 * ("BBC" → a Philippine broadcaster); P856-contains-domain returns a Venezuelan
 * baseball team for bbc.com and a person "Lani Forbes" for forbes.com; even
 * exact host-equality on theguardian.com returns articles, a person, and a
 * database (their official-website URLs ARE guardian.com URLs). So resolution
 * is: loose fast candidate query → STRICT code filter (exact host-equality AND
 * organization/media type) → EXACTLY ONE survivor, else unresolved (never guess).
 *
 * Pipeline (no heavy P856 scan — that timed out 3/4 in the probe):
 *   1. Candidates: wbsearchentities by the editorial domain (and the source
 *      name, if given) — fast, indexed, label/alias search.
 *   2. Claims: a single VALUES-bounded SPARQL over the candidate Q-ids returns
 *      each candidate's official website(s) P856, owner P127, parent P749,
 *      direct P31 labels, and three type flags computed via P31/P279* subclass
 *      walking — isOrg (⊑ organization Q43229), isMedia (⊑ mass media Q11033),
 *      isHuman (P31 human Q5). VALUES-bounded → fast, no scan.
 *   3. Strict filter (code): keep a candidate iff some P856 host EXACTLY equals
 *      the editorial domain AND (isOrg OR isMedia) AND NOT isHuman.
 *
 * The TYPE FILTER is load-bearing (it's what excludes the article / person /
 * database that share the domain). "organization OR mass-media, not human" is a
 * principled, extensible discriminator via P279* subclass walking — NOT a brittle
 * curated Q-id allow-list. If real validation shows a genuine outlet false-pends
 * (its P31 tree reaches neither Q43229 nor Q11033), widen the root set — flagged
 * for review.
 *
 * Ownership depth (ruled): immediate owner (P127) + one parent (P749). No
 * recursive walk to ultimate beneficial owner.
 */

import { fetchJson } from "./httpFetch.js";

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";

// Wikimedia requests a descriptive contact UA. (Carry a real contact in prod.)
export const WIKIMEDIA_UA = "Scoopfeeds-SourceScorer/1.0 (+https://scoopfeeds.com; contact: ops@scoopfeeds.com)";

// P279* roots for the type filter (documented + extensible — the load-bearing discriminator).
const Q_ORGANIZATION = "Q43229";
const Q_MASS_MEDIA = "Q11033";
const Q_HUMAN = "Q5";

const MAX_CANDIDATES = 20;

function normDomain(d) {
  return String(d || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
}
function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}
function qidOf(uri) {
  const m = String(uri || "").match(/(Q\d+)$/);
  return m ? m[1] : null;
}

async function searchEntities(term, ctx) {
  const url = `${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(term)}`
    + `&language=en&format=json&type=item&limit=10&origin=*`;
  const r = await fetchJson(url, { ...ctx, userAgent: ctx.userAgent || WIKIMEDIA_UA });
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, ids: (r.json?.search || []).map((s) => s.id).filter(Boolean) };
}

function buildClaimsQuery(qids) {
  const values = qids.map((q) => `wd:${q}`).join(" ");
  return `SELECT ?item ?itemLabel ?website ?isOrg ?isMedia ?isHuman ?p31Label ?owner ?ownerLabel ?parent ?parentLabel WHERE {
  VALUES ?item { ${values} }
  ?item wdt:P856 ?website.
  OPTIONAL { ?item wdt:P31 ?p31. }
  BIND(EXISTS { ?item wdt:P31/wdt:P279* wd:${Q_ORGANIZATION} } AS ?isOrg)
  BIND(EXISTS { ?item wdt:P31/wdt:P279* wd:${Q_MASS_MEDIA} } AS ?isMedia)
  BIND(EXISTS { ?item wdt:P31 wd:${Q_HUMAN} } AS ?isHuman)
  OPTIONAL { ?item wdt:P127 ?owner. }
  OPTIONAL { ?item wdt:P749 ?parent. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}

async function fetchClaims(qids, ctx) {
  const url = `${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(buildClaimsQuery(qids))}`;
  const r = await fetchJson(url, { ...ctx, userAgent: ctx.userAgent || WIKIMEDIA_UA });
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, rows: r.json?.results?.bindings || [] };
}

// Collapse the SPARQL cross-product rows into one record per entity.
function groupByEntity(rows) {
  const items = new Map();
  for (const b of rows) {
    const qid = qidOf(b.item?.value);
    if (!qid) continue;
    if (!items.has(qid)) {
      items.set(qid, { qid, label: b.itemLabel?.value || qid, hosts: new Set(), types: new Set(), isOrg: false, isMedia: false, isHuman: false, owners: new Map(), parents: new Map() });
    }
    const it = items.get(qid);
    const h = hostOf(b.website?.value);
    if (h) it.hosts.add(h);
    if (b.p31Label?.value) it.types.add(b.p31Label.value);
    if (b.isOrg?.value === "true") it.isOrg = true;
    if (b.isMedia?.value === "true") it.isMedia = true;
    if (b.isHuman?.value === "true") it.isHuman = true;
    const oq = qidOf(b.owner?.value);
    if (oq && !it.owners.has(oq)) it.owners.set(oq, b.ownerLabel?.value || oq);
    const pq = qidOf(b.parent?.value);
    if (pq && !it.parents.has(pq)) it.parents.set(pq, b.parentLabel?.value || pq);
  }
  return [...items.values()];
}

/**
 * resolveOrgByDomain(editorialDomain, ctx) → policy-neutral result:
 *   { resolved:true, entity:{qid,label}, owner:{qid,label}|null, parent:{qid,label}|null, matchedHost, types:[] }
 *   { resolved:false, reason:"no-entity" | "ambiguous" | "query-failed:<kind>" | "no-domain", candidates?:[{qid,label}] }
 *
 * ctx may carry: sourceName (for a name-search fallback), transport (tests),
 * timeoutMs, userAgent.
 */
export async function resolveOrgByDomain(editorialDomain, ctx = {}) {
  const domain = normDomain(editorialDomain);
  if (!domain) return { resolved: false, reason: "no-domain" };

  // 1. Candidate gather — domain + (optional) source name.
  const terms = [domain];
  if (ctx.sourceName) terms.push(ctx.sourceName);
  const candidates = new Set();
  for (const term of terms) {
    const s = await searchEntities(term, ctx);
    if (!s.ok) return { resolved: false, reason: `query-failed:${s.reason}` };
    for (const id of s.ids) candidates.add(id);
    if (candidates.size >= MAX_CANDIDATES) break;
  }
  if (candidates.size === 0) return { resolved: false, reason: "no-entity" };

  // 2. Claims + type flags (VALUES-bounded SPARQL).
  const claims = await fetchClaims([...candidates].slice(0, MAX_CANDIDATES), ctx);
  if (!claims.ok) return { resolved: false, reason: `query-failed:${claims.reason}` };

  // 3. Strict filter: exact host-equality AND (org OR media) AND not human.
  const survivors = groupByEntity(claims.rows).filter(
    (it) => it.hosts.has(domain) && (it.isOrg || it.isMedia) && !it.isHuman,
  );

  if (survivors.length === 0) return { resolved: false, reason: "no-entity" };
  if (survivors.length > 1) {
    return { resolved: false, reason: "ambiguous", candidates: survivors.map((s) => ({ qid: s.qid, label: s.label })) };
  }

  const it = survivors[0];
  const firstOwner = [...it.owners.entries()][0];
  const firstParent = [...it.parents.entries()][0];
  return {
    resolved: true,
    entity: { qid: it.qid, label: it.label },
    owner: firstOwner ? { qid: firstOwner[0], label: firstOwner[1] } : null,
    parent: firstParent ? { qid: firstParent[0], label: firstParent[1] } : null,
    matchedHost: domain,
    types: [...it.types],
  };
}
