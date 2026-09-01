// One card's frame sequence, rendered in a PROCESS OF ITS OWN.
//
//   node renderFrames.mjs <job.json>      → prints the number of frames written
//
// WHY A SEPARATE PROCESS. @resvg/resvg-js 2.6.2 leaks native memory on every
// render and exposes no way to release it: there is no free(), no dispose(), no
// Symbol.dispose on either `Resvg` or `RenderedImage`, and forcing a full GC
// does not reclaim it either — so it is not a finalizer waiting to run, it is
// simply lost until the process exits.
//
// Measured on this engine's own cards, rendering the same card repeatedly:
//
//     40 frames   471 MB        satori alone, 150 renders:    98 MB  (flat)
//    120 frames  1155 MB        resvg  alone, 150 renders:  1405 MB  (linear)
//    240 frames  2175 MB
//
// ~8.8 MB per frame, linear, no plateau. A 46-card film is ~2,400 frames, so an
// in-process build needs ~21 GB and is killed long before it finishes. It died
// on a 7.8 GB box around frame 880 — which is exactly 15-20 cards in, where the
// progress counter had reached. Lowering concurrency does not help, because the
// leak accumulates with frames rendered, not with workers running.
//
// Exiting after each card hands the whole lot back to the OS. The cost is one
// node startup per card (~0.5s, ~25s across a film) against a render phase
// measured in tens of minutes, which is a trade worth making without thinking
// hard about it.
//
// THE FIX BELONGS HERE, NOT IN A VERSION BUMP. Upgrading resvg-js might also
// fix it, but this engine's card tests are recorded PNG hashes: a renderer
// upgrade changes pixels, and proving a new version is byte-identical across
// every card is a bigger piece of work than isolating a process. Revisit when
// there is a reason to move the version anyway.

import { mkdirSync, readFileSync } from "fs";
import path from "path";
import { renderCard, PAYOFF_P } from "./render.mjs";

/**
 * @param {object} job
 * @param {object} job.spec    the card
 * @param {string} job.dir     where the frames go
 * @param {boolean} job.payoff whether this card has a payoff phase
 * @param {number} job.enterN  entrance frame count (build.mjs owns the timing)
 * @param {number} job.payN    payoff frame count
 * @returns {Promise<number>} frames written
 */
export async function renderFrames({ spec, dir, payoff, enterN, payN }) {
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < enterN; i++) {
    const t = i / (enterN - 1);
    const p = payoff ? t * PAYOFF_P : t;
    await renderCard(spec, path.join(dir, `e${String(i).padStart(3, "0")}.png`), p);
  }
  if (!payoff) return enterN;
  for (let i = 0; i < payN; i++) {
    const t = i / (payN - 1);
    await renderCard(spec, path.join(dir, `p${String(i).padStart(3, "0")}.png`), PAYOFF_P + t * (1 - PAYOFF_P));
  }
  return enterN + payN;
}

// The job arrives as a FILE, not as argv. A card spec carries whole paragraphs
// (a quote card's text, a decay card's axis labels), and a film with a long
// enough spec would hit the argv length limit — a failure that would look like
// a spawn bug rather than a size one.
if (import.meta.url === `file://${process.argv[1]}`) {
  const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
  process.stdout.write(String(await renderFrames(job)));
}
