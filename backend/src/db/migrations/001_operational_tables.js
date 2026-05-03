export const id = "001_operational_tables";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      method          TEXT NOT NULL,
      path            TEXT NOT NULL,
      request_id      TEXT NOT NULL,
      actor_type      TEXT NOT NULL,
      ip_hash         TEXT,
      user_agent_hash TEXT,
      created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_request ON admin_audit_logs(request_id);

    CREATE TABLE IF NOT EXISTS background_job_runs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      queue         TEXT NOT NULL,
      job_name      TEXT NOT NULL,
      job_id        TEXT,
      status        TEXT NOT NULL,
      attempts      INTEGER DEFAULT 0,
      started_at    INTEGER,
      finished_at   INTEGER,
      duration_ms   INTEGER,
      error_message TEXT,
      error_stack   TEXT,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_background_job_runs_created ON background_job_runs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_background_job_runs_queue ON background_job_runs(queue, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_background_job_runs_job_id ON background_job_runs(job_id);

    CREATE TABLE IF NOT EXISTS api_slow_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      method        TEXT NOT NULL,
      path          TEXT NOT NULL,
      status        INTEGER NOT NULL,
      duration_ms   INTEGER NOT NULL,
      request_id    TEXT NOT NULL,
      process_role  TEXT,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_api_slow_logs_created ON api_slow_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_api_slow_logs_request ON api_slow_logs(request_id);

    CREATE TABLE IF NOT EXISTS job_idempotency_keys (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      scope           TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'active',
      created_at      INTEGER NOT NULL,
      expires_at      INTEGER,
      metadata        TEXT DEFAULT '{}',
      UNIQUE(scope, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_job_idempotency_scope_status
      ON job_idempotency_keys(scope, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_job_idempotency_expires
      ON job_idempotency_keys(expires_at);
  `);
}
