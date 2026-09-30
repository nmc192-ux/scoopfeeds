#!/usr/bin/env node
/**
 * rule0.mjs — Standing rule 1 as a HARD GATE. Agents may run it; they cannot
 * edit it (runner permissions deny writes under sixty/gates/, and the runner
 * hashes this directory before and after every run — a changed gate voids the film).
 *
 * It is a thin CLI over prod Rule 0 (backend/src/services/videoPakistanBlock.js):
 * the same deterministic matcher, no prompt, no override, over-blocking correct.
 *
 *   node sixty/gates/rule0.mjs selection <candidates.json>
 *       candidates.json: [{ id, title, description?, content?, source_name?, category?, tags? }]
 *       Writes <candidates>.rule0.json { kept: [...], blocked: [{id, title, signals}] }. Exit 0.
 *
 *   node sixty/gates/rule0.mjs film <filmdir>
 *       Re-runs the full matcher over the pick AND every artifact the agents
 *       produced (register, fact-check, script, plan, package). Exit 0 = clear,
 *       3 = BLOCKED (the film must be dropped, not edited until it passes).
 */
import "../tools/env.mjs";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import path from "path";
import { filterAtSelection, checkPostGeneration, assertPublishAllowed, pakistanMatches } from "../../backend/src/services/videoPakistanBlock.js";

const [stage, target] = process.argv.slice(2);
const load = (f) => JSON.parse(readFileSync(f, "utf8"));

if (stage === "selection") {
  const cands = load(target);
  const kept = filterAtSelection(cands);
  const keptIds = new Set(kept.map((c) => c.id));
  const blocked = cands.filter((c) => !keptIds.has(c.id)).map((c) => ({ id: c.id, title: c.title, signals: pakistanMatches(c).map((m) => `${m.kind}:${m.signal}@${m.field}`) }));
  writeFileSync(target.replace(/\.json$/, "") + ".rule0.json", JSON.stringify({ kept, blocked }, null, 1));
  console.log(JSON.stringify({ gate: "rule0-selection", candidates: cands.length, kept: kept.length, blocked: blocked.length }));
  process.exit(0);
}

if (stage === "film") {
  const dir = target;
  const pickFile = [path.join(dir, "pick.json"), path.join(dir, "..", "pick.json")].find(existsSync);
  if (!pickFile) { console.error("no pick.json — cannot assess"); process.exit(3); }
  const pick = load(pickFile);
  const article = { title: pick.title || pick.story || "", description: pick.why_now || pick.summary || "",
    content: [pick.promise, ...(pick.sources || []).map((s) => (typeof s === "string" ? s : `${s.title || ""} ${s.url || ""}`))].join("\n"),
    source_name: pick.source_name || "", category: pick.category || "" };
  // Every JSON artifact in the film dir (not media, not our own gate outputs).
  const artifacts = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); const s = statSync(p);
    if (s.isDirectory()) { if (!/^(media|mixwork|render|voice)$/.test(f)) walk(p); }
    else if (f.endsWith(".json") && !/gate|usage|sound|\.rule0\./.test(f)) { try { artifacts.push({ file: path.relative(dir, p), ...load(p) }); } catch { /* not JSON */ } } } };
  walk(dir);
  // Scripts and packages are also plain text where agents write them as .md/.txt.
  for (const f of ["script.md", "package.md", "description.txt"]) if (existsSync(path.join(dir, f))) artifacts.push({ file: f, text: readFileSync(path.join(dir, f), "utf8") });
  const post = checkPostGeneration(article, artifacts);
  let verdict = { gate: "rule0-film", artifacts: artifacts.map((a) => a.file), allowed: true };
  try { assertPublishAllowed(article, artifacts); }
  catch (e) { verdict = { ...verdict, allowed: false, reason: String(e.message).slice(0, 400) }; }
  if (post.blocked) verdict.allowed = false;
  verdict.signals = [...new Set(post.matches.map((m) => `${m.kind}:${m.signal}@${m.field}`))].slice(0, 40);
  writeFileSync(path.join(dir, "gate-rule0.json"), JSON.stringify(verdict, null, 1));
  console.log(JSON.stringify({ gate: "rule0-film", allowed: verdict.allowed, reason: verdict.reason || null }));
  process.exit(verdict.allowed ? 0 : 3);
}

console.error("usage: rule0.mjs selection <candidates.json> | film <filmdir>");
process.exit(1);
