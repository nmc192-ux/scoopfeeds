/**
 * filmRotation.js — plan a day of ScoopFeeds films, Shorts fillers and promos for the radio
 * channel (#203). Pure: takes the library from filmLibrary.js, returns a plan. Playout is the
 * encoder's job (playout/), never the browser's.
 *
 * RULES
 *  - Full films only in fixed grid slots (US Eastern, radio is US-first). PRIME slots go to the
 *    newest episode of each series while it is under NEW_DAYS old.
 *  - No film repeats within MIN_GAP_MS of its last airing (`recent` seeds this from yesterday).
 *    When nothing eligible is left a slot is left EMPTY and reported, not filled with a repeat.
 *  - Shorts fill the break after each film slot, up to BREAK_SEC, never repeating within the gap.
 *  - A promo ("New episode of X, Sunday") is produced from metadata for each film in the plan
 *    that is under NEW_DAYS old, placed PROMO_LEAD_MS before its slot.
 */
import { easternMinutes } from "./musicLibrary.js";

export const MIN_GAP_MS = 6 * 3600_000;
export const NEW_DAYS = 7;
export const BREAK_SEC = 5 * 60;
export const PROMO_LEAD_MS = 30 * 60_000;
// Eastern hours. The channel grid (#200) is not merged yet; these are the defaults it will override.
export const DEFAULT_SLOT_HOURS = [
  { hour: 8, prime: false }, { hour: 13, prime: false }, { hour: 19, prime: true }, { hour: 21, prime: true },
];

/** The instant of `hour`:00 US Eastern on calendar day "YYYY-MM-DD" (handles EST/EDT). */
export function easternInstant(day, hour) {
  for (const offset of [4, 5]) {
    const d = new Date(Date.parse(`${day}T00:00:00Z`) + (hour + offset) * 3600_000);
    if (easternMinutes(d) === hour * 60) return d;
  }
  throw new Error(`no Eastern instant for ${day} ${hour}:00`);
}

export function defaultSlots(day, hours = DEFAULT_SLOT_HOURS) {
  return hours.map(({ hour, prime }) => ({ at: easternInstant(day, hour), prime }));
}

const WEEKDAY = (d) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(d);

/** Promo line from episode metadata only. `airAt` names the day it will air. */
export function promoText(film, airAt) {
  return `New from ${film.seriesName}: ${film.title}. On air ${WEEKDAY(airAt)}.`;
}

/**
 * @param {{items: object[]}} library
 * @param {{ slots: {at: Date, prime?: boolean}[], recent?: {id: string, at: number}[], now?: number }} o
 */
export function planDay(library, { slots, recent = [], now = Date.now() }) {
  const films = library.items.filter((i) => i.kind === "film");
  const shorts = library.items.filter((i) => i.kind === "short");
  const lastAir = new Map(recent.map((r) => [r.id, r.at]));
  const eligible = (item, at) => {
    const prev = lastAir.get(item.id);
    return prev === undefined || at - prev >= MIN_GAP_MS;
  };
  const isNew = (f) => now - f.publishedAt < NEW_DAYS * 86_400_000;

  // newest episode of each series, newest first: the prime-slot candidates
  const newest = [];
  const seen = new Set();
  for (const f of films) if (!seen.has(f.series)) { seen.add(f.series); if (isNew(f)) newest.push(f); }

  const plan = [];
  const empty = [];
  let shortCursor = 0;
  const ordered = [...slots].sort((a, b) => a.at - b.at);

  for (const slot of ordered) {
    const at = slot.at.getTime();
    const pools = slot.prime ? [newest, films] : [films.filter((f) => !newest.includes(f)), films];
    let film = null;
    for (const pool of pools) {
      film = pool.find((f) => eligible(f, at));
      if (film) break;
    }
    if (!film) { empty.push({ at, reason: "no film outside the repeat gap" }); continue; }
    lastAir.set(film.id, at);
    if (isNew(film)) plan.push({ type: "promo", at: at - PROMO_LEAD_MS, filmId: film.id, text: promoText(film, slot.at) });
    plan.push({ type: "film", at, id: film.id, file: film.file, durationSec: film.durationSec, prime: !!slot.prime });

    let used = 0;
    let cursor = at + film.durationSec * 1000;
    for (let i = 0; i < shorts.length && used < BREAK_SEC; i++) {
      const s = shorts[(shortCursor + i) % shorts.length];
      if (used + s.durationSec > BREAK_SEC || !eligible(s, cursor)) continue;
      lastAir.set(s.id, cursor);
      plan.push({ type: "short", at: cursor, id: s.id, file: s.file, durationSec: s.durationSec });
      cursor += s.durationSec * 1000;
      used += s.durationSec;
      shortCursor = (shortCursor + i + 1) % shorts.length;
      i = -1; // rescan from the new cursor so the break fills in order
      if (used >= BREAK_SEC) break;
    }
  }
  plan.sort((a, b) => a.at - b.at);
  return { plan, empty };
}
