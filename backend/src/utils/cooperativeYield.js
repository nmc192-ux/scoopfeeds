/**
 * cooperativeYield.js — hand the event loop back, on a clock.
 *
 * WHY THIS EXISTS. The worker is one process with one JS thread, and
 * better-sqlite3 is synchronous. A long read-and-score loop therefore does not
 * merely run slowly alongside its neighbours — it runs INSTEAD of them, and
 * nothing else in the process gets a single tick until it returns.
 *
 * That is not a theory. On 2026-08-28 `events.promote` held the thread from
 * 00:33:58 to 00:54:23. Three RSS fetches that were in flight when it started
 * had each armed a 15-SECOND timeout; all three rejected in the SAME
 * millisecond, 20 minutes late, with the message "Request timed out after
 * 15000ms". The timers were correct. Nothing was there to run them. Measured
 * over 12 days, that shape repeated 44 times and `events.promote` occupied
 * 59.8% of wall-clock.
 *
 * THE COROLLARY IS THE IMPORTANT PART: **a timeout cannot fire on a
 * monopolised event loop.** Wrapping the victim in a `Promise.race` does not
 * bound it — the race's own timer starves alongside everything else, fires
 * late, and then aborts work that had already finished. Anything that must
 * hold under starvation has to be a `Date.now()` CHECK at a point the code
 * actually reaches, not a scheduled callback. This module is the other half of
 * that: it makes sure such points come around often enough to matter.
 *
 * TIME-BOXED, NOT COUNT-BOXED. "Yield every 500 items" bounds nothing — it is
 * a promise about iterations, and the cost of an iteration is exactly what
 * varies (a cluster with 4 articles and one with 400 are the same one item).
 * A time box bounds the thing we actually care about: how long any neighbour
 * can be kept waiting. Whatever the loop is doing, the block stays under
 * roughly `everyMs`.
 *
 * `setImmediate`, NOT `setTimeout(0)`. One turn through `setImmediate` lands in
 * the check phase, which means the loop has already run its timers phase and
 * its poll phase on the way there — so the starved `setTimeout` fires and the
 * pending socket data is read. That is precisely what the RSS timeouts and
 * BullMQ's lock renewal were waiting for.
 *
 * WHERE IT IS SAFE TO CALL. Between whole units of work in a read/score phase.
 * NOT in the middle of a sequence of writes that a reader must never observe
 * half-applied: yielding there converts "briefly inconsistent, unobservably"
 * into "briefly inconsistent, and now something else is running". The promoter
 * calls it in its candidate/scoring loops and deliberately never inside its
 * apply loops.
 */

/** Default block ceiling. Well under BullMQ's shortest lock-renewal interval. */
export const DEFAULT_YIELD_MS = 50;

/**
 * Build a yielder that surrenders the thread at most every `everyMs`.
 *
 * The returned function is cheap to call in a hot loop: on the common path it
 * is one `Date.now()` and a comparison, and it returns a resolved promise
 * rather than scheduling anything. Await it unconditionally; it decides.
 *
 * @param {object} [opts]
 * @param {number} [opts.everyMs]  ceiling on how long the thread is held
 * @param {() => number} [opts._now]      injected clock (tests)
 * @param {() => Promise<void>} [opts._pass] injected yield primitive (tests)
 * @returns {() => Promise<boolean>} resolves true if it actually yielded
 */
export function makeYielder({
  everyMs = DEFAULT_YIELD_MS,
  _now = Date.now,
  _pass = () => new Promise((resolve) => setImmediate(resolve)),
} = {}) {
  let last = _now();
  let yields = 0;

  const yielder = async () => {
    // A non-positive ceiling means "yield at every opportunity" — used by tests
    // and available as an escape hatch. It must not mean "never".
    if (everyMs > 0 && _now() - last < everyMs) return false;
    await _pass();
    last = _now();
    yields += 1;
    return true;
  };
  // Exposed so a cycle can report how much it actually stepped aside. A yielder
  // that reports zero over a 15-minute cycle is not installed, whatever the
  // code around it looks like.
  yielder.count = () => yields;
  return yielder;
}
