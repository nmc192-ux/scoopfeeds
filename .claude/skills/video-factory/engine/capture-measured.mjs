// Coordinate-driven source capture. Replaces hand-guessed crops/highlights.
//
// THE PROBLEM THIS SOLVES
// The first approach captured a screenshot, then I guessed fractional crop and
// highlight boxes, rendered, looked, and adjusted — three or four rounds per
// document, and text still ended up clipped and highlights still landed on
// navigation chrome instead of the sentence.
//
// THE FIX
// The browser already knows exactly where everything is. So:
//   1. Find the CONTAINER element (the article header, the chart figure) and
//      screenshot exactly its bounding box plus padding. Nothing can clip,
//      because the crop IS the element.
//   2. Find the exact PHRASE with a DOM Range and read getClientRects(). A range
//      returns one rect PER LINE, so a highlight that wraps across three lines
//      highlights all three correctly — which a single guessed box never could.
//   3. Emit rects.json in pixels relative to the screenshot origin.
//
// The renderer then draws highlights from measured coordinates. No calibration.

import { chromium } from "/Users/jahanzebhussain/Downloads/scoop-news/frontend/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { P } from "./_deps.mjs";
const OUT = P("out/docs");
mkdirSync(OUT, { recursive: true });

const KILL = ['[id*="onetrust"]', '[class*="cookie"]', '[class*="consent"]', '[class*="newsletter"]',
  '[class*="signup"]', '[class*="paywall"]', '[class*="modal"]', '[class*="overlay"]',
  '[class*="interstitial"]', '[class*="promo"]', '[id*="ad-"]', '[class*="trending"]'];

// The document list is PER VIDEO, so it lives in the project as docs.json —
// an array of { name, url, container, phrases, pad, minW?, minH? }. It used to
// be hardcoded here, which meant the engine carried one film's sources forever
// and the wrong ones silently shipped into the next.
const DOCS_PATH = P("docs.json");
if (!existsSync(DOCS_PATH)) {
  console.error(`no docs.json in ${P(".")} — nothing to capture.`);
  console.error(`Create one: [{ "name":"slug", "url":"https://…", "container":"text inside the element to frame", "phrases":["exact phrase to highlight"], "pad":46 }]`);
  process.exit(1);
}
const DOCS = JSON.parse(readFileSync(DOCS_PATH, "utf8"));
if (!Array.isArray(DOCS) || !DOCS.length) {
  console.error(`docs.json in ${P(".")} is empty — no source screenshots to capture.`);
  console.error(`Add entries, or skip this step if the film cites no documents.`);
  process.exit(0);
}

const purge = (kill) => {
  for (const sel of kill) document.querySelectorAll(sel).forEach((e) => { try { e.remove(); } catch {} });
  document.querySelectorAll("*").forEach((e) => {
    const s = getComputedStyle(e);
    if ((s.position === "fixed" || s.position === "sticky") && e.offsetHeight > 40) { try { e.remove(); } catch {} }
  });
};

/**
 * In-page: locate the smallest element containing `needle`, walk up until the
 * box is a sensible width, and measure exact rects for each phrase via Range.
 */
