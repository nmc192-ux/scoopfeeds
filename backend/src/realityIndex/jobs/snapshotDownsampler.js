/**
 * snapshotDownsampler — daily compaction of price snapshots.
 *
 * Promotes 'hot' rows older than 7d → 'warm' (1h buckets).
 * Promotes 'warm' rows older than 30d → 'cold' (daily buckets).
 *
 * The actual aggregation lives in snapshotsDao.js; this file is just the
 * cron-callable wrapper that logs and bundles both passes.
 */

import { downsampleHotToWarm, downsampleWarmToCold, snapshotCounts } from "../dal/snapshotsDao.js";
import { logger } from "../../services/logger.js";

export async function runSnapshotDownsampler() {
  const before = snapshotCounts();
  const warmOut = downsampleHotToWarm();
  const coldOut = downsampleWarmToCold();
  const after  = snapshotCounts();
  logger.info(
    `🗜️  Snapshot downsample: hot→warm ${warmOut.promoted}/${warmOut.deleted}, ` +
    `warm→cold ${coldOut.promoted}/${coldOut.deleted}, ` +
    `counts before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
  );
  return { warmOut, coldOut, before, after };
}
