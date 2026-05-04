import { createPostgresAdapter } from "./postgresAdapter.js";
import { createSqliteAdapter } from "./sqliteAdapter.js";

let adapter;
let postgresAdapter;

export function getConfiguredPrimaryDatabase() {
  return String(process.env.DATABASE_PRIMARY || "sqlite").trim().toLowerCase();
}

export function getDatabaseAdapter() {
  if (adapter) return adapter;

  // Preparation phase only: keep SQLite active regardless of future config
  // so adding adapter seams cannot change production behavior yet.
  adapter = createSqliteAdapter();
  return adapter;
}

export function getPostgresAdapterPlaceholder() {
  if (!postgresAdapter) {
    postgresAdapter = createPostgresAdapter();
  }
  return postgresAdapter;
}

export function isDualWritePostgresEnabled() {
  return String(process.env.DUAL_WRITE_POSTGRES || "").toLowerCase() === "true";
}
