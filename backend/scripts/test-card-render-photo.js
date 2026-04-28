// Photo-mode render test — uses a real Pexels CDN image to verify the
// composite pipeline (photo + scrim + accent + content) without needing a
// PEXELS_API_KEY. Validates the most important visual change end-to-end.
//
// Usage:
//   cd backend && node --require ./load-env.cjs scripts/test-card-render-photo.js

import path from "path";
import { fileURLToPath } from "url";
import { writeFileSync, readFileSync, mkdirSync, existsSync, copyFileSync } from "fs";
import { ensureCard } from "../src/services/cardRenderer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "data", "cards-test");
const STOCK_DIR = path.join(__dirname, "..", "data", "stock-photos");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
if (!existsSync(STOCK_DIR)) mkdirSync(STOCK_DIR, { recursive: true });

// Force the stockPhoto module to think it's enabled. ensureCard checks
// `isStockPhotoEnabled()` which reads PEXELS_API_KEY at call time — set it
// to a sentinel so the photo path is taken; we'll pre-populate the cache
// so no real API call fires.
process.env.PEXELS_API_KEY = "test-synthetic";

const SAMPLE_JPG = "/tmp/test-pexels.jpg";
if (!existsSync(SAMPLE_JPG)) {
  console.error(`Missing ${SAMPLE_JPG} — run:`);
  console.error(`  curl -L -o /tmp/test-pexels.jpg "https://images.pexels.com/photos/267885/pexels-photo-267885.jpeg?auto=compress&cs=tinysrgb&w=1880"`);
  process.exit(1);
}

const SAMPLES = [
  {
    id: "photosynth-politics",
    title: "Key figure in Mandelson vetting row will not appear to give evidence",
    description: "The Foreign Affairs Committee says Ian Collard will only be giving evidence in writing.",
    category: "politics",
    source_name: "BBC",
    published_at: Date.now(),
    tags: ["uk politics"],
  },
  {
    id: "photosynth-ai",
    title: "OpenAI says GPT-5 cuts hallucination rate by 80% in safety benchmarks",
    description: "The new model reportedly closes a long-standing accuracy gap on adversarial prompts.",
    category: "ai",
    source_name: "Reuters",
    published_at: Date.now(),
    tags: ["ai"],
  },
  {
    id: "photosynth-sports",
    title: "Villa were not 'clinical' against Fulham — Emery",
    description: "Aston Villa manager Unai Emery says his side had 'good chances' to score against Fulham.",
    category: "sports",
    source_name: "BBC Sport",
    published_at: Date.now(),
    tags: ["sports"],
  },
  {
    id: "photosynth-environment",
    title: "How one orangutan braved a new bridge to unite his split community",
    description: "The forest where the Sumatran orangutans live has been split by a road.",
    category: "environment",
    source_name: "BBC",
    published_at: Date.now(),
    tags: ["wildlife"],
  },
];

(async () => {
  console.log("Photo-mode render test (using pre-fetched Pexels sample)\n");

  for (const article of SAMPLES) {
    // Pre-populate the stock-photo cache so getStockPhotoForArticle hits
    // it without making a network call. Cache key is `<articleId>.jpg`.
    const cachedDest = path.join(STOCK_DIR, `${article.id.replace(/[^a-z0-9_-]/gi, "_")}.jpg`);
    copyFileSync(SAMPLE_JPG, cachedDest);

    const start = Date.now();
    try {
      const out = await ensureCard(article, "og");
      const dest = path.join(OUT_DIR, `${article.id}-og-photo.png`);
      writeFileSync(dest, out.buffer);
      const ms = Date.now() - start;
      console.log(`✓ ${article.category.padEnd(14)} ${out.withPhoto ? "📷" : "  "} ${ms}ms  →  ${path.basename(dest)}`);
    } catch (e) {
      console.error(`✗ ${article.category}: ${e.message}`);
    }
  }
  console.log(`\nDone. Compare ${OUT_DIR}/*-photo.png with the typographic-only versions.`);
})();
