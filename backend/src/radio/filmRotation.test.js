import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadLibrary } from "./filmLibrary.js";
import { planDay, defaultSlots, easternInstant, MIN_GAP_MS } from "./filmRotation.js";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const DAY = 86_400_000;

function film(series, n, ageDays, durationSec = 480, kind = "film") {
  return {
    id: `${series}/${n}`, series, seriesName: series, title: `${series} ${n}`, durationSec,
    publishedAt: NOW - ageDays * DAY, file: `/x/${series}/${n}.mp4`, kind,
  };
}

test("library: reads sidecars, reports unusable files instead of guessing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "films-"));
  fs.mkdirSync(path.join(dir, "a-eye"));
  fs.writeFileSync(path.join(dir, "a-eye", "e1.mp4"), "");
  fs.writeFileSync(path.join(dir, "a-eye", "e1.json"), JSON.stringify({ title: "One", publishedAt: "2026-10-01", durationSec: 500 }));
  fs.writeFileSync(path.join(dir, "a-eye", "e2.mp4"), "");
  fs.writeFileSync(path.join(dir, "a-eye", "e3.mp4"), "");
  fs.writeFileSync(path.join(dir, "a-eye", "e3.json"), JSON.stringify({ title: "Three", publishedAt: "2026-10-02" }));
  const { items, skipped } = loadLibrary(dir);
  assert.equal(items.length, 1);
  assert.equal(items[0].seriesName, "A-Eye");
  assert.equal(skipped.length, 2);
  assert.deepEqual(loadLibrary(path.join(dir, "missing")), { items: [], skipped: [] });
});

test("easternInstant handles EDT and EST", () => {
  assert.equal(easternInstant("2026-10-23", 20).toISOString(), "2026-10-24T00:00:00.000Z");
  assert.equal(easternInstant("2026-12-01", 20).toISOString(), "2026-12-02T01:00:00.000Z");
});

test("day plan: prime slots take new episodes, no film repeats within 6h", () => {
  const items = [
    film("a-eye", 5, 2), film("the-record", 9, 3), film("people", 1, 40), film("people", 2, 60),
    film("scoopfeeds-60", 1, 1, 30, "short"), film("scoopfeeds-60", 2, 1, 40, "short"),
  ];
  const slots = defaultSlots("2026-10-23");
  const { plan, empty } = planDay({ items }, { slots, now: NOW });
  const films = plan.filter((p) => p.type === "film");
  assert.equal(films.length + empty.length, 4);
  for (const p of films.filter((f) => f.prime)) assert.match(p.id, /^(a-eye|the-record)\//);
  for (let i = 0; i < films.length; i++) for (let j = i + 1; j < films.length; j++) {
    if (films[i].id === films[j].id) assert.ok(films[j].at - films[i].at >= MIN_GAP_MS);
  }
  assert.ok(plan.some((p) => p.type === "short"));
  assert.ok(plan.some((p) => p.type === "promo" && /^New from /.test(p.text)));
});

test("a slot with only repeats stays empty and is reported", () => {
  const { plan, empty } = planDay({ items: [film("people", 1, 40)] }, { slots: defaultSlots("2026-10-23"), now: NOW });
  assert.equal(plan.filter((p) => p.type === "film").length, 2); // 08:00 and 21:00 ET are >= 6h from each other's airing
  assert.equal(empty.length, 2);
});

test("yesterday's airings seed the gap", () => {
  const slots = defaultSlots("2026-10-23");
  const { plan } = planDay({ items: [film("people", 1, 40)] }, { slots, now: NOW, recent: [{ id: "people/1", at: slots[0].at.getTime() - 3600_000 }] });
  assert.ok(plan.filter((p) => p.type === "film").every((p) => p.at - (slots[0].at.getTime() - 3600_000) >= MIN_GAP_MS));
});
