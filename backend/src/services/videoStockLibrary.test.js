/**
 * videoStockLibrary.test.js — the cutaway lookup, and the four ways it says no.
 *
 * Every rule here exists to make the answer NOTHING more often than something.
 * A selector that always finds a clip is the failure mode: it is how a globe
 * ended up on a gold story. So the tests that matter are the refusals — no
 * field, no match, one contributor twice, three cutaways — and each is written
 * to fail if the rule is relaxed into a fallback.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cutawayCredit, cutawaySecs, cutawaysAllowedFor, isUsableVisual, loadLibrary, matchAssets,
  MAX_CUTAWAYS, selectCutaways, stockCutawaysEnabled,
} from "./videoStockLibrary.js";

const roots = [];
test.after(() => {
  for (const r of roots) { try { rmSync(r, { recursive: true, force: true }); } catch { /* best effort */ } }
});

/** A library on disk, with real files so the existence check is exercised. */
function libraryOf(rows) {
  const root = mkdtempSync(path.join(os.tmpdir(), "stocklib-"));
  roots.push(root);
  mkdirSync(path.join(root, "treated"), { recursive: true });
  for (const r of rows) {
    if (r.treatedPath && r.__writeFile !== false) {
      writeFileSync(path.join(root, r.treatedPath), "not-really-an-mp4");
    }
  }
  writeFileSync(path.join(root, "manifest.json"),
    JSON.stringify(rows.map(({ __writeFile, ...r }) => r), null, 2));
  return root;
}

const asset = (over = {}) => ({
  id: "ports-0001", subjectClass: "ports", tags: ["container port", "cranes"],
  provider: "pexels", providerId: "857195", creator: "A Contributor",
  sourceUrl: "https://www.pexels.com/video/x-857195/", license: "Pexels License",
  width: 2160, height: 3840, durationSec: 14, orientation: "portrait",
  cropGrade: "native-portrait", filePath: "staging/ports-0001.mp4",
  treatedPath: "treated/ports-0001.mp4", status: "treated", addedAt: "2026-08-28T00:00:00.000Z",
  ...over,
});

const slide = (visual) => (visual ? { t: "stat", visual } : { t: "stat" });

// ─── The flag ───────────────────────────────────────────────────────────────

test("the feature is dark unless the flag is exactly \"1\"", () => {
  const real = process.env.VIDEO_STOCK_CUTAWAYS_ENABLED;
  try {
    for (const v of [undefined, "", "0", "true", "yes", "on"]) {
      if (v === undefined) delete process.env.VIDEO_STOCK_CUTAWAYS_ENABLED;
      else process.env.VIDEO_STOCK_CUTAWAYS_ENABLED = v;
      assert.equal(stockCutawaysEnabled(), false, `"${v}" must not enable cutaways`);
    }
    process.env.VIDEO_STOCK_CUTAWAYS_ENABLED = "1";
    assert.equal(stockCutawaysEnabled(), true);
  } finally {
    if (real === undefined) delete process.env.VIDEO_STOCK_CUTAWAYS_ENABLED;
    else process.env.VIDEO_STOCK_CUTAWAYS_ENABLED = real;
  }
});

// ─── Loading ────────────────────────────────────────────────────────────────

test("a missing library is not an error — it is a video with no cutaways", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "stocklib-empty-"));
  roots.push(root);
  const lib = loadLibrary({ root });
  assert.deepEqual(lib.assets, []);
  assert.equal(lib.reason, "no-manifest");
});

test("a malformed manifest degrades to no cutaways rather than throwing", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "stocklib-bad-"));
  roots.push(root);
  writeFileSync(path.join(root, "manifest.json"), "{ this is not json");
  assert.deepEqual(loadLibrary({ root }).assets, []);

  writeFileSync(path.join(root, "manifest.json"), '{"assets":[]}');
  const lib = loadLibrary({ root });
  assert.deepEqual(lib.assets, []);
  assert.equal(lib.reason, "wrong-shape", "a manifest that is not an array is refused, not coerced");
});

