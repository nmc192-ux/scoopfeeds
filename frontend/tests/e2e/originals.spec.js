import { test, expect } from "@playwright/test";

// Issue #260: /originals under the v2 gate; earn-rendered shelves.

const DATA = {
  analysis: [{ slug: "brief-a", title: "Why the ceasefire held", thesis: "Three reasons, each sourced.", published_at: Date.now() }],
  stories: [{ slug: "film-a", title: "The water war nobody covers", youtube_id: "abc123XYZ", published_at: Date.now() }],
  explained: [],
};

async function mockApi(page, v2, originals = DATA) {
  await page.route("**/api/**", (r) => {
    const url = r.request().url();
    if (url.includes("/api/site-config")) return r.fulfill({ json: { marketOdds: false, v2 } });
    if (url.includes("/api/originals")) return r.fulfill({ json: originals });
    if (url.includes("/api/briefs")) return r.fulfill({ json: { items: [] } });
    return r.fulfill({ json: {} });
  });
  // Thumbnails are external; keep the run offline (a failed thumbnail is hidden, not a broken box).
  await page.route("https://i.ytimg.com/**", (r) => r.fulfill({ status: 404, body: "" }));
  await page.addInitScript(() => localStorage.setItem("khabari-store",
    JSON.stringify({ state: { onboardingComplete: true }, version: 2 })));
}

test("flag on: shelves with data render, the empty shelf does not", async ({ page }, info) => {
  await mockApi(page, true);
  await page.goto("/originals");
  const main = page.getByTestId("originals-page");
  await expect(main.getByRole("heading", { name: "Originals", level: 1 })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Latest analysis" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "ScoopFeeds Stories" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Explained" })).toHaveCount(0);
  await expect(main.getByRole("link", { name: /Why the ceasefire held/ })).toHaveAttribute("href", "/briefs/brief-a");
  await expect(main.getByRole("link", { name: /The water war/ })).toHaveAttribute("href", "https://www.youtube.com/watch?v=abc123XYZ");
  await page.screenshot({ path: info.outputPath("originals-v2.png"), fullPage: true });
});

test("flag on: all shelves empty → header only", async ({ page }) => {
  await mockApi(page, true, { analysis: [], stories: [], explained: [] });
  await page.goto("/originals");
  const main = page.getByTestId("originals-page");
  await expect(main.getByRole("heading", { name: "Originals", level: 1 })).toBeVisible();
  await expect(main.locator("section")).toHaveCount(0);
});

test("flag off: /originals lands on /briefs", async ({ page }) => {
  await mockApi(page, false);
  await page.goto("/originals");
  await expect(page).toHaveURL(/\/briefs$/);
});

// Issue #272: "By the numbers" shelf, earn-rendered.
const NUMBERS = [
  { day: "2026-10-27", number_text: "1,200", fact_text: "About 1,200 port staff joined the strike, the union said.",
    sources: [{ source_name: "Outlet A", url: "https://a.test/1" }, { source_name: "Outlet B", url: "https://b.test/1" }],
    event: { slug: "port-strike", title: "Port strike" } },
  { day: "2026-10-26", number_text: "3.5%", fact_text: "Prices rose 3.5% last year.", sources: [], event: { slug: "prices", title: "Prices" } },
];

test("flag on: By the numbers shows today's number, its sources, the dossier link and earlier days", async ({ page }, info) => {
  await mockApi(page, true, { ...DATA, numbers: NUMBERS });
  await page.goto("/originals");
  const main = page.getByTestId("originals-page");
  await expect(main.getByRole("heading", { name: "By the numbers" })).toBeVisible();
  await expect(main.getByTestId("numbers-note")).toContainText("at least two outlets");
  const today = main.getByTestId("numbers-today");
  await expect(today).toContainText("1,200");
  await expect(today.getByRole("link", { name: "Outlet A" })).toHaveAttribute("href", "https://a.test/1");
  await expect(today.getByRole("link", { name: "Read the dossier" })).toHaveAttribute("href", "/events/port-strike");
  await expect(main.getByTestId("numbers-earlier")).toContainText("3.5%");
  await page.screenshot({ path: info.outputPath("originals-numbers.png"), fullPage: true });
});

test("flag on: no numbers → no By the numbers shelf", async ({ page }) => {
  await mockApi(page, true, { ...DATA, numbers: [] });
  await page.goto("/originals");
  await expect(page.getByTestId("originals-page").getByRole("heading", { name: "Latest analysis" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "By the numbers" })).toHaveCount(0);
});
