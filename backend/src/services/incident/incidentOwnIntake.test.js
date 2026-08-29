/**
 * THE OWN-MATERIAL DOOR, and a test that own-lane coverage actually uses it.
 *
 * WHAT WENT WRONG, because the test is shaped by it. The `owner` clearance basis
 * shipped in Phase 3 and the own render lane in Gate E, and neither was reachable
 * from intake: `createCandidate` routes every URL through `parsePostUrl`, which
 * demands a web address on one of seven social platforms, and material the
 * operator shot has no post behind it. All four plausible spellings were refused.
 *
 * The gap survived review because every own-lane test BORROWED A BLUESKY URL and
 * then cleared on the `owner` basis. Those tests were true and they read as
 * end-to-end, which is the dangerous combination: they exercised the owner basis
 * and the owner render path while never touching owner intake, because owner
 * intake did not exist.
 *
 * SO THE TEST THAT MATTERS HERE IS `the own lane is not reachable through the
 * social door`. Building the intake fixes the code once; that test is what stops
 * the borrowed-URL shape coming back — it fails if own material can be
 * manufactured through `createCandidate`, whatever the URL.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { makeTestDb } from "../../testing/testDb.js";
import {
  createCandidate, createOwnCandidate, getCandidate, candidateTrail,
  OWN_PLATFORM, OWN_REF_PREFIX, ownRefFor, isOwnRef, LedgerError,
} from "./incidentLedger.js";
import { PLATFORMS, IntakeRefusedError } from "./incidentIntake.js";
import { sha256OfFile, ingestFile } from "./incidentFiles.js";

function caught(fn, Type) {
  try { fn(); } catch (err) {
    if (Type) assert.ok(err instanceof Type, `expected ${Type.name}, got ${err?.name}: ${err?.message}`);
    return err;
  }
  assert.fail("expected a throw, got none");
}

function db0() {
  const t = makeTestDb({ prefix: "incident-own-" });
  const n = Date.now();
  t.db.prepare(`INSERT INTO articles (id,title,url,source_name,category,published_at,fetched_at)
                VALUES ('art-1','New footbridge opens over the canal','https://n.example/1','E','world',?,?)`).run(n, n);
  return t;
}

let seq = 0;
const HASH = (s = `clip-${++seq}`) => createHash("sha256").update(s).digest("hex");
const own = (db, over = {}) =>
  createOwnCandidate(db, { storyKind: "article", storyId: "art-1", sha256: HASH(), mediaType: "video", ...over });

// ─── The door exists and records the right things ───────────────────────────

test("own material intakes with no URL, no poster, and the file as its identity", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const sha = HASH("a specific clip");
  const { created, candidate } = own(t.db, { sha256: sha });

  assert.equal(created, true);
  assert.equal(candidate.platform, OWN_PLATFORM);
  assert.equal(candidate.post_url, `${OWN_REF_PREFIX}${sha}`);
  assert.equal(candidate.status, "candidate");

  // NO POSTER. There is nobody to name, and a placeholder would sit in the
  // columns `creditTextFor` reads from.
  assert.equal(candidate.poster_handle, null);
  assert.equal(candidate.poster_display, null);

  // We hold the file. `createCandidate` leaves this 'none' because a pasted URL
  // is not a file.
  assert.equal(candidate.acquisition, "held");

  const intake = candidateTrail(t.db, candidate.id).at(-1);
  assert.equal(intake.check_name, "intake:own", "the trail distinguishes which door was used");
  assert.equal(intake.evidence.sha256, sha);
  assert.equal(intake.evidence.platform, OWN_PLATFORM);
});

test("the same footage intakes once — the hash is the dedupe key", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const sha = HASH("the same clip twice");
  const first = createOwnCandidate(t.db, { storyKind: "article", storyId: "art-1", sha256: sha, mediaType: "video" });
  const second = createOwnCandidate(t.db, { storyKind: "article", storyId: "art-1", sha256: sha, mediaType: "video" });

  assert.equal(first.created, true);
  assert.equal(second.created, false, "re-ingesting the same file is idempotent, not an error");
  assert.equal(second.candidate.id, first.candidate.id);
  assert.equal(t.db.prepare("SELECT COUNT(*) c FROM media_candidates").get().c, 1);
});

test("case and whitespace in the hash do not create a second identity", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  const sha = HASH("case test");
  own(t.db, { sha256: sha });
  const again = createOwnCandidate(t.db, {
    storyKind: "article", storyId: "art-1", sha256: `  ${sha.toUpperCase()}  `, mediaType: "video",
  });
  assert.equal(again.created, false, "the identity is the digest, not its spelling");
});

test("the hash must be a hash", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  for (const bad of [undefined, null, "", "not-a-hash", "abc", "g".repeat(64), HASH().slice(0, 63), 12345]) {
    assert.equal(
      caught(() => own(t.db, { sha256: bad }), LedgerError).code, "bad-own-hash",
      `sha256 ${JSON.stringify(bad)} must be refused`
    );
  }
});

test("media_type must be stated — there is no URL to infer it from", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  assert.equal(caught(() => own(t.db, { mediaType: null }), LedgerError).code, "bad-media-type");
  assert.equal(caught(() => own(t.db, { mediaType: "clip" }), LedgerError).code, "bad-media-type");
  for (const ok of ["video", "photo", "unknown"]) {
    assert.equal(own(t.db, { mediaType: ok }).candidate.media_type, ok);
  }
});

test("the story must still exist — own material is not exempt from that", (t0) => {
  const t = db0(); t0.after(() => t.cleanup());
  assert.equal(caught(() => own(t.db, { storyId: "no-such" }), LedgerError).code, "no-such-story");
  assert.equal(caught(() => own(t.db, { storyKind: "nonsense" }), LedgerError).code, "bad-story-kind");
});

test("owning a clip does not skip verification", (t0) => {
  // Provenance is about rights; verification is about truth. The machine's only
  // exits from `candidate` remain verification and the bin.
  const t = db0(); t0.after(() => t.cleanup());
  const { candidate } = own(t.db);
  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.clearance_basis, null);
});

// ─── THE DOOR TEST ──────────────────────────────────────────────────────────

test("the own lane is NOT reachable through the social door", (t0) => {
  // The test the Gate F gap actually needed. Every one of these was tried
  // against the real function before `createOwnCandidate` existed, and every one
  // was refused — that refusal is the thing being pinned, so it cannot quietly
  // become permissive later.
  const t = db0(); t0.after(() => t.cleanup());
  const sha = HASH("door test");
  for (const url of [
    undefined, null, "",
    `scoopfeeds://own/${sha}`,
    "file:///home/user/clip.mp4",
    "https://scoopfeeds.com/own/clip-1",
    ownRefFor(sha),                       // the own reference itself
    `${OWN_REF_PREFIX}${sha}`,
  ]) {
    caught(
      () => createCandidate(t.db, { storyKind: "article", storyId: "art-1", postUrl: url, mediaType: "video" }),
      IntakeRefusedError
    );
  }
  assert.equal(t.db.prepare("SELECT COUNT(*) c FROM media_candidates").get().c, 0,
    "nothing was written by any of them");
});

test("no social URL can produce an own-platform row", (t0) => {
  // The other direction. `createCandidate` derives platform from the parser, so
  // walking every lane it CAN produce and asserting none is `own` is what makes
  // "the door is the only way in" a checked statement rather than a comment.
  const t = db0(); t0.after(() => t.cleanup());
  const urls = {
    bluesky: "https://bsky.app/profile/a.bsky.social/post/3kaaaaaa",
    mastodon: "https://mastodon.social/@a/111111111111111111",
    reddit: "https://www.reddit.com/r/x/comments/abc123/t/",
    x: "https://x.com/a/status/1111111111111111111",
    instagram: "https://www.instagram.com/p/Abc123/",
    tiktok: "https://www.tiktok.com/@a/video/7111111111111111111",
    youtube: "https://www.youtube.com/watch?v=abcdefghijk",
  };
  assert.deepEqual(Object.keys(urls).sort(), [...PLATFORMS].sort(),
    "every lane the parser knows must be covered here");

  for (const [lane, url] of Object.entries(urls)) {
    const { candidate } = createCandidate(t.db, { storyKind: "article", storyId: "art-1", postUrl: url, mediaType: "video" });
    assert.notEqual(candidate.platform, OWN_PLATFORM, `${lane} produced an own-platform row`);
    assert.equal(isOwnRef(candidate.post_url), false, `${lane} produced an own reference`);
  }
});

test("`own` is deliberately NOT in PLATFORMS", () => {
  // Option 1 at Gate F, ruled out: a non-platform in that list leaves every
  // consumer of it quietly wrong, including the operator-facing error that
  // recites the lanes.
  assert.equal(PLATFORMS.includes(OWN_PLATFORM), false);
  assert.equal(PLATFORMS.includes("own"), false);
});

test("isOwnRef recognises the scheme and nothing near it", () => {
  const sha = HASH("ref shapes");
  assert.equal(isOwnRef(ownRefFor(sha)), true);
  for (const near of [
    null, undefined, "", sha, `own:${sha}`, `own:sha256:${sha.slice(0, 63)}`,
    `own:sha256:${sha.toUpperCase()}`, `https://x.com/own:sha256:${sha}`, `own:sha1:${sha}`,
  ]) {
    assert.equal(isOwnRef(near), false, `${JSON.stringify(near)} must not read as an own reference`);
  }
});

// ─── The hash the door takes is the hash the file has ───────────────────────

test("sha256OfFile agrees with ingestFile, so the pair is self-checking", (t0) => {
  // The intended sequence is: hash the source → createOwnCandidate → ingestFile
  // under the new id. If those two hashes ever disagree, the row is describing a
  // different file from the one in quarantine.
  const t = db0(); t0.after(() => t.cleanup());
  const dir = mkdtempSync(path.join(tmpdir(), "own-hash-"));
  t0.after(() => rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, "clip.mp4");
  writeFileSync(src, Buffer.from("not really a video, but it is bytes"));

  const hash = sha256OfFile(src);
  const { candidate } = createOwnCandidate(t.db, {
    storyKind: "article", storyId: "art-1", sha256: hash, mediaType: "video",
  });

  const ing = ingestFile(candidate.id, src, { root: path.join(dir, "q") });
  assert.equal(ing.sha256, hash, "the quarantined file is the file the row names");
  assert.equal(candidate.post_url, ownRefFor(ing.sha256));
});

test("sha256OfFile refuses a file that is not there rather than hashing nothing", () => {
  const err = caught(() => sha256OfFile("/no/such/file.mp4"));
  assert.equal(err.code, "no-file");
});
