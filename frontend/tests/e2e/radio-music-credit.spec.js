// radio-music-credit.spec.js — #208: during a music break both radio screens show a small
// "Music: Artist – Track" credit (a standard music credit, not an AI label), and none when the
// bed has no credit (the procedural fallback). Loads the screens straight from disk.
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN_DIR = path.resolve(HERE, "../../../backend/src/radio/screen");
const RADIO = pathToFileURL(path.join(SCREEN_DIR, "scoopfeeds-radio-screen.html")).href;
const PROGRAMME = pathToFileURL(path.join(SCREEN_DIR, "scoopfeeds-radio-programme.html")).href;
const CREDIT = "Music: Kevin Example – Calm River";

test("24/7 screen: the playout's credit shows on the music scene, and clears", async ({ page }) => {
  await page.goto(`${RADIO}?broadcast=1`);
  await page.evaluate(() => window.ScoopRadio.set({ sample: false, updatedAt: Date.now(), headline: "A headline", music: [{ cat: "World", h: "A story", src: "Reported by Reuters" }] }));
  await page.evaluate(() => window.ScoopRadio.scene("music"));
  await page.evaluate((c) => window.setMusicCredit(c), CREDIT);
  await expect(page.locator("#musicCredit")).toBeVisible();
  await expect(page.locator("#musicCredit")).toHaveText(CREDIT);
  await page.evaluate(() => window.setMusicCredit(null));
  await expect(page.locator("#musicCredit")).toBeHidden();
});

test("programme screen: a music cue's credit shows; a cue without one shows none", async ({ page }) => {
  await page.goto(`${PROGRAMME}?broadcast=1`);
  const H = Date.UTC(2026, 9, 30, 16);
  await page.evaluate(({ H, CREDIT }) => {
    window.ScoopProgramme.set({ builtAt: 1, hourStart: H, endsAt: H + 3630_000, headlines: [{ h: "A headline", src: "Reuters" }],
      cues: [{ at: H, scene: "music", data: { credit: CREDIT } }, { at: H + 60_000, scene: "music", data: {} }] });
    window.ScoopProgramme.renderAt(H + 1000);
  }, { H, CREDIT });
  await expect(page.locator("#musicCredit")).toBeVisible();
  await expect(page.locator("#musicCredit")).toHaveText(CREDIT);
  await page.evaluate((t) => window.ScoopProgramme.renderAt(t), H + 61_000);
  await expect(page.locator("#musicCredit")).toBeHidden();
});
