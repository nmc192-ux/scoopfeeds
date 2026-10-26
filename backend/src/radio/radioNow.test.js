// radioNow.test.js — GET /api/radio/now.json (#261): the schedule for this hour and next, from the grid.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { buildRadioNow, publicWatchUrl } from "./radioNow.js";
import { planHour } from "./programme/grid.js";
import { radioApiRouter } from "../routes/radio.js";

// The same New York instants grid.test.js uses (summer = EDT, winter = EST), so DST is covered.
const ET_MIDNIGHT_SUMMER = Date.parse("2026-10-27T04:00:00Z");   // Tue 27 Oct 2026, 00:00 New York (EDT)
const ET_MIDNIGHT_WINTER = Date.parse("2026-11-10T05:00:00Z");   // Tue 10 Nov 2026, 00:00 New York (EST)
const H = 3_600_000;
const at = (midnight, h, min = 0) => midnight + h * H + min * 60_000;
const GRID = { RADIO_GRID_ENABLED: "1" };

test("labels equal planHour for this hour and next, across a daypart boundary, the fixed film slot and DST", () => {
  for (const midnight of [ET_MIDNIGHT_SUMMER, ET_MIDNIGHT_WINTER]) {
    // 05:40 ET: overnight repeat now, US morning next (daypart boundary at 06:00)
    let r = buildRadioNow(at(midnight, 5, 40), GRID);
    assert.equal(r.basis, "schedule");
    assert.equal(r.now.label, planHour(at(midnight, 5)).label);
    assert.equal(r.next.label, planHour(at(midnight, 6)).label);
    assert.equal(r.now.daypart, "overnight-eu");
    assert.equal(r.next.daypart, "us-morning");
    assert.equal(r.now.startsAt, new Date(at(midnight, 5)).toISOString());
    assert.equal(r.now.endsAt, new Date(at(midnight, 6)).toISOString());
    assert.equal(r.next.startsAt, r.now.endsAt);

    // 20:15 ET: the next hour is the FIXED feature slot (21 ET)
    r = buildRadioNow(at(midnight, 20, 15), GRID);
    assert.equal(r.now.label, planHour(at(midnight, 20)).label);
    assert.equal(r.next.label, planHour(at(midnight, 21)).label);
    assert.equal(r.now.feature, null);
    assert.deepEqual(r.next.feature, { title: "The ScoopFeeds film", promo: "tonight at 9 ET" });
    assert.equal(r.nextFeature.at, new Date(at(midnight, 21)).toISOString());

    // 21:20 ET: the film hour is now
    r = buildRadioNow(at(midnight, 21, 20), GRID);
    assert.equal(r.now.daypart, "primetime");
    assert.ok(r.now.feature);
    assert.equal(r.nextFeature.at, new Date(at(midnight, 21)).toISOString(), "the hour in progress counts");
  }
});

test("grid off (anything but literally \"1\") → now/next null, never an invented label", () => {
  for (const v of [undefined, "", "0", "true", " 1"]) {
    const r = buildRadioNow(at(ET_MIDNIGHT_SUMMER, 12), v === undefined ? {} : { RADIO_GRID_ENABLED: v });
    assert.equal(r.basis, "schedule");
    assert.equal(r.now, null, `RADIO_GRID_ENABLED=${v}`);
    assert.equal(r.next, null);
    assert.equal(r.nextFeature, null);
  }
});

test("watchUrl comes only from RADIO_PUBLIC_WATCH_URL, and only an http(s) URL", () => {
  assert.equal(buildRadioNow(at(ET_MIDNIGHT_SUMMER, 12), GRID).watchUrl, null);
  assert.equal(buildRadioNow(at(ET_MIDNIGHT_SUMMER, 12), { ...GRID, RADIO_YT_STREAM_ID: "abc-def" }).watchUrl, null, "never derived from the ingest stream id");
  assert.equal(publicWatchUrl({ RADIO_PUBLIC_WATCH_URL: "https://www.youtube.com/@ScoopFeeds/live" }), "https://www.youtube.com/@ScoopFeeds/live");
  assert.equal(publicWatchUrl({ RADIO_PUBLIC_WATCH_URL: "javascript:alert(1)" }), null);
  assert.equal(publicWatchUrl({ RADIO_PUBLIC_WATCH_URL: "not a url" }), null);
  assert.equal(publicWatchUrl({ RADIO_PUBLIC_WATCH_URL: "   " }), null);
});

test("route: 404 unless RADIO_ENABLED=true; serves the schedule when on", async () => {
  const app = express();
  app.use("/api/radio", radioApiRouter);
  const srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const saved = { ...process.env };
  try {
    delete process.env.RADIO_ENABLED;
    assert.equal((await fetch(`${base}/api/radio/now.json`)).status, 404);
    process.env.RADIO_ENABLED = "false";
    assert.equal((await fetch(`${base}/api/radio/now.json`)).status, 404);

    process.env.RADIO_ENABLED = "true";
    process.env.RADIO_GRID_ENABLED = "1";
    delete process.env.RADIO_PUBLIC_WATCH_URL;
    const res = await fetch(`${base}/api/radio/now.json`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const j = await res.json();
    assert.equal(j.basis, "schedule");
    assert.equal(j.watchUrl, null);
    assert.ok(j.now?.label && j.next?.label);

    delete process.env.RADIO_GRID_ENABLED;
    const off = await (await fetch(`${base}/api/radio/now.json`)).json();
    assert.equal(off.now, null);
  } finally {
    srv.close();
    for (const k of ["RADIO_ENABLED", "RADIO_GRID_ENABLED", "RADIO_PUBLIC_WATCH_URL"]) {
      if (k in saved) process.env[k] = saved[k]; else delete process.env[k];
    }
  }
});
