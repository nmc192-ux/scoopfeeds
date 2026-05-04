import { getDatabaseAdapter, isDualWritePostgresEnabled } from "../db/index.js";
import { logger } from "../services/logger.js";

export class JobRunRepository {
  constructor(adapter = getDatabaseAdapter()) {
    this.adapter = adapter;
  }

  create(run) {
    const recordId = this.adapter.jobRuns.insert(run);
    this.logDualWriteIntent("create", run);
    return recordId;
  }

  update(id, patch) {
    this.adapter.jobRuns.update(id, patch);
    this.logDualWriteIntent("update", { id, ...patch });
  }

  listRecentFailed(limit = 10) {
    return this.adapter.jobRuns.listRecentFailed(limit);
  }

  logDualWriteIntent(operation, payload) {
    if (!isDualWritePostgresEnabled()) return;

    logger.info("Postgres dual-write placeholder", {
      repository: "JobRunRepository",
      adapter: this.adapter.name,
      operation,
      payloadKeys: Object.keys(payload || {}),
    });
  }
}
