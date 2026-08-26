/**
 * runLongformCycle.js — the loop the worker consumes (#80).
 *
 * Orchestration only. Every decision it makes lives in a module that is
 * testable on its own — preflight and the claim in `longformCycle.js`,
 * selection in `longformTopicSelector.js`, the verdict in `longformQcGate.js`.
 * This file's job is to call them IN THE RIGHT ORDER and to make sure that
 * nothing reaches a publisher except through the one door.
 *
 * THE ORDER IS THE DESIGN:
 *
 *   1. preflight   — the cheap refusals. Kill switch, contention, rolling
 *                    rate, quota. Minutes of Redis and SQLite, not an hour of
 *                    ffmpeg and an ElevenLabs bill.
 *   2. select      — depth then demand, from the event graph.
 *   3. claim       — INSERT PENDING BEFORE ANY WORK. A crash after this point
 *                    leaves a row saying we tried, which is what stops the
 *                    next cycle filming the same story twice.
 *   4. produce     — script → storyboard → media → render. Injected, because
 *                    it is the only part that needs a filesystem and an hour.
 *   5. gate        — QC and the disclosure chain. A failure discards the film.
 *   6. publish     — reachable ONLY through publishIfPassed().
 *
 * NEVER THROWS INTO THE QUEUE. A BullMQ job that throws is retried, and a
 * retry here means re-rendering and possibly re-publishing. Every failure is
 * recorded and swallowed; the return value says what happened.
 */

import { logger } from "../logger.js";
import {
  preflight, claimEvent, recentPublishTimes, filmedEventIds,
  recordFailure, recordPublished, isLongformAutopostEnabled,
} from "./longformCycle.js";
import { publishIfPassed, formatVerdict } from "./longformQcGate.js";

/**
 * @param {object} deps  every side effect, injected
 * @param {object} deps.db
 * @param {() => Promise<{selected:object[]}>} deps.selectTopics
 * @param {(topic) => Promise<{verdict, publish, slug, artifacts}>} deps.produce
 * @param {() => boolean} [deps.shortsCycleActive]
 * @param {() => {used:number|null, ceiling:number|null}} [deps.quotaSnapshot]
 */
export async function runLongformCycle({
  db, selectTopics, produce,
  shortsCycleActive = () => false,
  quotaSnapshot = () => ({ used: null, ceiling: null }),
  now = Date.now(),
} = {}) {
  if (!db || !selectTopics || !produce) {
    logger.error("🎬 longform cycle: missing dependencies — refusing to run");
    return { skipped: "misconfigured" };
  }

  // ── 1. cheap refusals ────────────────────────────────────────────────────
  const quota = quotaSnapshot();
  const refusal = preflight({
    recentPublishedAt: recentPublishTimes(db, { now }),
    shortsCycleActive: shortsCycleActive(),
    unitsUsedToday: quota.used,
    dailyCeiling: quota.ceiling,
    now,
  });
  if (refusal) {
    // Not an error. A cycle that correctly declines is the normal case —
    // at 3 films a week most cycles do nothing.
    logger.info(`🎬 longform cycle skipped (${refusal.skipped}) — ${refusal.reason}`);
    return refusal;
  }

  // ── 2. select ────────────────────────────────────────────────────────────
  let selected;
  try {
    ({ selected } = await selectTopics({ alreadyFilmed: filmedEventIds(db) }));
  } catch (e) {
    logger.error(`🎬 longform cycle: topic selection failed — ${e.message}`);
    return { skipped: "selection-failed", reason: e.message };
  }
  if (!selected?.length) {
    logger.info("🎬 longform cycle: no topic qualified — an empty cycle is correct");
    return { skipped: "no-topic" };
  }
  const topic = selected[0];

  // ── 3. claim, BEFORE any work ────────────────────────────────────────────
  const claimed = claimEvent(db, {
    eventId: String(topic.id), slug: topic.slug || String(topic.id),
    title: topic.title, topicPhrase: topic.demand?.phrase,
    demandBreadth: topic.demand?.breadth, now,
  });
  if (!claimed) {
    // Another run owns it, or it is already filmed. Losing the claim is a
    // correct outcome, not a failure.
    logger.info(`🎬 longform cycle: ${topic.id} already claimed — skipping`);
    return { skipped: "already-claimed", eventId: String(topic.id) };
  }

  // ── 4-6. produce, gate, publish ──────────────────────────────────────────
  let out;
  try {
    out = await produce(topic);
  } catch (e) {
    recordFailure(db, { eventId: String(topic.id), stage: "produce", error: e.message, now });
    logger.error(`🎬 longform cycle: production failed for ${topic.slug} — ${e.message}`);
    return { skipped: "produce-failed", eventId: String(topic.id), reason: e.message };
  }
  if (!out?.verdict) {
    // A producer that returns no verdict has not run QC. The failure mode of
    // a missing check must never be "proceed" — publishIfPassed refuses it
    // too, but failing here names the cause.
    recordFailure(db, { eventId: String(topic.id), stage: "qc", error: "producer returned no QC verdict", now });
    logger.error(`🎬 longform cycle: ${topic.slug} produced no QC verdict — refusing`);
    return { skipped: "no-verdict", eventId: String(topic.id) };
  }

  const { published } = await publishIfPassed({
    slug: out.slug || topic.slug,
    verdict: out.verdict,
    publish: out.publish,
    log: (line) => (out.verdict.pass ? logger.info(line) : logger.error(line)),
  });

  if (!published) {
    recordFailure(db, {
      eventId: String(topic.id), stage: "qc",
      error: formatVerdict(out.slug || topic.slug, out.verdict).slice(0, 480), now,
    });
    return { skipped: "qc-reject", eventId: String(topic.id), verdict: out.verdict };
  }

  recordPublished(db, {
    eventId: String(topic.id),
    youtubeId: out.youtubeId, privacyStatus: out.privacyStatus,
    publishAt: out.publishAt, shorts: out.shorts, qc: out.verdict, now,
  });
  logger.info(`🎬 longform PUBLISHED — ${out.slug || topic.slug} (${out.youtubeId}), live at ${out.publishAt}`);
  return { published: true, eventId: String(topic.id), youtubeId: out.youtubeId };
}

/** The worker's entry point. Never throws — see the header. */
export async function longformCycleJob(deps = {}) {
  if (!isLongformAutopostEnabled()) {
    logger.info("🎬 longform autopost DISABLED (LONGFORM_AUTOPOST_ENABLED != 1)");
    return { skipped: "disabled" };
  }
  try {
    return await runLongformCycle(deps);
  } catch (e) {
    // A throw would make BullMQ retry, and a retry means re-rendering and
    // possibly re-publishing. Swallow, record, move on.
    logger.error(`🎬 longform cycle: unhandled error, swallowed to prevent a retry — ${e.message}`);
    return { skipped: "error", reason: e.message };
  }
}
