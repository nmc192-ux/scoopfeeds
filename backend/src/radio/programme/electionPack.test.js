/**
 * electionPack.test.js - the election desk (#197) on fixture articles. No network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { extractElectionPack, itemsFromSentence, electionText, candidateOf } from "./electionPack.js";
import { checkSegments, electionReason } from "./checks.js";
import { buildClock, checkClock } from "./clock.js";
import { deskOn, addDeskToClock, ballotLines, addBallotLines, boardData, DESK_FROM, DESK_UNTIL, EXPLAINER_UNTIL } from "./electionDesk.js";
import { buildPrompt } from "./writer.js";

const NOW = Date.parse("2026-11-04T03:00:00Z");
const art = (source, title, description = "", minsAgo = 30) => ({ source, title, description, published: NOW - minsAgo * 60_000, url: `https://example.com/${encodeURIComponent(title).slice(0, 40)}` });

const FIXTURE = [
  art("Reuters", "AP projects Democrat Roy Cooper wins North Carolina Senate race"),
  art("CNN", "Cooper leads in North Carolina Senate polls"),
  art("Fox News", "Fox News Decision Desk projects Republican Michael Whatley wins the North Carolina Senate race", "", 20),
  art("NBC News", "Ohio Senate race too early to call, NBC News says", "With 64% of the expected vote counted in the Ohio Senate race, the count continues."),
  art("AP", "The Associated Press projects Republicans will keep control of the House."),
  art("Politico", "Decision Desk HQ called the race for Josh Shapiro in the Pennsylvania governor contest."),
  art("Old Wire", "AP projects Ted Cruz wins Texas Senate race", "", 7 * 60),   // outside the 6-hour window
  art("CNBC", "Republicans win Georgia Senate race"),                          // no organisation projected it
  art("Reuters", "Republicans have won 218 House seats, AP projects"),
];
const ep = () => extractElectionPack(FIXTURE, { now: NOW });

test("an article saying 'AP projects X wins' yields an attributed call", () => {
  const { items } = itemsFromSentence("AP projects Democrat Roy Cooper wins North Carolina Senate race", { source: "Reuters", published: NOW, url: "u" });
  assert.equal(items.length, 1);
  assert.deepEqual({ kind: items[0].kind, race: items[0].race, state: items[0].state, party: items[0].party, candidate: items[0].candidate, outlet: items[0].outlet, source: items[0].source, url: items[0].url },
    { kind: "projection", race: "senate", state: "NC", party: "D", candidate: "Roy Cooper", outlet: "AP", source: "Reuters", url: "u" });
  assert.equal(items[0].quote, "AP projects Democrat Roy Cooper wins North Carolina Senate race");
  assert.equal(items[0].at, new Date(NOW).toISOString());
});

test("an article saying 'X leads in polls' yields no call", () => {
  assert.deepEqual(itemsFromSentence("Cooper leads in North Carolina Senate polls", { source: "CNN", published: NOW }).items, []);
  // even with a projecting organisation named, a poll or lead is refused
  const r = itemsFromSentence("NBC News projects Cooper is leading in the North Carolina Senate race", { source: "NBC", published: NOW });
  assert.deepEqual(r.items, []); assert.equal(r.refused[0].reason, "poll-or-lead");
  const neg = itemsFromSentence("AP says the North Carolina Senate race has not been called and cannot yet project a winner", { source: "AP", published: NOW });
  assert.deepEqual(neg.items, []);
  // a result with no organisation is not a call
  assert.deepEqual(itemsFromSentence("Republicans win Georgia Senate race", { source: "CNBC", published: NOW }).items, []);
});

test("two outlets disagreeing yields two entries, side by side, never merged", () => {
  const p = ep();
  const nc = p.races.find((r) => r.race === "senate" && r.state === "NC");
  assert.equal(nc.status, "conflict");
  assert.deepEqual(nc.calls.map((c) => [c.outlet, c.party]).sort(), [["AP", "D"], ["Fox News", "R"]]);
  assert.match(electionText(p), /CONFLICT \(senate, North Carolina\)/);
  assert.equal(boardData(p).senate.rows.find((r) => r.state === "NC").label, "Outlets disagree");
  assert.equal(boardData(p).senate.projected.D, undefined);   // a conflict colours nothing
});

test("pack: 6-hour window, counts only when stated, house control and seat tallies, retractions", () => {
  const p = ep();
  assert.ok(!p.items.some((i) => i.state === "TX"), "a 7-hour-old article is outside the window");
  const count = p.items.find((i) => i.kind === "count");
  assert.deepEqual([count.race, count.state, count.reportingPct, count.outlet], ["senate", "OH", 64, "NBC News"]);
  assert.ok(p.items.some((i) => i.kind === "projection" && i.race === "house-control" && i.party === "R" && i.outlet === "AP"));
  assert.deepEqual(p.items.find((i) => i.kind === "house-seats").seats, { R: 218 });
  assert.equal(p.races.find((r) => r.race === "governor").calls[0].candidate, "Josh Shapiro");
  const withdrawn = extractElectionPack([...FIXTURE, art("AP", "AP withdrew its call in the Pennsylvania governor race", "", 5), art("Politico2", "Decision Desk HQ withdrew its call in the Pennsylvania governor race", "", 5)], { now: NOW });
  const pa = withdrawn.races.find((r) => r.race === "governor" && r.state === "PA");
  assert.equal(pa.status, "open"); assert.equal(pa.withdrawn[0].outlet, "Decision Desk HQ");
  assert.equal(candidateOf("NBC News projects Sen. Susan Collins (R) wins re-election in Maine"), "Susan Collins");
  const wv = itemsFromSentence("NBC News projects Republican Shelley Moore Capito wins West Virginia Senate race", { source: "NBC News", published: NOW }).items[0];
  assert.deepEqual([wv.state, wv.party, wv.candidate], ["WV", "R", "Shelley Moore Capito"]);   // West Virginia is not also Virginia
  assert.equal(itemsFromSentence("The New York Times projects Democrat Jane Roe wins the Ohio Senate race", { source: "NYT", published: NOW }).items[0].state, "OH");
});

const pack = (election) => ({ top: [], desks: { midterms: election.stories }, markets: [], weather: [], election });
const desk = [{ id: "midterms", segment: "midterms" }];
const hourSlot = [{ id: "the-hour", segment: "the-hour" }];

test("checks drop an unattributed 'X won' line, and keep an attributed one", () => {
  const p = pack(ep());
  const lines = [
    { id: "p1", text: "Roy Cooper won the North Carolina Senate race." },
    { id: "p2", text: "The Associated Press projects Roy Cooper wins the North Carolina Senate race. Fox News projects Michael Whatley." },
    { id: "p3", text: "Josh Shapiro will win the Pennsylvania governor's race." },
    { id: "p4", text: "CNN projects Josh Shapiro wins in Pennsylvania." },                       // CNN made no such projection
    { id: "p5", text: "Decision Desk HQ projects Josh Shapiro wins the governor's race in Pennsylvania." },
    { id: "p6", text: "Ohio's Senate race has not been called." },
  ];
  const { segments, report } = checkSegments({ midterms: { lines } }, desk, p);
  assert.deepEqual(segments.midterms.lines.map((l) => l.id), ["p2", "p5", "p6"]);
  assert.deepEqual(report.map((r) => [r.line, r.drop.split(":")[0]]), [["p1", "election"], ["p3", "election"], ["p4", "election"]]);
  // the same rule holds outside the desk: a result in The Hour needs its projection too
  const hr = checkSegments({ "the-hour": { lines: [{ id: "s1", text: "Republicans won the Georgia Senate race." }] } }, hourSlot, p).report;
  assert.match(hr[0].drop, /without the organisation/);
});

test("checks: polls are never results; partial counts say how much is in", () => {
  const e = ep();
  assert.match(electionReason("A new poll shows Cooper will win North Carolina's Senate race.", e), /poll read as a result/);
  assert.equal(electionReason("Cooper leads Whatley in the latest North Carolina Senate polls.", e), null);   // a poll, said as a poll
  assert.match(electionReason("In Ohio's Senate race, Husted leads.", e), /how much is in/);
  assert.equal(electionReason("In Ohio's Senate race, with 64 percent of the expected vote counted, counting continues.", e), null);
  assert.equal(electionReason("Husted is ahead in Ohio's Senate race; counting continues.", e), null);
  // the stated share must be in the pack (numbers check)
  const r = checkSegments({ midterms: { lines: [{ id: "c1", text: "In Ohio, 80 percent of the expected vote is counted and counting continues." }] } }, desk, pack(e)).report;
  assert.match(r[0].drop, /unbacked figure/);
});

test("checks: ordinary news lines are not election lines", () => {
  const p = { top: [{ id: "t1", headline: "x", count: 1, outlets: [{ source: "Reuters", title: "Oil demand is projected to rise as Japan's ruling party won the election and the Senate votes on the budget", description: "" }] }], desks: {}, markets: [], weather: [], election: ep() };
  const lines = ["Oil demand is projected to rise, Reuters reports.", "In Japan, the ruling party won the election.", "The Senate votes on the budget this week.", "Senate Majority Leader John Thune leads the talks."]
    .map((text, i) => ({ id: `s${i}`, story: "t1", text }));
  assert.deepEqual(checkSegments({ "the-hour": { lines } }, hourSlot, p).report, []);
});

test("checks: no Pakistan politics on the desk either", () => {
  const r = checkSegments({ midterms: { lines: [{ id: "x", text: "Imran Khan's party called a rally in Lahore before the vote." }] } }, desk, pack(ep())).report;
  assert.match(r[0].drop, /^rule0/);
});

test("clock: the desk takes the first 180 s of music-1, dark unless RADIO_ELECTION_DESK=1, 26 Oct to 6 Nov", () => {
  const H = Date.parse("2026-10-27T16:00:00Z");
  assert.equal(deskOn(H, { env: {} }), false);
  assert.equal(deskOn(H, { env: { RADIO_ELECTION_DESK: "true" } }), false);
  assert.equal(deskOn(H, { env: { RADIO_ELECTION_DESK: "1" } }), true);
  assert.equal(deskOn(DESK_FROM - 3600_000, { env: { RADIO_ELECTION_DESK: "1" } }), false);
  assert.equal(deskOn(DESK_UNTIL, { env: { RADIO_ELECTION_DESK: "1" } }), false);
  for (const opts of [{}, { featureSec: 756, featureTitle: "A-Eye" }]) {
    const c = buildClock(H, opts);
    const d = addDeskToClock(c, H);
    assert.deepEqual(checkClock(c), []);
    assert.deepEqual([d.startSec, d.endSec, d.kind, d.segment], [840, 1020, "spoken", "midterms"]);
    const m = c.find((s) => s.id === "music-1");
    assert.deepEqual([m.startSec, m.endSec, m.sting, m.start], [1020, 1200, false, H + 1020_000]);
  }
  assert.ok(buildPrompt(pack(ep()), [addDeskToClock(buildClock(H), H)], { hourLabel: "x", cityTimes: "y", marketsAsOf: {} }).includes('"midterms"'));
});

test("ballot explainer: rotates by hour, ends when the first polls close, and passes the checks", () => {
  const H = Date.parse("2026-10-27T16:00:00Z");
  const themes = new Set([0, 1, 2].map((k) => ballotLines(H + k * 3600_000)[0].text));
  assert.equal(themes.size, 3);
  assert.deepEqual(ballotLines(EXPLAINER_UNTIL), []);
  for (let k = 0; k < 3; k++) {
    const raw = addBallotLines({ midterms: { lines: [{ id: "open", text: "The Midterms, on ScoopFeeds Radio." }, { id: "close", text: "That's the desk." }] } }, H + k * 3600_000);
    assert.equal(raw.midterms.lines[1].id, "b1");
    const { report } = checkSegments(raw, desk, pack(extractElectionPack([], { now: H })));
    assert.deepEqual(report, [], JSON.stringify(report));
  }
});

test("board: earn-render, 'Projected by <outlet>' on every called race, 'Not yet called' for the rest", () => {
  assert.equal(boardData(extractElectionPack([FIXTURE[1], FIXTURE[7]], { now: NOW })), null);   // polls and unattributed: no board
  const b = boardData(ep());
  const pa = b.governor.rows.find((r) => r.state === "PA");
  assert.equal(pa.label, "Projected by Decision Desk HQ");
  assert.equal(pa.calls[0].quote, "Decision Desk HQ called the race for Josh Shapiro in the Pennsylvania governor contest.");
  assert.ok(b.senate.rows.filter((r) => r.state !== "NC").every((r) => r.label === "Not yet called"));
  assert.equal(b.senate.rows.length, 35); assert.equal(b.governor.rows.length, 36);
  assert.deepEqual(b.house.reports[0].seats, { R: 218 }); assert.equal(b.house.reports[0].outlet, "AP");
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
test("rehearsal: a desk hour on fixture data has the desk and the board, with attribution", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const { assemble, fakeVoice } = await import("./assemble.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desk-"));
  const bed = path.join(dir, "bed.wav");
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=30", "-ac", "2", "-ar", "44100", bed]);
  const H = Date.parse("2026-11-04T03:00:00Z");
  const clock = buildClock(H);
  const slot = addDeskToClock(clock, H);
  const e = ep(); const p = pack(e);
  const raw = { midterms: { lines: [
    { id: "open", text: "The Midterms, on ScoopFeeds Radio." },
    { id: "p1", text: "The Associated Press projects Roy Cooper wins the North Carolina Senate race. Fox News projects Michael Whatley wins it." },
    { id: "p2", text: "Decision Desk HQ projects Josh Shapiro wins the Pennsylvania governor's race." },
    { id: "p3", text: "Roy Cooper won." },
    { id: "close", text: "That's the Midterms desk." },
  ] } };
  const { segments, report } = checkSegments(raw, [slot], p);
  assert.deepEqual(report.map((r) => r.line), ["p3"]);
  const { cues } = await assemble({ slots: [slot], segments, pack: p, hourStart: H, bedFor: () => ({ file: bed, lufs: -16, len: 30 }), voice: fakeVoice(path.join(dir, "v")), outWav: path.join(dir, "part.wav") });
  const title = cues.find((c) => c.scene === "title");
  assert.equal(title.data.title, "The Midterms");
  const board = cues.filter((c) => c.scene === "election");
  assert.deepEqual(board.map((c) => c.data.view), ["senate", "governor"]);
  assert.equal(board[0].data.senate.rows.find((r) => r.state === "NC").calls.map((c) => c.outlet).sort().join(","), "AP,Fox News");
  assert.ok(board[0].at >= H + 840_000 && board[0].at < H + 1020_000);
  fs.rmSync(dir, { recursive: true, force: true });
});
