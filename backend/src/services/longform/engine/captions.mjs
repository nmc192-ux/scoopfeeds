// Word-synced captions: text that lands ON THE WORD, not on the slide boundary.
//
// The longform film has never had burned captions. It emits a sidecar .srt at
// one-cue-per-beat granularity — fine for accessibility, useless as motion. This
// module is the other thing: a caption that arrives word by word, in time with
// the voice, which is the single biggest difference between "video essay" and
// "slideshow with narration".
//
// PURE ON PURPOSE. Planning and layout are separated from rendering and ffmpeg
// so they can be tested without building a film, the same split parallax.mjs
// uses. Nothing here touches the filesystem or spawns anything.
//
// ── The timing source ───────────────────────────────────────────────────────
//
// narrate.mjs writes a `<take>.words.json` sidecar when ElevenLabs returns a
// character alignment, and writes NOTHING when it does not. That absence is
// load-bearing: it is the difference between "we know when this word was said"
// and "we do not". Everything here consumes real per-word times or declines to
// produce captions at all.
//
// THE ONE THING THIS MUST NEVER DO IS INVENT TIMINGS. Spreading a beat's words
// evenly across its duration produces captions that look word-synced, drift
// against the voice by a syllable or two, and are indistinguishable from the
// real thing in a screenshot. That is worse than no captions, because it cannot
// be spotted in review — only felt as the film being subtly "off". If there are
// no word times, there are no word-synced captions for that beat, and the
// caller is told which beats those were.
//
// ── Why words are laid out from measured widths ─────────────────────────────
//
// Each word is rendered as its own transparent PNG and overlaid at a computed
// position, rather than re-rendering the whole caption once per revealed word.
// Two reasons, one practical and one about correctness:
//
//   · A word is rendered once and cached by (text, style). English is repetitive
//     enough that a 14-minute film of ~2,100 spoken words resolves to a few
//     hundred distinct renders. Re-rendering whole chunks per state would be
//     thousands, through a renderer that leaks ~8.8 MB a frame.
//
//   · Laying out from the ACTUAL rendered widths means the line breaks are
//     measured, not estimated. A character-count estimate is wrong for exactly
//     the words this film says most often — "xylitol", "erythritol",
//     "cardiovascular" — and a wrong estimate shows up as a caption that
//     overflows the safe area on the one beat that matters.

/** Round to the millisecond — the finest resolution that reaches ffmpeg. */
const ms = (t) => Math.round(t * 1000) / 1000;

