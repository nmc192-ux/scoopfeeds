// Tests for the thumbnail's PURE parts — the hook fit, the crop rule and the
// ground contract. The render itself is ffmpeg + resvg and is exercised by the
// ground harness; what can silently go wrong here is a hook that does not
// survive the platform's crop, which no rendered file would reveal.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hookLines, centreSquareBox, thumbnailTree, MAX_HOOK_LINES, thumbnailEnabled,
} from "./videoThumbnail.js";
import { geometryFor } from "./videoGeometry.js";
import { GROUND, groundOf, COLORS } from "./videoSlideChrome.js";

const G = geometryFor("vertical");

test("dark unless the flag is literally \"1\"", () => {
  const prev = process.env.VIDEO_THUMBNAIL_ENABLED;
  try {
    delete process.env.VIDEO_THUMBNAIL_ENABLED; assert.equal(thumbnailEnabled(), false);
    process.env.VIDEO_THUMBNAIL_ENABLED = "true"; assert.equal(thumbnailEnabled(), false);
    process.env.VIDEO_THUMBNAIL_ENABLED = "0";    assert.equal(thumbnailEnabled(), false);
    process.env.VIDEO_THUMBNAIL_ENABLED = "1";    assert.equal(thumbnailEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.VIDEO_THUMBNAIL_ENABLED;
    else process.env.VIDEO_THUMBNAIL_ENABLED = prev;
  }
});

test("the hook never exceeds two lines, and never ends on a connective", () => {
  const long = hookLines("BRITAIN SIGNED AWAY THREE PORTS AND NOBODY READ THE CLAUSE AT ALL");
  assert.ok(long.length <= MAX_HOOK_LINES, `${long.length} lines`);
  for (const l of long) {
    const last = l.split(" ").pop();
    assert.ok(!["AND", "THE", "OF", "TO", "AT", "IN", "FOR"].includes(last),
      `"${l}" ends on a connective — a cut hook must read as a statement`);
  }
  assert.deepEqual(hookLines(""), []);
});

// THE RULE THIS PINS: Instagram shows a Reel cover CENTRE-CROPPED TO A SQUARE
// on the profile grid. A hook laid out against the bottom of the 1080x1920
// frame is a hook nobody browsing the grid ever reads, and no rendered file
// would show that — it only appears once a month of covers have shipped.
test("the centre square is a real 1080x1080 crop of the vertical frame", () => {
  const box = centreSquareBox(G);
  assert.equal(box.width, 1080);
  assert.equal(box.height, 1080);
  assert.equal(box.top, 420);
  assert.equal(box.bottom, 1500);
});

/** Every absolutely-positioned node's box, from a satori tree. */
function boxes(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach(n => boxes(n, out)); return out; }
  const st = node.props?.style;
  if (st && st.position === "absolute") out.push(st);
  if (node.props?.children) boxes(node.props.children, out);
  return out;
}

test("the hook lands inside the crop the profile grid will show", () => {
  const tree = thumbnailTree({ hook: "BRITAIN SIGNED AWAY THREE PORTS", hasPicture: true });
  const box = centreSquareBox(G);
  const anton = boxes(tree).filter(s => s.fontFamily && s.fontSize >= 100);
  assert.ok(anton.length >= 1, "no Anton hook lines in the tree");
  for (const s of anton) {
    assert.ok(s.top >= box.top, `hook line at ${s.top} is above the crop (${box.top})`);
    assert.ok(s.top + s.fontSize * 1.1 <= box.bottom,
      `hook line at ${s.top} falls below the crop (${box.bottom}) — invisible on the IG grid`);
  }
});

test("labels respect marginX and the vertical safe margins", () => {
  const tree = thumbnailTree({ hook: "FOURTEEN BILLION POUNDS", outlet: "REUTERS", hasPicture: false });
  for (const s of boxes(tree)) {
    if (s.left !== undefined && typeof s.left === "number" && s.width === undefined) {
      assert.ok(s.left >= G.marginX, `a node sits at x=${s.left}, inside marginX ${G.marginX}`);
    }
    if (s.top !== undefined && typeof s.top === "number") {
      assert.ok(s.top >= 0 && s.top <= G.canvas.h, `a node sits at y=${s.top}`);
    }
  }
});

// THE GROUND IS DECLARED, NEVER ASSUMED — the same contract every card obeys.
// Over a resolved subject visual this must be a TRANSPARENT overlay, or the
// thumbnail paints a black rectangle over the picture it exists to show.
test("the ground is declared, and it follows whether there is a picture", () => {
  assert.equal(groundOf(thumbnailTree({ hook: "A B C", hasPicture: true })), GROUND.OVER);
  assert.equal(groundOf(thumbnailTree({ hook: "A B C", hasPicture: false })), GROUND.INK);
});

test("a picture gets a gradient backing, bare ground does not", () => {
  const over = boxes(thumbnailTree({ hook: "A B C", hasPicture: true }));
  const ink = boxes(thumbnailTree({ hook: "A B C", hasPicture: false }));
  assert.ok(over.some(s => typeof s.backgroundImage === "string" && s.backgroundImage.includes("gradient")),
    "type over a photograph needs its own backing — the flat scrim read as a seam");
  assert.ok(!ink.some(s => typeof s.backgroundImage === "string"),
    "a gradient over the house ground is a band across nothing");
});

test("an empty hook is refused rather than rendering an empty frame", () => {
  assert.throws(() => thumbnailTree({ hook: "" }), /no hook lines/);
});
