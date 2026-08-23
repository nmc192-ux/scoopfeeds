/**
 * The credit on the picture.
 *
 * Studied from a GPS segment (video-factory references/gps-grammar.md): a
 * broadcast package reads as *sourced* rather than *decorated* largely because
 * every third-party asset wears a small persistent corner credit. We shipped
 * `sourceBadge` on the title card only — the cards actually carrying someone
 * else's picture carried nothing.
 *
 * This is a rights-and-trust surface, not a decoration, so it is tested at the
 * tree rather than eyeballed in a render: an image-bearing state that loses its
 * credit is a silent regression that looks completely fine on screen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { verticalStatesForCard } from "./videoSlideRendererVertical.js";

/** Every string rendered anywhere in a state's element tree. */
function textsIn(node, out = []) {
  if (node == null || node === false) return out;
  if (Array.isArray(node)) { for (const n of node) textsIn(n, out); return out; }
  if (typeof node === "string") { out.push(node); return out; }
  if (typeof node === "object") textsIn(node.props?.children, out);
  return out;
}

const CTX = { orientation: "vertical", outlet: "Reuters", accent: "#dde706" };
const PHOTO = { t: "photo", eyebrow: "THE CHIP GAP", lines: [["Beijing spends a fraction", ""], ["of what Washington does", "lime"]] };
const MAP = { t: "map", eyebrow: "WHERE IT MATTERS", lines: [["Fifty-four health zones", ""], ["across six provinces", "lime"]], codes: ["CN"] };

test("a photo card credits the article's publisher on every state", () => {
  const states = verticalStatesForCard(PHOTO, CTX);
  assert.ok(states.length >= 1, "photo card produced no states");
  for (const st of states) {
    assert.equal(st.underlay, "photo");
    assert.ok(
      textsIn(st.tree).includes("REUTERS"),
      // v1 especially: the image is on screen alone there, and an uncredited
      // beat is exactly the frame a rights complaint would screenshot.
      `state ${st.key} carries a photograph but no credit`,
    );
  }
});

test("a map card credits Natural Earth on every state", () => {
  const states = verticalStatesForCard(MAP, CTX);
  assert.ok(states.length >= 1, "map card produced no states");
  for (const st of states) {
    assert.equal(st.underlay, "map");
    assert.ok(textsIn(st.tree).includes("NATURAL EARTH"), `map state ${st.key} uncredited`);
  }
});

test("an unresolved outlet omits the credit rather than inventing one", () => {
  // The outlet resolver can legitimately come back empty. Rendering "UNDEFINED"
  // or an empty chip over the photo would be worse than rendering nothing.
  const states = verticalStatesForCard(PHOTO, { ...CTX, outlet: null });
  for (const st of states) {
    const texts = textsIn(st.tree);
    assert.ok(!texts.some(t => /UNDEFINED|NULL/i.test(t)), `state ${st.key} rendered a placeholder credit`);
  }
});

test("the credit is static — same position on every state", () => {
  // It rides the TYPE layer on purpose: with VIDEO_IMAGE_MOTION_ENABLED the
  // image beneath is pushing in, and a credit that drifted with it would read
  // as part of the photograph instead of as a caption on it.
  const find = (node) => {
    if (node == null || typeof node !== "object") return null;
    if (Array.isArray(node)) { for (const n of node) { const f = find(n); if (f) return f; } return null; }
    if (textsIn(node).includes("REUTERS")) return node.props?.style ?? null;
    return find(node.props?.children);
  };
  const styles = verticalStatesForCard(PHOTO, CTX).map(st => find(st.tree));
  assert.ok(styles.every(Boolean), "credit missing from a state");
  for (const s of styles.slice(1)) {
    assert.equal(s.top, styles[0].top);
    assert.equal(s.right, styles[0].right);
  }
});

test("the credit follows the picture's owner, not the article's publisher", () => {
  // Open-licence footage substitutes for a missing article photo. Crediting the
  // publisher for a NASA photograph is a false attribution, not a cosmetic slip.
  const states = verticalStatesForCard(PHOTO, { ...CTX, imageCredit: "NASA / GSFC" });
  for (const st of states) {
    const texts = textsIn(st.tree);
    assert.ok(texts.includes("NASA / GSFC".toUpperCase()), `state ${st.key} lost the footage credit`);
    assert.ok(!texts.includes("REUTERS"), `state ${st.key} credited the publisher for someone else's picture`);
  }
});

test("no picture means no credit — on photo and map alike", () => {
  // The mount can fail. Before the caller owned the credit this rendered a
  // publisher's name over bare black: a credit for nothing.
  for (const card of [PHOTO, MAP]) {
    for (const st of verticalStatesForCard(card, { ...CTX, imageCredit: null })) {
      const texts = textsIn(st.tree);
      assert.ok(!texts.includes("REUTERS"), `${card.t} ${st.key} credited a publisher with no picture`);
      assert.ok(!texts.includes("NATURAL EARTH"), `${card.t} ${st.key} credited a map that was not built`);
    }
  }
});

test("callers that say nothing keep the old defaults", () => {
  // Every other caller passes no imageCredit key at all and must be unaffected.
  assert.ok(textsIn(verticalStatesForCard(PHOTO, CTX)[0].tree).includes("REUTERS"));
  assert.ok(textsIn(verticalStatesForCard(MAP, CTX)[0].tree).includes("NATURAL EARTH"));
});
