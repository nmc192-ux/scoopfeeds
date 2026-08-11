import test from "node:test";
import assert from "node:assert/strict";
import {
  healthKey,
  logKey,
  configuredHealthKeys,
  reconcile,
  classifyProbe,
  differsMeaningfully,
  findCohorts,
  neverWorked,
  wasteEstimate,
  normalizeParserError,
  failureBudget,
} from "./sourceTriage.js";

// Matches how the fetchers actually key their writes — see module header.
test("healthKey and logKey use the two different prefixes the fetchers write", () => {
  assert.equal(healthKey({ name: "ESPN" }, "rss"), "ESPN");
  assert.equal(logKey({ name: "ESPN" }, "rss"), "ESPN");
  assert.equal(healthKey({ name: "ESPN" }, "yt"), "yt:ESPN");
  assert.equal(logKey({ name: "ESPN" }, "yt"), "YouTube:ESPN");
});

test("an RSS source and a YouTube channel of the same name are distinct health rows", () => {
  const keys = configuredHealthKeys([{ name: "ESPN" }], [{ name: "ESPN" }]);
  assert.deepEqual([...keys.keys()], ["ESPN", "yt:ESPN"]);
});

// ── reconcile ───────────────────────────────────────────────────────────────

test("reconcile separates orphan health rows from configured ones", () => {
  const configured = configuredHealthKeys(
    [{ name: "BBC News" }, { name: "Dawn News" }],
    [{ name: "CNN" }],
  );
  const rows = [
    { source_name: "BBC News", consecutive_failures: 0 },
    { source_name: "Dawn News", consecutive_failures: 1431 },
    { source_name: "yt:CNN", consecutive_failures: 0 },
    // config entry deleted 2026-05-15; the row survived the deletion
    { source_name: "Reuters World", consecutive_failures: 1900 },
    { source_name: "Associated Press", consecutive_failures: 1848 },
  ];

  const { active, orphan, unfetched } = reconcile(rows, configured);
  assert.deepEqual(active.map((r) => r.source_name), ["BBC News", "Dawn News", "yt:CNN"]);
  assert.deepEqual(orphan.map((r) => r.source_name), ["Reuters World", "Associated Press"]);
  assert.deepEqual(unfetched, []);
});

test("reconcile reports configured sources that have never been fetched", () => {
  const configured = configuredHealthKeys([{ name: "BBC News" }, { name: "Brand New Feed" }], []);
  const { active, unfetched } = reconcile([{ source_name: "BBC News" }], configured);
  assert.equal(active.length, 1);
  assert.deepEqual(unfetched.map((r) => r.source_name), ["Brand New Feed"]);
});

test("reconcile attaches the config entry so downstream can tell rss from yt", () => {
  const configured = configuredHealthKeys([], [{ name: "CNN", channelId: "UC123" }]);
  const { active } = reconcile([{ source_name: "yt:CNN" }], configured);
  assert.equal(active[0].config.kind, "yt");
  assert.equal(active[0].config.channelId, "UC123");
});

// ── classifyProbe ───────────────────────────────────────────────────────────

const okProbe = (over = {}) => ({ ok: true, status: 200, isFeed: true, itemCount: 20, ...over });

test("a feed that parses with the production UA is healthy", () => {
  const r = classifyProbe({ url: "https://x.test/feed", prod: okProbe({ finalUrl: "https://x.test/feed" }) });
  assert.equal(r.verdict, "healthy");
  assert.equal(r.bucket, "keep");
});

test("succeeding only after a redirect elsewhere is flagged as moved, not healthy", () => {
  const r = classifyProbe({
    url: "https://old.test/rss",
    prod: okProbe({ finalUrl: "https://new.test/feed/atom" }),
  });
  assert.equal(r.verdict, "moved");
  assert.equal(r.bucket, "fix");
});

test("http→https and a trailing slash are not treated as a move", () => {
  assert.equal(differsMeaningfully("https://x.test/feed", "https://x.test/feed/"), false);
  assert.equal(differsMeaningfully("https://www.x.test/feed", "https://x.test/feed"), false);
  assert.equal(differsMeaningfully("https://x.test/feed", "https://x.test/rss"), true);
});

test("403 to our UA but a real feed to a browser UA is UA-gating, a fix not a retirement", () => {
  const r = classifyProbe({
    url: "https://bmj.test/feed",
    prod: { ok: false, status: 403, isFeed: false, itemCount: 0 },
    browser: okProbe(),
  });
  assert.equal(r.verdict, "ua_gated");
  assert.equal(r.bucket, "fix");
});

test("403 to BOTH user agents is a review item, not an automatic retirement", () => {
  const r = classifyProbe({
    url: "https://blocked.test/feed",
    prod: { ok: false, status: 403 },
    browser: { ok: false, status: 403 },
  });
  assert.equal(r.verdict, "forbidden");
  // A datacenter IP can be blocked where the prod host is not — never delete on this alone.
  assert.equal(r.bucket, "review");
});

