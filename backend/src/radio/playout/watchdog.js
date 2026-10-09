/**
 * watchdog.js - keep a unit alive: restart it with exponential backoff when it dies.
 *
 * `start()` launches the unit and returns `{ exited: Promise<{ reason: string }>, stop(): Promise<void> }`.
 * A unit that stays up for `healthyMs` is considered recovered and the backoff resets, so one
 * crash a day costs 1 s, not the 60 s a crash loop has earned.
 * `sleep` and `now` are injectable so the tests need no real time.
 */
export const BACKOFF = Object.freeze({ initialMs: 1000, factor: 2, maxMs: 60_000, healthyMs: 60_000 });

export function nextDelay(attempt, { initialMs, factor, maxMs } = BACKOFF) {
  return Math.min(maxMs, initialMs * Math.pow(factor, attempt));
}

/**
 * @param {() => Promise<{exited: Promise<{reason:string}>, stop: () => Promise<void>}>} start
 * @param {{ maxRestarts?: number, backoff?: object, sleep?: (ms:number)=>Promise<void>, now?: ()=>number,
 *           log?: (msg:string)=>void, signal?: AbortSignal }} [opts]
 * @returns {Promise<{ restarts: number, reason: string }>} resolves when stopped via `signal` or when
 *          maxRestarts is exhausted (reason "gave-up"); resolves "completed" if a unit ends with reason "completed".
 */
export async function supervise(start, {
  maxRestarts = Infinity, backoff = BACKOFF, signal,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now, log = () => {},
} = {}) {
  let restarts = 0;
  let attempt = 0;
  for (;;) {
    if (signal?.aborted) return { restarts, reason: "stopped" };
    const startedAt = now();
    let unit;
    try {
      unit = await start();
    } catch (err) {
      unit = { exited: Promise.resolve({ reason: `start-failed: ${err.message}` }), stop: async () => {} };
    }
    const onAbort = () => unit.stop().catch(() => {});
    signal?.addEventListener("abort", onAbort, { once: true });
    const { reason } = await unit.exited;
    signal?.removeEventListener("abort", onAbort);
    await unit.stop().catch(() => {});   // never leave half a unit (browser without ffmpeg, or the reverse) running
    if (reason === "completed") return { restarts, reason };
    if (signal?.aborted) return { restarts, reason: "stopped" };
    if (now() - startedAt >= backoff.healthyMs) attempt = 0;
    if (restarts >= maxRestarts) { log(`watchdog: giving up after ${restarts} restart(s); last: ${reason}`); return { restarts, reason: "gave-up" }; }
    const delay = nextDelay(attempt, backoff);
    log(`watchdog: unit died (${reason}); restart #${restarts + 1} in ${delay} ms`);
    attempt++; restarts++;
    await sleep(delay);
  }
}
