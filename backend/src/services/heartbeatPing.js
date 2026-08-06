/**
 * heartbeatPing.js — external dead-man switches for the scheduled cycles.
 *
 * THE ONLY SIGNAL THAT SURVIVES A DEAD PROCESS. Every in-process staleness
 * check has the same hole: it runs when the thing it monitors runs. The social
 * check is called from the top of the posting cycle and from the metrics route,
 * so a runner that stops firing produces exactly ONE warning — at recovery,
 * hours later, from the cycle that finally ran. Nothing fires *during* the
 * outage, because nothing is running to fire it. That is what an external
 * monitor is for: it notices the absence of a ping, which no amount of code
 * inside the absent process can do.
 *
 * START / SUCCESS PAIR, NOT ONE PING. A single ping at cycle start goes green
 * the moment the runner begins, so a cycle that starts, pings, then wedges on a
 * hung HTTP call holds the monitor green while nothing publishes — the exact
 * failure the switch exists to catch. `/start` on entry and the bare URL only
 * on successful completion means a hang shows as a start with no matching
 * success, and the monitor alerts on it.
 *
 * `/fail` IS THE THIRD STATE, and it covers what a dead-man switch structurally
 * misses: a cycle that runs to completion, on schedule, succeeding at being a
 * cycle while every unit of work inside it fails. A YouTube token that 401s
 * every upload keeps the cycle green for 17h. One article failing is an
 * ordinary bad news day; every attempt failing at the SAME stage is an
 * incident, and only the caller can tell those apart.
 *
 * NO ALERT STATE LIVES HERE — no cooldown, no dedupe, no first-transition-only.
 * Healthchecks.io (or any equivalent) already does edge-triggering, dedupe and
 * the re-arm ceiling, and does them across process restarts and deploys, which
 * an in-process table cannot. Rebuilding that here is how the per-platform
 * staleness warning became something to ignore.
 *
 * STRICTLY TELEMETRY. Unset → complete no-op. Never awaited, never throws,
 * every error swallowed, short timeout, and the timer unref'd. It must never
 * block, delay or break a cycle.
 */

import axios from "axios";
import { logger } from "./logger.js";

const PING_TIMEOUT_MS = 3000;

/** Env vars holding each check's base URL. One check per cycle, independent. */
export const HEARTBEAT_PING_URLS = {
  social:    "SOCIAL_HEARTBEAT_PING_URL",
  video:     "VIDEO_HEARTBEAT_PING_URL",
  ingestion: "INGESTION_HEARTBEAT_PING_URL",
};

// An unset switch is silent BY DESIGN, which makes "not configured" and
// "configured and healthy" look identical from inside the process — the failure
// mode of a monitor nobody wired up is that it never complains. Say so once per
// var per process, at first use, so the boot logs answer "is this armed?".
const announcedUnset = new Set();

/**
 * Fire one ping. Returns nothing and never rejects.
 *
 * @param {string} envVar  name of the env var holding the base URL
 * @param {""|"/start"|"/fail"} suffix
 * @param {string} [body]  posted as the ping body — Healthchecks.io keeps it on
 *                         the check, so a /fail carries its reason to whoever
 *                         reads the alert instead of only to the worker log.
 */
export function pingHeartbeat(envVar, suffix = "", body = null) {
  const base = process.env[envVar];
  if (!base) {
    if (!announcedUnset.has(envVar)) {
      announcedUnset.add(envVar);
      logger.info(`🫀 ${envVar} is unset — this cycle has NO external dead-man switch.`);
    }
    return;
  }
  try {
    const url = `${String(base).replace(/\/+$/, "")}${suffix}`;
    // Fire-and-forget. Not awaited, rejection swallowed at the call so it can
    // never surface as an unhandled rejection or add latency to the cycle.
    const req = body
      ? axios.post(url, String(body).slice(0, 10_000), {
          timeout: PING_TIMEOUT_MS,
          headers: { "Content-Type": "text/plain" },
        })
      : axios.get(url, { timeout: PING_TIMEOUT_MS });
    req.catch(() => {});
  } catch {
    /* never let telemetry break a cycle */
  }
}

/** Convenience wrappers — the three states, named so call sites read plainly. */
export const pingStart   = (envVar)             => pingHeartbeat(envVar, "/start");
export const pingSuccess = (envVar)             => pingHeartbeat(envVar, "");
export const pingFail    = (envVar, reason)     => pingHeartbeat(envVar, "/fail", reason);

/**
 * Did every attempt in this cycle fail the same way?
 *
 * The distinction being drawn is INCIDENT vs BAD NEWS DAY. A cycle that tries
 * eight articles and rejects all eight for different reasons is the pipeline
 * working — that is what selection is for. Eight failing at the SAME stage is a
 * broken dependency wearing a yield report's clothes: one dead credential, one
 * unreachable service, one misconfigured flag.
 *
 * Requires a floor (`minAttempts`) because uniformity is meaningless at n=1:
 * a single article failing at `upload` is the most ordinary event in the log.
 *
 * @param {Array<{stage?: string, reason?: string}>} attempts
 * @param {{minAttempts?: number}} [opts]
 * @returns {{uniform: boolean, stage?: string, reason?: string, count?: number}}
 */
export function uniformFailure(attempts, { minAttempts = 3 } = {}) {
  if (!Array.isArray(attempts) || attempts.length < minAttempts) return { uniform: false };
  const stages = new Set(attempts.map((a) => a?.stage));
  if (stages.size !== 1) return { uniform: false };
  const [stage] = [...stages];
  if (!stage) return { uniform: false };
  // The reason usually varies in its detail (different articles, different
  // numbers) even when the stage is identical, so the first one is reported as
  // an exemplar rather than asserted to be shared.
  return { uniform: true, stage, reason: attempts[0]?.reason || null, count: attempts.length };
}
