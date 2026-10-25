import { test, expect } from "@playwright/test";

// #189 — the Today page at `/` under SITE_V2.
const now = Date.now();
const DAY = 86_400_000;
const ev = (id, extra = {}) => ({
  id, slug: `e${id}`, title: `Story number ${id}`, category: "international",
  severity: 0.5, article_count: 4, source_count: 3, status: "active",
  started_at: now - 2 * 60_000, last_activity_at: now - 60_000, ...extra,
});
const FIXTURE = [
  ev(1, { title: "The lead story" }),
  ev(2, { title: "Developing live", started_at: now - 3 * DAY, last_activity_at: now - 10 * 60_000 }),
  ev(3, { title: "Developing quiet", started_at: now - 2 * DAY, last_activity_at: now - 5 * 3_600_000 }),
  ev(4), ev(5), ev(6), ev(7),
  ev(1, { title: "The lead story" }), // a duplicate id must not render twice
];

async function setup(page, { v2 = true, events = FIXTURE, radio = null } = {}) {
  const calls = [];
  // Catch-all first (Playwright tries the most recently added route first), so an
  // unmocked call such as /api/health never reaches a missing backend and trips
  // the app-wide "Backend Not Running" screen.
  await page.route("**/api/**", r => r.fulfill({ json: {} }));
  await page.route("**/api/site-config", r => r.fulfill({ json: { marketOdds: false, v2 } }));
  await page.route("**/api/ri/events**", r => { calls.push(r.request().url()); return r.fulfill({ json: { events } }); });
  await page.route("**/api/radio/state.json", r =>
    radio ? r.fulfill({ json: radio }) : r.fulfill({ status: 404, json: { error: "not found" } }));
  return calls;
}

test("flag off: / is the classic homepage", async ({ page }) => {
  await setup(page, { v2: false });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Top stories" })).toBeVisible();
  await expect(page.getByTestId("today-page")).toHaveCount(0);
});

test("flag on: lead, developing strip and today's stories, each story once, one events request", async ({ page }) => {
  const calls = await setup(page);
  await page.goto("/?v2=1");
  await expect(page.getByTestId("today-lead")).toContainText("The lead story");
  await expect(page.getByTestId("today-developing")).toBeVisible();
  await expect(page.getByTestId("today-stories")).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);

  const ids = await page.locator("[data-testid=today-page] [data-event-id]").evaluateAll(
    els => els.map(e => e.getAttribute("data-event-id")));
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length);

  // "Live" red only on the event active in the last hour.
  await expect(page.getByTestId("live-badge")).toHaveCount(1);
  await expect(page.locator('[data-testid=today-developing] [data-event-id="2"] [data-testid=live-badge]')).toHaveCount(1);

  await page.waitForLoadState("networkidle");
  expect(calls.length).toBe(1);
});

test("flag on, radio 404: no Radio card in the DOM", async ({ page }) => {
  await setup(page);
  await page.goto("/?v2=1");
  await expect(page.getByTestId("today-lead")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("today-radio")).toHaveCount(0);
});

test("flag on, radio 200: the card shows the headline", async ({ page }) => {
  await setup(page, { radio: { sample: false, updatedAt: now, headline: "Radio headline here", alsoThisHour: [{ h: "Also one", src: "AP" }, { h: "Also two", src: "BBC" }, { h: "Also three", src: "NPR" }] } });
  await page.goto("/?v2=1");
  const card = page.getByTestId("today-radio");
  await expect(card).toContainText("Radio headline here");
  await expect(card).toContainText("Also two");
  await expect(card).not.toContainText("Also three");
  await expect(card).toHaveAttribute("href", "/live-tv");
});

test("flag on, empty list: honest empty copy and no empty blocks", async ({ page }) => {
  await setup(page, { events: [] });
  await page.goto("/?v2=1");
  await expect(page.getByText("No stories right now — check back shortly.")).toBeVisible();
  await expect(page.getByTestId("today-developing")).toHaveCount(0);
  await expect(page.getByTestId("today-stories")).toHaveCount(0);
  await expect(page.getByTestId("today-lead")).toHaveCount(0);
});

