/**
 * factPack.js - everything the writer may say, fetched from scoopfeeds.com's public API
 * and the open market/weather feeds, then filtered by the radio's Rule 0 layer.
 *
 * The pack is the ONLY source of facts: the writer is told to use nothing else, and
 * checks.js rejects any spoken figure that is not in the pack. Every article that fails
 * radioRulesVerdict (Pakistan politics, Indian outlet on Pakistan, critical of Pakistan,
 * soft news, D1) is dropped here, before the writer sees it.
 */
import { radioRulesVerdict } from "../radioRules.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ScoopFeedsRadio/1.0";

async function getJson(url, { timeoutMs = 25_000, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

const STOP = new Set("a an the of to in on for and or but with from by at as is are was were be been it its this that after over into new says say said will would could us u.s. vs amid".split(" "));
export const words = (s) => String(s || "").toLowerCase().replace(/[‘’']/g, "").split(/[^a-z0-9%$.]+/).filter((w) => w.length > 2 && !STOP.has(w));
export function jaccard(a, b) {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}

const slim = (a) => ({
  source: a.source_name || "?", title: String(a.title || "").trim(), description: String(a.description || "").trim().slice(0, 420),
  published: Number(a.published_at) || null, region: a.region || null, url: a.url || null,
});

/** Distinctive terms of a headline: names (capitalised, not the first word), figures, long words. */
export function keyTerms(h) {
  const toks = String(h || "").replace(/[‘’']s\b/g, "").split(/[^A-Za-z0-9$%.-]+/).filter(Boolean);
  const out = new Set();
  toks.forEach((t, i) => {
    const w = t.toLowerCase().replace(/\.$/, "");
    if (STOP.has(w) || w.length < 3) return;
    if ((i > 0 && /^[A-Z]/.test(t)) || /\d/.test(t) || w.length >= 8) out.add(w);
  });
  return [...out];
}
/** True when an article shares at least two distinctive terms with the headline (one, if the headline has only one). */
export function sameStory(a, h) {
  const terms = keyTerms(h);
  if (!terms.length) return jaccard(a.title, h) >= 0.3;
  const text = `${a.title} ${a.description}`.toLowerCase();
  const hits = terms.filter((t) => text.includes(t)).length;
  return hits >= Math.min(2, terms.length);
}

/** Rule 0 + hard-news gate, the same layer the 24/7 radio uses. */
export function airable(a) {
  return radioRulesVerdict({ title: a.title, description: a.description, source_name: a.source_name, category: a.category }).allowed;
}

/** Group articles into stories by headline similarity; a story = the lead + every outlet that covered it. */
export function clusterStories(articles, { threshold = 0.22 } = {}) {
  const clusters = [];
  for (const a of articles) {
    const c = clusters.find((k) => jaccard(k.lead.title, a.title) >= threshold || sameStory(a, k.lead.title));
    if (c) { if (!c.items.some((i) => i.source === a.source)) c.items.push(a); }
    else clusters.push({ lead: a, items: [a] });
  }
  return clusters
    .map((c) => ({ ...c, outlets: c.items.length, newest: Math.max(...c.items.map((i) => i.published || 0)) }))
    .sort((x, y) => (y.outlets - x.outlets) || (y.newest - x.newest));
}

const ME = /\b(israel\w*|gaza|west bank|iran\w*|tehran|saudi\w*|riyadh|uae|emirat\w*|dubai|abu dhabi|qatar\w*|doha|lebanon|lebanese|hezbollah|syria\w*|iraq\w*|yemen\w*|houthi\w*|egypt\w*|jordan\w*|turkey|turkish|erdogan|gulf|hamas|palestin\w*|oman\w*|bahrain\w*|kuwait\w*|middle east|netanyahu)\b/i;
const US = /\b(trump|congress|senate|house speaker|white house|republican\w*|democrat\w*|federal reserve|the fed|supreme court|washington|governor|u\.s\.|american|pentagon|doj|fbi)\b/i;

const DESKS = {
  "middle-east": { tab: "world", keep: (a) => ME.test(`${a.title} ${a.description}`) },
  us: { tab: "politics", keep: (a) => US.test(`${a.title} ${a.description}`) || /^us/.test(a.region || "") },
  tech: { tab: "tech", keep: () => true },
  business: { tab: "business", keep: (a) => !/\b(psx|kse|karachi|pakistan)\b/i.test(`${a.title} ${a.description}`) },
};

// Markets: Yahoo's chart API (works from a residential connection; prod's own /api/market is
// blocked by Yahoo from the VPS), crypto from scoopfeeds.com (CoinGecko).
export const MARKET_SYMBOLS = [
  { key: "S&P 500", sym: "^GSPC", group: "US" }, { key: "Dow", sym: "^DJI", group: "US" }, { key: "Nasdaq", sym: "^IXIC", group: "US" },
  { key: "FTSE 100", sym: "^FTSE", group: "Europe" }, { key: "DAX", sym: "^GDAXI", group: "Europe" },
  { key: "Brent", sym: "BZ=F", group: "Commodities" }, { key: "Gold", sym: "GC=F", group: "Commodities" },
];

async function yahooQuote(sym, opts) {
  let d, last;
  for (const host of ["query1", "query2", "query1"]) {
    try { d = await getJson(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`, { ...opts, timeoutMs: 40_000 }); break; }
    catch (e) { last = e; }
  }
  if (!d) throw last;
  const m = d?.chart?.result?.[0]?.meta;
  if (!m || !Number.isFinite(m.regularMarketPrice)) throw new Error(`no quote for ${sym}`);
  const prev = m.chartPreviousClose ?? m.previousClose;
  const pct = Number.isFinite(m.regularMarketChangePercent) ? m.regularMarketChangePercent : (prev ? ((m.regularMarketPrice - prev) / prev) * 100 : null);
  return { price: m.regularMarketPrice, pct, time: (m.regularMarketTime || 0) * 1000 };
}

export async function fetchMarkets(base, opts = {}) {
  const rows = [];
  const got = await Promise.allSettled(MARKET_SYMBOLS.map((s) => yahooQuote(s.sym, opts)));
  got.forEach((r, i) => { if (r.status === "fulfilled") rows.push({ ...MARKET_SYMBOLS[i], ...r.value }); });
  try {
    const m = await getJson(`${base}/api/market`, { ...opts, timeoutMs: 45_000 });
    const btc = (m?.data?.crypto || []).find((c) => c.symbol === "BTC");
    if (btc) rows.push({ key: "Bitcoin", sym: "BTC", group: "Crypto", price: btc.price, pct: btc.changePct, time: Date.now() });
  } catch { /* no crypto row */ }
  return rows.map((r) => ({ ...r, price: Math.round(r.price * 100) / 100, pct: r.pct == null ? null : Math.round(r.pct * 100) / 100 }));
}

export const WEATHER_CITIES = ["New York", "Washington D.C.", "London", "Paris", "Dubai", "Riyadh", "Doha", "Karachi", "Delhi", "Tokyo"];

export async function fetchWeather(base, opts = {}) {
  const got = await Promise.allSettled(WEATHER_CITIES.map((c) => getJson(`${base}/api/weather?city=${encodeURIComponent(c)}`, opts)));
  return got.flatMap((r, i) => {
    const d = r.status === "fulfilled" ? r.value?.data : null;
    if (!d || !Number.isFinite(d.temp)) return [];
    return [{ city: WEATHER_CITIES[i].replace(" D.C.", ""), c: Math.round(d.temp), f: Math.round(d.temp * 9 / 5 + 32), condition: d.description || d.condition || "", main: d.condition || "" }];
  });
}

/**
 * @returns {Promise<{ builtAt, state, top: story[], desks: {[desk]: story[]}, markets, weather, dropped }>}
 *   story = { id, headline, outlets: [{source, title, description, published}], count }
 */
export async function buildFactPack({ base = "https://scoopfeeds.com", fetchImpl = fetch, now = Date.now(), log = () => {} } = {}) {
  const opts = { fetchImpl };
  const dropped = [];
  const news = async (q) => {
    const d = await getJson(`${base}/api/news?${q}`, opts);
    const out = [];
    for (const a of d?.data || []) {
      if (Number(a.is_duplicate) === 1 || a.category === "sports") continue;
      if (/\/(opinion|opinions|op-ed|oped|commentary|columns?|editorials?|analysis\/opinion)\//i.test(a.url || "")) { dropped.push(a.title); continue; }   // opinion is not news
      if (!airable(a)) { dropped.push(a.title); continue; }
      out.push(slim(a));
    }
    return out;
  };

  const state = await getJson(`${base}/api/radio/state.json`, opts);
  const heads = [state.headline, ...(state.alsoThisHour || []).map((x) => x.h), ...(state.music || []).map((x) => x.h)]
    .filter(Boolean).filter((h, i, all) => all.findIndex((o) => jaccard(o, h) > 0.5) === i);

  // Coverage of each top story: search by its longest words, keep articles that are about the same thing.
  const top = [];
  for (const h of heads.slice(0, 12)) {
    const kt = keyTerms(h);
    const q = (kt.length >= 2 ? kt : words(h).sort((a, b) => b.length - a.length)).slice(0, 3).join(" ");
    let items = [];
    try { items = await news(`search=${encodeURIComponent(q)}&limit=12`); } catch (e) { log(`coverage search failed for "${h}": ${e.message}`); }
    const same = items.filter((a) => sameStory(a, h));
    const outlets = [];
    for (const a of same) if (!outlets.some((o) => o.source === a.source)) outlets.push(a);
    if (!outlets.length) continue;                       // a headline we cannot back with an article is not read on air
    top.push({ id: `t${top.length + 1}`, headline: h, outlets: outlets.slice(0, 6), count: outlets.length });
  }

  const desks = {};
  for (const [name, d] of Object.entries(DESKS)) {
    try {
      const arts = (await news(`tab=${d.tab}&limit=80&minCredibility=7`)).filter(d.keep)
        .filter((a) => !a.published || now - a.published < 18 * 3600_000);
      desks[name] = clusterStories(arts).slice(0, 4).map((c, i) => ({
        id: `${name.slice(0, 2)}${i + 1}`, headline: c.lead.title, outlets: c.items.slice(0, 5), count: c.outlets,
      }));
    } catch (e) { log(`desk ${name} failed: ${e.message}`); desks[name] = []; }
  }

  let markets = [], weather = [];
  try { markets = await fetchMarkets(base, opts); } catch (e) { log(`markets failed: ${e.message}`); }
  try { weather = await fetchWeather(base, opts); } catch (e) { log(`weather failed: ${e.message}`); }

  return { builtAt: now, state, top, desks, markets, weather, dropped };
}

/** Every story id in the pack -> story. */
export function storyIndex(pack) {
  const m = new Map();
  for (const s of pack.top) m.set(s.id, s);
  for (const list of Object.values(pack.desks)) for (const s of list) m.set(s.id, s);
  return m;
}
