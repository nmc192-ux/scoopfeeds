/**
 * eventsCalendar.js - scheduled live events the radio may carry (#202 item 2).
 *
 * Two sources:
 *   1. MANUAL: a JSON file DrJ edits (RADIO_LIVE_EVENTS_FILE, default events.manual.json beside this
 *      file). Each entry: { feed: "<allow-list id>", url, title, start: ISO, end?: ISO, maxMinutes? }.
 *   2. PUBLISHER SCHEDULES: upcoming streams the publisher has announced on its own YouTube channel
 *      (`<channel>/streams`, live_status "is_upcoming" with a start time). These are LISTED by default:
 *      they show up as candidates (cli.js calendar) but do not take the air unless the feed's entry in
 *      officialFeeds.js says `schedule: "auto"`, or the event is copied into the manual file. Reason: a
 *      publisher can announce a 7-hour spacewalk; without this, it would take over the grid unasked.
 *      Streams that are already live with no announced start (24/7 channels) are never picked up.
 *
 * Every event is validated against the allow-list here AND again at air time (officialFeeds.assertCanAir).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OFFICIAL_FEEDS, feedById, entryForUrl, youtubeHandleOf } from "./officialFeeds.js";
import { runCommand } from "./feedProbe.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_EVENTS_FILE = path.join(HERE, "events.manual.json");
export const DEFAULT_MAX_MINUTES = 120;
export const HARD_MAX_MINUTES = 6 * 60;

export function eventsFile(env = process.env) {
  return (env.RADIO_LIVE_EVENTS_FILE || "").trim() || DEFAULT_EVENTS_FILE;
}

const isYouTubeWatch = (url) => {
  try { const u = new URL(url); return /(^|\.)youtube\.com$|^youtu\.be$/.test(u.hostname) && !youtubeHandleOf(url); }
  catch { return false; }
};

/**
 * Normalise and check one event. Returns { event } or { error }.
 * A YouTube watch?v= URL cannot be tied to a channel without the network, so it passes here and is
 * decided by the pre-air probe; every other URL must resolve to the event's own allow-list entry now.
 */
export function validateEvent(raw, { feeds = OFFICIAL_FEEDS, source = "manual" } = {}) {
  if (!raw || typeof raw !== "object") return { error: "not an object" };
  const entry = feedById(raw.feed, feeds);
  if (!entry) return { error: `feed "${raw.feed}" is not on the allow-list` };
  const url = String(raw.url || "");
  const byUrl = entryForUrl(url, { feeds });
  if (byUrl ? byUrl.id !== entry.id : !isYouTubeWatch(url)) return { error: `${url || "(no url)"} is not a "${entry.id}" feed on the allow-list` };
  const title = String(raw.title || "").trim();
  if (!title) return { error: "no title" };
  const start = Date.parse(raw.start);
  if (!Number.isFinite(start)) return { error: `bad start "${raw.start}"` };
  const maxMinutes = Math.min(HARD_MAX_MINUTES, Number(raw.maxMinutes) > 0 ? Number(raw.maxMinutes) : DEFAULT_MAX_MINUTES);
  let end = raw.end ? Date.parse(raw.end) : start + maxMinutes * 60_000;
  if (!Number.isFinite(end) || end <= start) return { error: `bad end "${raw.end}"` };
  end = Math.min(end, start + HARD_MAX_MINUTES * 60_000);
  const id = String(raw.id || `${entry.id}:${start}:${url}`);
  return { event: { id, feed: entry.id, publisher: entry.publisher, url, title, start, end, source } };
}

/** Read the manual file. Missing file = no events; a broken file is reported, never guessed at. */
export function loadManualEvents(file, { feeds = OFFICIAL_FEEDS } = {}) {
  let list;
  try { list = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) {
    if (e.code === "ENOENT") return { events: [], rejected: [] };
    return { events: [], rejected: [{ error: `cannot read ${file}: ${e.message}` }] };
  }
  const items = Array.isArray(list) ? list : Array.isArray(list?.events) ? list.events : [];
  const events = [], rejected = [];
  for (const raw of items) {
    const r = validateEvent(raw, { feeds, source: "manual" });
    if (r.event) events.push(r.event); else rejected.push({ raw, error: r.error });
  }
  return { events, rejected };
}

export function ytStreamsArgs(channelUrl) {
  return ["--ignore-config", "--no-cookies", "--no-cookies-from-browser", "--no-warnings",
    "--flat-playlist", "--playlist-items", "1-15", "-J", channelUrl];
}

/** Upcoming announced streams in yt-dlp's flat playlist JSON. Pure. */
export function parseUpcoming(json, entry, { now = Date.now() } = {}) {
  let info;
  try { info = typeof json === "string" ? JSON.parse(json) : json; } catch { return []; }
  const out = [];
  for (const e of info?.entries || []) {
    if (e?.live_status !== "is_upcoming") continue;
    const ts = Number(e.release_timestamp || e.timestamp);
    if (!Number.isFinite(ts) || ts * 1000 < now - 6 * 3600_000) continue;
    const url = e.url && /^https:/.test(e.url) ? e.url : e.id ? `https://www.youtube.com/watch?v=${e.id}` : null;
    if (!url) continue;
    const r = validateEvent({ id: `yt:${e.id}`, feed: entry.id, url, title: e.title, start: new Date(ts * 1000).toISOString() },
      { source: "publisher", feeds: [entry] });
    if (r.event) out.push(r.event);
  }
  return out;
}

/** Announced upcoming streams from each allow-listed YouTube channel. A failure is logged and skipped. */
export async function fetchPublisherEvents({ feeds = OFFICIAL_FEEDS, run = runCommand, ytDlp = "yt-dlp", log = () => {}, now = Date.now() } = {}) {
  const events = [];
  for (const entry of feeds) {
    for (const handle of entry.youtube || []) {
      const url = `https://www.youtube.com/${handle}/streams`;
      const res = await run(ytDlp, ytStreamsArgs(url), { timeoutMs: 60_000 });
      if (res.code !== 0) { log(`calendar: ${entry.id} schedule unreadable (yt-dlp exit ${res.code})`); continue; }
      events.push(...parseUpcoming(res.stdout, entry, { now }));
    }
  }
  return events;
}

/** Will this event take the air by itself? Manual events do; publisher events only for a feed set to auto. */
export function airsAutomatically(event, feeds = OFFICIAL_FEEDS) {
  if (event.source === "manual") return true;
  return feedById(event.feed, feeds)?.schedule === "auto";
}

/** Merge, de-duplicate (same url + start, manual wins) and sort by start. */
export function mergeCalendar(...lists) {
  const byKey = new Map();
  for (const e of lists.flat()) {
    const k = `${e.url}|${e.start}`;
    const prev = byKey.get(k);
    if (!prev || (prev.source !== "manual" && e.source === "manual")) byKey.set(k, e);
  }
  return [...byKey.values()].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}
