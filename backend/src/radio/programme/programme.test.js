import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClock, checkClock, wordBudget, FEATURE_MAX } from "./clock.js";
import { checkSegments, dropBackstage, backed } from "./checks.js";
import { layoutSlot } from "./assemble.js";
import { extractJson, buildPrompt } from "./writer.js";
import { sameStory, keyTerms, clusterStories } from "./factPack.js";
import { buildFeederArgs, buildFfmpegArgs, outputQuality } from "../playout/ffmpegArgs.js";
import { avDelayMs } from "../playout/playout.js";

const H = Date.UTC(2026, 9, 13, 16, 0, 0);   // 9 pm PKT

test("clock: contiguous from -15:00 to 60:30, ping slot straddles the hour", () => {
  const c = buildClock(H);
  assert.deepEqual(checkClock(c), []);
  const top = c.find((s) => s.id === "ident-top");
  assert.equal(top.start, H - 4000);   // signal-top.wav pings 4.0 s in: on 9:00:00
  assert.equal(c.find((s) => s.id === "ident-half").end, H + 1800 * 1000);
});

test("clock: a feature takes the second-half music and keeps the hour contiguous", () => {
  const c = buildClock(H, { featureSec: 756, featureTitle: "A-Eye #003" });
  assert.deepEqual(checkClock(c), []);
  const f = c.find((s) => s.kind === "feature");
  assert.equal(f.startSec, 2250); assert.equal(f.lenSec, 756); assert.equal(f.title, "A-Eye #003");
  assert.ok(c.find((s) => s.id === "compared-2"));
  assert.ok(!c.find((s) => s.id === "music-3"));
  // too long a feature is refused, not squeezed
  assert.throws(() => buildClock(H, { featureSec: FEATURE_MAX + 1 }));
  // a long one drops Compared #2 for music
  const long = buildClock(H, { featureSec: FEATURE_MAX - 60 });
  assert.deepEqual(checkClock(long), []);
  assert.ok(!long.find((s) => s.id === "compared-2"));
});

test("wordBudget sizes a 6-minute segment to ~840 words", () => {
  const hour = buildClock(H).find((s) => s.id === "the-hour");
  assert.ok(wordBudget(hour) > 800 && wordBudget(hour) < 860);
});

const pack = {
  top: [{ id: "t1", headline: "Albertsons seeks more than $9 billion over the collapsed Kroger deal", count: 2,
    outlets: [{ source: "Bloomberg Markets", title: "Albertsons Seeks More Than $9 Billion Over Busted Kroger Deal", description: "The deal would have been the largest US grocery merger." },
      { source: "Reuters", title: "Albertsons sues Kroger", description: "" }] }],
  desks: {}, markets: [{ key: "S&P 500", group: "US", price: 7802.97, pct: -0.11 }], weather: [{ city: "Karachi", c: 29, f: 84 }],
};
const slots = [{ id: "the-hour", segment: "the-hour" }, { id: "markets-1", segment: "markets" }];

test("checks: our own 'in Karachi' station line is not a Pakistan story", () => {
  const { report } = checkSegments({ "the-hour": { lines: [{ id: "open", text: "It's noon in New York, nine in the evening in Karachi. This is ScoopFeeds Radio." }] } }, slots.slice(0, 1), pack);
  assert.deepEqual(report, []);
});

test("checks: Pakistan politics is dropped", () => {
  const { report } = checkSegments({ "the-hour": { lines: [{ id: "x", text: "Imran Khan's party called a rally in Lahore." }] } }, slots.slice(0, 1), pack);
  assert.match(report[0].drop, /^rule0/);
});

test("checks: figures must be in the pack; index names and clock times are not figures", () => {
  const ok = checkSegments({ "markets-1": { lines: [{ id: "m1", text: "As of 11:30 AM, the S&P 500 is at 7,803, down 0.1%." }] } }, slots.slice(1), pack);
  assert.deepEqual(ok.report, []);
  assert.match(ok.segments["markets-1"].lines[0].text, /0\.1 percent/);
  const bad = checkSegments({ "the-hour": { lines: [{ id: "s1", story: "t1", text: "Albertsons wants $12 billion." }] } }, slots.slice(0, 1), pack);
  assert.match(bad.report[0].drop, /unbacked figure/);
  const counts = checkSegments({ "the-hour": { lines: [{ id: "s1", story: "t1", text: "Two outlets cover it; Albertsons wants more than $9 billion." }] } }, slots.slice(0, 1), pack);
  assert.deepEqual(counts.report, []);   // "two" is a count; $9 billion is in the pack
  assert.equal(backed(7803, [7802.97]), true);
});

