/**
 * sampleElection.mjs - a worst-case, FULL election board for the rendered font-floor and overflow test (#197 review,
 * 25 Oct 2026). Invented names and quotes only; it never airs. Every Senate and governor race is called, with the
 * longest outlet names, long candidate names, several conflicts, four House seat reports and long verbatim quotes,
 * so a board that fits here fits on election night.
 */
import { SENATE_UP, GOVERNOR_UP, STATE_NAMES, SENATE_SEATS, SENATE_MAJORITY, HOUSE_SEATS, HOUSE_MAJORITY } from "../../election/races2026.js";
import { boardPages } from "../../programme/electionDesk.js";

const AT = Date.parse("2026-11-04T04:00:00Z");
const OUTLETS = ["The Associated Press", "Decision Desk HQ", "NBC News", "Fox News", "CBS News"];
const NAMES = ["Alexandria Longname-Smith", "Christopher Example-Harrington", "Maximilian Sample-Worthington", "Jane Q. Sampleperson"];

function rows(codes, race) {
  return codes.map((state, i) => {
    const name = STATE_NAMES[state], at = new Date(AT - i * 60_000).toISOString();
    const call = (k, party) => ({ outlet: OUTLETS[k % OUTLETS.length], party, candidate: NAMES[(i + k) % NAMES.length], quote: `${OUTLETS[k % OUTLETS.length]} projects ${NAMES[(i + k) % NAMES.length]} wins the ${name} ${race} race.`, source: "Sample Wire", at });
    if (i % 6 === 2) return { state, name, status: "conflict", label: "Outlets disagree", calls: [call(0, "D"), call(1, "R"), call(3, "R")] };
    const calls = [call(0, i % 2 ? "R" : "D"), call(1, i % 2 ? "R" : "D")];
    return { state, name, status: "called", label: `Projected by ${calls[0].outlet} and ${calls[1].outlet}`, calls };
  });
}

export function fullBoard() {
  const senate = rows(Object.keys(SENATE_UP), "Senate"), governor = rows(GOVERNOR_UP, "governor");
  const tally = (rs) => rs.filter((r) => r.status === "called").reduce((t, r) => ({ ...t, [r.calls[0].party]: (t[r.calls[0].party] || 0) + 1 }), {});
  const long = "In a statement released shortly after midnight, the organisation's decision desk said it had projected the outcome after reviewing the counted vote in every county, the share of the expected vote still outstanding, and the results of its own survey of voters, and that it would revisit the projection if the remaining ballots changed the picture.";
  return {
    senate: { seats: SENATE_SEATS, majority: SENATE_MAJORITY, projected: tally(senate), rows: senate,
      control: [{ outlet: "The Associated Press", party: "R", quote: "x", source: "Sample Wire", status: "called" }] },
    governor: { rows: governor, projected: tally(governor) },
    house: { seats: HOUSE_SEATS, majority: HOUSE_MAJORITY,
      reports: OUTLETS.slice(0, 4).map((outlet, k) => ({ outlet, seats: { R: 212 + k, D: 200 - k }, quote: "x", source: "Sample Wire", at: new Date(AT).toISOString() })),
      control: [{ outlet: "Decision Desk HQ", party: "R", quote: "x", source: "Sample Wire", status: "called" }, { outlet: "NBC News", party: "D", quote: "x", source: "Sample Wire", status: "conflict" }], districts: [] },
    latest: OUTLETS.slice(0, 4).map((outlet, k) => ({ outlet, quote: k % 2 ? `${outlet} projects ${NAMES[k]} wins the Pennsylvania governor race.` : `${long} ${outlet} projects ${NAMES[k]} wins.`, source: "Sample Wire", at: new Date(AT - k * 60_000).toISOString(), kind: "projection" })),
    builtAt: AT,
  };
}

/** Election night early on: a few races called, the rest listed under "Not yet called". */
export function partialBoard() {
  const b = fullBoard();
  const open = (r, i) => (i < 7 ? r : { state: r.state, name: r.name, status: "open", label: "Not yet called" });
  return { ...b, senate: { ...b.senate, rows: b.senate.rows.map(open) }, governor: { ...b.governor, rows: b.governor.rows.map(open) } };
}

/** The board's pages as programme scenes, `gap` ms apart from `from`. */
export function electionScenes(from, gap = 3000) {
  const scenes = {};
  [...boardPages(fullBoard()).map((p) => ["full", p]), ...boardPages(partialBoard()).filter((p) => p.kind === "races").map((p) => ["early", p])].forEach(([tag, page], i) => {
    const key = `election-${tag}-${page.kind}${page.view ? "-" + page.view : ""}${page.of > 1 ? "-" + page.n : ""}`;
    scenes[key] = { at: from + i * gap, scene: "election", data: { page, builtAt: AT } };
  });
  return scenes;
}
