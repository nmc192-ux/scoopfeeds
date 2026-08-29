/**
 * The permission request. Tested as a document, because that is what it is: a
 * message a real person sends under their own name, making commitments someone
 * else will rely on.
 *
 * The assertions below are about CONTENT — that the ask names the use, the
 * credit, the platforms, and an easy way to say no. A template that drifted into
 * omitting the decline line, or into implying payment, would still be a
 * perfectly well-formed string.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { draftGrantRequest, renderGrantDraft, PUBLISH_SURFACES, GrantDraftError } from "./incidentGrantDraft.js";

const CAND = {
  id: "c1", platform: "bluesky",
  post_url: "https://bsky.app/profile/alice.bsky.social/post/3kaaa",
  poster_handle: "alice.bsky.social", poster_display: "Alice R",
};

const draft = (over = {}) => draftGrantRequest({
  candidate: CAND, operatorName: "Nauman", storyTitle: "the Genoa bridge inspection", ...over,
});

function caught(fn, Type) {
  try { fn(); } catch (err) {
    if (Type) assert.ok(err instanceof Type, `expected ${Type.name}, got ${err?.name}`);
    return err;
  }
  assert.fail("expected a throw, got none");
}

test("the request names the sender, the outlet and the exact post", () => {
  const d = draft();
  assert.match(d.body, /I'm Nauman from ScoopFeeds/);
  assert.ok(d.body.includes(CAND.post_url), "the exact post must be quoted back");
  assert.match(d.body, /Genoa bridge inspection/);
});

test("it states the use plainly: an excerpt, edited, with commentary over it", () => {
  const body = draft().body;
  assert.match(body, /short excerpt/i);
  assert.match(body, /edited news video/i);
  assert.match(body, /commentary and on-screen text/i);
});

test("it names the exact credit that will appear on screen", () => {
  const d = draft();
  assert.equal(d.creditText, "Alice R / BLUESKY");
  assert.ok(d.body.includes('"Alice R / BLUESKY"'), "the credit must appear verbatim in the message");
  assert.match(d.body, /for as long as your footage is visible/i);
});

test("it names every platform the video may reach — the ask has to be honest about reach", () => {
  const body = draft().body;
  for (const surface of PUBLISH_SURFACES) {
    assert.ok(body.includes(surface), `${surface} is a publish surface but is not named in the request`);
  }
});

test("it is explicit about what is NOT being asked for", () => {
  const body = draft().body;
  assert.match(body, /you keep your copyright/i);
  assert.match(body, /isn't exclusive/i);
  assert.match(body, /not offering payment/i);
});

test("it offers an easy no, and says there will be no follow-up", () => {
  // A request that makes refusing awkward is pressure, not consent.
  const body = draft().body;
  assert.match(body, /just say no or ignore this/i);
  assert.match(body, /won't follow up/i);
});

test("it says the grant is revocable before publication", () => {
  assert.match(draft().body, /change your mind before we publish/i);
});

test("it asks the verification question — did you film it, where, when", () => {
  const body = draft().body;
  assert.match(body, /filmed this yourself/i);
  assert.match(body, /where and when/i);
});

test("it asks for the original file, which is the cleanest route on every platform", () => {
  assert.match(draft().body, /send the original file/i);
});

test("the terms offered are structured data, not only prose", () => {
  // The ledger stores these, so what was promised is recoverable without
  // parsing English.
  const t = draft().termsOffered;
  assert.equal(t.credit, "Alice R / BLUESKY");
  assert.equal(t.payment, "none offered");
  assert.equal(t.exclusivity, "none — you keep your copyright and can post or license it anywhere else");
  assert.equal(t.revocable, "yes, before publication — tell us and we will not use it");
  assert.deepEqual(t.surfaces, [...PUBLISH_SURFACES]);
});

test("the prose and the structured terms agree about the credit", () => {
  // Two statements of one fact is exactly how they drift apart.
  const d = draft();
  assert.equal(d.termsOffered.credit, d.creditText);
  assert.ok(d.body.includes(d.termsOffered.credit));
});

// ─── Platform notes ─────────────────────────────────────────────────────────

test("each platform gets its own practical note about how to actually reach someone", () => {
  const notes = {};
  for (const platform of ["x", "instagram", "tiktok", "bluesky", "mastodon", "reddit", "youtube"]) {
    const d = draft({ candidate: { ...CAND, platform } });
    assert.ok(d.platformNote, `${platform} has no platform note`);
    notes[platform] = d.platformNote;
  }
  assert.equal(new Set(Object.values(notes)).size, Object.keys(notes).length,
    "the notes should be platform-specific, not one note repeated");
});

test("an unknown platform gets no note rather than a wrong one", () => {
  assert.equal(draft({ candidate: { ...CAND, platform: "carrier-pigeon" } }).platformNote, null);
});

test("the checklist says the operator sends it, from their own account", () => {
  const list = draft().checklist.join(" ");
  assert.match(list, /from your own/i);
  assert.match(list, /not an automated one/i);
  assert.match(list, /One message\. Do not follow up/i);
});

// ─── Refusals ───────────────────────────────────────────────────────────────

test("a draft without a named sender is refused — an unsigned request is one to ignore", () => {
  for (const name of [undefined, "", "   ", null]) {
    assert.equal(caught(() => draft({ operatorName: name }), GrantDraftError).code, "no-operator-name");
  }
});

test("a draft with no credit possible is refused, because the request promises one", () => {
  const err = caught(
    () => draft({ candidate: { ...CAND, poster_handle: null, poster_display: null } }),
    GrantDraftError
  );
  assert.equal(err.code, "no-credit");
});

test("a draft without the post URL is refused", () => {
  assert.equal(caught(() => draft({ candidate: { ...CAND, post_url: "" } }), GrantDraftError).code, "no-post-url");
});

// ─── No model, no network ───────────────────────────────────────────────────

test("the draft is deterministic — the same inputs give byte-identical text", () => {
  // If a model were ever introduced here, this is what would start failing.
  const a = draft().body;
  const b = draft().body;
  assert.equal(a, b);
});

test("the module imports nothing that could send or generate anything", async () => {
  const { readFileSync } = await import("fs");
  const src = readFileSync(new URL("./incidentGrantDraft.js", import.meta.url), "utf8");
  for (const forbidden of [/\bfetch\s*\(/, /require\s*\(\s*["']https?/, /gemini/i, /openai/i, /llmQueue/, /axios/]) {
    assert.equal(forbidden.test(src), false, `incidentGrantDraft.js matches ${forbidden} — it must neither send nor generate`);
  }
});

test("the rendered form carries the body verbatim so it can be pasted into a DM", () => {
  const d = draft();
  const rendered = renderGrantDraft(d);
  assert.ok(rendered.includes(d.body), "the body must survive rendering unchanged");
  assert.ok(rendered.includes(d.creditText));
  assert.ok(rendered.includes(d.platformNote));
});
