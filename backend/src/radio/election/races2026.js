/**
 * races2026.js — the static race list the election map is drawn from (#204, #197).
 *
 * Sources:
 *  - Which states hold a Senate / governor race on 3 Nov 2026: the civicAPI race list
 *    (https://civicapi.org/api/v2/race/87528 and /race/87535), read 23 Oct 2026. Its
 *    35 Senate states (33 regular Class 2 seats + the Florida and Ohio specials) and
 *    36 governor states match the lists below exactly.
 *  - Which party holds each Senate seat that is up, and the seats NOT up: the Senate's
 *    composition after the 2024 election (53 R, 45 D, 2 independents who caucus with the
 *    Democrats — https://www.senate.gov/senators/). The per-seat party below was written
 *    by the builder and is UNVERIFIED against senate.gov: check it on the Mac before
 *    1 Nov. The only thing the map takes from it is the "seats not up" totals.
 *
 * No ratings, no forecasts, no polls live here, and none may be added: the map is
 * coloured from attributed projections only (projections.js).
 */

/** Senate seats on the ballot, with the party currently holding the seat. */
export const SENATE_UP = Object.freeze({
  AL: "R", AK: "R", AR: "R", CO: "D", DE: "D", FL: "R", GA: "D", ID: "R", IL: "D",
  IA: "R", KS: "R", KY: "R", LA: "R", ME: "R", MA: "D", MI: "D", MN: "D", MS: "R",
  MT: "R", NE: "R", NH: "D", NJ: "D", NM: "D", NC: "R", OH: "R", OK: "R", OR: "D",
  RI: "D", SC: "R", SD: "R", TN: "R", TX: "R", VA: "D", WV: "R", WY: "R",
});

/** Seats not on the ballot this year (100 − 35 = 65). Independents: Sanders (VT), King (ME). */
export const SENATE_NOT_UP = Object.freeze({ D: 32, I: 2, R: 31 });
export const SENATE_SEATS = 100;
export const SENATE_MAJORITY = 51;

export const GOVERNOR_UP = Object.freeze([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "FL", "GA", "HI", "ID", "IL", "IA", "KS",
  "ME", "MD", "MA", "MI", "MN", "NE", "NV", "NH", "NM", "NY", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "VT", "WI", "WY",
]);

/**
 * When the LAST polls in each state close on 3 Nov 2026, in ET hours (EST, UTC−5; DST
 * ended 1 Nov). Used to HOLD vote counts until a state has finished voting. Written by
 * the builder from the usual poll-closing schedule, rounding each state to its latest
 * time zone (e.g. TX = El Paso, MI = the Upper Peninsula, AK = the Aleutians) and,
 * where unsure, LATER. UNVERIFIED against each state's election office: check on the
 * Mac. Erring late only keeps a count off screen a little longer; it never airs one.
 *
 * civicAPI's own `polls_close` (measured 23 Oct, all 71 per-state races carry it) is
 * often the FIRST close, not the last, and sometimes plainly early (KY 17:00 ET,
 * DE 18:00 ET, AK 23:00 ET). So the hold uses the LATER of the two.
 */
export const LAST_POLLS_CLOSE_ET = Object.freeze({
  AL: 20, AK: 25, AZ: 21, AR: 20.5, CA: 23, CO: 21, CT: 20, DE: 20, DC: 20, FL: 20, GA: 19,
  HI: 24, ID: 23, IL: 20, IN: 19, IA: 22, KS: 21, KY: 19, LA: 21, ME: 20, MD: 20, MA: 20,
  MI: 21, MN: 21, MS: 20, MO: 20, MT: 22, NE: 22, NV: 22, NH: 20, NJ: 20, NM: 21, NY: 21,
  NC: 19.5, ND: 22, OH: 19.5, OK: 20, OR: 23, PA: 20, RI: 20, SC: 19, SD: 21, TN: 21,
  TX: 21, UT: 22, VT: 19, VA: 19, WA: 23, WV: 19.5, WI: 21, WY: 21,
});

