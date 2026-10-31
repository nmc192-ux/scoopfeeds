#!/usr/bin/env node
/**
 * cli.mjs - The Long Read (#304), on the Mac.
 *
 *   node src/radio/longread/cli.mjs make [--base URL] [--model sonnet] [--fake-writer] [--dry-run]
 *        pick one major story, write the piece (one Claude call), check it, save it:
 *        draft (RADIO_LONGREAD_REVIEW on, the default) | ready (review off, literally 0) | refused
 *   node src/radio/longread/cli.mjs list                 every piece, newest first, and whether it may air now
 *   node src/radio/longread/cli.mjs show <id>            the piece as it would be read, and its check report
 *   node src/radio/longread/cli.mjs approve <id> [--note "..."]
 *   node src/radio/longread/cli.mjs refuse <id> --note "why"
 *
 * Making a piece puts nothing on air. A piece airs only in a produced hour with RADIO_LONGREAD_ENABLED=1
 * (produce.mjs). Exit codes: 0 done, 1 nothing made (no story, or the piece was refused), 2 usage or failure.
 */
import { parseArgs } from "node:util";
import { fetchLongreadPack, buildPrompt, SYSTEM, checkLongread, airVerdict, reviewOn, SECTION_LABEL, PICK, STORY_ID } from "./longread.js";
import { savePiece, listPieces, loadPiece, setReview, recentSlugs, longReadDir } from "./store.js";
import { claudeWriter } from "../programme/writer.js";

const { values: v, positionals: [cmd, id] } = parseArgs({ allowPositionals: true, options: {
  base: { type: "string", default: "https://scoopfeeds.com" }, model: { type: "string", default: "sonnet" },
  "fake-writer": { type: "boolean" }, "dry-run": { type: "boolean" }, note: { type: "string" },
} });
const log = (m) => console.log(`📖 longread: ${m}`);
const die = (m, code = 2) => { console.error(`📖 longread: ${m}`); process.exit(code); };
const dir = longReadDir();

/** Dry runs only: a mechanical "piece" from the material's own titles (never aired: it is refused for length). */
async function fakeWriter(pk) {
  const pick = (i) => pk.articles[i % pk.articles.length];
  return { lines: Object.keys(SECTION_LABEL).map((section, i) => ({ section, sources: [pick(i).source], text: `${pick(i).source} reports: ${pick(i).title}.` })) };
}

if (cmd === "make") {
  const now = Date.now();
  let pk;
  try { pk = await fetchLongreadPack({ base: v.base, now, recentSlugs: recentSlugs(now - PICK.repeatAfterMs, { dir }), log }); }
  catch (e) { die(`could not read the event graph (${e.message})`); }
  if (!pk.event) die(`nothing to write: ${pk.refused}${pk.tried.length ? ` (${pk.tried.map((t) => `${t.slug}: ${t.why}`).join("; ")})` : ""}`, 1);
  log(`story: ${pk.event.slug} — "${pk.story.headline}" (${pk.articles.length} articles from ${pk.sources.length} outlets, ${pk.timeline.length} timeline items, ${pk.dropped.length} dropped)`);
  let written, writer = v["fake-writer"] ? "fake" : "claude";
  try {
    if (v["fake-writer"]) written = await fakeWriter(pk);
    else {
      const write = claudeWriter({ model: v.model, log });
      const prompt = buildPrompt(pk);
      for (let attempt = 1; attempt <= 2 && !written; attempt++) {
        try { const r = await write(SYSTEM, prompt); if (!Array.isArray(r?.lines)) throw new Error("reply has no lines"); written = r; }
        catch (e) { log(`writer attempt ${attempt} failed: ${e.message}`); if (attempt === 2) throw e; }
      }
    }
  } catch (e) { die(`writer failed: ${e.message}`); }
  const verdict = checkLongread(written, pk.story, { log });
  const status = !verdict.ok ? "refused" : reviewOn() ? "draft" : "ready";
  const piece = {
    version: 1, createdAt: now, status, writer, event: pk.event, story: pk.story,
    segment: verdict.segment, raw: written, report: verdict.report,
    verdict: { ok: verdict.ok, reasons: verdict.reasons, words: verdict.words, written: verdict.written, credited: verdict.credited },
    airings: [],
  };
  log(`checks: ${verdict.report.length} line(s) dropped; ${verdict.words} of ${verdict.written} words kept; ${verdict.credited.length} outlet(s) credited`);
  if (!verdict.ok) log(`REFUSED: ${verdict.reasons.join("; ")}`);
  if (v["dry-run"]) { log(`dry run: not saved (would be ${status})`); process.exit(verdict.ok ? 0 : 1); }
  const saved = savePiece(piece, { articles: pk.articles, timeline: pk.timeline, sources: pk.sources, dropped: pk.dropped, tried: pk.tried, builtAt: pk.builtAt }, { dir });
  log(`saved ${saved.id} as ${status}${status === "draft" ? ` (review is on: node src/radio/longread/cli.mjs show ${saved.id}, then approve or refuse)` : ""}`);
  process.exit(verdict.ok ? 0 : 1);
}

if (cmd === "list") {
  const ps = listPieces({ dir });
  if (!ps.length) log(`no pieces in ${dir}`);
  for (const p of ps) {
    const why = airVerdict(p);
    console.log(`${p.id}\t${p.status}\t${new Date(p.createdAt).toISOString().slice(0, 16)}Z\t${p.verdict?.words ?? "?"} words\taired ${(p.airings || []).length}x\t${why ? `not on air: ${why}` : "may air"}\t${p.story?.headline || ""}`);
  }
  if (ps.skipped?.length) log(`unreadable: ${ps.skipped.join(", ")}`);
  process.exit(0);
}

if (cmd === "show") {
  const p = id && loadPiece(id, { dir });
  if (!p) die(`no piece ${id || "(give an id: cli.mjs list)"}`);
  console.log(`${p.id} — ${p.status}${p.review ? ` (${p.review.status} by ${p.review.by})` : ""}\n${p.story.headline}\n`);
  let sec = null;
  for (const l of p.segment.lines) {
    if (l.section && l.section !== sec) { sec = l.section; console.log(`\n## ${SECTION_LABEL[sec]}`); }
    console.log(`${l.text}${l.sources?.length ? `  [${l.sources.join(", ")}]` : ""}`);
  }
  console.log(`\nchecks: ${p.verdict.ok ? "passed" : `REFUSED: ${p.verdict.reasons.join("; ")}`}; ${p.verdict.words} of ${p.verdict.written} words kept`);
  for (const r of p.report || []) console.log(`  ✂ ${r.line}: ${r.drop}${r.text ? ` — ${r.text}` : ""}`);
  process.exit(0);
}

if (cmd === "approve" || cmd === "refuse") {
  if (!id) die(`usage: cli.mjs ${cmd} <id>${cmd === "refuse" ? " --note \"why\"" : ""}`);
  if (cmd === "refuse" && !v.note) die("refuse needs --note \"why\"");
  try {
    const p = setReview(id, cmd === "approve" ? "approved" : "refused", { note: v.note || null, dir });
    if (!p) die(`no piece ${id}`);
    log(`${id}: ${p.status}`);
  } catch (e) { die(e.message); }
  process.exit(0);
}

die(`usage: cli.mjs make|list|show <id>|approve <id>|refuse <id> --note "why"   (story id in the piece: ${STORY_ID})`);
