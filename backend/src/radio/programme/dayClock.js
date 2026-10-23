/**
 * dayClock.js - which format each hour of the 24/7 day gets (#195). Pure: no I/O, no clock reads.
 *
 * DrJ's audience order is US first. The day is planned in New York time:
 *   06:00-24:00 ET  PRIME      a full produced hour (The Hour, Markets Now, The News, Compared, the desks)
 *   00:00-06:00 ET  OVERNIGHT  the strongest recent produced hour, repeated, with a freshly written
 *                              The Hour at the top. 00-02 ET is the Middle East morning (08-10 Dubai in
 *                              summer time); 02-06 ET is the UK and Europe morning (07-11 London).
 * Weather is read every two hours (even ET hours); in the other hours its 90 s go to the half-hour headlines.
 * Markets Now leads with the exchanges in session at the slot's air time.
 *
 * This is the stand-in for #200's channel grid: `planHour` is the one function the rolling orchestrator
 * asks, so the grid can replace it without touching the loop (pass `grid` to `RollingStation`).
 */

export const PRIME_START_ET = 6;    // first produced hour, New York time
export const PRIME_END_ET = 24;     // exclusive
export const WEATHER_EVERY_H = 2;

const fmtNum = (ms, tz, o) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", ...o }).format(new Date(ms)));
const weekday = (ms, tz) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(ms));

/** New York hour (0-23) at `ms`. */
export const etHour = (ms) => fmtNum(ms, "America/New_York", { hour: "numeric" }) % 24;

/** Regular trading sessions (local time, weekdays; exchange holidays and lunch breaks are not modelled). */
export const SESSIONS = Object.freeze([
  { id: "NYSE", name: "New York", tz: "America/New_York", open: [9, 30], close: [16, 0], groups: ["US"] },
  { id: "LSE", name: "London", tz: "Europe/London", open: [8, 0], close: [16, 30], groups: ["Europe"] },
  { id: "XETRA", name: "Frankfurt", tz: "Europe/Berlin", open: [9, 0], close: [17, 30], groups: ["Europe"] },
  { id: "TSE", name: "Tokyo", tz: "Asia/Tokyo", open: [9, 0], close: [15, 30], groups: [] },
  { id: "HKEX", name: "Hong Kong", tz: "Asia/Hong_Kong", open: [9, 30], close: [16, 0], groups: [] },
  { id: "NSE", name: "Mumbai", tz: "Asia/Kolkata", open: [9, 15], close: [15, 30], groups: [] },
  { id: "PSX", name: "Karachi", tz: "Asia/Karachi", open: [9, 30], close: [15, 30], groups: [] },
]);

/** Exchanges in their regular session at `ms`. */
export function sessionsAt(ms) {
  return SESSIONS.filter((s) => {
    if (["Sat", "Sun"].includes(weekday(ms, s.tz))) return false;
    const m = fmtNum(ms, s.tz, { hour: "numeric" }) * 60 + fmtNum(ms, s.tz, { minute: "numeric" });
    return m >= s.open[0] * 60 + s.open[1] && m < s.close[0] * 60 + s.close[1];
  });
}

/**
 * The plan for the hour that starts at `hourStartMs`.
 * @returns {{ hourStart, etHour, format: "produced"|"repeat", weather: boolean, audience: string, label: string }}
 */
export function planHour(hourStartMs) {
  if (!Number.isFinite(hourStartMs)) throw new Error("planHour: hourStartMs must be a number");
  const h = etHour(hourStartMs);
  const prime = h >= PRIME_START_ET && h < PRIME_END_ET;
  const audience = prime ? "us" : h < 2 ? "middle-east-morning" : "uk-europe-morning";
  return {
    hourStart: hourStartMs,
    etHour: h,
    format: prime ? "produced" : "repeat",
    weather: h % WEATHER_EVERY_H === 0,
    audience,
    label: prime ? `${h}:00 ET produced hour` : `${h}:00 ET overnight repeat (${audience})`,
  };
}

/**
 * Should the continuous YouTube broadcast roll over at this hand-over? YouTube stops archiving a stream after
 * 12 hours, so a broadcast never runs past `maxAgeH`. It rolls at a quiet hand-over (`rollEtHours`) once it is
 * at least `minAgeH` old, and at any hand-over that the next one would push past the limit.
 */
export function broadcastRollDue({ startedAt, at, rollEtHours = [4, 16], minAgeH = 6, maxAgeH = 12, marginMin = 20 }) {
  if (!Number.isFinite(startedAt)) return false;
  const ageH = (at - startedAt) / 3_600_000;
  const hourAfter = at + 60_000;   // the hand-over happens a minute before the top of the hour
  if (ageH >= minAgeH && rollEtHours.includes(etHour(hourAfter))) return true;
  return ageH + 1 + marginMin / 60 > maxAgeH;
}