for (const [w, h] of [[390, 844], [1440, 900]]) {
  test(`screenshot ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    // Skip the first-visit onboarding modal so the page itself is in the shot.
    await page.addInitScript(() => localStorage.setItem("khabari-store",
      JSON.stringify({ state: { onboardingComplete: true }, version: 2 })));
    await setup(page, { radio: { headline: "Radio headline here", alsoThisHour: [{ h: "Also one" }] } });
    await page.goto("/?v2=1");
    await expect(page.getByTestId("today-lead")).toBeVisible();
    await page.screenshot({ path: `test-results/today-${w}.png`, fullPage: true });
  });
}

// #242 — a publisher that refuses its image (hotlink block) must not leave a broken-image box.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const BAD = "https://images.example.test/blocked.jpg";
const GOOD = "https://images.example.test/fine.png";
const IMG_FIXTURE = [
  ev(1, { title: "The lead story", hero_image_url: BAD }),
  ev(2, { title: "Developing live", started_at: now - 3 * DAY, last_activity_at: now - 10 * 60_000, hero_image_url: BAD }),
  ev(4, { hero_image_url: BAD }), ev(5, { hero_image_url: GOOD }), ev(6, { hero_image_url: BAD }), ev(7),
];
const skipOnboarding = (page) => page.addInitScript(() => localStorage.setItem("khabari-store",
  JSON.stringify({ state: { onboardingComplete: true }, version: 2 })));

async function brokenInViewport(page) {
  return page.evaluate(() => [...document.querySelectorAll("[data-testid=today-page] img")].filter((img) => {
    const r = img.getBoundingClientRect();
    const inView = r.bottom > 0 && r.top < innerHeight && r.width > 0 && r.height > 0;
    return inView && img.complete && img.naturalWidth === 0;
  }).length);
}

for (const [w, h] of [[1440, 900], [390, 844]]) {
  test(`flag on, ${w}px: an image that 404s collapses its slot; a good one still shows`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await skipOnboarding(page);
    await setup(page, { events: IMG_FIXTURE });
    await page.route("https://images.example.test/**", (r) => r.request().url() === GOOD
      ? r.fulfill({ status: 200, contentType: "image/png", body: PNG_1PX })
      : r.fulfill({ status: 404, body: "" }));
    await page.goto("/?v2=1");
    await expect(page.getByTestId("today-lead")).toContainText("The lead story");

    // The lead keeps its eyebrow and headline, with no image slot left behind.
    await expect(page.locator("[data-testid=today-lead] [data-image-slot]")).toHaveCount(0);
    await expect(page.locator("[data-testid=today-lead] img")).toHaveCount(0);

    // Story cards: scroll through so every lazy image gets its chance to load or fail.
    const stories = page.getByTestId("today-stories");
    await stories.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 4000);
    await expect(page.locator('[data-testid=today-stories] [data-event-id="5"] img')).toHaveCount(1);
    await expect.poll(() => page.locator('[data-testid=today-stories] [data-event-id="5"] img')
      .evaluate((img) => img.complete && img.naturalWidth)).toBe(1);
    for (const id of ["4", "6"]) {
      await expect(page.locator(`[data-testid=today-stories] [data-event-id="${id}"] [data-image-slot]`)).toHaveCount(0);
    }
    expect(await brokenInViewport(page)).toBe(0);
    await page.evaluate(() => scrollTo(0, 0));
    expect(await brokenInViewport(page)).toBe(0);
  });
}

test("onboarding modal: v2 look under the flag, classic look without it", async ({ page }) => {
  await setup(page, { events: FIXTURE });
  await page.goto("/?v2=1");
  const header = page.getByTestId("onboarding-header");
  await expect(header).toBeVisible();
  await expect(header).toContainText("Welcome to Scoop*Feeds");
  expect(await header.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(9, 7, 6)");
  // Behaviour unchanged: picking a region still moves to the language step.
  await page.getByRole("button", { name: "Canada" }).click();
  await expect(page.getByText("Choose your language")).toBeVisible();
  await page.screenshot({ path: "test-results/onboarding-v2.png" });
});

test("onboarding modal: flag off keeps the classic header", async ({ page }) => {
  await setup(page, { v2: false });
  await page.goto("/?v2=0");
  const header = page.getByTestId("onboarding-header");
  await expect(header).toBeVisible();
  await expect(header).toContainText("Welcome to Scoopfeeds");
  expect(await header.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgb(9, 7, 6)");
});
