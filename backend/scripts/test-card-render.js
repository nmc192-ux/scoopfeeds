// Render-test script — generates a few sample cards (with and without
// stock-photo backgrounds) so we can eyeball the new design before pushing.
//
// Usage:
//   cd backend && node --require ./load-env.cjs scripts/test-card-render.js
//
// Output drops into backend/data/cards-test/ — open them in Preview.
//
// If PEXELS_API_KEY is set in backend/.env, you'll get the photo-backed
// variants too. Otherwise only the typographic ones.

import path from "path";
import { fileURLToPath } from "url";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { ensureCard, isCardRendererReady } from "../src/services/cardRenderer.js";
import { isStockPhotoEnabled } from "../src/services/stockPhoto.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "data", "cards-test");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const SAMPLES = [
  {
    id: "sample-politics-mandelson",
    title: "Key figure in Mandelson vetting row will not appear to give evidence",
    description: "The Foreign Affairs Committee says Ian Collard will only be giving evidence in writing.",
    category: "politics",
    source_name: "BBC",
    published_at: Date.now() - 2 * 60 * 60 * 1000,
    tags: ["uk politics", "parliament", "investigation"],
  },
  {
    id: "sample-ai-openai",
    title: "OpenAI says GPT-5 cuts hallucination rate by 80% in safety benchmarks",
    description: "The new model reportedly closes a long-standing accuracy gap on adversarial prompts.",
    category: "ai",
    source_name: "Reuters",
    published_at: Date.now() - 30 * 60 * 1000,
    tags: ["artificial intelligence", "openai", "machine learning"],
  },
  {
    id: "sample-sports-villa",
    title: "Villa were not 'clinical' against Fulham — Emery",
    description: "Aston Villa manager Unai Emery says his side had 'good chances' to score against Fulham.",
    category: "sports",
    source_name: "BBC Sport",
    published_at: Date.now() - 6 * 60 * 60 * 1000,
    tags: ["football", "premier league", "aston villa"],
  },
  {
    id: "sample-environment-orangutan",
    title: "Watch: How one orangutan braved a new bridge to unite his split community",
    description: "The forest where the Sumatran orangutans live has been split by a road.",
    category: "environment",
    source_name: "BBC",
    published_at: Date.now() - 12 * 60 * 60 * 1000,
    tags: ["wildlife", "conservation", "indonesia"],
  },
  {
    id: "sample-international-housing",
    title: "New Taxes Helped Cool London's Housing Market. Could That Happen in New York?",
    description: "Economists and real estate agents are calling London's taxation of wealthy property owners a cautionary tale.",
    category: "international",
    source_name: "NYT",
    published_at: Date.now() - 4 * 60 * 60 * 1000,
    tags: ["housing", "real estate", "london"],
  },
];

(async () => {
  if (!isCardRendererReady()) {
    console.error("Card renderer not ready (fonts missing)");
    process.exit(1);
  }
  console.log(`Stock photos: ${isStockPhotoEnabled() ? "ENABLED (Pexels)" : "DISABLED (no PEXELS_API_KEY)"}`);
  console.log(`Output dir: ${OUT_DIR}\n`);

  for (const article of SAMPLES) {
    const start = Date.now();
    try {
      // Force fresh render every run by varying the article ID with a timestamp suffix.
      const variantArticle = { ...article, id: `${article.id}-${Date.now()}` };
      const out = await ensureCard(variantArticle, "og");
      const dest = path.join(OUT_DIR, `${article.id}-og.png`);
      writeFileSync(dest, out.buffer);
      const ms = Date.now() - start;
      console.log(`✓ ${article.category.padEnd(14)} ${out.withPhoto ? "📷" : "  "} ${ms}ms  ${article.title.slice(0, 60)}`);
    } catch (e) {
      console.error(`✗ ${article.category}: ${e.message}`);
    }
  }
  console.log(`\nDone. Open ${OUT_DIR} in Finder to compare.`);
})();
