/**
 * A cluster that names pruned articles must not re-create dangling links.
 *
 * story_clusters rows are never deleted, and the 03:00 prune removes articles
 * older than 7 days. Before this fix the promoter linked every id a cluster
 * named, so the dangling event_articles the prune had just swept came back on
 * the next cycle and grew all day (prod /api/health: 271 → 1,366 in ten hours
 * on 2026-10-22).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoop-promoter-pruned-"));
process.env.SCOOP_PERSISTENT_DATA_DIR = dir;

const { runEventPromoter } = await import("./eventPromoter.js");
const { getDb } = await import("../../models/database.js");

const dangling = (db) => db.prepare(
  "SELECT COUNT(*) c FROM event_articles ea WHERE NOT EXISTS (SELECT 1 FROM articles a WHERE a.id = ea.article_id)"
).get().c;

function insertCluster(db, id, articleIds, now) {
  db.prepare(`INSERT INTO story_clusters (id, title, summary, category, keywords, article_ids,
      article_count, created_at, updated_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, `Cluster ${id}`, null, "world", "[]", JSON.stringify(articleIds), articleIds.length, now, now, now + 3600e3);
}

test("only live articles are linked; a fully-pruned cluster is skipped and counted", async () => {
  const db = getDb();
  const now = Date.now();
  const ins = db.prepare(`INSERT INTO articles (id, title, url, source_name, category, published_at, fetched_at)
                          VALUES (?,?,?,?,?,?,?)`);
  // Cluster LIVE names 6 ids, 3 of which still exist; cluster GONE names 5 that were all pruned.
  for (const id of ["p-live-1", "p-live-2", "p-live-3"]) ins.run(id, `Headline ${id}`, `https://x.test/${id}`, "Test", "world", now, now);
  insertCluster(db, "pruned-live", ["p-live-1", "p-live-2", "p-live-3", "p-gone-1", "p-gone-2", "p-gone-3"], now);
  insertCluster(db, "pruned-gone", ["p-gone-4", "p-gone-5", "p-gone-6", "p-gone-7", "p-gone-8"], now);

  const stats = await runEventPromoter({ now, _yielder: async () => true });

  assert.equal(dangling(db), 0, "no event may be linked to an article that does not exist");
  const ev = db.prepare("SELECT id FROM events WHERE cluster_id = ?").get("pruned-live");
  assert.ok(ev, "the cluster with live members still promotes");
  const linked = db.prepare("SELECT article_id FROM event_articles WHERE event_id = ? ORDER BY article_id").all(ev.id).map((r) => r.article_id);
  assert.deepEqual(linked, ["p-live-1", "p-live-2", "p-live-3"]);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM events WHERE cluster_id = ?").get("pruned-gone").c, 0,
    "a cluster whose every article was pruned must not mint an empty event");
  assert.equal(stats.prunedRefsDropped, 8, "3 + 5 pruned ids dropped, and the stats line must say so");
  assert.equal(stats.emptyClustersSkipped, 1);
});
