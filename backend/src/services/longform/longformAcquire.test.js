/**
 * longformAcquire.test.js — what may be downloaded with nobody watching (#78).
 *
 * Search, download and probe are all injected, so the rules are tested without
 * a network. The rules are the point: an unattended film can only be built
 * from footage whose publisher is the rights holder BY CONSTRUCTION, because
 * a channel strike is not recoverable by editing a description afterwards.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  acquireFootage, makeAcquireMedia, unattendedRefusal, buildQueries,
  VERIFIED, DECLARED, UNVERIFIED,
} from "./longformAcquire.js";
import { screenCandidate } from "./longformMediaGate.js";

const hit = (over = {}) => ({
  source: "DVIDS", provenance: VERIFIED, title: "tanker at sea",
  url: "https://dvidshub.net/video/1", download: "https://dvidshub.net/dl/1.mp4",
  attribution: "US Navy / DVIDS", ...over,
});

const deps = (found, over = {}) => ({
  search: async () => found,
  download: async (_url, dest) => dest,
  probe: async () => ({ measured: true, value: { width: 1920, height: 1080 } }),
  queries: ["strait of hormuz"], destDir: "/tmp/f", want: 6, ...over,
});

// ── The provenance rule ─────────────────────────────────────────────────────

test("ONLY 'verified' PROVENANCE IS FETCHED UNATTENDED", () => {
  assert.equal(unattendedRefusal(hit()), null);

  assert.match(unattendedRefusal(hit({ provenance: DECLARED, source: "Wikimedia Commons" })),
    /still needs a human to look at it/);
  assert.match(unattendedRefusal(hit({ provenance: UNVERIFIED, source: "YouTube" })),
    /a licence the uploader may not hold; never downloaded/);
  assert.match(unattendedRefusal(hit({ provenance: undefined })),
    /unknown provenance/);
});

test("a DVIDS asset marked verified but from an unknown publisher is still refused", () => {
  // Not all DVIDS assets are US Government works — allied and contractor
  // material appears there too. The source list is a second check so a future
  // searcher change cannot quietly widen what gets fetched.
  assert.match(unattendedRefusal(hit({ source: "SomeContractor" })),
    /is marked verified but is not a known public-domain publisher/);
});

test("a search error or a missing url is refused, not retried into", () => {
  assert.match(unattendedRefusal(hit({ error: "429 rate limited" })), /search error/);
  assert.match(unattendedRefusal({ provenance: VERIFIED, source: "NASA" }), /no downloadable url/);
});

// ── Acquisition ─────────────────────────────────────────────────────────────

test("verified hits are downloaded; everything else is refused with a reason", async () => {
  const { candidates, refused } = await acquireFootage(deps([
    hit({ title: "a" }),
    hit({ title: "b", provenance: DECLARED, source: "Wikimedia Commons" }),
    hit({ title: "c", provenance: UNVERIFIED, source: "YouTube" }),
    hit({ title: "d", source: "NASA" }),
  ]));
  assert.equal(candidates.length, 2, "only the two verified public-domain hits");
  assert.equal(refused.length, 2);
  assert.ok(refused.every((r) => r.why), "every refusal names its reason");
});

test("THE FILE IS PROBED, not trusted from the listing", async () => {
  // A search result's advertised resolution describes what the publisher
  // claims. The media gate refuses an unmeasured resolution precisely because
  // the unmeasured clip is the one that turns out to be an upscale.
  const { candidates, refused } = await acquireFootage(deps([hit(), hit({ title: "b" })], {
    probe: async (f) => (f.includes("_1")
      ? { measured: true, value: { width: 3840, height: 2160 } }
      : { measured: false, why: "ffmpeg printed no dimensions" }),
  }));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].width, 3840, "the PROBED value is used, not an assumed one");
  assert.match(refused[0].why, /resolution unmeasurable/);
});

test("a failed download is refused, and does not abort the rest", async () => {
  let n = 0;
  const { candidates, refused } = await acquireFootage(deps([hit(), hit({ title: "b" })], {
    download: async (_u, dest) => { if (++n === 1) throw new Error("connection reset"); return dest; },
  }));
  assert.equal(candidates.length, 1, "the second clip still acquired");
  assert.match(refused[0].why, /download failed: connection reset/);
});

test("acquisition stops once the film has enough", async () => {
  let downloads = 0;
  const { candidates } = await acquireFootage(deps(
    Array.from({ length: 20 }, (_, i) => hit({ title: `c${i}` })),
    { want: 4, download: async (_u, dest) => { downloads++; return dest; } }));
  assert.equal(candidates.length, 4);
  assert.equal(downloads, 4, "no bandwidth spent past what the film needs");
});

// ── What acquisition hands to the gate must pass it ─────────────────────────

test("EVERY ACQUIRED CANDIDATE PASSES THE MEDIA GATE", async () => {
  // The two halves must agree, or acquisition succeeds and the film dies at
  // the gate — after the download.
  const { candidates } = await acquireFootage(deps([hit(), hit({ title: "b", source: "NASA" })]));
  assert.ok(candidates.length);
  for (const c of candidates) {
    assert.deepEqual(screenCandidate(c), [], `acquired clip ${c.key} must satisfy the gate`);
  }
});

test("too few usable clips ABANDONS the topic rather than shipping a loop", async () => {
  // A film built from two clips visibly cycles — the Ebola cut did exactly
  // that, and beat 35 read road-horizon-road-lab-road in seven seconds.
  const acquire = makeAcquireMedia({
    ...deps([hit(), hit({ title: "b", provenance: DECLARED, source: "Wikimedia Commons" })]),
    min: 3,
  });
  await assert.rejects(
    () => acquire({ topic: { title: "T" }, script: null }),
    (e) => /yielded 1 usable clip\(s\), need 3/.test(e.message)
        && /visibly cycles/.test(e.message)
        && /refused:/.test(e.message));
});

// ── Queries ─────────────────────────────────────────────────────────────────

test("queries come from the TOPIC and the through-line, not the narration", () => {
  const q = buildQueries(
    { title: "Iran Declares: Strait CLOSED!", keys: ["strait of hormuz"] },
    { spine: { throughLine: "the ship that cannot move" } });
  assert.ok(q.includes("Iran Declares Strait CLOSED"), "punctuation stripped");
  assert.ok(q.includes("strait of hormuz"));
  assert.ok(q.includes("the ship that cannot move"), "the through-line is the film's best single query");
  assert.ok(q.length <= 4);
});

test("a film with nothing to search for refuses rather than searching blindly", async () => {
  await assert.rejects(() => acquireFootage(deps([], { queries: [] })),
    /a film needs something to look for/);
});
