/**
 * officialFeeds217.test.js - #217: more official feeds, the monetisation guard, the Mac-check guard.
 * No network. Whether each feed actually resolves and plays is the `cli.js check` run on the Mac.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFICIAL_FEEDS, NEVER_AIR_HOSTS, entryForUrl, assertCanAir, feedById, streamMonetised, awaitingMacCheck, creditFor,
} from "./officialFeeds.js";
import { createLiveDesk } from "./liveDesk.js";
import { createLiveLog } from "./liveLog.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PASS = { ok: true, reason: "live, public, plays without a login", mediaUrl: "https://media.example/x.m3u8", httpHeaders: {} };
const OFF = {};                                   // RADIO_STREAM_MONETISED unset
const ON = { RADIO_STREAM_MONETISED: "1" };
const NEW_IDS = ["federal-reserve", "cdc", "us-dod-dvids", "eu-commission", "eu-parliament", "nato", "esa"];

// The same allow-list with every #217 entry's Mac check recorded, to test the rest of the gate.
const CHECKED = OFFICIAL_FEEDS.map((f) => (NEW_IDS.includes(f.id) ? { ...f, macCheck: { passedAt: "2026-10-24T00:00:00Z", url: "x", by: "test" } } : f));
const air = (entryId, url, { probe = PASS, env = OFF, feeds = CHECKED } = {}) => assertCanAir({ entryId, url, probe }, { feeds, env });

test("#217 entries: licence quote with URL, credit, the DrJ decision, and not yet Mac-checked", () => {
  for (const id of NEW_IDS) {
    const f = feedById(id);
    assert.ok(f, id);
    assert.equal(f.addedBy, "DrJ, #217 decision, 23 Oct 2026");
    assert.match(f.licence?.url || "", /^https:\/\//, `${id} licence url`);
    assert.ok((f.licence?.quote || "").length > 40, `${id} licence quote`);
    assert.ok(f.credit, `${id} credit`);
    assert.equal(typeof f.nonCommercialOnly, "boolean", `${id} nonCommercialOnly is explicit`);
    assert.equal(f.macCheck, null, `${id}: macCheck stays null until cli.js check has passed on the Mac`);
    assert.ok((f.youtube || []).length + (f.pages || []).length > 0, `${id} has a feed`);
    for (const p of f.pages || []) assert.ok(p.includes("/") && !p.endsWith(".gov/") && !/^[^/]+\/$/.test(p), `${id}: page "${p}" is narrower than a whole domain`);
  }
});

test("each #217 entry matches its own feed URL", () => {
  const ok = [
    ["federal-reserve", "https://www.federalreserve.gov/live-broadcast.htm"],
    ["federal-reserve", "https://www.youtube.com/@federalreserve/live"],
    ["cdc", "https://www.youtube.com/@CDC/live"],
    ["us-dod-dvids", "https://www.dvidshub.net/webcast/36071"],
    ["eu-commission", "https://audiovisual.ec.europa.eu/en/ebs/live/1"],
    ["eu-commission", "https://audiovisual.ec.europa.eu/en/ebs/live/2"],
    ["eu-parliament", "https://multimedia.europarl.europa.eu/en/webstreaming"],
    ["eu-parliament", "https://www.youtube.com/@europeanparliament/live"],
    ["nato", "https://www.youtube.com/@NATO/live"],
    ["esa", "https://www.youtube.com/@EuropeanSpaceAgency/live"],
  ];
  for (const [id, url] of ok) {
    assert.equal(entryForUrl(url)?.id, id, url);
    assert.equal(air(id, url, { probe: { ...PASS, extractor: "Generic" } }).id, id, url);
  }
});

test("... and nothing wider", () => {
  const wider = [
    "https://www.federalreserve.gov/",                          // whole site
    "https://www.federalreserve.gov/newsevents/pressreleases.htm",
    "https://www.federalreserve.gov/live-broadcast.html",       // look-alike path
    "https://www.youtube.com/@federalreserveXYZ/live",          // look-alike handle
    "https://www.cdc.gov/",                                     // CDC: YouTube channel only
    "https://www.youtube.com/@CDCgov/live",
    "https://www.dvidshub.net/",
    "https://www.dvidshub.net/video/123456",                    // DVIDS: webcasts only
    "https://www.dvidshub.net/webcasts",                        // segment boundary
    "https://dvidshub.net.evil.example/webcast/1",
    "https://audiovisual.ec.europa.eu/en/video/I-123",          // EC: EbS live players only
    "https://audiovisual.ec.europa.eu/en/ebs/1/",               // the schedule, not the player
    "https://ec.europa.eu/commission/presscorner/",
    "https://multimedia.europarl.europa.eu/en/video/x",         // EP: webstreaming only
    "https://multimedia.europarl.europa.eu/en/webstreamingfoo",
    "https://www.europarl.europa.eu/",
    "https://www.nato.int/",                                    // NATO: YouTube channel only
    "https://www.youtube.com/@NATOxyz/live",
    "https://www.esa.int/",                                     // ESA: YouTube channel only
    "https://watch.esa.int/Two/",
    "http://www.youtube.com/@NATO/live",                        // not https
  ];
  for (const url of wider) assert.equal(entryForUrl(url, { feeds: CHECKED }), null, url);
});

test("a #217 page that embeds a stream from another channel is refused", () => {
  assert.throws(() => air("eu-commission", "https://audiovisual.ec.europa.eu/en/ebs/live/1", { probe: { ...PASS, uploaderHandle: "@euronews" } }), /not on "eu-commission"/);
  assert.throws(() => air("federal-reserve", "https://www.federalreserve.gov/live-broadcast.htm", { probe: { ...PASS, extractor: "Youtube", uploaderHandle: null } }), /could not be confirmed/);
  assert.equal(air("federal-reserve", "https://www.federalreserve.gov/live-broadcast.htm", { probe: { ...PASS, uploaderHandle: "@federalreserve" } }).id, "federal-reserve");
  assert.throws(() => air("nato", "https://www.youtube.com/@NATO/live", { probe: { ...PASS, uploaderHandle: "@CNN" } }), /refused/);
});

test("an entry whose Mac check has not run cannot go to air", () => {
  for (const id of NEW_IDS) {
    const f = feedById(id);
    const url = f.youtube?.length ? `https://www.youtube.com/${f.youtube[0]}/live` : `https://www.${f.pages[0].replace(/\/$/, "/1")}`;
    assert.equal(awaitingMacCheck(f), true, id);
    assert.throws(() => assertCanAir({ entryId: id, url, probe: PASS }, { env: OFF }), /not passed its cli\.js check on the Mac/, id);
    // the Mac check itself (cli.js check) skips only this guard
    assert.equal(assertCanAir({ entryId: id, url, probe: { ...PASS, extractor: "Generic" } }, { env: OFF, ignoreMacCheck: true }).id, id);
  }
  // #202 entries have no macCheck key and are unaffected
  assert.equal(awaitingMacCheck(feedById("nasa")), false);
  assert.equal(assertCanAir({ entryId: "nasa", url: "https://www.youtube.com/@NASA/live", probe: PASS }, { env: OFF }).id, "nasa");
});

test("RADIO_STREAM_MONETISED on refuses every nonCommercialOnly entry; off allows them", () => {
  const nc = CHECKED.filter((f) => f.nonCommercialOnly).map((f) => f.id).sort();
  assert.deepEqual(nc, ["esa", "eu-commission", "nato", "us-dod-dvids"]);
  for (const id of nc) {
    const f = feedById(id, CHECKED);
    const url = f.youtube?.length ? `https://www.youtube.com/${f.youtube[0]}/live` : `https://www.${f.pages[0].replace(/\/$/, "/1")}`;
    assert.equal(air(id, url, { env: OFF, probe: { ...PASS, extractor: "Generic" } }).id, id);
    assert.throws(() => air(id, url, { env: ON }), /non-commercial use only and RADIO_STREAM_MONETISED is on/, id);
    // refused even with an ignored Mac check
    assert.throws(() => assertCanAir({ entryId: id, url, probe: PASS }, { feeds: CHECKED, env: ON, ignoreMacCheck: true }), /RADIO_STREAM_MONETISED/);
  }
  // commercial-use-allowed entries are unaffected by the flag
  assert.equal(air("federal-reserve", "https://www.youtube.com/@federalreserve/live", { env: ON }).id, "federal-reserve");
  assert.equal(air("nasa", "https://www.youtube.com/@NASA/live", { env: ON }).id, "nasa");
});

test("RADIO_STREAM_MONETISED fails closed: only unset/0/false/no/off mean not monetised", () => {
  for (const v of [undefined, "", "0", "false", "FALSE", "no", "off", " 0 "]) assert.equal(streamMonetised({ RADIO_STREAM_MONETISED: v }), false, String(v));
  for (const v of ["1", "true", "yes", "on", "monetised", "2"]) assert.equal(streamMonetised({ RADIO_STREAM_MONETISED: v }), true, v);
  assert.equal(streamMonetised({}), false);
});

test("NEVER_AIR_HOSTS is not reduced", () => {
  for (const h of ["cnn.com", "aljazeera.com", "aljazeera.net", "bbc.com", "bbc.co.uk", "foxnews.com", "msnbc.com",
    "nbcnews.com", "cbsnews.com", "abcnews.go.com", "skynews.com", "news.sky.com", "reuters.com", "apnews.com",
    "bloomberg.com", "cnbc.com", "france24.com", "dw.com", "c-span.org"]) assert.ok(NEVER_AIR_HOSTS.includes(h), h);
});

test("the on-screen credit is the licence's credit, with the year filled in", () => {
  const d = new Date("2026-10-23T12:00:00Z");
  assert.equal(creditFor(feedById("esa"), d), "European Space Agency - ESA");
  assert.equal(creditFor(feedById("eu-parliament"), d), "© European Union, 2026 – Source: European Parliament");
  assert.match(creditFor(feedById("us-dod-dvids"), d), /does not imply or constitute DoD endorsement/);
  assert.equal(creditFor(feedById("nasa"), d), "Live feed: NASA");    // #202 entries keep the old credit
});

test("the desk puts the licence credit on screen", async () => {
  const calls = [];
  const unit = { goLive: async (o) => { calls.push(o); }, endLive: async () => {} };
  const ev = { id: "e1", feed: "esa", publisher: "European Space Agency", url: "https://www.youtube.com/@EuropeanSpaceAgency/live", title: "Launch", start: 0, end: 10_000, source: "manual" };
  const log = createLiveLog({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "live217-")) });
  const desk = createLiveDesk({ unit: () => unit, calendar: async () => [ev], probe: async () => PASS, log, now: () => 1000, feeds: CHECKED });
  await desk.tick();
  assert.equal(calls[0].overlay.credit, "European Space Agency - ESA");
  // with the real list (Mac check not recorded) the same event is refused and logged
  const calls2 = [];
  const desk2 = createLiveDesk({ unit: () => ({ goLive: async (o) => calls2.push(o), endLive: async () => {} }), calendar: async () => [ev], probe: async () => PASS, log, now: () => 1000 });
  await desk2.tick();
  assert.equal(calls2.length, 0);
  assert.match(log.readAll().find((r) => r.type === "live-skip")?.reason || "", /cli\.js check on the Mac/);
});
