/**
 * llm-ab — A/B two Claude models on the video SPEC prompt and on VISION checks.
 * Read-only.
 *
 *   node scripts/llm-ab.mjs                         # spec + vision, 5 articles, haiku-5-5 vs sonnet-5-5
 *   node scripts/llm-ab.mjs --only spec             # or: --only vision
 *   node scripts/llm-ab.mjs --n 10
 *   node scripts/llm-ab.mjs --ids id1,id2,id3
 *   node scripts/llm-ab.mjs --models claude-haiku-5-5,claude-sonnet-5-5
 *   node scripts/llm-ab.mjs --dry                   # build prompts, make NO model call, spend nothing
 *   node scripts/llm-ab.mjs --json                  # machine-readable report on stdout
 *
 * SPEC. Per article it builds the prompt with videoSpecWriter's own
 * buildSpecPrompt (exactly what production sends), sends the SAME prompt to each
 * model with the same cap and temperature, and judges the answer with the
 * production validator (validateSpec) after production decoration.
 *   success rate  valid spec (a parse failure counts as a failure)
 *   beat count    spec.beats.length on valid specs (mean + range)
 *   latency       median / p90
 *   cost          llmPricing.js table; unknown model → "n/a", never a guess
 *
 * VISION. Per article with a JPEG image_url it runs vision.js's REAL judgePhoto
 * prompt on each model (subject = the headline, caption = the description — a
 * proxy; real shots name a specific subject) and reports call success, the
 * `usable` verdict, agreement between the two models, mean "match" score,
 * latency and cost. Non-JPEG or unreachable images are skipped and counted.
 *
 * NOT DONE. One attempt per (article, model): production gives a spec one
 * regeneration retry after a spec-level rejection, so these are FIRST-ATTEMPT
 * rates and read pessimistic against the live loop, equally for both models.
 * Spec uses the STORED article body (no full-text fetch) so runs are
 * comparable. Nothing is rendered, published or claimed.
 *
 * READ-ONLY at the handle level: the database is opened readonly:true. It does
 * NOT go through llmQueue's queue — vision.js's `deps.callJson` seam is pointed at
 * a direct SDK call — because the queue calls getDb(), which would apply
 * migrations to whatever database SCOOP_PERSISTENT_DATA_DIR names, and writes
 * llm_usage / daily-budget rows. So: no DB writes, no usage rows, no budget.
 * It DOES spend real API money (two calls per article per part); the call count
 * is printed first and --dry spends nothing.
 *
 * Keys: ANTHROPIC_API_KEY (backend/.env, ~/.scoopfeeds.env, or the environment).
 * Database: SCOOP_DB_PATH, else $SCOOP_PERSISTENT_DATA_DIR/news.db.
 */

import "../src/config/env.js";
import path from "node:path";
import { existsSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import Database from "better-sqlite3";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };

const N = Math.max(1, Number.parseInt(opt("n", "5"), 10) || 5);
const IDS = opt("ids", "") ? opt("ids", "").split(",").map(s => s.trim()).filter(Boolean) : [];
const MODELS = opt("models", "claude-haiku-5-5,claude-sonnet-5-5").split(",").map(s => s.trim()).filter(Boolean);
const ONLY = opt("only", "");              // "" | "spec" | "vision"
const DRY = flag("dry");
const AS_JSON = flag("json");
const DO_SPEC = ONLY !== "vision";
const DO_VISION = ONLY !== "spec";

const SPEC_TEMPERATURE = 0.3;
const SPEC_MAX_OUTPUT_TOKENS = Number.parseInt(process.env.VIDEO_SPEC_MAX_OUTPUT_TOKENS || "8192", 10);
const SPEC_TIMEOUT_MS = 90_000;
const WPM = Number.parseInt(process.env.VIDEO_SPEC_WPM || "150", 10);
const log = (...a) => { if (!AS_JSON) console.log(...a); };

// ── database, read-only ────────────────────────────────────────────────────
const dataDir = process.env.SCOOP_PERSISTENT_DATA_DIR || "/var/lib/scoop";
const dbPath = process.env.SCOOP_DB_PATH || path.join(dataDir, "news.db");
if (!existsSync(dbPath)) {
  console.error(`no database at ${dbPath}\nset SCOOP_DB_PATH (e.g. a node scripts/pull-prod-db.mjs copy).`);
  process.exit(2);
}
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const COLS = `a.id, a.title, a.description, a.content, a.category, a.source_name, a.published_at, a.credibility, a.url, a.tags, a.image_url`;
let articles;
if (IDS.length) {
  articles = IDS.map(id => db.prepare(`SELECT ${COLS} FROM articles a WHERE a.id = ?`).get(id)).filter(Boolean);
} else {
  articles = db.prepare(`
    SELECT ${COLS} FROM articles a
    WHERE a.published_at > ? AND a.credibility >= 7 AND a.is_duplicate = 0
    ORDER BY LENGTH(COALESCE(a.content, '')) DESC LIMIT ?
  `).all(Date.now() - 48 * 3600_000, N);
}
db.close();
if (!articles.length) { console.error("no articles found (try --ids, or a fresher database copy)."); process.exit(1); }

