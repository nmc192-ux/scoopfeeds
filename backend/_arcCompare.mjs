/**
 * _arcCompare.mjs — B6. The SAME articles through main's spec writer and this
 * branch's, six metrics side by side, plus full caption sequences.
 *
 * Disposable and gitignored (`backend/_*.mjs`), READ-ONLY against the DB, and
 * it reuses production `writeVideoSpec()` verbatim on both sides rather than
 * reimplementing anything.
 *
 * HOW "BEFORE" IS OBTAINED. Not by reconstructing main's behaviour from memory,
 * and not by toggling a flag — the arc rules have no flag, by design. A git
 * WORKTREE of main is checked out and its `videoSpecWriter.js` is imported as a
 * second module. Both sides then run their own real prompts, their own real
 * validators, and their own real retry loops. Anything less would be comparing
 * this branch against a story about main.
 *
 * THE METRICS ARE COMPUTED HERE, IDENTICALLY FOR BOTH SIDES, from the captions
 * that came back. They are deliberately NOT read out of either validator: main
 * has no stem check at all, so asking each side to report its own numbers would
 * compare two different measurements and call the difference an improvement.
 *
 *   node _arcCompare.mjs --self-test     # prove the metric arithmetic, no model calls
 *   node _arcCompare.mjs --n 6           # run the real comparison (needs GEMINI_API_KEY)
 *   node _arcCompare.mjs --n 6 --seq 3   # ...and paste 3 full caption sequences
 *
 * Never prints the key.
 */

import "./src/config/env.js";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const argv = process.argv;
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : d; };
const N    = Number(flag("n", 6));
const SEQS = Number(flag("seq", 3));
const WORKTREE = path.resolve(flag("worktree", "/tmp/arc-baseline"));
const BASE_REF = flag("base", "main");

// ─── The six metrics, one implementation, applied to both sides ─────────────

const normText = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const contentWords = (s) => new Set(normText(s).split(" ").filter((w) => w.length > 4));

/**
 * The percentage BEHIND the 60% gate: overlap over the smaller content-word
 * set. Reported as a number so a drop is visible as a magnitude rather than as
 * a pass/fail flip — a hook going 85% -> 61% is still a real improvement even
 * though it would not have tripped the gate either way.
 *
 * Returns null when either side has no content words, because 0% would be a
 * lie: the measure abstained, it did not measure zero overlap.
 */
export function overlapPct(a, b) {
  const A = contentWords(a), B = contentWords(b);
  if (A.size === 0 || B.size === 0) return null;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return Number(((hit / Math.min(A.size, B.size)) * 100).toFixed(1));
}

/** Captions sharing a 3-word opening stem with at least one other caption. */
export function sharedStemCount(captions, stemWords = 3) {
  const counts = new Map();
  for (const c of captions) {
    const w = normText(c).split(" ").filter(Boolean);
    if (w.length < stemWords) continue;
    const stem = w.slice(0, stemWords).join(" ");
    counts.set(stem, (counts.get(stem) || 0) + 1);
  }
  let n = 0;
  const stems = [];
  for (const [stem, c] of counts) if (c > 1) { n += c; stems.push({ stem, count: c }); }
  return { captions: n, stems: stems.sort((x, y) => y.count - x.count) };
}

/** Every metric for one spec result. `null` fields mean "could not measure". */
export function metricsFor({ headline, result }) {
  const ok = Boolean(result?.ok && result.spec);
  const slides = ok ? result.spec.slides : [];
  const caps = slides.map((c) => c.caption);
  const title = slides.find((c) => c.t === "title");
  const kicker = slides.find((c) => c.t === "kicker");
  const meta = ok ? result.spec.meta || {} : {};
  return {
    ok,
    reason: ok ? null : result?.reason || "(no reason recorded)",
    hookOverlap:   ok && title  ? overlapPct(title.caption, headline) : null,
    kickerOverlap: ok && kicker ? overlapPct(kicker.caption, headline) : null,
    sharedStems:   ok ? sharedStemCount(caps) : null,
    beats:         ok ? (result.spec.beats || []).length : null,
    slideCount:    ok ? slides.length : null,
    attempts:      result?.attempts ?? meta.attempts ?? null,
    tokensIn:      meta.tokensIn ?? null,
    tokensOut:     meta.tokensOut ?? null,
    costUsd:       result?.costUsd ?? null,
    captions:      caps,
  };
}

// ─── --self-test: prove the arithmetic without spending a token ─────────────

