import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";

const ROUTES = [
  "/scoop-ops/social-queue.json",
  "/scoop-ops/videos-gen/status",
  "/scoop-ops/newsletter/status",
];

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForServer(baseUrl, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // Server not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function startServer({ adminBearerToken, allowLegacyQueryKey = false }) {
  const port = await getFreePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "scoop-admin-auth-"));
  const nodeBinary = process.env.NODE || process.env.npm_node_execpath || "/usr/local/bin/node";
  const env = {
    ...process.env,
    PORT: String(port),
    ENABLE_SCHEDULER: "false",
    ADMIN_BEARER_TOKEN: adminBearerToken,
    ADMIN_KEY: "legacy-key",
    ALLOW_LEGACY_ADMIN_QUERY_KEY: allowLegacyQueryKey ? "true" : "false",
    SCOOP_PERSISTENT_DATA_DIR: dataDir,
  };

  const child = spawn(nodeBinary, ["server.js"], {
    cwd: path.resolve("backend"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const spawnError = await new Promise((resolve) => {
    child.once("error", resolve);
    setTimeout(() => resolve(null), 0);
  });
  if (spawnError) {
    throw spawnError;
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(baseUrl);
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(`${error.message}\n${stderr}`.trim());
  }

  return { baseUrl, child, dataDir };
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;

  child.kill("SIGTERM");
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 5000);
  });
}

async function expectStatus(url, { token, expectedStatus, label }) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(url, { headers });
  assert.equal(res.status, expectedStatus, `${label}: expected ${expectedStatus}, got ${res.status} for ${url}`);
  return res;
}

async function runProtectedRouteChecks({ baseUrl, token, queryShouldWork }) {
  for (const route of ROUTES) {
    await expectStatus(`${baseUrl}${route}`, {
      expectedStatus: 401,
      label: "missing token",
    });

    await expectStatus(`${baseUrl}${route}`, {
      token: "wrong-token",
      expectedStatus: 401,
      label: "wrong token",
    });

    await expectStatus(`${baseUrl}${route}`, {
      token,
      expectedStatus: 200,
      label: "correct bearer token",
    });

    const queryRes = await fetch(`${baseUrl}${route}?key=${encodeURIComponent(token)}`);
    assert.equal(
      queryRes.status,
      queryShouldWork ? 200 : 401,
      `query key expectation failed for ${route}`
    );
  }
}

function verifyAuditLog(dataDir, minimumRows) {
  const dbPath = path.join(dataDir, "news.db");
  const db = new Database(dbPath, { readonly: true });
  const table = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'admin_audit_logs'
  `).get();
  assert.ok(table, "admin_audit_logs table should exist");

  const countRow = db.prepare(`SELECT COUNT(*) AS n FROM admin_audit_logs`).get();
  assert.ok(countRow.n >= minimumRows, `expected at least ${minimumRows} admin audit rows, got ${countRow.n}`);

  const sample = db.prepare(`
    SELECT method, path, request_id, actor_type, ip_hash, user_agent_hash, created_at
    FROM admin_audit_logs
    ORDER BY id DESC
    LIMIT 1
  `).get();
  assert.ok(sample?.request_id, "audit log should include request_id");
  assert.equal(sample?.actor_type, "bearer");
  assert.ok(sample?.ip_hash, "audit log should include ip_hash");
  assert.ok(sample?.user_agent_hash, "audit log should include user_agent_hash");
  db.close();
}

async function main() {
  const token = "test-admin-bearer-token";
  const baseUrl = process.env.BASE_URL || "";
  const compatBaseUrl = process.env.COMPAT_BASE_URL || "";
  const dataDir = process.env.DATA_DIR || "";

  if (baseUrl) {
    await runProtectedRouteChecks({
      baseUrl,
      token,
      queryShouldWork: false,
    });
    if (dataDir) verifyAuditLog(dataDir, ROUTES.length);
    if (compatBaseUrl) {
      await runProtectedRouteChecks({
        baseUrl: compatBaseUrl,
        token,
        queryShouldWork: true,
      });
    }
  } else {
    const lockedDown = await startServer({ adminBearerToken: token, allowLegacyQueryKey: false });
    try {
      await runProtectedRouteChecks({
        baseUrl: lockedDown.baseUrl,
        token,
        queryShouldWork: false,
      });
      verifyAuditLog(lockedDown.dataDir, ROUTES.length);
    } finally {
      await stopServer(lockedDown.child);
    }

    const compat = await startServer({ adminBearerToken: token, allowLegacyQueryKey: true });
    try {
      await runProtectedRouteChecks({
        baseUrl: compat.baseUrl,
        token,
        queryShouldWork: true,
      });
    } finally {
      await stopServer(compat.child);
    }
  }

  console.log("admin auth checks passed");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
