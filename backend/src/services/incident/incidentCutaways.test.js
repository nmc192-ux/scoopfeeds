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
  COLD_OPEN_SECS, assertColdOpen, coldOpenProtected,
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


// ─── The cold open is ours ─────────────────────────────────────────────────

test("no incident cutaway lands on the opening beat", (t) => {
  // Frame 0 autoplays in feed and is grabbed as the thumbnail. The Gate C render
  // opened on full-bleed borrowed material with the masthead suppressed.
  const ids = ["k1", "k2", "k3"];
  const root = files(t, ids);
  const { picks } = selectIncidentCutaways(slides(10), { candidates: ids.map((i) => cand(i)), root });
  assert.ok(picks.length > 0, "the guard must not simply disable the feature");
  assert.equal(picks.some((p) => p.slideIndex === 0), false, "slide 0 starts at t=0");
});

test("with real slide starts, every beat inside the cold open is excluded", (t) => {
  const ids = ["m1", "m2"];
  const root = files(t, ids);
  // A pathological timeline: three very short opening beats, all inside 0.8s.
  const slideStarts = [0, 0.3, 0.6, 1.4, 3.0, 5.0];
  const { picks } = selectIncidentCutaways(slides(6), {
    candidates: ids.map((i) => cand(i)), root, slideStarts,
  });
  for (const p of picks) {
    assert.ok(slideStarts[p.slideIndex] >= COLD_OPEN_SECS,
      `slide ${p.slideIndex} starts at ${slideStarts[p.slideIndex]}s, inside the ${COLD_OPEN_SECS}s cold open`);
  }
});

test("the cold-open constant is named and defaults into the ruled band", () => {
  assert.ok(COLD_OPEN_SECS >= 0.5 && COLD_OPEN_SECS <= 1.0, `COLD_OPEN_SECS is ${COLD_OPEN_SECS}`);
});

test("assertColdOpen is the authoritative check and THROWS", () => {
  // Selection's fallback is a heuristic; this one runs where the timeline is
  // actually known. A cold open on borrowed footage is the thumbnail, not a
  // degraded render to log and carry on with.
  const starts = [0, 2.0, 4.0];
  assert.equal(assertColdOpen([{ slideIndex: 1, source: "incident", asset: { id: "a" } }], starts), true);
  const err = caught(
    () => assertColdOpen([{ slideIndex: 0, source: "incident", asset: { id: "a" } }], starts),
    IncidentRenderRefused
  );
  assert.equal(err.code, "cold-open");
  assert.match(err.message, /thumbnail/i);
});

test("the cold-open guard does not apply to our OWN stock — only to borrowed footage", () => {
  // Stock is subject illustration we licensed; the rule is about third-party
  // incident material representing the event.
  assert.equal(assertColdOpen([{ slideIndex: 0, source: "stock", asset: { id: "s" } }], [0, 2]), true);
});

// ─── The relaxation is SCOPED to own material (DrJ, Gate F) ────────────────

test("own material MAY open a video — it is ours, framed, masthead intact", () => {
  const starts = [0, 2.0, 4.0];
  assert.equal(
    assertColdOpen([{ slideIndex: 0, source: "incident", asset: { id: "o", clearanceBasis: "owner" } }], starts),
    true,
    "a news channel opening on its own footage is the ordinary thing"
  );
});

test("the relaxation is SCOPED, not LIFTED — grant and fair_use are refused exactly as before", () => {
  // The failure this test exists for: `assertColdOpen` returning true for
  // everything, which would pass the own-material test above and silently
  // remove the guard for borrowed footage.
  const starts = [0, 2.0, 4.0];
  for (const basis of ["grant", "fair_use"]) {
    const err = caught(
      () => assertColdOpen([{ slideIndex: 0, source: "incident", asset: { id: "x", clearanceBasis: basis } }], starts),
      IncidentRenderRefused
    );
    assert.equal(err.code, "cold-open", `basis "${basis}" must still be refused`);
  }
});

test("an unestablished provenance is refused — the default protects the open", () => {
  // A pick with no asset, no basis, or a basis nobody recognises. The cheap
  // failure is a beat with no cutaway; the expensive one is somebody else's
  // footage as our thumbnail.
  const starts = [0, 2.0];
  for (const asset of [undefined, {}, { id: "x" }, { id: "x", clearanceBasis: null }, { id: "x", clearanceBasis: "OWNER" }, { id: "x", clearanceBasis: "licence" }]) {
    assert.equal(
      caught(() => assertColdOpen([{ slideIndex: 0, source: "incident", asset }], starts), IncidentRenderRefused).code,
      "cold-open",
      `asset ${JSON.stringify(asset)} must not open the video`
    );
  }
  // And a pick that is not a pick at all.
  assert.equal(coldOpenProtected(undefined), true);
  assert.equal(coldOpenProtected(null), true);
});

test("coldOpenProtected splits the three sources the way the ruling does", () => {
  assert.equal(coldOpenProtected({ source: "stock", asset: { id: "s" } }), false, "licensed library");
  assert.equal(coldOpenProtected({ source: "incident", asset: { clearanceBasis: "owner" } }), false, "ours");
  assert.equal(coldOpenProtected({ source: "incident", asset: { clearanceBasis: "grant" } }), true, "borrowed");
  assert.equal(coldOpenProtected({ source: "incident", asset: { clearanceBasis: "fair_use" } }), true, "borrowed");
});

test("SELECTION lets own material take the opening beat", (t) => {
  // The other half of the ruling. assertColdOpen is the authoritative check, but
  // selection is what decides whether the asset is ever offered that beat — and
  // it used to skip cold-open beats before knowing what would go there.
  const ids = ["own1", "own2"];
  const root = files(t, ids);
  const { picks } = selectIncidentCutaways(slides(10), {
    candidates: ids.map((i) => cand(i, { clearance_basis: "owner", credit_text: null })),
    root,
    slideStarts: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18],
  });
  assert.ok(picks.some((p) => p.slideIndex === 0), "own material must be able to open the video");
  // And the authoritative check agrees with the selector.
  assertColdOpen(picks.map((p) => ({ ...p, source: "incident" })), [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
});

test("SELECTION still keeps borrowed footage off the opening beat", (t) => {
  // Same fixture, one field different. If this ever goes green with slide 0
  // picked, the relaxation has stopped being scoped.
  const ids = ["g1", "g2"];
  const root = files(t, ids);
  const { picks } = selectIncidentCutaways(slides(10), {
    candidates: ids.map((i) => cand(i)),   // cand() defaults to basis "grant"
    root,
    slideStarts: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18],
  });
  assert.ok(picks.length > 0, "the guard must not simply disable the feature");
  assert.equal(picks.some((p) => p.slideIndex === 0), false);
});

// ─── Lane-aware composition reaches the renderable ─────────────────────────

test("a fair_use asset carries a frame; a granted one does not", (t) => {
  const root = files(t, ["lane1", "lane2"]);
  const grant = toRenderable(cand("lane1"), { root });
  const fair = toRenderable(cand("lane2", {
    clearance_basis: "fair_use", clearance_detail: JSON.stringify({ excerptSecs: 2 }),
  }), { root });
  assert.equal(grant.frame, null, "granted footage renders full-bleed");
  assert.ok(fair.frame && fair.frame.w > 0, "fair use keeps our framing around it");
});
