import { test, expect } from "@playwright/test";

// #190 — reader's country first on Today, with a country control in the v2 header.
const now = Date.now();
const ev = (id, title, affinity) => ({
  id, slug: `e${id}`, title, category: "international", severity: 0.5,
  article_count: 3, source_count: 2, status: "active",
  started_at: now - 5 * 60_000, last_activity_at: now - 60_000,
  ...(affinity === undefined ? {} : { country_affinity: affinity }),
});
// What the server returns: prominence order, re-ordered for the country (the server's
// own ordering is covered by backend countryAffinity.test.js; this mocks its output).
const BASE = [
  ev(1, "US lead story"), ev(2, "Second story"), ev(3, "Third story"),
  ev(4, "UK story one"), ev(5, "Fifth story"), ev(6, "UK story two"),
];
function respond(country) {
  if (!country) return BASE;
  const uk = new Set([4, 6]);
  const aff = (e) => (country === "GB" ? (uk.has(e.id) ? 2 : 0) : (e.id === 1 ? 1 : 0));
  const rows = BASE.map((e) => ({ ...e, country_affinity: aff(e) }));
  if (country !== "GB") return rows;
  return [...rows.filter((e) => uk.has(e.id)), ...rows.filter((e) => !uk.has(e.id))];
}

async function setup(page, { v2 = true } = {}) {
  const calls = [];
  // Catch-all first: Playwright tries the most recently added route first.
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/site-config", (r) => r.fulfill({ json: { marketOdds: false, v2 } }));
  await page.route("**/api/geo", (r) => r.fulfill({ json: { data: { countryCode: "US", country: "United States", currency: "USD" } } }));
  await page.route("**/api/ri/events**", (r) => {
    const url = new URL(r.request().url());
    calls.push(url);
    return r.fulfill({ json: { events: respond(url.searchParams.get("country")) } });
  });
  await page.route("**/api/radio/state.json", (r) => r.fulfill({ status: 404, json: {} }));
  await page.addInitScript(() => localStorage.setItem("khabari-store",
    JSON.stringify({ state: { onboardingComplete: true }, version: 2 })));
  return calls;
}

test("flag on: detected US is sent as country=US, in one events request", async ({ page }) => {
  const calls = await setup(page);
  await page.goto("/?v2=1");
  await expect(page.getByTestId("today-lead")).toContainText("US lead story");
  await page.waitForLoadState("networkidle");
  expect(calls.length).toBe(1);
  expect(calls[0].searchParams.get("country")).toBe("US");
});

test("flag on: choosing United Kingdom re-orders Today and survives a reload", async ({ page }) => {
  const calls = await setup(page);
  await page.goto("/?v2=1");
  await expect(page.getByTestId("today-lead")).toContainText("US lead story");

  await page.getByTestId("v2-country").selectOption("GB");
  await expect(page.getByTestId("today-lead")).toContainText("UK story one");
  await expect(page.getByTestId("today-local")).toContainText("From United Kingdom");
  await expect(page.getByTestId("today-local")).toContainText("UK story two");
  expect(calls.at(-1).searchParams.get("country")).toBe("GB");

  // Each story still appears once.
  const ids = await page.locator("[data-testid=today-page] [data-event-id]").evaluateAll(
    (els) => els.map((e) => e.getAttribute("data-event-id")));
  expect(new Set(ids).size).toBe(ids.length);

  await page.reload();
  await expect(page.getByTestId("v2-country")).toHaveValue("GB");
  await expect(page.getByTestId("today-lead")).toContainText("UK story one");
  expect(calls.at(-1).searchParams.get("country")).toBe("GB");
});

test("flag on: Other / worldwide sends no country and shows no From block", async ({ page }) => {
  const calls = await setup(page);
  await page.goto("/?v2=1");
  await page.getByTestId("v2-country").selectOption("WW");
  await expect.poll(() => calls.at(-1).searchParams.has("country")).toBe(false);
  await expect(page.getByTestId("today-lead")).toContainText("US lead story");
  await expect(page.getByTestId("today-local")).toHaveCount(0);
});

test("flag off: no country control, and no country param sent", async ({ page }) => {
  const calls = await setup(page, { v2: false });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Top stories" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("v2-country")).toHaveCount(0);
  expect(calls.length).toBeGreaterThan(0);
  for (const u of calls) expect(u.searchParams.has("country")).toBe(false);
});

for (const [w, h] of [[390, 844], [1440, 900]]) {
  test(`screenshot ${w}px, United Kingdom`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await setup(page);
    await page.addInitScript(() => localStorage.setItem("scoop.geo.override",
      JSON.stringify({ countryCode: "GB", country: "United Kingdom" })));
    await page.goto("/?v2=1");
    await expect(page.getByTestId("today-local")).toBeVisible();
    await page.screenshot({ path: `test-results/location-${w}.png`, fullPage: true });
  });
}
