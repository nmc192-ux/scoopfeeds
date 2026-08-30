/**
 * incidentDigest.test.js — the only review there now is.
 *
 * Pre-publication human verification is gone (DrJ ruling, 2026-08-30). This
 * digest replaces it, and its usefulness is a testable property: the item that
 * went out unreviewed has to be FIRST, and it has to say what was not measured.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { makeTestDb } from "../../testing/testDb.js";
import { collectDigest, renderDigest } from "./incidentDigest.js";

const NOW = Date.parse("2026-08-30T12:00:00Z");
const HOUR = 3600_000;

function seed(db) {
  const cand = db.prepare(`
    INSERT INTO media_candidates
      (id, created_at, updated_at, story_kind, story_id, platform, post_url, poster_handle,
       poster_display, media_type, intake_source, status, kill_reason, clearance_basis,
       constructed_video_id)
    VALUES (@id, @at, @at, 'article', 's1', @platform, @url, @handle, @display,
            'video', 'auto', @status, @kill, @basis, @video)`);
  const ev = db.prepare(`
    INSERT INTO media_candidate_events
      (candidate_id, ts, from_status, to_status, check_name, actor, evidence)
    VALUES (@id, @ts, 'verifying', @to, @check, @actor, @evidence)`);

  // Clean pass, most recent — must NOT lead the digest.
  cand.run({ id: "clean", at: NOW - HOUR, platform: "x", url: "https://x.com/a/1",
             handle: "witness1", display: null, status: "published", kill: null,
             basis: "licensed", video: "vid_clean" });
  ev.run({ id: "clean", ts: NOW - HOUR, to: "verified", check: "provenance", actor: "system", evidence: null });

  // Waved on by auto mode, older — must lead.
  cand.run({ id: "waved", at: NOW - 6 * HOUR, platform: "x", url: "https://x.com/b/2",
             handle: "witness2", display: "Eyewitness Two", status: "published", kill: null,
             basis: "fair_use", video: "vid_waved" });
  ev.run({ id: "waved", ts: NOW - 6 * HOUR, to: "verified", check: "corroboration", actor: "auto",
           evidence: JSON.stringify({ autoResolved: true, machineVerdict: "needs_human",
                                      machineReason: "uncorroborated", note: "only one source found" }) });

  // Killed — shown, but last.
  cand.run({ id: "killed", at: NOW - 2 * HOUR, platform: "x", url: "https://x.com/c/3",
             handle: "witness3", display: null, status: "killed", kill: "sensitive_story",
             basis: null, video: null });
  ev.run({ id: "killed", ts: NOW - 2 * HOUR, to: "killed", check: "sensitivity", actor: "system",
           evidence: JSON.stringify({ note: "politically live" }) });
}

test("THE UNREVIEWED ITEM LEADS, even though it is the oldest", () => {
  // A digest in time order buries the one candidate that needs a human under
  // the ones that do not, and then it stops being read.
  const { db } = makeTestDb();
  seed(db);
  const d = collectDigest(db, { since: NOW - 24 * HOUR, now: NOW });
  assert.equal(d.items[0].id, "waved");
  assert.equal(d.items[d.items.length - 1].id, "killed", "kills sort last — they need no action");
  assert.equal(d.unreviewed, 1);
  assert.equal(d.killed, 1);
});

test("it says WHAT WAS NOT MEASURED, not merely that something was auto", () => {
  const { db } = makeTestDb();
  seed(db);
  const d = collectDigest(db, { since: NOW - 24 * HOUR, now: NOW });
  const [a] = d.items[0].autoResolved;
  assert.equal(a.check, "corroboration");
  assert.equal(a.machineVerdict, "needs_human");
  assert.equal(a.machineReason, "uncorroborated");
  assert.equal(a.note, "only one source found");
});

test("every line carries its source link — review means opening the post", () => {
  const { db } = makeTestDb();
  seed(db);
  const text = renderDigest(collectDigest(db, { since: NOW - 24 * HOUR, now: NOW }));
  for (const url of ["https://x.com/a/1", "https://x.com/b/2", "https://x.com/c/3"]) {
    assert.ok(text.includes(url), `missing source link ${url}`);
  }
  assert.match(text, /UNREVIEWED/);
  assert.match(text, /waved on: corroboration/);
  assert.match(text, /machine said needs_human/);
});

test("the rendered digest leads with the count that matters", () => {
  const { db } = makeTestDb();
  seed(db);
  const text = renderDigest(collectDigest(db, { since: NOW - 24 * HOUR, now: NOW }));
  const head = text.split("\n").slice(0, 2).join(" ");
  assert.match(head, /1 proceeded UNREVIEWED/);
  assert.match(head, /1 killed/);
});

test("an empty window says so rather than rendering a blank page", () => {
  const { db } = makeTestDb();
  const text = renderDigest(collectDigest(db, { since: NOW - HOUR, now: NOW }));
  assert.match(text, /Nothing with incident media/);
});

test("malformed evidence JSON does not break the digest", () => {
  // The digest is the review; it failing closed would mean no review at all.
  const { db } = makeTestDb();
  seed(db);
  db.prepare(`INSERT INTO media_candidate_events (candidate_id, ts, from_status, to_status, check_name, actor, evidence)
              VALUES ('waved', ?, 'verifying', 'verified', 'rights', 'auto', '{not json')`).run(NOW - 5 * HOUR);
  assert.doesNotThrow(() => collectDigest(db, { since: NOW - 24 * HOUR, now: NOW }));
});
