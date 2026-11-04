import { test, expect } from "@playwright/test";

// #327 — the News page at `/news` under SITE_V2, replacing /events and the six category pages.
const now = Date.now();
const DAY = 86_400_000;
const ev = (id, extra = {}) => ({
  id, slug: `e${id}`, title: `Story number ${id}`, category: "politics",
  severity: 0.5, article_count: 4, source_count: 3, status: "active",
  started_at: now - 2 * 60_000, last_activity_at: now - 60_000, ...extra,
});
const ACTIVE = [
  ev(1, { title: "Brand new live", started_at: now - 2 * 60_000, last_activity_at: now - 60_000 }),
  ev(2, { title: "Two days old", started_at: now - 2 * DAY, last_activity_at: now - 5 * 3_600_000 }),
  ev(3, { title: "Month-long saga", started_at: now - 30 * DAY, last_activity_at: now - 3_600_000 * 3 }),
  ev(3, { title: "Month-long saga", started_at: now - 30 * DAY, last_activity_at: now - 3_600_000 * 3 }), // duplicate id
];
const DORMANT = [
  ev(10, { title: "Quiet old story", status: "dormant", started_at: now - 12 * DAY, last_activity_at: now - 9 * DAY }),
];
const TRACKERS = [{
  id: "t1", template_type: "election", status: "active", last_updated_at: now,
  data_source_provenance: "official", headline: "Tracker headline",
}];

async function setup(page, { v2 = true, active = ACTIVE, dormant = DORMANT, trackers = TRACKERS } = {}) {
  const events = [];
  const trackerCalls = [];
  // Catch-all first (Playwright tries the most recently added route first).
  await page.route("**/api/**", r => r.fulfill({ json: {} }));
  await page.route("**/api/site-config", r => r.fulfill({ json: { marketOdds: false, v2 } }));
  await page.route("**/api/ri/events**", r => {
    const url = r.request().url();
    if (/\/api\/ri\/events\/[^?]/.test(url)) return r.fulfill({ json: {} });
    events.push(url);
    return r.fulfill({ json: { events: url.includes("status=dormant") ? dormant : active } });
  });
  await page.route("**/api/ri/trackers**", r => { trackerCalls.push(r.request().url()); return r.fulfill({ json: { trackers } }); });
  return { events, trackerCalls };
}

test("flag off: /events is the classic page, /crypto the crypto page, /news goes to /events", async ({ page }) => {
  await setup(page, { v2: false });
  await page.goto("/events");
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.getByTestId("news-page")).toHaveCount(0);
  await page.goto("/crypto");
  await expect(page).toHaveURL(/\/crypto$/);
  await expect(page.getByRole("heading", { level: 1, name: "Crypto" })).toBeVisible();
  await page.goto("/news");
  await expect(page).toHaveURL(/\/events$/);
});

test("flag on: /events goes to /news, /health to /news?topic=health with the chip selected", async ({ page }) => {
  await setup(page);
  await page.goto("/events?v2=1");
  await expect(page).toHaveURL(/\/news/);
  await page.goto("/health?v2=1");
  await expect(page).toHaveURL(/\/news\?.*topic=health/);
  await expect(page.getByRole("button", { name: "Health", pressed: true })).toBeVisible();
});

test("flag on: four groups, each event once, 2 events requests and 1 trackers request", async ({ page }) => {
  const { events, trackerCalls } = await setup(page);
  await page.goto("/news?v2=1");
  await expect(page.getByTestId("news-developing")).toContainText("Two days old");
  await expect(page.getByTestId("news-long-running")).toContainText("Month-long saga");
  await expect(page.getByTestId("news-long-running")).toContainText("day 31");
  await expect(page.getByTestId("news-settled")).toContainText("Quiet old story");
  await expect(page.getByTestId("news-trackers")).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);

  const ids = await page.locator("[data-testid=news-card]").evaluateAll(els => els.map(e => e.getAttribute("data-event-id")));
  expect(ids.length).toBe(4);
  expect(new Set(ids).size).toBe(ids.length);

  // "Live" red only on the event active in the last hour.
  await expect(page.getByTestId("live-badge")).toHaveCount(1);
  await expect(page.locator('[data-event-id="1"] [data-testid=live-badge]')).toHaveCount(1);

  await page.waitForLoadState("networkidle");
  expect(events.length).toBe(2);
  expect(trackerCalls.length).toBe(1);

  // No odds, no probability, no price.
  const text = await page.getByTestId("news-page").innerText();
  expect(text).not.toMatch(/probabilit|market|odds|¢|%/i);
});

test("flag on: an empty dormant response leaves no Settled heading", async ({ page }) => {
  await setup(page, { dormant: [] });
  await page.goto("/news?v2=1");
  await expect(page.getByTestId("news-developing")).toBeVisible();
  await expect(page.getByTestId("news-settled")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Settled" })).toHaveCount(0);
});

test("flag on: nothing at all shows the honest empty copy and no group", async ({ page }) => {
  await setup(page, { active: [], dormant: [], trackers: [] });
  await page.goto("/news?v2=1");
  await expect(page.getByText("No active events yet")).toBeVisible();
  await expect(page.locator("[data-testid^=news-]:not([data-testid=news-page])")).toHaveCount(0);
});

for (const [w, h] of [[390, 844], [1440, 900]]) {
  test(`screenshot ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.addInitScript(() => localStorage.setItem("khabari-store",
      JSON.stringify({ state: { onboardingComplete: true }, version: 2 })));
    await setup(page);
    await page.goto("/news?v2=1");
    await expect(page.getByTestId("news-developing")).toBeVisible();
    await page.screenshot({ path: `test-results/news-${w}.png`, fullPage: true });
  });
}