// ── production pieces, reused verbatim ─────────────────────────────────────
const { _internals } = await import("../src/services/videoSpecWriter.js");
const { validateSpec } = await import("../src/services/videoSpecSchema.js");
const { resolveAttribution } = await import("../src/services/videoAttribution.js");
const { parseJsonLoose } = await import("../src/realityIndex/llmQueue.js");
const { estimateCostUsd } = await import("../src/realityIndex/llmPricing.js");
const { judgePhoto } = await import("../src/services/shots/vision.js");
const { buildSpecPrompt, decorateParsedSpec, extractJsonPayload } = _internals;

// ── one direct Claude call, shaped like llmQueue's withMeta result ─────────
let _client;
async function directCall(prompt, { model, temperature, maxOutputTokens, timeoutMs, images, imageMediaType = "image/jpeg" }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY unset");
  _client ||= new Anthropic({ maxRetries: 0 });
  const content = images?.length
    ? [...images.map(i => ({ type: "image", source: { type: "base64", media_type: imageMediaType, data: Buffer.from(i).toString("base64") } })), { type: "text", text: prompt }]
    : prompt;
  const params = {
    model, max_tokens: maxOutputTokens, temperature,
    system: "You are a helpful assistant. Respond with valid JSON only — no prose, no markdown fences.",
    messages: [{ role: "user", content }],
  };
  let msg;
  try { msg = await _client.messages.create(params, { timeout: timeoutMs }); }
  catch (err) {
    if (err?.status === 400 && /temperature|sampling/i.test(String(err.message))) { // llmQueue's same degrade
      const { temperature: _t, ...rest } = params;
      msg = await _client.messages.create(rest, { timeout: timeoutMs });
    } else throw err;
  }
  const out = (msg.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const parsed = parseJsonLoose(out);
  const u = msg.usage || {};
  return {
    ok: Boolean(out), errClass: out ? null : "empty",
    value: parsed === undefined ? { _rawText: out } : parsed,
    finishReason: msg.stop_reason === "max_tokens" ? "MAX_TOKENS" : msg.stop_reason,
    truncated: msg.stop_reason === "max_tokens",
    rawUsage: { promptTokenCount: u.input_tokens, candidatesTokenCount: u.output_tokens, thoughtsTokenCount: 0 },
    inputTokens: u.input_tokens ?? null, outputTokens: u.output_tokens ?? null, model,
    rawText: out,
  };
}
const costOf = (model, r) => estimateCostUsd("anthropic", model, r.inputTokens, r.outputTokens, { logger: { warn: (m) => console.error(m) } });

// ── SPEC part ──────────────────────────────────────────────────────────────
const specJobs = DO_SPEC ? articles.map(article => {
  const credit = resolveAttribution(article);
  const allowedSources = [credit?.publisher].filter(Boolean);
  const bodyText = String(article.content || "");
  return {
    article, credit,
    prompt: buildSpecPrompt({ article, allowedSources, bodyText }),
    validateOpts: {
      allowedSources,
      sourceText: `${article.title || ""} ${article.description || ""} ${bodyText}`,
      preCreditedSources: [credit?.publisher].filter(Boolean),
      headline: String(article.title || ""),
      shotList: false, wpm: WPM,
    },
  };
}) : [];

async function specOne(model, job) {
  const t0 = Date.now();
  const row = { article: job.article.id, model, ok: false, beats: null, ms: null, cost: null, reason: null, finishReason: null };
  try {
    const r = await directCall(job.prompt, { model, temperature: SPEC_TEMPERATURE, maxOutputTokens: SPEC_MAX_OUTPUT_TOKENS, timeoutMs: SPEC_TIMEOUT_MS });
    row.ms = Date.now() - t0;
    row.finishReason = r.finishReason ?? null;
    row.cost = costOf(model, r);
    if (!r.ok) { row.reason = `empty response (finish=${r.finishReason})`; return row; }
    if (r.truncated) { row.reason = "truncated at max_tokens (production hard-rejects this)"; return row; }
    const parsed = extractJsonPayload(r.rawText);
    if (!parsed) { row.reason = `unparseable JSON (finish=${r.finishReason})`; return row; }
    const v = validateSpec(decorateParsedSpec(parsed, job.article, job.credit), job.validateOpts);
    row.beats = (v.spec?.beats || parsed.beats || []).length;
    if (!v.ok) { row.reason = `invalid spec: ${v.errors.slice(0, 2).join(" | ")}`; return row; }
    row.ok = true;
    return row;
  } catch (err) {
    row.ms = Date.now() - t0;
    row.reason = `call failed: ${err?.status || err?.code || ""} ${String(err?.message || err).slice(0, 120)}`.trim();
    return row;
  }
}

// ── VISION part ────────────────────────────────────────────────────────────
async function fetchJpeg(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "follow", headers: { "User-Agent": "ScoopFeeds-llm-ab/1.0" } });
    if (!res.ok) return { skip: `HTTP ${res.status}` };
    const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (type !== "image/jpeg") return { skip: `not a JPEG (${type || "unknown"})` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2_000 || buf.length > 4_500_000) return { skip: `size ${buf.length}B out of range` };
    return { jpeg: buf };
  } catch (e) { return { skip: `fetch failed (${String(e.message).slice(0, 40)})` }; }
}

