/**
 * Incident media entering the ONE compositing path.
 *
 * Two properties matter most here and both are asserted directly: the shape
 * handed to the assembler is the shape it already takes (so no second
 * compositing path is needed), and incident beats stock wherever both could fill
 * a beat (the source ladder).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  incidentMediaEnabled, toRenderable, selectIncidentCutaways, mergeCutaways,
  secondsFor, creditForPick, IncidentRenderRefused,
} from "./incidentCutaways.js";
import { EXCERPT_MAX_SECS, EXCERPT_MAX_TOTAL_SECS, ClearanceRefusedError } from "./incidentClearance.js";
import { MAX_CUTAWAYS } from "../videoStockLibrary.js";

function caught(fn, Type) {
  try { fn(); } catch (err) {
    if (Type) assert.ok(err instanceof Type, `expected ${Type.name}, got ${err?.name}: ${err?.message}`);
    return err;
  }
  assert.fail("expected a throw, got none");
}

/** A quarantine dir with real files in it. */
function files(t, ids) {
  const dir = mkdtempSync(path.join(tmpdir(), "inc-cut-"));
  const root = path.join(dir, "q");
  mkdirSync(root, { recursive: true });
  for (const id of ids) writeFileSync(path.join(root, `${id}-treated.mp4`), "x".repeat(2000));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return root;
}

const cand = (id, over = {}) => ({
  id, status: "cleared", render_approved: 1,
  credit_text: `Poster ${id} / BLUESKY`,
  clearance_basis: "grant",
  treated_path: `${id}-treated.mp4`,
  local_path: `${id}.mp4`,
  ...over,
});

const slides = (n) => Array.from({ length: n }, (_, i) => ({ i }));

// ─── The flag ───────────────────────────────────────────────────────────────

test("the feature is dark unless the flag is literally \"1\"", () => {
  const prev = process.env.VIDEO_INCIDENT_MEDIA_ENABLED;
  try {
    for (const v of [undefined, "", "0", "true", "yes", "TRUE", " 1"]) {
      if (v === undefined) delete process.env.VIDEO_INCIDENT_MEDIA_ENABLED;
      else process.env.VIDEO_INCIDENT_MEDIA_ENABLED = v;
      assert.equal(incidentMediaEnabled(), false, JSON.stringify(v));
    }
    process.env.VIDEO_INCIDENT_MEDIA_ENABLED = "1";
    assert.equal(incidentMediaEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.VIDEO_INCIDENT_MEDIA_ENABLED;
    else process.env.VIDEO_INCIDENT_MEDIA_ENABLED = prev;
  }
});

// ─── The shape the assembler already takes ─────────────────────────────────

test("a renderable asset carries exactly what assembleSlide needs, and nothing new", (t) => {
  const id = "aaa";
  const root = files(t, [id]);
  const a = toRenderable(cand(id), { root });

  // assembleSlide takes cutawayPath, cutawaySecs, cutawayCredit. Everything
  // needed is here, so no second compositing path is required.
  assert.ok(a.absPath.endsWith(`${id}-treated.mp4`));
  assert.equal(typeof a.seconds, "number");
  assert.equal(a.credit, "Poster aaa / BLUESKY");
  assert.equal(a.provenance, "incident");
});

test("the treated copy is what renders, never the raw file", (t) => {
  const id = "bbb";
  const root = files(t, [id]);
  assert.ok(toRenderable(cand(id), { root }).absPath.includes("-treated"));
});

// ─── Refusals at render time ───────────────────────────────────────────────

test("an untapped, uncleared or uncredited candidate is refused at render time too", (t) => {
  const id = "ccc";
  const root = files(t, [id]);
  assert.throws(() => toRenderable(cand(id, { render_approved: 0 }), { root }), ClearanceRefusedError);
  assert.throws(() => toRenderable(cand(id, { status: "verified" }), { root }), ClearanceRefusedError);
  assert.throws(() => toRenderable(cand(id, { credit_text: "  " }), { root }), ClearanceRefusedError);
});

test("a cleared asset we hold no file for is refused with that said plainly", (t) => {
  const root = files(t, []);
  const err = caught(() => toRenderable(cand("ddd", { treated_path: null, local_path: null }), { root }), IncidentRenderRefused);
  assert.equal(err.code, "no-file");
  assert.match(err.message, /permission to use something we do not have/i);
});

test("an untreated asset is refused — untreated is the source's look, not ours", (t) => {
  const root = files(t, []);
  writeFileSync(path.join(root, "eee.mp4"), "x".repeat(2000));
  const err = caught(() => toRenderable(cand("eee", { treated_path: null }), { root }), IncidentRenderRefused);
  assert.equal(err.code, "untreated");
});

test("a file the sweeper already took is refused, not silently skipped", (t) => {
  const root = files(t, []);
  const err = caught(() => toRenderable(cand("fff"), { root }), IncidentRenderRefused);
  assert.equal(err.code, "file-missing");
  assert.match(err.message, /sweeper/i, "the message should name the likely cause");
});

// ─── Duration ───────────────────────────────────────────────────────────────

test("a fair-use asset is held to its own agreed excerpt length", () => {
  const c = cand("g", { clearance_basis: "fair_use", clearance_detail: JSON.stringify({ excerptSecs: 1.8 }) });
  assert.equal(secondsFor(c), 1.8);
});

test("no clearance can outlive the band the mechanism enforces", () => {
  // A clearance recorded when the cap was higher must not still be honoured.
  const c = cand("h", { clearance_basis: "fair_use", clearance_detail: JSON.stringify({ excerptSecs: 30 }) });
  assert.equal(secondsFor(c), EXCERPT_MAX_SECS);
});

test("grant and owner assets use the ordinary cutaway duration", () => {
  assert.ok(secondsFor(cand("i")) > 0);
  assert.ok(secondsFor(cand("i")) <= EXCERPT_MAX_SECS);
  // Malformed detail falls back rather than throwing.
  assert.ok(secondsFor(cand("j", { clearance_detail: "{{not json" })) > 0);
});

// ─── Selection ──────────────────────────────────────────────────────────────

test("cutaways are never on consecutive beats, and never exceed the ceiling", (t) => {
  const ids = ["a1", "a2", "a3", "a4"];
  const root = files(t, ids);
  const { picks } = selectIncidentCutaways(slides(10), { candidates: ids.map((i) => cand(i)), root });

  assert.ok(picks.length <= MAX_CUTAWAYS);
  for (let i = 1; i < picks.length; i++) {
    assert.ok(picks[i].slideIndex - picks[i - 1].slideIndex >= 2, "two cutaways back to back reads as a montage");
  }
});

test("the fair-use TOTAL is per video, not per asset", (t) => {
  // Three 3-second excerpts would be 9s; the budget is 6s across one video.
  const ids = ["f1", "f2", "f3"];
  const root = files(t, ids);
  const candidates = ids.map((i) => cand(i, {
    clearance_basis: "fair_use", clearance_detail: JSON.stringify({ excerptSecs: EXCERPT_MAX_SECS }),
  }));
  const { picks, fairUseSpent } = selectIncidentCutaways(slides(20), { candidates, max: 5, root });

  assert.ok(fairUseSpent <= EXCERPT_MAX_TOTAL_SECS, `spent ${fairUseSpent}s of a ${EXCERPT_MAX_TOTAL_SECS}s budget`);
  assert.equal(picks.length, 2);
});

test("a grant asset does not consume the fair-use budget", (t) => {
  const ids = ["g1", "g2"];
  const root = files(t, ids);
  const { fairUseSpent } = selectIncidentCutaways(slides(10), { candidates: ids.map((i) => cand(i)), root });
  assert.equal(fairUseSpent, 0, "only fair use draws on the fair-use budget");
});

test("refused candidates are REPORTED, not silently dropped", (t) => {
  const root = files(t, ["ok1"]);
  const { picks, refused } = selectIncidentCutaways(slides(6), {
    candidates: [cand("ok1"), cand("gone"), cand("no-tap", { render_approved: 0 })],
    root,
  });
  assert.equal(picks.length, 1);
  assert.equal(refused.length, 2);
  // A silently dropped asset is indistinguishable from one never selected.
  assert.ok(refused.every((r) => r.reason && r.candidateId));
});

test("no usable candidates is an empty selection, not an error", (t) => {
  const root = files(t, []);
  const { picks } = selectIncidentCutaways(slides(6), { candidates: [], root });
  assert.deepEqual(picks, []);
});

// ─── The source ladder ──────────────────────────────────────────────────────

test("incident beats stock on a beat both want — true to the story wins", () => {
  const incident = [{ slideIndex: 2, asset: { id: "inc", credit: "P / BLUESKY" } }];
  const stock = [{ slideIndex: 2, asset: { id: "stk", subjectClass: "ports" } }];
  const merged = mergeCutaways(incident, stock);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, "incident");
  assert.equal(merged[0].asset.id, "inc");
});

