#!/usr/bin/env node
/**
 * qa.mjs — the deterministic half of the 60 · QA gate (brief, "QA gate"). Blocks
 * posting. Agents may run it; they cannot edit it (see pakistan.mjs header).
 *
 *   node sixty/gates/qa.mjs <filmdir>          → gate-qa.json, exit 0 only if EVERY check passes
 *
 * Honesty rule (docs/agentic-workflow.md §5): a check that could not be measured
 * is a FAIL, never a pass.
 *
 * Film dir contract (written by the agents):
 *   final.mp4       the film              sound.json   from sixty/tools/mix.mjs
 *   plan.json       the render plan; every shot carries `claims: [ids]` and `media: [ids]`
 *   script.json     { promise, lines: [{ id, text, claims: [ids] }] }
 *   register.json   { claims: [{ id, text, status, sources: [{ url, outlet, kind }] }],
 *                     media:  [{ id, url, credit, licence, third_party }] }
 *   factcheck.json  { lines: [{ id, verdict: confirmed|fixed|killed }] }
 */
import "../tools/env.mjs";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { execFileSync, spawnSync } from "child_process";

const dir = process.argv[2];
if (!dir) { console.error("usage: qa.mjs <filmdir>"); process.exit(1); }
const f = (n) => path.join(dir, n);
const load = (n) => { try { return JSON.parse(readFileSync(f(n), "utf8")); } catch { return null; } };
const checks = [];
const check = (name, pass, detail = null) => { checks.push({ name, result: pass === null ? "UNMEASURED" : pass ? "pass" : "FAIL", detail }); };

// ─── Technical ──────────────────────────────────────────────────────────────
const film = f("final.mp4");
if (!existsSync(film)) check("final.mp4 exists", false);
else {
  let probe = null;
  try { probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,duration", "-of", "json", film], { encoding: "utf8" })); } catch { /* measured below as null */ }
  const v = probe?.streams?.find((s) => s.codec_type === "video"), a = probe?.streams?.find((s) => s.codec_type === "audio");
  const dur = Number(probe?.format?.duration);
  check("duration is exactly 60.0 s (±0.05)", probe ? Math.abs(dur - 60) <= 0.05 : null, { format: dur, video: Number(v?.duration), audio: Number(a?.duration) });
  check("1080x1920", v ? v.width === 1080 && v.height === 1920 : null, v && `${v.width}x${v.height}`);
  check("24 fps", v ? v.r_frame_rate === "24/1" : null, v?.r_frame_rate);
  check("h264 + aac", v && a ? v.codec_name === "h264" && a.codec_name === "aac" : null, [v?.codec_name, a?.codec_name]);

  const filt = (vf) => spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", film, "-vf", vf, "-an", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  // Fully black frames only (pix_th tight, 99.9% of pixels): the 60 · ground is near-black by design.
  const black = [...filt("blackdetect=d=0.3:pic_th=0.999:pix_th=0.02").matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [+m[1], +m[2]]);
  check("no black segments ≥ 0.3 s", black.length === 0, black);
  // Frozen = a picture held > 5 s. The 3 s pace makes anything longer a stall.
  const frozen = [...filt("freezedetect=n=-60dB:d=5").matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/g)].map((m) => [+m[1], +m[2]]);
  check("no frozen picture > 5 s", frozen.length === 0, frozen);

  const sound = load("sound.json");
  const out = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", film, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const s = out.slice(out.lastIndexOf("Summary"));
  const I = Number(/I:\s*(-?[\d.]+)/.exec(s)?.[1]), TP = Number(/Peak:\s*(-?[\d.]+)/.exec(s)?.[1]);
  check("loudness -14 ±1 LUFS after AAC", Number.isFinite(I) ? Math.abs(I + 14) <= 1 : null, I);
  check("true peak ≤ -1 dBTP after AAC", Number.isFinite(TP) ? TP <= -1 : null, TP);
  check("bed under voice (approved library bed, or none for grief)", sound ? (sound.bed.startsWith("library:") || (sound.level === "none")) : null, sound && `${sound.bed} ${sound.level}`);
}

// ─── Editorial structure ────────────────────────────────────────────────────
const plan = load("plan.json"), script = load("script.json"), reg = load("register.json"), fc = load("factcheck.json");
check("plan.json present", !!plan); check("script.json present", !!script); check("register.json present", !!reg); check("factcheck.json present", !!fc);

