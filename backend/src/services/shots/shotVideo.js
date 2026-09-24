/**
 * shotVideo.js — the shot engine's render path (shot-engine brief, Phase 4). DARK:
 * produceVideo routes here only when VIDEO_SHOT_ENGINE_ENABLED=1.
 *
 *   voice (existing, with word timings) → one global word timeline →
 *   resolve every shot (resolver ladder, or the pre-resolved plan) →
 *   place each shot on its anchor word → sub-cut anything over 3 s →
 *   fetch only what is shown (clip windows, photos) → plan.json →
 *   Python render step (backend/shotengine) → narration + bed → MP4
 *
 * THE 3 s PACE IS ENFORCED HERE (DrJ, 24 Sep): the spec names the real picture
 * changes; a longer shot is sub-cut into a closer or alternate view of the SAME
 * subject — another vision-picked in-point of the same clip, or a tight
 * reframe of the same photo. Type cards (punch, headline, count, graphic) are
 * held, not cut: a card cut in half is two cards.
 *
 * NOTHING EDITORIAL IS DECIDED HERE. What to show was decided by the spec
 * (gated) and the resolver (gated); this file does timing and fetching, and
 * the Python step only draws.
 */

import path from "path";
import { mkdirSync, writeFileSync, existsSync, statSync } from "fs";
import { spawn, execFile } from "child_process";
import { logger } from "../logger.js";
import { slideTotalSecs } from "../videoAssembler.js";
import { getFFmpegPath } from "../videoGenerator.js";
import { tokens } from "../videoShotList.js";
import { looksNamed } from "../videoImageRelevance.js";
import { fetchWindow } from "./media.js";
import { fetchCommonsImage } from "./commons.js";
import { marinePlace, namedCore } from "./shotResolver.js";

export const MAX_SHOT_SECS = 3.0;
export const MIN_SUBCUT_SECS = 1.2;
export const END_CARD_SECS = 2.6;
export const HOOK_SECS = 4.2;
const HERE = path.dirname(new URL(import.meta.url).pathname);
export const ENGINE_DIR = path.resolve(HERE, "../../../shotengine");
export const enginePython = () => process.env.SHOT_ENGINE_PYTHON || "python3";

const LIME = [221, 231, 6], RED = [232, 64, 52];

// ─── Timeline ────────────────────────────────────────────────────────────────

/**
 * Every slide's start (slideTotalSecs accumulated — the same arithmetic the
 * music bed uses, so nothing re-models the timeline) and one global word list.
 */
export function buildTimeline(slides, audio) {
  const starts = []; const words = []; let t = 0;
  slides.forEach((s, i) => {
    starts.push(t);
    for (const w of audio[i]?.words || []) words.push({ w: w.word, s: +(t + w.start).toFixed(3), e: +(t + w.end).toFixed(3), slide: i });
    t += slideTotalSecs(audio[i].durationSecs);
  });
  return { starts, words, narrationSecs: t };
}

/**
 * The time a shot's anchor is spoken. The anchor was checked verbatim against
 * the caption at spec time; here it is located in the caption's RAW words (the
 * same whitespace split ElevenLabs' alignment used) and read off the timings.
 * If the alignment and the caption disagree on word count, the position is
 * scaled across the slide instead — logged, never silently wrong.
 */
export function anchorTime(slideIdx, caption, anchor, timeline, audio) {
  const raw = String(caption).trim().split(/\s+/);
  const norm = raw.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const want = tokens(anchor);
  let at = -1;
  for (let i = 0; i < raw.length && at < 0; i++) {
    if (!norm[i]) continue;
    let j = 0, k = i;
    while (j < want.length && k < raw.length) { if (!norm[k]) { k++; continue; } if (norm[k] !== want[j]) break; j++; k++; }
    if (j === want.length) at = i;
  }
  const start = timeline.starts[slideIdx];
  const sw = audio[slideIdx]?.words || [];
  if (at < 0) return null;
  if (sw.length === raw.length) return start + sw[at].start;
  logger.warn(`🎬 shot anchor: slide ${slideIdx} alignment has ${sw.length} words vs ${raw.length} in the caption — scaling`);
  return start + (at / Math.max(1, raw.length)) * (audio[slideIdx]?.durationSecs || 0);
}

// ─── Placement and sub-cutting ─────────────────────────────────────────────

