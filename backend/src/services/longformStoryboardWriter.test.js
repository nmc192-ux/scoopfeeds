/**
 * longformStoryboardWriter.test.js — the generator's contract (#77).
 *
 * The model is injected (`call`), so nothing here touches a network or a
 * database. The behaviours under test are the ones that decide whether a bad
 * film reaches an audience:
 *
 *   1. off by default — dark ship
 *   2. schema violations are fed back and retried, BOUNDED
 *   3. an ungrounded figure ABANDONS the film and is never retried into
 *   4. exhaustion returns null — there is no degraded long-form
 *   5. it never throws into its caller
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  writeStoryboard, buildStoryboardPrompt, ungroundedFigures,
  isLongformStoryboardEnabled,
} from "./longformStoryboardWriter.js";

/** A schema-valid document; `over` breaks one thing at a time. */
const goodDoc = (over = {}) => ({
  spine: { throughLine: "the ship that cannot move", question: "what if it closes",
           reveal: "four counts that cannot all be true", escalation: "each chapter raises",
           questionBeat: 1, answerBeat: 5 },
  beats: {
    1: { card: "statement", lines: ["WHAT HAPPENS IF IT CLOSES?"] },
    2: { card: "stat", figure: "$1,240", unit: "BN", label: "The ninety-day cost." },
    3: { card: "chapter", n: "01", name: "THE MECHANISM" },
    4: { card: "ledger", rows: [{ who: "IMO", what: "Declared it closed." }] },
    5: { card: "statement", lines: ["NOBODY CAN CLOSE THE COUNT."] },
  },
  shorts: [{ name: "a", from: 1, to: 2, title: "T", hook: "H" }],
  reveal: 5,
  ...over,
});

const SOURCE = "IMO reported the closure. Losses reached $1,240 BN over ninety days.";

const withEnv = async (on, fn) => {
  const prev = process.env.LONGFORM_STORYBOARD_ENABLED;
  if (on) process.env.LONGFORM_STORYBOARD_ENABLED = "1";
  else delete process.env.LONGFORM_STORYBOARD_ENABLED;
  try { return await fn(); }
  finally {
    if (prev === undefined) delete process.env.LONGFORM_STORYBOARD_ENABLED;
    else process.env.LONGFORM_STORYBOARD_ENABLED = prev;
  }
};

test("dark ship: off unless the flag is literally 1", async () => {
  await withEnv(false, async () => {
    assert.equal(isLongformStoryboardEnabled(), false);
    let called = 0;
    const out = await writeStoryboard({ script: "x", call: async () => { called++; return goodDoc(); } });
    assert.equal(out, null);
    assert.equal(called, 0, "the model must not be called at all when disabled");
  });
});

test("a valid storyboard is accepted on the first attempt", async () => {
  await withEnv(true, async () => {
    let calls = 0;
    const out = await writeStoryboard({
      script: "beat 1 ...", sourceText: SOURCE,
      call: async () => { calls++; return goodDoc(); },
    });
    assert.ok(out, "should return the document");
    assert.equal(calls, 1, "no needless retry");
    assert.equal(out.reveal, 5);
  });
});

test("schema violations are fed BACK to the model and retried", async () => {
  await withEnv(true, async () => {
    const prompts = [];
    let calls = 0;
    const out = await writeStoryboard({
      script: "x", sourceText: SOURCE,
      call: async (prompt) => {
        prompts.push(prompt);
        calls++;
        // First attempt has a typo'd field; second is clean.
        return calls === 1
          ? goodDoc({ beats: { ...goodDoc().beats, 2: { card: "stat", figure: "$1,240", lable: "typo", label: "x" } } })
          : goodDoc();
      },
    });
    assert.ok(out, "the retry should succeed");
    assert.equal(calls, 2);
    assert.match(prompts[1], /A PREVIOUS ATTEMPT WAS REJECTED/);
    assert.match(prompts[1], /unknown field "lable"/,
      "the exact validator message must reach the model, not a generic 'try again'");
    assert.doesNotMatch(prompts[0], /PREVIOUS ATTEMPT/, "the first prompt is clean");
  });
});