test("404 to both user agents is a retirement candidate", () => {
  const r = classifyProbe({
    url: "https://mg.test/feed",
    prod: { ok: false, status: 404 },
    browser: { ok: false, status: 404 },
  });
  assert.equal(r.verdict, "not_found");
  assert.equal(r.bucket, "retire");
});

test("a 200 that is not a feed is a wrong URL, not a dead source", () => {
  const r = classifyProbe({
    url: "https://ap.test/apf-topnews",
    prod: { ok: false, status: 200, isFeed: false, itemCount: 0 },
    browser: { ok: false, status: 200, isFeed: false, itemCount: 0 },
  });
  assert.equal(r.verdict, "not_a_feed");
  assert.equal(r.bucket, "fix");
});

test("a 200 feed envelope with zero items does not count as healthy", () => {
  const r = classifyProbe({
    url: "https://empty.test/feed",
    prod: { ok: false, status: 200, isFeed: true, itemCount: 0 },
    browser: { ok: false, status: 200, isFeed: true, itemCount: 0 },
  });
  assert.equal(r.verdict, "not_a_feed");
});

test("NXDOMAIN is the one unambiguous retirement", () => {
  const r = classifyProbe({
    url: "https://feeds.reuters.test/topNews",
    prod: { ok: false, transportKind: "dns" },
    browser: { ok: false, transportKind: "dns" },
  });
  assert.equal(r.verdict, "dns");
  assert.equal(r.bucket, "retire");
});

test("a timeout is a fix (raise the per-source timeout), not a death", () => {
  const r = classifyProbe({
    url: "https://nhk.test/feeds/",
    prod: { ok: false, transportKind: "timeout" },
    browser: { ok: false, transportKind: "timeout" },
  });
  assert.equal(r.verdict, "timeout");
  assert.equal(r.bucket, "fix");
});

// ── normalizeParserError ────────────────────────────────────────────────────
// The literal strings below are the ones observed live on prod 2026-08-10.

test("the exact error strings prod recorded map to the right verdicts", () => {
  // BMJ News, The Block, Daily Nation
  assert.deepEqual(normalizeParserError("Status code 403"), { status: 403, transportKind: null, raw: "Status code 403" });
  // Mail & Guardian
  assert.deepEqual(normalizeParserError("Status code 404"), { status: 404, transportKind: null, raw: "Status code 404" });
  // NHK World
  assert.equal(normalizeParserError("Request timed out after 15000ms").transportKind, "timeout");
});

test("an unresolvable host normalises to dns", () => {
  assert.equal(normalizeParserError("getaddrinfo ENOTFOUND feeds.reuters.com").transportKind, "dns");
  assert.equal(normalizeParserError("connect ECONNREFUSED 10.0.0.1:443").transportKind, "dns");
});

test("an HTML page served where a feed used to be normalises to a 200 non-feed, not unreachable", () => {
  // What apnews.com/apf-topnews did: 200 OK, HTML hub page, no feed.
  const n = normalizeParserError("Non-whitespace before first tag.\nLine: 0\nColumn: 1\nChar: <");
  assert.equal(n.status, 200);
  assert.equal(n.isFeed, false);
  assert.equal(classifyProbe({ url: "u", prod: { ok: false, ...n }, browser: { ok: false, ...n } }).verdict, "not_a_feed");
});

test("a TLS failure is not misread as a dead host", () => {
  assert.equal(normalizeParserError("unable to verify the first certificate").transportKind, "tls");
  assert.equal(classifyProbe({ url: "u", prod: { ok: false, transportKind: "tls" } }).bucket, "review");
});

test("429 and 5xx are review items rather than retirements", () => {
  assert.equal(classifyProbe({ url: "u", prod: { ok: false, status: 429 }, browser: { ok: false, status: 429 } }).verdict, "rate_limited");
  assert.equal(classifyProbe({ url: "u", prod: { ok: false, status: 503 }, browser: { ok: false, status: 503 } }).verdict, "server_error");
});

test("the browser attempt's status wins when the two disagree", () => {
  // Our UA is soft-blocked with a 403, but the resource is genuinely gone.
  const r = classifyProbe({
    url: "https://x.test/feed",
    prod: { ok: false, status: 403 },
    browser: { ok: false, status: 404 },
  });
  assert.equal(r.verdict, "not_found");
});

test("a probe with no browser fallback still classifies", () => {
  const r = classifyProbe({ url: "https://x.test/feed", prod: { ok: false, status: 404 } });
  assert.equal(r.verdict, "not_found");
});

// ── cohorts ─────────────────────────────────────────────────────────────────

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const JUL_01 = Date.parse("2026-07-01T06:00:00Z");
const JUL_01_LATER = Date.parse("2026-07-01T21:00:00Z");
const JUN_10 = Date.parse("2026-06-10T00:00:00Z");

