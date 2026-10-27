// #247 (DrJ, 25 Oct 2026): one temperature unit on air. Every city is read in degrees Celsius; the screens show
// °C first with °F small beside it. The writer is told Celsius only, checkSegments drops a Fahrenheit weather line,
// and airCheck fails the hour if one survives (an unreadable weather line fails too: unmeasured is a failure).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { weatherUnitReason, weatherProblems } from "./weatherUnits.js";
import { checkSegments } from "./checks.js";
import { airCheck } from "./airCheck.js";
import { buildPrompt, packText } from "./writer.js";
import { weatherFocus } from "./assemble.js";
import { WEATHER_CITIES } from "./factPack.js";
import { writeHourAudio } from "../../testing/radioWav.js";

const pack = { top: [], desks: {}, markets: [], weather: [
  { city: "New York", c: 18, f: 64, condition: "partly cloudy" }, { city: "Washington", c: 20, f: 68, condition: "clear sky" },
  { city: "London", c: 13, f: 55, condition: "light rain" }, { city: "Dubai", c: 35, f: 95, condition: "sunny" }, { city: "Tokyo", c: 19, f: 66, condition: "clear" }] };
const slot = { id: "weather", segment: "weather", title: "Weather around the world", lenSec: 90, startSec: 1980, endSec: 2070 };
const run = (...texts) => checkSegments({ weather: { lines: texts.map((text, i) => ({ id: `w${i + 1}`, text })) } }, [slot], pack);

test("weatherUnitReason: every way of saying Fahrenheit is caught; Celsius and ordinary words are not", () => {
  for (const t of ["New York, 64 degrees Fahrenheit.", "New York is 64°F.", "New York, 64 ° F, cloudy.", "New York, 64 degrees F.", "New York, 64F and cloudy.", "fahrenheit"])
    assert.ok(weatherUnitReason(t), t);
  for (const t of ["New York, 18 degrees Celsius, partly cloudy.", "London, 13 degrees Celsius, light rain.", "Dubai, 35°C, sunny.", "Fog in the F-16 hangars at Fairford."])
    assert.equal(weatherUnitReason(t), null, t);
  assert.match(weatherUnitReason(undefined), /unmeasured/);
});

test("checks: a weather line that says Fahrenheit is dropped; the Celsius line airs", () => {
  const r = run("New York, 18 degrees Celsius, partly cloudy.", "Washington, 68 degrees Fahrenheit, clear.", "Dubai is 95°F and sunny.");
  assert.deepEqual(r.segments.weather.lines.map((l) => l.id), ["w1"]);
  assert.deepEqual(r.report.map((x) => x.line), ["w2", "w3"]);
  for (const x of r.report) assert.match(x.drop, /Fahrenheit/);
});

test("checks: a Fahrenheit figure read without the unit is not a backed number any more", () => {
  const r = run("New York, 64 degrees, partly cloudy.", "London, 13 degrees Celsius, light rain.");
  assert.deepEqual(r.segments.weather.lines.map((l) => l.id), ["w2"]);
  assert.match(r.report[0].drop, /unbacked figure.*64/);
});

