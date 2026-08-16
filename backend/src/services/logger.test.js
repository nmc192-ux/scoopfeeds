/**
 * logger — where the logs land, and how long they last.
 *
 * THE FAILURE (DrJ, 2026-08-16). logsDir resolved to `<repo>/backend/data/logs`,
 * which in production is `/app/backend/data/logs` — inside the container, while
 * the only mounted volume is `scoop_data:/var/lib/scoop`. Three deploys in one
 * day erased a day of VIDEO_SPEC_LOG_JSON output that had been accumulating
 * specifically to answer the SHIELD question.
 *
 * The distinction that matters, and the one we got wrong: we had recorded the
 * recreate as a log-READING gotcha. It was a data-RETENTION problem. Reading
 * problems inconvenience you when you read; retention problems destroy data you
 * have not read yet.
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const load = async (env) => {
  const prev = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  // Fresh module registry per case: logsDir is resolved once at import.
  const mod = await import(`./logger.js?t=${Math.random()}`);
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return mod;
};

test("in production the logs land INSIDE the mounted volume", async () => {
  const dir = "/tmp/scoop-logger-test-persist";
  const { LOGS_DIR } = await load({ SCOOP_PERSISTENT_DATA_DIR: dir });
  assert.equal(LOGS_DIR, path.join(dir, "logs"),
    "logs must be written under SCOOP_PERSISTENT_DATA_DIR — that is the only path " +
    "on the worker that survives `docker compose up --force-recreate`");
});

test("dev is unchanged when the var is unset", async () => {
  const { LOGS_DIR } = await load({ SCOOP_PERSISTENT_DATA_DIR: undefined });
  assert.match(LOGS_DIR, /backend\/data\/logs$/,
    "with no persistent dir configured the path must be exactly what it always was");
});

test("an empty or whitespace value is treated as unset, not as /logs", async () => {
  // `SCOOP_PERSISTENT_DATA_DIR=` in a .env would otherwise resolve to "/logs" at
  // the filesystem root — writable in a container, and silently ephemeral again.
  for (const v of ["", "   "]) {
    const { LOGS_DIR } = await load({ SCOOP_PERSISTENT_DATA_DIR: v });
    assert.match(LOGS_DIR, /backend\/data\/logs$/, `empty value produced ${LOGS_DIR}`);
  }
});

test("the spec corpus has its OWN file, so ingestion volume cannot evict it", async () => {
  const { logger } = await load({ SCOOP_PERSISTENT_DATA_DIR: "/tmp/scoop-logger-test-ring" });
  const files = logger.transports.filter(t => t.filename).map(t => t.filename);
  assert.ok(files.includes("video-spec.log"),
    "persisting the logs is not enough on its own: combined.log is a ring shared " +
    "with every other line, so its retention is set by ingestion chatter rather " +
    "than by the corpus. The corpus needs days and therefore needs its own ring.");
});

test("the corpus ring holds the worst-case rate for weeks, and is hard-bounded", async () => {
  const { logger } = await load({ SCOOP_PERSISTENT_DATA_DIR: "/tmp/scoop-logger-test-size" });
  const spec = logger.transports.find(t => t.filename === "video-spec.log");
  const ceilingBytes = spec.maxsize * spec.maxFiles;

  // A logged spec is at most ~30KB: VIDEO_FULLTEXT_MAX_CHARS caps the source
  // text at 24KB, plus a few KB of spec JSON and the motive verdicts.
  // The render cycle is hourly (39 * * * *) with 8 spec calls per cycle.
  const worstCasePerDay = 24 * 8 * 30 * 1024;
  const days = ceilingBytes / worstCasePerDay;
  assert.ok(days > 14,
    `the corpus ring holds ${days.toFixed(1)} days at the worst-case rate — leak 3 ` +
    `needs days of specs across UNRELATED articles, so this must not be tight`);

  // It shares a volume with news.db (~15GB, disk was at 80% in July), so the
  // ceiling is what makes it safe to co-locate. An unbounded log is a disk
  // failure with extra steps.
  assert.ok(ceilingBytes <= 256 * 1024 * 1024,
    `the corpus ring is hard-bounded at ${(ceilingBytes / 1048576).toFixed(0)}MB — ` +
    `it must not be able to grow into the volume holding news.db`);
});

test("logSpecCorpus tags rather than matching on message text", async () => {
  const { logSpecCorpus, logger } = await load({ SCOOP_PERSISTENT_DATA_DIR: "/tmp/scoop-logger-test-tag" });
  assert.equal(typeof logSpecCorpus, "function");
  // The transport filters on the tag. Matching on the message prefix instead
  // would silently stop matching the day someone rewords a log line, and the
  // corpus would go quietly empty — the exact failure mode being fixed here.
  const spec = logger.transports.find(t => t.filename === "video-spec.log");
  assert.ok(spec.format, "the corpus transport must carry its own filtering format");
});
