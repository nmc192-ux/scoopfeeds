import { test, expect } from "@playwright/test";

// #262 — /gaps ships dark behind ?gaps=1 (or VITE_COVERAGE_GAPS=true). Measured by region.
const METHOD = {
  buckets: [{ id: "US", label: "US" }, { id: "UK", label: "UK" }],
  minPresent: 4, minBase: 5, unknownShare: 0.31, bases: { US: 40, UK: 12 },
};
const DAILY = {
  measured_by: "region", method: METHOD,
  items: [{ slug: "farm-bill", title: "Senate passes the farm bill",
            present: { bucket: "US", outlets: 9 }, absent: { bucket: "UK", activeBase: 12 }, score: 0.225 }],
};

async function setup(page, { daily = DAILY, weekly = null } = {}) {
  await page.route("**/api/**", r => r.fulfill({ json: {} }));
  await page.route("**/api/site-config", r => r.fulfill({ json: { marketOdds: false, v2: false } }));
  await page.route("**/api/ri/gaps/daily", r => r.fulfill({ json: daily }));
  await page.route("**/api/ri/gaps/weekly", r =>
    weekly ? r.fulfill({ json: weekly }) : r.fulfill({ status: 404, json: { error: "no report" } }));
}

test("without ?gaps=1 the address is a 404", async ({ page }) => {
  await setup(page);
  await page.goto("/gaps");
  await expect(page.getByTestId("coverage-gaps-page")).toHaveCount(0);
  await expect(page.getByText(/page not found/i)).toBeVisible();
});

test("?gaps=1 shows the daily list and the method line, region wording only", async ({ page }) => {
  await setup(page);
  await page.goto("/gaps?gaps=1");
  await expect(page.getByTestId("coverage-gaps-page")).toBeVisible();
  await expect(page.getByTestId("gaps-method")).toContainText("Measured by where outlets publish from. 31% of outlets have no known region and are not counted.");
  await expect(page.getByTestId("gaps-daily")).toContainText("9 of 40 active US outlets covered this. None of 12 active UK outlets did.");
  await expect(page.getByTestId("gaps-weekly")).toHaveCount(0);
  const text = (await page.getByTestId("coverage-gaps-page").innerText()).toLowerCase();
  for (const word of ["left", "right-wing", "liberal", "conservative", "bias"]) expect(text).not.toContain(word);
});

test("empty daily list renders no list; a stored weekly report renders its section", async ({ page }) => {
  await setup(page, { daily: { ...DAILY, items: [] }, weekly: { ...DAILY, week_start: "2026-10-19" } });
  await page.goto("/gaps?gaps=1");
  await expect(page.getByTestId("gaps-daily")).toHaveCount(0);
  await expect(page.getByTestId("gaps-weekly")).toContainText("Gap Report, week of 2026-10-19");
});
