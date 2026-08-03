/**
 * videoAttribution.js — who gets credited, resolved once.
 *
 * THE CASE THAT FORCED THIS. A live dry run selected a personal blog,
 * seanhelvey.com, whose `source_name` is "Hacker News". The attribution card
 * would have read "Reported by Hacker News" — false, on the one card whose
 * entire job is honest sourcing. Hacker News is an aggregator; it did not
 * report anything.
 *
 * DrJ's ruling (2026-08-03) is to RESOLVE attribution rather than to exclude
 * aggregators from selection. An exclusion list is a permanent maintenance
 * burden that fails silently on the next aggregator nobody listed, and it also
 * throws away good stories. Deriving the publisher from the article's own URL
 * is a general rule that needs no list of who the offenders are.
 *
 * THE RULE:
 *   - the publisher is derived from the article's URL — its registrable domain
 *   - cross-checked against source_name
 *   - when the domain belongs to the source (bbc.co.uk / "BBC News"), keep
 *     source_name: it reads better and is equally true
 *   - when it does not (seanhelvey.com / "Hacker News"), THE DOMAIN WINS.
 *     "Reported by seanhelvey.com" is awkward; it is also true, and on this
 *     card true beats smooth.
 *
 * ONE RESOLVER, FOUR CONSUMERS: the attribution card, the on-screen SOURCE:
 * line, §3b/3's verbal-credit matching, and the description credit. They each
 * read `source_name` independently before this, which is precisely how four
 * copies of a rule drift into four different rules.
 *
 * WHICH DIRECTION THE UNCERTAINTY FALLS. A false NEGATIVE (failing to see that
 * bbc.co.uk is BBC News) shows a bare domain: awkward, still true. A false
 * POSITIVE (deciding seanhelvey.com is Hacker News) prints a lie. So every
 * threshold below is set to make false positives hard, and the matcher never
 * guesses from a fragment shorter than three characters.
 */

/**
 * Multi-part public suffixes.
 *
 * APPROXIMATE, AND DELIBERATELY SO. The correct source is the Public Suffix
 * List, which is ~9,000 rules and no dependency in this repo provides it
 * (checked: only rss-parser is remotely related). Getting this wrong is not
 * dangerous here — it changes a DISPLAY STRING, not a selection or a publish
 * decision. An unlisted suffix yields "co.uk"-shaped output, which is visibly
 * odd rather than quietly false, and the cross-check below still refuses to
 * credit the wrong masthead. Add entries as real sources appear.
 */
const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk", "sch.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "net.nz", "org.nz", "govt.nz",
  "co.in", "net.in", "org.in", "gov.in", "ac.in",
  "co.jp", "or.jp", "ne.jp", "go.jp", "ac.jp",
  "co.kr", "or.kr", "go.kr",
  "co.za", "org.za", "gov.za",
  "com.br", "net.br", "org.br", "gov.br",
  "com.mx", "com.ar", "com.co", "com.pe", "com.ec", "com.uy",
  "com.tr", "com.sg", "com.hk", "com.tw", "com.my", "com.ph", "com.vn",
  "com.cn", "net.cn", "org.cn", "gov.cn",
  "com.ng", "com.gh", "co.ke", "co.tz", "co.ug",
  "com.pk", "com.bd", "com.lk", "com.np",
  "com.sa", "com.eg", "com.qa", "com.kw", "com.bh", "com.om",
  "com.es", "com.pt", "com.pl", "com.ua", "com.ru",
]);

/**
 * Registrable domain (eTLD+1) for a URL.
 * bbc.co.uk/news/x → "bbc.co.uk"; www.seanhelvey.com/p → "seanhelvey.com".
 * Returns null when there is no parseable host.
 */
