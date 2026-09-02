// Splice word-synced captions into a shot's existing filter chain.
//
// This is the piece that connects captions.mjs (when and where) and
// captionRender.mjs (what it looks like) to build.mjs (the actual film).
//
// IT APPENDS TO THE SHOT'S OWN CHAIN rather than re-encoding the finished shot.
// Both shotStill and shotCard end their filter_complex on [v] and then map it,
// so captions become extra inputs and extra overlays on that same graph. A
// second pass over the encoded shot would be simpler to write and would cost a
// whole extra generation of H.264 on every shot in the film, for nothing.
//
// Burning per shot rather than once over the finished timeline is not a
// convenience either: a 14-minute film is ~2,100 spoken words, and one overlay
// per word in a single graph is ~2,100 ffmpeg inputs — past the open-file limit
// on most boxes, and unreadable when it fails. A shot holds about a dozen.

import { existsSync, readFileSync } from "fs";
import { planCaptions, layoutChunk, placeInShot, captionFilter } from "./captions.mjs";
import { renderWord, CAPTION_STYLE } from "./captionRender.mjs";

/** Where captions sit in the frame. */
export const CAPTION_BOX = Object.freeze({
  safeW: 1360,          // centred in 1920 → 280px margins
  lineH: 78,
  bottomPad: 150,       // gap from the last line to the frame's bottom edge
  space: 18,            // between words on a line
});

/**
 * The words file that rides with a take, or null.
 *
 * narrate.mjs writes `<take>.words.json` ONLY when ElevenLabs returned a
 * character alignment, and writes nothing when it did not. That absence is the
 * signal, and it is the whole reason this returns null instead of estimating:
 * evenly spreading a beat's words across its duration produces captions that
 * look synced, drift by a syllable, and cannot be caught in review.
 */
export function wordsFileFor(audioPath) {
  if (!audioPath) return null;
  const f = audioPath.replace(/\.mp3$/, ".words.json");
  return existsSync(f) ? f : null;
}

/**
 * Build the caption overlay layer for one shot.
 *
 * @param {object} o
 * @param {object} o.shot        a build.mjs plan entry
 * @param {number} o.nextInput   ffmpeg input index the first word PNG takes
 * @param {string} o.inLabel     the chain's current video label (usually "v")
 * @param {string} o.wordsDir    where cached word PNGs live
 * @returns {Promise<{args:string[], filter:string, label:string, words:number,
 *                    skipped:string|null}>}
 */
export async function captionLayer({ shot, nextInput, inLabel = "v", wordsDir, style = CAPTION_STYLE }) {
  const none = (skipped) => ({ args: [], filter: "", label: inLabel, words: 0, skipped });

  if (!shot.text || !shot.audio) return none(null);      // title/outro carry no narration
  const wf = wordsFileFor(shot.audio);
  if (!wf) return none("no .words.json — this take has no word timings");

  let words;
  try { words = JSON.parse(readFileSync(wf, "utf8")); } catch (e) { return none(`unreadable words file: ${e.message}`); }
  if (!Array.isArray(words) || !words.length) return none("empty words file");

  const chunks = planCaptions(words);
  const audioStart = shot.audioStart || 0;
  const lead = shot.audioLead || 0;
  const placed = placeInShot({
    chunks, offset: lead, shotFrom: audioStart, shotTo: audioStart + shot.seconds,
  });
  if (!placed.length) return none(null);

  // Lay out the WHOLE chunk, not only the words visible in this shot. A caption
  // straddling a cut must keep the same word positions on both sides of it —
  // laying out only the visible remainder would re-centre the line mid-caption
  // and read as the text jumping at the cut.
  const need = [...new Set(placed.map((p) => p.ci))];
  const layouts = new Map();
  for (const ci of need) {
    const cw = chunks[ci].words;
    const rendered = [];
    for (const w of cw) rendered.push(await renderWord(w.word, wordsDir, style));
    const pos = layoutChunk(cw, rendered.map((r) => r.width), {
      maxWidth: CAPTION_BOX.safeW, space: CAPTION_BOX.space, lineH: CAPTION_BOX.lineH,
    });
    layouts.set(ci, { pos, rendered, lines: Math.max(...pos.map((p) => p.line)) + 1 });
  }

  const args = [];
  const placements = [];
  const x0 = (1920 - CAPTION_BOX.safeW) / 2;
  placed.forEach((pl, i) => {
    const L = layouts.get(pl.ci);
    const box = L.pos[pl.wi];
    const r = L.rendered[pl.wi];
    // Bottom-anchored: a two-line caption grows UPWARD so its last line stays
    // the same distance from the frame edge as a one-line caption's. Growing
    // downward would push longer captions toward (and off) the bottom.
    const yTop = 1080 - CAPTION_BOX.bottomPad - L.lines * CAPTION_BOX.lineH;

    // INK BOUNDS ARE HORIZONTAL-ONLY. Subtracting `inkTop` here is what made
    // words on one line sit at different heights: ink is measured per word, so
    // "gum" (descender) and "cost" (none) have different top edges, and
    // aligning their INK tops shoves one up relative to the other. Every word
    // ends up hung from its own tallest pixel instead of from a shared baseline.
    //
    // The render canvas is the shared baseline. Every word is drawn into a box
    // of the same height with `alignItems: center`, so identical font metrics
    // put every glyph on the same baseline within its own PNG. Placing by the
    // CANVAS therefore aligns them by construction, and no metrics need to be
    // read back out of the font. Horizontal placement still uses inkLeft, where
    // per-word measurement is exactly what is wanted.
    const yCanvas = yTop + box.y - Math.round((r.canvasH - CAPTION_BOX.lineH) / 2);
    args.push("-i", r.file);
    placements.push({
      start: pl.start, chunkEnd: pl.chunkEnd,
      x: x0 + box.x - r.inkLeft,
      y: yCanvas,
    });
  });

  const label = `${inLabel}cap`;
  return {
    args,
    filter: captionFilter({ inLabel, outLabel: label, firstInput: nextInput, placements }),
    label,
    words: placements.length,
    skipped: null,
  };
}
