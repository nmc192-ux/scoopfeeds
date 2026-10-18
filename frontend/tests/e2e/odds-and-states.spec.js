import { test, expect } from "@playwright/test";

const eventWithOdds = {
  id: 1, slug: "e1", title: "An event with market data", category: "international",
  severity: 0.5, article_count: 4, source_count: 3, market_count: 1,
  top_probability: 0.62, truth_gap: 0.4, status: "active",
  started_at: Date.now() - 1000, last_activity_at: Date.now(),
};

async function mockEvents(page) {
  await page.route("**/api/ri/events**", r =>
    r.fulfill({ json: { events: [eventWithOdds, { ...eventWithOdds, id: 2, slug: "e2" }, { ...eventWithOdds, id: 3, slug: "e3" }] } }));
}

test("SITE_MARKET_ODDS unset: no probability or Truth Gap on the homepage", async ({ page }) => {
  await page.route("**/api/site-config", r => r.fulfill({ json: { marketOdds: false, v2: false } }));
  await mockEvents(page);
  await page.goto("/");
  await expect(page.getByText("An event with market data").first()).toBeVisible();
  await expect(page.getByText(/market probability/i)).toHaveCount(0);
  await expect(page.getByText(/media > markets|truth gap/i)).toHaveCount(0);
});

test("SITE_MARKET_ODDS unset: a failed site-config still hides odds", async ({ page }) => {
  await page.route("**/api/site-config", r => r.abort());
  await mockEvents(page);
  await page.goto("/");
  await expect(page.getByText("An event with market data").first()).toBeVisible();
  await expect(page.getByText(/market probability/i)).toHaveCount(0);
});

test("odds-only pages send readers home while the flag is off", async ({ page }) => {
  await page.route("**/api/site-config", r => r.fulfill({ json: { marketOdds: false, v2: false } }));
  await mockEvents(page);
  await page.goto("/truth-gap");
  await expect(page).toHaveURL(/\/$/);
});

test("a slow endpoint shows the skeleton, then a Retry line at 10 s", async ({ page }) => {
  await page.clock.install();
  await page.route("**/api/site-config", r => r.fulfill({ json: { marketOdds: false, v2: true } }));
  await page.route("**/api/ri/events**", () => { /* never answers */ });
  await page.goto("/");
  await expect(page.locator(".animate-pulse").first()).toBeVisible();
  await expect(page.getByTestId("timeout-notice")).toHaveCount(0);
  await page.clock.fastForward(10_500);
  await expect(page.getByTestId("timeout-notice").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" }).first()).toBeVisible();
});

test("/markets shows the Retry line instead of an endless spinner", async ({ page }) => {
  await page.clock.install();
  await page.route("**/api/market", () => { /* never answers */ });
  await page.goto("/markets");
  await page.clock.fastForward(10_500);
  await expect(page.getByTestId("timeout-notice")).toBeVisible();
});

test("homepage: a topic band with fewer than 3 stories does not render", async ({ page }) => {
  await page.route("**/api/site-config", r => r.fulfill({ json: { marketOdds: false, v2: false } }));
  await page.route("**/api/ri/events**", r => {
    const url = new URL(r.request().url());
    const cat = url.searchParams.get("category");
    if (cat === "politics") return r.fulfill({ json: { events: [{ ...eventWithOdds, id: 9, slug: "p1", title: "Lone politics story" }] } });
    return r.fulfill({ json: { events: [eventWithOdds, { ...eventWithOdds, id: 2, slug: "e2" }, { ...eventWithOdds, id: 3, slug: "e3" }] } });
  });
  await page.goto("/");
  await expect(page.getByText("Lone politics story")).toHaveCount(0);
  await expect(page.getByText(/entertainment is on the way/i)).toHaveCount(0);
});
