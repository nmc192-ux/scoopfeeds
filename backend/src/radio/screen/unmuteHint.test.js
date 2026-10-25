// unmuteHint.test.js - the programme page's "No sound? Tap the speaker to unmute" hint is for a browser visitor and
// must never go on air (#246, DrJ's YouTube Studio screenshot of the first live hour, 25 Oct 2026). The playout loads
// the page with media=encoder (screenServer.programmeUrl); that one parameter is the on-air signal, no second detection
// path. The rendered check needs a Chromium; where none can be launched it is SKIPPED, which is not a pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { SCREEN_PROG, launch } from "./fontFloor.mjs";
import { sampleProgramme } from "./fixtures/sampleProgramme.mjs";
import { programmeUrl } from "../playout/screenServer.js";

let browser = null, why = null;
try { browser = await launch(); } catch (e) { why = `no Chromium here (${e.message.split("\n")[0]}): unmute hint visibility UNVERIFIED on this machine`; }

async function hintVisible(query) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  try {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.goto(pathToFileURL(SCREEN_PROG).href + query);
    await page.waitForFunction(() => !!window.ScoopProgramme);
    const { programme, scenes } = sampleProgramme();
    await page.evaluate((p) => window.ScoopProgramme.set(p), programme);
    await page.evaluate((t) => window.ScoopProgramme.renderAt(t), scenes.countdown.at + 1000);
    await page.waitForTimeout(900);   // the scene's fade
    return await page.evaluate(() => {   // await: the finally below closes the page
      const scene = document.querySelector('.scene[data-scene="countdown"]');
      const el = document.querySelector(".slate .unmute");
      return { sceneOn: scene.classList.contains("on"), hint: !!el && el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) };
    });
  } finally { await page.close(); }
}

test("rendered: countdown slate shows the unmute hint in a browser, never under the playout", { skip: why || false }, async () => {
  try {
    const browserMode = await hintVisible("");
    assert.ok(browserMode.sceneOn, "browser mode: the countdown scene rendered");
    assert.equal(browserMode.hint, true, "browser mode: the unmute hint is shown");
    const onAir = await hintVisible("?media=encoder");
    assert.ok(onAir.sceneOn, "playout mode: the countdown scene rendered");
    assert.equal(onAir.hint, false, "playout mode: the unmute hint is off air");
  } finally { await browser.close(); }
});

test("static: the hint is hidden by the playout's own media=encoder flag, and the playout URL carries it", () => {
  const html = fs.readFileSync(SCREEN_PROG, "utf8");
  assert.match(html, /class="unmute caps"/, "the hint still exists for browser visitors");
  assert.match(html, /\.on-air \.slate \.unmute\{display:none;\}/, "CSS hides the hint on air");
  assert.match(html, /if \(ENCODER_MEDIA\) document\.documentElement\.classList\.add\('on-air'\)/, "on-air keyed to ENCODER_MEDIA");
  assert.match(html, /const ENCODER_MEDIA = params\.get\('media'\) === 'encoder';/, "one detection path");
  assert.match(programmeUrl("http://127.0.0.1:1"), /[?&]media=encoder(&|$)/, "the playout loads the page in encoder mode");
});
