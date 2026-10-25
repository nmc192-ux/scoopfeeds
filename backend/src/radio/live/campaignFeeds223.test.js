/**
 * campaignFeeds223.test.js - #223: candidates' and campaigns' own streams, PROPOSED entries.
 * A `proposed: true` entry cannot air; the same entry airs once DrJ removes the flag. No network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { OFFICIAL_FEEDS, assertCanAir, entryForUrl, isProposed, feedById } from "./officialFeeds.js";
import { validateEvent, fetchPublisherEvents } from "./eventsCalendar.js";

const PASS = { ok: true, reason: "live, public, plays without a login", mediaUrl: "https://media.example/x.m3u8", httpHeaders: {} };
const proposed = OFFICIAL_FEEDS.filter(isProposed);
const approve = (e) => { const { proposed: _drop, ...rest } = e; return { ...rest, addedBy: "DrJ (test)" }; };

test("#223 proposes campaign entries, and every one is marked proposed", () => {
  assert.ok(proposed.length > 0, "at least one proposed campaign entry");
  for (const e of OFFICIAL_FEEDS.filter((f) => /campaign$/.test(f.publisher))) {
    assert.equal(e.proposed, true, `${e.id} is proposed`);
  }
});

test("each proposed entry has the fields DrJ needs to approve or strike it", () => {
  for (const e of proposed) {
    assert.match(e.id, /^[a-z0-9-]+$/, e.id);
    assert.match(e.publisher, / campaign$/, `${e.id} publisher "<Name> campaign"`);
    assert.equal(e.addedBy, "PROPOSED (engine), awaiting DrJ", e.id);
    assert.ok(Array.isArray(e.youtube) && e.youtube.length === 1 && /^@[A-Za-z0-9._-]+$/.test(e.youtube[0]), `${e.id} one @handle`);
    assert.deepEqual(e.pages, [], `${e.id}: no campaign stream pages proposed`);
    assert.match(e.why, /https:\/\/\S+/, `${e.id} why names where the handle was verified`);
    assert.ok(!e.schedule, `${e.id} never airs on its own schedule`);
  }
});

test("a proposed entry cannot air, and the same entry airs once the flag is removed", () => {
  const e = proposed[0];
  const url = `https://www.youtube.com/${e.youtube[0]}/live`;
  assert.equal(entryForUrl(url)?.id, e.id);
  assert.throws(() => assertCanAir({ entryId: e.id, url, probe: { ...PASS, uploaderHandle: e.youtube[0] } }),
    /proposed and awaiting DrJ/);
  const feeds = OFFICIAL_FEEDS.map((f) => (f.id === e.id ? approve(f) : f));
  assert.equal(assertCanAir({ entryId: e.id, url, probe: { ...PASS, uploaderHandle: e.youtube[0] } }, { feeds }).id, e.id);
});

test("every proposed entry is refused at the gate, even with a passing probe", () => {
  for (const e of proposed) {
    const url = `https://www.youtube.com/${e.youtube[0]}/live`;
    assert.throws(() => assertCanAir({ entryId: e.id, url, probe: { ...PASS, uploaderHandle: e.youtube[0] } }), /proposed/, e.id);
  }
});

test("a truthy non-boolean `proposed` still refuses (fails closed); false does not", () => {
  const e = proposed[0];
  const url = `https://www.youtube.com/${e.youtube[0]}/live`;
  const probe = { ...PASS, uploaderHandle: e.youtube[0] };
  for (const v of ["yes", 1, null]) {
    const feeds = OFFICIAL_FEEDS.map((f) => (f.id === e.id ? { ...approve(f), proposed: v } : f));
    assert.throws(() => assertCanAir({ entryId: e.id, url, probe }, { feeds }), /proposed/, String(v));
  }
  const feeds = OFFICIAL_FEEDS.map((f) => (f.id === e.id ? { ...approve(f), proposed: false } : f));
  assert.equal(assertCanAir({ entryId: e.id, url, probe }, { feeds }).id, e.id);
});

test("approved campaign entries keep the existing rules: probe must tie a watch URL to the handle", () => {
  const e = approve(proposed[0]);
  const feeds = OFFICIAL_FEEDS.map((f) => (f.id === e.id ? e : f));
  const watch = "https://www.youtube.com/watch?v=abcdefghijk";
  assert.throws(() => assertCanAir({ entryId: e.id, url: watch, probe: PASS }, { feeds }), /not on the official-feeds allow-list/);
  assert.throws(() => assertCanAir({ entryId: e.id, url: watch, probe: { ...PASS, uploaderHandle: "@SomeoneElse" } }, { feeds }), /refused/);
  assert.equal(assertCanAir({ entryId: e.id, url: watch, probe: { ...PASS, uploaderHandle: e.youtube[0] } }, { feeds }).id, e.id);
  // never-air hosts win over any entry
  assert.throws(() => assertCanAir({ entryId: e.id, url: `https://www.youtube.com/${e.youtube[0]}/live`,
    probe: { ...PASS, uploaderHandle: e.youtube[0], mediaUrl: "https://live.cnn.com/x.m3u8" } }, { feeds }), /another broadcaster/);
  assert.throws(() => assertCanAir({ entryId: e.id, url: "https://www.cnn.com/live", probe: PASS }, { feeds }), /another broadcaster/);
  // no probe, no air
  assert.throws(() => assertCanAir({ entryId: e.id, url: `https://www.youtube.com/${e.youtube[0]}/live`, probe: null }, { feeds }), /did not run/);
});

test("the calendar refuses a manual event on a proposed feed and does not fetch its schedule", async () => {
  const e = proposed[0];
  const r = validateEvent({ feed: e.id, url: `https://www.youtube.com/${e.youtube[0]}/live`, title: "Victory speech", start: "2026-11-04T03:00:00Z" });
  assert.match(r.error || "", /proposed/);
  const seen = [];
  const run = async (_cmd, args) => { seen.push(args.join(" ")); return { code: 0, stdout: "" }; };
  await fetchPublisherEvents({ run });
  for (const p of proposed) assert.ok(!seen.some((a) => a.includes(`/${p.youtube[0]}/`)), `${p.id} schedule not fetched`);
  assert.ok(seen.some((a) => a.includes("/@NASA/")), "approved entries are still fetched");
});

test("no proposed handle duplicates an approved entry's handle", () => {
  const approved = new Set(OFFICIAL_FEEDS.filter((f) => !isProposed(f)).flatMap((f) => (f.youtube || []).map((h) => h.toLowerCase())));
  const seen = new Set();
  for (const e of proposed) for (const h of e.youtube) {
    const k = h.toLowerCase();
    assert.ok(!approved.has(k) && !seen.has(k), `${e.id} ${h} unique`); seen.add(k);
  }
  assert.equal(feedById("nasa").proposed, undefined, "#202 entries are untouched");
});
