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
 *   film     one ScoopFeeds 60 film, played with its own sound
 *   feature  a full episode (this week's A-Eye), played with its own sound
 *   series   "This week on ScoopFeeds" cards over the bed
 *   countdown / endcard   holding slates over the bed
 *
 * `sting: true` puts the 3 s Signal sting (visual + sonic) over the first 3 s of the slot.
 */

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
  ["film", 1560, 1620, "film", { sting: true, title: "ScoopFeeds 60" }],
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

export function buildClock(hourStartMs, { featureSec = 0, featureTitle = null } = {}) {
  if (!Number.isFinite(hourStartMs)) throw new Error("buildClock: hourStartMs must be a number");
  const order = featureSec > 0 ? withFeature(ORDER, featureSec, featureTitle) : ORDER;
  return order.map(([id, s, e, kind, extra]) => ({
    id, kind, startSec: s, endSec: e, lenSec: e - s,
    start: hourStartMs + s * 1000, end: hourStartMs + e * 1000,
    ...extra,
  }));
}

/** Words the writer may use in a spoken slot: its length less a 4 s margin (sting, breaths), at WORDS_PER_SEC. */
export function wordBudget(slot) {
  const usable = Math.max(0, slot.lenSec - (slot.sting ? 4 : 2) - 2);
  return Math.floor(usable * WORDS_PER_SEC);
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
