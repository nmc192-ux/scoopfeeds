/**
 * clock.js - the fixed running order of a one-hour ScoopFeeds Radio programme.
 *
 * Every slot is placed by its offset in seconds from the top of the hour (H). The
 * pre-roll starts 15 minutes before H; the stream ends 30 s after H+60:00. Pure data:
 * the producer fills the spoken slots and the screen plays the cues; nothing here
 * reads a clock.
 *
 *   kind     what fills it
 *   ident    a Signal ident (visual + its sonic WAV), mode id | top
 *   spoken   a script read by the voice, over a ducked bed
 *   music    the bed at full level, rotating headline cards on screen
 *   film     one Short cut from a published long-form film (#216), played with its own sound; with no
 *            eligible Short the slot is music (headlines and the bed), never "ScoopFeeds 60"
 *   feature  a full episode (this week's A-Eye), played with its own sound
 *   series   "This week on ScoopFeeds" cards over the bed
 *   countdown / endcard   holding slates over the bed
 *
 * `sting: true` puts the 3 s Signal sting (visual + sonic) over the first 3 s of the slot.
 */
import { planHour, applyPlan } from "./grid.js";

export const PREROLL_SEC = 15 * 60;
export const TAIL_SEC = 30;

// [id, startSec, endSec, kind, extra]
const ORDER = [
  ["countdown", -900, -4, "countdown", { bed: "full" }],
  ["ident-top", -4, 6, "ident", { mode: "top" }],
  ["the-hour", 6, 360, "spoken", { segment: "the-hour", title: "The Hour", stories: 5 }],
  ["markets-1", 360, 480, "spoken", { segment: "markets", title: "Markets Now", sting: true, daypart: "markets" }],
  ["compared-1", 480, 840, "spoken", { segment: "compared", title: "The News, Compared", sting: true, daypart: "evening" }],
  ["music-1", 840, 1200, "music", { sting: true, nextAt: 1200, nextTitle: "Middle East desk" }],
  ["desk-me", 1200, 1380, "spoken", { segment: "desk", desk: "middle-east", title: "Middle East desk", sting: true }],
  ["desk-us", 1380, 1560, "spoken", { segment: "desk", desk: "us", title: "US desk: politics and economy" }],
  ["film", 1560, 1620, "film", { sting: true, title: "From the films" }],
  ["series", 1620, 1710, "series", { title: "This week on ScoopFeeds" }],
  ["music-2", 1710, 1792, "music", {}],
  ["ident-half", 1792, 1800, "ident", { mode: "id" }],
  ["half", 1800, 1980, "spoken", { segment: "half", title: "Headlines at the half hour", stories: 5 }],
  ["weather", 1980, 2070, "spoken", { segment: "weather", title: "Weather around the world" }],
  ["desk-tech", 2070, 2250, "spoken", { segment: "desk", desk: "tech", title: "Tech and AI desk", sting: true }],
  ["music-3", 2250, 2640, "music", { nextAt: 2640, nextTitle: "Business desk" }],
  ["desk-biz", 2640, 2820, "spoken", { segment: "desk", desk: "business", title: "Business desk", sting: true, daypart: "markets" }],
  ["compared-2", 2820, 3060, "spoken", { segment: "compared", title: "The News, Compared", sting: true, daypart: "evening" }],
  ["markets-2", 3060, 3150, "spoken", { segment: "markets", title: "Markets Now", sting: true, daypart: "markets" }],
  ["music-4", 3150, 3480, "music", { nextAt: 3480, nextTitle: "Sign-off" }],
  ["signoff", 3480, 3525, "spoken", { segment: "signoff", title: "ScoopFeeds Radio" }],
  ["ident-end", 3525, 3533, "ident", { mode: "id" }],
  ["endcard", 3533, 3600 + TAIL_SEC, "endcard", { fadeFrom: 3570, silentFrom: 3600 }],
];