if (argv.includes("--self-test")) {
  let fails = 0;
  const check = (label, got, want) => {
    const pass = JSON.stringify(got) === JSON.stringify(want);
    if (!pass) fails++;
    console.log(`  ${pass ? "ok  " : "FAIL"} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  };
  console.log("metric self-test — fixtures only, no model calls\n");

  const HEADLINE = "Undersea cable damage disrupts internet across West Africa";
  console.log("overlapPct:");
  check("verbatim restatement is 100%",
    overlapPct("Undersea cable damage disrupts internet across West Africa", HEADLINE), 100);
  check("a true cold open shares nothing",
    overlapPct("Thirteen countries went dark on the same afternoon.", HEADLINE), 0);
  // {undersea, cable, damage, severe}: three of its four content words are the
  // headline's, so 3/min(4,7) = 75%. Above the 60% gate, below a verbatim copy —
  // which is exactly the band the reported percentage exists to make visible.
  check("partial reuse lands between", overlapPct("Undersea cable damage was severe.", HEADLINE), 75);
  check("abstains when a side has no content words",
    overlapPct("So who pays now?", HEADLINE), null);

  console.log("\nsharedStemCount:");
  check("three identical stems counts three captions",
    sharedStemCount([
      "But here is the catch, one.", "But here is the catch, two.",
      "But here is the catch, three.", "Anchors did the damage.",
    ]).captions, 3);
  check("all-distinct openings count zero",
    sharedStemCount(["One anchor did it.", "Repairs take a month.", "Sixty ships remain."]).captions, 0);
  check("captions shorter than the stem are skipped",
    sharedStemCount(["Who pays?", "Who pays?", "Who pays?"]).captions, 0);

  console.log("\nmetricsFor:");
  const failed = metricsFor({ headline: HEADLINE, result: { ok: false, reason: "closer_restates: ..." } });
  check("a rejected spec reports no metrics, only the reason", [failed.ok, failed.hookOverlap, failed.beats], [false, null, null]);

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`}`);
  process.exit(fails === 0 ? 0 : 1);
}

// ─── The real comparison ────────────────────────────────────────────────────

if (!process.env.GEMINI_API_KEY) {
  console.error(
    "GEMINI_API_KEY is not set — the comparison needs real spec generations on BOTH sides.\n" +
    "There is no offline substitute: the whole question is what the model does differently\n" +
    "under the new prompt, and a stubbed model would only report the stub.\n\n" +
    "Run `node _arcCompare.mjs --self-test` to verify the metric arithmetic without a key."
  );
  process.exit(2);
}

process.env.VIDEO_SPEC_ENABLED = "1";

// ── the baseline worktree ──
if (!existsSync(WORKTREE)) {
  console.log(`creating a ${BASE_REF} worktree at ${WORKTREE} …`);
  execFileSync("git", ["worktree", "add", "--detach", WORKTREE, BASE_REF], { stdio: "inherit" });
  execFileSync("npm", ["ci", "--omit=dev"], { cwd: path.join(WORKTREE, "backend"), stdio: "inherit" });
}
const baselineWriter = path.join(WORKTREE, "backend/src/services/videoSpecWriter.js");
if (!existsSync(baselineWriter)) {
  console.error(`no writer at ${baselineWriter} — is ${WORKTREE} a valid worktree?`);
  process.exit(1);
}

const { writeVideoSpec: writeBranch } = await import("./src/services/videoSpecWriter.js");
const { writeVideoSpec: writeBase }   = await import(baselineWriter);
const { resolveAttribution }          = await import("./src/services/videoAttribution.js");

// ── the article set — the SAME rows for both sides ──
const Database = (await import("better-sqlite3")).default;
const DB_PATH = process.env.SCOOP_DB_PATH || path.resolve("./data/news.db");
const db = new Database(DB_PATH, { readonly: true });
const articles = db.prepare(`
  SELECT id, title, description, content, category, source_name, url
  FROM articles
  WHERE content IS NOT NULL AND LENGTH(content) > 1200
  ORDER BY LENGTH(content) DESC
  LIMIT ?
`).all(N);
db.close();

console.log(`corpus: ${DB_PATH}`);
console.log(`articles: ${articles.length} (same set both sides)\n`);

const rows = [];
for (const a of articles) {
  const attribution = resolveAttribution(a);
  const opts = { allowedSources: [attribution.publisher].filter(Boolean), attribution };
  process.stdout.write(`  ${a.id} … `);
  const base   = await writeBase(a, opts).catch((e) => ({ ok: false, reason: `threw: ${e.message}` }));
  const branch = await writeBranch(a, opts).catch((e) => ({ ok: false, reason: `threw: ${e.message}` }));
  rows.push({
    article: a,
    base:   metricsFor({ headline: a.title, result: base }),
    branch: metricsFor({ headline: a.title, result: branch }),
  });
  console.log("done");
}

// ─── Report ─────────────────────────────────────────────────────────────────

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const nums = (side, f) => rows.map((r) => f(r[side])).filter((x) => x !== null && x !== undefined);
const fmt  = (x, dp = 1) => (x === null || x === undefined ? "—" : x.toFixed(dp));

const okBase = rows.filter((r) => r.base.ok).length;
const okBran = rows.filter((r) => r.branch.ok).length;

console.log(`\n════ B6 COMPARISON — ${rows.length} articles, main vs feat/video-script-arc ════\n`);
console.log("metric                                    main        branch");
console.log("─────────────────────────────────────────────────────────────");
console.log(`1. opening ↔ headline overlap (mean %)     ${fmt(mean(nums("base", m => m.hookOverlap))).padStart(6)}      ${fmt(mean(nums("branch", m => m.hookOverlap))).padStart(6)}`);
console.log(`2. captions sharing a 3-word stem (mean)   ${fmt(mean(nums("base", m => m.sharedStems?.captions))).padStart(6)}      ${fmt(mean(nums("branch", m => m.sharedStems?.captions))).padStart(6)}`);
console.log(`3. kicker ↔ headline overlap (mean %)      ${fmt(mean(nums("base", m => m.kickerOverlap))).padStart(6)}      ${fmt(mean(nums("branch", m => m.kickerOverlap))).padStart(6)}`);
console.log(`4. beats (mean)                            ${fmt(mean(nums("base", m => m.beats))).padStart(6)}      ${fmt(mean(nums("branch", m => m.beats))).padStart(6)}`);
console.log(`   slides (mean)                           ${fmt(mean(nums("base", m => m.slideCount))).padStart(6)}      ${fmt(mean(nums("branch", m => m.slideCount))).padStart(6)}`);
console.log(`5. specs accepted                          ${String(okBase).padStart(6)}      ${String(okBran).padStart(6)}   of ${rows.length}`);
console.log(`   regeneration rate (attempts > 1)        ${String(rows.filter(r => (r.base.attempts ?? 1) > 1).length).padStart(6)}      ${String(rows.filter(r => (r.branch.attempts ?? 1) > 1).length).padStart(6)}`);
console.log(`6. tokens in (mean)                        ${fmt(mean(nums("base", m => m.tokensIn)), 0).padStart(6)}      ${fmt(mean(nums("branch", m => m.tokensIn)), 0).padStart(6)}`);
console.log(`   tokens out (mean)                       ${fmt(mean(nums("base", m => m.tokensOut)), 0).padStart(6)}      ${fmt(mean(nums("branch", m => m.tokensOut)), 0).padStart(6)}`);
console.log(`   cost per spec (mean, USD)               ${fmt(mean(nums("base", m => m.costUsd)), 5).padStart(6)}      ${fmt(mean(nums("branch", m => m.costUsd)), 5).padStart(6)}`);

console.log(`\n⚠️  METRIC 4 IS A GUARDRAIL, NOT AN IMPROVEMENT. Beats and slides should be`);
console.log(`   UNCHANGED. If they moved, the arc rules leaked a length signal into the`);
console.log(`   prompt — which has burned this pipeline four times.`);

// Per-article detail, so a mean cannot hide one article carrying the result.
console.log(`\n── per article ──`);
for (const r of rows) {
  console.log(`\n  ${r.article.id}  "${String(r.article.title).slice(0, 68)}"`);
  for (const side of ["base", "branch"]) {
    const m = r[side];
    console.log(
      `    ${side === "base" ? "main  " : "branch"}  ` +
      (m.ok
        ? `hook ${fmt(m.hookOverlap)}%  kicker ${fmt(m.kickerOverlap)}%  stems ${m.sharedStems.captions}  ` +
          `beats ${m.beats}  slides ${m.slideCount}  attempts ${m.attempts}`
        : `REJECTED — ${String(m.reason).slice(0, 90)}`)
    );
  }
}

// Full sequences — the read-aloud is the verdict; the numbers are the guardrail.
const seqRows = rows.filter((r) => r.base.ok && r.branch.ok).slice(0, SEQS);
console.log(`\n\n════ FULL CAPTION SEQUENCES — ${seqRows.length} articles, before and after ════`);
for (const r of seqRows) {
  console.log(`\n\n━━━ ${r.article.id}`);
  console.log(`HEADLINE: ${r.article.title}\n`);
  for (const [label, m] of [["BEFORE (main)", r.base], ["AFTER (branch)", r.branch]]) {
    console.log(`  ${label}`);
    m.captions.forEach((c, i) => console.log(`    ${String(i + 1).padStart(2)}. ${c}`));
    console.log("");
  }
}
