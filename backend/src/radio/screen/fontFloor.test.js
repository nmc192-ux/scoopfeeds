// fontFloor.test.js - no text on either radio screen is smaller than the ticker text, 26 px at 1080p (#200, DrJ
// 22 Oct 2026). Measured in a real browser, scene by scene. Where no Chromium can be launched (the CI runner has
// none) the rendered test is SKIPPED, which is not a pass; the static check below runs everywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { FLOOR_PX, SCREEN_247, SCREEN_PROG, launch, measureAll } from "./fontFloor.mjs";

let browser = null, why = null;
try { browser = await launch(); } catch (e) { why = `no Chromium here (${e.message.split("\n")[0]}): rendered sizes UNVERIFIED on this machine`; }

test("rendered: every scene of both screens, no text under 26 px", { skip: why || false }, async () => {
  try {
    const res = await measureAll(browser);
    assert.ok(res.length >= 18, "measured 7 headline-screen scenes and 11 programme scenes");
    for (const r of res) {
      assert.ok(r.count > 10, `${r.screen}/${r.scene}: measured ${r.count} text elements (the scene rendered)`);
      assert.deepEqual(r.under.map((u) => `${u.px}px "${u.text}"`), [], `${r.screen}/${r.scene}: text under ${FLOOR_PX} px`);
    }
  } finally { await browser.close(); }
});

// The CSS of the broadcast frames (the 24/7 preview chrome around the frame is not broadcast) and every inline
// style in either page: no px font size under the floor.
test("static: no px font size under 26 in either screen's broadcast styles or inline styles", () => {
  for (const f of [SCREEN_247, SCREEN_PROG]) {
    let html = fs.readFileSync(f, "utf8");
    const cut = html.indexOf("/* ---------- broadcast frame ---------- */");
    if (cut > 0) html = html.slice(cut);   // 24/7 page: skip the preview chrome
    const small = [...html.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])).filter((n) => n < FLOOR_PX);
    assert.deepEqual(small, [], `${f.split("/").pop()}: font sizes under ${FLOOR_PX}px`);
  }
});

test("static: both screens share the frame (Signal fonts, the four clocks, LIVE)", () => {
  for (const f of [SCREEN_247, SCREEN_PROG]) {
    const html = fs.readFileSync(f, "utf8");
    assert.match(html, /family=Bodoni\+Moda.*Schibsted\+Grotesk/, `${f}: Signal fonts`);
    assert.doesNotMatch(html, /Archivo|Newsreader|--lime/, `${f}: no trace of the old look`);
    assert.match(html, /\['New York','America\/New_York'\],\['London','Europe\/London'\],\['Dubai','Asia\/Dubai'\],\['Karachi','Asia\/Karachi'\]/, `${f}: the four clocks`);
  }
});
