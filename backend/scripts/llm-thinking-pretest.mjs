/**
 * llm-thinking-pretest — 2026-07-15 cost-incident gate (a), rider 1.
 *
 * Demonstrates the burn mechanism live, with the real extractor prompt:
 *   CALL A — the incident config: gemini-flash-latest (floating alias, no
 *            thinkingConfig, maxOutputTokens 512). Expected: thousands of
 *            thoughtsTokenCount billed as output, finishReason MAX_TOKENS,
 *            empty/truncated text, JSON parse failure.
 *   CALL B — the gate-(a) config: pinned model + thinkingBudget:0 + the
 *            same 512 cap. Expected: clean JSON within the cap,
 *            thoughtsTokenCount 0/absent. If the pinned model rejects
 *            thinkingBudget:0 (mandatory-minimum models), the script
 *            retries without thinkingConfig and SAYS SO.
 *
 * Run ON THE VPS (the key never leaves it):
 *   docker compose -f docker-compose.production.yml -f docker-compose.override.yml \
 *     exec web node scripts/llm-thinking-pretest.mjs
 *
 * Prints usageMetadata + text previews only — never the key. Total cost of
 * this pre-test: two small calls (~$0.01).
 */

import "../src/config/env.js";
import axios from "axios";
import Database from "better-sqlite3";
import path from "node:path";
import process from "node:process";

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error("GEMINI_API_KEY not set — run inside the web container / with backend env.");
  process.exit(1);
}

const LEGACY_MODEL = "gemini-flash-latest";
const PINNED_MODEL = process.env.GEMINI_GENERATION_MODEL || "gemini-2.5-flash";

const DB_PATH = process.env.SCOOP_PERSISTENT_DATA_DIR
  ? path.join(process.env.SCOOP_PERSISTENT_DATA_DIR, "news.db")
  : path.join(process.cwd(), "data", "news.db");
const db = new Database(DB_PATH, { readonly: true });

// Same selection + prompt as eventActorExtractor.
const event = db.prepare(`
  SELECT e.id, e.title, e.category
  FROM events e
  WHERE e.status = 'active'
    AND (SELECT COUNT(*) FROM event_articles ea WHERE ea.event_id = e.id) > 0
  ORDER BY e.last_activity_at DESC
  LIMIT 1
`).get();
if (!event) { console.error("No active event with articles found."); process.exit(1); }

const articles = db.prepare(`
  SELECT a.title, a.description AS summary
  FROM event_articles ea JOIN articles a ON a.id = ea.article_id
  WHERE ea.event_id = ? ORDER BY ea.added_at DESC LIMIT 5
`).all(event.id);

const SYSTEM_PROMPT = `You are a news analyst. Extract the key actors from the provided news summaries.
Return a JSON object with a single key "actors" containing an array of objects, each with:
  - "name": full name of the person, organization, or country (string)
  - "type": one of "person", "org", or "country" (string)
  - "role": one-sentence description of their role in this story (string)
  - "mentions": estimated mention count (integer, 1..10)
Return at most 8 actors. Order by importance (most central first).
Return ONLY valid JSON, no markdown, no extra text.`;
const prompt = `${SYSTEM_PROMPT}\n\nEvent: "${event.title}" (category: ${event.category})\n\nTop articles:\n${articles.map((a, i) => `[${i + 1}] ${a.title}\n${a.summary ?? ""}`).join("\n\n")}`;

console.log(`Event under test: "${event.title}" (${articles.length} articles)\n`);

async function call(model, generationConfig, label) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`;
  try {
    const { data } = await axios.post(
      url,
      { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig },
      { timeout: 60000 }
    );
    const cand = data?.candidates?.[0];
    const text = cand?.content?.parts?.map(p => p.text).join("") ?? "";
    let parseOk = false;
    try { JSON.parse(text); parseOk = true; } catch { /* not JSON */ }
    console.log(`── ${label} ──`);
    console.log(`model:             ${data?.modelVersion ?? model}`);
    console.log(`finishReason:      ${cand?.finishReason}`);
    console.log(`usageMetadata:     ${JSON.stringify(data?.usageMetadata ?? {})}`);
    console.log(`text length:       ${text.length}`);
    console.log(`text preview:      ${JSON.stringify(text.slice(0, 200))}`);
    console.log(`JSON parse:        ${parseOk ? "OK" : "FAILED"}\n`);
    return { rejected: false };
  } catch (err) {
    const status = err.response?.status;
    const body = JSON.stringify(err.response?.data ?? err.message).slice(0, 300);
    console.log(`── ${label} ──`);
    console.log(`HTTP ${status}: ${body}\n`);
    return { rejected: status === 400 && /thinking/i.test(body) };
  }
}

console.log("CALL A — incident config (floating alias, no thinkingConfig, cap 512):");
await call(LEGACY_MODEL, { temperature: 0.2, responseMimeType: "application/json", maxOutputTokens: 512 }, "A: legacy");

console.log(`CALL B — gate-(a) config (${PINNED_MODEL}, thinkingBudget:0, cap 512):`);
const b = await call(PINNED_MODEL, { temperature: 0.2, responseMimeType: "application/json", maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } }, "B: pinned+thinking0");
if (b.rejected) {
  console.log(`${PINNED_MODEL} rejected thinkingBudget:0 — retrying WITHOUT thinkingConfig (graceful-degrade path):`);
  await call(PINNED_MODEL, { temperature: 0.2, responseMimeType: "application/json", maxOutputTokens: 512 }, "B2: pinned, no thinkingConfig");
}
db.close();
