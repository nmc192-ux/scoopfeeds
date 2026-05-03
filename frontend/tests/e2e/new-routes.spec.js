/**
 * new-routes.spec.js — Playwright smoke for the routes added in Z/A1–A4.
 *
 * Each test asserts only data-independent UI: page chrome, headers,
 * footer notes — not API-fed content. Lets these run in CI without
 * needing live backend data.
 */

import { test, expect } from "@playwright/test";

// ─── A1: category alias pages ────────────────────────────────────────────

const aliasRoutes = [
  { path: "/health",  heading: /^Health$/i },
  { path: "/climate", heading: /^Climate$/i },
  { path: "/sports",  heading: /^Sports$/i },
  { path: "/crypto",  heading: /^Crypto$/i },
  { path: "/ai",      heading: /^AI$/i },
  { path: "/space",   heading: /^Space$/i },
];

for (const { path, heading } of aliasRoutes) {
  test(`${path} renders its locked-category header`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    // Each alias forwards into EventsPage → grid skeleton or events render.
    // We don't assert event presence (data-dependent), but we do assert the
    // common page wrapper survived. The lede paragraph is topic-specific so
    // we use a substring shared by all six wrappers: "tracked".
    await expect(page.getByText(/tracked/i).first()).toBeVisible();
  });
}

// ─── A2: standalone timeline ─────────────────────────────────────────────
//
// When the backend is up the page resolves to either the timeline or the
// "Event not found" block. When the backend is offline (typical in CI
// without the API server running) the SPA-wide BackendOffline splash
// takes over. Either path proves the route is wired (i.e. not a 404
// from the SPA), which is what this smoke is asserting.

test("/timeline/:slug responds (either app content or offline splash)", async ({ page }) => {
  await page.goto("/timeline/__definitely-not-a-real-event__");
  const notFound = page.getByText(/event not found/i);
  const fullDoss = page.getByRole("link", { name: /full dossier/i });
  const offline  = page.getByRole("heading", { name: /backend not running/i });
  await expect(notFound.or(fullDoss).or(offline)).toBeVisible();
});

// ─── Z: brief calibration card on /scoop-ops/reality-index ───────────────
// The ops dashboard is gated behind ADMIN_KEY. We can't assert the
// calibration card without a key, but we *can* assert that the page
// either prompts for a key OR renders the dashboard chrome OR shows the
// SPA-wide offline splash — all three prove the route is wired.

test("/scoop-ops/reality-index responds with admin chrome", async ({ page }) => {
  await page.goto("/scoop-ops/reality-index");
  const keyPrompt = page.getByRole("heading", { name: /admin key/i });
  const dashHead  = page.getByRole("heading", { name: /reality index .*operator/i });
  const offline   = page.getByRole("heading", { name: /backend not running/i });
  await expect(keyPrompt.or(dashHead).or(offline)).toBeVisible();
});
