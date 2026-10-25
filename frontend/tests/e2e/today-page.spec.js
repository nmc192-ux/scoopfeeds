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
