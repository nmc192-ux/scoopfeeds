/**
 * developing.js - "Developing" stories for ScoopFeeds Radio (#201): which events in the event graph are new or
 * growing fast right now. Runs on the WORKER inside the radio state cycle (every ~5 minutes) and writes
 * $SCOOP_PERSISTENT_DATA_DIR/radio/developing.json atomically; the Mac's rolling station reads it through
 * GET /api/radio/developing.json and decides what interrupts the air (programme/developing.js).
 * Dark unless RADIO_DEVELOPING_ENABLED is "1" (and RADIO_ENABLED, like every radio route).
 *
 * An event FIRES when, in the last `windowMin` minutes, it gained at least `minArticles` articles from at least
 * `minOutlets` distinct outlets that pass the radio's Rule 0 layer, AND that is at least `growthRatio` times its
 * own rate over the `baselineHours` before (a newly promoted event has no baseline, so the absolute floor
 * decides). A long-running story with a steady trickle does not fire; the same story suddenly surging does.
 *
 * Machine events (USGS/NOAA) count only once they have articles: the query is driven by event_articles, so an
 * event without articles never appears (CLAUDE.md, "Machine events").
 *
 * Rule 0, fail closed: every article passes radioRulesVerdict (D1, Pakistan politics, Indian outlet on Pakistan,
 * critical of Pakistan, soft news) and opinion URLs are dropped. The radio's LLM judge is NOT run here, so any
 * event whose surviving articles carry a Pakistan signal is dropped whole rather than aired unjudged.
 *
 * Every time is "as of `now`": rows linked or fetched after `now` are invisible, so the same function replays a
 * recorded day (developingReplay.mjs) exactly as it would have run live.
 *
 * DEFAULTS ARE UNVERIFIED: they are a starting point until the GROUND replay on a prod snapshot sets them
 * (docs/radio/developing.md). Each is overridable by env (RADIO_DEV_*).
 */
import path from "node:path";
import { radioRulesVerdict, hasPakistanSignal, isRadioSensitive } from "./radioRules.js";

export const DEV_DEFAULTS = Object.freeze({
  windowMin: 30,        // the "last 30 minutes" of the spec
  minArticles: 4,       // airable articles linked in the window
  minOutlets: 3,        // distinct airable outlets in the window
  baselineHours: 6,     // the event's own rate before the window...
  growthRatio: 3,       // ...the window must beat it this many times
  followMin: 60,        // a fired story stays in the headlines while it gained...
  followArticles: 2,    // ...at least this many articles in the last hour
  maxOutlets: 8,        // outlets carried per event (one article each, newest first)
  maxEvents: 20,
});

export function developingEnabled(env = process.env) {
  const v = String(env.RADIO_DEVELOPING_ENABLED || "").trim().toLowerCase();
  return v === "1" || v === "true";
}

export function developingPath() {
  const base = process.env.SCOOP_PERSISTENT_DATA_DIR || path.resolve("data");
  return path.join(base, "radio", "developing.json");
}

const num = (v, d, min = 0) => { const n = Number(v); return v !== undefined && v !== "" && Number.isFinite(n) && n >= min ? n : d; };
/** Thresholds from env (RADIO_DEV_WINDOW_MIN, _MIN_ARTICLES, _MIN_OUTLETS, _BASELINE_H, _GROWTH, _FOLLOW_MIN, _FOLLOW_ARTICLES). */
export function devThresholds(env = process.env) {
  const d = DEV_DEFAULTS;
  return {
    ...d,
    windowMin: num(env.RADIO_DEV_WINDOW_MIN, d.windowMin, 5),
    minArticles: num(env.RADIO_DEV_MIN_ARTICLES, d.minArticles, 1),
    minOutlets: num(env.RADIO_DEV_MIN_OUTLETS, d.minOutlets, 1),
    baselineHours: num(env.RADIO_DEV_BASELINE_H, d.baselineHours, 1),
    growthRatio: num(env.RADIO_DEV_GROWTH, d.growthRatio, 1),
    followMin: num(env.RADIO_DEV_FOLLOW_MIN, d.followMin, 10),
    followArticles: num(env.RADIO_DEV_FOLLOW_ARTICLES, d.followArticles, 1),
  };
}

const OPINION = /\/(opinion|opinions|op-ed|oped|commentary|columns?|editorials?|analysis\/opinion)\//i;

/** Rule 0 for one article (the factPack.js layer): null when it may air, else why not. */
export function articleBlock(a) {
  if (Number(a.is_duplicate) === 1) return "duplicate";
  if (a.category === "sports") return "sports";
  if (OPINION.test(a.url || "")) return "opinion";
  const v = radioRulesVerdict({ title: a.title, description: a.description, source_name: a.source_name, category: a.category });
  return v.allowed ? null : (v.rule || "rule0");
}

/**
 * Events with any article linked in the follow window, with their linked articles from the window and the
 * baseline before it. One query for the events, one for their articles. Pure read.
 */