export function placeShots(slides, resolved, timeline, audio) {
  const placed = [];
  for (const r of resolved) {
    const slide = slides[r.slide];
    const t = r.shot === 0 ? timeline.starts[r.slide] : anchorTime(r.slide, slide.caption, r.anchor, timeline, audio);
    if (t === null) { logger.warn(`🎬 shot ${r.slide}.${r.shot}: anchor "${r.anchor}" not located — merged into the previous shot`); continue; }
    placed.push({ ...r, t0: +t.toFixed(3) });
  }
  placed.sort((a, b) => a.t0 - b.t0);
  for (let i = 0; i < placed.length; i++) {
    const next = i + 1 < placed.length ? placed[i + 1].t0 : timeline.narrationSecs;
    placed[i].T = +(next - placed[i].t0).toFixed(3);
  }
  return placed.filter((p) => p.T > 0.05);
}

// Only deliberate punctuation is held: a punch card is two or three words and
// is meant to land as one beat. Everything else longer than MAX_SHOT_SECS is cut
// into VIEWS OF THE SAME SUBJECT (DrJ, 24 Sep) — measured on the Phase 4 samples,
// held maps and type cards ran 9–13 s and put the average shot at 3.7–5.0 s.
const HOLD_KINDS = new Set(["punch"]);
const TYPE_KINDS = new Set(["headline", "count", "graphic"]);
export const MIN_TYPE_VIEW_SECS = 2.4;   // a type view must stay up long enough to read

/**
 * Split a shot longer than MAX_SHOT_SECS into `view` 0, 1, 2 … of the same
 * subject. What a view IS depends on the shot — see buildPlan: another in-point
 * or a tighter crop (pictures), a closer framing or the next named place (maps),
 * a deeper zoom step (satellite), a push into the highlighted words (headline),
 * the settled figure over a picture (count), the next bar lit (graphic).
 */
export function subCut(shot) {
  if (shot.T <= MAX_SHOT_SECS + 0.25 || HOLD_KINDS.has(shot.kind)) return [{ ...shot, view: 0 }];
  const isType = TYPE_KINDS.has(shot.kind) || !shot.record;
  const minLen = isType ? MIN_TYPE_VIEW_SECS : MIN_SUBCUT_SECS;
  const n = Math.min(Math.ceil(shot.T / MAX_SHOT_SECS), Math.floor(shot.T / minLen));
  if (n < 2) return [{ ...shot, view: 0 }];
  const len = shot.T / n;
  return Array.from({ length: n }, (_, i) => ({ ...shot, t0: +(shot.t0 + i * len).toFixed(3), T: +len.toFixed(3), view: i, views: n }));
}

// ─── Assets ────────────────────────────────────────────────────────────────

async function fetchPhoto(rec, out, deps) {
  if (rec.rung === "incident" && rec.media_url && existsSync(rec.media_url)) return rec.media_url;
  const got = /wikimedia/.test(rec.media_url || "") ? await fetchCommonsImage(rec.media_url) : await deps.fetchImage(rec.media_url, rec.source_url);
  if (!got?.buf) return null;
  writeFileSync(out, got.buf);
  return out;
}

/** Fetch every distinct media record once. Returns Map(media_url → local path | null). */
export async function fetchAssets(placed, work, deps) {
  const local = new Map();
  let n = 0;
  for (const p of placed) {
    const rec = p.record;
    if (!rec || local.has(rec.media_url)) continue;
    const base = path.join(work, `a${String(n++).padStart(2, "0")}`);
    try {
      if (rec.kind === "clip") {
        if (rec.rung === "incident" && existsSync(rec.media_url)) { local.set(rec.media_url, { path: rec.media_url, offset: 0 }); continue; }
        // ONLY THE WINDOW: the padded span around the chosen in-points — never
        // the whole 1080p file (DrJ, 24 Sep).
        const pts = rec.in_points || [];
        const start = Math.max(0, Math.min(...pts.map((x) => x.window?.start ?? Math.max(0, x.t - 2))));
        const end = Math.max(...pts.map((x) => x.window?.end ?? x.t + 12));
        const out = `${base}.mp4`;
        await fetchWindow(rec.media_url, { start, end }, out);
        local.set(rec.media_url, existsSync(out) && statSync(out).size > 10_000 ? { path: out, offset: start } : null);
      } else if (rec.kind === "photo") {
        local.set(rec.media_url, await fetchPhoto(rec, `${base}.img`, deps));
      }
    } catch (err) {
      logger.warn(`🎬 asset ${String(rec.media_url).slice(0, 80)} failed — ${String(err.message).slice(0, 100)}`);
      local.set(rec.media_url, null);
    }
  }
  return local;
}

