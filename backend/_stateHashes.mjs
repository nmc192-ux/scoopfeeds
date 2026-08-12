/**
 * _stateHashes — sha256 of every 16:9 state PNG, for one fixed card set.
 *
 * The 16:9 layouts are FROZEN across the vertical work. "Frozen" is a claim
 * that can be proved rather than asserted: render every state of every card
 * type from identical fixtures, hash the bytes, and compare before and after
 * the refactor. Anything that shifts by one pixel changes a digest.
 *
 *   node _stateHashes.mjs > before.txt      # on the pre-refactor tree
 *   node _stateHashes.mjs > after.txt
 *   diff before.txt after.txt               # must be empty
 */

import "./src/config/env.js";
import { createHash } from "node:crypto";

const { statesForCard, renderState } = await import("./src/services/videoSlideRenderer.js");

const CTX = { outlet: "Reuters", slideIndex: 2, slideCount: 7 };

// Fixtures at the RENDERER's caps, so the widest composition of each type is
// covered — the states that move most under a geometry change.
const CARDS = {
  title:   { t: "title", eyebrow: "SUBSEA INFRASTRUCTURE", lines: [["THE CABLES THAT", "white"], ["CARRY EVERYTHING", "lime"]], sub: "Almost all intercontinental data moves along the seabed rather than through orbit.", date: "12 AUGUST 2026", caption: "c" },
  stat:    { t: "stat", eyebrow: "RECORDED FAULTS", value: 100, unit: "%", lines: ["of recorded transmission faults last year", "were traced to dragged anchors in shallow water"], hi: 1, source: "Reuters", caption: "c" },
  bars:    { t: "bars", eyebrow: "WHAT ACTUALLY CUTS A CABLE", bars: [["dragged anchors in shallow water", 100], ["commercial fishing gear", 180], ["natural seabed movement", 90], ["deliberate interference", 30], ["equipment failure at landing", 12]], source: "Reuters", caption: "c" },
  diagram: { t: "diagram", eyebrow: "HOW A BREAK PROPAGATES", nodes: [["SHIP", "anchor lowered"], ["SHELF", "cable rises"], ["CABLE", "fibre severed"], ["OUTAGE", "traffic reroutes"], ["QUEUE", "ship tasked"], ["REPAIR", "grapple and splice"]], marker: { on: 2, label: "THE BREAK" }, caption: "c" },
  turn:    { t: "turn", eyebrow: "THE REAL STORY", lines: [["NOT SABOTAGE", "white"], ["ORDINARY TRAFFIC", "lime"]], sub: "The most consequential infrastructure on the planet is broken by ships doing unremarkable things.", caption: "c" },
  kicker:  { t: "kicker", top: "NOBODY HAS SAID", bottom: "WHO PAYS NEXT", sub: "The replacement route is unfunded and the decision sits with a committee.", caption: "c" },
};

for (const [name, card] of Object.entries(CARDS)) {
  const states = statesForCard(card, CTX);
  for (const st of states) {
    const png = await renderState(st);
    const h = createHash("sha256").update(png).digest("hex").slice(0, 32);
    console.log(`${name.padEnd(9)} ${String(st.key).padEnd(8)} ${png.length.toString().padStart(8)}B  ${h}`);
  }
}
