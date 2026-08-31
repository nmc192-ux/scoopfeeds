import test from "node:test";
import assert from "node:assert/strict";
import { makeYielder, DEFAULT_YIELD_MS } from "./cooperativeYield.js";

/** A controllable clock, so these tests assert on policy rather than on timing. */
function fakeClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test("holds the thread until the ceiling, then yields", async () => {
  const clock = fakeClock();
  let passes = 0;
  const y = makeYielder({ everyMs: 50, _now: clock.now, _pass: async () => { passes += 1; } });

  assert.equal(await y(), false, "no time has passed — must not yield");
  clock.advance(49);
  assert.equal(await y(), false, "still inside the ceiling");
  clock.advance(1);
  assert.equal(await y(), true, "ceiling reached — must yield");
  assert.equal(passes, 1);
});

test("the clock restarts from AFTER the yield, not from before it", async () => {
  // A yield can itself take time (that is the point — other work runs). Timing
  // the next window from before it would make every subsequent call yield.
  const clock = fakeClock();
  const y = makeYielder({
    everyMs: 50,
    _now: clock.now,
    _pass: async () => { clock.advance(500); },   // something big ran while we were away
  });

  clock.advance(50);
  assert.equal(await y(), true);
  assert.equal(await y(), false, "the 500ms spent yielding must not count toward the next window");
});

test("everyMs of 0 yields on every call — the escape hatch is not a no-op", async () => {
  const clock = fakeClock();
  let passes = 0;
  const y = makeYielder({ everyMs: 0, _now: clock.now, _pass: async () => { passes += 1; } });
  await y(); await y(); await y();
  assert.equal(passes, 3);
});

test("counts only the yields it actually performed", async () => {
  const clock = fakeClock();
  const y = makeYielder({ everyMs: 50, _now: clock.now, _pass: async () => {} });
  await y();                       // too soon
  clock.advance(50); await y();    // yields
  await y();                       // too soon again
  clock.advance(50); await y();    // yields
  assert.equal(y.count(), 2, "count is evidence the yielder ran, so it must not count no-ops");
});

test("the real primitive actually lets a starved timer fire", async () => {
  // The whole point of the module: a setTimeout armed BEFORE a long stretch of
  // work must get to run. Uses the real setImmediate path, no injection.
  let timerFired = false;
  setTimeout(() => { timerFired = true; }, 0);

  const y = makeYielder({ everyMs: 0 });
  assert.equal(timerFired, false, "nothing has yielded yet");
  await y();
  assert.equal(timerFired, true, "one yield must be enough for a due timer to run");
});

test("default ceiling is well under BullMQ's shortest lock-renewal interval", () => {
  // The shortest lock in this codebase is 2 min, renewed at half that = 60s.
  // The ceiling has to leave that renewal room by a wide margin.
  assert.ok(DEFAULT_YIELD_MS <= 100, `expected a sub-100ms ceiling, got ${DEFAULT_YIELD_MS}`);
});
