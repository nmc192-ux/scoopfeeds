// radio-screen.spec.js — ScoopFeeds Radio R2 screen: a live (sample:false) state that
// omits markets/weather/key must never show the template's built-in sample numbers.
//
// Loads backend/src/radio/screen/scoopfeeds-radio-screen.html straight from disk (no
// server needed) and drives it the way the playout page does, via ScoopRadio.set().
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = pathToFileURL(path.resolve(HERE, "../../../backend/src/radio/screen/scoopfeeds-radio-screen.html")).href;

// Values that exist ONLY in the template's built-in sample state.
const SAMPLE_VALUES = [
  "6,512.40", "44,210.15", "21,480.60", "8,820.30", "118,450.00", "2,680.40", "98,450", "281.45",   // markets
  "4.12%", "10-year Treasury yield",                                                                // key
  "64°F", "95°F", "97°F", "New York64",                                                             // weather
  "Mild along the East Coast",                                                                       // weatherLine
  "4.1%", "Why job growth is cooling",                                                               // explains
  "Fed officials signal patience",                                                                    // sample headline
  "Top-of-hour News", "10:05 AM ET", "Feature: Tech", "Closing Bell",                                 // sample schedule
  "Photo: agency credit",                                                                             // sample photo credit
  "The Invisible Hand",                                                                               // sample film
  "Story photo", "plays here",                                                                        // placeholder labels
];

const LIVE = {
  sample: false,
  updatedAt: Date.now(),
  headline: "Senate passes stopgap spending bill to avert shutdown",
  alsoThisHour: [
    { h: "Fed holds rates steady as inflation cools", src: "Reported by CNBC" },
    { h: "Magnitude 7.1 earthquake strikes off Japan", src: "Reported by NPR News and BBC News" },
    { h: "EU agrees new rules for AI chatbots", src: "Reported by Politico Europe" },
    { h: "Wildfire forces evacuations in California hills", src: "Reported by LA Times and NPR News" },
    { h: "Oil prices climb on supply worries", src: "Reported by MarketWatch" },
  ],
  music: [
    { cat: "Business", h: "Oil climbs on supply worries", src: "Reported by MarketWatch" },
    { cat: "Tech", h: "Apple unveils cheaper laptop line", src: "Reported by The Verge" },
    { cat: "Health", h: "WHO approves malaria vaccine for wider use", src: "Reported by WHO News" },
    { cat: "Science", h: "NASA delays moon lander test", src: "Reported by NASA News" },
  ],
};

// Rendered DOM only: a clone of <body> without its <script> elements, because the
// inline script that DEFINES the sample state contains every sample value as source text.
const domText = (page) => page.evaluate(() => {
  const b = document.body.cloneNode(true);
  b.querySelectorAll("script").forEach((s) => s.remove());
  return b.innerText + " " + b.innerHTML;
});

test("the preview (sample:true) still shows the sample numbers — sanity check for this spec", async ({ page }) => {
  await page.goto(SCREEN);
  const text = await domText(page);
  expect(text).toContain("6,512.40");
  await expect(page.locator("#sampleTag")).toHaveText("Sample data");
});

test("SAMPLE:FALSE WITH NO MARKETS, WEATHER OR KEY: no built-in sample value is anywhere in the DOM", async ({ page }) => {
  await page.goto(`${SCREEN}?broadcast=1`);
  await page.evaluate((s) => window.ScoopRadio.set(s), LIVE);
  // Every scene once, so a hidden scene's contents are rendered and checked too.
  for (const scene of ["news", "markets", "explains", "weather", "next", "music", "film"]) {
    await page.evaluate((n) => window.ScoopRadio.scene(n), scene);
    const text = await domText(page);
    for (const v of SAMPLE_VALUES) expect(text, `sample value "${v}" visible on scene ${scene}`).not.toContain(v);
  }
  await expect(page.locator("#sampleTag")).toBeHidden();
  await expect(page.locator("#key")).toBeHidden();
  await expect(page.locator("#ltHead")).not.toHaveText("");
});

test("no markets → the Markets scene is not shown (falls back to News)", async ({ page }) => {
  await page.goto(`${SCREEN}?broadcast=1`);
  await page.evaluate((s) => window.ScoopRadio.set(s), LIVE);
  await page.evaluate(() => window.ScoopRadio.scene("markets"));
  expect(await page.evaluate(() => window.ScoopRadio.state().scene)).toBe("news");
  await expect(page.locator('section.scene[data-scene="markets"]')).not.toHaveClass(/active/);
});

test("no markets and no weather → the bottom strip shows the music headlines", async ({ page }) => {
  await page.goto(`${SCREEN}?broadcast=1`);
  await page.evaluate((s) => window.ScoopRadio.set(s), LIVE);
  await expect(page.locator("#mode")).toContainText("Headlines");
  await expect(page.locator("#track")).toContainText("Oil climbs on supply worries");
});

