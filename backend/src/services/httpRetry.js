// Transient network failures, named and retried.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
//
// Ten cross-posts have been lost to the message "fetch failed" — Threads 6,
// Instagram 3, Bluesky 1 — plus three Facebook uploads to "The operation was
// aborted due to timeout". Every one of them recorded a permanent `failed` for
// what is almost certainly a momentary network fault.
//
// TWO SEPARATE DEFECTS, and the first is why the second went unfixed:
//
//   1. "fetch failed" says nothing. Node's fetch throws a generic Error and
//      puts the actual reason — ECONNRESET, ETIMEDOUT, EAI_AGAIN, socket hang
//      up — in `err.cause`, which every client here discarded. Weeks of
//      failures logged a string with no information in it, so nobody could tell
//      a DNS blip from a dead endpoint from a firewall.
//
//   2. Nothing retried. A cross-post runs once, and a single dropped TCP
//      connection permanently loses a video from that channel. These are not
//      rate limits or bad requests; they are the network being the network.
//
// WHAT IS DELIBERATELY *NOT* RETRIED: anything that reached the server and came
// back with an answer. An HTTP 4xx is a decision, and repeating a request the
// API already rejected wastes quota and — on a publish endpoint — risks a
// duplicate post. Only failures where no response was received at all qualify.

import { logger } from "./logger.js";

/**
 * The real reason behind a generic fetch error.
 *
 * Node wraps the cause one or two levels deep. `AbortSignal.timeout` produces a
 * TimeoutError with no cause at all, so its name is the information.
 */
export function describeFetchFailure(err) {
  const parts = [];
  let e = err, depth = 0;
  while (e && depth++ < 4) {
    const bit = [e.code, e.name && e.name !== "Error" ? e.name : null, e.message]
      .filter(Boolean).join(" ");
    if (bit && !parts.includes(bit)) parts.push(bit);
    e = e.cause;
  }
  return parts.join(" ← ") || String(err);
}

/** Codes that mean "the request never got an answer", so repeating it is safe. */
const TRANSIENT = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND",
  "EPIPE", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
]);

/** Certificate and TLS faults: repeating them cannot help. */
const PERMANENT = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|DEPTH_ZERO/i;

export function isTransientNetworkError(err) {
  // A response that arrived is never transient, whatever it said.
  if (err?.statusCode || err?.status) return false;

  // Walk the WHOLE chain first. "fetch failed" is the outermost message for
  // every network fault, so deciding on it before looking underneath would
  // classify a certificate error as a blip and retry it three times. The
  // information is always in the cause, which is the reason this module exists.
  const chain = [];
  for (let e = err, d = 0; e && d < 4; e = e.cause, d++) chain.push(e);
  if (chain.some(e => PERMANENT.test(String(e.code || "")) || PERMANENT.test(String(e.name || "")))) return false;

  return chain.some(e =>
    TRANSIENT.has(e.code) ||
    e.name === "TimeoutError" || e.name === "AbortError" ||
    (typeof e.message === "string" &&
      /socket hang up|fetch failed|network|aborted due to timeout/i.test(e.message)));
}

/**
 * Run `fn`, retrying only genuine network faults.
 *
 * Small, bounded, and loud. Three attempts over roughly four seconds — enough
 * to ride out a dropped connection, short enough that a real outage still fails
 * the cross-post inside the render cycle rather than holding the BullMQ lock.
 */
export async function withNetworkRetry(fn, { attempts = 3, label = "request", baseDelayMs = 800 } = {}) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isTransientNetworkError(err) || i === attempts) break;
      const wait = baseDelayMs * i;
      logger.warn(`↻ ${label}: ${describeFetchFailure(err)} — retry ${i}/${attempts - 1} in ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  // Re-throw with the cause spelled out, so a permanent failure records WHY
  // rather than "fetch failed".
  if (isTransientNetworkError(last)) {
    const e = new Error(`${label}: ${describeFetchFailure(last)} (after ${attempts} attempts)`);
    e.cause = last;
    e.transient = true;
    throw e;
  }
  throw last;
}

// ─── deadlines ──────────────────────────────────────────────────────────────

/**
 * The default every outbound call should have had.
 *
 * Node's fetch has NO timeout. Four of six social clients called it with no
 * AbortSignal, so a connection that stalls parks that call forever — and
 * because the cross-posts run in sequence, one stall starves every channel
 * after it. Observed 2026-08-25: a video published, Facebook posted, Instagram
 * went `pending`, and Threads / Bluesky / TikTok / X were never attempted at
 * all. The worker was not deadlocked; it moved on to other cron work and left
 * that chain parked.
 */
export const FETCH_TIMEOUT_MS = Number.parseInt(process.env.SOCIAL_FETCH_TIMEOUT_MS || "60000", 10);

export const fetchTimeout = (ms = FETCH_TIMEOUT_MS) => AbortSignal.timeout(ms);

/**
 * A hard ceiling on one channel, so it cannot consume another's turn.
 *
 * Per-call timeouts are necessary and not sufficient: a client that makes
 * fifteen bounded calls in a poll loop can still run for minutes. This bounds
 * the WHOLE attempt. It rejects rather than resolving, so the caller's existing
 * never-throws guard records a failure for that channel and the chain proceeds
 * to the next one — which is the behaviour that was missing.
 */
export async function withDeadline(promise, ms, label = "channel") {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error(
          `${label}: exceeded its ${Math.round(ms / 1000)}s budget — abandoned so the remaining channels still run`
        )), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
