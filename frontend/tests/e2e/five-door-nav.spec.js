import { test, expect } from "@playwright/test";

// Issue #173: five-door navigation behind the v2 flag.

async function mockApi(page, v2) {
  await page.route("**/api/**", (r) => {
    const url = r.request().url();
    if (url.includes("/api/site-config")) return r.fulfill({ json: { marketOdds: false, v2 } });
    return r.fulfill({ json: {} });
  });
}

const DOORS = [
  ["Today", "/"], ["News", "/events"], ["Originals", "/originals"],
  ["Markets", "/markets"], ["Watch & Listen", "/live-tv"],
];

test("flag off: the old header renders and the new chrome does not", async ({ page }) => {
  await mockApi(page, false);
  await page.goto("/");
  await expect(page.getByTestId("v2-header")).toHaveCount(0);
  await expect(page.getByTestId("v2-footer")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Scoopfeeds — Home" })).toBeVisible();
});

test("flag off: old addresses still render their own pages", async ({ page }) => {
  await mockApi(page, false);
  await page.goto("/health");
  await expect(page).toHaveURL(/\/health$/);
  await page.goto("/analysis");
  await expect(page).toHaveURL(/\/analysis$/);
});

test("flag on: five doors, chips and footer groups are real links", async ({ page }) => {
  await mockApi(page, true);
  await page.goto("/");
  const header = page.getByTestId("v2-header");
  await expect(header).toBeVisible();
  for (const [label, href] of DOORS) {
    await expect(header.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", href);
  }
  await expect(header.getByRole("link", { name: /language|translate/i })).toHaveCount(0);
  for (const chip of ["All", "World", "Business", "Tech & AI", "Health", "Climate", "Science & Space", "Sports", "Crypto"]) {
    await expect(header.getByRole("link", { name: chip, exact: true })).toBeVisible();
  }
  const footer = page.getByTestId("v2-footer");
  for (const group of ["Read", "Data", "Watch & Listen", "About"]) {
    await expect(footer.getByRole("heading", { name: group })).toBeVisible();
  }
  await expect(footer.getByRole("link", { name: "Sources" })).toHaveAttribute("href", "/about#sources");
});

test("flag on: ?v2=1 turns it on and is remembered for the session", async ({ page }) => {
  await mockApi(page, false);
  await page.goto("/?v2=1");
  await expect(page.getByTestId("v2-header")).toBeVisible();
  await page.goto("/about");
  await expect(page.getByTestId("v2-header")).toBeVisible();
});

const REDIRECTS = [
  ["/health", /\/topic\/health$/], ["/climate", /\/topic\/environment$/], ["/sports", /\/topic\/sports$/],
  ["/ai", /\/topic\/ai$/], ["/space", /\/topic\/science$/],
  ["/finance", /\/markets\?tab=finance$/], ["/macro", /\/markets\?tab=macro$/],
  ["/predictions", /\/markets\?tab=predictions$/], ["/truth-gap", /\/markets\?tab=truth-gap$/],
  ["/world-map", /\/markets\?tab=world-map$/],
  ["/analysis", /\/briefs$/], ["/dashboard", /\/saved$/],
  ["/timeline/some-event", /\/events\/some-event#timeline$/],
  ["/sources", /\/about#sources$/], ["/live", /\/live-tv$/],
];

for (const [from, to] of REDIRECTS) {
  test(`flag on: ${from} redirects and renders with the new header`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await mockApi(page, true);
    await page.goto(from);
    await expect(page).toHaveURL(to);
    await expect(page.getByTestId("v2-header")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

for (const [label, path] of DOORS) {
  test(`flag on: door ${label} (${path}) renders with the new header`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await mockApi(page, true);
    await page.goto(path);
    await expect(page.getByTestId("v2-header")).toBeVisible();
    await expect(page.getByTestId("v2-header").getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    expect(errors).toEqual([]);
  });
}

test("flag on, phone: bottom bar has five doors with 44px targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, true);
  await page.goto("/");
  const bar = page.getByTestId("v2-bottom-bar");
  await expect(bar).toBeVisible();
  const links = bar.getByRole("link");
  await expect(links).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    const box = await links.nth(i).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByTestId("v2-header").getByRole("link", { name: "Scoopfeeds — Home" })).toBeVisible();
});

test("flag on: a saved non-English language is reset to English (v2 has no switch)", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("khabari-store", JSON.stringify({ state: { language: "ur" }, version: 2 }));
  });
  await mockApi(page, true);
  await page.goto("/");
  await expect(page.getByTestId("v2-header")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});

test("flag on: footer Data group links to Weather, not a second Markets link", async ({ page }) => {
  await mockApi(page, true);
  await page.goto("/");
  const footer = page.getByTestId("v2-footer");
  await expect(footer.getByRole("link", { name: "Weather", exact: true })).toHaveAttribute("href", "/weather");
  await expect(footer.getByRole("link", { name: "World map" })).toHaveCount(0);
});