test("airCheck second lock: a surviving Fahrenheit weather line fails the hour; an unreadable one fails too", () => {
  assert.deepEqual(weatherProblems({ weather: { lines: [{ id: "w1", text: "Tokyo, 19 degrees Celsius, clear." }] } }), []);
  assert.match(weatherProblems({ weather: { lines: [{ id: "w1", text: "Tokyo, 66 degrees Fahrenheit." }] } })[0], /^weather\/w1: .*Fahrenheit/);
  assert.match(weatherProblems({ weather: { lines: [{ id: "w1" }] } })[0], /unmeasured/);
  assert.match(weatherProblems({ weather: {} })[0], /unmeasured/);
  assert.deepEqual(weatherProblems({ "the-hour": { lines: [{ id: "s1", text: "A 451 F story." }] } }), [], "only weather slots");

  const H = Date.UTC(2026, 9, 25, 16);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "air-wx-"));
  const audio = writeHourAudio(d, H, { file: "part-the-hour.wav" });   // a mixed hour the listen-back passes (#273)
  fs.writeFileSync(path.join(d, "programme.json"), JSON.stringify({ hourStart: H, cues: Array(30).fill({}), headlines: [], ...audio }));
  const hour = Array.from({ length: 5 }, (_, i) => ({ id: `s${i + 1}`, story: "t1" }));
  const segs = (wx) => ({ "the-hour": { lines: hour }, weather: { lines: [{ id: "w1", text: wx }] } });
  fs.writeFileSync(path.join(d, "segments.raw.json"), JSON.stringify(segs("x")));
  fs.writeFileSync(path.join(d, "segments.json"), JSON.stringify(segs("Tokyo, 19 degrees Celsius, clear.")));
  assert.equal(airCheck(d, { hourStart: H }).ok, true, airCheck(d, { hourStart: H }).problems.join("; "));
  fs.writeFileSync(path.join(d, "segments.json"), JSON.stringify(segs("Tokyo, 66 degrees Fahrenheit, clear.")));
  const bad = airCheck(d, { hourStart: H });
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join(), /weather\/w1: weather: says Fahrenheit/);
});

test("writer: the weather instruction and the pack text say Celsius only, never Fahrenheit", () => {
  const p = buildPrompt(pack, [slot], { hourLabel: "noon in New York", cityTimes: "nine in the evening in Karachi" });
  const text = typeof p === "string" ? p : JSON.stringify(p);
  assert.match(text, /every temperature in degrees Celsius/);
  assert.doesNotMatch(text, /fahrenheit|°F/i);
  assert.doesNotMatch(packText(pack), /fahrenheit|°F/i);
  assert.match(packText(pack), /New York: 18 degrees Celsius, partly cloudy/);
});

test("the dry-run writer reads Celsius: produce.mjs's mechanical weather line", () => {
  const src = fs.readFileSync(new URL("./produce.mjs", import.meta.url), "utf8");
  assert.match(src, /\$\{w\.city\}, \$\{w\.c\} degrees Celsius, \$\{w\.condition\}\./);
});

test("weatherFocus: one step per line that names a city, in reading order; repeats collapse; unknown lines add nothing", () => {
  const lines = [
    { id: "w1", atSec: 1983, text: "In New York, 18 degrees Celsius and partly cloudy." },
    { id: "w2", atSec: 1990, text: "Washington, D.C., 20 degrees Celsius." },
    { id: "w3", atSec: 1996, text: "And in Washington it stays clear." },
    { id: "w4", atSec: 2001, text: "Across the Atlantic, a wet day." },
    { id: "w5", atSec: 2006, text: "London, 13 degrees Celsius, light rain, warmer than New York." },
    { id: "w6", atSec: 2012, text: "Tokyo, 19 degrees Celsius, clear." },
  ];
  assert.deepEqual(weatherFocus(lines, pack.weather), [
    { atSec: 1983, city: "New York" }, { atSec: 1990, city: "Washington" }, { atSec: 2006, city: "London" }, { atSec: 2012, city: "Tokyo" }]);
  assert.deepEqual(weatherFocus([], pack.weather), []);
});

test("every WEATHER_CITIES city has a place on the programme screen's map", () => {
  const html = fs.readFileSync(new URL("../screen/scoopfeeds-radio-programme.html", import.meta.url), "utf8");
  const geo = html.slice(html.indexOf("const WX_GEO = {"), html.indexOf("};", html.indexOf("const WX_GEO = {")));
  for (const c of WEATHER_CITIES.map((x) => x.replace(" D.C.", ""))) assert.match(geo, new RegExp(`'${c}':\\s*\\{ lon:`), c);
});
