// Phase 0: the Pakistan filter test. Drives the gate CLI exactly as an agent would.
//   node --test sixty/gates/pakistan.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const GATE = path.join(path.dirname(fileURLToPath(import.meta.url)), "pakistan.mjs");
const gate = (...a) => spawnSync(process.execPath, [GATE, ...a], { encoding: "utf8" });
const tmp = () => mkdtempSync(path.join(tmpdir(), "sixty-rule0-"));
const w = (d, f, o) => { mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); writeFileSync(path.join(d, f), typeof o === "string" ? o : JSON.stringify(o)); };

const CLEAN_PICK = { title: "Artemis crew returns after lunar flyby", promise: "In 60 seconds you'll know what the crew saw", category: "science",
  sources: [{ title: "NASA", url: "https://www.nasa.gov/" }] };

test("selection: Pakistan stories are removed before any spend, clean ones kept", () => {
  const d = tmp();
  w(d, "cands.json", [
    { id: "pk1", title: "Bilawal addresses JAAC rally", source_name: "Geo News", category: "pakistan-politics" },
    { id: "pk2", title: "Tensions rise along the Line of Control", source_name: "Reuters" },
    { id: "pk3", title: "Markets react", description: "Imran Khan's party calls protests", source_name: "AP" },
    { id: "pk4", title: "Floods hit the region", content: "Heavy rain in Karachi and Lahore", source_name: "BBC" },
    { id: "pk5", title: "Cricket final tonight", source_name: "Dawn" },
    { id: "ok1", title: "Artemis crew returns after lunar flyby", source_name: "NASA" },
    { id: "ok2", title: "EU fines tech giant over app store rules", source_name: "Reuters" },
  ]);
  const r = gate("selection", path.join(d, "cands.json"));
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(readFileSync(path.join(d, "cands.rule0.json"), "utf8"));
  assert.deepEqual(out.kept.map((c) => c.id).sort(), ["ok1", "ok2"]);
  assert.deepEqual(out.blocked.map((c) => c.id).sort(), ["pk1", "pk2", "pk3", "pk4", "pk5"]);
  // The Geo News fixture must trip several independent signals, so no single list edit un-blocks it.
  assert.ok(out.blocked.find((c) => c.id === "pk1").signals.length >= 3);
});

test("film: a clean film passes", () => {
  const d = tmp();
  w(d, "pick.json", CLEAN_PICK);
  w(d, "script.json", { lines: [{ id: "L1", text: "Four astronauts. Ten days. One lap of the Moon." }] });
  w(d, "register.json", { claims: [{ id: "C1", text: "Ten-day mission", sources: [{ outlet: "NASA", url: "https://www.nasa.gov/" }] }] });
  const r = gate("film", d);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("film: Pakistan content that drifts into the SCRIPT blocks the film", () => {
  const d = tmp();
  w(d, "pick.json", CLEAN_PICK);
  w(d, "script.json", { lines: [{ id: "L1", text: "The capsule was tracked from a station near Karachi." }] });
  assert.equal(gate("film", d).status, 3);
});

test("film: a Pakistani OUTLET in the register's sources blocks the film", () => {
  const d = tmp();
  w(d, "pick.json", CLEAN_PICK);
  w(d, "register.json", { claims: [{ id: "C1", text: "Crew safe", sources: [{ outlet: "Express Tribune", url: "https://example.com/x" }] }] });
  assert.equal(gate("film", d).status, 3);
});

test("film: Pakistan text on screen (the render plan) blocks the film", () => {
  const d = tmp();
  w(d, "pick.json", CLEAN_PICK);
  w(d, "render/../plan.json", { total: 60, shots: [{ kind: "punch", lines: [[0.1, "CPEC", 150, [221, 231, 6]]] }] });
  assert.equal(gate("film", d).status, 3);
});

test("film: Pakistan in the PACKAGE (hashtags) blocks the film", () => {
  const d = tmp();
  w(d, "pick.json", CLEAN_PICK);
  w(d, "package.json", { youtube: { title: "The Moon, up close", hashtags: ["#Space", "#Pakistan"] } });
  assert.equal(gate("film", d).status, 3);
});

test("film: a missing pick is a block, never a pass", () => {
  const d = tmp();
  assert.equal(gate("film", d).status, 3);
});