/** Sentence-final punctuation forces a chunk break: captions respect clauses. */
const HARD_BREAK = /[.!?]["')\]]?$/;
/** A comma or dash is a soft break — allowed to end a chunk, never forced to. */
const SOFT_BREAK = /[,;:—–-]["')\]]?$/;

export const CAPTION_DEFAULTS = {
  maxWords: 4,      // a caption is a glance, not a line of prose
  maxChars: 28,     // measured against the 1920 safe area at the caption size
  gapBreak: 0.45,   // a pause this long is a natural caption boundary
  holdAfter: 0.28,  // how long the finished chunk stays up after its last word
  minChunk: 0.55,   // a chunk shorter than this is a flash; merge it forward
};

/**
 * Group timed words into caption chunks.
 *
 * @param {{word:string,start:number,end:number}[]} words  take-relative times
 * @param {object} [opt] overrides for CAPTION_DEFAULTS
 * @returns {{start:number,end:number,words:object[]}[]}
 */
export function planCaptions(words, opt = {}) {
  const o = { ...CAPTION_DEFAULTS, ...opt };
  if (!Array.isArray(words) || !words.length) return [];

  const chunks = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    chunks.push({
      start: cur[0].start,
      end: cur[cur.length - 1].end + o.holdAfter,
      words: cur,
    });
    cur = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur[cur.length - 1];
    const chars = cur.reduce((n, x) => n + x.word.length + 1, 0) + w.word.length;

    // A pause in the DELIVERY is the most reliable caption boundary there is —
    // it is where the speaker themselves broke the thought. Checked before the
    // size limits so a natural break is never overridden by a full chunk.
    const gap = prev ? w.start - prev.end : 0;
    if (prev && (gap >= o.gapBreak || chars > o.maxChars || cur.length >= o.maxWords)) flush();

    cur.push(w);
    if (HARD_BREAK.test(w.word)) flush();
    else if (SOFT_BREAK.test(w.word) && cur.length >= o.maxWords - 1) flush();
  }
  flush();

  // A chunk too short to read is a flash. Merge it into its neighbour rather
  // than showing it — but only when the merge does not itself break the size
  // limits, otherwise a run of short chunks would concatenate into a paragraph.
  const out = [];
  for (const c of chunks) {
    const last = out[out.length - 1];
    const tooShort = c.end - o.holdAfter - c.start < o.minChunk;
    const fits = last
      && last.words.length + c.words.length <= o.maxWords + 1
      && last.words.concat(c.words).reduce((n, x) => n + x.word.length + 1, 0) <= o.maxChars + 6;
    if (tooShort && fits) {
      last.words = last.words.concat(c.words);
      last.end = c.end;
    } else out.push(c);
  }
  return out;
}

/**
 * Lay a chunk's words out into centred lines from their MEASURED widths.
 *
 * @param {{word:string}[]} words
 * @param {number[]} widths   rendered pixel width per word, same order
 * @param {object} o
 * @param {number} o.maxWidth  the safe-area width the caption must fit
 * @param {number} o.space     pixels between words
 * @param {number} o.lineH     line height in pixels
 * @returns {{x:number,y:number,w:number,line:number}[]} positions, top-left
 *          origin, relative to the caption block's own bounding box
 */
export function layoutChunk(words, widths, { maxWidth, space, lineH }) {
  if (words.length !== widths.length) {
    throw new Error(`layoutChunk: ${words.length} words but ${widths.length} widths`);
  }
  // Greedy wrap. A word wider than the whole safe area still gets its own line
  // rather than being dropped — it will overflow, and that is a visible, fixable
  // problem, where a silently dropped word is neither.
  const lines = [];
  let line = [];
  let w = 0;
  for (let i = 0; i < words.length; i++) {
    const add = (line.length ? space : 0) + widths[i];
    if (line.length && w + add > maxWidth) { lines.push({ items: line, w }); line = []; w = 0; }
    line.push(i);
    w += line.length === 1 ? widths[i] : add;
  }
  if (line.length) lines.push({ items: line, w });

  const pos = [];
  lines.forEach((ln, li) => {
    let x = (maxWidth - ln.w) / 2;          // centred within the safe area
    for (const i of ln.items) {
      pos[i] = { x: Math.round(x), y: li * lineH, w: widths[i], line: li };
      x += widths[i] + space;
    }
  });
  return pos;
}

/**
 * Build the overlay chain that burns one shot's captions onto a video label.
 *
 * Each word is its OWN overlay with its own `enable` window, which is what
 * makes the caption arrive word by word without a render per state. The word
 * appears at its spoken time and every word in a chunk leaves together at the
 * chunk's end, so the caption reads as one settling phrase rather than a
 * conveyor belt.
 *
 * @param {object} o
 * @param {string} o.inLabel     e.g. "v" for [v]
 * @param {string} o.outLabel
 * @param {number} o.firstInput  ffmpeg input index of the first word PNG
 * @param {{start:number,chunkEnd:number,x:number,y:number}[]} o.placements
 *        shot-relative seconds and absolute frame pixel positions
 * @returns {string} filter_complex fragment, or "" when there is nothing to draw
 */
export function captionFilter({ inLabel, outLabel, firstInput, placements }) {
  if (!placements.length) return "";
  const parts = [];
  let cur = inLabel;
  placements.forEach((p, i) => {
    const next = i === placements.length - 1 ? outLabel : `${outLabel}${i}`;
    // eof_action=repeat holds the single decoded PNG frame for the whole shot,
    // so the still is not re-decoded and re-scaled on every output frame.
    // `enable` is what gates it to the word's own window.
    parts.push(
      `[${cur}][${firstInput + i}:v]overlay=x=${Math.round(p.x)}:y=${Math.round(p.y)}`
      + `:eof_action=repeat:enable='between(t,${p.start.toFixed(3)},${p.chunkEnd.toFixed(3)})'[${next}]`,
    );
    cur = next;
  });
  return parts.join(";");
}

/**
 * Turn planned chunks into shot-relative placements, dropping anything outside
 * the shot. A beat split into fragments encodes each fragment separately, so a
 * caption belonging to a later fragment must not be drawn on this one.
 *
 * @param {object} o
 * @param {{start:number,end:number,words:object[]}[]} o.chunks take-relative
 * @param {number} o.offset   seconds to add to reach film/shot time
 * @param {number} o.shotFrom shot start in the same clock as offset+start
 * @param {number} o.shotTo   shot end
 * @returns {{word:string,start:number,chunkEnd:number,ci:number,wi:number}[]}
 */
export function placeInShot({ chunks, offset, shotFrom, shotTo }) {
  const out = [];
  chunks.forEach((c, ci) => {
    const cs = c.start + offset;
    const ce = c.end + offset;
    // Any overlap at all keeps the chunk: a caption straddling a cut should
    // continue across it, not vanish because its start was on the other side.
    if (ce <= shotFrom || cs >= shotTo) return;
    c.words.forEach((w, wi) => {
      const ws = w.start + offset;
      if (ws >= shotTo) return;
      out.push({
        word: w.word,
        // Clamp into the shot: a word that began before this fragment is
        // already on screen when the fragment opens, so it starts at 0.
        //
        // ROUNDED TO THE MILLISECOND, because subtracting the shot start is
        // lossy in binary floating point: the same word at offset 0 gave 0.3
        // and at offset 10 gave 0.29999999999999893. These times reach ffmpeg
        // through toFixed(3) regardless, so rounding here costs nothing and
        // makes a placement depend only on where the word sits in the shot —
        // not on how far into the film the shot happens to be.
        start: ms(Math.max(0, ws - shotFrom)),
        chunkEnd: ms(Math.min(shotTo, ce) - shotFrom),
        ci, wi,
      });
    });
  });
  return out;
}
