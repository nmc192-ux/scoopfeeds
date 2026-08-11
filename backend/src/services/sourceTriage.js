/**
 * sourceTriage.js — classification logic behind `npm run source:triage`.
 *
 * Pure functions only: no network, no DB, no clock. The CLI
 * (scripts/source-triage.mjs) does the I/O and hands the rows in here, so the
 * decision rules are unit-testable and the same rules apply to a live probe
 * and to a replayed snapshot.
 *
 * ── The two identifier schemes ──────────────────────────────────────────────
 * A source is written to `source_health` under one key and to `ingestion_logs`
 * under a DIFFERENT one:
 *
 *              source_health.source_name      ingestion_logs.source_name
 *   RSS        <name>                          <name>
 *   YouTube    yt:<name>                       YouTube:<name>
 *
 * (rssFetcher.js:201/220 and videoFetcher.js:99/115 vs :101/117.) Nothing joins
 * the two tables today, which is why the mismatch has gone unnoticed. Every
 * join in here goes through healthKey()/logKey() rather than raw names.
 *
 * ── Why orphan rows exist ───────────────────────────────────────────────────
 * `source_health` is keyed on source_name alone and is never reconciled against
 * config. Deleting an entry from config/sources.js therefore does NOT delete
 * its health row — the row simply stops being updated and keeps its final
 * counters forever, indistinguishable in the API from a source that is failing
 * right now. Renaming a source has the same effect: the new name starts a fresh
 * row and the old one is stranded.
 */

/** Health-table key for a configured source. */
export function healthKey(source, kind) {
  return kind === "yt" ? `yt:${source.name}` : source.name;
}

/** ingestion_logs key for a configured source (deliberately different — see header). */
export function logKey(source, kind) {
  return kind === "yt" ? `YouTube:${source.name}` : source.name;
}

/**
 * Build the set of health keys that configuration currently expects to exist.
 */
export function configuredHealthKeys(rssSources, youtubeSources) {
  const keys = new Map();
  for (const s of rssSources) keys.set(healthKey(s, "rss"), { ...s, kind: "rss" });
  for (const s of youtubeSources) keys.set(healthKey(s, "yt"), { ...s, kind: "yt" });
  return keys;
}

/**
 * Split health rows against config.
 *
 *   active   — configured AND has a health row (the only rows worth triaging)
 *   orphan   — health row with no config entry. NOT a dead source: nothing
 *              fetches it, so its counters are frozen at whatever they were
 *              when the config entry was removed. Sweep, don't "retire".
 *   unfetched— configured but no health row yet (added and never yet run)
 */
export function reconcile(healthRows, configuredKeys) {
  const byKey = new Map(healthRows.map((r) => [r.source_name, r]));
  const active = [];
  const orphan = [];
  const unfetched = [];

  for (const row of healthRows) {
    const cfg = configuredKeys.get(row.source_name);
    if (cfg) active.push({ ...row, config: cfg });
    else orphan.push(row);
  }
  for (const [key, cfg] of configuredKeys) {
    if (!byKey.has(key)) unfetched.push({ source_name: key, config: cfg });
  }
  return { active, orphan, unfetched };
}

// ── Probe classification ────────────────────────────────────────────────────

/**
 * Verdicts, and what each one means for the triage buckets the ops task asks
 * for. `action` is the recommendation; it is advisory, never applied
 * automatically — config edits and prod behaviour changes are DrJ's call.
 */
export const VERDICTS = {
  healthy:      { bucket: "keep",   action: "none — feed parses and has items" },
  moved:        { bucket: "fix",    action: "update url to the redirect target" },
  ua_gated:     { bucket: "fix",    action: "needs a browser User-Agent (fetcher has no per-source override today)" },
  not_a_feed:   { bucket: "fix",    action: "url returns 200 but not a feed — find the current feed url" },
  timeout:      { bucket: "fix",    action: "slow origin — needs a longer per-source timeout, or retire" },
  forbidden:    { bucket: "review", action: "403 to both UAs — bot/IP blocking; confirm from a prod-like IP before retiring" },
  rate_limited: { bucket: "review", action: "429 — back off; not a dead source" },
  server_error: { bucket: "review", action: "5xx — origin-side; re-probe before acting" },
  not_found:    { bucket: "retire", action: "404/410 to both UAs — feed is gone; find a replacement or delete the entry" },
  dns:          { bucket: "retire", action: "host does not resolve — delete the entry" },
  tls:          { bucket: "review", action: "TLS failure — could be origin misconfiguration, not death" },
  unreachable:  { bucket: "review", action: "transport failed for another reason — see raw error" },
};