export function registrableDomain(url) {
  if (!url) return null;
  let host;
  try {
    host = new URL(String(url)).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return null;
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  // An IP address has no registrable domain; return it whole rather than
  // slicing it into a nonsense "1.1" .
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;

  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".") || null;

  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

/** The name part of a registrable domain: "bbc.co.uk" → "bbc". */
function domainLabel(domain) {
  if (!domain) return "";
  return domain.split(".")[0].replace(/[^a-z0-9]/g, "");
}

// Shared with videoSpecSchema's credit matcher in spirit: words that appear in
// so many mastheads that they identify none of them. "News" must never be what
// makes a domain match a source.
const GENERIC_MASTHEAD_WORDS = new Set([
  "news", "the", "times", "post", "daily", "press", "media", "wire",
  "journal", "herald", "tribune", "gazette", "review", "report", "reports",
  "today", "online", "network", "service", "agency", "group", "and", "of",
]);

/** Minimum fragment length for a CONTAINMENT match. Shorter names ("AP", "DW")
 *  must match a label exactly — "ap" inside "apple.com" is not attribution. */
const MIN_CONTAINMENT = 3;

/**
 * Does this domain plausibly belong to this outlet?
 *
 * Compared against the domain's label, both directions:
 *   - each non-generic token of the source   ("hindu" in "thehindu")
 *   - the full concatenation of all tokens   ("dw" in "dwenglish")
 * so "DW English" still matches dw.com, and "The Hindu" still matches
 * thehindu.com, while "Hacker News" does not match seanhelvey.com.
 */
export function domainMatchesSource(domain, sourceName) {
  const label = domainLabel(domain);
  const tokens = String(sourceName || "")
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!label || !tokens.length) return false;

  const concat = tokens.join("");
  // INITIALISM. Measured over 33,300 real articles, the single largest override
  // bucket was "Financial Times" → ft.com (524), a real publisher losing its own
  // masthead: "times" is a generic word and "financialtimes" does not contain
  // "ft". Initials recover it. Matched EXACTLY against the label and never by
  // containment — a 2-letter fragment loose inside a long domain is a
  // coincidence, and this is the one rule that can hand the name back to
  // source_name, so it is the one that must not be generous.
  const initials = tokens.map(t => t[0]).join("");
  if (initials.length >= 2 && initials === label) return true;

  const candidates = [concat, ...tokens.filter(t => !GENERIC_MASTHEAD_WORDS.has(t))];

  for (const c of candidates) {
    if (!c) continue;
    if (c === label) return true;                       // exact: covers AP, DW
    if (c.length < MIN_CONTAINMENT) continue;           // too short to contain safely
    if (label.includes(c) || c.includes(label)) {
      // The containment must be carried by the SHORTER string being a real
      // fragment, not by a 2-character coincidence inside a long label.
      if (Math.min(c.length, label.length) >= MIN_CONTAINMENT) return true;
    }
  }
  return false;
}

/**
 * Resolve who to credit for one article.
 *
 * @param {object} article — needs `url` and `source_name`
 * @returns {{
 *   publisher: string|null,   // what every surface displays and says
 *   basis: "source_name"|"url_domain"|"source_name_unverified"|"none",
 *   domain: string|null,
 *   sourceName: string|null,
 *   matched: boolean          // did the domain corroborate source_name
 * }}
 *
 * `basis` is carried so the cycle log can show WHY a credit reads the way it
 * does. A run that silently starts crediting bare domains is either meeting a
 * lot of aggregators or has a broken suffix table, and those need telling apart.
 */
export function resolveAttribution(article) {
  const sourceName = String(article?.source_name || "").trim() || null;
  const domain = registrableDomain(article?.url);

  if (!domain) {
    // Nothing to cross-check against. source_name stands, but it is UNVERIFIED
    // and labelled as such — this is the state the seanhelvey case would have
    // been in with no URL, and it should not look identical to a confirmed one.
    return {
      publisher: sourceName, basis: sourceName ? "source_name_unverified" : "none",
      domain: null, sourceName, matched: false,
    };
  }
  if (!sourceName) {
    return { publisher: domain, basis: "url_domain", domain, sourceName: null, matched: false };
  }

  const matched = domainMatchesSource(domain, sourceName);
  return {
    publisher: matched ? sourceName : domain,
    basis: matched ? "source_name" : "url_domain",
    domain, sourceName, matched,
  };
}

/**
 * §3b/4 — the original, linked prominently, above the fold.
 *
 * First line of the description, before the hook, because "above the fold" on
 * YouTube is roughly the first two lines and everything else is behind "more".
 */
export function buildDescriptionCredit(article, attribution = resolveAttribution(article)) {
  const url = String(article?.url || "").trim();
  const who = attribution?.publisher;
  if (!who) return url ? `Original report: ${url}` : "";
  return url ? `Original report by ${who}: ${url}` : `Original report by ${who}.`;
}

export const _internals = { MULTI_PART_SUFFIXES, GENERIC_MASTHEAD_WORDS, domainLabel, MIN_CONTAINMENT };