test("sources sharing a last-success day AND failure count group into one cohort", () => {
  const rows = [
    { source_name: "ESPN", last_success: JUL_01, consecutive_failures: 1431 },
    { source_name: "Dawn News", last_success: JUL_01_LATER, consecutive_failures: 1431 },
    { source_name: "Inside Climate News", last_success: JUL_01, consecutive_failures: 1431 },
    { source_name: "Mail & Guardian", last_success: JUN_10, consecutive_failures: 3086 },
  ];
  const cohorts = findCohorts(rows, dayOf);
  assert.equal(cohorts.length, 1);
  assert.equal(cohorts[0].day, "2026-07-01");
  assert.equal(cohorts[0].consecutiveFailures, 1431);
  assert.deepEqual(cohorts[0].members.map((m) => m.source_name).sort(), [
    "Dawn News",
    "ESPN",
    "Inside Climate News",
  ]);
});

test("a lone failure is not a cohort", () => {
  const cohorts = findCohorts([{ source_name: "Mail & Guardian", last_success: JUN_10, consecutive_failures: 3086 }], dayOf);
  assert.deepEqual(cohorts, []);
});

test("same day but different failure counts are not one cohort — they did not fail in lockstep", () => {
  const rows = [
    { source_name: "A", last_success: JUL_01, consecutive_failures: 1431 },
    { source_name: "B", last_success: JUL_01, consecutive_failures: 900 },
  ];
  assert.deepEqual(findCohorts(rows, dayOf), []);
});

test("never-succeeded sources are excluded from cohorts and reported separately", () => {
  const rows = [
    { source_name: "Express Tribune", last_success: null, consecutive_failures: 6971, total_articles: 0 },
    { source_name: "Business Recorder", last_success: null, consecutive_failures: 6969, total_articles: 0 },
    { source_name: "ESPN", last_success: JUL_01, consecutive_failures: 1431, total_articles: 500 },
  ];
  assert.deepEqual(findCohorts(rows, dayOf), []);
  assert.deepEqual(neverWorked(rows).map((r) => r.source_name), ["Express Tribune", "Business Recorder"]);
});

test("a source with articles but no last_success is not counted as never-worked", () => {
  // Defensive: total_articles > 0 means it did work once, whatever the timestamp says.
  const rows = [{ source_name: "Odd", last_success: null, consecutive_failures: 5, total_articles: 383 }];
  assert.deepEqual(neverWorked(rows), []);
});

// ── failureBudget ───────────────────────────────────────────────────────────

const AUG_10 = Date.parse("2026-08-10T12:00:00Z");

test("a source failing every cycle since its last success has no shortfall", () => {
  // 40 days at 48 cycles/day.
  const b = failureBudget(
    { last_success: AUG_10 - 40 * 86400000, consecutive_failures: 1920 },
    { now: AUG_10, cyclesPerDay: 48 },
  );
  assert.equal(b.expected, 1920);
  assert.equal(b.observed, 1920);
  assert.equal(b.shortfall, false);
});

test("a counter well below elapsed cycles is flagged as a scheduler shortfall", () => {
  // The reported prod figure: last success 2026-07-01, 1431 failures by 2026-08-10.
  // 40.1 days x 48 cycles/day = 1925 expected, so ~490 cycles never attempted it.
  const b = failureBudget(
    { last_success: Date.parse("2026-07-01T09:32:00Z"), consecutive_failures: 1431 },
    { now: AUG_10, cyclesPerDay: 48 },
  );
  assert.equal(b.expected, 1925);
  assert.equal(b.observed, 1431);
  assert.equal(b.shortfall, true);
  assert.ok(b.ratio < 0.8, `expected ratio well under 0.8, got ${b.ratio}`);
});

test("small drift does not count as a shortfall", () => {
  const b = failureBudget(
    { last_success: AUG_10 - 10 * 86400000, consecutive_failures: 470 }, // vs 480 expected
    { now: AUG_10, cyclesPerDay: 48 },
  );
  assert.equal(b.shortfall, false);
});

test("failureBudget is undefined for a source that never succeeded", () => {
  assert.equal(failureBudget({ last_success: null, consecutive_failures: 6971 }, { now: AUG_10, cyclesPerDay: 48 }), null);
});

// ── waste ───────────────────────────────────────────────────────────────────

test("waste estimate uses each fetcher's own cadence", () => {
  const active = [
    { consecutive_failures: 6971, config: { kind: "rss" } },
    { consecutive_failures: 1431, config: { kind: "rss" } },
    { consecutive_failures: 4600, config: { kind: "yt" } },
    { consecutive_failures: 0, config: { kind: "rss" } }, // healthy, not waste
  ];
  // "2,32 * * * *" = 48/day for RSS; "9 * * * *" = 24/day for video.
  const w = wasteEstimate(active, { rssCyclesPerDay: 48, ytCyclesPerDay: 24 });
  assert.equal(w.failingRss, 2);
  assert.equal(w.failingYt, 1);
  assert.equal(w.fetchesPerDay, 2 * 48 + 1 * 24);
});