/**
 * #285 (RADIO_CLOCK_V15, DrJ's rehearsal notes of 28 Oct, #281 note 1): longer bulletins, fewer repeats, less music.
 *   - The Hour reads 7 stories (world, business, sport), each the headline plus 3-4 sentences of context (~60-80 s)
 *   - a 3-minute Sport slot right after it (earn-render: no sport stories, its time goes to The Hour, produce.mjs)
 *   - the half-hour reads only stories not read at :00 (`fresh`); under 3 of them it says so in one line (checks.js)
 *   - every music block is 90 s at most: 270 s an hour, 330 s when the film slot has no Short; in a grid hour the
 *     Crypto segment takes music-1 (`cryptoDonor`), so 180 s. music-3 and music-4 stay as #249's repeat donors.
 *   - the Tech and AI desk is "Science, Tech and AI"; the US desk moves to the second half (`electionDonor`: the
 *     Midterms desk and the counting desk take its place, electionDesk.js / electionNight.js)
 *   - the second half's head (half, weather, desk-tech) is today's, so the feature still starts at FEATURE_AT and
 *     FEATURE_MAX is unchanged
 * Off unless RADIO_CLOCK_V15 is literally "1"; off, every hour is ORDER above, unchanged.
 */
const ORDER_V15 = [
  ["countdown", -900, -4, "countdown", { bed: "full" }],
  ["ident-top", -4, 6, "ident", { mode: "top" }],
  ["the-hour", 6, 606, "spoken", { segment: "the-hour", title: "The Hour", stories: 7, long: true }],
  ["sport", 606, 786, "spoken", { segment: "sport", desk: "sport", title: "Sport", sting: true }],
  ["markets-1", 786, 936, "spoken", { segment: "markets", title: "Markets Now", sting: true, daypart: "markets" }],
  ["compared-1", 936, 1296, "spoken", { segment: "compared", title: "The News, Compared", sting: true, daypart: "evening" }],
  ["music-1", 1296, 1386, "music", { sting: true, cryptoDonor: true, nextAt: 1386, nextTitle: "Middle East desk" }],
  ["desk-me", 1386, 1626, "spoken", { segment: "desk", desk: "middle-east", title: "Middle East desk", sting: true }],
  ["film", 1626, 1686, "film", { sting: true, title: "From the films" }],
  ["series", 1686, 1792, "series", { title: "This week on ScoopFeeds" }],
  ["ident-half", 1792, 1800, "ident", { mode: "id" }],
  ["half", 1800, 1980, "spoken", { segment: "half", title: "Headlines at the half hour", stories: 3, fresh: true }],
  ["weather", 1980, 2070, "spoken", { segment: "weather", title: "Weather around the world" }],
  ["desk-tech", 2070, 2250, "spoken", { segment: "desk", desk: "tech", title: "Science, Tech and AI", sting: true }],
  ["music-3", 2250, 2340, "music", { nextAt: 2340, nextTitle: "Business desk" }],
  ["desk-biz", 2340, 2700, "spoken", { segment: "desk", desk: "business", title: "Business desk", sting: true, daypart: "markets" }],
  ["desk-us", 2700, 2880, "spoken", { segment: "desk", desk: "us", title: "US desk: politics and economy", sting: true, electionDonor: true }],
  ["compared-2", 2880, 3240, "spoken", { segment: "compared", title: "The News, Compared", sting: true, daypart: "evening" }],
  ["music-4", 3240, 3330, "music", { nextAt: 3330, nextTitle: "Markets Now" }],
  ["markets-2", 3330, 3480, "spoken", { segment: "markets", title: "Markets Now", sting: true, daypart: "markets" }],
  ["signoff", 3480, 3525, "spoken", { segment: "signoff", title: "ScoopFeeds Radio" }],
  ["ident-end", 3525, 3533, "ident", { mode: "id" }],
  ["endcard", 3533, 3600 + TAIL_SEC, "endcard", { fadeFrom: 3570, silentFrom: 3600 }],
];

/** #285: is the v1.5 clock on? Literally "1" only. */
export const clockV15 = (env = process.env) => env.RADIO_CLOCK_V15 === "1";
/** #285: the longest a music block may run in the v1.5 clock, and the most music an hour may carry. */
export const V15_MUSIC_MAX_SEC = 90, V15_MUSIC_HOUR_MAX_SEC = 360;