export function loadActivity(db, now, t) {
  const since = now - Math.max(t.windowMin, t.followMin) * 60_000;
  const baseFrom = now - t.windowMin * 60_000 - t.baselineHours * 3_600_000;
  const events = db.prepare(`
    SELECT e.id, e.slug, e.title, e.category, e.created_at, e.meta
    FROM events e
    WHERE e.status = 'active' AND e.created_at <= ?
      AND EXISTS (SELECT 1 FROM event_articles ea WHERE ea.event_id = e.id AND ea.added_at > ? AND ea.added_at <= ?)
  `).all(now, since, now);
  if (!events.length) return [];
  const arts = db.prepare(`
    SELECT ea.added_at, a.id, a.title, a.description, a.url, a.source_name, a.category, a.is_duplicate, a.published_at, a.fetched_at
    FROM event_articles ea JOIN articles a ON a.id = ea.article_id
    WHERE ea.event_id = ? AND ea.added_at > ? AND ea.added_at <= ? AND COALESCE(a.fetched_at, 0) <= ?
    ORDER BY ea.added_at DESC
  `);
  return events.map((e) => ({ ...e, articles: arts.all(e.id, baseFrom, now, now) }));
}

/**
 * Score one event as of `now`. Pure.
 * @returns {{ fires, follow, why, recent, lastHour, baseline, ratio, outlets, headline, sensitive, blocked }}
 */
export function scoreEvent(ev, now, t) {
  const W = t.windowMin * 60_000;
  const blocked = {};
  const ok = [];
  for (const a of ev.articles || []) {
    const b = articleBlock(a);
    if (b) { blocked[b] = (blocked[b] || 0) + 1; continue; }
    if (!String(a.source_name || "").trim() || !String(a.title || "").trim()) { blocked.unnamed = (blocked.unnamed || 0) + 1; continue; }
    ok.push(a);
  }
  const inWin = ok.filter((a) => a.added_at > now - W);
  const inHour = ok.filter((a) => a.added_at > now - t.followMin * 60_000);
  const before = ok.filter((a) => a.added_at <= now - W);
  const outletsOf = (list) => new Set(list.map((a) => a.source_name.trim()));
  const recent = { articles: inWin.length, outlets: outletsOf(inWin).size };
  const lastHour = { articles: inHour.length, outlets: outletsOf(inHour).size };
  // the baseline, per window-length, over the hours before the window (0 for a new event)
  const baseline = before.length / Math.max(1, (t.baselineHours * 60) / t.windowMin);
  const ratio = baseline > 0 ? recent.articles / baseline : Infinity;
  const pk = ok.some((a) => hasPakistanSignal(a));
  const isNew = ev.created_at > now - W;

  let why = null;
  if (pk) why = "Pakistan signal (the LLM judge does not run here: dropped, fail closed)";
  else if (recent.outlets < t.minOutlets) why = `${recent.outlets} outlet(s) in ${t.windowMin} min (< ${t.minOutlets})`;
  else if (recent.articles < t.minArticles) why = `${recent.articles} article(s) in ${t.windowMin} min (< ${t.minArticles})`;
  else if (ratio < t.growthRatio) why = `steady, not surging: ${recent.articles} vs a baseline of ${baseline.toFixed(1)} per ${t.windowMin} min (< ${t.growthRatio}x)`;

  // one article per outlet, newest first; on-screen and spoken facts come only from these, verbatim
  const outlets = [];
  for (const a of [...ok].sort((x, y) => y.added_at - x.added_at)) {
    if (outlets.some((o) => o.source === a.source_name.trim())) continue;
    outlets.push({ source: a.source_name.trim(), title: String(a.title).trim(), description: String(a.description || "").trim().slice(0, 420), published: Number(a.published_at) || null, url: a.url || null });
    if (outlets.length >= t.maxOutlets) break;
  }
  // the headline: the newest window article's own title, verbatim (the event title is ours, not an outlet's)
  const headline = inWin[0] ? String(inWin[0].title).trim() : (outlets[0]?.title || "");
  return {
    fires: !why, follow: !pk && lastHour.articles >= t.followArticles, why, kind: isNew ? "new" : "growing",
    recent, lastHour, baseline: Math.round(baseline * 100) / 100, ratio: Number.isFinite(ratio) ? Math.round(ratio * 10) / 10 : null,
    outlets, headline, sensitive: isRadioSensitive(ok.map((a) => a.title)), blocked,
  };
}

/**
 * The developing list as of `now`: events that fire, then those that only qualify for follow-up, strongest first.
 * @returns {{ updatedAt, thresholds, events: object[], considered, fired }}
 */
export function buildDeveloping(db, { now = Date.now(), env = process.env, thresholds = null } = {}) {
  const t = thresholds || devThresholds(env);
  const rows = loadActivity(db, now, t);
  const scored = rows.map((ev) => ({ ev, s: scoreEvent(ev, now, t) })).filter(({ s }) => s.fires || s.follow);
  scored.sort((a, b) => (b.s.fires - a.s.fires) || (b.s.recent.outlets - a.s.recent.outlets) || (b.s.recent.articles - a.s.recent.articles) || (b.s.lastHour.articles - a.s.lastHour.articles));
  const events = scored.slice(0, t.maxEvents).map(({ ev, s }) => ({
    id: ev.id, slug: ev.slug, category: ev.category, createdAt: ev.created_at,
    headline: s.headline, kind: s.kind, fires: s.fires, follow: s.follow, why: s.why,
    recent: s.recent, lastHour: s.lastHour, baseline: s.baseline, ratio: s.ratio, sensitive: s.sensitive, outlets: s.outlets,
  }));
  return { updatedAt: now, thresholds: t, events, considered: rows.length, fired: events.filter((e) => e.fires).length };
}
