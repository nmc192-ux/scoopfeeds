import { test, expect } from "@playwright/test";

// Issue #271: the weekly quiz "Did you scoop it?" — Originals card and /originals/quiz (v2 gate).

const QUIZ = {
  week_start: "2026-10-26",
  disclosure: "Questions written by AI from our dossiers. Each answer links to the reports it came from.",
  questions: [1, 2, 3, 4, 5].map((i) => ({
    q: `Which mayor backed the Riverton${i} tram line?`,
    choices: [`Alba${i}`, "Brookfield", "Castellan", "Dunmore"],
    answer: 0,
    event: { slug: `riverton-${i}`, title: `Riverton${i} tram line` },
  })),
};

async function mockApi(page, { v2 = true, quiz = QUIZ } = {}) {
  await page.route("**/api/**", (r) => {
    const url = r.request().url();
    if (url.includes("/api/site-config")) return r.fulfill({ json: { marketOdds: false, v2 } });
    if (url.includes("/api/originals/quiz")) {
      return quiz ? r.fulfill({ json: quiz }) : r.fulfill({ status: 404, json: { error: "No quiz this week" } });
    }
    if (url.includes("/api/originals")) {
      return r.fulfill({ json: { analysis: [], stories: [], explained: [], quiz: quiz ? { week_start: quiz.week_start, count: quiz.questions.length } : null } });
    }
    if (url.includes("/api/briefs")) return r.fulfill({ json: { items: [] } });
    return r.fulfill({ json: {} });
  });
  await page.addInitScript(() => localStorage.setItem("khabari-store",
    JSON.stringify({ state: { onboardingComplete: true }, version: 2 })));
}

test("Originals shows the quiz card when a quiz is published", async ({ page }, info) => {
  await mockApi(page);
  await page.goto("/originals");
  const card = page.getByTestId("originals-quiz-card");
  await expect(card.getByRole("heading", { name: "Did you scoop it?" })).toBeVisible();
  await expect(card).toContainText("5 questions on this week's news");
  await expect(card.getByRole("link")).toHaveAttribute("href", "/originals/quiz");
  await page.screenshot({ path: info.outputPath("originals-quiz-card.png"), fullPage: true });
});

test("no quiz → no card on Originals", async ({ page }) => {
  await mockApi(page, { quiz: null });
  await page.goto("/originals");
  await expect(page.getByRole("heading", { name: "Originals", level: 1 })).toBeVisible();
  await expect(page.getByTestId("originals-quiz-card")).toHaveCount(0);
});

test("quiz: answer, see right/wrong with a dossier link, finish with a score", async ({ page }, info) => {
  await mockApi(page);
  await page.goto("/originals/quiz");
  const main = page.getByTestId("originals-quiz-page");
  await expect(main.getByRole("heading", { name: "Did you scoop it?", level: 1 })).toBeVisible();
  await expect(page.getByTestId("quiz-disclosure")).toHaveText(QUIZ.disclosure);
  const qs = page.getByTestId("quiz-question");
  await expect(qs).toHaveCount(5);
  await qs.nth(0).getByRole("button", { name: "Alba1" }).click();
  await expect(qs.nth(0)).toContainText("Right.");
  await expect(qs.nth(0).getByRole("link", { name: "Read the dossier" })).toHaveAttribute("href", "/events/riverton-1");
  await qs.nth(1).getByRole("button", { name: "Castellan" }).click();
  await expect(qs.nth(1)).toContainText("Not quite. The answer is Alba2.");
  await page.screenshot({ path: info.outputPath("quiz-answered.png"), fullPage: true });
  for (let i = 2; i < 5; i++) await qs.nth(i).getByRole("button", { name: `Alba${i + 1}` }).click();
  await expect(page.getByTestId("quiz-score")).toContainText("You scored 4 out of 5");
  await page.screenshot({ path: info.outputPath("quiz-end.png"), fullPage: true });
});

test("quiz API 404 → header and a link back to Originals only", async ({ page }) => {
  await mockApi(page, { quiz: null });
  await page.goto("/originals/quiz");
  const main = page.getByTestId("originals-quiz-page");
  await expect(main.getByRole("heading", { name: "Did you scoop it?", level: 1 })).toBeVisible();
  await expect(main.getByRole("link", { name: "Originals" })).toHaveAttribute("href", "/originals");
  await expect(page.getByTestId("quiz-question")).toHaveCount(0);
  await expect(page.getByTestId("quiz-disclosure")).toHaveCount(0);
});

test("flag off: /originals/quiz lands on /briefs", async ({ page }) => {
  await mockApi(page, { v2: false });
  await page.goto("/originals/quiz");
  await expect(page).toHaveURL(/\/briefs$/);
});
