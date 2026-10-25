/**
 * #174 — a merge survivor is active at the moment of the merge.
 *
 * The merge path links the absorbed event's articles onto the survivor. Before
 * the fix, `markMerged` stamped only the ABSORBED row, so a survivor that had
 * gone quiet kept its old last_activity_at while gaining a whole event's worth
 * of coverage — and the dormancy sweep reads exactly that column.
 *
 * MEASURED, AND STATED SO IT IS NOT OVERSOLD: on today's code this test passes
 * with or without the fix. The cluster that triggers a merge still qualifies
 * against the survivor afterwards (it shares an article, or its cosine to the
 * article-weighted mean is at least the smaller of its two pre-merge cosines),
 * so section 6 matches or absorbs it and bumps the survivor anyway. The one
 * path that skipped the bump was that cluster throwing inside section 6's
 * per-cluster try/catch. So this pins the END STATE a merge must leave; it does
 * not prove the fix, and the fix makes the merge path self-contained rather
 * than relying on a later phase.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

// getDb() resolves its data directory at MODULE LOAD, so set it first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoop-promoter-merge-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = dir;

const { runEventPromoter } = await import("./eventPromoter.js");
const { getDb } = await import("../../models/database.js");
const { upsertEmbedding } = await import("../dal/embeddingsDao.js");
const { isVecAvailable } = await import("../schema.js");

const DAY = 24 * 60 * 60 * 1000;

test("after a merge, the survivor's last_activity_at is the merge time", async (t) => {
  const db = getDb();
  if (!isVecAvailable()) {
    t.skip("sqlite-vec unavailable — the promoter cannot load centroids without it");
    return;
  }
  const now = Date.now();
  const quiet = now - 2 * DAY;     // inside the 14-day candidate window, well before `now`

  // One story, two events: identical vectors and identical rare entities, so the
  // pair is AFFINE on the shared measure and cosine 1.0 — an unambiguous merge.
  const vec = Array.from({ length: 768 }, (_, i) => (i % 7) + 1);
  const ids = ["m-a1", "m-a2", "m-b1", "m-b2", "m-x1", "m-x2", "m-x3"];
  const insEnt = db.prepare(`INSERT OR IGNORE INTO article_entities
    (article_id, surface, surface_norm, qid, entity_type, label, created_at) VALUES (?,?,?,?,?,?,?)`);
  for (const id of ids) {
    upsertEmbedding({ scope: "article", scope_id: id, model: "test-model", vector: vec });
    for (const q of ["Q9001", "Q9002", "Q9003"]) insEnt.run(id, q, q.toLowerCase(), q, "unknown", q, now);
  }

  const insEv = db.prepare(`INSERT INTO events (id, slug, cluster_id, title, category, status,
    started_at, last_activity_at, meta, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  // A started first, so A is the survivor (earliest-started wins).
  insEv.run("ev-merge-a", "merge-test-a", null, "Merge test A", "world", "active", quiet - DAY, quiet, "{}", quiet, quiet);
  insEv.run("ev-merge-b", "merge-test-b", null, "Merge test B", "world", "active", quiet, quiet, "{}", quiet, quiet);
  const link = db.prepare(`INSERT INTO event_articles (event_id, article_id, relevance, added_at) VALUES (?,?,1.0,?)`);
  link.run("ev-merge-a", "m-a1", quiet); link.run("ev-merge-a", "m-a2", quiet);
  link.run("ev-merge-b", "m-b1", quiet); link.run("ev-merge-b", "m-b2", quiet);

  // The trigger: one eligible cluster that shares an article with EACH event.
  const clusterIds = ["m-a1", "m-b1", "m-x1", "m-x2", "m-x3"];
  db.prepare(`INSERT INTO story_clusters (id, title, summary, category, keywords, article_ids,
      article_count, created_at, updated_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run("merge-test-cluster", "Merge test cluster", null, "world", "[]",
         JSON.stringify(clusterIds), clusterIds.length, now, now, now + 3600e3);

  await runEventPromoter({ now, _yielder: async () => true });

  const a = db.prepare("SELECT status, last_activity_at FROM events WHERE id = ?").get("ev-merge-a");
  const b = db.prepare("SELECT status, meta FROM events WHERE id = ?").get("ev-merge-b");
  assert.equal(b.status, "merged", "precondition: the fixture must actually produce a merge");
  assert.equal(JSON.parse(b.meta).merged_into, "ev-merge-a", "precondition: A must be the survivor");
  assert.equal(a.status, "active");
  assert.equal(a.last_activity_at, now, "the survivor gained the absorbed articles at `now`, so it was active at `now`");
});
