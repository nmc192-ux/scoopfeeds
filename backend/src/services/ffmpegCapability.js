/**
 * ffmpegCapability.js — prove the binary can do the job, at boot, before it matters.
 *
 * THE FAILURE THIS EXISTS FOR. `getFFmpegPath()` prefers a system ffmpeg and
 * falls back to the bundled `@ffmpeg-installer` binary. On linux-x64 that bundle
 * is a **2018 static build**, and `xfade` — which every multi-state slide in this
 * pipeline depends on — landed in ffmpeg 4.3 in 2020. So on a host with no
 * system ffmpeg the resolver succeeds, the process boots clean, every health
 * check is green, and the first render dies with:
 *
 *     [AVFilterGraph] No such filter: 'xfade'
 *
 * That is the same shape as two failures this repo has already had: the token
 * cache that returned expired tokens (looked fine until the call), and the
 * disk-cache precedence trap (looked fine until the read). A silent fallback to
 * something that cannot do the work is worse than no fallback, because it moves
 * the failure from boot — where it is one log line and an obvious cause — to
 * 3am, inside a cycle, with a stack trace about filter graphs.
 *
 * WHY THE REFUSAL IS SCOPED TO THE RENDER QUEUES, NOT TO BOOT (DrJ, Gate D).
 *
 * The first version of this refused to start the worker at all. That was wrong,
 * and wrong in a familiar direction: the worker process also consumes ingestion,
 * social, enrichment and analysis, none of which touch ffmpeg. A missing xfade
 * would have turned a video-render gap into RSS ingestion stopping and every
 * social surface going dark — converting a narrow, visible fault into a broad,
 * confusing outage. That is the shape of the outages this repo spent August
 * chasing, manufactured deliberately by a guard meant to prevent one.
 *
 * So the capability is probed ONCE, loudly, and the refusal happens at DISPATCH
 * on the two queues that actually render. Everything else comes up and keeps
 * working. A render job then fails fast with the missing filter named and lands
 * in BullMQ's failed set — visible and attributable — rather than piling up
 * silently behind a worker that was never registered.
 *
 * WHY THE CHECK ASKS THE BINARY RATHER THAN PARSING A VERSION. Version strings
 * lie: distributions backport, the bundled build reports an `N-` nightly tag
 * with no usable number, and "4.3 or later" is a proxy for the thing we actually
 * need. `-filters` lists what this binary can actually do. Ask the real question.
 */

import { execFileSync } from "child_process";
import { getFFmpegPath } from "./videoGenerator.js";
import { logger } from "./logger.js";

/**
 * Filters the render path cannot work without.
 *
 * Deliberately short. This is a boot check, not an inventory: each entry is a
 * filter whose absence means a render WILL fail, and every one of them should
 * name the thing that breaks.
 */
export const REQUIRED_FILTERS = Object.freeze([
  "xfade",     // the crossfade between keyframe states — every multi-state slide
  "drawtext",  // captions and the credit chip
  "overlay",   // the cutaway composite
  "zoompan",   // image-layer motion
]);

export class FFmpegCapabilityError extends Error {
  constructor(message, { code, missing } = {}) {
    super(message);
    this.name = "FFmpegCapabilityError";
    this.code = code;
    this.missing = missing;
  }
}

/**
 * Which of the required filters this binary actually has.
 *
 * Injectable `run` so the logic is testable without a binary — the same
 * discipline the rest of this engine uses for its network and model calls.
 */
export function probeFilters(ffmpegPath, { run = null } = {}) {
  const exec = run || ((bin) =>
    execFileSync(bin, ["-hide_banner", "-filters"], { encoding: "utf8", timeout: 15_000, maxBuffer: 8 * 1024 * 1024 }));

  let out;
  try {
    out = String(exec(ffmpegPath));
  } catch (err) {
    throw new FFmpegCapabilityError(
      `could not ask ${ffmpegPath} what filters it has (${String(err?.message).slice(0, 200)}). ` +
      "A binary that cannot be probed cannot be trusted to render.",
      { code: "probe-failed" }
    );
  }

  // `-filters` prints one filter per line as `FLAGS name inputs->outputs desc`.
  // Matching on a word boundary rather than a substring so `overlay` does not
  // match `overlay_cuda` and report a capability we do not have.
  const present = new Set();
  for (const line of out.split("\n")) {
    const m = /^\s*[A-Z.]+\s+(\S+)\s/.exec(line);
    if (m) present.add(m[1]);
  }
  return {
    present,
    missing: REQUIRED_FILTERS.filter((f) => !present.has(f)),
    filterCount: present.size,
  };
}

/**
 * Assert this process can render, or throw.
 *
 * Called from the worker's boot path. Returns a summary on success so the log
 * line says which binary was accepted — "ffmpeg is fine" is not a useful thing
 * to find in a log six weeks later.
 */
