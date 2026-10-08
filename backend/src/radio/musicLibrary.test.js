/**
 * musicLibrary.test.js — pickBed dayparts by US Eastern time, across both DST changes
 * (2026: EDT starts Sun 8 Mar, ends Sun 1 Nov), and never the same file twice in a row.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { daypartAt, pickBed, listBeds } from "./musicLibrary.js";

const at = (iso) => new Date(iso);

const CASES = [
  // EDT (UTC−4): 09:30 ET = 13:30Z
  ["2026-10-31T13:29:00Z", "morning"], ["2026-10-31T13:30:00Z", "markets"],
  ["2026-10-31T19:59:00Z", "markets"], ["2026-10-31T20:00:00Z", "evening"],
  ["2026-10-31T03:59:00Z", "evening"], ["2026-10-31T04:00:00Z", "overnight"],
  ["2026-10-31T08:59:00Z", "overnight"], ["2026-10-31T09:00:00Z", "morning"],
  // Fall-back day, Sun 1 Nov: clocks go 02:00 EDT → 01:00 EST at 06:00Z; 05:00 EST = 10:00Z
  ["2026-11-01T09:59:00Z", "overnight"], ["2026-11-01T10:00:00Z", "morning"],
  // EST (UTC−5): 09:30 ET = 14:30Z
  ["2026-11-02T14:29:00Z", "morning"], ["2026-11-02T14:30:00Z", "markets"],
  ["2026-11-02T20:59:00Z", "markets"], ["2026-11-02T21:00:00Z", "evening"],
  ["2026-11-02T04:59:00Z", "evening"], ["2026-11-02T05:00:00Z", "overnight"],
  // Spring-forward: Sat 7 Mar is EST, Mon 9 Mar is EDT
  ["2026-03-07T14:29:00Z", "morning"], ["2026-03-07T14:30:00Z", "markets"],
  ["2026-03-09T13:29:00Z", "morning"], ["2026-03-09T13:30:00Z", "markets"],
  // Spring-forward day, Sun 8 Mar: 02:00 EST → 03:00 EDT at 07:00Z; 05:00 EDT = 09:00Z
  ["2026-03-08T08:59:00Z", "overnight"], ["2026-03-08T09:00:00Z", "morning"],
];
for (const [iso, want] of CASES) {
  test(`daypart ${iso} → ${want}`, () => assert.equal(daypartAt(at(iso)), want));
}

function tmpLibrary(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radio-music-"));
  for (const [part, names] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, part), { recursive: true });
    for (const n of names) fs.writeFileSync(path.join(dir, part, n), "x");
  }
  return dir;
}

test("pickBed never returns the same file twice in a row", () => {
  const dir = tmpLibrary({ markets: ["a.mp3", "b.mp3", "c.mp3"] });
  const noon = at("2026-11-02T17:00:00Z");
  let last = null;
  for (let i = 0; i < 200; i++) {
    const p = pickBed(noon, { dir, last });
    assert.notEqual(p, last);
    last = p;
  }
});

test("pickBed prefers the .norm.mp3 and skips its original; empty daypart → null", () => {
  const dir = tmpLibrary({ evening: ["x.wav", "x.norm.mp3", "y.mp3"], morning: [] });
  const beds = listBeds("evening", dir).map((p) => path.basename(p));
  assert.deepEqual(beds, ["x.norm.mp3", "y.mp3"]);
  assert.equal(pickBed(at("2026-11-02T12:00:00Z"), { dir }), null);   // 07:00 EST → morning, empty
});
