/**
 * spec-dry-run — generate ONE video spec and print it. Render nothing.
 *
 * WHY THIS EXISTS. `writeVideoSpec` had exactly one caller in production —
 * inside the render cycle — so there was no way to see what the model emits
 * without rendering and publishing on the back of it. That made every prompt
 * change unreviewable before the fact: the summary line says how many cards
 * survived, never what they were. This separates generation from rendering so a
 * prompt can be judged on its output before a frame exists.
 *
 * Run it in the worker, where the Gemini key already lives:
 *
 *   cd /opt/scoopfeeds
 *   docker compose -f docker-compose.production.yml exec -T worker \
 *     node scripts/spec-dry-run.mjs <article-id>
 *
 * With no article id it picks the freshest candidate the video cycle would.
 *
 *   ... node scripts/spec-dry-run.mjs --prompt-only     # no model call, no cost
 *   ... node scripts/spec-dry-run.mjs --list            # candidate ids, then stop
 *   ... node scripts/spec-dry-run.mjs <id> --no-fetch   # skip the full-text fetch
 *
 * READ-ONLY, and deliberately so at the handle level rather than by convention:
 * the database is opened with `readonly: true`, which is also why this does not
 * use getDb() — that runs bootstrapSchema and would apply migrations as a side
 * effect of an inspection command. Nothing is claimed, rendered, uploaded or
 * marked. The only writes anywhere are Gemini's own billing and, on two specific
 * API failures, llmQueue's in-memory degrade flags (which are not persisted).
 *
 * IT COSTS ONE SPEC CALL. Roughly a cent at current rates, printed at the end so
 * the number is never a guess.
 */

import "../src/config/env.js";
import path from "node:path";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const articleId = argv.find((a) => !a.startsWith("--")) || null;

const PROMPT_ONLY = flag("prompt-only");
const LIST = flag("list");
const NO_FETCH = flag("no-fetch");

// ── The database, read-only ────────────────────────────────────────────────
const dataDir = process.env.SCOOP_PERSISTENT_DATA_DIR || "/var/lib/scoop";
const dbPath = process.env.SCOOP_DB_PATH || path.join(dataDir, "news.db");
if (!existsSync(dbPath)) {
  console.error(`no database at ${dbPath}`);
  console.error("set SCOOP_DB_PATH, or run this inside a container with the scoop_data volume.");
  process.exit(2);
}
let db;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
} catch (err) {
  console.error(`could not open ${dbPath} read-only: ${err.message}`);
  process.exit(2);
}

/**
 * The same shape the video cycle selects, including image_url — so what is
 * inspected here is what the cycle would actually hand the model, not a
 * hand-built approximation of it.
 */
const CANDIDATE_COLS = `a.id, a.title, a.description, a.content, a.category, a.source_name,
    a.published_at, a.credibility, a.url, a.tags, a.image_url`;

function freshCandidates(limit = 10) {
  return db.prepare(`
    SELECT ${CANDIDATE_COLS}
    FROM articles a
    LEFT JOIN video_posts v ON v.article_id = a.id
    WHERE a.published_at > ? AND a.credibility >= 7 AND a.is_duplicate = 0
      AND (v.article_id IS NULL OR (v.status <> 'published' AND v.attempts < 2))
    ORDER BY LENGTH(COALESCE(a.content, '')) DESC
    LIMIT ?
  `).all(Date.now() - 12 * 3600_000, limit);
}

if (LIST) {
  const rows = freshCandidates(15);
  console.log(`${rows.length} candidates in the last 12h, longest body first:\n`);
  for (const r of rows) {
    console.log(`  ${r.id}`);
    console.log(`    ${String(r.source_name).padEnd(18)} ${String(r.title).slice(0, 92)}`);
    console.log(`    ${String(r.content || "").length} chars · image_url ${r.image_url ? "yes" : "NO"}`);
  }
  db.close();
  process.exit(0);
}

let article;
if (articleId) {
  article = db.prepare(`SELECT ${CANDIDATE_COLS} FROM articles a WHERE a.id = ?`).get(articleId);
  if (!article) {
    console.error(`no article with id "${articleId}". Try --list.`);
    db.close();
    process.exit(1);
  }
} else {
  article = freshCandidates(1)[0];
  if (!article) {
    console.error("no fresh candidates in the last 12h. Pass an article id, or try --list.");
    db.close();
    process.exit(1);
  }
}
db.close();

console.log("─".repeat(78));
console.log(`ARTICLE  ${article.id}`);
console.log(`         ${article.source_name} · ${new Date(article.published_at).toISOString()}`);
console.log(`         ${article.title}`);
console.log(`         body ${String(article.content || "").length} chars · image_url ${article.image_url ? article.image_url.slice(0, 60) : "NONE"}`);
console.log("─".repeat(78));

// ── The prompt, before any money is spent ──────────────────────────────────
//
// Printed from the SAME builder the real call uses, so this cannot drift from
// what is actually sent. --prompt-only stops here: the rules can be reviewed
// for free, and only a prompt that reads correctly is worth a call.
const { buildSpecPrompt, writeVideoSpec, isVideoSpecEnabled } = await import("../src/services/videoSpecWriter.js");
const { resolveAttribution } = await import("../src/services/videoAttribution.js");