test("stock fills a beat incident does not want", () => {
  const merged = mergeCutaways(
    [{ slideIndex: 0, asset: { id: "inc" } }],
    [{ slideIndex: 4, asset: { id: "stk" } }]
  );
  assert.deepEqual(merged.map((p) => p.source), ["incident", "stock"]);
});

test("the no-consecutive rule holds ACROSS the two sources", () => {
  // Stock would land adjacent to an incident pick; it is dropped rather than
  // moved, because a beat with no cutaway is a correct beat.
  const merged = mergeCutaways(
    [{ slideIndex: 3, asset: { id: "inc" } }],
    [{ slideIndex: 4, asset: { id: "stk" } }]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, "incident");
});

test("the combined result still respects the per-video ceiling", () => {
  const merged = mergeCutaways(
    [{ slideIndex: 0, asset: { id: "i1" } }, { slideIndex: 3, asset: { id: "i2" } }],
    [{ slideIndex: 6, asset: { id: "s1" } }, { slideIndex: 9, asset: { id: "s2" } }]
  );
  assert.equal(merged.length, MAX_CUTAWAYS, "the ceiling is about the viewer, not the source");
});

test("merged picks come back in slide order", () => {
  const merged = mergeCutaways(
    [{ slideIndex: 5, asset: { id: "i" } }],
    [{ slideIndex: 1, asset: { id: "s" } }]
  );
  assert.deepEqual(merged.map((p) => p.slideIndex), [1, 5]);
});

test("credit comes from the right place for each source", () => {
  const stockCredit = (a) => `${a.creator} / ${a.provider.toUpperCase()}`;
  assert.equal(
    creditForPick({ source: "incident", asset: { credit: "Alice R / BLUESKY" } }, stockCredit),
    "Alice R / BLUESKY"
  );
  assert.equal(
    creditForPick({ source: "stock", asset: { creator: "Bob", provider: "pexels" } }, stockCredit),
    "Bob / PEXELS"
  );
});