/** Seconds of music in an hour's slots, from :00 to the sign-off (the countdown and end card are not music blocks). */
export function musicSecs(slots) {
  return slots.filter((s) => s.kind === "music" && s.startSec >= 0).reduce((n, s) => n + s.lenSec, 0);
}

/** Speaking rate used to size scripts: Kokoro "George" at speed 1.0 measured ~2.45 words/s. */
export const WORDS_PER_SEC = 2.4;

/**
 * @param {number} hourStartMs  epoch ms of H (the top of the hour the programme is built around)
 * @returns {{ id, kind, startSec, endSec, start, end, lenSec, ...extra }[]}
 */
/**
 * A FEATURE (a full ScoopFeeds episode, e.g. this week's A-Eye) runs straight after the Tech and AI desk.
 * It takes the music blocks of the second half: Business desk, Markets Now and The News, Compared #2 follow it,
 * and Compared #2 gives way to music if fewer than 150 s are left before the sign-off.
 */
export const FEATURE_AT = 2250, FEATURE_MAX = 3480 - FEATURE_AT - 180 - 90;

function withFeature(order, featureSec, featureTitle) {
  const F = Math.round(featureSec);
  if (F > FEATURE_MAX) throw new Error(`feature is ${F} s; at most ${FEATURE_MAX} s fits`);
  if (order === ORDER_V15) return withFeatureV15(order, F, featureTitle);
  const head = order.filter(([, s]) => s < FEATURE_AT);
  const tail = order.filter(([id]) => ["signoff", "ident-end", "endcard"].includes(id));
  const get = (id) => order.find(([x]) => x === id);
  const b = FEATURE_AT + F;
  const mid = [
    ["feature", FEATURE_AT, b, "feature", { sting: true, title: featureTitle || "Feature" }],
    ["desk-biz", b, b + 180, "spoken", get("desk-biz")[4]],
    ["markets-2", b + 180, b + 270, "spoken", get("markets-2")[4]],
  ];
  const left = 3480 - (b + 270);
  if (left >= 150) mid.push(["compared-2", b + 270, 3480, "spoken", get("compared-2")[4]]);
  else if (left > 0) mid.push(["music-4", b + 270, 3480, "music", {}]);
  return [...head, ...mid, ...tail];
}

/**
 * #285: the feature in the v1.5 clock. Same rules as withFeature (it starts at FEATURE_AT, the Business desk and
 * Markets Now follow it, FEATURE_MAX is unchanged); then the US desk if 180 s are left, then The News, Compared if
 * 150 s are left. What is left after that is music, 90 s at most: anything over goes to the Business desk.
 */
function withFeatureV15(order, F, featureTitle) {
  const head = order.filter(([, s]) => s < FEATURE_AT);
  const tail = order.filter(([id]) => ["signoff", "ident-end", "endcard"].includes(id));
  const get = (id) => order.find(([x]) => x === id)[4];
  const END = 3480;
  let t = FEATURE_AT + F;
  const mid = [["feature", FEATURE_AT, t, "feature", { sting: true, title: featureTitle || "Feature" }]];
  const rest = END - t - 180 - 90;
  const us = rest >= 180, comp = rest - (us ? 180 : 0) >= 150;
  const left = rest - (us ? 180 : 0);
  const biz = 180 + (!comp && left > V15_MUSIC_MAX_SEC ? left - V15_MUSIC_MAX_SEC : 0);
  mid.push(["desk-biz", t, t + biz, "spoken", get("desk-biz")]); t += biz;
  mid.push(["markets-2", t, t + 90, "spoken", get("markets-2")]); t += 90;
  if (us) { mid.push(["desk-us", t, t + 180, "spoken", get("desk-us")]); t += 180; }
  if (comp) mid.push(["compared-2", t, END, "spoken", get("compared-2")]);
  else if (END > t) mid.push(["music-4", t, END, "music", {}]);
  return [...head, ...mid, ...tail];
}

/**
 * No weather this hour (the 24/7 day reads it every two hours, dayClock.js): its 90 s go to the half-hour
 * headlines, which read seven stories instead of five. Contiguity is unchanged.
 */
