/**
 * radioNow.js — what ScoopFeeds Radio is SCHEDULED to air this hour and next (#261), for the site.
 *
 * Pure: computed from the channel grid (`programme/grid.js` planHour / nextFeature) and two env vars, with no
 * I/O and no stored state, so it answers the same in every process role (web, scheduler, worker).
 *
 * `basis: "schedule"` is the contract: this is the plan, NOT a confirmation that the station is on air. What
 * actually airs is known only on the playout Mac (repeats, a failed air check, the PAUSE file all change it), and
 * no now-playing feed reaches the VPS. The site must word it as "Scheduled now", never "Live".
 *
 *   RADIO_GRID_ENABLED     literally "1" → the grid labels the hours, exactly as produce.mjs decides. Anything
 *                          else → `now` and `next` are null (the older running order has no hour label to show,
 *                          and we do not invent one).
 *   RADIO_PUBLIC_WATCH_URL a public http(s) URL to watch the station (e.g. the channel's /live page). Not a
 *                          secret. Unset or not an http(s) URL → `watchUrl: null` and the site shows no Listen
 *                          control. Deliberately NOT derived from RADIO_YT_STREAM_ID, which is the ingest stream.
 */
import { planHour, nextFeature } from "./programme/grid.js";

const HOUR_MS = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();

export const gridEnabled = (env = process.env) => env.RADIO_GRID_ENABLED === "1";

/** The public watch URL, or null when unset or not an http(s) URL. */
export function publicWatchUrl(env = process.env) {
  const raw = String(env.RADIO_PUBLIC_WATCH_URL || "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const featureOf = (p) => (p.feature ? { title: p.feature.title, promo: p.feature.promo } : null);

/**
 * @param {number} nowMs  the instant to answer for (Date.now() in the route)
 * @param {object} env    process.env by default
 */
export function buildRadioNow(nowMs = Date.now(), env = process.env) {
  if (!Number.isFinite(nowMs)) throw new Error("buildRadioNow: nowMs must be a number");
  const h0 = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  let now = null, next = null, nf = null;
  if (gridEnabled(env)) {
    const p = planHour(h0);
    const q = planHour(h0 + HOUR_MS);
    now = { label: p.label, daypart: p.daypart, startsAt: iso(h0), endsAt: iso(h0 + HOUR_MS), feature: featureOf(p) };
    next = { label: q.label, daypart: q.daypart, startsAt: iso(h0 + HOUR_MS), feature: featureOf(q) };
    const f = nextFeature(nowMs);
    nf = f ? { at: iso(f.at), title: f.title, promo: f.promo } : null;
  }
  return { basis: "schedule", now, next, nextFeature: nf, watchUrl: publicWatchUrl(env), updatedAt: iso(nowMs) };
}
