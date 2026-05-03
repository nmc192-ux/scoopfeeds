import { test, expect } from "@playwright/test";

test("/predictions renders the Reality Index hero + at least the controls", async ({ page }) => {
  await page.goto("/predictions");
  // h1 text comes from COPY.panelTitle(t) = "Reality Index"
  await expect(page.getByRole("heading", { name: /reality index/i })).toBeVisible();
  // brandTagline is always rendered in the subtitle, backend-independent
  await expect(page.getByText(/data-backed estimate, not a certainty/i)).toBeVisible();
});

test("/events renders the event tracker hero", async ({ page }) => {
  await page.goto("/events");
  // h1 is the literal string "Event Tracker"
  await expect(page.getByRole("heading", { name: /event tracker/i })).toBeVisible();
});

test("/world-map renders the map page hero", async ({ page }) => {
  await page.goto("/world-map");
  // h1 is the literal string "World Map"
  await expect(page.getByRole("heading", { name: /world map/i })).toBeVisible();
  // Footer note is always present regardless of data state
  await expect(page.getByText(/equirectangular projection/i)).toBeVisible();
});
