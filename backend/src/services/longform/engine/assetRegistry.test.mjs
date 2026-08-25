// assetRegistry.test.mjs — the license gate (#82).
//
// Run:  node --test .claude/skills/video-factory/engine/assetRegistry.test.mjs
//
// The load-bearing test is THE LICENSE GATE: an entry with no license, or a
// license outside the allowlist, cannot be registered. Personality photos are
// the most-litigated asset class a news channel touches and a strike arrives
// months after the mistake, so this is the one rule that must fail closed.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadRegistry, validateEntry, registerAsset, useAsset, licenseLines, LICENSES,
} from "./assetRegistry.mjs";

const ROOT = mkdtempSync(path.join(os.tmpdir(), "assets-"));
mkdirSync(path.join(ROOT, "evidence-assets"), { recursive: true });
const touch = (rel) => {
  const p = path.join(ROOT, "evidence-assets", rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, "png");
  return rel;
};

const PD = {
  key: "P_SENATOR", subject: "Some Senator", file: touch("cutouts/senator.png"),
  license: "public-domain", sourceUrl: "https://www.congress.gov/portrait/12345",
};

test("a rights-clean entry registers and round-trips", () => {
  const e = registerAsset(ROOT, "cutout", PD);
  assert.equal(e.license, "public-domain");
  assert.equal(e.uses, 0);
  assert.equal(loadRegistry(ROOT, "cutout").entries.P_SENATOR.subject, "Some Senator");
});

test("THE LICENSE GATE: no license, or an unlisted one, cannot be registered", () => {
  assert.throws(() => registerAsset(ROOT, "cutout", { ...PD, key: "P_A", license: undefined }),
    /missing "license"/);
  // The asset class this exists to keep out.
  for (const bad of ["getty", "ap-editorial", "rights-managed", "fair-use", ""]) {
    assert.throws(() => registerAsset(ROOT, "cutout", { ...PD, key: "P_B", license: bad }),
      /license|missing/, `"${bad}" must be refused`);
  }
  assert.ok(!LICENSES.has("getty") && !LICENSES.has("ap-editorial"),
    "paid editorial licenses are absent from the allowlist by design");
});

test("attribution-required licenses demand an author", () => {
  assert.throws(
    () => registerAsset(ROOT, "cutout", { ...PD, key: "P_CC", license: "cc-by", author: undefined }),
    /requires attribution.*"author" is mandatory/s,
  );
  const ok = registerAsset(ROOT, "cutout", {
    ...PD, key: "P_CC", license: "cc-by", author: "A Photographer",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:X.jpg",
  });
  assert.equal(ok.author, "A Photographer");
});

test("nothing registers a promise — the file must exist", () => {
  assert.throws(
    () => registerAsset(ROOT, "cutout", { ...PD, key: "P_GHOST", file: "cutouts/not-there.png" }),
    /file does not exist.*nothing registers a promise/s,
  );
});

test("keys are storyboard-referenced, so their shape is enforced", () => {
  assert.match(validateEntry({ ...PD, key: "lower_case" }).join(";"), /SCREAMING_SNAKE/);
});

test("re-registering an existing key requires an explicit overwrite", () => {
  assert.throws(() => registerAsset(ROOT, "cutout", { ...PD, subject: "Someone Else" }),
    /already registered — pass overwrite/);
  const e = registerAsset(ROOT, "cutout", { ...PD, subject: "Someone Else" }, { overwrite: true });
  assert.equal(e.subject, "Someone Else");
});

test("useAsset resolves a path and amortizes; an unknown key fails naming the registry", () => {
  const before = loadRegistry(ROOT, "cutout").entries.P_SENATOR.uses;
  const a = useAsset(ROOT, "cutout", "P_SENATOR");
  assert.ok(existsSync(a.absPath), "resolves to a real file");
  assert.equal(loadRegistry(ROOT, "cutout").entries.P_SENATOR.uses, before + 1, "uses is the amortization argument");
  assert.throws(() => useAsset(ROOT, "cutout", "P_NOPE"), /not registered.*Registered: /s);
});

test("licenseLines produce provenance in the LICENSES.md format", () => {
  const lines = licenseLines([
    { key: "P_SENATOR", subject: "Some Senator", license: "public-domain", sourceUrl: "https://congress.gov/x" },
    { key: "P_CC", subject: "Another", license: "cc-by", author: "A Photographer", sourceUrl: "https://commons.wikimedia.org/y" },
  ]);
  assert.match(lines[0], /^- \*\*P_SENATOR\*\* \(Some Senator\) — public-domain — https/);
  assert.match(lines[1], /cc-by, A Photographer/, "attribution appears in the provenance line");
});

test("landmarks and flags share the gate; unknown kinds are refused", () => {
  const e = registerAsset(ROOT, "landmark", {
    key: "L_WHITE_HOUSE", subject: "The White House", file: touch("landmarks/wh.png"),
    license: "public-domain", sourceUrl: "https://www.whitehouse.gov/photo",
  });
  assert.equal(e.key, "L_WHITE_HOUSE");
  assert.throws(() => loadRegistry(ROOT, "portrait"), /unknown kind "portrait"/);
});