test("no markets but weather present → the strip runs weather-only", async ({ page }) => {
  await page.goto(`${SCREEN}?broadcast=1`);
  await page.evaluate((s) => window.ScoopRadio.set({
    ...s, weather: [{ city: "Boston", f: 61, cond: "Clear", icon: "sun", hi: 66, lo: 50 }],
  }), LIVE);
  await expect(page.locator("#mode")).toContainText("Weather");
  await expect(page.locator("#track")).toContainText("Boston");
  const text = await domText(page);
  expect(text).not.toContain("6,512.40");
});

test("no schedule data → Now/Next and Later are hidden and the side panel shows the music-break headlines", async ({ page }) => {
  await page.goto(`${SCREEN}?broadcast=1`);
  await page.evaluate((s) => window.ScoopRadio.set(s), LIVE);
  await expect(page.locator("#nowNext")).toBeHidden();
  await expect(page.locator("#later")).toBeHidden();
  await expect(page.locator("#sideMusic")).toBeVisible();
  await expect(page.locator("#sideMusic")).toContainText("In the music break");
  await expect(page.locator("#sideMusic")).toContainText("Apple unveils cheaper laptop line");
  // "Coming up" has nothing to show either, so it falls back to News.
  await page.evaluate(() => window.ScoopRadio.scene("next"));
  expect(await page.evaluate(() => window.ScoopRadio.state().scene)).toBe("news");
});

test("schedule data present → Now/Next and Later show, and the music list steps aside", async ({ page }) => {
  await page.goto(`${SCREEN}?broadcast=1`);
  await page.evaluate((s) => window.ScoopRadio.set({
    ...s,
    now: { title: "Top-of-hour News", start: "3:00 PM ET" },
    next: { title: "Markets Wrap", start: "3:30 PM ET" },
    later: [{ when: "4:00 PM", title: "Closing Bell" }],
  }), LIVE);
  await expect(page.locator("#nowNext")).toBeVisible();
  await expect(page.locator("#nowNext")).toContainText("Markets Wrap");
  await expect(page.locator("#later")).toContainText("Closing Bell");
  await expect(page.locator("#sideMusic")).toBeHidden();
});

test("no film data → the Film Hour scene is skipped (falls back to News)", async ({ page }) => {
  await page.goto(`${SCREEN}?broadcast=1`);
  await page.evaluate((s) => window.ScoopRadio.set(s), LIVE);
  await page.evaluate(() => window.ScoopRadio.scene("film"));
  expect(await page.evaluate(() => window.ScoopRadio.state().scene)).toBe("news");
  await expect(page.locator('section.scene[data-scene="film"]')).not.toHaveClass(/active/);
});

test("no story photo → the News plate is dropped and 'Also this hour' takes the full main column", async ({ page }) => {
  await page.goto(`${SCREEN}?broadcast=1`);
  await page.evaluate((s) => window.ScoopRadio.set(s), LIVE);
  await expect(page.locator(".s-news > .plate")).toBeHidden();
  await expect(page.locator(".ph")).toHaveCount(4);
  for (const ph of await page.locator(".ph").all()) await expect(ph).toBeHidden();
  const [news, also] = await Promise.all([
    page.locator(".s-news").boundingBox(), page.locator(".s-news .also").boundingBox(),
  ]);
  expect(Math.abs(also.width - news.width)).toBeLessThan(2);
});

test("a story photo, when supplied, fills the plate instead", async ({ page }) => {
  await page.goto(`${SCREEN}?broadcast=1`);
  await page.evaluate((s) => window.ScoopRadio.set({ ...s, photo: "https://example.com/story.jpg" }), LIVE);
  await expect(page.locator(".s-news > .plate")).toBeVisible();
  expect(await page.locator(".s-news > .plate").evaluate((el) => el.style.backgroundImage)).toContain("story.jpg");
});

test("no photo → the wave bars are restored at the foot of the main column, under 'Also this hour'", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${SCREEN}?broadcast=1`);
  await page.evaluate((s) => window.ScoopRadio.set(s), LIVE);
  const wave = page.locator("#wave");
  await expect(wave).toBeVisible();
  expect(await wave.evaluate((el) => el.parentElement.classList.contains("s-news"))).toBe(true);
  await expect(page.locator("#also .item")).toHaveCount(5);
  const [w, last, news] = await Promise.all([
    wave.boundingBox(), page.locator("#also .item").last().boundingBox(), page.locator(".s-news").boundingBox(),
  ]);
  expect(w.y).toBeGreaterThanOrEqual(last.y + last.height - 1);          // below the last item, no overlap
  expect(Math.abs((w.y + w.height) - (news.y + news.height))).toBeLessThan(2);   // anchored at the column's foot
});