if (plan && reg && fc && script) {
  const claims = new Map((reg.claims || []).map((c) => [c.id, c]));
  const verdict = new Map((fc.lines || []).map((l) => [l.id, l.verdict]));
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };
  const claimOk = (id) => {
    const c = claims.get(id);
    if (!c) return `${id}: not in register`;
    if (c.status !== "verified") return `${id}: register status ${c.status}`;
    if (!["confirmed", "fixed"].includes(verdict.get(id))) return `${id}: fact-check verdict ${verdict.get(id) ?? "missing"}`;
    const srcs = c.sources || [];
    const primary = srcs.some((s) => s.kind === "primary" && host(s.url));
    const domains = new Set(srcs.map((s) => host(s.url)).filter(Boolean));
    if (!primary && domains.size < 2) return `${id}: needs 2 independent sources or 1 primary (has ${domains.size})`;
    return null;
  };
  const screenText = (s) => JSON.stringify([s.lines, s.value, s.label, s.prefix, s.suffix, s.title, s.bars, s.headline, s.hl, (s.labels || []).map((l) => l.text), s.texts, s.text]);
  const hasFact = (t) => /\d/.test(t);

  const problems = [];
  plan.shots.forEach((s, i) => {
    if (s.kind === "end") return;
    const t = screenText(s);
    if (hasFact(t) && !(s.claims || []).length) problems.push(`shot ${i} (${s.kind}) shows a figure with no claim id`);
    for (const id of s.claims || []) { const p = claimOk(id); if (p) problems.push(`shot ${i}: ${p}`); }
  });
  for (const l of script.lines || []) {
    if (hasFact(l.text) && !(l.claims || []).length) problems.push(`line ${l.id} states a figure with no claim id`);
    for (const id of l.claims || []) { const p = claimOk(id); if (p) problems.push(`line ${l.id}: ${p}`); }
  }
  if ((plan.hook?.lines || []).some((x) => hasFact(JSON.stringify(x))) && !(plan.hook.claims || []).length) problems.push("hook shows a figure with no claim id");
  check("every on-screen and spoken figure traces to a verified, fact-checked register line", problems.length === 0, problems.slice(0, 30));

  const media = new Map((reg.media || []).map((m) => [m.id, m]));
  const credit = [];
  plan.shots.forEach((s, i) => { for (const id of s.media || []) { const m = media.get(id); if (!m) credit.push(`shot ${i}: media ${id} not in register`); else if (!m.credit || !m.licence) credit.push(`shot ${i}: ${id} lacks credit or licence`); else if (m.third_party && !s.cred) credit.push(`shot ${i}: third-party ${id} not credited on screen`); } });
  const end = plan.shots.find((s) => s.kind === "end");
  if (!end || !(end.sources || []).length) credit.push("end card has no sources list");
  check("credits present (every media item licensed and credited; end card sources)", credit.length === 0, credit);

  // Originality: our narration runs the film; third-party footage is excerpt, not repost.
  const thirdSecs = plan.shots.filter((s) => (s.media || []).some((id) => media.get(id)?.third_party) && s.kind === "clip").reduce((n, s) => n + s.T, 0);
  const longest = Math.max(0, ...plan.shots.filter((s) => s.kind === "clip").map((s) => s.T));
  const voice = load("voice/voice.json") || load("voice.json");
  check("originality: third-party video ≤ 50% of runtime, no single clip > 8 s, narration ≥ 45 s",
    voice ? thirdSecs <= 30 && longest <= 8 && voice.narrationSecs >= 45 : null,
    { thirdPartyClipSecs: +thirdSecs.toFixed(1), longestClip: longest, narrationSecs: voice?.narrationSecs });
  check("promise is stated in the first 2 s (hook present, until ≥ 2)", plan.hook ? (plan.hook.until ?? 0) >= 2 && !!script.promise : null, script.promise);
  check("word-by-word captions present", Array.isArray(plan.words) && plan.words.length > 50, plan.words?.length);
}

// ─── Rule 0 again, independently ───────────────────────────────────────────
const r0 = spawnSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), "pakistan.mjs"), "film", dir], { encoding: "utf8" });
check("Rule 0 (Pakistan) re-run", r0.status === 0, r0.stdout.trim().slice(0, 300));

const pass = checks.every((c) => c.result === "pass");
writeFileSync(f("gate-qa.json"), JSON.stringify({ gate: "qa", pass, checks }, null, 1));
console.log(JSON.stringify({ gate: "qa", pass, failed: checks.filter((c) => c.result !== "pass").map((c) => c.name) }));
process.exit(pass ? 0 : 4);
