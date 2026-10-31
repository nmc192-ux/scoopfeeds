/**
 * fontFloor.mjs - measure rendered text on both radio screens, scene by scene (#200, DrJ 22 Oct 2026: "no text on
 * screen smaller than the ticker text, 26 px at 1080p"). Needs a Chromium (Playwright); used by fontFloor.test.js
 * and runnable by hand to take the screenshots:
 *
 *   node src/radio/screen/fontFloor.mjs --shots <dir>     # 1080p + phone-width (390 px) PNGs of every scene
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { sampleProgramme } from "./fixtures/sampleProgramme.mjs";
import { sampleWindow } from "./fixtures/sampleElection.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FLOOR_PX = 26;
export const SCREEN_247 = path.join(HERE, "scoopfeeds-radio-screen.html");
export const SCREEN_PROG = path.join(HERE, "scoopfeeds-radio-programme.html");
export const SCENES_247 = ["news", "markets", "explains", "weather", "next", "music", "film"];

export async function launch() {
  const req = createRequire(import.meta.url);
  let pw;
  for (const name of ["playwright", "playwright-core", path.join(HERE, "../playout/node_modules/playwright-core")]) { try { pw = req(name); break; } catch { /* next */ } }
  if (!pw) throw new Error("no playwright package");
  return pw.chromium.launch(process.env.RADIO_PLAYOUT_CHROME === "system" ? { channel: "chrome" } : {});
}

/** Every visible element with its own text, with its rendered font size in 1080p stage pixels. */
async function measure(page, rootSel, frameSel) {
  return page.evaluate(({ rootSel, frameSel }) => {
    const root = document.querySelector(rootSel);
    const scale = root.getBoundingClientRect().width / 1920;
    const frame = (frameSel && document.querySelector(frameSel) || root).getBoundingClientRect();
    const out = [];
    for (const el of root.querySelectorAll("*")) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
      if (!own) continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      let o = 1; for (let e = el; e && e !== document.body; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
      if (o < 0.5) continue;   // a card fading out, not text on screen
      // overflow (#197 review): text that runs past the scene frame is clipped off air without any error
      const inScene = !!el.closest(".scene.on");   // the ticker scrolls and the header sits above #main by design
      const off = !frameSel || !inScene ? 0 : Math.max(0, r.bottom - frame.bottom, r.right - frame.right, frame.top - r.top, frame.left - r.left) / scale;
      out.push({ text: own.slice(0, 50), px: Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100, cls: el.className || el.tagName.toLowerCase(), scale, off: Math.round(off) });
    }
    return out;
  }, { rootSel, frameSel });
}