test("only assets a human KEPT and that were graded are selectable", () => {
  // The whole guarantee is that every published frame was reviewed by a person.
  // A staged row is one nobody has looked at yet; a rejected row is one they
  // turned down. Neither may ever reach a render.
  const root = libraryOf([
    asset({ id: "ports-0001", status: "treated" }),
    asset({ id: "ports-0002", status: "staged", treatedPath: null }),
    asset({ id: "ports-0003", status: "rejected", treatedPath: null }),
    asset({ id: "ports-0004", status: "kept", treatedPath: null }),
  ]);
  const { assets } = loadLibrary({ root });
  assert.deepEqual(assets.map((a) => a.id), ["ports-0001"]);
});

test("an asset whose file is missing from disk is not offered", () => {
  // The manifest is a claim about the disk; the disk is the authority. A row
  // pointing at a file the sync did not bring would fail deep inside ffmpeg.
  const root = libraryOf([
    asset({ id: "ports-0001" }),
    asset({ id: "ports-0002", treatedPath: "treated/ports-0002.mp4", __writeFile: false }),
  ]);
  assert.deepEqual(loadLibrary({ root }).assets.map((a) => a.id), ["ports-0001"]);
});

test("an asset that cannot be attributed is not offered", () => {
  // Provenance is not decoration: a clip whose creator or source is unknown
  // cannot be credited, and an uncreditable frame must not be publishable.
  const root = libraryOf([
    asset({ id: "ports-0001" }),
    asset({ id: "ports-0002", creator: null }),
    asset({ id: "ports-0003", sourceUrl: null }),
    asset({ id: "ports-0004", license: null }),
  ]);
  assert.deepEqual(loadLibrary({ root }).assets.map((a) => a.id), ["ports-0001"]);
});

// ─── Matching is exact ──────────────────────────────────────────────────────

test("a visual resolves against the class or a tag, exactly", () => {
  const assets = [asset({ id: "ports-0001" })];
  assert.equal(matchAssets(assets, "ports").length, 1, "class match");
  assert.equal(matchAssets(assets, "container port").length, 1, "tag match");
  assert.equal(matchAssets(assets, "  PORTS  ").length, 1, "case and padding do not matter");
});

test("a near-miss matches NOTHING — there is no fuzzy fallback", () => {
  // This is the rule the architecture exists for. "port" is not "ports" and
  // "harbour" is not a tag we hold; both must come back empty rather than
  // reaching for the closest thing.
  const assets = [asset({ id: "ports-0001" })];
  for (const noun of ["port", "harbour", "shipping ports", "container", "docks", ""]) {
    assert.deepEqual(matchAssets(assets, noun), [], `"${noun}" must not match`);
  }
});

// ─── The four refusals ──────────────────────────────────────────────────────

test("a slide with no visual gets no cutaway", () => {
  const assets = [asset()];
  const { picks } = selectCutaways([slide(), slide(), slide()], { assets });
  assert.deepEqual(picks, [], "no field, no cutaway — a video with zero is correct");
});

test("an unresolvable visual yields no cutaway AND names the noun", () => {
  const assets = [asset({ id: "ports-0001" })];
  const { picks, unresolved } = selectCutaways([slide("chip fab")], { assets });
  assert.deepEqual(picks, []);
  assert.deepEqual(unresolved, ["chip fab"],
    "the unmatched noun is the acquisition backlog and must be reported, not swallowed");
});

test("one contributor may not supply two cutaways in one video", () => {
  // Six of one film's eight clips came from a single contributor's shoot: all
  // on-topic, all the same shoot, and the film looked it.
  const assets = [
    asset({ id: "ports-0001", subjectClass: "ports", creator: "Same Person" }),
    asset({ id: "ships-0001", subjectClass: "ships", creator: "Same Person" }),
  ];
  const { picks } = selectCutaways([slide("ports"), slide(), slide("ships")], { assets });
  assert.equal(picks.length, 1, "the second slide's only match shares a contributor with the first");
  assert.equal(picks[0].asset.id, "ports-0001");
});

test("a different contributor for the same class IS allowed", () => {
  const assets = [
    asset({ id: "ports-0001", creator: "First Person" }),
    asset({ id: "ports-0002", creator: "Second Person" }),
  ];
  const { picks } = selectCutaways([slide("ports"), slide(), slide("ports")], { assets });
  assert.equal(picks.length, 2);
  assert.notEqual(picks[0].asset.creator, picks[1].asset.creator);
});

