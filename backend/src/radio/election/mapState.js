/**
 * mapState.js — builds the election map's state (#204): one tile per state for the
 * Senate view and the governors view, a Senate control bar and a House control bar.
 *
 *   buildMapState({ projections, houseReports, counts, now })
 *
 *  - projections : the election pack's items (#197) — see projections.js for the shape.
 *  - houseReports: { kind: "house-seats", … } items from the same pack.
 *  - counts      : { senate: Map<state, count>, governor: Map<state, count> } from
 *                  civicApi.js or an official state feed. Shown as numbers with their
 *                  source and time; they NEVER colour a tile.
 *
 * Tile status: "called" (coloured, "Projected by <outlet>"), "conflict" (grey, every
 * call listed), "uncalled" (grey, "Not yet called"), "no-race" (hatched). A tile may
 * also carry `withdrawn`: calls an outlet retracted (never coloured, always listed).
 * Every number carries `source` and `at`.
 */
import { foldProjections, foldHouseReports } from "./projections.js";
import {
  TILE_LAYOUT, STATE_NAMES, hasRace, SENATE_UP, SENATE_NOT_UP, SENATE_SEATS, SENATE_MAJORITY,
  HOUSE_SEATS, HOUSE_MAJORITY, GOVERNOR_UP,
} from "./races2026.js";

function tilesFor(race, projections, counts) {
  const { calls, refused } = foldProjections(projections, race);
  const tiles = [];
  for (const [state, [col, row]] of Object.entries(TILE_LAYOUT)) {
    const tile = { state, name: STATE_NAMES[state], col, row };
    if (!hasRace(race, state)) { tiles.push({ ...tile, status: "no-race" }); continue; }
    const call = calls.get(state);
    if (call?.status === "called") Object.assign(tile, { status: "called", party: call.party, projections: call.projections });
    else if (call?.status === "conflict") Object.assign(tile, { status: "conflict", projections: call.projections });
    else tile.status = "uncalled";
    // A withdrawn call never colours; it is listed so the audience sees the retraction.
    if (call?.withdrawn?.length) tile.withdrawn = call.withdrawn;
    const c = counts?.get?.(state);
    if (c && c.shares?.length) {
      tile.count = {
        source: c.source, sourceUrl: c.sourceUrl || null, at: c.lastUpdated || c.fetchedAt,
        percentReporting: c.percentReporting, shares: c.shares.slice(0, 3),
      };
    }
    tiles.push(tile);
  }
  return { tiles, refused };
}

function senateBar(tiles) {
  const projected = {};
  let uncalled = 0;
  for (const t of tiles) {
    if (t.status === "no-race") continue;
    if (t.status === "called") projected[t.party] = (projected[t.party] || 0) + 1;
    else uncalled += 1;
  }
  const notUp = { ...SENATE_NOT_UP };
  const total = (p) => (notUp[p] || 0) + (projected[p] || 0);
  return {
    seats: SENATE_SEATS, majority: SENATE_MAJORITY, notUp, projected, uncalled,
    D: total("D"), R: total("R"), I: total("I"),
    other: Object.entries(projected).filter(([p]) => !["D", "R", "I"].includes(p)).reduce((s, [, n]) => s + n, 0),
    note: "Seats not up this year plus seats projected by a named outlet. Independents shown separately.",
  };
}

export function buildMapState({ projections = [], houseReports = [], counts = {}, now = new Date() } = {}) {
  const senate = tilesFor("senate", projections, counts.senate);
  const governor = tilesFor("governor", projections, counts.governor);
  const house = foldHouseReports(houseReports);
  const projOutlets = new Set(house.map((r) => r.outlet));
  const countSources = new Set();
  for (const t of [...senate.tiles, ...governor.tiles]) {
    for (const p of t.projections || []) projOutlets.add(p.outlet);
    if (t.count?.source) countSources.add(t.count.source);
  }
  return {
    updatedAt: new Date(now).toISOString(),
    senate: { tiles: senate.tiles, bar: senateBar(senate.tiles), racesUp: Object.keys(SENATE_UP).length },
    governor: { tiles: governor.tiles, racesUp: GOVERNOR_UP.length },
    house: { seats: HOUSE_SEATS, majority: HOUSE_MAJORITY, reports: house },
    sources: { projections: [...projOutlets].sort(), counts: [...countSources].sort() },
    refused: [...senate.refused, ...governor.refused].map((r) => ({ reason: r.reason, state: r.item?.state || null, outlet: r.item?.outlet || null })),
    hasAnyCall: [...senate.tiles, ...governor.tiles].some((t) => t.status === "called" || t.status === "conflict" || t.withdrawn?.length) || house.length > 0,
  };
}
