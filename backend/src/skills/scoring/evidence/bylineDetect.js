/**
 * bylineDetect.js — detect a reporter byline in an article page's DOM (B.6.2b-4).
 *
 * Pure function over a linkedom document. Checks byline signals in priority
 * order and returns which matched (for provenance) + the extracted name.
 *
 * Priority (confirmed against real pages — BBC carries its byline in JSON-LD,
 * not meta/class, so JSON-LD is load-bearing here):
 *   1. meta[name="author"]
 *   2. JSON-LD author (schema.org Article/NewsArticle; @graph, arrays, author
 *      as string | {name} | [..]). Organization-typed authors are SKIPPED —
 *      a publisher name ("BBC News") is not a reporter byline (§2.1.c is about
 *      reporters being NAMED).
 *   3. [itemprop="author"] (+ nested [itemprop="name"])
 *   4. [rel="author"]
 *   5. class-based: .byline / .author / address.author / [class*="byline"]
 *
 * Returns { found:boolean, signal:string|null, value?:string }.
 */

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// Walk a parsed JSON-LD value for a person/string author name.
function findLdAuthor(node, depth = 0) {
  if (!node || depth > 5) return null;
  if (Array.isArray(node)) {
    for (const n of node) { const a = findLdAuthor(n, depth + 1); if (a) return a; }
    return null;
  }
  if (typeof node !== "object") return null;

  if (node.author) {
    const a = node.author;
    if (typeof a === "string" && clean(a)) return clean(a);
    if (Array.isArray(a)) {
      for (const x of a) {
        if (typeof x === "string" && clean(x)) return clean(x);
        if (x && typeof x === "object" && x["@type"] !== "Organization" && clean(x.name)) return clean(x.name);
      }
    } else if (a && typeof a === "object" && a["@type"] !== "Organization" && clean(a.name)) {
      return clean(a.name);
    }
  }
  if (node["@graph"]) return findLdAuthor(node["@graph"], depth + 1);
  return null;
}

function jsonLdAuthor(doc) {
  const scripts = doc?.querySelectorAll?.('script[type="application/ld+json"]') || [];
  for (const s of scripts) {
    let data;
    try { data = JSON.parse(s.textContent || "null"); } catch { continue; }
    const a = findLdAuthor(data);
    if (a) return a;
  }
  return null;
}

export function detectByline(doc) {
  // 1. meta[name="author"]
  const metaC = clean(doc?.querySelector?.('meta[name="author"]')?.getAttribute?.("content"));
  if (metaC) return { found: true, signal: "meta-author", value: metaC.slice(0, 80) };

  // 2. JSON-LD author (person)
  const ld = jsonLdAuthor(doc);
  if (ld) return { found: true, signal: "jsonld-author", value: ld.slice(0, 80) };

  // 3. [itemprop="author"]
  const ip = doc?.querySelector?.('[itemprop="author"]');
  if (ip) {
    const nameEl = ip.querySelector?.('[itemprop="name"]');
    const t = clean(nameEl?.textContent || ip.textContent);
    if (t) return { found: true, signal: "itemprop-author", value: t.slice(0, 80) };
  }

  // 4. [rel="author"]
  const relT = clean(doc?.querySelector?.('[rel="author"]')?.textContent);
  if (relT) return { found: true, signal: "rel-author", value: relT.slice(0, 80) };

  // 5. class-based byline
  const clsT = clean(doc?.querySelector?.('.byline, .author, address.author, [class*="byline"]')?.textContent);
  if (clsT) return { found: true, signal: "class-byline", value: clsT.slice(0, 80) };

  return { found: false, signal: null };
}