/** @returns {Promise<{screen, scene, smallest, under: object[]}[]>} */
export async function measureAll(browser, { shots = null } = {}) {
  const results = [];
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  // sizes do not depend on the webfont, so the test never waits on the network; screenshots load the real fonts
  if (!shots) await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  // 24/7 headline screen (sample data in its preview state)
  await page.goto(pathToFileURL(SCREEN_247).href + "?broadcast=1");
  await page.waitForFunction(() => !!window.ScoopRadio);
  for (const sc of SCENES_247) {
    await page.evaluate((s) => window.ScoopRadio.scene(s), sc);
    await page.waitForTimeout(900);
    const m = await measure(page, "#frame");
    results.push(summary("24/7", sc, m));
    if (shots) await page.screenshot({ path: path.join(shots, `247-${sc}.jpg`), quality: 85 });
  }
  // programme screen, frozen on each scene
  const { programme, scenes } = sampleProgramme();
  await page.goto(pathToFileURL(SCREEN_PROG).href);
  await page.waitForFunction(() => !!window.ScoopProgramme);
  await page.evaluate((p) => window.ScoopProgramme.set(p), programme);
  for (const [name, c] of Object.entries(scenes)) {
    await page.evaluate((t) => window.ScoopProgramme.renderAt(t), c.at);
    await page.waitForTimeout(900);
    await page.evaluate((t) => window.ScoopProgramme.renderAt(t), c.at + 1);   // music cards fade in over 0.7 s
    const m = await measure(page, "#stage", "#main");
    results.push(summary("programme", name, m));
    if (shots) await page.screenshot({ path: path.join(shots, `programme-${name}.jpg`), quality: 85 });
  }
  // 1 Nov: the election window on the rail (story, music), beside a film, and the one-line bug over a full-frame episode
  {
    const t0 = scenes.story.at;
    const filmAt = scenes.signoff.at - 60_000, featAt = filmAt + 20_000;
    const p2 = { ...programme, builtAt: 2, electionWindow: sampleWindow(filmAt - 10_000),
      cues: [...programme.cues, { at: filmAt, scene: "film", data: { title: "From The Invisible Hand", src: "film.webm", t0: filmAt } },
        { at: featAt, scene: "feature", data: { src: "feature.webm", t0: featAt } }, { at: featAt + 20_000, scene: "music", data: {} }].sort((a, b) => a.at - b.at) };
    await page.evaluate((p) => window.ScoopProgramme.set(p), p2);
    for (const [name, at] of [["window-story", t0], ["window-music", scenes.music.at], ["window-film", filmAt + 2000], ["window-feature", featAt + 2000]]) {
      await page.evaluate((t) => window.ScoopProgramme.renderAt(t), at);
      await page.waitForTimeout(900);
      await page.evaluate((t) => window.ScoopProgramme.renderAt(t), at + 1);
      const m = await measure(page, "#stage", "#main");
      results.push(summary("programme", name, m));
      if (shots) await page.screenshot({ path: path.join(shots, `programme-${name}.jpg`), quality: 85 });
    }
    await page.evaluate((p) => window.ScoopProgramme.set(p), programme);
  }
  if (shots) {   // phone width: 390 css px wide, the 16:9 frame scaled to fit
    await page.setViewportSize({ width: 390, height: 219 });
    for (const name of ["story", "music", "markets"]) {
      await page.evaluate((t) => window.ScoopProgramme.renderAt(t), scenes[name].at + 2);
      await page.waitForTimeout(1200);   // let the scene's fade finish
      await page.screenshot({ path: path.join(shots, `phone-programme-${name}.png`) });
    }
    await page.goto(pathToFileURL(SCREEN_247).href + "?broadcast=1");
    await page.waitForFunction(() => !!window.ScoopRadio);
    for (const sc of ["news", "markets"]) { await page.evaluate((s) => window.ScoopRadio.scene(s), sc); await page.waitForTimeout(900); await page.screenshot({ path: path.join(shots, `phone-247-${sc}.png`) }); }
  }
  await page.close();
  return results;
}

function summary(screen, scene, m) {
  const under = m.filter((x) => x.px < FLOOR_PX);
  const overflow = m.filter((x) => x.off > 1);
  return { screen, scene, count: m.length, smallest: m.length ? Math.min(...m.map((x) => x.px)) : null, under, overflow };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf("--shots");
  const shots = i > 0 ? path.resolve(process.argv[i + 1]) : null;
  if (shots) (await import("node:fs")).mkdirSync(shots, { recursive: true });
  const b = await launch();
  const res = await measureAll(b, { shots });
  await b.close();
  for (const r of res) console.log(`${r.under.length ? "✗" : "✓"} ${r.screen.padEnd(9)} ${r.scene.padEnd(10)} ${String(r.count).padStart(3)} text elements, smallest ${r.smallest} px${r.overflow?.length ? "  OVERFLOW: " + r.overflow.map((u) => `${u.off}px "${u.text}"`).join("; ") : ""}${r.under.length ? "  UNDER: " + r.under.map((u) => `${u.px}px "${u.text}" (${u.cls})`).join("; ") : ""}`);
  process.exitCode = res.some((r) => r.under.length || (r.overflow || []).length) ? 1 : 0;
}
