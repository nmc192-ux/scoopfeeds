/**
 * election.test.js — the election map (#204). Fixture data only; no network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TILE_LAYOUT, SENATE_UP, SENATE_NOT_UP, GOVERNOR_UP, STATE_NAMES, hasRace } from "./races2026.js";
import { refuseReason, foldProjections, foldHouseReports } from "./projections.js";
import { buildMapState } from "./mapState.js";
import { renderMapHtml, MIN_SOURCE_PX } from "./mapScene.js";
import { parseRace, createCivicClient, MIN_INTERVAL_MS, countsSwitch, AUDIT_CAP } from "./civicApi.js";
import { lastPollsCloseIso, voteCeiling, LAST_POLLS_CLOSE_ET } from "./races2026.js";

const AFTER_CLOSE = Date.parse("2026-11-04T07:00:00Z"); // after every state's last close (AK 01:00 ET)
import { mapCue, isElectionNight, inHeadlinesWindow } from "./schedule.js";

const T = "2026-11-04T02:10:00Z";
const P = (o) => ({ kind: "projection", race: "senate", state: "NC", party: "D", candidate: "Roy Cooper", outlet: "AP", at: T, url: "https://example.org/a", ...o });
const tile = (state, s, race = "senate") => s[race].tiles.find((t) => t.state === state);

// ── static data ────────────────────────────────────────────────────────────────
test("tile layout: 50 states + DC, one square each, no two on the same cell", () => {
  assert.equal(Object.keys(TILE_LAYOUT).length, 51);
  for (const st of Object.keys(STATE_NAMES)) assert.ok(TILE_LAYOUT[st], `missing tile for ${st}`);
  const cells = new Set(Object.values(TILE_LAYOUT).map(([c, r]) => `${c},${r}`));
  assert.equal(cells.size, 51);
  for (const [c, r] of Object.values(TILE_LAYOUT)) assert.ok(c >= 0 && c < 12 && r >= 0 && r < 8);
});

test("race list: 35 Senate (65 not up), 36 governors", () => {
  assert.equal(Object.keys(SENATE_UP).length, 35);
  assert.equal(SENATE_NOT_UP.D + SENATE_NOT_UP.I + SENATE_NOT_UP.R, 65);
  assert.equal(GOVERNOR_UP.length, 36);
  assert.ok(hasRace("senate", "NC") && !hasRace("senate", "CA") && hasRace("governor", "CA") && !hasRace("governor", "DC"));
});

// ── acceptance: projection colours with attribution ─────────────────────────────
test("a projection colours the state, with the outlet named", () => {
  const s = buildMapState({ projections: [P()] });
  const nc = tile("NC", s);
  assert.equal(nc.status, "called");
  assert.equal(nc.party, "D");
  assert.deepEqual(nc.projections.map((p) => p.outlet), ["AP"]);
  const html = renderMapHtml(s);
  assert.match(html, /Projected by AP/);
  assert.match(html, /data-state="NC"[^>]*><span class="ab">NC<\/span><span class="by">AP<\/span>/);
});

test("no projection = grey ('uncalled'); no race = hatched ('no-race')", () => {
  const s = buildMapState({ projections: [] });
  assert.equal(tile("NC", s).status, "uncalled");
  assert.equal(tile("CA", s).status, "no-race");
  assert.equal(tile("DC", s).status, "no-race");
  assert.equal(tile("CA", s, "governor").status, "uncalled");
  assert.equal(s.hasAnyCall, false);
  const html = renderMapHtml(s);
  assert.match(html, /class="tile no-race"[^>]*data-state="CA"/);
  assert.doesNotMatch(html, /Latest calls/); // earn-render: no calls, no list
});

test("conflicting projections: not coloured, both shown", () => {
  const s = buildMapState({ projections: [P(), P({ outlet: "Fox News", party: "R", candidate: "Michael Whatley", at: "2026-11-04T02:12:00Z" })] });
  const nc = tile("NC", s);
  assert.equal(nc.status, "conflict");
  assert.equal(nc.party, undefined);
  assert.deepEqual(nc.projections.map((p) => p.outlet).sort(), ["AP", "Fox News"]);
  assert.equal(s.senate.bar.projected.D, undefined);
  const html = renderMapHtml(s);
  assert.match(html, /outlets disagree/);
  assert.match(html, /AP: Roy Cooper/);
  assert.match(html, /Fox News: Michael Whatley/);
  assert.doesNotMatch(html, /data-state="NC" [^>]*background/);
});

test("two outlets agreeing: coloured, both named", () => {
  const s = buildMapState({ projections: [P(), P({ outlet: "NBC News" })] });
  assert.equal(tile("NC", s).status, "called");
  assert.match(renderMapHtml(s), /Projected by AP, NBC News/);
});

test("an outlet's latest call replaces its earlier one", () => {
  const { calls } = foldProjections([P({ party: "R", at: "2026-11-04T01:00:00Z" }), P({ party: "D", at: "2026-11-04T03:00:00Z" })], "senate");
  assert.equal(calls.get("NC").status, "called");
  assert.equal(calls.get("NC").party, "D");
});

// ── acceptance: never from a poll or a partial-count lead ───────────────────────
test("never coloured from a poll or a lead in a partial count", () => {
  const items = [
    { ...P(), kind: "poll" },
    { ...P(), kind: "lead" },
    P({ quote: "Cooper leads Whatley by 4 points in the latest poll" }),
    P({ quote: "With 40% of the vote counted, Cooper is ahead" }),
    P({ quote: "Early returns show Whatley leading" }),
  ];
  const s = buildMapState({ projections: items });
  assert.equal(tile("NC", s).status, "uncalled");
  assert.equal(s.refused.length, items.length);
  assert.deepEqual(s.refused.map((r) => r.reason), ["kind:poll", "kind:lead", "poll-or-lead", "poll-or-lead", "poll-or-lead"]);
});

test("review 23 Oct: polls, leads and negated calls that say 'project' or 'call' are refused", () => {
  const cases = {
    "A new poll projects Cooper winning by 4 points": "poll-or-lead",
    "Cooper leads with 40% of precincts reporting; the race has not yet been called": "negated-call",
    "It is too early to call the race, Cooper leads": "negated-call",
    "Polls show Cooper ahead and project a narrow win": "poll-or-lead",
    "AP has not called the race": "negated-call",
    "The race is too close to call": "negated-call",
    "Forecasters project Cooper will win": "poll-or-lead",
    "Cooper is expected to win, AP says": "poll-or-lead",
    "AP projects Cooper wins with 52% of the vote counted": "poll-or-lead", // count words → refused (safe side)
    "AP withdrew its call for Cooper": "negated-call",
    "Cooper's campaign says he won": "no-call-form",
  };
  for (const [quote, reason] of Object.entries(cases)) {
    assert.equal(refuseReason(P({ quote })), reason, quote);
  }
  const s = buildMapState({ projections: Object.keys(cases).map((quote) => P({ quote })) });
  assert.equal(tile("NC", s).status, "uncalled");
});

test("positive call forms are accepted", () => {
  for (const quote of [
    "AP projects Cooper wins",
    "AP projects Roy Cooper will win the North Carolina Senate race",
    "NBC News has projected Cooper the winner",
    "Cooper is the projected winner, according to CNN",
    "The Associated Press called the North Carolina Senate race for Roy Cooper",
    "Fox News declared Cooper the winner",
    "Polls closed at 7:30 pm and AP projects Cooper wins",
  ]) assert.equal(refuseReason(P({ quote })), null, quote);
  assert.equal(refuseReason(P({ quote: undefined })), null, "no quote: trusted on kind + outlet + time");
});

// ── retractions ────────────────────────────────────────────────────────────────
const W = (o) => ({ kind: "retraction", race: "senate", state: "NC", outlet: "AP", at: "2026-11-04T03:00:00Z", ...o });

test("a retraction removes the outlet's call; the list says it withdrew", () => {
  const s = buildMapState({ projections: [P(), W()] });
  const nc = tile("NC", s);
  assert.equal(nc.status, "uncalled");
  assert.equal(nc.party, undefined);
  assert.deepEqual(nc.withdrawn.map((w) => w.outlet), ["AP"]);
  assert.equal(s.senate.bar.projected.D, undefined);
  assert.equal(s.hasAnyCall, true);
  const html = renderMapHtml(s);
  assert.match(html, /AP withdrew its call/);
  assert.doesNotMatch(html, /Projected by AP ·/);
  assert.doesNotMatch(html, /data-state="NC" [^>]*background/);
});

test("retraction: an older one does nothing; a newer call restores; others' calls stand", () => {
  assert.equal(tile("NC", buildMapState({ projections: [P(), W({ at: "2026-11-04T01:00:00Z" })] })).status, "called");
  assert.equal(tile("NC", buildMapState({ projections: [P(), W(), P({ at: "2026-11-04T04:00:00Z" })] })).status, "called");
  const s = buildMapState({ projections: [P(), P({ outlet: "NBC News" }), W()] });
  const nc = tile("NC", s);
  assert.equal(nc.status, "called");
  assert.deepEqual(nc.projections.map((p) => p.outlet), ["NBC News"]);
  assert.deepEqual(nc.withdrawn.map((w) => w.outlet), ["AP"]);
  // A retraction resolves a conflict in the other outlet's favour.
  const c = buildMapState({ projections: [P(), P({ outlet: "Fox News", party: "R" }), W({ outlet: "Fox News" })] });
  assert.equal(tile("NC", c).status, "called");
  assert.equal(tile("NC", c).party, "D");
});

test("retraction with no race applies to every race in the state; bad ones are refused", () => {
  const s = buildMapState({ projections: [
    P({ race: "governor", state: "PA", candidate: "Josh Shapiro" }),
    W({ race: undefined, state: "PA" }),
    W({ outlet: "" }),
  ] });
  assert.equal(tile("PA", s, "governor").status, "uncalled");
  assert.deepEqual(s.refused.map((r) => r.reason), ["retraction:no-outlet"]);
});

test("an item with no race is refused once, not once per view (review finding 5)", () => {
  const s = buildMapState({ projections: [P({ race: undefined })] });
  assert.deepEqual(s.refused.map((r) => r.reason), ["no-such-race"]);
});

test("refused: no outlet, no party, no such race, no time", () => {
  assert.equal(refuseReason(P({ outlet: " " })), "no-outlet");
  assert.equal(refuseReason(P({ party: "" })), "no-party");
  assert.equal(refuseReason(P({ state: "CA" })), "no-such-race");
  assert.equal(refuseReason(P({ at: "nope" })), "no-time");
});

test("a results feed's winner flag never colours a state", () => {
  const count = parseRace({ province: "NC", percent_reporting: 99, candidates: [
    { name: "Roy Cooper", party: "Democratic", votes: 100, percent: 51, winner: true },
    { name: "Michael Whatley", party: "Republican", votes: 90, percent: 49, winner: false },
  ] }, { now: AFTER_CLOSE });
  assert.deepEqual(count.sourceWinner, ["Roy Cooper"]);
  const s = buildMapState({ counts: { senate: new Map([["NC", count]]) } });
  const nc = tile("NC", s);
  assert.equal(nc.status, "uncalled");
  assert.equal(nc.count.source, "civicAPI");
  const html = renderMapHtml(s);
  assert.match(html, /99% reporting · Source: civicAPI/);
  assert.match(html, /Vote counts: civicAPI \(civicapi\.org\)/);
  assert.match(html, /Projections: none yet/);
});

// ── control bars ───────────────────────────────────────────────────────────────
test("Senate bar = seats not up + attributed projections", () => {
  const s = buildMapState({ projections: [P(), P({ state: "TX", party: "R", candidate: "x" }), P({ state: "NE", party: "I", candidate: "y" })] });
  const b = s.senate.bar;
  assert.equal(b.D, SENATE_NOT_UP.D + 1);
  assert.equal(b.R, SENATE_NOT_UP.R + 1);
  assert.equal(b.I, SENATE_NOT_UP.I + 1);
  assert.equal(b.uncalled, 32);
});

test("House bar: per-outlet seat reports, side by side, never merged", () => {
  const reports = foldHouseReports([
    { kind: "house-seats", outlet: "AP", at: "2026-11-04T04:00:00Z", seats: { D: 190, R: 180 } },
    { kind: "house-seats", outlet: "AP", at: "2026-11-04T03:00:00Z", seats: { D: 150, R: 160 } },
    { kind: "house-seats", outlet: "CNN", at: "2026-11-04T03:30:00Z", seats: { D: 185, R: 182 } },
    { kind: "house-seats", outlet: "", at: "2026-11-04T03:30:00Z", seats: { D: 300 } },
  ]);
  assert.deepEqual(reports.map((r) => [r.outlet, r.seats.D]), [["AP", 190], ["CNN", 185]]);
  const html = renderMapHtml(buildMapState({ houseReports: reports.map((r) => ({ kind: "house-seats", ...r })) }));
  assert.match(html, /<h2>House<\/h2>/);
  assert.match(html, /Projected by AP/);
  assert.match(html, /Projected by CNN/);
});

test("House bar does not render with no reports (earn-render)", () => {
  assert.doesNotMatch(renderMapHtml(buildMapState({})), /<h2>House<\/h2>/);
});

test("governors view renders its own tiles; source lines are ≥ 26 px", () => {
  const s = buildMapState({ projections: [P({ race: "governor", state: "PA", party: "D", candidate: "Josh Shapiro" })] });
  assert.equal(tile("PA", s, "governor").status, "called");
  assert.equal(tile("PA", s).status, "no-race");
  const html = renderMapHtml(s, { view: "governor" });
  assert.match(html, /Governors: projected winners/);
  assert.ok(MIN_SOURCE_PX >= 26);
  assert.match(html, /\.src\{font-size:26px/);
});

test("rendered text is escaped", () => {
  const html = renderMapHtml(buildMapState({ projections: [P({ outlet: "<script>x</script>" })] }));
  assert.doesNotMatch(html, /<script>x/);
});

// ── civicAPI parsing and politeness ────────────────────────────────────────────
test("civicAPI: roll-ups and test data skipped; votes > 0; duplicate surnames shown by party", () => {
  assert.equal(parseRace({ province: "US", candidates: [] }), null);
  assert.equal(parseRace({ province: "AK", test_data: true, candidates: [] }), null);
  const c = parseRace({ province: "AK", percent_reporting: 30, candidates: [
    { name: "Dan Sullivan", party: "Republican", votes: 50, major_candidate: true },
    { name: "Daniel J. Jr. Sullivan", party: "Republican", votes: 5, major_candidate: true },
    { name: "Mary Peltola", party: "Democratic", votes: 40, major_candidate: true },
    { name: "Minor", party: "Green", votes: 3, major_candidate: false },
    { name: "Zero", party: "Libertarian", votes: 0, major_candidate: true },
  ] }, { now: AFTER_CLOSE });
  assert.deepEqual(c.shares.map((s) => s.name), [null, "Mary Peltola", null]);
  assert.equal(c.percentReporting, 30);
  assert.equal(parseRace({ province: "TX", percent_reporting: 2.11e3, candidates: [{ name: "A", party: "R", votes: 1 }] }, { now: AFTER_CLOSE }).percentReporting, null);
});

test("civicAPI client: named User-Agent, one fetch per race per minute, keeps last good copy", async () => {
  let t = AFTER_CLOSE;
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, ua: opts.headers["User-Agent"] });
    if (url.includes("/race/search")) return { ok: true, json: async () => ({ races: [{ id: 1, province: "US" }, { id: 7, province: "NC" }] }) };
    if (calls.length > 3) return { ok: false, status: 500 };
    return { ok: true, json: async () => ({ province: "NC", percent_reporting: 10, candidates: [{ name: "A", party: "Democratic", votes: 5 }] }) };
  };
  const client = createCivicClient({ fetchImpl, now: () => t, intervalMs: 1000 });
  const a = await client.counts("senate");
  const b = await client.counts("senate");
  assert.equal(calls.length, 2, "second call within the minute is served from cache");
  assert.ok(calls.every((c) => /^ScoopFeedsRadio\//.test(c.ua)));
  assert.ok(!calls.some((c) => c.url.endsWith("/race/1")), "the national roll-up is never fetched");
  t += MIN_INTERVAL_MS;
  const c = await client.counts("senate");
  assert.equal(a.get("NC").percentReporting, 10);
  assert.equal(b.get("NC").percentReporting, 10);
  assert.equal(c.get("NC").percentReporting, 10, "a failed refresh keeps the last good count");
  assert.equal(client.errors.length, 1);
});

test("civicAPI: counts before polls close, or implausibly large, are held (the 23 Oct PA case)", () => {
  // Shape measured on 23 Oct 2026: PA governor, 8.6M votes each, 76.1% reporting,
  // polls_close present, registered_voters null.
  const pa = { province: "PA", percent_reporting: 76.1, polls_close: "2026-11-04T01:00:00.000Z", registered_voters: null, candidates: [
    { name: "Ken Krawchuk", party: "Libertarian", votes: 8617128, percent: 33.36 },
    { name: "Stacy Garrity", party: "Republican", votes: 8610711, percent: 33.33 },
    { name: "Josh Shapiro", party: "Democratic", votes: 8604294, percent: 33.31 },
  ] };
  const early = parseRace(pa, { now: Date.parse("2026-10-23T01:00:00Z") });
  assert.equal(early.held, "before-polls-close");
  assert.deepEqual(early.shares, []);
  const s = buildMapState({ counts: { governor: new Map([["PA", early]]) } });
  assert.equal(tile("PA", s, "governor").count, undefined);
  assert.doesNotMatch(renderMapHtml(s, { view: "governor" }), /Krawchuk|civicAPI/);
  // The same numbers AFTER polls close, with no registered_voters: held by the ceiling.
  assert.ok(voteCeiling("PA") < 25_000_000 && voteCeiling("PA") > 7_000_000);
  assert.equal(parseRace(pa, { now: AFTER_CLOSE }).held, "total-exceeds-ceiling");
  // A plausible PA count after close is shown.
  const ok = { ...pa, candidates: [{ name: "Josh Shapiro", party: "Democratic", votes: 2_000_000 }, { name: "Stacy Garrity", party: "Republican", votes: 1_800_000 }] };
  assert.equal(parseRace(ok, { now: AFTER_CLOSE }).held, null);
  assert.equal(parseRace({ ...ok, registered_voters: 3_000_000 }, { now: AFTER_CLOSE }).held, "total-exceeds-registered");
});

test("civicAPI: the hold uses the LATER of civicAPI's polls_close and our last-close table", () => {
  const ky = (polls_close) => ({ province: "KY", polls_close, candidates: [{ name: "A", party: "Republican", votes: 10 }] });
  // civicAPI said 17:00 ET for KY on 23 Oct; western KY votes until 19:00 ET.
  assert.equal(lastPollsCloseIso("KY"), "2026-11-04T00:00:00.000Z");
  assert.equal(parseRace(ky("2026-11-03T22:00:00.000Z"), { now: Date.parse("2026-11-03T23:30:00Z") }).held, "before-polls-close");
  assert.equal(parseRace(ky("2026-11-03T22:00:00.000Z"), { now: Date.parse("2026-11-04T00:00:00Z") }).held, null);
  // A later payload time still wins over the table.
  assert.equal(parseRace(ky("2026-11-04T06:00:00Z"), { now: Date.parse("2026-11-04T01:00:00Z") }).held, "before-polls-close");
  // No payload time: the table alone (AK = 01:00 ET on 4 Nov).
  assert.equal(parseRace({ province: "AK", candidates: [{ name: "A", party: "Republican", votes: 10 }] }, { now: Date.parse("2026-11-04T05:30:00Z") }).held, "before-polls-close");
  assert.equal(Object.keys(LAST_POLLS_CLOSE_ET).length, 51);
});

test("civicAPI client: audit lists are capped", async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  let t = AFTER_CLOSE;
  const c = createCivicClient({ fetchImpl, now: () => t });
  for (let i = 0; i < AUDIT_CAP + 20; i += 1) { await c.raceIds("senate"); t += MIN_INTERVAL_MS; }
  assert.equal(c.errors.length, AUDIT_CAP);
});

test("civicAPI off switch and per-state block", async () => {
  assert.equal(countsSwitch({ RADIO_ELECTION_COUNTS: "OFF" }).off, true);
  assert.deepEqual([...countsSwitch({ RADIO_ELECTION_COUNTS_BLOCK: "pa, ak" }).block], ["PA", "AK"]);
  let n = 0;
  const fetchImpl = async (url) => { n += 1; return { ok: true, json: async () => (url.includes("search") ? { races: [{ id: 2, province: "PA" }] } : { province: "PA", candidates: [{ name: "A", party: "R", votes: 1 }] }) }; };
  const c = createCivicClient({ fetchImpl, now: () => AFTER_CLOSE });
  assert.equal((await c.counts("governor", { RADIO_ELECTION_COUNTS: "off" })).size, 0);
  assert.equal(n, 0, "off means not even fetched");
  const before = n;
  assert.equal((await c.counts("governor", { RADIO_ELECTION_COUNTS_BLOCK: "PA" })).size, 0);
  assert.equal(n - before, 1, "a blocked state is not fetched (only the race search is)");
  assert.equal((await c.counts("governor", {})).size, 1);
});

// ── when it airs ───────────────────────────────────────────────────────────────
test("schedule: headlines 3–6 Nov, full-screen every 15 min on election night, governors rotate in", () => {
  assert.equal(inHeadlinesWindow(new Date("2026-11-02T15:00:00Z")), false);
  assert.equal(inHeadlinesWindow(new Date("2026-11-03T15:00:00Z")), true);
  assert.equal(inHeadlinesWindow(new Date("2026-11-06T22:00:00Z")), true);
  assert.equal(inHeadlinesWindow(new Date("2026-11-07T12:00:00Z")), false);
  assert.equal(isElectionNight(new Date("2026-11-03T21:59:00Z")), false); // 16:59 ET
  assert.equal(isElectionNight(new Date("2026-11-03T23:00:00Z")), true);  // 18:00 ET
  assert.equal(isElectionNight(new Date("2026-11-04T10:59:00Z")), true);  // 05:59 ET
  assert.equal(isElectionNight(new Date("2026-11-04T11:00:00Z")), false); // 06:00 ET
  const at = (iso) => mapCue(new Date(iso), { hasCall: true });
  assert.equal(at("2026-11-04T02:15:00Z").fullScreen, true);
  assert.equal(at("2026-11-04T02:16:00Z").fullScreen, false);
  assert.equal(at("2026-11-04T02:15:00Z").view, "governor");
  assert.equal(at("2026-11-04T02:30:00Z").view, "senate");
});
