/**
 * videoKineticLayout.test.js — the reference grammar on a picture beat.
 *
 * One word or short phrase, centred, mixed weights, over the full-bleed image.
 * No bottom subtitle, never more than about six words (DrJ, 2026-08-30).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { verticalStatesForCard, kineticPhrase } from "./videoSlideRendererVertical.js";
import { captionForCard } from "./videoAssembler.js";

const CTX = { orientation: "vertical", outlet: "The Hindu", slideIndex: 1, slideCount: 6 };
const strings = (tree) => JSON.stringify(tree).match(/"children":"([^"]*)"/g)?.map((m) => m.slice(12, -1)) ?? [];
const photo = (over = {}) => ({ t: "photo", subject: "Qusra", caption: "A paragraph about the raid.", ...over });

test("a picture beat carries ONE centred phrase, split across two weights", () => {
  const st = verticalStatesForCard(photo({ lines: [["A VILLAGE", "white"], ["UNDER SIEGE", "lime"]] }), CTX);
  const words = strings(st[st.length - 1].tree);
  assert.ok(words.includes("A VILLAGE UNDER"), `lead run missing: ${words.join("|")}`);
  assert.ok(words.includes("SIEGE"), "the accent word must be its own run");
});

test("the accent is the LAST word — English puts the operative noun at the end", () => {
  const st = verticalStatesForCard(photo({ lines: [["THE FISHING OBSTACLE", "white"]] }), CTX);
  const w = strings(st[st.length - 1].tree);
  assert.ok(w.includes("OBSTACLE"), "the final word takes the accent");
  assert.ok(w.includes("THE FISHING"));
});

test("a single word needs no lead run", () => {
  const st = verticalStatesForCard(photo({ lines: [["SEIZED", "lime"]] }), CTX);
  assert.ok(strings(st[st.length - 1].tree).includes("SEIZED"));
});

test("the phrase is CAPPED at six words — a headline fragment must not run off", () => {
  const long = "one two three four five six seven eight nine";
  assert.equal(kineticPhrase({ lines: [[long, "white"]] }).split(/\s+/).length, 6);
});

test("the phrase falls back to the beat's own subject when no display lines exist", () => {
  assert.equal(kineticPhrase({ t: "photo", subject: "Qalandiya Training Centre" }), "Qalandiya Training Centre");
  assert.equal(kineticPhrase({ t: "photo", visual: "gas storage tanks" }), "gas storage tanks");
  assert.equal(kineticPhrase({ t: "photo" }), null);
});

test("NO paragraph is burned under a picture beat", () => {
  // The word IS the layout; a three-line caption across the same frame is the
  // paragraph grammar the reference does not have, and it competes with the
  // phrase for the one thing the viewer should read.
  assert.equal(captionForCard({ t: "photo", caption: "A long paragraph about the raid." }), null);
  assert.equal(captionForCard({ t: "map", caption: "Where it happened." }), null);
});

test("a TYPE beat keeps its caption — there the burned line IS the beat", () => {
  assert.equal(captionForCard({ t: "stat", caption: "Seventy percent of faults." }), "Seventy percent of faults.");
  assert.equal(captionForCard({ t: "turn", caption: "But the real reason is older." }), "But the real reason is older.");
});

test("the eyebrow and the stacked two-line block are gone from picture beats", () => {
  // Both belonged to the paragraph grammar. Their absence is the change.
  const st = verticalStatesForCard(photo({ eyebrow: "WEST BANK FLASHPOINT", lines: [["A VILLAGE", "white"], ["UNDER SIEGE", "lime"]] }), CTX);
  const words = strings(st[st.length - 1].tree);
  assert.ok(!words.includes("WEST BANK FLASHPOINT"), "the eyebrow must not survive on a picture beat");
});

test("the picture still gets a beat of its own before any text arrives", () => {
  // Kept deliberately: a photograph that arrives already captioned has no
  // moment of being looked at, and the reference makes the same move.
  const st = verticalStatesForCard(photo({ lines: [["A VILLAGE", "white"]] }), CTX);
  const first = strings(st[0].tree);
  assert.ok(!first.includes("A VILLAGE"), "the opening state shows the picture alone");
  assert.ok(first.includes("THE HINDU"), "but the credit rides from the first frame");
});

test("the credit survives — it belongs to the picture, not to the paragraph", () => {
  const st = verticalStatesForCard(photo({ lines: [["A VILLAGE", "white"]] }), CTX);
  assert.ok(strings(st[st.length - 1].tree).includes("THE HINDU"));
});
