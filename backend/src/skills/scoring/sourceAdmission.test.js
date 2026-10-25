import { test } from "node:test";
import assert from "node:assert/strict";
import {
  admissionVerdict, probeVerdict, floorFromScores, percentile25, sourceQualityFloor, looksEnglish,
  DEFAULT_SOURCE_QUALITY_FLOOR, MIN_SCORES_FOR_PERCENTILE,
} from "./sourceAdmission.js";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const enItems = (n, ageH = 2) => Array.from({ length: n }, (_, i) => ({
  title: `The minister says the plan for new homes will be ready after the vote ${i}`,
  contentSnippet: "It is the first time that the government has set out a date for the work, and the opposition says it will fight it.",
  isoDate: new Date(NOW - (ageH + i) * 3600e3).toISOString(),
}));
const cand = { name: "X", url: "https://www.example.org/feed" };
const full = { ET: 0.8, MT: 0.5, DE: 0.4, Ind: 0.3, HA: 0.1 };

test("admission: a scored source above the floor is admitted", () => {
  assert.equal(admissionVerdict({ status: "scored", quality_score: 72, coverage: full }, { floor: 60 }).admit, true);
});

test("admission: below the floor is refused", () => {
  const v = admissionVerdict({ status: "scored", quality_score: 59, coverage: full }, { floor: 60 });
  assert.equal(v.admit, false);
  assert.match(v.reason, /below floor 60/);
});

test("admission: unscored, insufficient data or missing coverage is refused (unmeasured is not a pass)", () => {
  assert.equal(admissionVerdict(null).admit, false);
  assert.equal(admissionVerdict({ status: "insufficient-data", quality_score: null, coverage: full }).admit, false);
  assert.equal(admissionVerdict({ status: "scored", quality_score: null, coverage: full }).admit, false);
  const thin = admissionVerdict({ status: "scored", quality_score: 90, coverage: { ET: 1, MT: 0.2, DE: 0.1 } }, { floor: 60 });
  assert.equal(thin.admit, false);
  assert.match(thin.reason, /coverage/);
});

test("floor: SOURCE_QUALITY_FLOOR env, default 60, bad values fall back", () => {
  assert.equal(sourceQualityFloor({}), DEFAULT_SOURCE_QUALITY_FLOOR);
  assert.equal(sourceQualityFloor({ SOURCE_QUALITY_FLOOR: "65" }), 65);
  assert.equal(sourceQualityFloor({ SOURCE_QUALITY_FLOOR: "abc" }), 60);
  assert.equal(sourceQualityFloor({ SOURCE_QUALITY_FLOOR: "140" }), 60);
});

test("floor: the 25th percentile replaces 60 only when it is higher and enough scores were measured", () => {
  assert.equal(percentile25([10, 20, 30, 40]), 10);
  const high = Array.from({ length: MIN_SCORES_FOR_PERCENTILE }, (_, i) => 66 + i);
  assert.equal(floorFromScores(high).floor, 70);   // nearest-rank p25 of 66..85
  const low = Array.from({ length: MIN_SCORES_FOR_PERCENTILE }, (_, i) => 40 + i);
  assert.equal(floorFromScores(low).floor, 60);
  const few = floorFromScores([90, 91, null, undefined]);
  assert.equal(few.floor, 60);
  assert.match(few.reason, /only 2/);
});

test("probe: a fresh English feed with enough items passes", () => {
  const v = probeVerdict({ candidate: cand, feed: { items: enItems(6) }, now: NOW });
  assert.equal(v.ok, true, v.reason);
});

test("probe: each failure is named", () => {
  assert.match(probeVerdict({ candidate: cand, feed: null, error: "Status code 404", now: NOW }).reason, /404/);
  assert.match(probeVerdict({ candidate: cand, feed: { items: enItems(4) }, now: NOW }).reason, /only 4/);
  assert.match(probeVerdict({ candidate: cand, feed: { items: enItems(6, 80) }, now: NOW }).reason, /h old/);
  assert.match(probeVerdict({ candidate: cand, feed: { items: enItems(6).map(({ isoDate, ...r }) => r) }, now: NOW }).reason, /unmeasured/);
  assert.match(probeVerdict({ candidate: cand, feed: { items: enItems(6) }, now: NOW, existingHosts: new Set(["example.org"]) }).reason, /already listed/);
  assert.match(probeVerdict({ candidate: { name: "bad", url: "nope" }, feed: { items: enItems(6) }, now: NOW }).reason, /bad url/);
});

test("probe: a non-English feed fails the English check", () => {
  const de = enItems(6).map((i) => ({ ...i, title: "Die Regierung plant neue Wohnungen nach der Wahl im Herbst", contentSnippet: "Es ist das erste Mal, dass die Regierung ein Datum für die Arbeiten nennt und die Opposition kündigt Widerstand an." }));
  assert.equal(looksEnglish(de), false);
  assert.match(probeVerdict({ candidate: cand, feed: { items: de }, now: NOW }).reason, /not English/);
  const ur = enItems(6).map((i) => ({ ...i, title: "حکومت نے نئے گھروں کا منصوبہ پیش کر دیا", contentSnippet: "یہ پہلا موقع ہے کہ حکومت نے کام کے لیے تاریخ مقرر کی ہے اور اپوزیشن نے مخالفت کا اعلان کیا" }));
  assert.equal(looksEnglish(ur), false);
});
