/**
 * grid.js - the ScoopFeeds Radio channel grid (#200), as data. Pure: no I/O, no clock reads.
 *
 * ScoopFeeds Radio runs like a TV news channel (DrJ, 22 Oct 2026): a 24-hour grid of dayparts, a catalogue of
 * segment formats, and a set of always-on screen elements. The hour's running order in `clock.js` is one
 * instance of this grid: `buildGridClock()` there asks `planHour()` what the hour is, then `applyPlan()` here
 * turns the base clock into that hour. `docs/radio/channel-grid.md` is the same grid in plain English;
 * `grid.test.js` reads both and fails when they disagree.
 *
 * Times are New York time (US-first audience). DST is handled by the time zone database, never by offsets.
 *
 * The shape of `planHour()` is a superset of #195's `dayClock.planHour()` (hourStart, etHour, format, weather,
 * audience, label), so the rolling station can take the grid in its place.
 */

export const ET = "America/New_York";

/**
 * The 24-hour grid. Each row covers [fromEt, toEt) in New York hours.
 *   format    produced = a full produced hour; repeat = the strongest recent hour again, with a freshly written
 *             top-of-hour headlines segment (the repeat itself is #195's rolling station)
 *   audience  who the hour is timed for
 */
export const DAYPARTS = Object.freeze([
  { id: "overnight-me", fromEt: 0, toEt: 2, format: "repeat", audience: "middle-east-morning", name: "Overnight: Middle East morning" },
  { id: "overnight-eu", fromEt: 2, toEt: 6, format: "repeat", audience: "uk-europe-morning", name: "Overnight: UK and Europe morning" },
  { id: "us-morning", fromEt: 6, toEt: 10, format: "produced", audience: "us", name: "US morning" },
  { id: "us-day", fromEt: 10, toEt: 16, format: "produced", audience: "us", name: "US daytime, markets open" },
  { id: "us-evening", fromEt: 16, toEt: 21, format: "produced", audience: "us", name: "US evening" },
  { id: "primetime", fromEt: 21, toEt: 22, format: "produced", audience: "us", name: "Prime time: the ScoopFeeds film" },
  { id: "south-asia", fromEt: 22, toEt: 24, format: "produced", audience: "south-asia-morning", name: "Late US evening, South Asia morning" },
]);

/** Weather is read every two hours, on even New York hours. In the other hours its time goes to the half-hour headlines. */
export const WEATHER_EVERY_H = 2;

/**
 * Fixed slots: films and series episodes air at the same time every day so they can be promoted
 * ("tonight at 9 ET"). The feature runs inside the produced hour at clock.js FEATURE_AT.
 */
export const FIXED = Object.freeze([
  { id: "feature", etHour: 21, kind: "feature", title: "The ScoopFeeds film", promo: "tonight at 9 ET" },
]);

/**
 * Segment catalogue. Every format has its own fact pack source, writer prompt (writer.js), checks (checks.js)
 * and screen layout (the programme screen's scene). `status` says what this repo builds today: "on-air" formats
 * are placed by the grid; the others are catalogued here and placed by their own issues.
 */
export const SEGMENTS = Object.freeze([
  { id: "the-hour", name: "Top-of-hour headlines", kind: "produced", every: "every hour at :00, after the top ident and ping", facts: "top stories", scene: "title, story", status: "on-air" },
  { id: "half", name: "Half-hour headlines", kind: "produced", every: "every hour at :30", facts: "top stories", scene: "title, story", status: "on-air" },
  { id: "compared", name: "The News, Compared", kind: "produced", every: "twice an hour", facts: "one story, 3+ outlets", scene: "compared, known", status: "on-air" },
  { id: "markets", name: "Business & Markets", kind: "produced + live data", every: "twice an hour, led by the exchanges in session", facts: "market rows", scene: "markets", status: "on-air" },
  { id: "desk", name: "Desks: Middle East, US, Tech and AI, Business", kind: "produced", every: "once an hour each", facts: "desk stories", scene: "title, story", status: "on-air" },
  { id: "crypto", name: "Crypto", kind: "produced + live data", every: "once an hour, every hour (repeats get a fresh one)", facts: "crypto rows (CoinGecko)", scene: "markets", status: "on-air" },
  { id: "weather", name: "Weather", kind: "produced + live data", every: "every 2 hours (even New York hours)", facts: "weather rows", scene: "weather", status: "on-air" },
  { id: "showcase", name: "ScoopFeeds showcase", kind: "pre-recorded", every: "a Short every hour; the film at 9 ET", facts: "film library", scene: "film, feature, series", status: "on-air" },
  { id: "developing", name: "Developing and emerging stories", kind: "live-produced", every: "breaks into the grid", facts: "event graph", scene: "story", status: "#201" },
  { id: "midterms", name: "The Midterms / election desk", kind: "produced", every: "election season", facts: "attributed projections", scene: "election map", status: "#197" },
  { id: "live", name: "Live events", kind: "live", every: "breaks into the grid", facts: "official public feeds only", scene: "livefeed", status: "#202" },
]);

