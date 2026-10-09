/**
 * Embedding-model hygiene: old-model and new-model vectors must not mix.
 *  - the DAO's `model` filter, per-model counts and clear-all
 *  - scripts/reembed.mjs end to end against a fake Ollama: plan, preflight,
 *    clear-first refill, checkpoint, resume.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "embmodels-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = dataDir;

const { getDb } = await import("../models/database.js");
const { isVecAvailable } = await import("./schema.js");
const dao = await import("./dal/embeddingsDao.js");
getDb();
const VEC = isVecAvailable();
const skip = VEC ? false : "sqlite-vec not available in this environment";

const unit = (i) => { const v = new Array(768).fill(0); v[i % 768] = 1; return v; };

test("searchNearest({model}) excludes vectors written by another model; counts split by model", { skip }, () => {
  dao.upsertEmbedding({ scope: "market", scope_id: "old-1", model: "gemini-embedding-001", vector: unit(0) });
  dao.upsertEmbedding({ scope: "market", scope_id: "new-1", model: "nomic-embed-text", vector: unit(0) });
  dao.upsertEmbedding({ scope: "market", scope_id: "new-2", model: "nomic-embed-text", vector: unit(1) });
  const all = dao.searchNearest({ vector: unit(0), k: 5, scope: "market" }).map(h => h.scope_id).sort();
  assert.deepEqual(all, ["new-1", "new-2", "old-1"], "unfiltered KNN mixes models");
  const only = dao.searchNearest({ vector: unit(0), k: 5, scope: "market", model: "nomic-embed-text" }).map(h => h.scope_id).sort();
  assert.deepEqual(only, ["new-1", "new-2"]);
  assert.deepEqual(dao.countEmbeddingsByModel().map(r => [r.scope, r.model, r.n]),
    [["market", "nomic-embed-text", 2], ["market", "gemini-embedding-001", 1]]);
});

test("clearAllEmbeddings removes every vector and every sidecar row", { skip }, () => {
  assert.equal(dao.clearAllEmbeddings(), 3);
  assert.equal(dao.countEmbeddings(), 0);
  assert.deepEqual(dao.countEmbeddingsByModel(), []);
});

// ─── reembed.mjs end to end ────────────────────────────────────────────────

function fakeOllama() {
  const hits = { n: 0, prompts: [] };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      hits.n++;
      try { hits.prompts.push(JSON.parse(body).prompt); } catch { /* ignore */ }
      res.setHeader("Content-Type", "application/json");
      const v = new Array(768).fill(0); v[hits.n % 768] = 1;
      res.end(JSON.stringify({ embedding: v }));
    });
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ server, hits, url: `http://127.0.0.1:${server.address().port}` })));
}
function run(args, env) {
  const script = fileURLToPath(new URL("../../scripts/reembed.mjs", import.meta.url));
  return new Promise(resolve => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, SCOOP_PERSISTENT_DATA_DIR: dataDir, LLM_RETRY_DELAYS_MS: "1", ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; child.stdout.on("data", d => { out += d; }); child.stderr.on("data", d => { out += d; });
    child.on("close", code => resolve({ code, out }));
  });
}

test("reembed.mjs: plan mode writes nothing; preflight failure deletes nothing; --clear --yes --run refills on one model and resumes", { skip, timeout: 60000 }, async () => {
  const now = Date.now();
  const db = getDb();
  for (let i = 0; i < 4; i++) {
    db.prepare(`INSERT OR REPLACE INTO articles (id, title, description, url, source_name, category, published_at, fetched_at, is_duplicate)
      VALUES (?, ?, ?, ?, 'Wire', 'world', ?, ?, 0)`).run(`re-${i}`, `Headline ${i}`, `Desc ${i}`, `https://x.test/re${i}`, now - i * 1000, now);
  }
  // pre-existing OLD-model vector that must not survive the cutover
  dao.upsertEmbedding({ scope: "article", scope_id: "re-0", model: "gemini-embedding-001", vector: unit(5) });
  dao.upsertEmbedding({ scope: "article", scope_id: "ancient", model: "gemini-embedding-001", vector: unit(6) });

  const { server, hits, url } = await fakeOllama();
  try {
    const env = { OLLAMA_BASE_URL: url, EMBED_PROVIDER: "ollama" };

    let r = await run([], env); // plan
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /plan only — nothing written/);
    assert.match(r.out, /articles in last 7d 4/);
    assert.equal(hits.n, 0);
    assert.equal(dao.countEmbeddings(), 2);

    r = await run(["--clear", "--run"], env); // no --yes
    assert.equal(r.code, 2);
    assert.equal(dao.countEmbeddings(), 2, "refused: nothing deleted");

    r = await run(["--clear", "--yes", "--run"], { ...env, OLLAMA_BASE_URL: "http://127.0.0.1:1" }); // lane down
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /preflight FAILED/);
    assert.equal(dao.countEmbeddings(), 2, "preflight failed BEFORE any delete");

    r = await run(["--clear", "--yes", "--run", "--rate", "200"], env); // the cutover
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /cleared 2 vector/);
    assert.match(r.out, /embedded 4, failed 0/);
    assert.deepEqual(dao.countEmbeddingsByModel().map(x => [x.scope, x.model, x.n]), [["article", "nomic-embed-text", 4]]);
    assert.equal(dao.getEmbeddingMeta("article", "ancient"), null, "old-model vector gone");
    assert.ok(hits.prompts.some(p => p === "search_document: Headline 0. Desc 0"), "documents use the nomic document prefix and production text");
    const cp = JSON.parse(fs.readFileSync(path.join(dataDir, "reembed.checkpoint.json"), "utf8"));
    assert.equal(cp.clearedForModel, "nomic-embed-text");
    assert.equal(cp.embedded, 4);

    const before = hits.n;
    r = await run(["--run", "--rate", "200"], env); // resume: nothing left
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /to embed 0/);
    assert.equal(hits.n - before, 1, "only the preflight probe hit Ollama");

    r = await run(["--clear", "--yes", "--run"], env); // second clear is refused
    assert.equal(r.code, 4, r.out);
    assert.equal(dao.countEmbeddings("article"), 4, "the refill was not discarded");
  } finally { server.close(); }
});
