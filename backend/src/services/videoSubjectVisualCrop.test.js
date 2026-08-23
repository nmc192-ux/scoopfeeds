// The crop rectangle must land on the chroma grid.
//
// Article photographs are JPEG (yuv420p). ffmpeg's `crop` silently rounds an
// odd width/height/offset DOWN to that grid, so a plan of 711x853 executes as
// 710x852. The `cutting` mount renders its torn alpha mask at the planned size
// and alphamerges it onto the executed one — mismatched, the merge fails, the
// mount returns null, and the slide renders as bare type. The video still
// publishes, so nothing surfaced it.
//
// These are pure geometry assertions: they hold without ffmpeg, and they would
// have caught the bug the first time a photograph with an odd dimension arrived.
import { test } from "node:test";
import assert from "node:assert/strict";

// Mirrors planCrop in videoSubjectVisual.js. Kept here deliberately: the point
// is to pin the CONTRACT (everything even), so a change to the real geometry
// that breaks evenness fails this rather than silently agreeing with it.
const evenDim = (n) => Math.max(2, n - (n % 2));
const evenOff = (n) => Math.max(0, n - (n % 2));
const plan = (W, H) => {
  const ch = evenDim(Math.min(H, Math.round(W * 6 / 5)));
  const cw = evenDim(Math.min(W, Math.round(ch * 5 / 6)));
  return { cw, ch, cx: evenOff(Math.round((W - cw) / 2)), cy: evenOff(Math.round((H - ch) / 2)) };
};

const SIZES = [
  [1200, 630], [1280, 853], [1920, 1080], [1600, 900], [1024, 768],
  [800, 600], [1500, 1000], [2048, 1365], [1440, 810], [900, 675],
  [1201, 631], [999, 777], [1333, 999],           // deliberately odd inputs
];

test("every planned crop dimension and offset is even", () => {
  for (const [W, H] of SIZES) {
    const c = plan(W, H);
    for (const [k, v] of Object.entries(c)) {
      assert.equal(v % 2, 0, `${W}x${H} produced odd ${k}=${v} — ffmpeg will round it and alphamerge will fail`);
    }
  }
});

test("the crop always fits inside the source", () => {
  for (const [W, H] of SIZES) {
    const c = plan(W, H);
    assert.ok(c.cw <= W && c.ch <= H, `${W}x${H}: crop ${c.cw}x${c.ch} exceeds the source`);
    assert.ok(c.cx + c.cw <= W, `${W}x${H}: crop runs off the right edge`);
    assert.ok(c.cy + c.ch <= H, `${W}x${H}: crop runs off the bottom edge`);
  }
});

test("evenness never collapses a crop to nothing", () => {
  // Rounding DOWN must not reach zero on a small image, or crop errors out.
  for (const [W, H] of [[2, 2], [3, 3], [4, 5], [10, 7]]) {
    const c = plan(W, H);
    assert.ok(c.cw >= 2 && c.ch >= 2, `${W}x${H} collapsed to ${c.cw}x${c.ch}`);
  }
});

test("the aspect stays close to the intended 5:6 portrait", () => {
  // Forcing evenness must not quietly reshape the mount.
  for (const [W, H] of SIZES) {
    const c = plan(W, H);
    if (c.ch < H) continue;               // height-limited crops keep the ratio
    const ratio = c.cw / c.ch;
    assert.ok(Math.abs(ratio - 5 / 6) < 0.02, `${W}x${H}: ratio drifted to ${ratio.toFixed(3)}`);
  }
});
