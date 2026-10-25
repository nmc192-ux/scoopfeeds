/**
 * electionPack.js - the election desk's facts (#197). ScoopFeeds never calls a race: every
 * result on air is a projection a NAMED news organisation made, read from a tracked article.
 *
 * From tracked articles of the last 6 hours, sentence by sentence:
 *   projection   only when the sentence says a named organisation projected / called / declared
 *                the race (AP, NBC News, Decision Desk HQ, ...), and no poll, lead, partial-count
 *                or negated-call wording is in it
 *   retraction   a named organisation withdrew its call
 *   house-seats  a named organisation's projected House seat tally
 *   count        a counted-share figure ("with 64% of the expected vote counted") for a race, only
 *                when the article states it; never a call
 * Every item keeps the projecting organisation (`outlet`), the article's own outlet (`source`),
 * the article time (`at`), its link (`url`) and the sentence verbatim (`quote`).
 * Items are the #204 map contract (backend/src/radio/election/README.md on that branch).
 * Conflicting projections are kept side by side (races[].status = "conflict"), never merged.
 *
 * Pure except fetchElectionArticles(); everything is tested on fixtures (electionPack.test.js).
 */
import { STATE_NAMES, SENATE_UP, GOVERNOR_UP, HOUSE_SEATS, HOUSE_MAJORITY, SENATE_SEATS, SENATE_MAJORITY, hasRace } from "../election/races2026.js";
import { airable, clusterStories } from "./factPack.js";

export const WINDOW_MS = 6 * 3600_000;

/** Organisations whose projections we report, canonical name first. Longest spellings first in the regex. */
export const ORGS = [
  ["AP", ["The Associated Press", "Associated Press", "AP"]],
  ["NBC News", ["NBC News Decision Desk", "NBC News", "NBC"]],
  ["CNN", ["CNN"]],
  ["Fox News", ["Fox News Decision Desk", "Fox News", "Fox"]],
  ["ABC News", ["ABC News", "ABC"]],
  ["CBS News", ["CBS News", "CBS"]],
  ["Decision Desk HQ", ["Decision Desk HQ", "DDHQ"]],
  ["The New York Times", ["The New York Times", "New York Times"]],
  ["The Washington Post", ["The Washington Post", "Washington Post"]],
  ["Reuters", ["Reuters"]],
  ["Edison Research", ["Edison Research"]],
  ["NPR", ["NPR"]],
  ["Bloomberg", ["Bloomberg News", "Bloomberg"]],
  ["Politico", ["Politico"]],
];
const ALIAS = new Map(ORGS.flatMap(([c, names]) => names.map((n) => [n.toLowerCase(), c])));
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ORG_ALT = [...ALIAS.keys()].sort((a, b) => b.length - a.length).map((n) => reEsc(n).replace(/ /g, "\\s+")).join("|");
const ORG_SUBJECT = new RegExp(`\\b(${ORG_ALT})(?:'s?)?(?:\\s+(?:news|decision desk|race call(?:er|s)?))?,?\\s+(?:has\\s+|have\\s+|had\\s+)?(?:now\\s+|also\\s+)?(projects?|projected|calls?|called|declares?|declared)\\b`, "i");
const ORG_PASSIVE = new RegExp(`\\b(?:projected|called|declared)\\b[^.;]*?\\b(?:by|according to)\\s+(?:the\\s+)?(${ORG_ALT})\\b|\\baccording to\\s+(?:an?\\s+|the\\s+)?(${ORG_ALT})(?:'s?)?\\s+(?:projection|call|race call)s?\\b|\\b(${ORG_ALT})(?:'s?)?\\s+(?:projection|race call)s?\\s+(?:show|shows|showed)\\b`, "i");
const ORG_RETRACT = new RegExp(`\\b(${ORG_ALT})\\b[^.;]*\\b(withdrew|withdrawn|retracted|rescinded|pulled back)\\b[^.;]*\\b(call|projection)\\b`, "i");
export const canonOrg = (s) => ALIAS.get(String(s || "").toLowerCase().replace(/\s+/g, " ")) || null;

