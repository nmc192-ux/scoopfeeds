/**
 * primaryLinkClassify.js — the link-classification crux for 2.2.b (B.6.2d).
 *
 * Pure + unit-testable: no fetch, no DB, no clock. The 2.2.b module
 * (primaryLinks_2_2_b.js) feeds it fetched article docs and counts per-article
 * primary-link presence; everything fetch-shaped lives there.
 *
 * ★ THE CRUX — breadth is the whole risk (Q1, ruled). ★
 * The live probe (B.6.2d investigation) scored Ars Technica — a HEAVY primary
 * linker — at ZERO under a narrow draft set, because it cited `dx.doi.org`
 * (≠ the bare `doi.org`) and journal hosts (`journals.aps.org`, `nature.com`,
 * `frontiersin.org`, `pubs.aip.org`) that aren't `.gov`/`.edu`/`doi`. So the
 * Tier-1 set is deliberately BROAD: gov/edu/mil/legal/intl suffix cores, DOI +
 * preprint/repo hosts, and a CURATED journal/publisher allowlist. Subdomain
 * matching (`endsWith(".doi.org")`) covers `dx.doi.org`, `journals.aps.org`, etc.
 *
 * ★ HONESTY MODEL (Q1/Q2, ruled). ★
 * We count Tier-1 ONLY (clear-primary → no false-positives). Tier-2 (a bare
 * `example.com/report.pdf`, an unhosted press release, a dataset on an unknown
 * host) is EXCLUDED — counting it would over-claim. So the per-article "has a
 * primary link" flag, and the ratio built from it, are a CLEAR-PRIMARY LOWER
 * BOUND: a high ratio is a strong positive; a low/zero ratio means "few clearly
 * -primary links observed," NOT "doesn't cite primary sources." The curated
 * journal allowlist is extensible and NEVER complete (flagged for review) — the
 * Ars false-negative is the proof that narrowness, not breadth, is the danger.
 */

// ─── Tier-1 suffix patterns (government / military / academic / intergovernmental).
// Tested against ("." + host) so the apex (e.g. "gov.uk") and subdomains match
// uniformly, and the leading dot prevents "notgov.uk" from matching ".gov.uk".
const PRIMARY_SUFFIX_PATTERNS = Object.freeze([
  /\.gov$/,                 // US + many: whitehouse.gov, sec.gov, *.nih.gov (→ PubMed/NCBI)
  /\.gov\.[a-z]{2,3}$/,     // gov.uk, gov.au, gov.in, gov.sg, ...
  /\.gob\.[a-z]{2,3}$/,     // Spanish-language governments: gob.mx, gob.es, ...
  /\.govt\.nz$/,
  /\.gc\.ca$/,              // Government of Canada
  /\.gouv\.fr$/,            // Government of France
  /\.mil$/, /\.mil\.[a-z]{2,3}$/,
  /\.edu$/, /\.edu\.[a-z]{2,3}$/,
  /\.ac\.[a-z]{2,3}$/,      // academic: ac.uk, ac.jp, ac.nz, ...
  /\.int$/,                 // intergovernmental treaty orgs (who.int, echr.coe.int, wipo.int)
]);

