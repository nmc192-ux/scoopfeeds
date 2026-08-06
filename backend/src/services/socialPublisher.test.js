/**
 * socialPublisher.test.js — the incident/healthy boundary for the social cycle.
 *
 * DECLINING TO POST IS HEALTHY HERE and always has been: the cadence guard, an
 * empty candidate set, everything filtered. That doctrine is the reason the
 * cycle heartbeat and the per-platform post signal were separated in the first
 * place. So the mapping that decides which per-platform results count as
 * ATTEMPTS is the whole risk surface of the /fail ping — count the healthy
 * declines and the monitor goes red every quiet night until someone mutes it,
 * which is precisely the failure mode this work exists to avoid.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.SCOOP_PERSISTENT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "socialpub-"));

const { socialCycleFailure } = await import("./socialPublisher.js");

const failed = (platform, reason = "post_failed", error = "boom") => ({ platform, posted: false, reason, error });
const declined = (platform, reason) => ({ platform, posted: false, reason });

test("every attempting platform failing the same way is an incident", () => {
  const r = socialCycleFailure({
    bluesky:   failed("bluesky"),
    threads:   failed("threads"),
    facebook:  failed("facebook"),
  });
  assert.equal(r.uniform, true);
  assert.equal(r.stage, "post_failed");
  assert.equal(r.count, 3);
});

test("HEALTHY DECLINES are not attempts — a quiet cycle must never page", () => {
  // The whole cycle declining is the throttle and the filters working. If these
  // counted, the monitor would go red on any hour with nothing worth posting.
  const r = socialCycleFailure({
    bluesky:   declined("bluesky", "cadence_guard"),
    threads:   declined("threads", "no_candidate"),
    facebook:  declined("facebook", "all_filtered"),
    linkedin:  declined("linkedin", "not_configured"),
    pinterest: declined("pinterest", "dry_run"),
  });
  assert.equal(r.uniform, false);
});

test("a single success anywhere means it is not an incident", () => {
  // Posts are going out. One broken platform is a platform problem, and the
  // per-platform staleness signal already covers that.
  const r = socialCycleFailure({
    bluesky:  { platform: "bluesky", posted: true },
    threads:  failed("threads"),
    facebook: failed("facebook"),
    linkedin: failed("linkedin"),
  });
  assert.equal(r.uniform, false);
});

test("declines mixed with failures judge only the platforms that TRIED", () => {
  // Two attempted, both failed identically; the other three declined healthily.
  const r = socialCycleFailure({
    bluesky:   failed("bluesky"),
    threads:   failed("threads"),
    facebook:  declined("facebook", "cadence_guard"),
    linkedin:  declined("linkedin", "not_configured"),
    pinterest: declined("pinterest", "no_candidate"),
  });
  assert.equal(r.uniform, true);
  assert.equal(r.count, 2, "only the two that actually attempted");
});

test("compose_failed and post_failed are DIFFERENT stages", () => {
  // Two platforms broken two different ways is not one dependency failing.
  const r = socialCycleFailure({
    bluesky: failed("bluesky", "post_failed"),
    threads: failed("threads", "compose_failed"),
  });
  assert.equal(r.uniform, false);
});

test("one lone failure is not an incident — the floor is 2 here", () => {
  assert.equal(socialCycleFailure({ bluesky: failed("bluesky") }).uniform, false);
  assert.equal(
    socialCycleFailure({ bluesky: failed("bluesky"), threads: failed("threads") }).uniform,
    true,
  );
});

test("an empty or malformed cycle result is never an incident", () => {
  assert.equal(socialCycleFailure({}).uniform, false);
  assert.equal(socialCycleFailure(null).uniform, false);
  assert.equal(socialCycleFailure(undefined).uniform, false);
});