/** ISO time of a state's last poll close on 3 Nov 2026 (default: 01:00 ET on 4 Nov). */
export function lastPollsCloseIso(state) {
  const h = LAST_POLLS_CLOSE_ET[String(state || "").toUpperCase()] ?? 25;
  return new Date(Date.parse("2026-11-03T05:00:00.000Z") + h * 3_600_000).toISOString();
}

/**
 * Plausibility ceiling for a statewide count: total votes cast in the 2020 presidential
 * election (millions, rounded; builder's figures, UNVERIFIED against each state's
 * certified total) × 1.5. A midterm count above it is impossible, so it is HELD. This
 * catches the 23 Oct PA case (25.8M votes against a 10.4M ceiling) without needing
 * civicAPI's `registered_voters`, which was null in all 71 per-state races on 23 Oct.
 */
export const TURNOUT_2020_M = Object.freeze({
  AL: 2.32, AK: 0.36, AZ: 3.39, AR: 1.22, CA: 17.5, CO: 3.26, CT: 1.82, DE: 0.5, DC: 0.34,
  FL: 11.07, GA: 5.0, HI: 0.57, ID: 0.87, IL: 6.03, IN: 3.03, IA: 1.69, KS: 1.37, KY: 2.14,
  LA: 2.15, ME: 0.82, MD: 3.04, MA: 3.63, MI: 5.54, MN: 3.28, MS: 1.31, MO: 3.03, MT: 0.6,
  NE: 0.96, NV: 1.41, NH: 0.81, NJ: 4.55, NM: 0.92, NY: 8.62, NC: 5.52, ND: 0.36, OH: 5.92,
  OK: 1.56, OR: 2.37, PA: 6.92, RI: 0.52, SC: 2.51, SD: 0.42, TN: 3.05, TX: 11.32, UT: 1.49,
  VT: 0.37, VA: 4.46, WA: 4.09, WV: 0.79, WI: 3.3, WY: 0.28,
});
export const TURNOUT_CEILING_FACTOR = 1.5;

/** Most votes a statewide race in `state` can plausibly have, or Infinity if unknown. */
export function voteCeiling(state) {
  const m = TURNOUT_2020_M[String(state || "").toUpperCase()];
  return m ? Math.round(m * 1e6 * TURNOUT_CEILING_FACTOR) : Infinity;
}

export const HOUSE_SEATS = 435;
export const HOUSE_MAJORITY = 218;

export const STATE_NAMES = Object.freeze({
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
});

/**
 * Tile map: one equal square per state (DrJ, 22 Oct: tile map, not geographic).
 * [col, row] on a 12 × 8 grid. This is the common newsroom tile layout; DrJ's approved
 * mockup was not available to the builder, so compare it on the Mac (to verify).
 */
export const TILE_LAYOUT = Object.freeze({
  AK: [0, 0], ME: [11, 0],
  WI: [6, 1], VT: [10, 1], NH: [11, 1],
  WA: [1, 2], ID: [2, 2], MT: [3, 2], ND: [4, 2], MN: [5, 2], IL: [6, 2], MI: [7, 2], NY: [9, 2], MA: [10, 2],
  OR: [1, 3], NV: [2, 3], WY: [3, 3], SD: [4, 3], IA: [5, 3], IN: [6, 3], OH: [7, 3], PA: [8, 3], NJ: [9, 3], CT: [10, 3], RI: [11, 3],
  CA: [1, 4], UT: [2, 4], CO: [3, 4], NE: [4, 4], MO: [5, 4], KY: [6, 4], WV: [7, 4], VA: [8, 4], MD: [9, 4], DE: [10, 4],
  AZ: [2, 5], NM: [3, 5], KS: [4, 5], AR: [5, 5], TN: [6, 5], NC: [7, 5], SC: [8, 5], DC: [9, 5],
  OK: [4, 6], LA: [5, 6], MS: [6, 6], AL: [7, 6], GA: [8, 6],
  HI: [0, 7], TX: [4, 7], FL: [9, 7],
});

export const RACE_TYPES = Object.freeze(["senate", "governor"]);

/** Does `state` hold a `race` this year? */
export function hasRace(race, state) {
  if (race === "senate") return Object.hasOwn(SENATE_UP, state);
  if (race === "governor") return GOVERNOR_UP.includes(state);
  return false;
}