// ─── Numbers for count shots ─────────────────────────────────────────────────
const SMALL = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };
const SCALE = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
/** The first number spoken in a phrase: "seventy percent", "1.3 million", "twenty-six". */
export function firstNumber(text) {
  const ws = String(text).toLowerCase().replace(/-/g, " ").split(/\s+/).map((w) => w.replace(/[^a-z0-9.]/g, ""));
  for (let i = 0; i < ws.length; i++) {
    let v = null, j = i;
    if (/^\d+(\.\d+)?$/.test(ws[i])) { v = Number(ws[i]); j = i + 1; }
    else if (SMALL[ws[i]] !== undefined) {
      v = 0; let cur = 0;
      while (j < ws.length && (SMALL[ws[j]] !== undefined || ws[j] === "and")) { if (ws[j] === "hundred") cur *= 100; else if (ws[j] !== "and") cur += SMALL[ws[j]]; j++; }
      v = cur;
    }
    if (v === null) continue;
    let scale = 1;
    if (SCALE[ws[j]]) { scale = SCALE[ws[j]]; j++; }
    const pct = ws[j] === "percent";
    return { value: v, scale, pct, scaleWord: Object.keys(SCALE).find((k) => SCALE[k] === scale) || "" };
  }
  return null;
}

// ─── The plan ────────────────────────────────────────────────────────────────

function spokenSpan(p, words) {
  return words.filter((w) => w.s >= p.t0 - 0.05 && w.s < p.t0 + p.T).map((w) => w.w).join(" ");
}

function chromeFor(p, slide, first) {
  const c = {};
  if (slide.eyebrow) c.kick = slide.t === "turn" && first ? `The turn · ${slide.eyebrow}` : slide.eyebrow;
  if (slide.source) c.src = slide.source;
  if (p.record?.credit) c.cred = p.record.credit;
  return c;
}

/**
 * Turn placed, sub-cut shots into the renderer's plan. Every picture shot that
 * lost its asset (fetch failed) degrades to a graphic naming the subject —
 * logged, and counted by the caller as a card fallback.
 */
