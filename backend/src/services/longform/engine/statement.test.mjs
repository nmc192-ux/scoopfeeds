// statement.test.mjs — the evidence layer's capture rules, offline (#82).
//
// Run:  node --test .claude/skills/video-factory/engine/statement.test.mjs
//
// Every network call goes through an injected fetchImpl with recorded
// fixture shapes — the suite must pass on a machine with no network, and a
// live endpoint change shows up as a capture failure in production use, not
// as a flaky test. The rules under test, in order of consequence:
//   1. no found-screenshot path exists — evidence enters only via capture
//   2. verbatim or nothing — the card throws on word-level drift
//   3. a reply without its archived parent is rejected
//   4. deleted / changed / unreachable are distinguished at re-verify

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  tweetIdFromUrl, syndicationToken, oembedTextFromHtml,
  fetchStatement, captureStatement, loadStatement, assertVerbatim, verifyStatement,
} from "./statement.mjs";
import { renderCard } from "./render.mjs";

const TMP = mkdtempSync(path.join(os.tmpdir(), "stmt-"));
const P = (...a) => path.join(TMP, ...a);

const URL1 = "https://x.com/somesenator/status/1900000000000000001";
const SYN1 = {
  text: "The strait is closed. Effective immediately.",
  user: { name: "Some Senator", screen_name: "somesenator" },
  created_at: "2026-03-04T14:02:00.000Z",
};
const OEMBED1 = {
  author_name: "Some Senator",
  author_url: "https://twitter.com/somesenator",
  html: `<blockquote class="twitter-tweet"><p lang="en">The strait is closed. Effective immediately.</p>&mdash; Some Senator (@somesenator) <a href="${URL1}">March 4, 2026</a></blockquote>`,
};

/** A fetch stub: route by URL substring → { status, json } or a throw. */
const stub = (routes) => async (url) => {
  for (const [needle, res] of routes) {
    if (String(url).includes(needle)) {
      if (res instanceof Error) throw res;
      return { ok: res.status === 200, status: res.status, json: async () => res.json };
    }
  }
  throw new Error(`unstubbed fetch: ${url}`);
};

test("id and token derivation", () => {
  assert.equal(tweetIdFromUrl(URL1), "1900000000000000001");
  assert.equal(tweetIdFromUrl("https://twitter.com/a/statuses/42?s=20"), "42");
  assert.equal(tweetIdFromUrl("https://x.com/a/photo/1"), null);
  assert.ok(syndicationToken("1900000000000000001").length > 0);
  assert.doesNotMatch(syndicationToken("1900000000000000001"), /[0.]/, "token strips 0 and dot");
});

test("oEmbed HTML round-trips entities and line breaks to plain text", () => {
  const html = `<blockquote><p lang="en">Rates &amp; risk:<br>up &gt;40%. &#39;No slack&#39; — <a href="https://t.co/x">source</a></p>&mdash; A</blockquote>`;
  assert.equal(oembedTextFromHtml(html), "Rates & risk:\nup >40%. 'No slack' — source");
});

test("capture archives the syndication record with oEmbed as secondary provenance", async () => {
  const fetchImpl = stub([
    ["syndication.twimg.com", { status: 200, json: SYN1 }],
    ["publish.twitter.com", { status: 200, json: OEMBED1 }],
  ]);
  const rec = await captureStatement(URL1, { P, fetchImpl });
  assert.equal(rec.text, SYN1.text);
  assert.equal(rec.handle, "somesenator");
  assert.equal(rec.createdAt, SYN1.created_at);
  const onDisk = JSON.parse(readFileSync(P("out/evidence/1900000000000000001.json"), "utf8"));
  assert.equal(onDisk.text, SYN1.text, "the archive is the record");
  assert.ok(onDisk.raw.syndication && onDisk.raw.oembed, "both raw responses archived as provenance");
});

test("syndication down → oEmbed text still captures; both down → refuses", async () => {
  const rec = await fetchStatement(URL1, { fetchImpl: stub([
    ["syndication.twimg.com", new Error("ECONNRESET")],
    ["publish.twitter.com", { status: 200, json: OEMBED1 }],
  ]) });
  assert.equal(rec.text, "The strait is closed. Effective immediately.");
  await assert.rejects(
    () => fetchStatement(URL1, { fetchImpl: stub([
      ["syndication.twimg.com", new Error("ECONNRESET")],
      ["publish.twitter.com", new Error("ECONNRESET")],
    ]) }),
    /both endpoints unreachable/,
  );
});

