/**
 * workerQueues.js — which queues THIS worker container consumes.
 *
 * WHY A SPLIT AT ALL. One worker process is one JS thread, and better-sqlite3
 * is synchronous. Measured over 12 days on the 2-vCPU prod host:
 * `events.promote` occupies 59.8% of wall-clock and `analysis.refresh` 46.9%,
 * against `news.ingest.all` at 11.7%. The graph jobs and the jobs with a clock
 * were sharing one thread, and the graph jobs won. #136 made the promoter yield,
 * which stops it monopolising; it does not stop the two of them wanting more
 * than a thread between them. Separating them does.
 *
 * WHAT DECIDED THE SHAPE. The obvious worry was whether `video.render.cycle`
 * belongs with the latency-sensitive jobs or in a third container — it is p90
 * 1655s and satori/resvg run IN-THREAD. Measured with the same instrument that
 * caught the promoter (an RSS fetch whose wall time far exceeds its own 15s
 * timeout): of 55 such windows, 47 are covered by promote alone, 8 by promote
 * and a render together, and **0 by a render alone** — across 360 renders, 78 of
 * them longer than ten minutes. Renders do not starve the loop, because their
 * time is dominated by SPAWNED ffmpeg. Two containers, not three.
 *
 * THE PARTITION IS LOAD-BEARING, NOT A PREFERENCE. Every one of these cycles
 * guards itself with a PROCESS-LOCAL `isRunning` boolean — jobOptions.js says so
 * in three separate places. A queue consumed by two containers would have two
 * guards that cannot see each other, and the failure is not a slow cycle, it is
 * two of them running at once: two social posts, two published films. So each
 * queue must be claimed by EXACTLY ONE container, and a queue claimed by NEITHER
 * goes silently dark, which is this codebase's signature failure. The contract
 * test in workerQueues.test.js reads the real compose file and pins both halves.
 *
 * UNSET MEANS EVERYTHING. With WORKER_QUEUES absent this returns the full set
 * and the container behaves exactly as it did before the split existed, so the
 * change is inert until a deployment says otherwise.
 */
import { QUEUE_NAMES } from "./jobOptions.js";

/** Every queue a worker can consume. The partition must cover exactly this. */
export const ALL_WORKER_QUEUES = Object.freeze([
  QUEUE_NAMES.ingestion,
  QUEUE_NAMES.video,
  QUEUE_NAMES.videoRender,
  QUEUE_NAMES.longform,
  QUEUE_NAMES.social,
  QUEUE_NAMES.enrichment,
  QUEUE_NAMES.analysis,
  QUEUE_NAMES.realityIndex,
]);

/**
 * Resolve WORKER_QUEUES into the set this container should register.
 *
 * THROWS on an unknown name rather than skipping it. A typo in a compose file
 * would otherwise produce a container that starts cleanly, logs "ready", and
 * consumes nothing — the outage that looks exactly like a quiet day. Failing at
 * boot puts the mistake in front of whoever just deployed.
 *
 * @param {string|undefined} raw  the env value
 * @returns {string[]} queue names, in ALL_WORKER_QUEUES order
 */
export function resolveWorkerQueues(raw = process.env.WORKER_QUEUES) {
  const text = String(raw ?? "").trim();
  if (!text) return [...ALL_WORKER_QUEUES];

  const asked = text.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = asked.filter((q) => !ALL_WORKER_QUEUES.includes(q));
  if (unknown.length) {
    throw new Error(
      `WORKER_QUEUES names ${unknown.length} queue(s) that do not exist: ${unknown.join(", ")}. ` +
      `Valid names are: ${ALL_WORKER_QUEUES.join(", ")}. Refusing to start rather than ` +
      `consuming a subset nobody intended.`
    );
  }
  if (!asked.length) {
    throw new Error("WORKER_QUEUES is set but names no queues. Unset it to consume all of them.");
  }
  // Deduplicated and ordered canonically so the "ready" log is comparable
  // between containers and a repeated name is not mistaken for two consumers.
  return ALL_WORKER_QUEUES.filter((q) => asked.includes(q));
}
