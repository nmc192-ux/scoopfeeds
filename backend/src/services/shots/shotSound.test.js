import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFileSync } from "child_process";
import { toneFor, pickBed, loadLibrary, measure } from "./shotSound.js";
import { ENGINE_DIR } from "./shotVideo.js";

test("tone: grief wins and gets a very low bed — never a driving one", () => {
  const t = toneFor({ title: "Scientists hail breakthrough as flood death toll rises to 40" });
  assert.deepEqual([t.group, t.level, t.why], ["tense", "low", "grief"]);
  assert.equal(toneFor({ title: "Dozens killed in Nepal landslide" }).level, "low");
  assert.equal(toneFor({ title: "Hurricane makes landfall" }).why, "grief");
});

test("tone: conflict and crime are tense; science and recovery hopeful; the rest neutral", () => {
  assert.equal(toneFor({ title: "Troops mass on the border as sanctions bite" }).group, "tense");
  assert.equal(toneFor({ title: "Man arrested over sea cucumber smuggling ring" }).group, "tense");
  assert.equal(toneFor({ title: "Scientists discover new antibiotic in soil" }).group, "hopeful");
  assert.equal(toneFor({ title: "Central bank holds rates steady" }).group, "neutral");
  // Ordinary political vocabulary alone does not make a story tense — the summit case.
  assert.equal(toneFor({ title: "Trump welcomes Xi for summit" }, { slides: [{ caption: "Military ties and military talks." }, { caption: "A tariff truce." }] }).group, "neutral");
  assert.equal(toneFor({ title: "Sanctions, tariffs, troops and a nuclear standoff" }).group, "tense", "four weak words do");
  // The spec's captions count too, not only the headline.
  assert.equal(toneFor({ title: "Quarterly figures published" }, { slides: [{ caption: "The fraud was hidden for years." }] }).group, "tense");
});

function library(beds) {
  const dir = mkdtempSync(join(tmpdir(), "beds-"));
  for (const b of beds) if (b.file) writeFileSync(join(dir, b.file), "x");   // a bed with no file is the "missing on disk" case
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ beds }));
  return dir;
}

test("only APPROVED, vocal-free beds that exist on disk are ever used", () => {
  const dir = library([
    { id: "n1", group: "neutral", file: "n1.mp3", approved: true, vocalFree: true },
    { id: "n2", group: "neutral", file: "n2.mp3", approved: false, vocalFree: true },
    { id: "n3", group: "neutral", file: "n3.mp3", approved: true, vocalFree: false },
    { id: "n4", group: "neutral", file: null, approved: true, vocalFree: true },
  ]);
  assert.deepEqual(loadLibrary(dir).map((b) => b.id), ["n1"]);
});

test("rotation is least-recently-used within the group; an empty group returns null (synth fallback)", () => {
  const dir = library(["t1", "t2", "t3"].map((id) => ({ id, group: "tense", file: `${id}.mp3`, approved: true, vocalFree: true })));
  const seen = [pickBed("tense", { dir, now: 1 }).id, pickBed("tense", { dir, now: 2 }).id, pickBed("tense", { dir, now: 3 }).id, pickBed("tense", { dir, now: 4 }).id];
  assert.deepEqual(seen, ["t1", "t2", "t3", "t1"]);
  assert.equal(pickBed("hopeful", { dir }), null);
});

// The mixer itself, when a Python with numpy is present (the image has one; a
// bare dev machine may not — then this measures nothing and says so).
const PY = process.env.SHOT_ENGINE_PYTHON || "python3";
const hasNumpy = (() => { try { execFileSync(PY, ["-c", "import numpy"], { stdio: "ignore" }); return true; } catch { return false; } })();

test("mix.py lands on -14 LUFS with true peak at or under -2 before encode", { skip: hasNumpy ? false : `no numpy for ${PY}` }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "mix-"));
  const nar = join(dir, "n.wav"), bed = join(dir, "b.wav"), out = join(dir, "m.wav");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=220:d=6,volume=0.3", "-f", "lavfi", "-i", "anoisesrc=d=6:a=0.05",
    "-filter_complex", "[0][1]amix=inputs=2", "-ar", "48000", "-ac", "2", nar]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=110:d=3,volume=0.2", "-ar", "48000", "-ac", "2", bed]);
  writeFileSync(join(dir, "mix.json"), JSON.stringify({ narration: nar, bed, bed_level: "normal", total: 8,
    cuts: [{ t: 0, kind: "photo" }, { t: 2.5, kind: "clip" }, { t: 5, kind: "punch" }], out }));
  execFileSync(PY, [join(ENGINE_DIR, "mix.py"), join(dir, "mix.json")], { cwd: ENGINE_DIR });
  assert.ok(existsSync(out));
  const m = await measure(out);
  assert.ok(Math.abs(m.I + 14) <= 1, `integrated ${m.I} LUFS`);
  assert.ok(m.TP <= -1.9, `true peak ${m.TP} dBTP`);
});

// ─── The spec writer's tone (DrJ, 25 Sep 2026) ──────────────────────────────
import { keywordTone } from "./shotSound.js";

test("the spec's tone is primary when the keywords have no grief", () => {
  const t = toneFor({ title: "Central bank holds rates steady" }, { tone: "tense", slides: [] });
  assert.deepEqual([t.group, t.level, t.why, t.source], ["tense", "normal", "tense", "spec"]);
  assert.equal(toneFor({ title: "Troops mass on the border" }, { tone: "neutral", slides: [] }).why, "neutral",
    "the model may read a keyword-tense story as neutral — its call, and the disagreement is logged");
});

test("GRIEF FROM THE KEYWORDS ALWAYS WINS — never a driving or hopeful bed on a death story", () => {
  for (const said of ["hopeful", "neutral", "tense"]) {
    const t = toneFor({ title: "Rescuers find survivors as quake death toll climbs" }, { tone: said, slides: [] });
    assert.equal(t.why, "grief", said);
    assert.equal(t.level, "low");
    assert.equal(t.source, "keywords (grief override)");
  }
  assert.equal(toneFor({ title: "Markets open" }, { tone: "grief", slides: [] }).level, "low", "the spec saying grief is respected too");
});

test("no or unknown spec tone falls back to the keyword rules", () => {
  assert.equal(toneFor({ title: "Scientists discover a new antibiotic" }, { slides: [] }).source, "keywords");
  assert.equal(toneFor({ title: "Scientists discover a new antibiotic" }, { tone: "cheerful", slides: [] }).why, "hopeful");
  assert.equal(keywordTone({ title: "Dozens killed in flooding" }), "grief");
});
