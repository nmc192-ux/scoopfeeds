/**
 * The ffmpeg capability gate.
 *
 * Two things need proving: that it PASSES against the binary this host actually
 * resolves (otherwise it is a boot check that bricks every deploy), and that it
 * FAILS against each of the shapes it exists to catch — a missing xfade, an
 * unprobeable binary, and a minimal build that answers the probe but cannot
 * render. The last is the interesting one, because it is the case where the
 * naive check ("are the filters I want in this string?") would pass on a parse
 * that silently found nothing.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  REQUIRED_FILTERS, probeFilters, assertFFmpegCapable, FFmpegCapabilityError,
} from "./ffmpegCapability.js";
import { getFFmpegPath } from "./videoGenerator.js";

function caught(fn, Type) {
  try { fn(); } catch (err) {
    if (Type) assert.ok(err instanceof Type, `expected ${Type.name}, got ${err?.name}: ${err?.message}`);
    return err;
  }
  assert.fail("expected a throw, got none");
}

/** `-filters` output, in ffmpeg's real format. */
const filterLines = (names) =>
  "Filters:\n  T.. = Timeline support\n" +
  names.map((n) => ` ... ${n}              V->V       Does a thing.`).join("\n") + "\n";

/** A plausible binary: the required set plus enough others to look real. */
const PLAUSIBLE = filterLines([
  ...REQUIRED_FILTERS,
  ...Array.from({ length: 80 }, (_, i) => `filler${i}`),
]);

// ─── The real binary ────────────────────────────────────────────────────────

test("the binary this host resolves passes the gate", () => {
  // If this fails, the host cannot render and the gate is doing its job — but it
  // would also mean every worker here refuses to boot, so it is worth knowing
  // as a test rather than as a deploy.
  const out = assertFFmpegCapable();
  assert.ok(out.ffmpegPath);
  assert.deepEqual(out.missing, []);
  assert.ok(out.filterCount > 50);
});

test("the real binary genuinely has each required filter", () => {
  const { present } = probeFilters(getFFmpegPath());
  for (const f of REQUIRED_FILTERS) {
    assert.ok(present.has(f), `${f} is missing from the resolved binary`);
  }
});

// ─── The failures it exists to catch ───────────────────────────────────────

test("a binary without xfade is REFUSED, with the reason and the remedy", () => {
  const without = filterLines([
    "drawtext", "overlay", "zoompan",
    ...Array.from({ length: 80 }, (_, i) => `filler${i}`),
  ]);
  const err = caught(() => assertFFmpegCapable({ ffmpegPath: "/fake/ffmpeg", run: () => without }), FFmpegCapabilityError);
  assert.equal(err.code, "missing-filters");
  assert.deepEqual(err.missing, ["xfade"]);
  assert.match(err.message, /4\.3/, "the message should say which version introduced it");
  assert.match(err.message, /2018/, "and name the bundled binary as the likely cause");
  assert.match(err.message, /Refusing to start/);
});

test("every required filter is individually load-bearing", () => {
  // Not just xfade: a check that only really tested one entry would let the
  // others rot into decoration.
  for (const dropped of REQUIRED_FILTERS) {
    const out = filterLines([
      ...REQUIRED_FILTERS.filter((f) => f !== dropped),
      ...Array.from({ length: 80 }, (_, i) => `filler${i}`),
    ]);
    const err = caught(() => assertFFmpegCapable({ ffmpegPath: "/fake", run: () => out }), FFmpegCapabilityError);
    assert.deepEqual(err.missing, [dropped], `dropping ${dropped} should be caught`);
  }
});

test("a MINIMAL build that answers the probe is refused, not accepted", () => {
  // Playwright ships an ffmpeg 7.0.1 with 24 filters. It is real ffmpeg, recent,
  // and cannot render this pipeline. Without the plausibility floor a probe that
  // happened to find the four names in a tiny build would pass.
  const minimal = filterLines([...REQUIRED_FILTERS, "scale", "null", "copy"]);
  const err = caught(() => assertFFmpegCapable({ ffmpegPath: "/fake", run: () => minimal }), FFmpegCapabilityError);
  assert.equal(err.code, "implausible-probe");
  assert.match(err.message, /implausibly few/);
});

test("a probe that returns nothing is refused rather than read as 'no filters missing'", () => {
  // The vacuous-pass shape: an empty parse means the `missing` list is computed
  // against an empty set, so everything is missing — but a naive implementation
  // that searched a string would report everything PRESENT.
  const err = caught(() => assertFFmpegCapable({ ffmpegPath: "/fake", run: () => "" }), FFmpegCapabilityError);
  assert.ok(["implausible-probe", "missing-filters"].includes(err.code));
});

test("a binary that cannot be executed is refused", () => {
  const err = caught(
    () => assertFFmpegCapable({ ffmpegPath: "/fake", run: () => { throw new Error("ENOENT"); } }),
    FFmpegCapabilityError
  );
  assert.equal(err.code, "probe-failed");
  assert.match(err.message, /cannot be trusted to render/);
});

test("no resolvable binary at all is refused, with nothing to degrade to", () => {
  const err = caught(
    () => assertFFmpegCapable({ resolve: () => null, run: () => PLAUSIBLE }),
    FFmpegCapabilityError
  );
  assert.equal(err.code, "no-ffmpeg");
  assert.match(err.message, /nothing to degrade to/);
});

test("THE REAL BUNDLED BINARY is caught — this is the actual production hazard", async () => {
  // Not a fixture. @ffmpeg-installer's linux-x64 binary is the thing
  // getFFmpegPath() falls back to when a host has no system ffmpeg, and it is a
  // 2018 build. If this ever starts passing, the bundle was updated and the
  // hazard is gone; until then this is the case the gate exists for.
  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  let bundled;
  try {
    bundled = require("@ffmpeg-installer/ffmpeg").path;
  } catch {
    return;   // the platform package is not installed here; nothing to assert
  }
  const { missing } = probeFilters(bundled);
  if (!missing.length) return;   // a newer bundle — the hazard has gone away

  const err = caught(() => assertFFmpegCapable({ ffmpegPath: bundled }), FFmpegCapabilityError);
  assert.equal(err.code, "missing-filters");
  assert.ok(err.missing.includes("xfade"),
    `expected the bundled binary to lack xfade; it is missing ${err.missing.join(", ")}`);
});

// ─── Parsing ────────────────────────────────────────────────────────────────

test("filter names are matched on word boundaries, not as substrings", () => {
  // `overlay_cuda` must not satisfy a requirement for `overlay`: reporting a
  // capability we do not have is the failure mode this whole file addresses.
  const cudaOnly = filterLines([
    "xfade", "drawtext", "zoompan", "overlay_cuda",
    ...Array.from({ length: 80 }, (_, i) => `filler${i}`),
  ]);
  const err = caught(() => assertFFmpegCapable({ ffmpegPath: "/fake", run: () => cudaOnly }), FFmpegCapabilityError);
  assert.deepEqual(err.missing, ["overlay"]);
});

test("the probe returns a usable summary on a healthy binary", () => {
  const { present, missing, filterCount } = probeFilters("/fake", { run: () => PLAUSIBLE });
  assert.deepEqual(missing, []);
  assert.ok(filterCount >= REQUIRED_FILTERS.length + 80);
  for (const f of REQUIRED_FILTERS) assert.ok(present.has(f));
});

test("the required set names the things that actually break", () => {
  // Each entry should be justifiable; if one is not used by the render path it
  // is a boot check refusing deploys for no reason.
  assert.deepEqual([...REQUIRED_FILTERS].sort(), ["drawtext", "overlay", "xfade", "zoompan"]);
});
