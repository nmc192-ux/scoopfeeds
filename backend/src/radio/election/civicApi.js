/**
 * civicApi.js — free per-state vote counts for the election map (#204), from civicAPI
 * (https://civicapi.org, free, no key, attribution required: "Source: civicAPI").
 *
 * DrJ's rules (comment on #204, 22 Oct 2026) and what the spike found (docs/radio/
 * results-spike-2026-10.md):
 *  - Per-state races only. The national roll-ups (/race/87528 Senate, /race/87535
 *    governors) showed impossible numbers before polls opened; they are used for
 *    nothing but are not even fetched here. Per-state race ids come from
 *    /race/search?type=…&startDate=…&endDate=… (province "US" = a roll-up, skipped).
 *  - A named User-Agent (Python's default got HTTP 403), at most one request per race
 *    per minute, cached, sequential.
 *  - civicAPI's `winner` flag is kept for the audit trail only. It never colours a state:
 *    who sets it is unknown, and the docs say the API carries its own "calls".
 *  - Show candidates with votes > 0. When the race marks any `major_candidate`, show only
 *    those (in the 2026 per-state Senate races NO candidate is marked, so nothing is
 *    filtered by that flag there). Two candidates of one party sharing a surname (the
 *    Alaska duplicate) are shown by party only: the data cannot tell them apart.
 *  - The count's own measure is `percent_reporting`; what it measures (precincts,
 *    expected vote) is not documented, so the screen says "% reporting (civicAPI)",
 *    never "% of expected vote".
 *  - HELD, not shown: any count fetched before that race's polls close (payload
 *    `polls_close`, else 3 Nov 18:00 ET), and any count whose total exceeds the race's
 *    `registered_voters`. Measured 23 Oct 2026: the Pennsylvania governor race showed
 *    8.6 million votes for each of three candidates and "76.1% reporting" eleven days
 *    before the election. A held count keeps its reason for the audit.
 *  - Off switch: RADIO_ELECTION_COUNTS=off drops every civicAPI number from the map;
 *    RADIO_ELECTION_COUNTS_BLOCK=PA,AK drops chosen states. Read on every fetch.
 */
export const CIVIC_BASE = "https://civicapi.org/api/v2";
export const CIVIC_ATTRIBUTION = "civicAPI (civicapi.org)";
export const USER_AGENT = "ScoopFeedsRadio/1.0 (+https://scoopfeeds.com)";
export const MIN_INTERVAL_MS = 60_000;
/** First polls close 18:00 ET on 3 Nov 2026 (EST, UTC−5). */
export const EARLIEST_POLLS_CLOSE = "2026-11-03T23:00:00.000Z";

export function countsSwitch(env = process.env) {
  const off = String(env.RADIO_ELECTION_COUNTS || "").trim().toLowerCase() === "off";
  const block = new Set(String(env.RADIO_ELECTION_COUNTS_BLOCK || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean));
  return { off, block };
}

const SEARCH_TYPE = { senate: "US Senate", governor: "Governor" };

