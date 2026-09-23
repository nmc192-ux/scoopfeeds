/**
 * videoWordCaptions.js — word-by-word burned captions, timed to the narration.
 *
 * The shot-engine brief (docs/briefs/shot-engine-shorts.md §1.5): chunks of up
 * to three words, the word being spoken in lime, Anton with a heavy black
 * stroke, suppressed where big type already says the words. The approved
 * Greenland sample did exactly this (docs/reference/shot-engine/short.py,
 * `captions`), and the chunking rule below is that one, ported.
 *
 * DARK. On only when VIDEO_WORD_CAPTIONS_ENABLED=1 or VIDEO_SHOT_ENGINE_ENABLED=1.
 * Off, the slide graph is byte-for-byte what it was.
 *
 * THE TIMINGS ARE THE ONES VOICE ALREADY CARRIES (#141): videoVoice groups
 * ElevenLabs' per-character alignment into words and caches them beside the
 * clip. A clip with no sidecar (cached before timestamps, or the plain-endpoint
 * fallback) gets no captions on that slide — never guessed timings. A caption
 * that lands on the wrong word is worse than none.
 *
 * DRAWN BY SATORI, NOT BY FFMPEG. drawtext needs libfreetype and `subtitles`
 * needs libass, and neither is guaranteed: the Homebrew ffmpeg on the dev Mac
 * has neither. Each (chunk, active word) state is a transparent PNG strip from
 * the same renderer the cards use, sequenced with the concat demuxer into a
 * stream that covers the whole slide, and overlaid with no time term in the
 * graph. Same pixels on every machine.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { logger } from "./logger.js";
import { renderTreeToPng, FONT_ANTON } from "./renderCore.js";

// ─── Look, from the brief's safe zones (§1.6) and the reference ─────────────
export const CAPTION_TOP_Y = 1190;          // captions start at y 1190
export const STRIP_H = 170;                 // 1190..1360 — clear of the 1440 platform ceiling
const STRIP_W = 1080;
const SIDE_MARGIN = 54;
const FONT_SIZE = 92;
const STROKE_PX = 14;                       // satori strokes on the outline; 14 centred ≈ PIL's 7 outside
const LIME = "#dde706";
const WHITE = "#ffffff";

// Chunking, as in the reference: at most three words, and a chunk closes after
// punctuation or once it runs past 14 characters.
export const MAX_CHUNK_WORDS = 3;
export const MAX_CHUNK_CHARS = 14;
// A word lights a hair before it is heard; a chunk lingers after its last word
// only until the next one starts.
const LEAD_SECS = 0.05;
const LINGER_SECS = 0.6;

export function wordCaptionsEnabled() {
  return process.env.VIDEO_WORD_CAPTIONS_ENABLED === "1" || process.env.VIDEO_SHOT_ENGINE_ENABLED === "1";
}

export const normWord = (w) => String(w || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Words → chunks of at most three, closing on punctuation or past 14 chars. */
export function chunkWords(words) {
  const chunks = [];
  let cur = [];
  for (const w of words || []) {
    if (!w || !String(w.word || "").trim()) continue;
    cur.push(w);
    const joined = cur.map((x) => x.word).join(" ");
    if (/[.?!,:;]["”’)]*$/.test(w.word) || joined.length > MAX_CHUNK_CHARS || cur.length >= MAX_CHUNK_WORDS) {
      chunks.push(cur); cur = [];
    }
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/**
 * The words the card already shows in big type. A chunk made only of these is
 * suppressed: the viewer is reading the same words at 300px, and a caption
 * repeating them underneath costs attention for nothing (the brief's
 * suppression rule, and the same finding as captionForCard's Gate C dedupe).
 */
export function displayWordSet(card = {}) {
  const parts = [];
  const push = (v) => { if (v) parts.push(String(Array.isArray(v) ? v[0] : v)); };
  if (Array.isArray(card.lines)) card.lines.forEach(push);
  push(card.title); push(card.phrase); push(card.value); push(card.label);
  return new Set(parts.join(" ").split(/\s+/).map(normWord).filter(Boolean));
}

function chunkIsOnScreen(chunk, onScreen) {
  if (!onScreen?.size) return false;
  const ws = chunk.map((w) => normWord(w.word)).filter(Boolean);
  return ws.length > 0 && ws.every((w) => onScreen.has(w));
}

/**
 * The slide's caption timeline: contiguous segments from 0 to slideSecs, each
 * either a gap or one (chunk, active word) state. Contiguity is the contract
 * with the concat demuxer — every second of the slide is accounted for.
 */
export function captionTimeline(words, { slideSecs, onScreen = null } = {}) {
  const chunks = chunkWords(words);
  const raw = [];
  chunks.forEach((ch, ci) => {
    if (chunkIsOnScreen(ch, onScreen)) return;
    const next = chunks[ci + 1];
    const chunkEnd = Math.min(
      next ? next[0].start - LEAD_SECS : Infinity,
      ch[ch.length - 1].end + LINGER_SECS,
    );
    ch.forEach((w, j) => {
      const start = Math.max(0, w.start - LEAD_SECS);
      const end = j + 1 < ch.length ? Math.max(start, ch[j + 1].start - LEAD_SECS) : chunkEnd;
      if (end > start) raw.push({ start, end, chunk: ci, active: j });
    });
  });

  const segs = [];
  let t = 0;
  for (const s of raw) {
    const start = Math.max(s.start, t);
    const end = Math.min(s.end, slideSecs);
    if (end <= start) continue;
    if (start > t) segs.push({ start: t, end: start, gap: true });
    segs.push({ ...s, start, end });
    t = end;
  }
  if (t < slideSecs) segs.push({ start: t, end: slideSecs, gap: true });
  return { chunks, segments: segs };
}

/** Display form: upper case, trailing soft punctuation dropped (as the reference). */
export const displayWord = (w) => String(w).replace(/[,;:]+$/, "").toUpperCase();

/** One caption strip: the chunk, with word `active` lit. Transparent ground. */
export function captionTree(chunk, active) {
  const texts = chunk.map((w) => displayWord(w.word));
  const chars = texts.join(" ").length;
  // A long single word must still fit the measure; scale type rather than clip.
  const fontSize = chars > 17 ? Math.floor(FONT_SIZE * 17 / chars) : FONT_SIZE;
  return {
    type: "div",
    props: {
      style: {
        width: STRIP_W, height: STRIP_H, display: "flex", justifyContent: "center", alignItems: "center",
        paddingLeft: SIDE_MARGIN, paddingRight: SIDE_MARGIN, fontFamily: "Anton", fontSize,
      },
      children: texts.map((t, j) => ({
        type: "span",
        props: {
          style: {
            color: j === active ? LIME : WHITE,
            WebkitTextStroke: `${STROKE_PX}px #000`, paintOrder: "stroke fill",
            marginLeft: j ? Math.round(fontSize * 0.24) : 0,
          },
          children: t,
        },
      })),
    },
  };
}

/**
 * Build one slide's caption stream: PNG strips plus a concat list.
 *
 * @returns {Promise<{listPath: string, y: number, shown: number, suppressed: number} | null>}
 *          null when there is nothing to caption (no timings, or all suppressed).
 */
export async function buildWordCaptionTrack({ words, card, slideSecs, workDir, slideIndex }) {
  if (!Array.isArray(words) || !words.length) return null;
  if (!FONT_ANTON) { logger.warn("💬 word captions: Anton missing — no captions"); return null; }

  const onScreen = displayWordSet(card);
  const { chunks, segments } = captionTimeline(words, { slideSecs, onScreen });
  const shown = new Set(segments.filter((s) => !s.gap).map((s) => s.chunk)).size;
  const suppressed = chunks.length - shown;
  if (!shown) return null;

  const dir = path.join(workDir, `wc${String(slideIndex).padStart(2, "0")}`);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const blank = path.join(dir, "blank.png");
  writeFileSync(blank, await renderTreeToPng(
    { type: "div", props: { style: { width: STRIP_W, height: STRIP_H, display: "flex" } } },
    { width: STRIP_W, height: STRIP_H },
  ));

  const rendered = new Map();
  const lines = [];
  const quote = (p) => `'${String(p).replace(/'/g, `'\\''`)}'`;
  let lastFile = blank;
  for (const s of segments) {
    let file = blank;
    if (!s.gap) {
      const k = `${s.chunk}-${s.active}`;
      if (!rendered.has(k)) {
        const f = path.join(dir, `c${String(s.chunk).padStart(3, "0")}-${s.active}.png`);
        writeFileSync(f, await renderTreeToPng(captionTree(chunks[s.chunk], s.active), { width: STRIP_W, height: STRIP_H }));
        rendered.set(k, f);
      }
      file = rendered.get(k);
    }
    lines.push(`file ${quote(file)}`, `duration ${(s.end - s.start).toFixed(3)}`);
    lastFile = file;
  }
  // The concat demuxer ignores the last entry's duration unless the file is
  // listed once more after it.
  lines.push(`file ${quote(lastFile)}`);
  const listPath = path.join(dir, "captions.txt");
  writeFileSync(listPath, lines.join("\n") + "\n");

  logger.info(
    `💬 slide ${slideIndex}: word captions — ${shown} chunk(s) shown, ${suppressed} suppressed as on-screen, ` +
    `${rendered.size} strip(s)`
  );
  return { listPath, y: CAPTION_TOP_Y, shown, suppressed };
}