test("a deleted statement refuses capture, naming the reason", async () => {
  await assert.rejects(
    () => fetchStatement(URL1, { fetchImpl: stub([
      ["syndication.twimg.com", { status: 404, json: {} }],
    ]) }),
    /not found \(deleted, private, or never existed\)/,
  );
});

test("THE THREAD RULE: a reply without its archived parent is rejected", async () => {
  const REPLY_URL = "https://x.com/somesenator/status/1900000000000000002";
  const REPLY = { ...SYN1, text: "And it stays closed.", in_reply_to_status_id_str: "1900000000000000001" };
  const fetchImpl = stub([
    ["syndication.twimg.com", { status: 200, json: REPLY }],
    ["publish.twitter.com", { status: 200, json: OEMBED1 }],
  ]);
  // No parent declared → rejected.
  await assert.rejects(() => captureStatement(REPLY_URL, { P, fetchImpl }), /is a REPLY.*capture the parent first/s);
  // Wrong parent declared → rejected.
  await assert.rejects(
    () => captureStatement(REPLY_URL, { P, fetchImpl, parent: "1900000000000000001" })
      .then(() => captureStatement(REPLY_URL, { P, fetchImpl, parent: "999" })),
    /not archived|not its actual parent/,
  );
  // Right parent, already archived (by the earlier capture test) → accepted, linked.
  const rec = await captureStatement(REPLY_URL, { P, fetchImpl, parent: "1900000000000000001" });
  assert.equal(rec.parent, "1900000000000000001");
});

test("loadStatement refuses an id that was never captured", () => {
  assert.throws(() => loadStatement("777", { P }), /evidence enters only through captureStatement/);
});

test("verifyStatement distinguishes ok / changed / deleted / unreachable", async () => {
  const rec = loadStatement("1900000000000000001", { P });
  assert.deepEqual(await verifyStatement(rec, { fetchImpl: stub([
    ["syndication.twimg.com", { status: 200, json: SYN1 }],
    ["publish.twitter.com", { status: 200, json: OEMBED1 }],
  ]) }), { status: "ok" });
  const changed = await verifyStatement(rec, { fetchImpl: stub([
    ["syndication.twimg.com", { status: 200, json: { ...SYN1, text: "The strait is OPEN." } }],
    ["publish.twitter.com", { status: 200, json: OEMBED1 }],
  ]) });
  assert.equal(changed.status, "changed");
  assert.equal((await verifyStatement(rec, { fetchImpl: stub([
    ["syndication.twimg.com", { status: 404, json: {} }],
  ]) })).status, "deleted");
  assert.equal((await verifyStatement(rec, { fetchImpl: stub([
    ["syndication.twimg.com", new Error("ECONNRESET")],
    ["publish.twitter.com", new Error("ECONNRESET")],
  ]) })).status, "unreachable");
});

// ── The card: verbatim or nothing, and no path from a found image ───────────

test("the tweet card renders from an archived record and animates", async () => {
  const statement = loadStatement("1900000000000000001", { P });
  const f1 = P("card-1.png"), f2 = P("card-2.png");
  await renderCard({ card: "tweet", statement }, f1, 1.0);
  await renderCard({ card: "tweet", statement }, f2, 0.3);
  assert.ok(existsSync(f1) && existsSync(f2));
  assert.notEqual(readFileSync(f1).length, 0);
  assert.notDeepEqual(readFileSync(f1), readFileSync(f2), "the card must animate");
});

test("the tweet card throws on word-level drift — line breaks are allowed, edits are not", async () => {
  const statement = loadStatement("1900000000000000001", { P });
  // Re-breaking lines: allowed (presentation).
  await renderCard({ card: "tweet", statement,
    text: "The strait is closed.\nEffective immediately." }, P("ok.png"), 1.0);
  // Changing a word: refused (the archive is the record).
  await assert.rejects(
    () => renderCard({ card: "tweet", statement,
      text: "The strait is closed. Effective now." }, P("bad.png"), 1.0),
    /differs from the archive/,
  );
});

test("the card refuses anything that is not an archived record", async () => {
  await assert.rejects(
    () => renderCard({ card: "tweet", statement: { text: "free-floating quote" } }, P("no.png"), 1.0),
    /evidence enters only through the archive/,
  );
  assert.throws(() => assertVerbatim("x", { id: "1", text: "y" }), /differs from the archive/);
});
