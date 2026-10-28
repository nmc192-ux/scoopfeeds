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

// Markets: CNBC's quote feed, Yahoo's chart API for anything CNBC lacks (prod's own /api/market is
// blocked by Yahoo from the VPS), crypto from scoopfeeds.com (CoinGecko).
export const MARKET_SYMBOLS = [
  { key: "S&P 500", sym: "^GSPC", group: "US" }, { key: "Dow", sym: "^DJI", group: "US" }, { key: "Nasdaq", sym: "^IXIC", group: "US" },
  { key: "FTSE 100", sym: "^FTSE", group: "Europe" }, { key: "DAX", sym: "^GDAXI", group: "Europe" },
  { key: "Brent", sym: "BZ=F", group: "Commodities" }, { key: "Gold", sym: "GC=F", group: "Commodities" },
];

async function yahooQuote(sym, opts) {
  let d, last;
  for (const host of ["query1", "query2"]) {
    try { d = await getJson(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`, { ...opts, timeoutMs: 20_000 }); break; }
    catch (e) { last = e; }
  }
  if (!d) throw last;
  const m = d?.chart?.result?.[0]?.meta;
  if (!m || !Number.isFinite(m.regularMarketPrice)) throw new Error(`no quote for ${sym}`);
  const prev = m.chartPreviousClose ?? m.previousClose;
  const pct = Number.isFinite(m.regularMarketChangePercent) ? m.regularMarketChangePercent : (prev ? ((m.regularMarketPrice - prev) / prev) * 100 : null);
  // #245: no usable trade time is null (never "now"), so marketsClock treats the row as closed
  return { price: m.regularMarketPrice, pct, time: Number(m.regularMarketTime) > 0 ? m.regularMarketTime * 1000 : null };
}

// CNBC's public quote feed: one request for every symbol. Primary since 13 Oct, when Yahoo answered the Mac with
// HTTP 429 (rate limited) and the markets slots went out as music.
const CNBC_SYMS = { "^GSPC": ".SPX", "^DJI": ".DJI", "^IXIC": ".IXIC", "^FTSE": ".FTSE", "^GDAXI": ".GDAXI", "BZ=F": "@LCO.1", "GC=F": "@GC.1" };
const num = (v) => { const n = Number(String(v ?? "").replace(/[,%+\s]/g, "")); return Number.isFinite(n) ? n : null; };
/** Parse CNBC's restQuote JSON into { [yahooSym]: { price, pct, time } }. "UNCH" is 0 %. No usable last_time is null (#245). */
export function parseCnbc(d) {
  const back = Object.fromEntries(Object.entries(CNBC_SYMS).map(([y, c]) => [c, y]));
  const out = {};
  let list = d?.FormattedQuoteResult?.FormattedQuote ?? d?.QuickQuoteResult?.QuickQuote ?? [];
  if (!Array.isArray(list)) list = [list];
  for (const q of list) {
    const y = back[q?.symbol]; const price = num(q?.last);
    if (!y || price == null || price <= 0) continue;
    const pct = /^unch/i.test(String(q.change_pct || "")) ? 0 : num(q.change_pct);
    const t = Date.parse(q.last_time || ""); out[y] = { price, pct, time: Number.isFinite(t) ? t : null };
  }
  return out;
}
async function cnbcQuotes(opts) {
  const syms = Object.values(CNBC_SYMS).join("|");
  const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(syms)}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`;
  return parseCnbc(await getJson(url, { ...opts, timeoutMs: 30_000 }));
}

export async function fetchMarkets(base, opts = {}) {
  const rows = [];
  let cnbc = {};
  try { cnbc = await cnbcQuotes(opts); } catch (e) { opts.log?.(`markets: CNBC failed (${e.message}); trying Yahoo`); }
  const missing = MARKET_SYMBOLS.filter((s) => !cnbc[s.sym]);
  const got = await Promise.allSettled(missing.map((s) => yahooQuote(s.sym, opts)));
  const yahoo = {}; got.forEach((r, i) => { if (r.status === "fulfilled") yahoo[missing[i].sym] = r.value; });
  for (const s of MARKET_SYMBOLS) { const q = cnbc[s.sym] || yahoo[s.sym]; if (q) rows.push({ ...s, ...q, src: cnbc[s.sym] ? "cnbc" : "yahoo" }); }
  try {
    const m = await getJson(`${base}/api/market`, { ...opts, timeoutMs: 45_000 });
    const btc = (m?.data?.crypto || []).find((c) => c.symbol === "BTC");
    if (btc) rows.push({ key: "Bitcoin", sym: "BTC", group: "Crypto", price: btc.price, pct: btc.changePct, time: Date.now() });
  } catch { /* no crypto row */ }
  return rows.map((r) => ({ ...r, price: Math.round(r.price * 100) / 100, pct: r.pct == null ? null : Math.round(r.pct * 100) / 100 }));
}

/** Crypto rows for the Crypto segment (#200): the CoinGecko list scoopfeeds.com already serves at /api/market. */
export const CRYPTO_KEEP = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE"];
export function parseCrypto(m) {
  return (m?.data?.crypto || [])
    .filter((c) => CRYPTO_KEEP.includes(String(c.symbol || "").toUpperCase()) && Number.isFinite(c.price) && c.price > 0)
    .map((c) => ({ key: c.name || c.symbol, sym: String(c.symbol).toUpperCase(), group: "Crypto", price: Math.round(c.price * 100) / 100,
      pct: Number.isFinite(c.changePct) ? Math.round(c.changePct * 100) / 100 : null, time: null }))
    .sort((a, b) => CRYPTO_KEEP.indexOf(a.sym) - CRYPTO_KEEP.indexOf(b.sym));
}
/**
 * #283: one retry. /api/market answered in about 1 s from its cache but timed out at 45 s on a cold cache in a dry run
 * (28 Oct 2026); the first miss usually warms it. Two failures throw (the caller records why).
 */
export async function fetchCrypto(base, opts = {}) {
  try { return parseCrypto(await getJson(`${base}/api/market`, { ...opts, timeoutMs: 45_000 })); }
  catch (e) {
    opts.log?.(`crypto: /api/market failed (${e.message}); retrying once`);
    await new Promise((r) => setTimeout(r, opts.retryMs ?? 5_000));
    return parseCrypto(await getJson(`${base}/api/market`, { ...opts, timeoutMs: 45_000 }));
  }
}

/** The Crypto segment needs at least this many rows; with fewer it turns into headlines and music (produce.mjs). */
export const CRYPTO_MIN_ROWS = 2;

/**
 * #283: why the hour has no Crypto segment, or null when it can air. `pack.cryptoError` is the fetch error, if any.
 * The text is what the produce log and the air-check report say: "crypto: feed unavailable (...)".
 */
export function cryptoUnavailable(pack) {
  const n = (pack?.crypto || []).length;
  if (n >= CRYPTO_MIN_ROWS) return null;
  return `feed unavailable (${pack?.cryptoError ? `/api/market: ${pack.cryptoError}` : `only ${n} crypto row${n === 1 ? "" : "s"} from /api/market`})`;
}

/**
 * #283: what a producer run does about Crypto, as produce.mjs applies it. A Crypto slot in the run whose feed is down
 * turns into headlines and music (in place, as before); the note is what programme.json records under `crypto`.
 * A full run (from the top) with no Crypto slot records why; a partial run without one changes nothing (null).
 * @param {object[]} slots  the run's slots (mutated: a Crypto slot without rows becomes music)
 * @param {object} pack
 * @param {{ useGrid: boolean, special?: boolean, fullRun: boolean }} o
 * @returns {{ status: string, why?: string, rows?: number } | null}
 */
export function cryptoForRun(slots, pack, { useGrid, special = false, fullRun }) {
  if (slots.some((s) => s.segment === "crypto")) {
    const why = cryptoUnavailable(pack);
    if (!why) return { status: "on air", rows: pack.crypto.length };
    for (const s of slots) if (s.segment === "crypto") { s.kind = "music"; s.segment = null; s.title = null; }
    return { status: "feed unavailable", why: `crypto: ${why}` };
  }
  if (!fullRun) return null;
  if (special) return { status: "not in the special", why: "crypto: the election night special has no Crypto segment" };
  if (!useGrid) return { status: "grid off", why: "crypto: the grid is off (RADIO_GRID_ENABLED is not 1), so the hour has no Crypto segment" };
  return { status: "no slot", why: "crypto: no music break long enough for the Crypto segment this hour" };
}

/** Rows the right rail's markets block shows (the programme screen's slice; more pushes the weather block off screen). */
export const RAIL_MARKET_ROWS = 5;
/** Crypto rows in that block at most: Bitcoin, Ether and the biggest mover among the other coins. */
export const RAIL_CRYPTO_ROWS = 3;

/**
 * #283: the right rail's markets block for a grid hour, RAIL_MARKET_ROWS rows at most, verbatim from the pack: market
 * rows first (the exchanges in session lead), then Bitcoin, Ether and the biggest 24-hour mover among the other coins.
 * Without crypto rows (feed down) it is the market rows alone: no placeholder. Pure.
 * @param {{ markets?: object[], crypto?: object[] }} pack
 * @param {{ lead?: string[] }} [o]  market groups in session (grid.applyPlan's marketsLead)
 */
export function railMarkets(pack, { lead = [] } = {}) {
  const mk = (pack?.markets || []).filter((r) => r.group !== "Crypto");
  const led = [...mk.filter((r) => lead.includes(r.group)), ...mk.filter((r) => !lead.includes(r.group))];
  const coins = pack?.crypto?.length ? pack.crypto : (pack?.markets || []).filter((r) => r.group === "Crypto");   // the markets fetch's own Bitcoin row
  const core = ["BTC", "ETH"].map((sym) => coins.find((c) => c.sym === sym)).filter(Boolean);
  const movers = coins.filter((c) => !core.includes(c) && Number.isFinite(c.pct)).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const crypto = [...core, ...movers].slice(0, RAIL_CRYPTO_ROWS);
  return [...led.slice(0, RAIL_MARKET_ROWS - crypto.length), ...crypto].slice(0, RAIL_MARKET_ROWS);
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
 * @returns {Promise<{ builtAt, state, top: story[], desks: {[desk]: story[]}, markets, weather, dropped, crypto? }>}
 *   story = { id, headline, outlets: [{source, title, description, published}], count }
 */
export async function buildFactPack({ base = "https://scoopfeeds.com", fetchImpl = fetch, now = Date.now(), log = () => {}, crypto = false, cryptoRetryMs } = {}) {
  const opts = { fetchImpl, log };
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

  const out = { builtAt: now, state, top, desks, markets, weather, dropped };
  // the grid's Crypto segment (#200) only: without `crypto` the pack is exactly what it was
  // #283: the reason is kept, so the produce log and the air check can say why the hour has no Crypto segment
  if (crypto) { try { out.crypto = await fetchCrypto(base, { ...opts, retryMs: cryptoRetryMs }); } catch (e) { log(`crypto failed: ${e.message}`); out.crypto = []; out.cryptoError = String(e.message).slice(0, 200); } }
  return out;
}

/** Every story id in the pack -> story. */
export function storyIndex(pack) {
  const m = new Map();
  for (const s of pack.top) m.set(s.id, s);
  for (const list of Object.values(pack.desks)) for (const s of list) m.set(s.id, s);
  return m;
}
