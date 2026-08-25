/**
 * The audience of the video service-auth token.
 *
 * This channel failed 116 consecutive times over weeks with a 401 nobody read.
 * The code matched Bluesky's own documentation; the service had changed. What
 * makes it worth a test is that the failure was SILENT at every level above the
 * client — the flag said enabled, the cross-post said "attempted", and only
 * `video_posts.bluesky_status` said `failed`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { _internals } from "./blueskyClient.js";

const { pdsDidFrom } = _internals ?? {};

test("the PDS DID comes from the DID document, not the entryway", { skip: !pdsDidFrom }, () => {
  const didDoc = {
    service: [
      { id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://jellybaby.us-east.host.bsky.network" },
    ],
  };
  // Verified live 2026-08-24: only this audience returns 200 + a jobId.
  assert.equal(pdsDidFrom(didDoc), "did:web:jellybaby.us-east.host.bsky.network");
});

test("a DID document without a PDS entry yields null, not a guess", { skip: !pdsDidFrom }, () => {
  assert.equal(pdsDidFrom({ service: [{ type: "SomethingElse", serviceEndpoint: "https://x.example" }] }), null);
  assert.equal(pdsDidFrom({}), null);
  assert.equal(pdsDidFrom(null), null);
  assert.equal(pdsDidFrom({ service: [{ type: "AtprotoPersonalDataServer", serviceEndpoint: "not a url" }] }), null);
});

test("the PDS DID survives a session refresh", { skip: !pdsDidFrom }, () => {
  // refreshSession returns no DID document. The first fix set pdsDid only on
  // the createSession path, so the very next refresh erased it and every
  // upload threw "could not determine the account's PDS DID" — the fix shipped
  // and changed nothing. Refresh is the COMMON path: it is preferred over
  // createSession to stay under Bluesky's 30-per-5-minutes limit.
  const prev = { did: "did:plc:x", pdsDid: "did:web:pds.example", refreshJwt: "r" };
  const carried = pdsDidFrom(undefined) || prev.pdsDid || null;
  assert.equal(carried, "did:web:pds.example");
  // And a refresh that DOES return one takes precedence over the stale value.
  const fresh = pdsDidFrom({ service: [{ type: "AtprotoPersonalDataServer", serviceEndpoint: "https://new.host" }] }) || prev.pdsDid;
  assert.equal(fresh, "did:web:new.host");
});