export function buildPlan({ segments, slides, timeline, local, article, attribution, firstPicture }) {
  const shots = [];
  const fallbacks = [];
  for (const p of segments) {
    const slide = slides[p.slide];
    const first = p.shot === 0 && p.view === 0;
    const base = { t0: p.t0, T: p.T, fresh: !p.view, ...chromeFor(p, slide, first) };
    const rec = p.record;
    const named = looksNamed(p.subject);
    const label = named && p.view === 0 ? [{ t: 0.3, text: String(p.subject).toUpperCase().slice(0, 34) }] : [];
    if (rec?.kind === "clip" && local.get(rec.media_url)) {
      const { path: file, offset } = local.get(rec.media_url);
      const pts = rec.in_points?.length ? rec.in_points : [{ t: offset }];
      const pt = pts[p.view % pts.length];
      // A second view of the same clip, when there is only one in-point, is
      // the same moment reframed closer — never a jump back in time.
      const tight = pts.length === 1 && p.view > 0;
      const start = Math.max(0, pt.t - offset + (tight ? p.view * MAX_SHOT_SECS : 0));
      const z = tight ? 1.35 : 1.0;
      shots.push({ ...base, kind: "clip", path: file, start, ymax: rec.crop?.ymax || 1.0, labels: label,
        cams: [[p.t0, 0.5, 0.5, z], [p.t0 + p.T, 0.5, 0.5, z * 1.03]] });
    } else if (rec?.kind === "photo" && local.get(rec.media_url)) {
      const views = [[[0.5, 0.5, 1.0], [0.5, 0.5, 1.06]], [[0.42, 0.45, 1.3], [0.46, 0.45, 1.36]], [[0.6, 0.5, 1.22], [0.56, 0.5, 1.28]]];
      shots.push({ ...base, kind: "photo", path: local.get(rec.media_url), kb: views[p.view % views.length], labels: label });
    } else if (rec?.kind === "satellite" && rec.coords?.lat !== undefined) {
      const { lat, lon, zoom = 12 } = rec.coords;
      const zEnd = Math.min(15, zoom + 1), zStart = Math.max(3, zEnd - 8);
      // Views step the zoom: each cut starts a little deeper than the last view ended.
      const n = p.views || 1, step = (zEnd - zStart) / n;
      const zs = zStart + p.view * step + (p.view > 0 ? 0.4 : 0), ze = zStart + (p.view + 1) * step;
      shots.push({ ...base, kind: "satellite", keys: [[p.t0, zs, lat, lon], [p.t0 + 0.3, zs, lat, lon], [p.t0 + p.T - 0.1, ze, lat, lon]],
        slabels: [{ lat, lon, text: String(p.subject).toUpperCase().slice(0, 30), pin: true, from_z: zStart + 3 }] });
    } else if (rec?.kind === "map") {
      const c = rec.coords || {};
      const codes = c.codes || [];
      const pins = [];
      for (const pl of c.places || []) if (pl.lat !== undefined && pl.lat !== null) pins.push({ lat: pl.lat, lon: pl.lon, t: p.t0 + 0.4, text: String(pl.name).toUpperCase() });
      if (!c.places && c.lat !== undefined && c.lat !== null) pins.push({ lat: c.lat, lon: c.lon, t: p.t0 + 0.4, text: String(p.subject).toUpperCase().slice(0, 30) });
      // Views: the whole subject, then closer — and on a multi-place map, each
      // named place in turn. Fills are already in on later views.
      const v = p.view || 0;
      const fillAt = (i) => (v === 0 ? +(p.t0 + 0.3 + i * 0.25).toFixed(2) : p.t0 - 1);
      const hi = Object.fromEntries(codes.map((iso, i) => [iso, [LIME, fillAt(i)]]));
      const located = (c.places || []).filter((pl) => pl.lat !== undefined && pl.lat !== null);
      const focus = v > 0 && located.length > 1 ? [located[(v - 1) % located.length].lat, located[(v - 1) % located.length].lon] : null;
      const zoom = [1.0, 0.55, 0.38, 0.75][v % 4];
      // FRAME TO THE FEATURE'S SCALE: a point with no country (a sea) was framed
      // at 18° and showed only water. Oceans need a continent in view; a strait
      // wants its two shores.
      // Looked up from the SUBJECT, not only the stored record: a record kept
      // from before the marine atlas existed carries no feature type (seen on
      // the Phase 4 samples: an ocean framed at 6°, all water).
      const marine = /marine (\w+)/.exec(c.how || "")?.[1] || (c.places || []).find((pl) => pl.marine)?.marine ||
        marinePlace(p.subject)?.kind || marinePlace(namedCore(p.subject) || "")?.kind;
      const minSpan = { ocean: 70, sea: 24, gulf: 18, bay: 14, strait: 7, channel: 8, canal: 5 }[marine] ?? 6;
      if (v > 0) for (const pin of pins) pin.t = p.t0 - 1;
      shots.push({ ...base, kind: "map", auto: true, codes, hi, pins, texts: [], zoom, min_span: minSpan, ...(focus ? { focus } : {}) });
    } else if (p.kind === "headline") {
      const words = String(article.title || "").split(/\s+/).slice(0, 15).join(" ");
      const spoken = new Set(tokens(spokenSpan(p, timeline.words)));
      const hl = String(article.title || "").split(/\s+/).filter((w) => spoken.has(w.toLowerCase().replace(/[^a-z0-9]/g, "")) && w.length > 3).slice(0, 4).join(" ");
      shots.push({ ...base, kind: "headline", outlet: attribution.publisher || article.source_name || "", headline: words,
        date: new Date(article.published_at || Date.now()).toISOString().slice(0, 10), hl,
        // View 0 is the whole clipping with the highlight sweeping in; later views push into the highlighted words.
        hl_at: p.view ? p.t0 - 1 : p.t0 + 0.8, zoom: p.view ? 1.3 : 1.0, bg: firstPicture || null, caps: false });
    } else if (p.kind === "punch") {
      shots.push({ ...base, kind: "punch", lines: [[p.t0 + 0.1, String(p.subject).toUpperCase().slice(0, 22), 150, LIME]], caps: false });
    } else if (p.kind === "count") {
      const n = slide.t === "stat" && typeof slide.value === "number"
        ? { value: slide.value, scaleWord: "", pct: /%|percent/i.test(slide.unit || "") }
        : firstNumber(spokenSpan(p, timeline.words));
      if (n) {
        const decimals = Number.isInteger(n.value) ? 0 : 1;
        shots.push({ ...base, kind: "count", value: n.value, decimals, suffix: n.pct ? "%" : "",
          // The unit is already on the number when it is a percentage — never "29%" over "% DECLINE".
          label: (slide.t === "stat" ? [slide.unit, ...(slide.lines || [])].filter(Boolean).join(" ") : `${n.scaleWord} ${p.subject}`.trim())
            .replace(/^\s*(%|percent)\s*/i, n.pct ? "" : "$1 ").trim(),
          t_start: p.t0 + 0.2, bg: firstPicture || null, settled: Boolean(p.view) });
      } else {
        shots.push({ ...base, kind: "graphic", title: p.subject }); if (!p.view) fallbacks.push(`${p.slide}.${p.shot} count→graphic (no number spoken)`);
      }
    } else if (p.kind === "graphic") {
      if (slide.t === "bars" && Array.isArray(slide.bars)) shots.push({ ...base, kind: "graphic", title: slide.eyebrow || p.subject, bars: slide.bars, hi: (p.view || 0) % slide.bars.length });
      else if (slide.t === "diagram" && Array.isArray(slide.nodes)) shots.push({ ...base, kind: "graphic", title: p.subject, lines: slide.nodes.map((n) => n[0]), hi: (p.view || 0) % slide.nodes.length });
      else shots.push({ ...base, kind: "graphic", title: p.subject });
    } else {
      // A picture shot with no picture: say so on screen with the subject, and count it.
      shots.push({ ...base, kind: "graphic", title: p.subject });
      if (!p.view) fallbacks.push(`${p.slide}.${p.shot} ${p.kind}→card (${rec ? "asset fetch failed" : "resolver found nothing"})`);
    }
  }
  return { shots, fallbacks };
}