async function visionOne(model, art, jpeg) {
  const t0 = Date.now();
  const row = { article: art.id, model, ok: false, usable: null, match: null, ms: null, cost: null, reason: null };
  let last = null;
  // vision.js reads VIDEO_VISION_MODEL per call and takes its transport via deps.callJson.
  process.env.VIDEO_VISION_MODEL = model;
  const deps = {
    callJson: async (prompt, o) => { last = await directCall(prompt, { model: o.model, temperature: o.temperature, maxOutputTokens: o.maxOutputTokens, timeoutMs: o.timeoutMs, images: o.images, imageMediaType: o.imageMediaType }); return last; },
  };
  try {
    const j = await judgePhoto({ jpeg, subject: art.title, caption: String(art.description || ""), deps });
    row.ms = Date.now() - t0;
    if (last) row.cost = costOf(model, last);
    row.ok = Boolean(j.ok);
    row.usable = j.ok ? Boolean(j.usable) : null;
    row.match = j.ok && Number.isFinite(j.matches?.match ?? j.match) ? Number(j.matches?.match ?? j.match) : null;
    if (!j.ok) row.reason = j.reason;
  } catch (err) {
    row.ms = Date.now() - t0;
    row.reason = `call failed: ${err?.status || err?.code || ""} ${String(err?.message || err).slice(0, 100)}`.trim();
  }
  return row;
}

// ── run ────────────────────────────────────────────────────────────────────
const visionCandidates = DO_VISION ? articles.filter(a => a.image_url) : [];
log("─".repeat(78));
log(`llm-ab · ${articles.length} article(s) · models ${MODELS.join(" vs ")} · ${DO_SPEC ? "spec " : ""}${DO_VISION ? "vision" : ""} · first attempt only`);
for (const a of articles) log(`  ${a.id}  ${String(a.source_name).padEnd(16)} ${String(a.title).slice(0, 56)}${DO_VISION ? (a.image_url ? "  [image]" : "  [no image]") : ""}`);
log("─".repeat(78));

const specCalls = specJobs.length * MODELS.length;
const visionCalls = visionCandidates.length * MODELS.length;
if (DRY) {
  log(`--dry: ${specCalls} spec call(s) and up to ${visionCalls} vision call(s) NOT made, nothing spent.`);
  process.exit(0);
}
log(`making ${specCalls} spec + up to ${visionCalls} vision real API call(s)…\n`);

const specRows = [];
for (const job of specJobs) {
  const pair = await Promise.all(MODELS.map(m => specOne(m, job)));
  for (const r of pair) {
    specRows.push(r);
    log(`  spec   ${r.article.slice(0, 14).padEnd(14)} ${r.model.padEnd(18)} ${r.ok ? "OK  " : "FAIL"} beats=${String(r.beats ?? "-").padEnd(3)} ${String(r.ms ?? "-").padStart(6)}ms  ${r.cost == null ? "cost n/a" : "$" + r.cost.toFixed(5)}${r.reason ? "  — " + r.reason : ""}`);
  }
}

