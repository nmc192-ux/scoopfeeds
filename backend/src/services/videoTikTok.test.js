/**
 * TikTok as the fifth channel on one render.
 *
 * The interesting tests here are not "does it post" — they are the three ways
 * this channel could do damage: publishing to everyone when nobody asked,
 * undoing an already-published YouTube video, and claiming a post that never
 * happened.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tiktokPrivacyLevel, TIKTOK_PRIVACY_LEVELS } from "./tiktokClient.js";

const withEnv = async (vars, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
};

test("privacy defaults to SELF_ONLY when nothing is set", async () => {
  // This was a hardcoded constant because an unaudited client is REFUSED any
  // other value. The app is approved now, so it became a real choice — and a
  // choice must not change behaviour for anyone who never made it.
  await withEnv({ VIDEO_TIKTOK_PRIVACY: undefined }, () => {
    assert.equal(tiktokPrivacyLevel(), "SELF_ONLY");
  });
});

test("a typo falls back to private rather than publishing to everyone", async () => {
  // The failure mode worth engineering against: an env var one character wrong
  // must not be the reason something goes public.
  for (const bad of ["PUBLIC", "everyone", "public-to-everyone", "TRUE", "1", " ", "PUBLIC_TO_EVERYONE_"]) {
    await withEnv({ VIDEO_TIKTOK_PRIVACY: bad }, () => {
      assert.equal(tiktokPrivacyLevel(), "SELF_ONLY", `"${bad}" was not rejected`);
    });
  }
});

test("every level TikTok documents is accepted, case-insensitively", async () => {
  for (const level of TIKTOK_PRIVACY_LEVELS) {
    await withEnv({ VIDEO_TIKTOK_PRIVACY: level.toLowerCase() }, () => {
      assert.equal(tiktokPrivacyLevel(), level);
    });
  }
});

test("PUBLIC_TO_EVERYONE is reachable — the approval is real", async () => {
  // Verified live 2026-08-24: creator_info returned
  // ["PUBLIC_TO_EVERYONE","MUTUAL_FOLLOW_FRIENDS","SELF_ONLY"], so the
  // unaudited-client restriction that made this impossible is gone.
  await withEnv({ VIDEO_TIKTOK_PRIVACY: "PUBLIC_TO_EVERYONE" }, () => {
    assert.equal(tiktokPrivacyLevel(), "PUBLIC_TO_EVERYONE");
  });
});

test("the channel is off unless explicitly enabled", async () => {
  const { videoToTikTok } = await import("./videoAutopost.js");
  for (const v of [undefined, "", "0", "true", "yes"]) {
    await withEnv({ VIDEO_TIKTOK_ENABLED: v }, async () => {
      const r = await videoToTikTok({ id: "a1" }, { filePath: "/nope.mp4", title: "t" });
      assert.equal(r.status, "off", `VIDEO_TIKTOK_ENABLED=${JSON.stringify(v)} should not enable the channel`);
    });
  }
});
