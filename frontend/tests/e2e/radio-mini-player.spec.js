import { test, expect } from "@playwright/test";

// #261 — Radio on the site: the scheduled now/next on the Today Radio card, and the dark mini-player.
const now = Date.now();
const ev = (id) => ({
  id, slug: `e${id}`, title: `Story ${id}`, category: "international", severity: 0.5, article_count: 4,
  source_count: 3, status: "active", started_at: now - 120_000, last_activity_at: now - 60_000,
});
const SCHEDULE = (watchUrl) => ({
  basis: "schedule",
  now: { label: "16:00 ET · US evening", daypart: "us-evening", startsAt: "", endsAt: "", feature: null },
  next: { label: "17:00 ET · US evening", daypart: "us-evening", startsAt: "", feature: null },
  nextFeature: null, watchUrl, updatedAt: new Date(now).toISOString(),
});
const STATE = { sample: false, updatedAt: now, headline: "Radio headline here", alsoThisHour: [] };

async function setup(page, { radioNow = null, radioState = STATE } = {}) {
  const youtube = [];
  // Skip the first-visit onboarding modal, which would cover the bar.
  await page.addInitScript(() => localStorage.setItem("khabari-store",
    JSON.stringify({ state: { onboardingComplete: true }, version: 2 })));
  page.on("request", (r) => { if (/youtube\.com|youtube-nocookie\.com|ytimg\.com/.test(new URL(r.url()).hostname)) youtube.push(r.url()); });
  await page.route(/youtube\.com|ytimg\.com/, (r) => r.fulfill({ status: 204, body: "" }));
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/site-config", (r) => r.fulfill({ json: { marketOdds: false, v2: true } }));
  await page.route("**/api/ri/events**", (r) => r.fulfill({ json: { events: [ev(1), ev(2), ev(3)] } }));
  await page.route("**/api/radio/state.json", (r) => (radioState ? r.fulfill({ json: radioState }) : r.fulfill({ status: 404, json: {} })));
  await page.route("**/api/radio/now.json", (r) => (radioNow ? r.fulfill({ json: radioNow }) : r.fulfill({ status: 404, json: {} })));
  return youtube;
}

test("Radio card: 'Scheduled now' and 'Next' lines; Listen stays /live-tv without a watch URL", async ({ page }) => {
  await setup(page, { radioNow: SCHEDULE(null) });
  await page.goto("/?v2=1");
  const card = page.getByTestId("today-radio");
  await expect(card).toContainText("Scheduled now: 16:00 ET · US evening");
  await expect(card).toContainText("Next: 17:00 ET · US evening");
  await expect(card).not.toContainText(/\blive\b/i);
  await expect(card).toHaveAttribute("href", "/live-tv");
});

test("Radio card: now.json 404 → no schedule lines, card unchanged", async ({ page }) => {
  await setup(page);
  await page.goto("/?v2=1");
  await expect(page.getByTestId("today-radio")).toContainText("Radio headline here");
  await expect(page.getByTestId("today-radio-schedule")).toHaveCount(0);
  await expect(page.getByTestId("today-radio")).toHaveAttribute("href", "/live-tv");
});

test("Radio card: Listen goes to the watch URL when set", async ({ page }) => {
  await setup(page, { radioNow: SCHEDULE("https://www.youtube.com/watch?v=abcDEF12345") });
  await page.goto("/?v2=1");
  await expect(page.getByTestId("today-radio")).toHaveAttribute("href", "https://www.youtube.com/watch?v=abcDEF12345");
});

test("mini-player is dark without ?radio=1", async ({ page }) => {
  await setup(page, { radioNow: SCHEDULE("https://www.youtube.com/watch?v=abcDEF12345") });
  await page.goto("/?v2=1");
  await expect(page.getByTestId("today-lead")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("radio-mini-player")).toHaveCount(0);
});

test("mini-player is dark without a watch URL, even with ?radio=1", async ({ page }) => {
  await setup(page, { radioNow: SCHEDULE(null) });
  await page.goto("/?v2=1&radio=1");
  await expect(page.getByTestId("today-lead")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("radio-mini-player")).toHaveCount(0);
});

test("mini-player: no youtube.com request before the click, embed after, persists across routes, dismissable", async ({ page }) => {
  const youtube = await setup(page, { radioNow: SCHEDULE("https://www.youtube.com/watch?v=abcDEF12345") });
  await page.goto("/?v2=1&radio=1");
  const bar = page.getByTestId("radio-mini-player");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("Scheduled now: 16:00 ET · US evening");
  await page.waitForLoadState("networkidle");
  await expect(bar.locator("iframe")).toHaveCount(0);
  expect(youtube).toEqual([]);

  await page.getByTestId("radio-mini-listen").click();
  const frame = page.getByTestId("radio-mini-embed").locator("iframe");
  await expect(frame).toHaveAttribute("src", /youtube\.com\/embed\/abcDEF12345\?autoplay=0/);

  // a route change keeps the bar (it is mounted outside <Routes>); sessionStorage keeps the opt-in
  await page.getByRole("navigation", { name: "Primary" }).first().getByRole("link", { name: "News" }).click();
  await expect(page).toHaveURL(/\/events/);
  await expect(page.getByTestId("radio-mini-player")).toBeVisible();

  await page.getByTestId("radio-mini-close").click();
  await expect(page.getByTestId("radio-mini-player")).toHaveCount(0);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("radio-mini-player")).toHaveCount(0);
});

test("mini-player: a @handle watch URL has no embed form, so Listen links out", async ({ page }) => {
  await setup(page, { radioNow: SCHEDULE("https://www.youtube.com/@ScoopFeeds/live") });
  await page.goto("/?v2=1&radio=1");
  const listen = page.getByTestId("radio-mini-listen");
  await expect(listen).toHaveAttribute("href", "https://www.youtube.com/@ScoopFeeds/live");
  await expect(listen).toHaveAttribute("target", "_blank");
});

test("mini-player on mobile sits above the bottom bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, { radioNow: SCHEDULE("https://www.youtube.com/watch?v=abcDEF12345") });
  await page.goto("/?v2=1&radio=1");
  const bar = await page.getByTestId("radio-mini-player").boundingBox();
  const nav = await page.getByTestId("v2-bottom-bar").boundingBox();
  expect(bar.y + bar.height).toBeLessThanOrEqual(nav.y + 1);
});