/**
 * Always-on screen elements, in the Signal identity. Earn-render: an element is drawn only when it has real data
 * (`needs`), never as a placeholder.
 */
export const ELEMENTS = Object.freeze([
  { id: "live-bug", name: "LIVE bug", needs: null },
  { id: "clocks", name: "Channel clock: New York, London, Dubai, Karachi", needs: null },
  { id: "programme-name", name: "Programme name", needs: "title" },
  { id: "headline-ticker", name: "Headline ticker", needs: "headlines" },
  { id: "markets-ticker", name: "Markets ticker by open session", needs: "markets" },
  { id: "weather-scroller", name: "Weather scroller of major capitals", needs: "weather" },
  { id: "lower-third", name: "Lower third: headline and outlet, verbatim from articles", needs: "story" },
  { id: "coming-up", name: "Coming up next", needs: "next" },
]);

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

const part = (ms, tz, o) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", ...o }).format(new Date(ms));
const weekday = (ms, tz) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(ms));

/** New York hour (0-23) at `ms`. */
export const etHour = (ms) => Number(part(ms, ET, { hour: "numeric" })) % 24;

/** Exchanges in their regular session at `ms`. */
export function sessionsAt(ms) {
  return SESSIONS.filter((s) => {
    if (["Sat", "Sun"].includes(weekday(ms, s.tz))) return false;
    const m = (Number(part(ms, s.tz, { hour: "numeric" })) % 24) * 60 + Number(part(ms, s.tz, { minute: "numeric" }));
    return m >= s.open[0] * 60 + s.open[1] && m < s.close[0] * 60 + s.close[1];
  });
}

export function daypartAt(h) {
  const d = DAYPARTS.find((x) => h >= x.fromEt && h < x.toEt);
  if (!d) throw new Error(`grid: no daypart covers ${h}:00 ET`);
  return d;
}

/**
 * The plan for the hour that starts at `hourStartMs`.
 * @returns {{ hourStart, etHour, daypart, format, audience, weather, crypto, feature, label }}
 */
export function planHour(hourStartMs) {
  if (!Number.isFinite(hourStartMs)) throw new Error("planHour: hourStartMs must be a number");
  const h = etHour(hourStartMs);
  const d = daypartAt(h);
  const fixed = FIXED.find((f) => f.etHour === h) || null;
  return {
    hourStart: hourStartMs,
    etHour: h,
    daypart: d.id,
    format: d.format,
    audience: d.audience,
    weather: h % WEATHER_EVERY_H === 0,
    // #283: crypto trades around the clock, so every hour carries it. A repeat hour gets a Crypto segment written
    // fresh against its own air time (rollingStation.js splices it over the repeated hour's, repeat.js cuts the stale one)
    crypto: true,
    feature: fixed?.kind === "feature" ? fixed : null,
    label: `${h}:00 ET · ${d.name}${d.format === "repeat" ? " (repeat, fresh headlines)" : ""}`,
  };
}

/** The next fixed feature slot at or after `ms`, for promos: { at, promo, title }. */
export function nextFeature(ms) {
  const h0 = Math.floor(ms / 3_600_000) * 3_600_000;
  for (let i = 0; i <= 48; i++) {   // the hour in progress counts: at 9:20 ET the film is "now"
    const t = h0 + i * 3_600_000;
    const f = FIXED.find((x) => x.kind === "feature" && x.etHour === etHour(t));
    if (f) return { at: t, promo: f.promo, title: f.title };
  }
  return null;
}

// ── turning the base clock into this hour ───────────────────────────────────

export const CRYPTO_SEC = 90;
const MIN_MUSIC_AFTER_CRYPTO = 60;

const retime = (slot, startSec, endSec, hourStartMs) => ({
  ...slot, startSec, endSec, lenSec: endSec - startSec, start: hourStartMs + startSec * 1000, end: hourStartMs + endSec * 1000,
});