// ─── Tier-1 explicit domains (host === d OR host endsWith "." + d). ──────────────
// CURATED + EXTENSIBLE — flagged for review, NEVER complete (Q1). Widen here when
// real validation surfaces a genuine primary host the set misses.
const PRIMARY_DOMAINS = Object.freeze([
  // Legal / regulatory (not caught by the .gov/.int cores)
  "courtlistener.com", "supremecourt.uk", "icj-cij.org",
  // Intergovernmental orgs on commercial/org TLDs
  "un.org", "worldbank.org", "imf.org", "oecd.org", "wto.org", "unesco.org",
  // DOI + preprints + open repositories (datasets / papers = primary)
  "doi.org",            // → dx.doi.org via subdomain match
  "arxiv.org", "biorxiv.org", "medrxiv.org", "ssrn.com", "europepmc.org",
  "zenodo.org", "figshare.com", "osf.io", "datadryad.org",
  // Curated journal / academic-publisher allowlist (flagged for review — extensible).
  // The Ars Technica probe cited several of these directly (not via DOI).
  "nature.com", "science.org", "sciencemag.org", "pnas.org", "cell.com",
  "thelancet.com", "nejm.org", "bmj.com", "jamanetwork.com",
  "plos.org", "frontiersin.org", "mdpi.com", "elifesciences.org",
  "sciencedirect.com", "springer.com", "springeropen.com", "wiley.com",
  "tandfonline.com", "sagepub.com", "jstor.org",
  "aps.org",            // → journals.aps.org
  "aip.org",            // → pubs.aip.org
  "iop.org",            // → iopscience.iop.org
  "acs.org",            // → pubs.acs.org
  "rsc.org", "ieee.org", "acm.org",
  "oup.com",            // → academic.oup.com
  "cambridge.org", "royalsocietypublishing.org", "agu.org", "ametsoc.org",
]);

/**
 * isPrimaryHost(host) → true iff the hostname is a CLEAR (Tier-1) primary-source
 * host. Heuristic + intentionally a lower bound (see file header). `host` may be
 * any hostname form; www. is stripped, case-folded.
 */
export function isPrimaryHost(host) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!h || !h.includes(".")) return false;
  const dotted = "." + h; // uniform suffix matching incl. apex
  if (PRIMARY_SUFFIX_PATTERNS.some((re) => re.test(dotted))) return true;
  if (PRIMARY_DOMAINS.some((d) => dotted.endsWith("." + d))) return true;
  return false;
}

// ─── Article-body container selectors (Q3 — container-selector, NOT readability).
// Probe-validated order: the most specific markers first, then the structural
// fallbacks. We use the FIRST matching container only (one element) + dedupe by
// resolved href, so nested containers can't double-count (the probe's bug).
const BODY_SELECTORS = Object.freeze([
  "[itemprop='articleBody']",
  ".article-body", ".article__body", ".articlebody",
  ".content__article-body", ".story-body", ".storybody",
  ".post-content", ".entry-content", ".article-content",
  "article",
  "main",
]);

/**
 * extractBodyExternalLinks(doc, finalUrl, ownRegistrable) → [{host, href}]
 *
 * Isolate citation links from chrome: take links from the FIRST matching
 * article-body container (whole-doc fallback when none matches), resolve relative
 * hrefs against finalUrl, keep http(s) only, drop the source's OWN domain
 * (internal links aren't external citations), and dedupe by resolved origin+path.
 */
export function extractBodyExternalLinks(doc, finalUrl, ownRegistrable) {
  if (!doc) return [];
  let container = null;
  for (const sel of BODY_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el) { container = el; break; }
  }
  const root = container || doc;
  const own = String(ownRegistrable || "").toLowerCase().replace(/^www\./, "");
  const seen = new Set();
  const out = [];
  for (const a of [...root.querySelectorAll("a[href]")]) {
    const raw = a.getAttribute("href");
    if (!raw) continue;
    let u;
    try { u = new URL(raw, finalUrl); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!host) continue;
    const key = u.origin + u.pathname; // ignore #frag / ?query for dedupe
    if (seen.has(key)) continue;
    seen.add(key);
    // External = not the source's own registrable domain (nor a subdomain of it).
    if (own && (host === own || host.endsWith("." + own))) continue;
    out.push({ host, href: u.toString() });
  }
  return out;
}

/**
 * classifyLinks(links) → {total, primary:[{host,href}], hasPrimary, primaryHosts:[]}
 * Per-article: does this article carry ≥1 clear-primary link? (the 2.2.b unit).
 */
export function classifyLinks(links) {
  const primary = (links || []).filter((l) => isPrimaryHost(l.host));
  return {
    total: (links || []).length,
    primary,
    hasPrimary: primary.length > 0,
    primaryHosts: [...new Set(primary.map((l) => l.host))],
  };
}