function withoutWeather(order) {
  const w = order.find(([id]) => id === "weather");
  if (!w) return order;
  // #285: the v1.5 half reads only new stories (`fresh`): five at most, not seven
  return order.filter(([id]) => id !== "weather").map((row) => (row[0] === "half" ? [row[0], row[1], w[2], row[3], { ...row[4], stories: row[4].fresh ? 5 : 7 }] : row));
}

/**
 * `film: false` (no eligible Short this hour, #216) turns the film slot into music; `filmTitle` labels it
 * when there is one. `weather: false` (#195) drops the weather slot into the half-hour headlines.
 * `v15: true` (#285, RADIO_CLOCK_V15) builds the hour from ORDER_V15; the caller reads the flag (produce.mjs).
 */
export function buildClock(hourStartMs, { featureSec = 0, featureTitle = null, film = true, filmTitle = null, weather = true, v15 = false } = {}) {
  if (!Number.isFinite(hourStartMs)) throw new Error("buildClock: hourStartMs must be a number");
  const base = v15 ? ORDER_V15 : ORDER;   // #285: the v1.5 clock, only when asked for
  let order = featureSec > 0 ? withFeature(base, featureSec, featureTitle) : base;
  if (!weather) order = withoutWeather(order);
  order = order.map((row) => {
    if (row[0] !== "film") return row;
    if (!film) return [row[0], row[1], row[2], "music", {}];
    return filmTitle ? [row[0], row[1], row[2], row[3], { ...row[4], title: filmTitle }] : row;
  });
  return order.map(([id, s, e, kind, extra]) => ({
    id, kind, startSec: s, endSec: e, lenSec: e - s,
    start: hourStartMs + s * 1000, end: hourStartMs + e * 1000,
    ...extra,
  }));
}

/**
 * The hour as an instance of the channel grid (#200, grid.js): the base running order above, with the hour's
 * plan applied (Crypto, weather every two hours, markets by open session, the film only in its fixed slot).
 * A feature passed for an hour that is not the grid's feature slot is dropped; `plan.featureDropped` says so.
 * @returns {{ plan, slots }}
 */
export function buildGridClock(hourStartMs, { featureSec = 0, ...opts } = {}) {
  const plan = planHour(hourStartMs);
  const useFeature = featureSec > 0 && Boolean(plan.feature);
  const base = buildClock(hourStartMs, { ...opts, featureSec: useFeature ? featureSec : 0, featureTitle: opts.featureTitle || plan.feature?.title || null });
  return { plan: { ...plan, featureDropped: featureSec > 0 && !useFeature }, slots: applyPlan(base, plan) };
}

/** Words the writer may use in a spoken slot: its length less a 4 s margin (sting, breaths), at WORDS_PER_SEC. */
export function wordBudget(slot) {
  const usable = Math.max(0, slot.lenSec - (slot.sting ? 4 : 2) - 2);
  return Math.floor(usable * WORDS_PER_SEC);
}

/**
 * #285: no sport stories this hour (earn-render): the Sport slot's time goes back to the headlines. The Hour runs on to
 * the Sport slot's end and reads two more stories. IN PLACE, like electionDesk.addDeskToClock. Returns true when it
 * merged; false when the clock has no Sport slot straight after The Hour.
 */
export function dropSport(clock) {
  const i = clock.findIndex((s) => s.id === "sport");
  if (i < 1 || clock[i - 1].id !== "the-hour") return false;
  const h = clock[i - 1], sp = clock[i];
  clock.splice(i - 1, 2, { ...h, endSec: sp.endSec, end: sp.end, lenSec: sp.endSec - h.startSec, stories: (h.stories || 7) + 2, sportDropped: true });
  return true;
}

/** Sanity: slots are contiguous and non-overlapping. Returns a list of problems (empty = fine). */
export function checkClock(slots) {
  const bad = [];
  for (let i = 1; i < slots.length; i++) {
    if (slots[i].startSec !== slots[i - 1].endSec) bad.push(`${slots[i - 1].id} ends ${slots[i - 1].endSec}, ${slots[i].id} starts ${slots[i].startSec}`);
  }
  if (slots[0].startSec !== -PREROLL_SEC) bad.push("pre-roll does not start at -15:00");
  if (slots.at(-1).endSec !== 3600 + TAIL_SEC) bad.push("programme does not end at 60:30");
  return bad;
}