const sessionNames = (list) => {
  const n = list.map((s) => s.name);
  return n.length <= 2 ? n.join(" and ") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`;
};

/**
 * Apply the hour's plan to the base clock (`buildClock()` slots). Contiguity is preserved, so `checkClock()`
 * still holds.
 *   - crypto: the first 90 s of the first music block become the Crypto segment
 *   - no weather this hour: the weather slot's time goes to the half-hour headlines (seven stories, not five)
 *   - Markets Now and the Business desk are titled by the exchanges in session at their air time, and carry
 *     `sessions` (ids) and `marketsLead` (row groups to lead with)
 *   - every slot carries `elements`: the screen elements it may show (earn-render decides at air time)
 */
export function applyPlan(slots, plan) {
  const H = plan.hourStart;
  let out = slots.map((s) => ({ ...s }));

  if (plan.crypto) {
    const i = out.findIndex((s) => s.kind === "music" && s.startSec >= 0);
    const m = out[i];
    if (m && m.lenSec >= CRYPTO_SEC + MIN_MUSIC_AFTER_CRYPTO) {
      const c = retime({ id: "crypto", kind: "spoken", segment: "crypto", title: "Crypto", sting: true, daypart: "markets" }, m.startSec, m.startSec + CRYPTO_SEC, H);
      const rest = retime({ ...m, sting: false }, m.startSec + CRYPTO_SEC, m.endSec, H);
      out.splice(i, 1, c, rest);
    }
  }

  if (!plan.weather) {
    const w = out.find((s) => s.id === "weather");
    if (w) out = out.filter((s) => s !== w).map((s) => (s.id === "half" ? { ...retime(s, s.startSec, w.endSec, H), stories: 7 } : s));
  }

  out = out.map((s) => {
    if (s.segment === "markets" || (s.segment === "desk" && s.desk === "business")) {
      const open = sessionsAt(s.start);
      // the title names only exchanges the fact pack has rows for (MARKET_SYMBOLS: US and Europe today), so the
      // screen never promises Tokyo or Karachi figures it cannot show; `sessions` still lists every open one
      const named = open.filter((o) => o.groups.length);
      const base = s.segment === "markets" ? "Markets Now" : "Business desk";
      return { ...s, title: named.length ? `${base}: ${sessionNames(named)} trading` : base, sessions: open.map((o) => o.id), marketsLead: [...new Set(open.flatMap((o) => o.groups))] };
    }
    return s;
  });

  return out.map((s) => ({ ...s, elements: elementsForKind(s) }));
}

/** Which elements a slot may show. The persistent frame (bug, clocks, programme name, ticker) is on every slot. */
export function elementsForKind(slot) {
  const frame = ["live-bug", "clocks", "programme-name", "headline-ticker"];
  if (slot.kind === "ident" || slot.kind === "feature") return ["live-bug"];   // full-frame: the ident or the episode
  if (slot.kind === "countdown" || slot.kind === "endcard") return ["clocks"];
  const rail = ["coming-up", "markets-ticker", "weather-scroller"];
  if (slot.kind === "spoken" && ["the-hour", "half", "desk"].includes(slot.segment)) return [...frame, "lower-third", ...rail];
  if (slot.kind === "music") return [...frame, ...rail];
  return [...frame, "coming-up"];
}

/**
 * Earn-render: the elements of `slot` that have real data now.
 * @param {{ headlines?: any[], markets?: any[], weather?: any[], story?: boolean, next?: any }} data
 */
export function elementsOnAir(slot, data = {}) {
  const has = { title: Boolean(slot.title), headlines: (data.headlines || []).length > 0, markets: (data.markets || []).length > 0,
    weather: (data.weather || []).length > 0, story: Boolean(data.story), next: Boolean(data.next) };
  return (slot.elements || elementsForKind(slot)).filter((id) => { const e = ELEMENTS.find((x) => x.id === id); return e && (!e.needs || has[e.needs]); });
}

/**
 * Live events and breaking news override the grid; the grid resumes at the NEXT segment, never in the middle of
 * one. Slots wholly inside the override are dropped; the slot it starts in is cut short; the time between the
 * override's end and the next slot boundary is headlines and music.
 * @param {object[]} slots  contiguous clock slots (from buildClock / applyPlan)
 * @param {{ kind: "live"|"breaking", title: string, start: number, end: number }} ov  epoch ms
 */
export function applyOverride(slots, ov) {
  if (!ov || !(ov.end > ov.start)) throw new Error("applyOverride: needs start < end");
  if (!["live", "breaking"].includes(ov.kind)) throw new Error(`applyOverride: unknown kind ${ov.kind}`);
  const H = slots[0].start - slots[0].startSec * 1000;
  const sec = (ms) => Math.round((ms - H) / 1000);
  const s0 = Math.max(sec(ov.start), slots[0].startSec), s1 = Math.min(sec(ov.end), slots.at(-1).endSec);
  const resume = slots.find((s) => s.startSec >= s1);
  const resumeSec = resume ? resume.startSec : slots.at(-1).endSec;
  const out = [];
  for (const s of slots) {
    if (s.endSec <= s0) { out.push(s); continue; }
    if (s.startSec < s0) out.push(retime(s, s.startSec, s0, H));   // cut short where the override starts
  }
  out.push(retime({ id: `override-${ov.kind}`, kind: ov.kind, title: ov.title, override: true }, s0, s1, H));
  if (resumeSec > s1) out.push(retime({ id: "override-resume", kind: "music", title: null, nextTitle: resume?.title || null, nextAt: resumeSec }, s1, resumeSec, H));
  for (const s of slots) if (s.startSec >= resumeSec) out.push(s);
  return out.map((s) => (s.elements ? s : { ...s, elements: elementsForKind(s) }));
}
