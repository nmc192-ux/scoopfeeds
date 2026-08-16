import winston from "winston";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * LOGS MUST OUTLIVE THE CONTAINER (DrJ, 2026-08-16).
 *
 * This resolved to `<repo>/backend/data/logs`, which in production is
 * `/app/backend/data/logs` — the container's own filesystem, and the only
 * mounted volume is `scoop_data:/var/lib/scoop`. So every redeploy destroyed
 * every log file, and `docker compose logs` resets on recreate too: BOTH
 * destinations were ephemeral.
 *
 * We had already recorded the recreate as a log-READING gotcha ("--force-recreate
 * destroys the container, so `logs --since` only shows since boot"). It was
 * actually a data-RETENTION problem, and that distinction is what cost us the
 * SHIELD evidence: VIDEO_SPEC_LOG_JSON collected for a day into a location three
 * deploys then erased. A reading problem is an inconvenience at the moment you
 * read. A retention problem destroys data you have not read yet.
 *
 * `SCOOP_PERSISTENT_DATA_DIR` is already set to /var/lib/scoop on all three
 * services and the volume is already mounted there, so no compose change is
 * needed — this just writes inside it. Dev is unchanged: with the var unset the
 * path is exactly what it was.
 */
const persistentDir = (process.env.SCOOP_PERSISTENT_DATA_DIR || "").trim();
const logsDir = persistentDir
  ? path.join(persistentDir, "logs")
  : path.join(__dirname, "../../data/logs");

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const intEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), errors({ stack: true }), logFormat),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: "HH:mm:ss" }), logFormat),
    }),
    new winston.transports.File({
      filename: path.join(logsDir, "error.log"),
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, "combined.log"),
      maxsize: 10485760, // 10MB
      maxFiles: 10,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, "ingestion.log"),
      maxsize: 10485760,
      maxFiles: 5,
      format: combine(timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), logFormat),
    }),
    // ── THE SPEC CORPUS GETS ITS OWN RING ──────────────────────────────────
    //
    // Persisting the logs is not sufficient on its own. combined.log is a
    // 10MB x 10 = 100MB ring shared with EVERY other line the system writes, so
    // its retention is set by ingestion chatter rather than by how little the
    // spec logging itself produces. A busy ingestion day would evict the corpus
    // no matter how cheap the corpus is — and the corpus is the thing leak 3 is
    // waiting on, which needs DAYS across unrelated articles.
    //
    // Sizing: a logged spec is at most ~30KB (VIDEO_FULLTEXT_MAX_CHARS caps the
    // source text at 24KB, plus a few KB of JSON and the motive verdicts). The
    // video render cycle is hourly with 8 spec calls per cycle, so the ceiling
    // is 192 x 30KB ≈ 5.8MB/day and the realistic rate is well under that.
    // 20MB x 6 = 120MB therefore holds roughly three weeks at the WORST case,
    // and is a hard bound — it cannot grow to threaten news.db on the same
    // volume, which is the reason the ceiling matters more than the average.
    new winston.transports.File({
      filename: path.join(logsDir, "video-spec.log"),
      maxsize: intEnv("SPEC_LOG_MAX_BYTES", 20971520),  // 20MB
      maxFiles: intEnv("SPEC_LOG_MAX_FILES", 6),
      // Only the corpus lines, and without the meta blob — this file is PARSED
      // by _specHarvest.mjs, so its format is a contract rather than a taste.
      format: combine(
        winston.format((info) => (info.type === "video_spec" ? info : false))(),
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        printf(({ level, message, timestamp }) => `[${timestamp}] ${level.toUpperCase()}: ${message}`)
      ),
    }),
  ],
});

/** Where the logs actually landed. Logged at boot so this is never a guess. */
export const LOGS_DIR = logsDir;

/**
 * A spec-corpus line: goes to combined.log as usual AND to video-spec.log,
 * whose rotation is independent of ingestion volume. Tagged rather than matched
 * by message text, so the transport filter cannot silently stop matching when
 * someone rewords a log line.
 */
export function logSpecCorpus(message) {
  logger.info(message, { type: "video_spec" });
}

export function logIngestion(event, data = {}) {
  logger.info(`[INGESTION] ${event}`, { ...data, type: "ingestion" });
}

export function logAnalytics(event, data = {}) {
  logger.info(`[ANALYTICS] ${event}`, { ...data, type: "analytics" });
}

export function logSourceHealth(source, status, details = {}) {
  const level = status === "ok" ? "info" : "warn";
  logger[level](`[SOURCE_HEALTH] ${source}: ${status}`, { ...details, type: "source_health" });
}
