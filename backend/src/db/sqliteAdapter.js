import {
  insertBackgroundJobRun,
  listRecentFailedBackgroundJobs,
  updateBackgroundJobRun,
} from "../models/database.js";

export function createSqliteAdapter() {
  return {
    name: "sqlite",
    supportsDualWrite: false,
    jobRuns: {
      insert: insertBackgroundJobRun,
      update: updateBackgroundJobRun,
      listRecentFailed: listRecentFailedBackgroundJobs,
    },
  };
}
