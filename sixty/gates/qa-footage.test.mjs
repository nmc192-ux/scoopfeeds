// Regression: the footage rules apply to ANY footage shot (path + cams), not only kind "clip".
// Found on 13 Oct 2026: a film whose footage was a per-film `x-band` shot showed thirdPartyClipSecs 0 in the originality check.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const QA = path.join(path.dirname(new URL(import.meta.url).pathname), "qa.mjs");
function runQa(shots) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "qa-footage-"));
  const media = { id: "M1", url: "https://news.example/clip", source: "Example TV", source_type: "news", credit: "Video: Example TV", licence: "news excerpt, credited",
    upload_date: "2026-10-12", window: "00:10-00:20", verified_how: "uploader and date match the event", third_party: true };
  writeFileSync(path.join(dir, "plan.json"), JSON.stringify({ total: 60, shots }));
  writeFileSync(path.join(dir, "register.json"), JSON.stringify({ claims: [], media: [media] }));
  writeFileSync(path.join(dir, "script.json"), JSON.stringify({ lines: [] }));
  writeFileSync(path.join(dir, "factcheck.json"), JSON.stringify({ lines: [] }));
  spawnSync(process.execPath, [QA, dir], { encoding: "utf8" });                 // no final.mp4: the technical checks fail, which is fine here
  const gate = JSON.parse(readFileSync(path.join(dir, "gate-qa.json"), "utf8"));
  const by = (re) => gate.checks.find((c) => re.test(c.name));
  return { footage: by(/^footage ruling/), originality: by(/^originality/) };
}
const footage = (kind, extra = {}) => ({ kind, t0: 0, T: 9, path: "/m/M1.mp4", cams: [[0, 0.5, 0.5, 1]], logo: "none", media: ["M1"], cred: "Video: Example TV", ...extra });

test("a per-film footage shot (x-band) longer than 6 s from a news source fails the footage ruling, like kind clip", () => {
  for (const kind of ["clip", "x-band"]) {
    const { footage: f } = runQa([footage(kind), { kind: "end", t0: 57.4, T: 2.6, sources: ["x"] }]);
    assert.equal(f.result, "FAIL", kind);
    assert.match(JSON.stringify(f.detail), /excerpt 9s/, kind);
  }
});

test("a news footage shot with a ymax banner crop fails whatever its kind", () => {
  for (const kind of ["clip", "x-band"]) {
    const { footage: f } = runQa([footage(kind, { T: 3, ymax: 0.9 }), { kind: "end", t0: 57.4, T: 2.6, sources: ["x"] }]);
    assert.equal(f.result, "FAIL", kind);
    assert.match(JSON.stringify(f.detail), /cropped \(ymax 0\.9\)/, kind);
  }
});

test("the originality check counts per-film footage shots (it reported 0 s before)", () => {
  const { originality: o } = runQa([footage("x-band", { T: 3 }), footage("x-band", { T: 3, t0: 10 }), { kind: "end", t0: 57.4, T: 2.6, sources: ["x"] }]);
  assert.ok(o, "originality check present");
  assert.notEqual(o.detail?.thirdPartyClipSecs, 0, JSON.stringify(o.detail));
  assert.equal(o.detail?.thirdPartyClipSecs, 6);
  assert.equal(o.detail?.longestClip, 3);
});

test("short footage within the rules passes the footage ruling for both kinds", () => {
  for (const kind of ["clip", "x-band"]) {
    const { footage: f } = runQa([footage(kind, { T: 3 }), { kind: "end", t0: 57.4, T: 2.6, sources: ["x"] }]);
    assert.equal(f.result, "pass", `${kind}: ${JSON.stringify(f.detail)}`);
  }
});