test("retries are BOUNDED and exhaustion returns null — no degraded long-form", async () => {
  await withEnv(true, async () => {
    const prev = process.env.LONGFORM_STORYBOARD_ATTEMPTS;
    process.env.LONGFORM_STORYBOARD_ATTEMPTS = "3";
    try {
      let calls = 0;
      const out = await writeStoryboard({
        script: "x", sourceText: SOURCE,
        call: async () => { calls++; return goodDoc({ beats: { 1: { card: "montage" } } }); },
      });
      assert.equal(out, null, "an unfixable storyboard abandons the film");
      assert.equal(calls, 3, "exactly the configured number of attempts, then stop");
    } finally {
      if (prev === undefined) delete process.env.LONGFORM_STORYBOARD_ATTEMPTS;
      else process.env.LONGFORM_STORYBOARD_ATTEMPTS = prev;
    }
  });
});

test("AN UNGROUNDED FIGURE ABANDONS THE FILM — and is never retried into", async () => {
  // The load-bearing one. Asking again for a number the model invented invites
  // a plausible-looking substitute rather than an honest omission.
  await withEnv(true, async () => {
    let calls = 0;
    const out = await writeStoryboard({
      script: "x", sourceText: SOURCE,
      call: async () => {
        calls++;
        return goodDoc({ beats: { ...goodDoc().beats,
          2: { card: "stat", figure: "$9,999", unit: "BN", label: "Invented." } } });
      },
    });
    assert.equal(out, null, "a hallucinated figure must abandon the film");
    assert.equal(calls, 1, "and must NOT be retried into");
  });
});

test("a null from the model layer abandons immediately rather than looping", async () => {
  await withEnv(true, async () => {
    let calls = 0;
    const out = await writeStoryboard({ script: "x", call: async () => { calls++; return null; } });
    assert.equal(out, null);
    assert.equal(calls, 1, "disabled/over-budget/provider-failure does not improve on retry");
  });
});

test("a throwing model never throws into the caller", async () => {
  await withEnv(true, async () => {
    const out = await writeStoryboard({
      script: "x", call: async () => { throw new Error("provider exploded"); },
    });
    assert.equal(out, null);
  });
});

test("no script means no call", async () => {
  await withEnv(true, async () => {
    let calls = 0;
    assert.equal(await writeStoryboard({ script: "  ", call: async () => { calls++; } }), null);
    assert.equal(calls, 0);
  });
});

// ── the grounding screen itself ─────────────────────────────────────────────

test("ungroundedFigures catches invented numbers and tolerates formatting", () => {
  const src = "Losses reached $1,240 BN. Some 2,000 vessels waited. Brent rose 41.7 percent.";
  assert.deepEqual(ungroundedFigures(goodDoc(), src), [], "sourced figures pass");
  // Separator-insensitive: "1240" in the doc matches "1,240" in the source.
  assert.deepEqual(
    ungroundedFigures({ beats: { 1: { card: "stat", figure: "1240", label: "x" } } }, src), []);
  const bad = ungroundedFigures({ beats: {
    1: { card: "stat", figure: "$9,999", label: "x" },
    2: { card: "statement", lines: ["41.7 PERCENT"] },        // sourced
    3: { card: "ledger", rows: [{ who: "A", what: "3,500 ships." }] },  // invented
  } }, src);
  assert.equal(bad.length, 2);
  // The message quotes the NUMERIC TOKEN — the regex matches digits, not the
  // currency prefix. "figure \"9,999\" appears in no supplied source" is what
  // a reader needs; carrying the "$" would mean re-parsing context.
  assert.match(bad.join("\n"), /beat 1: figure "9,999"/);
  assert.match(bad.join("\n"), /beat 3: figure "3,500"/);
});

test("small integers and years are not treated as claims", () => {
  // Chapter numerals, row counts and years appear everywhere; matching on them
  // produced only noise.
  const bad = ungroundedFigures({ beats: {
    1: { card: "chapter", n: "03", name: "THE MONEY" },
    2: { card: "stat", figure: "2026", label: "The year." },
    3: { card: "dotgrid", total: 100, out: 11, label: "Eleven in a hundred." },
  } }, "no numbers here at all");
  assert.deepEqual(bad, []);
});

test("the prompt carries the card grammar and the media keys, from the schema", () => {
  const p = buildStoryboardPrompt({
    script: "S", spine: {}, sources: ["[src]"],
    mediaKeys: { footage: ["F_SEA"], photos: ["P_ANCHOR"], docs: ["d1"], statements: ["19000001"] },
  });
  assert.match(p, /statement: required \{ lines \}/, "grammar is generated from CARD_SPECS, not restated by hand");
  assert.match(p, /F_SEA/); assert.match(p, /P_ANCHOR/); assert.match(p, /19000001/);
  assert.match(p, /GROUNDING: every figure must appear in the SOURCES/);
  assert.match(p, /A Short may never open\s+on one/);
});
