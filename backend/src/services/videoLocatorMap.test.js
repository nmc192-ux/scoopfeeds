// Tests for the cartographic locator map. Pure SVG-string assertions: the map
// is built as text and rasterised by resvg, so everything that matters about
// what it CLAIMS is inspectable without rendering a pixel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLocatorMap, findCity, knownCity, knownCountry } from "./videoSubjectVisual.js";
import { VERTICAL } from "./videoGeometry.js";
import { COLORS } from "./videoSlideChrome.js";

// Count LIME-FILLED PATHS specifically: the city marker is a lime <circle>,
// so a bare fill count cannot tell "country lit" from "city marked".
const limePaths = (svg) =>
  (svg.match(new RegExp(`<path[^>]*fill="${COLORS.lime}"`, "g")) || []).length;
const texts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);

// ── THE BUG THAT MADE THE MAP A SPECK ───────────────────────────────────────
//
// The extent used EVERY ring, so France's overseas départements (Guadeloupe at
// -61.8 lon, Réunion at +55.8) and the Caribbean Netherlands (-68.4) stretched
// a European frame to 124 degrees of longitude for a story spanning 16. A
// 7.75x over-scale, and the whole reason the old map rendered as a blob.
test("overseas territories do not get a vote on where the camera points", () => {
  const svg = buildLocatorMap({ codes: ["GBR", "FRA", "NLD"] });
  assert.ok(svg, "no map built");
  // With the camera on the mainlands, the subject fills a serious share of the
  // drawable band. Measure it from the lime path extents in the SVG itself.
  const xs = [...svg.matchAll(/(?:M|L)(\d+(?:\.\d+)?),/g)].map(m => Number(m[1]));
  const spread = Math.max(...xs) - Math.min(...xs);
  assert.ok(spread > VERTICAL.contentW * 0.5,
    `the drawn geometry spans only ${spread.toFixed(0)}px of a ${VERTICAL.contentW}px band — ` +
    `the extent is being stretched by outlying territories again`);
});

