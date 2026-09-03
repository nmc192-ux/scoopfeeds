/**
 * _contrastFixtures.mjs — one valid spec per long-form card type.
 *
 * Exists so `videoContrast.test.js` can measure EVERY card type rather than the
 * two or three that happen to be convenient. The test reads `CARD_TYPES` off
 * the renderer and fails on any type missing from `FIXTURES`, so a new card
 * arrives with a contrast measurement or it does not arrive.
 *
 * These are minimal but REAL: every optional slot that can carry text is
 * filled, because an unfilled slot is a token nobody measured. Where a card
 * has a receded/inactive condition (`hot` on bars and ledger rows, `broken` on
 * a pipeline stage) the fixture exercises BOTH conditions in one spec — the
 * dimmed state is the whole reason this file exists.
 *
 * The `doc` card needs a real image on disk; `docFixture()` writes a 2x2 PNG
 * to a temp dir and returns the spec. It is a function rather than a constant
 * so importing this module never touches the filesystem.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** The smallest valid PNG: a 2x2 opaque square. Enough for a panel to exist. */
const PNG_2X2 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8//8/AzJgYkAFAB0EAwGCq1YnAAAAAElFTkSuQmCC",
  "base64"
);

export function docFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "contrast-doc-"));
  const image = path.join(dir, "page.png");
  writeFileSync(image, PNG_2X2);
  return {
    card: "doc", image, imgW: 1200, imgH: 700,
    rects: [{ x: 120, y: 180, w: 640, h: 40 }, { x: 120, y: 300, w: 420, h: 40 }],
    eyebrow: "THE FILING", src: "Companies House",
  };
}

/** An archived statement record, the only shape the tweet card accepts. */
const STATEMENT = {
  id: "1", text: "We have no record of any such report.", name: "STATE POLICE",
  handle: "kystatepolice", createdAt: "2026-06-01T00:00:00Z", fetchedAt: "2026-06-02T00:00:00Z",
};

export const FIXTURES = {
  title: { card: "title", kicker: "HORROR ADAPTATION", lines: ["KENTUCKY", "GOBLINS"],
    sub: "The 1955 Hopkinsville encounter, and what the record actually shows." },

  chapter: { card: "chapter", n: 2, name: "THE NIGHT ITSELF" },

  stat: { card: "stat", kicker: "THE NUMBER", figure: "$1,240", unit: "BN",
    label: "What the closure cost in ninety days.", src: "Fixture" },

  bars: { card: "bars", kicker: "THE COMPARISON", title: "Sightings logged by decade",
    items: [{ label: "1955 ENCOUNTER", value: 11 }, { label: "FROGMAN", value: 6 },
            { label: "KENTUCKY GOBLINS", value: 14, hot: true }],
    src: "Fixture" },

  outro: {  card: "outro" },

  quote: { card: "quote", text: "They were on the roof, and then they were gone.",
    who: "ELMER SUTTON", role: "Named in the 1955 police report" },

  tweet: { card: "tweet", statement: STATEMENT, sinceDeleted: true },

  map: { card: "map", kicker: "WHERE", title: "The chokepoint", variant: "hormuz",
    note: "Twenty million barrels a day.", src: "Natural Earth", pin: null },

  linechart: { card: "linechart", kicker: "THE TREND", title: "Reports per year",
    points: [{ v: 4 }, { v: 9 }, { v: 6 }, { v: 14, hot: true }],
    yPrefix: "", ySuffix: "", note: "Logged reports only.", src: "Fixture" },

  multiline: { card: "multiline", kicker: "TWO SERIES", title: "Reports and retractions",
    series: [{ label: "REPORTS", hot: true, values: [4, 9, 14] },
             { label: "RETRACTIONS", values: [1, 2, 3] }],
    xMax: 2, yMax: 16, xLabel: "DECADE", yTicks: 4, note: "Logged reports only.", src: "Fixture" },

  equation: { card: "equation", kicker: "THE MECHANISM", numerator: "20M BARRELS A DAY",
    denominator: "ONE 26KM GAP", result: "NO SLACK", note: "Fixture note." },

  doc: null,   // filled by docFixture() — see the header

  dotgrid: { card: "dotgrid", kicker: "THE SHORTFALL", title: "Of a hundred reports",
    total: 100, out: 38, label: "were never corroborated", src: "Fixture" },

  pipeline: { card: "pipeline", kicker: "THE ROUTE", title: "How it moves",
    stages: [{ label: "WELLHEAD", note: "Extraction" }, { label: "TERMINAL", note: "Loading" },
             { label: "STRAIT", note: "Transit" }],
    broken: 2, note: "The bypass carries a fraction.", src: "Fixture" },

  statement: { card: "statement", kicker: "THE CLAIM", lines: ["THE REAL EVENT", "WAS THE PANIC"], src: "Fixture" },

  ledger: { card: "ledger", kicker: "HORROR ADAPTATION", title: "What each one took",
    rows: [{ who: "1955 ENCOUNTER", what: "The real event." },
           { who: "FROGMAN", what: "A separate Ohio sighting, folded in." },
           { who: "KENTUCKY GOBLINS", what: "The 2026 adaptation.", hot: true }],
    src: "Fixture" },
};