test("checks: outlets and quotes must come from the pack", () => {
  const s = { "the-hour": { lines: [
    { id: "a", story: "t1", outlet: "CNN", text: "CNN says so." },
    { id: "b", story: "t1", text: "Bloomberg calls it a \"busted Kroger deal\"." },
    { id: "c", story: "t1", text: "It says \"a total disaster\"." },
    { id: "d", story: "t9", text: "Something." },
  ] } };
  const r = checkSegments(s, slots.slice(0, 1), pack).report.map((x) => x.line);
  assert.deepEqual(r.sort(), ["a", "c", "d"]);
});

test("checks: sentences about our own sourcing never reach air", () => {
  assert.equal(dropBackstage("Bloomberg reports X. Only Bloomberg has this story in our pack."), "Bloomberg reports X.");
  assert.equal(dropBackstage("On what is left out: in the text we have, only France 24 says it."), "On what is left out: only France 24 says it.");
});

test("layout: lines that overrun are dropped from the end, the close line is kept", () => {
  const slot = { startSec: 0, endSec: 60, sting: false };
  const lines = [{ id: "open", secs: 5 }, { id: "s1", story: "t1", secs: 20 }, { id: "s2", story: "t1", secs: 20 }, { id: "s3", story: "t1", secs: 20 }, { id: "close", secs: 3 }];
  const { placed, dropped } = layoutSlot(slot, lines);
  assert.equal(dropped, 1);
  assert.equal(placed.at(-1).id, "close");
  assert.ok(placed.at(-1).endSec <= 59);
  assert.equal(placed[0].atSec, 1.0);
});

test("writer: JSON is extracted from a fenced reply; the prompt carries every slot", () => {
  assert.deepEqual(extractJson('Here:\n```json\n{"segments": {"a": {"lines": [{"text": "x } y"}]}}}\n```'), { segments: { a: { lines: [{ text: "x } y" }] } } });
  const p = buildPrompt(pack, buildClock(H).filter((s) => s.kind === "spoken"), { hourLabel: "noon in New York", cityTimes: "nine in the evening in Karachi", marketsAsOf: {} });
  for (const id of ["the-hour", "markets-1", "compared-1", "desk-me", "half", "weather", "signoff"]) assert.ok(p.includes(`"${id}"`), id);
  assert.ok(p.includes("[t1] Albertsons"));
});

test("fact pack: stories group by distinctive names, not common words", () => {
  assert.deepEqual(keyTerms("Federal agents search the home of Trump critic Ilhan Omar"), ["trump", "ilhan", "omar"]);
  assert.ok(sameStory({ title: "US agents raid home of Trump critic Ilhan Omar", description: "" }, "Federal agents search the home of Trump critic Ilhan Omar"));
  assert.ok(!sameStory({ title: "Trump signs a trade order", description: "" }, "Federal agents search the home of Trump critic Ilhan Omar"));
  const c = clusterStories([{ source: "A", title: "Meta releases Muse Wonder model" }, { source: "B", title: "Meta's Muse Wonder reaches the frontier" }, { source: "C", title: "Oil rises" }]);
  assert.equal(c[0].outlets, 2);
});

test("playout: programme audio is read once from a position, the bed is looped", () => {
  const part = buildFeederArgs({ bed: "/p/part.wav", bedLufs: -16, ssSec: 12.3456 });
  assert.ok(!part.includes("-stream_loop"));
  assert.equal(part[part.indexOf("-ss") + 1], "12.346");
  assert.ok(buildFeederArgs({ bed: "/b.mp3", bedLufs: -20 }).includes("-stream_loop"));
  assert.equal(avDelayMs({}), 300);
  assert.equal(avDelayMs({ RADIO_PROGRAMME_AV_DELAY_MS: "900" }), 900);
  assert.equal(avDelayMs({ RADIO_PROGRAMME_AV_DELAY_MS: "-5" }), 300);
});

test("playout: RADIO_PLAYOUT_QUALITY=720p drops to 1280x720 at 2.5 Mbps", () => {
  assert.deepEqual(outputQuality({ RADIO_PLAYOUT_QUALITY: "720p" }), { width: 1280, height: 720, bitrateK: 2500 });
  assert.equal(outputQuality({}).bitrateK, 4500);
  const prev = process.env.RADIO_PLAYOUT_QUALITY; process.env.RADIO_PLAYOUT_QUALITY = "720p";
  const a = buildFfmpegArgs({ target: { kind: "rtmp", url: "rtmp://127.0.0.1/x" }, bed: "b", bedLufs: -16, audioPipe: true }).join(" ");
  if (prev === undefined) delete process.env.RADIO_PLAYOUT_QUALITY; else process.env.RADIO_PLAYOUT_QUALITY = prev;
  assert.match(a, /scale=1280:720/); assert.match(a, /-b:v 2500k/);
});