const visionRows = [];
let visionSkipped = 0;
for (const art of visionCandidates) {
  const img = await fetchJpeg(art.image_url);
  if (img.skip) { visionSkipped++; log(`  vision ${art.id.slice(0, 14).padEnd(14)} skipped — ${img.skip}`); continue; }
  for (const m of MODELS) {          // sequential: VIDEO_VISION_MODEL is process-wide
    const r = await visionOne(m, art, img.jpeg);
    visionRows.push(r);
    log(`  vision ${r.article.slice(0, 14).padEnd(14)} ${r.model.padEnd(18)} ${r.ok ? "OK  " : "FAIL"} usable=${String(r.usable).padEnd(5)} match=${String(r.match ?? "-").padEnd(3)} ${String(r.ms ?? "-").padStart(6)}ms  ${r.cost == null ? "cost n/a" : "$" + r.cost.toFixed(5)}${r.reason ? "  — " + r.reason : ""}`);
  }
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const allKnown = (rows) => rows.length > 0 && rows.every(r => r.cost != null);

const specSummary = MODELS.map(model => {
  const mine = specRows.filter(r => r.model === model);
  const good = mine.filter(r => r.ok);
  const total = allKnown(mine) ? sum(mine.map(r => r.cost)) : null;
  const beats = good.map(r => r.beats);
  return {
    model, calls: mine.length, ok: good.length, success_rate: mine.length ? good.length / mine.length : null,
    beats_mean: beats.length ? sum(beats) / beats.length : null, beats_min: beats.length ? Math.min(...beats) : null, beats_max: beats.length ? Math.max(...beats) : null,
    latency_ms_median: pct(mine.map(r => r.ms).filter(x => x != null), 0.5), latency_ms_p90: pct(mine.map(r => r.ms).filter(x => x != null), 0.9),
    cost_total_usd: total, cost_per_valid_spec_usd: total != null && good.length ? total / good.length : null,
  };
});

const visionSummary = MODELS.map(model => {
  const mine = visionRows.filter(r => r.model === model);
  const good = mine.filter(r => r.ok);
  const matches = good.map(r => r.match).filter(x => x != null);
  return {
    model, calls: mine.length, ok: good.length, success_rate: mine.length ? good.length / mine.length : null,
    usable: good.filter(r => r.usable).length,
    match_mean: matches.length ? sum(matches) / matches.length : null,
    latency_ms_median: pct(mine.map(r => r.ms).filter(x => x != null), 0.5),
    cost_total_usd: allKnown(mine) ? sum(mine.map(r => r.cost)) : null,
  };
});
// Agreement: same `usable` verdict per article between the first two models.
let agreement = null;
if (MODELS.length >= 2 && visionRows.length) {
  const [a, b] = MODELS;
  const byArt = new Map();
  for (const r of visionRows) { if (!r.ok) continue; byArt.set(r.article, { ...(byArt.get(r.article) || {}), [r.model]: r.usable }); }
  const both = [...byArt.values()].filter(v => v[a] != null && v[b] != null);
  agreement = { models: [a, b], compared: both.length, agree: both.filter(v => v[a] === v[b]).length };
}

if (AS_JSON) {
  console.log(JSON.stringify({ n_articles: articles.length, models: MODELS, spec: { summary: specSummary, rows: specRows }, vision: { summary: visionSummary, agreement, skipped: visionSkipped, rows: visionRows } }, null, 2));
} else {
  const f = (x, d = 1) => (x == null ? "n/a" : x.toFixed(d));
  const usd = (x) => (x == null ? "n/a (a model/usage is missing from the price table)" : "$" + x.toFixed(5));
  console.log("\n" + "─".repeat(78));
  if (DO_SPEC) {
    console.log("SPEC PROMPT (first attempt, stored article body)");
    console.log("─".repeat(78));
    for (const s of specSummary) {
      console.log(s.model);
      console.log(`  success      ${s.ok}/${s.calls}  (${f(s.success_rate * 100, 0)}%)`);
      console.log(`  beats        mean ${f(s.beats_mean)}  range ${s.beats_min ?? "n/a"}–${s.beats_max ?? "n/a"}  (valid specs only)`);
      console.log(`  latency      median ${s.latency_ms_median ?? "n/a"}ms  p90 ${s.latency_ms_p90 ?? "n/a"}ms`);
      console.log(`  cost         total ${usd(s.cost_total_usd)}   per valid spec ${s.cost_per_valid_spec_usd == null ? "n/a" : "$" + s.cost_per_valid_spec_usd.toFixed(5)}`);
    }
  }
  if (DO_VISION) {
    console.log("\n" + "─".repeat(78));
    console.log(`VISION (judgePhoto on article images; ${visionSkipped} skipped as non-JPEG/unreachable)`);
    console.log("─".repeat(78));
    for (const s of visionSummary) {
      console.log(s.model);
      console.log(`  call ok      ${s.ok}/${s.calls}   usable ${s.usable}   mean match ${f(s.match_mean)}`);
      console.log(`  latency      median ${s.latency_ms_median ?? "n/a"}ms   cost ${usd(s.cost_total_usd)}`);
    }
    if (agreement) console.log(`agreement on "usable" (${agreement.models.join(" vs ")}): ${agreement.agree}/${agreement.compared} articles`);
  }
  console.log("\nSmall-N caveat: with a handful of articles one result is a 20-point swing. Read the per-article rows above, not just the percentages.");
}
process.exit(0);
