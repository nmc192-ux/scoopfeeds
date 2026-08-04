/**
 * youtubeClient.test.js — the access-token cache, and the expiry it ignored.
 *
 * `_readCached()` returned the module-scope entry unconditionally, so a process
 * that refreshed once pinned that access token for its whole life. YouTube's
 * last an hour. The worker therefore 401'd on every upload while getChannelInfo
 * in a throwaway container succeeded — a fresh module scope falls through to
 * the disk read, which always checked expiry correctly.
 *
 * A test asserting only "returns a token" passes on the broken version. The one
 * below that fails on it is EXPIRED TOKEN IS REFRESHED, which counts token
 * round trips rather than inspecting the return value.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.SCOOP_PERSISTENT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "ytclient-"));
process.env.YOUTUBE_CLIENT_ID = "cid";
process.env.YOUTUBE_CLIENT_SECRET = "csecret";
process.env.YOUTUBE_REFRESH_TOKEN = "rtoken";

const { getChannelInfo, isYouTubeConfigured } = await import("./youtubeClient.js");

/**
 * Stub fetch, counting token refreshes separately from API calls.
 * `expiresIn` drives what the OAuth endpoint claims, which is how these tests
 * move the clock: the client computes expiresAt = now + (expires_in - 60)s, so
 * an expires_in at or under 60 yields a token that is already past the skew.
 */
function stub({ expiresIn = 3600 } = {}) {
  const calls = { token: 0, api: 0 };
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com/token")) {
      calls.token++;
      return {
        ok: true, status: 200,
        json: async () => ({ access_token: `token-${calls.token}`, expires_in: expiresIn }),
      };
    }
    calls.api++;
    return {
      ok: true, status: 200,
      json: async () => ({ items: [{ id: "UC123", snippet: { title: "Scoopfeeds" }, statistics: {} }] }),
    };
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

/** Each test needs a clean module scope AND a clean disk cache. */
async function freshClient() {
  process.env.SCOOP_PERSISTENT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "ytclient-"));
  return import(`./youtubeClient.js?fresh=${Math.random().toString(36).slice(2)}`);
}

test("the client reports configured from env", () => {
  assert.equal(isYouTubeConfigured(), true);
});

test("a LIVE token is reused — the fix must not defeat caching", async () => {
  const client = await freshClient();
  const { calls, restore } = stub({ expiresIn: 3600 });
  try {
    await client.getChannelInfo();
    await client.getChannelInfo();
    await client.getChannelInfo();
    assert.equal(calls.api, 3, "three API calls");
    assert.equal(calls.token, 1, "but only ONE token refresh — the cache must still work");
  } finally { restore(); }
});

test("an EXPIRED token is refreshed rather than reused", async () => {
  // THE REGRESSION TEST. expires_in 30 → expiresAt = now - 30s after the
  // client's 60s buffer, so the cached entry is already past its window by the
  // second call. On the broken version `if (_cached) return _cached` short
  // circuits and token stays at 1; every subsequent upload carries a dead
  // token and 401s.
  const client = await freshClient();
  const { calls, restore } = stub({ expiresIn: 30 });
  try {
    await client.getChannelInfo();
    assert.equal(calls.token, 1);
    await client.getChannelInfo();
    assert.equal(calls.token, 2,
      "an expired cache entry must trigger a refresh, not be returned as-is");
    await client.getChannelInfo();
    assert.equal(calls.token, 3, "and again — a stale entry must never be pinned");
  } finally { restore(); }
});

test("the refreshed token is the one actually sent on the wire", async () => {
  // Counting refreshes is not enough on its own: a client could refresh and
  // still send the stale value. Pin the Authorization header.
  const client = await freshClient();
  const seen = [];
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com/token")) {
      n++;
      return { ok: true, status: 200, json: async () => ({ access_token: `token-${n}`, expires_in: 30 }) };
    }
    seen.push(init?.headers?.Authorization);
    return { ok: true, status: 200, json: async () => ({ items: [{ id: "UC1", snippet: {}, statistics: {} }] }) };
  };
  try {
    await client.getChannelInfo();
    await client.getChannelInfo();
    assert.deepEqual(seen, ["Bearer token-1", "Bearer token-2"],
      "the second call must carry the NEW token, not the expired one");
  } finally { globalThis.fetch = real; }
});

test("a stale DISK entry is not adopted into memory either", async () => {
  // Both halves of _readCached answer the same question; the disk half was
  // already correct, and this pins that it stays correct once the memory half
  // stopped short-circuiting past it.
  const client = await freshClient();
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    path.join(process.env.SCOOP_PERSISTENT_DATA_DIR, "youtube-token.json"),
    JSON.stringify({ accessToken: "long-dead", expiresAt: Date.now() - 86_400_000 }),
  );
  const { calls, restore } = stub({ expiresIn: 3600 });
  try {
    await client.getChannelInfo();
    assert.equal(calls.token, 1, "an expired token on disk must be refreshed, not used");
  } finally { restore(); }
});

test("a FRESH disk entry is adopted without a refresh — the cross-process path", async () => {
  // This is why the bug split by process lifetime: a new container reads a
  // token another process refreshed. That path must keep working.
  const client = await freshClient();
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    path.join(process.env.SCOOP_PERSISTENT_DATA_DIR, "youtube-token.json"),
    JSON.stringify({ accessToken: "from-another-process", expiresAt: Date.now() + 3600_000 }),
  );
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      throw new Error("must not refresh when a fresh token is on disk");
    }
    seen.push(init?.headers?.Authorization);
    return { ok: true, status: 200, json: async () => ({ items: [{ id: "UC1", snippet: {}, statistics: {} }] }) };
  };
  try {
    await client.getChannelInfo();
    assert.deepEqual(seen, ["Bearer from-another-process"]);
  } finally { globalThis.fetch = real; }
});
