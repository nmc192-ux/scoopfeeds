// THE SLIDE LOOP MUST NOT READ A BINDING ABOVE ITS DECLARATION.
//
// #133 added `!cutAsset` to the beat-imagery branch of produceVideo's slide
// loop, ~130 lines above `const cutAsset = …`. A `const` read before its
// declaration is in the temporal dead zone, so the read throws
// "Cannot access 'cutAsset' before initialization" — but only when that line is
// reached, which needs a resolved beat picture, which needs
// VIDEO_BEAT_IMAGERY_ENABLED=1. With the flag off (prod) the `beat &&` guard
// short-circuits and nothing fails, which is how it shipped.
//
// produceVideo cannot run in a unit test (it voices, fetches and renders), and
// the bug is a property of the source's ORDER, not of any value — so this reads
// the source. It checks every binding declared at the top level of the loop
// body, not just cutAsset: the loop is ~300 lines long and grows by insertion,
// which is exactly how this one happened.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./videoAutopost.js", import.meta.url), "utf8");

// The loop body, delimited by indentation: the file is consistently formatted
// and the loop sits at 4 spaces inside produceVideo, so its body is at 6 and
// its closing brace is the next line that is exactly `    }`.
function slideLoopBody() {
  const fnAt = SRC.indexOf("export async function produceVideo(");
  assert.ok(fnAt >= 0, "produceVideo not found — update this test with it");
  const head = "\n    for (let i = 0; i < slides.length; i++) {\n";
  const start = SRC.indexOf(head, fnAt);
  assert.ok(start >= 0, "produceVideo's slide loop not found — update this test with it");
  const bodyStart = start + head.length;
  const end = SRC.indexOf("\n    }\n", bodyStart);
  assert.ok(end > bodyStart, "slide loop has no closing brace at 4 spaces");
  return SRC.slice(bodyStart, end)
    .split("\n")
    // Comments are prose and mention bindings freely. `//` after `:` is a URL
    // inside a string, not a comment, so only strip one at line start or after
    // whitespace.
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

// Names declared by `const` / `let` at the loop's top level (6 spaces), with
// the offset of the declaration. Handles `const a =` and `const { a, b: c } =`.
function topLevelDeclarations(body) {
  const out = [];
  const re = /^ {6}(?:const|let) (\{[^}]*\}|\[[^\]]*\]|[A-Za-z_$][\w$]*)/gm;
  for (const m of body.matchAll(re)) {
    const target = m[1];
    const names = /^[{[]/.test(target)
      ? target.slice(1, -1).split(",").map((s) => s.split(":").pop().split("=")[0].trim()).filter(Boolean)
      : [target];
    for (const name of names) out.push({ name, at: m.index });
  }
  return out;
}

// First READ of `name`: skips member access (`x.name`) and object keys
// (`{ name: … }`), neither of which touches the binding.
function firstRead(body, name) {
  const re = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, "\\$")}(?![\\w$])(?!\\s*:(?!:))`, "g");
  const m = re.exec(body);
  return m ? m.index : -1;
}

test("the slide loop is found and has top-level bindings to check", () => {
  const decls = topLevelDeclarations(slideLoopBody());
  const names = decls.map((d) => d.name);
  for (const expected of ["card", "audioSecs", "cutAsset", "beat", "seg"]) {
    assert.ok(names.includes(expected), `expected a top-level "${expected}" in the slide loop; saw ${names.join(", ")}`);
  }
});

test("no top-level binding in the slide loop is read above its declaration (TDZ)", () => {
  const body = slideLoopBody();
  const lineOf = (off) => body.slice(0, off).split("\n").length;
  const offenders = topLevelDeclarations(body)
    .map((d) => ({ ...d, read: firstRead(body, d.name) }))
    .filter((d) => d.read >= 0 && d.read < d.at)
    .map((d) => `${d.name}: read at loop line ${lineOf(d.read)}, declared at loop line ${lineOf(d.at)}`);
  assert.deepEqual(offenders, [], "read before declaration throws a ReferenceError at runtime");
});

test("cutAsset specifically is declared before the beat-imagery branch reads it", () => {
  const body = slideLoopBody();
  const decl = body.indexOf("const cutAsset =");
  const read = body.indexOf("!cutAsset");
  assert.ok(decl >= 0 && read >= 0, "cutAsset declaration or its beat-imagery read moved — update this test");
  assert.ok(decl < read, "cutAsset is read by the beat-imagery branch before it is declared");
});