export function endCardSources(article, attribution, placed) {
  const lines = [`${attribution.publisher || article.source_name} reporting`];
  const credits = [...new Set(placed.map((p) => p.record?.credit).filter(Boolean))];
  return [...lines, ...credits].slice(0, 8);
}

// ─── Run ─────────────────────────────────────────────────────────────────────

function run(bin, args, { cwd, timeout = 20 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const ch = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { ch.kill("SIGKILL"); reject(new Error(`${path.basename(bin)} timed out`)); }, timeout);
    ch.stdout.on("data", (d) => { out += d; });
    ch.stderr.on("data", (d) => { err += d; });
    ch.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`${path.basename(bin)} exit ${code}: ${err.slice(-400)}`)); });
  });
}

/** Render a plan with the Python step. Niced: this is the heaviest work the worker does. */
export async function renderPlan(plan, planPath, out, { mode = "render", extra = [] } = {}) {
  writeFileSync(planPath, JSON.stringify(plan));
  const py = enginePython();
  const args = [path.join(ENGINE_DIR, "render.py"), planPath, mode, out, ...extra];
  const stdout = await run("nice", ["-n", "10", py, ...args], { cwd: ENGINE_DIR });
  const last = stdout.trim().split("\n").pop();
  try { return JSON.parse(last); } catch { return { raw: last }; }
}

/** One narration track: each slide's clip padded to its slide length, plus the end card's silence. */
export async function buildNarration(audio, slides, total, out) {
  const ff = getFFmpegPath();
  const args = ["-v", "error", "-y"];
  audio.forEach((a) => args.push("-i", a.path));
  const parts = audio.map((a, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=${slideTotalSecs(a.durationSecs).toFixed(3)}[a${i}]`);
  const concat = `${audio.map((_, i) => `[a${i}]`).join("")}concat=n=${audio.length}:v=0:a=1,apad=whole_dur=${total.toFixed(3)}[out]`;
  args.push("-filter_complex", [...parts, concat].join(";"), "-map", "[out]", "-c:a", "pcm_s16le", out);
  await new Promise((res, rej) => execFile(ff, args, { timeout: 120000 }, (e, _o, se) => (e ? rej(new Error(String(se).slice(-300))) : res())));
  return out;
}

export async function muxNarration(video, narration, out) {
  const ff = getFFmpegPath();
  await new Promise((res, rej) => execFile(ff, ["-v", "error", "-y", "-i", video, "-i", narration, "-map", "0:v", "-map", "1:a",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart", out],
  { timeout: 180000 }, (e, _o, se) => (e ? rej(new Error(String(se).slice(-300))) : res())));
  return out;
}