test("land and water are distinguishable, and the ground stays black", () => {
  const svg = buildLocatorMap({ codes: ["LBN"] });
  assert.match(svg, /fill="#1b1813"/, "no land layer — everything is floating in the void again");
  // Water is the ground showing through: the map must never paint a sea colour.
  assert.ok(!/fill="#0[0-9a-f]{2}[0-9a-f]{3}"/i.test(svg.replace(/#090706/g, "")),
    "the map is painting its own ground");
  assert.ok(svg.includes(COLORS.base), "borders should be drawn in the ground colour");
});

test("subjects are named in white, neighbours in the receded token", () => {
  const svg = buildLocatorMap({ codes: ["DEU", "FRA", "POL"] });
  const names = texts(svg);
  assert.ok(names.includes("GERMANY"), `subjects unnamed: ${JSON.stringify(names)}`);
  assert.ok(names.includes("FRANCE"));
  // Someone to orient by, drawn in the palette's own word for "not the subject".
  assert.ok(svg.includes(COLORS.recededText),
    "no neighbour labels — the viewer has nothing to orient against");
  assert.ok(svg.includes(COLORS.white), "subject labels must be white");
});

// ── THE MAP MUST NOT ASSERT MORE THAN THE CAPTION ───────────────────────────
test("a named city is marked and its country is NOT filled", () => {
  const withCity = buildLocatorMap({ codes: ["FRA"], city: "Marseille" });
  const without  = buildLocatorMap({ codes: ["FRA"] });
  assert.ok(texts(withCity).includes("MARSEILLE"), "the city is not labelled");
  assert.ok(limePaths(without) > 0, "a country story should fill the country");
  assert.equal(limePaths(withCity), 0,
    "naming a city must NOT light the whole country: that claims a national " +
    "story the caption never made");
  // The city IS marked — it is just a marker, not a national fill.
  assert.match(withCity, new RegExp(`<circle[^>]*fill="${COLORS.lime}"`),
    "the city must still be marked");
  // France is still NAMED — the map says where we are, it just does not claim
  // the story is about all of it.
  assert.ok(texts(withCity).includes("FRANCE"), "the country should still be named");
});

test("an unplaceable city falls back to the country rather than failing", () => {
  const svg = buildLocatorMap({ codes: ["FRA"], city: "Nowhereville" });
  assert.ok(svg, "an unknown city must not lose the map");
  assert.ok(limePaths(svg) > 0, "with no city to mark, the country fill is the correct fallback");
});

test("the exception is still annotated, not merely coloured", () => {
  const svg = buildLocatorMap({ codes: ["ZAF", "BWA", "NAM", "SWZ"], exception: "SWZ" });
  assert.ok(texts(svg).includes("ESWATINI"),
    "the excepted country must be called out — it is a couple of pixels wide and it is the point");
  assert.match(svg, /<line /, "the callout needs its leader line");
});

test("every label sits inside marginX and the vertical safe margins", () => {
  for (const codes of [["DEU", "FRA", "POL"], ["IND", "PAK"], ["ZAF", "BWA", "NAM", "SWZ"], ["LBN"]]) {
    const svg = buildLocatorMap({ codes });
    for (const m of svg.matchAll(/<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*text-anchor="(\w+)"[^>]*font-size="(\d+)"[^>]*>([^<]*)</g)) {
      const [, x, y, anchor, size, label] = m;
      const px = Number(x), py = Number(y), fs = Number(size);
      // Generous on the horizontal because anchor + letter-spacing make exact
      // extent a measurement problem; the point is that nothing is off-frame.
      assert.ok(px >= 0 && px <= VERTICAL.canvas.w,
        `"${label}" anchored at x=${px} is outside the canvas`);
      assert.ok(py - fs >= VERTICAL.safeTop - fs,
        `"${label}" at y=${py} is above the top safe margin`);
      assert.ok(py <= VERTICAL.canvas.h - VERTICAL.safeBottom + fs,
        `"${label}" at y=${py} falls into the bottom safe margin (${VERTICAL.canvas.h - VERTICAL.safeBottom})`);
      assert.ok(anchor === "middle" || anchor === "start" || anchor === "end");
    }
  }
});

test("labels that would collide are dropped, not stacked", () => {
  // Two tiny neighbours side by side: whatever is drawn must not overlap.
  const svg = buildLocatorMap({ codes: ["BEL", "NLD", "LUX"] });
  const placed = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*font-size="(\d+)"[^>]*>([^<]*)</g)]
    .map(m => ({ x: Number(m[1]), y: Number(m[2]), s: Number(m[3]), t: m[4] }));
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      const sameRow = Math.abs(a.y - b.y) < Math.max(a.s, b.s) * 0.9;
      if (!sameRow) continue;
      const aw = a.t.length * a.s * 0.62, bw = b.t.length * b.s * 0.62;
      const overlap = Math.abs(a.x - b.x) < (aw + bw) / 2;
      assert.ok(!overlap, `"${a.t}" and "${b.t}" overlap — a collision was drawn instead of dropped`);
    }
  }
});

test("the city gazetteer is scoped by country, and is committed not fetched", () => {
  assert.ok(knownCity("Marseille", ["FRA"]));
  // "Sydney" is a real collision IN THIS DATASET: Australia (4.6m) and Nova
  // Scotia (38k). Scoping is what stops a Canadian story resolving to Australia.
  const au = findCity("Sydney");
  assert.equal(au.c, "AUS", "a bare name should take the larger place");
  const ca = findCity("Sydney", ["CAN"]);
  assert.equal(ca.c, "CAN", `scoping ignored: got ${JSON.stringify(ca)}`);
  assert.equal(knownCity("Marseille", ["DEU"]), false, "a city outside the named countries is not a match");
  assert.equal(knownCity("Nowhereville"), false);
  assert.ok(knownCountry("FRA") && !knownCountry("ZZZ"));
});

test("unknown codes still yield no map rather than an empty frame", () => {
  assert.equal(buildLocatorMap({ codes: ["ZZZ"] }), null);
  assert.equal(buildLocatorMap({ codes: [] }), null);
});
