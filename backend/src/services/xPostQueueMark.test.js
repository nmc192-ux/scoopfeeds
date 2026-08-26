/**
 * Marking an X text post as sent.
 *
 * This wrote status='posted' against a column whose CHECK constraint admits
 * only pending | sent_in_digest | marked_posted | rejected. Every UPDATE threw
 * AFTER the post had already gone out to X, which meant the daily cap counted a
 * status that never existed and therefore read zero forever.
 *
 * The test writes to a REAL database rather than asserting a string, because a
 * string assertion would have passed on the broken value just as happily.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTestDb } from "../testing/testDb.js";

/** x_post_queue has a FOREIGN KEY to articles — the row has to exist. */
function seedArticle(db, id) {
  const now = Date.now();
  db.prepare(`INSERT INTO articles (id, title, url, source_name, category, published_at, fetched_at)
              VALUES (?, 'T', 'https://example.test/' || ?, 'Test', 'world', ?, ?)`)
    .run(id, id, now, now);
}

test("the status the code writes is one the schema actually permits", () => {
  const { db } = makeTestDb();
  seedArticle(db, "a1");
  db.prepare(`INSERT INTO x_post_queue (article_id, post_text, post_type, status, generated_at)
              VALUES ('a1','hello','single','pending',?)`).run(Date.now());
  const id = db.prepare("SELECT id FROM x_post_queue").get().id;

  // Exactly the statement markXPostsPosted issues.
  const run = (status) => db.prepare(
    "UPDATE x_post_queue SET status = ?, marked_posted_at = ? WHERE id = ? AND status = 'pending'"
  ).run(status, Date.now(), id);

  assert.throws(() => run("posted"), /CHECK constraint failed/,
    "'posted' is what shipped, and the database rejects it");
  assert.equal(run("marked_posted").changes, 1, "'marked_posted' is the permitted value");
});

test("the cap counts the status that is actually written", () => {
  const { db } = makeTestDb();
  const now = Date.now();
  seedArticle(db, "a2");
  db.prepare(`INSERT INTO x_post_queue (article_id, post_text, post_type, status, generated_at, marked_posted_at)
              VALUES ('a2','x','single','marked_posted',?,?)`).run(now, now);
  const counted = db.prepare(
    "SELECT COUNT(*) n FROM x_post_queue WHERE status = ? AND marked_posted_at > ?"
  ).get("marked_posted", now - 86400000).n;
  assert.equal(counted, 1, "a sent post must count against the daily cap");

  // The shipped query looked for 'posted' and therefore always returned 0 —
  // the cap existed and never applied.
  const wrong = db.prepare(
    "SELECT COUNT(*) n FROM x_post_queue WHERE status = ? AND marked_posted_at > ?"
  ).get("posted", now - 86400000).n;
  assert.equal(wrong, 0, "this is why the 8/day cap never fired");
});

test("markXPostsPosted and countXTextPostsSince agree on the value", async () => {
  // They are separate statements in separate functions; a mismatch between them
  // is silent and uncapped. Pinned to one exported constant.
  const { X_POST_STATUS_POSTED } = await import("../models/database.js");
  assert.equal(X_POST_STATUS_POSTED, "marked_posted");
});