test("no more than two cutaways per video, however many visuals are asked for", () => {
  const assets = [
    asset({ id: "ports-0001", subjectClass: "ports", creator: "A" }),
    asset({ id: "ships-0001", subjectClass: "ships", creator: "B" }),
    asset({ id: "flag-uk-0001", subjectClass: "flag-uk", creator: "C" }),
    asset({ id: "launch-0001", subjectClass: "launch", creator: "D" }),
  ];
  const slides = [slide("ports"), slide(), slide("ships"), slide(), slide("flag-uk"), slide(), slide("launch")];
  const { picks } = selectCutaways(slides, { assets });
  assert.equal(picks.length, MAX_CUTAWAYS);
  assert.equal(MAX_CUTAWAYS, 2, "rhythm, not wallpaper");
});

test("cutaways never land on consecutive slides", () => {
  const assets = [
    asset({ id: "ports-0001", subjectClass: "ports", creator: "A" }),
    asset({ id: "ships-0001", subjectClass: "ships", creator: "B" }),
  ];
  const { picks } = selectCutaways([slide("ports"), slide("ships")], { assets });
  assert.equal(picks.length, 1, "back-to-back cutaways read as a montage");

  const spaced = selectCutaways([slide("ports"), slide(), slide("ships")], { assets });
  assert.equal(spaced.picks.length, 2, "one slide of separation is enough");
  assert.deepEqual(spaced.picks.map((p) => p.slideIndex), [0, 2]);
});

// ─── Rotation ───────────────────────────────────────────────────────────────

test("the least-recently-used asset wins, so the library rotates", () => {
  const assets = [
    asset({ id: "ports-0001", creator: "A" }),
    asset({ id: "ports-0002", creator: "B" }),
  ];
  const recent = { "ports-0001": 5_000, "ports-0002": 1_000 };
  assert.equal(selectCutaways([slide("ports")], { assets, lastUsed: recent }).picks[0].asset.id, "ports-0002");

  const flipped = { "ports-0001": 1_000, "ports-0002": 5_000 };
  assert.equal(selectCutaways([slide("ports")], { assets, lastUsed: flipped }).picks[0].asset.id, "ports-0001");
});

test("a never-used asset outranks one used long ago", () => {
  const assets = [
    asset({ id: "ports-0001", creator: "A" }),
    asset({ id: "ports-0002", creator: "B" }),
  ];
  // ports-0002 has no entry at all — it has never been on screen.
  const { picks } = selectCutaways([slide("ports")], { assets, lastUsed: { "ports-0001": 1 } });
  assert.equal(picks[0].asset.id, "ports-0002");
});

test("selection is deterministic when nothing has been used", () => {
  // Ties break on id rather than array order, so two renders of the same spec
  // against the same library choose the same clip.
  const assets = [asset({ id: "ports-0002", creator: "B" }), asset({ id: "ports-0001", creator: "A" })];
  const a = selectCutaways([slide("ports")], { assets }).picks[0].asset.id;
  const b = selectCutaways([slide("ports")], { assets }).picks[0].asset.id;
  assert.equal(a, b);
  assert.equal(a, "ports-0001");
});

// ─── What counts as a usable visual ─────────────────────────────────────────

test("a visual names one thing, in a few words", () => {
  for (const good of ["ports", "ships", "flag-china", "container port", "trading floor"]) {
    assert.equal(isUsableVisual(good), true, `"${good}" should be usable`);
  }
});

test("a hedged visual is unusable — the writer did not choose", () => {
  // Same rule, and the SAME regex, as the photo card's `subject`. There is no
  // rule by which selection could break the tie, so it must not try.
  for (const hedge of ["ports or ships", "ports/ships", "either ports"]) {
    assert.equal(isUsableVisual(hedge), false, `"${hedge}" should be refused`);
  }
  assert.equal(isUsableVisual("health and safety"), true,
    "\" and \" is ordinary inside real names and must NOT be treated as a hedge");
});

test("a sentence is not a visual", () => {
  assert.equal(isUsableVisual("the ports that handle most of the trade"), false);
  assert.equal(isUsableVisual(""), false);
  assert.equal(isUsableVisual(null), false);
  assert.equal(isUsableVisual(undefined), false);
});

