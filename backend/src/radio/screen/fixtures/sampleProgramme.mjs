/**
 * sampleProgramme.mjs - a programme.json-shaped sample for screenshots and the font-size test (#200).
 * Sample data only (clearly invented headlines and figures); it never airs. `scenes` lists one moment per
 * scene so a test can freeze the programme screen on each.
 */
import { buildGridClock } from "../../programme/clock.js";
import { electionScenes } from "./sampleElection.mjs";

export function sampleProgramme(hourStart = Date.parse("2026-10-27T14:00:00Z")) {   // 10:00 ET, a Tuesday
  const { slots } = buildGridClock(hourStart);
  const at = (id, plus = 4) => slots.find((s) => s.id === id).start + plus * 1000;
  const headlines = [
    { h: "Sample headline: city council approves new transit budget", src: "Outlet A and Outlet B" },
    { h: "Sample headline: storm system moves across the Gulf Coast", src: "Outlet C" },
    { h: "Sample headline: chipmakers lead a mixed day for stocks", src: "Outlet D and Outlet E" },
  ];
  const rows = [
    { key: "S&P 500", group: "US", price: 6512.4, pct: 0.42 }, { key: "Dow", group: "US", price: 44210.15, pct: 0.18 },
    { key: "Nasdaq", group: "US", price: 21480.6, pct: -0.31 }, { key: "FTSE 100", group: "Europe", price: 8820.3, pct: -0.21 },
    { key: "Brent", group: "Commodities", price: 74.82, pct: -1.12 }, { key: "Gold", group: "Commodities", price: 2680.4, pct: 0.31 },
    { key: "Bitcoin", group: "Crypto", price: 98450, pct: 1.84 },
  ];
  // #247: all ten WEATHER_CITIES (programme/factPack.js), read in the writer's order, one city per line
  const weather = [["New York", 18, 64, "partly cloudy"], ["Washington", 20, 68, "clear sky"], ["London", 13, 55, "light rain"], ["Paris", 14, 57, "overcast clouds"],
    ["Riyadh", 31, 88, "clear sky"], ["Doha", 33, 91, "haze"], ["Dubai", 35, 95, "sunny"], ["Karachi", 33, 91, "haze"], ["Delhi", 29, 84, "mist"], ["Tokyo", 19, 66, "clear"]]
    .map(([city, c, f, condition]) => ({ city, c, f, condition }));
  const focus = weather.map((w, i) => ({ at: at("weather", 6 + i * 8), city: w.city }));
  const story = { kicker: "The Hour", n: 2, of: 5, headline: headlines[1].h, outlets: ["Outlet C", "Outlet F"], lede: { text: "Sample lede: forecasters expect heavy rain through the evening along the coast, with flood watches in three states.", source: "Outlet C" } };
  const scenes = {
    title: { at: at("the-hour"), scene: "title", data: { kicker: "ScoopFeeds Radio", title: "The Hour", items: headlines.map((x) => x.h) } },
    story: { at: at("the-hour", 60), scene: "story", data: story },
    markets: { at: at("markets-1"), scene: "markets", data: { title: "Markets Now", rows: rows.slice(0, 7), asOf: hourStart } },
    crypto: { at: at("crypto"), scene: "markets", data: { title: "Crypto", rows: [{ key: "Bitcoin", group: "Crypto", price: 98450, pct: 1.84 }, { key: "Ethereum", group: "Crypto", price: 3420.5, pct: -0.73 }], asOf: hourStart, note: "Prices from CoinGecko. 24-hour change." } },
    compared: { at: at("compared-1", 20), scene: "compared", data: { title: "The News, Compared", headline: headlines[0].h, cards: [{ source: "Outlet A", title: "Council passes transit plan after long debate" }, { source: "Outlet B", title: "Fares to rise under approved budget" }, { source: "Outlet G", title: "Transit budget clears final vote" }], active: 1 } },
    known: { at: at("compared-1", 120), scene: "known", data: { title: "The News, Compared", headline: headlines[0].h, label: "What every outlet agrees on", text: "Sample text: the budget passed and takes effect next year." } },
    music: { at: at("music-1", 30), scene: "music", data: { next: { title: "Middle East desk", at: at("desk-me", 0) }, credit: "Music: Sample Artist – Sample Track" } },
    weather: { at: at("weather"), scene: "weather", data: { title: "Weather around the world", cities: weather, focus } },
    weatherGulf: { at: focus[5].at + 2500, scene: "weather", data: { title: "Weather around the world", cities: weather, focus } },   // the map zoomed on the Gulf, three pins close together
    series: { at: at("series"), scene: "series", data: { title: "This week on ScoopFeeds", cards: [{ series: "A-Eye", day: "Saturdays" }, { series: "The Record", day: "Fridays" }, { series: "People", day: "Tuesdays" }] } },
    signoff: { at: at("signoff"), scene: "signoff", data: {} },
    countdown: { at: hourStart - 600_000, scene: "countdown", data: { target: hourStart } },
    ...electionScenes(at("music-1", 60)),   // #197: every page of a worst-case full election board
  };
  const cues = Object.values(scenes).sort((a, b) => a.at - b.at);
  return {
    programme: { version: 1, hourStart, builtAt: 1, endsAt: slots.at(-1).end, audio: [], cues, headlines,
      slots: slots.map(({ id, kind, start, end, title, elements }) => ({ id, kind, start, end, title: title || null, elements })),
      rail: { markets: rows, weather } },
    scenes,
  };
}