/** A result claimed: someone won, will win, keeps or takes control. */
const WIN = /\b(wins?|won|winner|will win|win(ning)? (the|re-?election)|victor(y|ious)|re-?elected|elected|defeat(s|ed)?|beat(s|en)?|flip(s|ped)?|holds?|keeps?|retains?|takes?|captures?|called the (race|seat|contest) for)\b/i;
const NEGATED = /\b(not (yet )?(been )?(called|projected|declared)|too (early|close|soon) to (call|project|declare)|yet to (be )?(call(ed)?|project(ed)?|declare[d]?)|no (call|projection|winner)s?( has been| yet)?|(un|not )called|can(not|'t|’t) (yet )?(call|project)|(has|have|had)n['’]?t (yet )?(been )?(called|projected)|withdr(ew|awn|aw)|retract(s|ed|ion)?|rescind(s|ed)?)\b/i;
/** Polls, forecasts, leads and partial counts: never a call. "polls closed" is not a poll. */
const NOT_A_CALL = /\b(polls?|polling|pollsters?|survey(s|ed)?|forecast(s|er|ers)?|model(s|led)?|odds|ratings?|toss-?up|likely|lean(s|ing)?|favou?red|expected to|on track|leads?|leading|ahead|trails?|trailing|edge|early (returns|results|count)|partial|so far|preliminary|reporting|counted)\b/i;
const POLLS_CLOSED = /\bpolls? (have |had )?(closed|close[sd]?|closing)\b/gi;