test("an unusable visual is reported by name, exactly like an unmatched one", () => {
  // It must not be stripped silently upstream: the point of naming it is that
  // someone can see the writer asked for something the system cannot serve.
  const assets = [asset({ id: "ports-0001" })];
  const { picks, unresolved } = selectCutaways([slide("ports or ships")], { assets });
  assert.deepEqual(picks, []);
  assert.deepEqual(unresolved, ["ports or ships"]);
});

// ─── The sensitivity gate ───────────────────────────────────────────────────

test("a sensitive headline suppresses cutaways for the WHOLE video", () => {
  // The guard judges headlines and there is no per-beat signal in the spec, so
  // this is whole-video by design rather than by omission. A false positive
  // costs one typographic video; a false negative puts stock footage beside a
  // death toll.
  const real = process.env.VIDEO_STOCK_CUTAWAYS_ENABLED;
  process.env.VIDEO_STOCK_CUTAWAYS_ENABLED = "1";
  try {
    const flagged = cutawaysAllowedFor({ title: "Twelve killed in factory fire" });
    assert.equal(flagged.allowed, false);
    assert.equal(flagged.reason, "sensitive-headline");

    assert.equal(cutawaysAllowedFor({ title: "Port congestion eases after tariff deal" }).allowed, true);
    // No headline to judge — the guard takes the safe path, and so does this.
    assert.equal(cutawaysAllowedFor({ title: "" }).allowed, false);
    assert.equal(cutawaysAllowedFor({}).allowed, false);
  } finally {
    if (real === undefined) delete process.env.VIDEO_STOCK_CUTAWAYS_ENABLED;
    else process.env.VIDEO_STOCK_CUTAWAYS_ENABLED = real;
  }
});

test("the flag is checked BEFORE sensitivity — off means off", () => {
  const real = process.env.VIDEO_STOCK_CUTAWAYS_ENABLED;
  delete process.env.VIDEO_STOCK_CUTAWAYS_ENABLED;
  try {
    const off = cutawaysAllowedFor({ title: "Port congestion eases" });
    assert.equal(off.allowed, false);
    assert.equal(off.reason, "disabled");
  } finally {
    if (real !== undefined) process.env.VIDEO_STOCK_CUTAWAYS_ENABLED = real;
  }
});

// ─── Credit and window ──────────────────────────────────────────────────────

test("the credit names the creator first and the platform second", () => {
  // The licence asks for the creator where possible; the platform alone credits
  // the wrong party.
  assert.equal(cutawayCredit(asset({ creator: "Ruvim Miksanskiy", provider: "pexels" })),
    "Ruvim Miksanskiy / PEXELS");
  assert.equal(cutawayCredit(asset({ creator: null })), null,
    "no creator means no credit line — and such an asset is never selectable anyway");
});

test("the cutaway window is clamped into the band, loudly", () => {
  const real = process.env.VIDEO_STOCK_CUTAWAY_SECS;
  try {
    delete process.env.VIDEO_STOCK_CUTAWAY_SECS;
    assert.equal(cutawaySecs(), 2.2, "the default sits in the middle of 1.5-3s");
    for (const [raw, want] of [["1.5", 1.5], ["3", 3], ["2.6", 2.6]]) {
      process.env.VIDEO_STOCK_CUTAWAY_SECS = raw;
      assert.equal(cutawaySecs(), want);
    }
    // Out of band falls back rather than being honoured: under 1.5s reads as a
    // flash, over 3s stops being a cutaway. Zero is not "off" — the flag is.
    for (const raw of ["0", "0.5", "12", "abc", "-2"]) {
      process.env.VIDEO_STOCK_CUTAWAY_SECS = raw;
      assert.equal(cutawaySecs(), 2.2, `"${raw}" should fall back`);
    }
  } finally {
    if (real === undefined) delete process.env.VIDEO_STOCK_CUTAWAY_SECS;
    else process.env.VIDEO_STOCK_CUTAWAY_SECS = real;
  }
});

test("an empty library selects nothing and reports every noun", () => {
  const { picks, unresolved } = selectCutaways([slide("ports"), slide(), slide("ships")], { assets: [] });
  assert.deepEqual(picks, []);
  assert.deepEqual(unresolved, ["ports", "ships"]);
});
