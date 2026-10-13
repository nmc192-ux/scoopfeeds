#!/usr/bin/env node
/**
 * qa.mjs — the deterministic half of the 60 · QA gate (brief, "QA gate"). Blocks
 * posting. Agents may run it; they cannot edit it (see rule0.mjs header).
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
import { logoProblems, isFootage } from "./logo.mjs";

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

  // Footage ruling (DrJ 2 Oct 2026): every third-party excerpt fully recorded, short, credited,
  // logo/watermark never cropped, never from a strike source.
  const strike = (() => { try { return JSON.parse(readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "../config/strike-sources.json"), "utf8")).sources || []; } catch { return null; } })();
  const fp = [];
  if (strike === null) fp.push("strike-sources.json unreadable");
  for (const m of reg.media || []) {
    if (!m.third_party) continue;
    for (const k of ["source", "url", "upload_date", "window", "verified_how", "credit"]) if (!m[k]) fp.push(`${m.id}: register lacks ${k}`);
    const hay = `${m.url || ""} ${m.channel_url || ""} ${m.source || ""}`.toLowerCase();
    for (const x of strike || []) if (x && hay.includes(String(x).toLowerCase())) fp.push(`${m.id}: from a strike source (${x})`);
  }
  plan.shots.forEach((x, i) => {
    const ms = (x.media || []).map((id) => media.get(id)).filter(Boolean);
    if (isFootage(x) && ms.some((m) => ["news", "social"].includes(m.source_type)) && (x.ymax ?? 1) < 1) fp.push(`shot ${i}: news/social clip cropped (ymax ${x.ymax}) — logos/watermarks must stay`);
    if (isFootage(x) && ms.some((m) => ["news", "social"].includes(m.source_type)) && x.T > 6) fp.push(`shot ${i}: news/social excerpt ${x.T}s — a few seconds only (≤ 6 s)`);
  });
  check("footage ruling: excerpts recorded (source, url, upload date, window, how verified), credited, ≤ 6 s for news/social, logos uncropped, no strike sources", fp.length === 0, fp.slice(0, 20));

  // Source logos (DrJ 13 Oct 2026): every footage shot says where the source's logo is; render60.py keeps it
  // (crop that contains it, or a full-width band) and records the layout. A cropped-off logo is a hard fail.
  const lp = logoProblems(plan, load("layout.json"));
  check("source logos kept: every footage shot declares its logo; crop contains it or it is shown as a full-width band (layout.json)", lp.length === 0, lp.slice(0, 20));

  // Originality: our narration runs the film; third-party footage is excerpt, not repost.
  const thirdSecs = plan.shots.filter((s) => (s.media || []).some((id) => media.get(id)?.third_party) && isFootage(s)).reduce((n, s) => n + s.T, 0);
  const longest = Math.max(0, ...plan.shots.filter((s) => isFootage(s)).map((s) => s.T));   // footage = path + cams, whatever the shot kind (per-film x- shots too)
  const voice = load("voice/voice.json") || load("voice.json");
  check("originality: third-party video ≤ 50% of runtime, no single clip > 8 s, narration ≥ 45 s",
    voice ? thirdSecs <= 30 && longest <= 8 && voice.narrationSecs >= 45 : null,
    { thirdPartyClipSecs: +thirdSecs.toFixed(1), longestClip: longest, narrationSecs: voice?.narrationSecs });
  // TEXT-HEAVINESS — HARD FAIL (DrJ 2 Oct 2026): more than 15% text-only screen time fails
  // the film and sends it back. Animated data graphics (charts, counters, maps) are VISUALS.
  // Built-in kinds are classified here; a custom x- shot must declare "class":
  // "real" | "data" | "text" — undeclared counts as text (fail-safe).
  const cls = (x) => {
    if (["clip", "photo", "satellite"].includes(x.kind)) return "real";
    if (["map", "count", "graphic"].includes(x.kind)) return "data";
    if (["punch", "headline"].includes(x.kind)) return "text";
    if (x.kind.startsWith("x-")) return ["real", "data", "text"].includes(x.class) ? x.class : "text";
    return "text";
  };
  const content2 = plan.shots.filter((x) => x.kind !== "end");
  const secs2 = content2.reduce((n, x) => n + x.T, 0) || 1;
  const byClass = { real: 0, data: 0, text: 0 };
  for (const x of content2) byClass[cls(x)] += x.T;
  const textShare = byClass.text / secs2;
  globalThis.__realShare = byClass.real / secs2;
  check("text-only screen time ≤ 15% (charts, counters and maps count as visuals)", textShare <= 0.15,
    { textOnlyPct: Math.round(100 * textShare), realPct: Math.round(100 * byClass.real / secs2), dataPct: Math.round(100 * byClass.data / secs2),
      textShots: content2.filter((x) => cls(x) === "text").map((x) => `${x.kind}@${x.t0}s ${x.T}s${x.kind.startsWith("x-") && !x.class ? " (no class → text)" : ""}`).slice(0, 15) });
  check("promise is stated in the first 2 s (hook present, until ≥ 2)", plan.hook ? (plan.hook.until ?? 0) >= 2 && !!script.promise : null, script.promise);
  check("word-by-word captions present", Array.isArray(plan.words) && plan.words.length > 50, plan.words?.length);
}

// ─── Playbook (DrJ, 1 Oct 2026): MEASURED FLAGS, reported, never blocking here ──
// The QA agent judges rules 4–6 and reconciles these. A miss is a flag in gate-qa.json.
const playbook = [];
const flag = (rule, met, evidence) => playbook.push({ rule, met, evidence });
if (plan && script) {
  const realShare = globalThis.__realShare ?? 0;
  const first = String(script.lines?.[0]?.text || "");
  flag(1, !/^\s*in\s+(60|sixty)\s+seconds/i.test(first), `opening line: "${first.slice(0, 90)}"`);
  const voice2 = load("voice/voice.json") || load("voice.json");
  const sbSecs = voice2?.soundbiteSecs || 0;
  const hasVideo = (load("register.json")?.media || []).some((m) => m.kind === "video");
  flag(2, sbSecs > 0 || !hasVideo, sbSecs > 0 ? `${sbSecs}s of real voices` : hasVideo ? "video in the register but NO soundbite — was a speaking clip available?" : "no video in register");
  flag(3, !!plan.pin?.text && (plan.pin.from ?? 0) <= 6, plan.pin?.text ? `pin: "${plan.pin.text}" from ${plan.pin.from ?? 0}s` : "no pinned headline/question card");
  // 7a: numbers on screen when spoken (non-caption screen text, ±1 s)
  const screenAt = (t) => plan.shots.filter((x) => x.t0 - 1 <= t && t <= x.t0 + x.T).map((x) => JSON.stringify([x.lines, x.value, x.title, x.bars, x.headline, x.labels, x.text, x.texts, x.label])).join(" ");
  const misses = [];
  for (const w of voice2?.words || []) {
    const d = String(w.w).replace(/[^0-9.]/g, "").replace(/\.$/, "");
    if (d.length && !screenAt(w.s).replace(/,/g, "").includes(d)) misses.push(`${d}@${w.s}s`);
  }
  flag(7, misses.length === 0, misses.length ? `spoken numbers not on screen: ${misses.slice(0, 12).join(", ")}` : "every spoken number on screen");
  const content = plan.shots.filter((x) => x.kind !== "end");
  const long = content.filter((x) => x.T > 3.5 && !(x.kind === "clip" && sbSecs)).map((x) => `${x.kind}@${x.t0}s ${x.T}s`);
  flag(7, long.length === 0, long.length ? `shots held > 3.5 s: ${long.slice(0, 10).join(", ")}` : "visual change ≤ 3.5 s throughout");
  flag(7, Array.isArray(plan.keywords) && plan.keywords.length > 0, `caption keywords: ${JSON.stringify(plan.keywords || [])}`);
  const last = (script.lines || []).filter((l) => l.kind !== "soundbite").at(-1) || {};
  flag(8, ["next", "loop"].includes(last.beat) || /\bnext\b|\bwatch\b|\bby\s+\d|\bon\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(last.text || ""),
    `last narration line (${last.beat || "no beat"}): "${String(last.text || "").slice(0, 90)}"`);
  // Real-footage share: FLAG only (DrJ 2 Oct 2026). Real = footage, photos, satellite.
  flag("visuals", !(hasVideo && realShare < 0.6), `real footage/photos ${Math.round(100 * realShare)}% of screen time (flag below 60% when footage exists)`);
}

// ─── Rule 0 again, independently ───────────────────────────────────────────
const r0 = spawnSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), "rule0.mjs"), "film", dir], { encoding: "utf8" });
check("Rule 0 re-run", r0.status === 0, r0.stdout.trim().slice(0, 300));

const pass = checks.every((c) => c.result === "pass");
writeFileSync(f("gate-qa.json"), JSON.stringify({ gate: "qa", pass, checks, playbook }, null, 1));
console.log(JSON.stringify({ gate: "qa", pass, failed: checks.filter((c) => c.result !== "pass").map((c) => c.name), playbook_misses: playbook.filter((p) => !p.met).map((p) => `rule ${p.rule}: ${p.evidence}`) }));
process.exit(pass ? 0 : 4);
