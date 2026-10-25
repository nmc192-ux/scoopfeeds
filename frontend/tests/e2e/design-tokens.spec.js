import { test, expect } from "@playwright/test";

// Issue #188: one set of tokens and fonts for the site and Radio, applied to every
// page under the v2 flag (not just the header). Flag off: the site is unchanged.

async function mockApi(page, v2) {
  await page.route("**/api/**", (r) => {
    const url = r.request().url();
    if (url.includes("/api/site-config")) return r.fulfill({ json: { marketOdds: false, v2 } });
    return r.fulfill({ json: {} });
  });
}

const PAPER = "rgb(244, 239, 230)";
const INK = "rgb(9, 7, 6)";

const styleOf = (loc) => loc.evaluate((el) => {
  const cs = getComputedStyle(el);
  return { bg: cs.backgroundColor, color: cs.color, font: cs.fontFamily };
});

// The store's dark mode defaults to the OS preference; pin light for these checks.
const forceLight = (page) => page.emulateMedia({ colorScheme: "light" });

test("flag off: old fonts and colours, no v2 class, no new base", async ({ page }) => {
  await forceLight(page);
  await mockApi(page, false);
  await page.goto("/about");
  await expect(page.locator("main")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.classList.contains("sf-v2"))).toBe(false);
  const body = await styleOf(page.locator("body"));
  expect(body.font).toContain("Inter");
  expect(body.bg).not.toBe(PAPER);
  // the old font stylesheet still loads for the flag-off site
  await expect(page.locator('link[href*="Bebas+Neue"][href*="Inter"]')).toHaveCount(1);
});

test("flag on: body, header and a page body take the shared tokens", async ({ page }) => {
  await forceLight(page);
  await mockApi(page, true);
  await page.goto("/about");
  await expect(page.getByTestId("v2-header")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("sf-v2"))).toBe(true);

  // body and the app root fade their colours over 0.3 s, so wait for the transition to settle
  await expect.poll(async () => (await styleOf(page.locator("body"))).bg).toBe(PAPER);
  await expect.poll(async () => (await styleOf(page.locator("body"))).color).toBe(INK);
  const body = await styleOf(page.locator("body"));
  expect(body.font).toContain("Schibsted Grotesk");

  const header = await styleOf(page.getByTestId("v2-header"));
  expect(header.bg).toBe(INK);
  expect(header.color).toBe(PAPER);

  // the app root paints the page, so it must be paper too
  await expect.poll(async () => (await styleOf(page.locator("#root > div").first())).bg).toBe(PAPER);

  // reading text in a page body is Newsreader
  const para = page.locator("main p").first();
  await expect(para).toBeVisible();
  expect((await styleOf(para)).font).toContain("Newsreader");

  // fonts come from index.html once; the header no longer injects its own link
  await expect(page.locator('link[href*="Schibsted+Grotesk"]')).toHaveCount(1);
  await expect(page.locator("link[data-v2-fonts]")).toHaveCount(0);
});

test("flag on: the display face (--font-display, Tailwind font-display) is Anton; Bebas Neue with the flag off", async ({ page }) => {
  await forceLight(page);
  for (const [v2, face] of [[false, "Bebas Neue"], [true, "Anton"]]) {
    await mockApi(page, v2);
    await page.goto("/about");
    await expect(page.locator("main")).toBeVisible();
    if (v2) await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("sf-v2"))).toBe(true);
    const fam = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-display"));
    expect(fam).toContain(face);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});