export function assertFFmpegCapable({ ffmpegPath = null, run = null, resolve = getFFmpegPath } = {}) {
  // `resolve` is injectable so the no-binary branch is reachable in a test.
  // An untested refusal path is a refusal path that has never been read.
  const bin = ffmpegPath || resolve();
  if (!bin) {
    throw new FFmpegCapabilityError(
      "no ffmpeg binary could be resolved. The render path needs one; there is nothing to degrade to.",
      { code: "no-ffmpeg", missing: REQUIRED_FILTERS }
    );
  }

  const { missing, filterCount } = probeFilters(bin, { run });

  // A plausible binary has hundreds of filters. A handful means we probed
  // something that is not really ffmpeg, or a minimal build (Playwright ships
  // one with 24 filters) — and then "the filters we need are present" would be
  // a claim about a parse that did not work.
  if (filterCount < 50) {
    throw new FFmpegCapabilityError(
      `${bin} reports only ${filterCount} filters, which is implausibly few for ffmpeg. ` +
      "Either the probe did not parse, or this is a minimal build that cannot render.",
      { code: "implausible-probe", missing }
    );
  }

  if (missing.length) {
    throw new FFmpegCapabilityError(
      `${bin} is missing required filter(s): ${missing.join(", ")}.\n` +
      (missing.includes("xfade")
        ? "  xfade landed in ffmpeg 4.3 (2020). The bundled @ffmpeg-installer binary on linux-x64 is a 2018\n" +
          "  build and does not have it, so this host has fallen back to the bundle. Install a system ffmpeg\n" +
          "  (>= 4.3) — the Dockerfile's apt step does this; a host that skipped it will land here.\n"
        : "") +
      "  Refusing to start: a worker that cannot render would take video jobs and fail every one of them.",
      { code: "missing-filters", missing }
    );
  }

  logger.info(`🎬 ffmpeg capability OK — ${bin} (${filterCount} filters, all of ${REQUIRED_FILTERS.join("/")} present)`);
  return { ffmpegPath: bin, filterCount, missing: [] };
}

// ─── Scoping: which queues actually need it, and how they refuse ────────────

/**
 * The queues whose jobs invoke ffmpeg.
 *
 * Keyed by the QUEUE NAME STRING, not the QUEUE_NAMES key — they differ for
 * exactly the queue that matters most here (`videoRender` is `"video_render"`),
 * and that mismatch is the kind that turns a guard into decoration.
 *
 * `video` is deliberately NOT here: it is YouTube INGESTION, not rendering.
 * Including it would take content ingestion down for a render fault, which is
 * the whole mistake this scoping exists to undo.
 */
export const FFMPEG_DEPENDENT_QUEUES = Object.freeze(["video_render", "longform"]);

export const requiresFFmpeg = (queueName) => FFMPEG_DEPENDENT_QUEUES.includes(String(queueName));

/**
 * Probe once, without throwing, and remember the answer.
 *
 * Memoised because it spawns a process: registration asks, then every dispatch
 * asks again. The answer cannot change without a redeploy, and a redeploy is a
 * new process.
 */
let _capability;
export function ffmpegCapability({ force = false, ffmpegPath = null, run = null, resolve = getFFmpegPath } = {}) {
  if (_capability && !force) return _capability;
  try {
    _capability = { ...assertFFmpegCapable({ ffmpegPath, run, resolve }), capable: true, reason: null };
  } catch (err) {
    _capability = {
      capable: false,
      ffmpegPath: ffmpegPath || null,
      missing: err.missing || REQUIRED_FILTERS,
      reason: err.message,
      code: err.code,
    };
  }
  return _capability;
}

/** Test seam: forget the memoised probe. */
export const _resetCapability = () => { _capability = undefined; };

/**
 * Wrap a queue processor so a RENDER job refuses at dispatch when ffmpeg cannot
 * render, and every other queue is untouched.
 *
 * Returns the processor UNCHANGED for queues that do not need ffmpeg — so it is
 * safe to apply to all of them, and applying it to all of them is what stops
 * someone adding a render queue later and forgetting the guard.
 */
export function withFFmpegGuard(queueName, processor, { probe = ffmpegCapability } = {}) {
  if (!requiresFFmpeg(queueName)) return processor;
  return async (...args) => {
    const cap = probe();
    if (!cap.capable) {
      throw new FFmpegCapabilityError(
        `queue "${queueName}" cannot run: ffmpeg is missing ${(cap.missing || []).join(", ") || "required filters"}. ` +
        "This worker's other queues are unaffected and still consuming. " +
        (cap.reason ? `Probe said: ${String(cap.reason).split("\n")[0]}` : ""),
        { code: "render-unavailable", missing: cap.missing }
      );
    }
    return processor(...args);
  };
}

/**
 * The one boot-time line. Reports; does NOT refuse.
 *
 * Loud on failure, because a host that cannot render should be obvious in the
 * first screen of a deploy log — even though the process is going to come up
 * and serve everything else correctly.
 */
export function reportFFmpegCapabilityAtBoot({ role = "worker", probe = ffmpegCapability } = {}) {
  const cap = probe();
  if (cap.capable) return cap;
  logger.error(
    `🎬 [${role}] ffmpeg CANNOT RENDER — missing ${(cap.missing || []).join(", ")}. ` +
    `Queues ${FFMPEG_DEPENDENT_QUEUES.join(" and ")} will refuse their jobs; every other queue is unaffected. ` +
    "Install a system ffmpeg >= 4.3 (the Dockerfile's apt step does this)."
  );
  return cap;
}