const attribution = resolveAttribution(article);

const allowedSources = [attribution.publisher].filter(Boolean);
const prompt = buildSpecPrompt({ article, allowedSources, bodyText: article.content || "" });
console.log(`\nPROMPT — ${prompt.length} chars, ${prompt.split("\n").length} lines`);
if (PROMPT_ONLY) {
  console.log("─".repeat(78));
  console.log(prompt);
  console.log("─".repeat(78));
  console.log("\n--prompt-only: no model call was made and nothing was spent.");
  console.log("To see what a prompt CHANGE does, run this on both revisions and diff the two");
  console.log("outputs — the prompt is built here by the same function the real call uses, so");
  console.log("the comparison is of what is actually sent rather than of the source that builds it.");
  process.exit(0);
}

if (!isVideoSpecEnabled()) {
  console.error("\nVIDEO_SPEC_ENABLED is not 1, or GEMINI_API_KEY is unset — no spec can be generated.");
  process.exit(2);
}

// ── The call ───────────────────────────────────────────────────────────────
console.log(`\ngenerating${NO_FETCH ? " (skipping the full-text fetch)" : ""}…\n`);
const t0 = Date.now();
const r = await writeVideoSpec(article, {
  allowedSources,
  attribution,
  fetchFullText: !NO_FETCH,
});
const secs = ((Date.now() - t0) / 1000).toFixed(1);

if (!r || typeof r !== "object") {
  console.error(`writeVideoSpec broke its contract — returned ${r === null ? "null" : typeof r}`);
  process.exit(1);
}

if (!r.ok) {
  console.log(`REJECTED after ${secs}s — ${r.reason}`);
  console.log(`cost $${(r.costUsd || 0).toFixed(5)} · attempts ${r.attempts ?? "?"}`);
  // THE REJECTED SPEC, WHOLE. What failed is in the reason; what was PRODUCED is
  // only here, and the two together are what makes a failure diagnosable. The
  // beats/cards mismatch in particular can only be understood by reading the
  // beats against the cards.
  if (r.rejectedSpec) {
    console.log("\n─── what the model produced (rejected, not used) ───");
    console.log(JSON.stringify(r.rejectedSpec, null, 2));
    const beats = r.rejectedSpec.beats || [];
    const slides = r.rejectedSpec.slides || [];
    const content = slides.filter(c => c && c.t !== "title" && c.t !== "kicker");
    console.log(`\nbeats ${beats.length} vs content cards ${content.length}` +
      (beats.length === content.length ? "" : `  <-- MISMATCH of ${beats.length - content.length}`));
    if (beats.length) {
      console.log("beat kinds, in order: " + beats.map(b => b?.kind ?? "?").join(", "));
      const kicker = slides.find(c => c && c.t === "kicker");
      if (kicker) console.log(`kicker caption: ${String(kicker.caption || "").slice(0, 140)}`);
      // The comparison that diagnosed this class: does the closer restate the
      // last enumerated beat? If it does, the model spent a beat on the wrapper.
      const last = beats[beats.length - 1];
      if (last?.beat) console.log(`last beat      : ${String(last.beat).slice(0, 140)}`);
    }
  } else {
    console.log("(no parsed spec — the failure was before or during parsing)");
  }
  process.exit(0);
}

// THE RAW SPEC, WHOLE. The point of this command: every card, every caption,
// every field, exactly as it will reach the renderer. No truncation — a spec
// abbreviated for the terminal is a spec that cannot be reviewed.
console.log("─".repeat(78));
console.log(JSON.stringify(r.spec, null, 2));
console.log("─".repeat(78));

const slides = r.spec?.slides || [];
const types = slides.reduce((m, c) => ({ ...m, [c.t]: (m[c.t] || 0) + 1 }), {});
console.log(`\n${slides.length} cards — ${Object.entries(types).map(([t, n]) => `${t} x${n}`).join(", ")}`);
console.log("captions, in order:");
slides.forEach((c, i) => {
  const cap = String(c.caption || "");
  console.log(`  ${String(i + 1).padStart(2)}. [${String(c.t).padEnd(7)}] ${cap.length.toString().padStart(3)}c  ${cap}`);
});

// DROPPED CARDS ARE NOT IN THE RETURN VALUE. writeVideoSpec logs them and keeps
// only the survivors, so the count cannot be printed from `r` — it would always
// read zero and quietly imply a clean spec. They appear instead as a
// "🎬 videoSpec [id]: dropped N card(s)" line ABOVE this output, which is worth
// scrolling back for: a spec that validated cleanly and one that lost four cards
// on the way both print a slide list down here.

console.log(`\n${secs}s · $${(r.costUsd || 0).toFixed(5)} · attempts ${r.attempts ?? 1}`);
console.log("Nothing was rendered, claimed, uploaded or written.");