const measure = ({ needle, phrases, pad, minW = 480, minH = 0, noScroll = false }) => {
  const all = [...document.querySelectorAll("h1,h2,h3,p,div,section,article,figure,span")];
  let el = all.filter((e) => e.innerText && e.innerText.includes(needle))
              .sort((a, b) => a.innerText.length - b.innerText.length)[0];
  if (!el) return null;
  // Climb until the box is big enough to read as a clipping AND to contain the
  // phrase we intend to highlight — the Range search only looks inside `el`, so
  // stopping too early is why the Fed legend produced zero rects.
  while (el.parentElement) {
    const b = el.getBoundingClientRect();
    if (b.width >= minW && b.height >= minH) break;
    el = el.parentElement;
  }
  // Scrolling and measuring MUST NOT happen in the same call. scrollIntoView
  // respects CSS scroll-behavior, so on a page that sets `smooth` the scroll is
  // still animating when getBoundingClientRect runs — every coordinate is then
  // read against a layout that is about to move. That put the UN News highlight
  // exactly one line low, on "Safety Division." instead of the quote. The
  // caller now scrolls, waits, and measures with noScroll.
  if (!noScroll) { el.scrollIntoView({ block: "center", behavior: "instant" }); return null; }

  const box = el.getBoundingClientRect();
  const originX = Math.max(0, box.left - pad);
  const originY = Math.max(0, box.top - pad);
  const width = Math.min(box.width + pad * 2, window.innerWidth - originX);
  const height = Math.min(box.height + pad * 2, window.innerHeight - originY);

  // Exact per-line rects for each phrase, via a DOM Range over text nodes.
  const rects = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = []; let n;
  while ((n = walker.nextNode())) nodes.push(n);
  for (const phrase of phrases) {
    // TAKE THE FIRST MATCH WHOSE RECTS ACTUALLY LIE INSIDE THE CAPTURED BOX.
    //
    // The old code took the first text node containing the phrase and stopped.
    // Pages routinely carry duplicates of their own copy — print stylesheets,
    // screen-reader text, preloaded JSON-LD rendered offscreen — and those
    // nodes measure to coordinates nowhere near the screenshot. On the UN News
    // page that put the highlight one line low, sitting on "Safety Division."
    // instead of the quote it was supposed to mark. A highlight on the wrong
    // sentence is worse than none: it asserts a claim the source didn't make.
    for (const node of nodes) {
      const i = node.textContent.indexOf(phrase);
      if (i === -1) continue;
      const r = document.createRange();
      r.setStart(node, i); r.setEnd(node, i + phrase.length);
      const cand = [];
      let ok = true;
      for (const cr of r.getClientRects()) {
        if (cr.width < 4 || cr.height < 4) continue;
        const inside = cr.left >= originX - 2 && cr.top >= originY - 2
          && cr.right <= originX + width + 2 && cr.bottom <= originY + height + 2;
        if (!inside) { ok = false; break; }
        cand.push({
          x: +(cr.left - originX).toFixed(1), y: +(cr.top - originY).toFixed(1),
          w: +cr.width.toFixed(1), h: +cr.height.toFixed(1),
        });
      }
      if (ok && cand.length) { rects.push(...cand); break; }
    }
  }
  return { clip: { x: originX, y: originY, width, height }, rects };
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  deviceScaleFactor: 2,
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
});

const manifest = {};
for (const d of DOCS) {
  const page = await ctx.newPage();
  try {
    await page.goto(d.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4000);
    await page.evaluate(purge, KILL);
    await page.waitForTimeout(400);
    const args = { needle: d.container, phrases: d.phrases, pad: d.pad, minW: d.minW, minH: d.minH };
    // Pass 1: scroll only (returns null by design).
    await page.evaluate(measure, args);
    await page.waitForTimeout(700);
    // Pass 2: measure against the settled layout.
    const use = await page.evaluate(measure, { ...args, noScroll: true });
    if (!use) { console.log(`✗ ${d.name}: container not found`); await page.close(); continue; }
    await page.screenshot({ path: path.join(OUT, `${d.name}.png`), clip: use.clip });
    // Screenshot is at DPR 2, so page pixels double.
    manifest[d.name] = {
      w: Math.round(use.clip.width * 2), h: Math.round(use.clip.height * 2),
      rects: use.rects.map((r) => ({ x: r.x * 2, y: r.y * 2, w: r.w * 2, h: r.h * 2 })),
    };
    console.log(`✓ ${d.name}  ${manifest[d.name].w}×${manifest[d.name].h}  ${use.rects.length} highlight rect(s)`);
  } catch (e) {
    console.log(`✗ ${d.name}: ${e.message.split("\n")[0].slice(0, 100)}`);
  }
  await page.close();
}
await browser.close();
writeFileSync(path.join(OUT, "rects.json"), JSON.stringify(manifest, null, 2));
console.log("\nwrote out/docs/rects.json");