// longest names first, so "West Virginia" is not also read as Virginia
const STATE_RE = Object.entries(STATE_NAMES).filter(([c]) => c !== "DC").sort((a, b) => b[1].length - a[1].length).map(([c, n]) => [c, new RegExp(`\\b${reEsc(n)}\\b`, "gi")]);
const ORDINAL = /\b([A-Z][a-z]+(?: [A-Z][a-z]+)?)['’]s (\d{1,2})(?:st|nd|rd|th) (?:congressional )?district\b/i;

/** Sentences of an article's title + description. */
export function sentences(a) {
  return [a.title, a.description].filter(Boolean).flatMap((t) => String(t).replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z"“])/)).map((s) => s.trim()).filter(Boolean);
}

/** States named in a sentence, with organisation names removed first ("New York Times" is not New York). */
export function statesIn(s) {
  const t = String(s).replace(new RegExp(`\\b(${ORG_ALT})\\b`, "gi"), " ").replace(/\bWashington,? D\.?C\.?\b/g, " ");
  let rest = t; const out = [];
  for (const [c, re] of STATE_RE) { const next = rest.replace(re, " "); if (next !== rest) { out.push(c); rest = next; } }
  return out;
}

/** senate | governor | house | senate-control | house-control | null (none or ambiguous). */
export function raceOf(s, states) {
  const t = String(s);
  const senate = /\bsenat(e|or|orial)\b/i.test(t), gov = /\b(governor(ship)?|gubernatorial|governor['’]s)\b/i.test(t);
  const house = /\bhouse\b/i.test(t.replace(/\bwhite house\b/gi, " "));
  const control = /\b(control|majority)\b/i.test(t);
  if (ORDINAL.test(t)) return "house";
  if (senate && gov) return null;
  if (senate) return states.length ? "senate" : (control ? "senate-control" : null);
  if (gov) return states.length ? "governor" : null;
  if (house && control && !states.length) return "house-control";
  return null;
}

/** D | R | I | null, from "(D)", "(R-NC)", "Democrat Jane Doe", "Republicans". Ambiguous -> null. */
export function partyOf(s) {
  const p = String(s).match(/\((D|R|I)(?:-[A-Z]{2})?\)/);
  if (p) return p[1];
  const d = /\b(democrat(ic|s)?|dfl)\b/i.test(s), r = /\b(republican(s)?|gop)\b/i.test(s), i = /\bindependent\b/i.test(s);
  if ([d, r, i].filter(Boolean).length !== 1) return null;
  return d ? "D" : r ? "R" : "I";
}

const NAME = "((?:[A-Z][\\w'’.-]+)(?:\\s+(?:[A-Z][\\w'’.-]+|de|van|von|da)){0,3})";
const TITLES = /^(?:(?:the\s+)?(?:Democrat(?:ic)?|Republican|GOP|independent|incumbent|Sen\.|Gov\.|Rep\.|Senator|Governor|Representative|former|state|U\.S\.)\s+)+/i;
/** The projected winner's name as written in the sentence, or null. */
export function candidateOf(s) {
  const t = String(s);
  const pats = [
    new RegExp(`\\bcalled the (?:race|seat|contest)[^.;]*?\\bfor ${NAME}`),
    new RegExp(`\\b(?:projects?|projected|declares?|declared)(?: that)? (?:the )?(?:(?:Democrat(?:ic)?|Republican|GOP|independent|incumbent|Sen\\.|Gov\\.|Rep\\.|Senator|Governor) )*${NAME}(?: \\([DRI](?:-[A-Z]{2})?\\))? (?:wins?|won|has won|will win|is re-?elected|has been re-?elected|as the (?:winner|victor)|defeats?|beats?|flips?|holds?|keeps?)\\b`),
    new RegExp(`(?:^|[.;:]\\s+|,\\s+)(?:(?:Democrat(?:ic)?|Republican|GOP|independent|incumbent|Sen\\.|Gov\\.|Rep\\.|Senator|Governor) )*${NAME}(?: \\([DRI](?:-[A-Z]{2})?\\))? (?:wins|won|has won|will win|is re-?elected|defeats|defeated|beat|beats|flips|flipped)\\b`),
  ];
  for (const re of pats) {
    const m = t.match(re);
    if (!m) continue;
    const name = m[1].replace(TITLES, "").replace(/['’]s$/, "").trim();
    if (!name || canonOrg(name) || /^(Democrats?|Republicans?|The|It|He|She|They|AP)$/i.test(name) || (statesIn(name).length && name.split(" ").length <= 2)) continue;
    return name;
  }
  return null;
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/**
 * Items from one sentence of one article (exported for tests).
 * @returns {{ items: object[], refused: {reason, quote}[] }}
 */
export function itemsFromSentence(q, art) {
  const items = [], refused = [];
  const base = { source: art.source || null, at: iso(art.published), url: art.url || null, quote: q };
  const states = statesIn(q);
  const race = raceOf(q, states);

  // retraction
  const rt = q.match(ORG_RETRACT);
  if (rt) {
    const outlet = canonOrg(rt[1]);
    if (states.length === 1) items.push({ kind: "retraction", ...(race && race !== "senate-control" && race !== "house-control" ? { race } : {}), state: states[0], outlet, ...base });
    else refused.push({ reason: "retraction-without-one-state", quote: q });
    return { items, refused };
  }

  // projection: a named organisation must be the one projecting
  const subj = q.match(ORG_SUBJECT), pas = q.match(ORG_PASSIVE);
  const orgRaw = subj?.[1] || pas?.[1] || pas?.[2] || pas?.[3];
  if (orgRaw) {
    const outlet = canonOrg(orgRaw);
    const clean = q.replace(POLLS_CLOSED, " ");
    if (NEGATED.test(q)) refused.push({ reason: "negated-call", quote: q });
    else if (NOT_A_CALL.test(clean)) refused.push({ reason: "poll-or-lead", quote: q });
    else if (!WIN.test(q)) refused.push({ reason: "no-win-claim", quote: q });
    else {
      // projected House tally: "AP projects Republicans have won 218 seats"
      const seats = {};
      for (const m of q.matchAll(/\b(Democrats|Republicans)\b[^.;\d]*?\b(\d{1,3})\s+(?:House\s+)?seats\b/gi)) seats[/^d/i.test(m[1]) ? "D" : "R"] = Number(m[2]);
      if (Object.keys(seats).length && /\bhouse\b/i.test(q)) items.push({ kind: "house-seats", outlet, seats, ...base });
      else if (!race) refused.push({ reason: states.length > 1 ? "more-than-one-state" : "no-race", quote: q });
      else if (race === "senate-control" || race === "house-control") {
        const party = partyOf(q);
        if (party) items.push({ kind: "projection", race, party, outlet, ...base });
        else refused.push({ reason: "no-party", quote: q });
      } else if (states.length !== 1 && race !== "house") refused.push({ reason: "more-than-one-state", quote: q });
      else {
        let state = states[0], district = null;
        const od = q.match(ORDINAL);
        if (race === "house") {
          const st = od ? Object.entries(STATE_NAMES).find(([, n]) => n.toLowerCase() === od[1].toLowerCase()) : null;
          if (!st) { refused.push({ reason: "no-district", quote: q }); return { items, refused }; }
          state = st[0]; district = Number(od[2]);
        }
        if (race !== "house" && !hasRace(race, state)) refused.push({ reason: "no-such-race", quote: q });
        else items.push({ kind: "projection", race, state, ...(district ? { district } : {}), party: partyOf(q), candidate: candidateOf(q), outlet, ...base });
      }
    }
    return { items, refused };
  }

  // a counted-share figure, stated by the article (the article's outlet reports it)
  const cm = q.match(/\b(\d{1,3}(?:\.\d+)?)\s?(?:%|percent)\s+of\s+(?:the\s+)?(?:expected\s+|estimated\s+)?(?:vote|votes|ballots|precincts)(?:\s+(?:counted|in|reporting|tallied))?|\bwith\s+(\d{1,3}(?:\.\d+)?)\s?(?:%|percent)\s+(?:reporting|counted|of precincts)/i);
  if (cm && race && race !== "senate-control" && race !== "house-control" && states.length === 1) {
    const pct = Number(cm[1] ?? cm[2]);
    if (pct >= 0 && pct <= 100) items.push({ kind: "count", race, state: states[0], reportingPct: pct, outlet: art.source || null, ...base });
  }
  return { items, refused };
}

/** Is this article about the US midterms at all? (Used to pick the desk's coverage stories.) */
export const ELECTORAL = /\b(midterms?|election(s)?|ballot|campaign|candidates?|(senate|governor['’]?s?|gubernatorial|house) (race|seat|contest)s?|race for (the )?(senate|house|governor)|early voting|voters?|polls? (close|open)|projects?|projected)\b/i;
const US_CONTEXT = /\b(midterms?|senate|house|governor|gubernatorial|congress(ional)?|republicans?|democrats?|gop|u\.s\.|american)\b/i;

/**
 * Pure: articles -> election pack.
 * @param {object[]} articles  slim articles { source, title, description, published (ms), url }
 * @returns {{ builtAt, windowMs, items, refused, races, stories, counts }}
 */
export function extractElectionPack(articles, { now = Date.now(), windowMs = WINDOW_MS } = {}) {
  const fresh = articles.filter((a) => Number.isFinite(a.published) && a.published >= now - windowMs && a.published <= now + 5 * 60_000);
  const items = [], refused = [];
  for (const a of fresh) for (const q of sentences(a)) {
    const r = itemsFromSentence(q, a);
    items.push(...r.items); refused.push(...r.refused);
  }
  // one item per (kind, race, state, district, outlet, who): the latest article wins
  const keyOf = (i) => [i.kind, i.race, i.state, i.district, i.outlet, i.party || i.candidate || "", i.kind === "house-seats" ? JSON.stringify(i.seats) : ""].join("|");
  const byKey = new Map();
  for (const i of items.sort((x, y) => Date.parse(x.at) - Date.parse(y.at))) byKey.set(keyOf(i), i);
  const kept = [...byKey.values()].map((i, n) => ({ id: `p${n + 1}`, ...i }));
  return { builtAt: now, windowMs, items: kept, refused, races: raceTable(kept), counts: kept.filter((i) => i.kind === "count"),
    stories: clusterStories(fresh.filter((a) => ELECTORAL.test(`${a.title} ${a.description}`) && US_CONTEXT.test(`${a.title} ${a.description}`))).slice(0, 4)
      .map((c, i) => ({ id: `el${i + 1}`, headline: c.lead.title, outlets: c.items.slice(0, 5), count: c.outlets })) };
}

/**
 * Each race's calls, by outlet. The latest call or retraction per outlet decides that outlet's position.
 * status: "called" (every outlet that called it agrees), "conflict" (they disagree: shown side by side).
 */
export function raceTable(items) {
  const races = new Map();
  const key = (i) => [i.race, i.state || "", i.district || ""].join("|");
  for (const i of items.filter((x) => x.kind === "projection" || x.kind === "retraction").sort((x, y) => Date.parse(x.at) - Date.parse(y.at))) {
    const keys = i.kind === "retraction" && !i.race ? [...races.keys()].filter((k) => k.split("|")[1] === i.state) : [key(i)];
    for (const k of keys) {
      if (!races.has(k)) races.set(k, { race: i.race, state: i.state || null, district: i.district || null, byOutlet: new Map(), withdrawn: [] });
      const r = races.get(k);
      if (i.kind === "retraction") { if (r.byOutlet.delete(i.outlet)) r.withdrawn.push({ outlet: i.outlet, at: i.at, url: i.url, quote: i.quote }); }
      else r.byOutlet.set(i.outlet, i);
    }
  }
  return [...races.values()].map((r) => {
    const calls = [...r.byOutlet.values()];
    const who = new Set(calls.map((c) => c.party || (c.candidate || "").toLowerCase() || "?"));
    return { race: r.race, state: r.state, district: r.district, calls, withdrawn: r.withdrawn, status: !calls.length ? "open" : who.size === 1 ? "called" : "conflict" };
  });
}

/** The election pack as plain text for the writer: projections and counts under their ids, verbatim. */
export function electionText(ep) {
  if (!ep) return "";
  const where = (i) => [i.race, i.state ? STATE_NAMES[i.state] : null, i.district ? `district ${i.district}` : null].filter(Boolean).join(", ");
  const out = ["ELECTION PROJECTIONS (only these; each made by the named organisation; ScoopFeeds never calls a race)"];
  for (const r of ep.races || []) {
    if (r.status === "conflict") out.push(`    CONFLICT (${where(r)}): outlets disagree; report each, never pick one`);
    for (const c of r.calls) out.push(`    [${c.id}] ${c.outlet} projection (${where(c)}): "${c.quote}" (article: ${c.source})`);
    for (const w of r.withdrawn) out.push(`    ${w.outlet} withdrew its call (${where(r)}): "${w.quote}"`);
  }
  for (const h of (ep.items || []).filter((i) => i.kind === "house-seats")) out.push(`    [${h.id}] ${h.outlet} House seat projection: "${h.quote}" (article: ${h.source})`);
  if (out.length === 1) out.push("    none yet: no race has been projected by any organisation");
  out.push("COUNTS (share of the vote counted, as the article states it)");
  for (const c of ep.counts || []) out.push(`    [${c.id}] ${c.source} (${where(c)}): "${c.quote}"`);
  if (!(ep.counts || []).length) out.push("    none");
  out.push(`ON THE BALLOT, 3 November 2026: ${Object.keys(SENATE_UP).length} Senate seats of ${SENATE_SEATS} (a majority is ${SENATE_MAJORITY}), ${GOVERNOR_UP.length} governors, all ${HOUSE_SEATS} House seats (a majority is ${HOUSE_MAJORITY}).`);
  return out.join("\n");
}

/** Fetch tracked election articles from scoopfeeds.com, through the radio's Rule 0 layer. */
export async function fetchElectionArticles({ base = "https://scoopfeeds.com", fetchImpl = fetch, log = () => {} } = {}) {
  const QUERIES = ["projects Senate", "projects governor", "projects House", "projected winner", "election results", "midterms", "midterm election", "Senate race", "governor race"];
  const seen = new Set(), out = [];
  for (const q of QUERIES) {
    try {
      const res = await fetchImpl(`${base}/api/news?search=${encodeURIComponent(q)}&limit=50`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(25_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      for (const a of (await res.json())?.data || []) {
        const k = a.url || a.title;
        if (seen.has(k) || Number(a.is_duplicate) === 1 || !airable(a)) continue;
        seen.add(k);
        out.push({ source: a.source_name || "?", title: String(a.title || "").trim(), description: String(a.description || "").trim().slice(0, 600), published: Number(a.published_at) || null, url: a.url || null });
      }
    } catch (e) { log(`election search "${q}" failed: ${e.message}`); }
  }
  return out;
}

export async function buildElectionPack({ now = Date.now(), ...opts } = {}) {
  return extractElectionPack(await fetchElectionArticles(opts), { now });
}
