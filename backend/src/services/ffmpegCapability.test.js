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
  FFMPEG_DEPENDENT_QUEUES, requiresFFmpeg, withFFmpegGuard, ffmpegCapability,
  reportFFmpegCapabilityAtBoot, _resetCapability,
} from "./ffmpegCapability.js";
import { QUEUE_NAMES } from "../jobs/jobOptions.js";
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


// ─── The refusal is SCOPED — the rest of the worker must come up ───────────

/** Every queue this worker consumes, by the string BullMQ actually sees. */
const ALL_WORKER_QUEUES = [
  QUEUE_NAMES.ingestion, QUEUE_NAMES.video, QUEUE_NAMES.videoRender,
  QUEUE_NAMES.longform, QUEUE_NAMES.enrichment, QUEUE_NAMES.social,
  QUEUE_NAMES.analysis,
];

/** A probe that says the host cannot render. */
const brokenProbe = () => ({ capable: false, missing: ["xfade"], reason: "no xfade" });

test("ingestion, social, enrichment and analysis STILL RUN when ffmpeg cannot render", async () => {
  // The ruling this exists for: the first version refused to boot, which would
  // have taken RSS ingestion and every social surface down for a render fault.
  const ran = [];
  const registered = ALL_WORKER_QUEUES.map((q) => [
    q, withFFmpegGuard(q, async () => { ran.push(q); return "ok"; }, { probe: brokenProbe }),
  ]);

  for (const [q, processor] of registered) {
    if (requiresFFmpeg(q)) continue;
    assert.equal(await processor({}), "ok", `queue "${q}" must still run`);
  }
  assert.deepEqual(
    ran.sort(),
    ALL_WORKER_QUEUES.filter((q) => !requiresFFmpeg(q)).sort(),
    "every non-render queue must have executed"
  );
});

test("YouTube INGESTION is not a render queue — it must not be caught by the guard", async () => {
  // `video` fetches YouTube content; `video_render` renders. Confusing the two
  // would take content ingestion down for a render fault, which is exactly the
  // mistake being undone.
  assert.equal(requiresFFmpeg(QUEUE_NAMES.video), false);
  const processor = withFFmpegGuard(QUEUE_NAMES.video, async () => "ingested", { probe: brokenProbe });
  assert.equal(await processor({}), "ingested");
});

test("the render queues refuse at DISPATCH, naming the missing capability", async () => {
  for (const q of FFMPEG_DEPENDENT_QUEUES) {
    const processor = withFFmpegGuard(q, async () => "rendered", { probe: brokenProbe });
    const err = await processor({}).then(() => null, (e) => e);
    assert.ok(err instanceof FFmpegCapabilityError, `${q} should refuse`);
    assert.equal(err.code, "render-unavailable");
    assert.match(err.message, /xfade/, "the missing capability must be named");
    assert.match(err.message, /other queues are unaffected/, "and the blast radius stated");
  }
});

test("the dependent set is exactly the two queues that render", () => {
  assert.deepEqual([...FFMPEG_DEPENDENT_QUEUES].sort(), ["longform", "video_render"]);
  // Keyed by the STRING BullMQ sees, not the QUEUE_NAMES key — they differ for
  // videoRender, and a mismatch there would make the guard a no-op.
  assert.equal(QUEUE_NAMES.videoRender, "video_render");
  assert.ok(FFMPEG_DEPENDENT_QUEUES.includes(QUEUE_NAMES.videoRender));
  assert.ok(FFMPEG_DEPENDENT_QUEUES.includes(QUEUE_NAMES.longform));
});

test("with a capable host the guard is transparent on every queue", async () => {
  const goodProbe = () => ({ capable: true, missing: [] });
  for (const q of ALL_WORKER_QUEUES) {
    const processor = withFFmpegGuard(q, async () => "ok", { probe: goodProbe });
    assert.equal(await processor({}), "ok", q);
  }
});

test("a non-render processor is returned UNCHANGED, not merely passed through", () => {
  // Identity matters: it means the guard adds no wrapper, no async hop and no
  // behaviour to queues it has no business touching.
  const fn = async () => "x";
  assert.equal(withFFmpegGuard(QUEUE_NAMES.ingestion, fn), fn);
  assert.notEqual(withFFmpegGuard(QUEUE_NAMES.videoRender, fn), fn);
});

test("the boot report does NOT throw on an incapable host", () => {
  // The whole point: the process comes up.
  const cap = reportFFmpegCapabilityAtBoot({ probe: brokenProbe });
  assert.equal(cap.capable, false);
});

test("the capability probe is memoised — registration and every dispatch share one answer", () => {
  _resetCapability();
  let probes = 0;
  const run = () => { probes++; return PLAUSIBLE; };
  ffmpegCapability({ force: true, ffmpegPath: "/fake", run });
  ffmpegCapability({ ffmpegPath: "/fake", run });
  ffmpegCapability({ ffmpegPath: "/fake", run });
  assert.equal(probes, 1, "spawning a process per dispatch would be a real cost");
  _resetCapability();
});

test("the probe reports incapability instead of throwing", () => {
  _resetCapability();
  const cap = ffmpegCapability({ force: true, ffmpegPath: "/fake", run: () => filterLines(["drawtext", "overlay", "zoompan", ...Array.from({ length: 80 }, (_, i) => `f${i}`)]) });
  assert.equal(cap.capable, false);
  assert.deepEqual(cap.missing, ["xfade"]);
  assert.ok(cap.reason, "the reason must survive for the dispatch message");
  _resetCapability();
});

test("the guard is WIRED — registerWorker applies it, and boot does not refuse", async () => {
  // The migrate.test.js discipline: a guard that exists but is not called is
  // decoration. Asserted against the source, because workerProcess is a process
  // entry point that cannot be imported in a test without starting it.
  const { readFileSync } = await import("fs");
  const src = readFileSync(new URL("../jobs/workerProcess.js", import.meta.url), "utf8");
  assert.match(src, /processor = withFFmpegGuard\(queueName, processor\)/,
    "registerWorker must wrap every processor");
  assert.match(src, /reportFFmpegCapabilityAtBoot\(/, "boot must report the capability");
  assert.equal(/assertFFmpegCapable\(\)/.test(src), false,
    "boot must NOT refuse: that would take ingestion and social down for a render fault");
});