const surname = (n) => String(n || "").replace(/\b(jr|sr|ii|iii|iv)\.?\b/gi, "").replace(/[^A-Za-z\s'-]/g, " ").trim().split(/\s+/).pop()?.toLowerCase() || "";

/** One civicAPI per-state race payload → the count the map may show (or null). */
export function parseRace(json, { fetchedAt = new Date().toISOString(), now = Date.now() } = {}) {
  if (!json || typeof json !== "object") return null;
  const state = String(json.province || "").toUpperCase();
  if (!state || state === "US") return null;
  if (json.test_data === true) return null;
  const all = Array.isArray(json.candidates) ? json.candidates : [];
  let cands = all.filter((c) => Number(c.votes) > 0);
  if (cands.some((c) => c.major_candidate === true)) cands = cands.filter((c) => c.major_candidate === true);
  const clash = new Set();
  const seen = new Map();
  for (const c of cands) {
    const k = `${c.party}|${surname(c.name)}`;
    if (seen.has(k)) clash.add(k); else seen.set(k, c);
  }
  const shares = cands
    .map((c) => ({
      name: clash.has(`${c.party}|${surname(c.name)}`) ? null : String(c.name),
      party: String(c.party || ""),
      votes: Number(c.votes),
      percent: Number.isFinite(Number(c.percent)) ? Number(c.percent) : null,
    }))
    .sort((a, b) => b.votes - a.votes);
  const pr = Number(json.percent_reporting);
  const close = Date.parse(json.polls_close || "") || Date.parse(EARLIEST_POLLS_CLOSE);
  const total = cands.reduce((n, c) => n + Number(c.votes), 0);
  const reg = Number(json.registered_voters);
  let held = null;
  if (shares.length && now < close) held = "before-polls-close";
  else if (shares.length && reg > 0 && total > reg) held = "total-exceeds-registered";
  return {
    held,
    state,
    source: "civicAPI",
    sourceUrl: "https://civicapi.org",
    lastUpdated: json.last_updated || null,
    fetchedAt,
    percentReporting: Number.isFinite(pr) && pr >= 0 && pr <= 100 ? pr : null,
    shares: held ? [] : shares,
    heldShares: held ? shares : undefined,
    // Audit only — NEVER used to colour (see header).
    sourceWinner: all.filter((c) => c.winner === true).map((c) => String(c.name)),
  };
}

/**
 * A polite client. `fetchImpl` is injectable for tests. Every race is fetched at most
 * once per `intervalMs` (≥ 60 s); a failed fetch keeps the last good count.
 */
export function createCivicClient({ fetchImpl = globalThis.fetch, intervalMs = MIN_INTERVAL_MS, now = () => Date.now(), electionDate = "2026-11-03" } = {}) {
  const every = Math.max(MIN_INTERVAL_MS, Number(intervalMs) || MIN_INTERVAL_MS);
  const cache = new Map(); // url → { at, body }
  const errors = [];

  async function getJson(url) {
    const hit = cache.get(url);
    if (hit && now() - hit.at < every) return hit.body;
    try {
      const res = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      cache.set(url, { at: now(), body });
      return body;
    } catch (err) {
      errors.push({ url, error: String(err?.message || err), at: new Date(now()).toISOString() });
      if (hit) { hit.at = now(); return hit.body; } // keep the last good copy, don't hammer
      cache.set(url, { at: now(), body: null });
      return null;
    }
  }

  /** state → race id for one race type, from the search endpoint. */
  async function raceIds(race) {
    const type = SEARCH_TYPE[race];
    if (!type) return new Map();
    const url = `${CIVIC_BASE}/race/search?type=${encodeURIComponent(type)}&startDate=${electionDate}&endDate=${electionDate}&limit=100`;
    const body = await getJson(url);
    const out = new Map();
    for (const r of body?.races || []) {
      const st = String(r.province || "").toUpperCase();
      if (st && st !== "US" && !out.has(st)) out.set(st, r.id);
    }
    return out;
  }

  /** Per-state counts for one race type: Map<state, parsed>. Sequential on purpose. */
  const held = [];

  async function counts(race, env = process.env) {
    const sw = countsSwitch(env);
    const out = new Map();
    if (sw.off) return out;
    const ids = await raceIds(race);
    for (const [state, id] of ids) {
      const body = await getJson(`${CIVIC_BASE}/race/${id}`);
      const parsed = parseRace(body, { fetchedAt: new Date(now()).toISOString(), now: now() });
      if (!parsed || parsed.state !== state || sw.block.has(state)) continue;
      if (parsed.held) held.push({ race, state, reason: parsed.held, at: parsed.fetchedAt });
      out.set(state, parsed);
    }
    return out;
  }

  return { counts, raceIds, errors, held };
}