/**
 * Classify one probed source.
 *
 * `prod` is the result of fetching with the production User-Agent; `browser` is
 * an optional second attempt with a stock desktop UA, used ONLY to tell
 * "this origin rejects our UA" apart from "this origin rejects everyone".
 * Each is { ok, status, isFeed, itemCount, finalUrl, curlExit, transportError }.
 */
export function classifyProbe({ url, prod, browser = null }) {
  const verdict = decide({ url, prod, browser });
  return { url, verdict, ...VERDICTS[verdict], prod, browser };
}

function decide({ url, prod, browser }) {
  if (prod?.ok) {
    // Worked, but the origin redirected us somewhere else — the config URL is
    // stale even though ingestion still succeeds. Worth fixing before the
    // redirect is eventually dropped.
    if (prod.finalUrl && differsMeaningfully(url, prod.finalUrl)) return "moved";
    return "healthy";
  }

  // Our UA is the problem: a stock browser UA gets a real feed.
  if (browser?.ok) return "ua_gated";

  // Transport-level failures never reached HTTP.
  const transport = classifyTransport(prod) || classifyTransport(browser);
  if (transport) return transport;

  // Prefer the browser attempt's status when the two disagree — if a browser UA
  // still 404s, the resource really is gone.
  const status = browser?.status || prod?.status || 0;
  if (status === 404 || status === 410) return "not_found";
  if (status === 403 || status === 401) return "forbidden";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  if (status === 200) return "not_a_feed"; // 200 but no <rss>/<feed>/<rdf> root, or zero items
  return "unreachable";
}

function classifyTransport(r) {
  if (!r) return null;
  return r.transportKind || null;
}

/**
 * Normalise an rss-parser failure into the shape classifyProbe() reads.
 *
 * The probe deliberately uses the production Parser, so the strings it throws
 * are byte-identical to what `ingestion_logs.error_msg` already holds in prod —
 * "Status code 403", "Status code 404", "Request timed out after 15000ms".
 * That means a triage run and the historical log can be compared directly.
 */
export function normalizeParserError(message) {
  const msg = String(message || "");

  const status = /Status code (\d{3})/.exec(msg);
  if (status) return { status: Number(status[1]), transportKind: null, raw: msg };

  if (/timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(msg)) return { status: 0, transportKind: "timeout", raw: msg };
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/i.test(msg)) return { status: 0, transportKind: "dns", raw: msg };
  if (/certificate|CERT_|SSL|TLS|self[- ]signed/i.test(msg)) return { status: 0, transportKind: "tls", raw: msg };

  // rss-parser reached the origin and got bytes it could not parse as a feed —
  // an HTML hub page where a feed used to be. That is a wrong URL, not a
  // dead host, so it must not fall through to "unreachable".
  if (/Feed not recognized|Unexpected close tag|Non-whitespace before first tag|Invalid character|Attribute without value|Unexpected end/i.test(msg)) {
    return { status: 200, transportKind: null, isFeed: false, itemCount: 0, raw: msg };
  }

  return { status: 0, transportKind: null, raw: msg };
}

/**
 * Did the origin redirect us somewhere that makes the configured URL wrong?
 * Ignores the http→https upgrade and a trailing slash, which are not "moved".
 */
export function differsMeaningfully(configured, final) {
  const norm = (u) => {
    try {
      const p = new URL(u);
      return `${p.hostname.replace(/^www\./, "")}${p.pathname.replace(/\/$/, "")}${p.search}`;
    } catch {
      return String(u || "");
    }
  };
  return norm(configured) !== norm(final);
}

// ── Cohort detection ────────────────────────────────────────────────────────

/**
 * Find groups of sources that stopped working at the same moment.
 *
 * Sources that break for their own reasons break on their own schedules. When
 * several share a last-success DAY *and* an identical consecutive_failures
 * count, they have failed in lockstep in every cycle since the same instant —
 * that is a shared cause (a config change, a UA change, a network/egress
 * change), not three coincidences, and it should be root-caused once rather
 * than triaged three times.
 *
 * `dayOf` converts an epoch-ms timestamp to a YYYY-MM-DD bucket; injected so
 * the caller owns the timezone choice and tests stay deterministic.
 */
export function findCohorts(rows, dayOf) {
  const failing = rows.filter((r) => (r.consecutive_failures || 0) > 0 && r.last_success);
  const groups = new Map();

  for (const r of failing) {
    const day = dayOf(r.last_success);
    const key = `${day}|${r.consecutive_failures}`;
    if (!groups.has(key)) {
      groups.set(key, { day, consecutiveFailures: r.consecutive_failures, members: [] });
    }
    groups.get(key).members.push(r);
  }

  return [...groups.values()]
    .filter((g) => g.members.length > 1)
    .sort((a, b) => b.members.length - a.members.length || a.day.localeCompare(b.day));
}

/**
 * Cross-check a failure counter against elapsed time.
 *
 * consecutive_failures only ever increments on a failed fetch and resets to 0
 * on a success, so for a source that has failed continuously since its last
 * success the count MUST equal the number of cycles that have elapsed since.
 * When it is materially lower, the source was not attempted on every cycle —
 * i.e. the ingestion cycle itself was not running for part of the window, or
 * the cron cadence differs from the one assumed here. Either way the shortfall
 * is about the SCHEDULER, not about the source, and it changes who to blame.
 *
 * Returns null for sources that have never succeeded (no interval to measure).
 */
export function failureBudget(row, { now, cyclesPerDay }) {
  if (!row.last_success) return null;
  const elapsedMs = now - row.last_success;
  if (elapsedMs <= 0) return null;
  const days = elapsedMs / 86400000;
  const expected = Math.round(days * cyclesPerDay);
  const observed = row.consecutive_failures || 0;
  const ratio = expected > 0 ? observed / expected : 0;
  return {
    days: Number(days.toFixed(1)),
    expected,
    observed,
    ratio: Number(ratio.toFixed(2)),
    // Counters drift a little (a cycle can overrun, a process can restart), so
    // only a substantial shortfall is worth reporting.
    shortfall: ratio < 0.9,
  };
}

/**
 * Sources that have never once succeeded. `last_success IS NULL` together with
 * total_articles = 0 means the entry has been wrong since the day it was added
 * — no regression to investigate, just a bad URL or a dead feed.
 */
export function neverWorked(rows) {
  return rows
    .filter((r) => !r.last_success && (r.total_articles || 0) === 0 && (r.consecutive_failures || 0) > 0)
    .sort((a, b) => (b.consecutive_failures || 0) - (a.consecutive_failures || 0));
}

/**
 * Wasted fetches per day implied by the current failure set.
 *
 * fetchAllSources() walks the whole configured list every cycle regardless of
 * history (rssFetcher.js:239-255) — there is no backoff, quarantine or retry
 * ceiling — so a source that has failed 6,971 times is still attempted on the
 * next cycle. `cyclesPerDay` comes from the caller's cron reading.
 */
export function wasteEstimate(activeRows, { rssCyclesPerDay, ytCyclesPerDay }) {
  let rss = 0;
  let yt = 0;
  for (const r of activeRows) {
    if ((r.consecutive_failures || 0) <= 0) continue;
    if (r.config?.kind === "yt") yt++;
    else rss++;
  }
  return {
    failingRss: rss,
    failingYt: yt,
    fetchesPerDay: rss * rssCyclesPerDay + yt * ytCyclesPerDay,
  };
}
