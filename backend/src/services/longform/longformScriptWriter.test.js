/**
 * longformScriptWriter.test.js — the narration and the spine it serves (#78).
 *
 * Model injected; no network, no DB. The behaviours that decide whether a film
 * is worth nine minutes of a viewer's time:
 *
 *   1. THE SPINE IS DECIDED FIRST, in its own call — asked together, a model
 *      emits beats and then describes a spine it did not follow
 *   2. the question is posed early and answered LAST, checked structurally
 *   3. the through-line RECURS — an object named once is a prop
 *   4. an ungrounded figure abandons the film, never retried into
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  writeLongformScript, validateScript, renderScriptMarkdown, wordCount,
  buildSpinePrompt, buildScriptPrompt, isLongformScriptEnabled, MIN_WORDS,
} from "./longformScriptWriter.js";

const EVENT = { id: "e1", slug: "strait", title: "Strait of Hormuz closed", summary: "A summary." };
const SOURCES = ["IMO, 31 March 2026: the strait is closed.", "Losses reached 1,240 billion."];
const SOURCE_TEXT = SOURCES.join(" ");

// A real 7-10 minute film runs ~50-75 beats at 1,000-1,400 words; the fixture
// matches that rather than a token handful, or the word-range check never
// exercises the path a real script takes.
const BEATS = 50;
const SPINE = {
  throughLine: "the ship that cannot move", question: "what happens if it closes",
  reveal: "four counts that cannot all be true", escalation: "each chapter raises the stakes",
  questionBeat: 2, answerBeat: 45,
};

/** Beats that mention the through-line and clear the word floor. */
const beats = (n = BEATS) => Array.from({ length: n }, (_, i) => ({
  text: i % 3 === 0
    ? `The ship that cannot move waits again, and the count of vessels grows longer than anyone expected it to become this quarter.`
    : `Another sentence of narration carrying the argument forward with enough words to reach the required length for a seven minute film at pace.`,
}));

const goodDoc = (over = {}) => ({ spine: { ...SPINE }, beats: beats(), ...over });

const withEnv = async (on, fn) => {
  const prev = process.env.LONGFORM_SCRIPT_ENABLED;
  if (on) process.env.LONGFORM_SCRIPT_ENABLED = "1"; else delete process.env.LONGFORM_SCRIPT_ENABLED;
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.LONGFORM_SCRIPT_ENABLED;
    else process.env.LONGFORM_SCRIPT_ENABLED = prev;
  }
};

/** Model stub: first call returns the spine, later calls the script. */
const stub = (script, spine = SPINE) => {
  const calls = [];
  const fn = async (prompt) => {
    calls.push(prompt);
    if (/STORY SPINE for a 7-10 minute/.test(prompt)) return spine;
    return typeof script === "function" ? script(calls.length) : script;
  };
  fn.calls = calls;
  return fn;
};

// ── Structure ───────────────────────────────────────────────────────────────

test("dark ship: nothing is called when the flag is off", async () => {
  await withEnv(false, async () => {
    assert.equal(isLongformScriptEnabled(), false);
    const call = stub(goodDoc());
    assert.equal(await writeLongformScript({ event: EVENT, sources: SOURCES, call }), null);
    assert.equal(call.calls.length, 0);
  });
});

test("THE SPINE IS A SEPARATE CALL, MADE FIRST", async () => {
  await withEnv(true, async () => {
    const call = stub(goodDoc());
    const out = await writeLongformScript({ event: EVENT, sources: SOURCES, sourceText: SOURCE_TEXT, call });
    assert.ok(out);
    assert.equal(call.calls.length, 2, "one spine call, then one script call");
    assert.match(call.calls[0], /STORY SPINE for a 7-10 minute/, "the FIRST call decides the spine");
    assert.match(call.calls[1], /SPINE \(decided; serve it\)/, "the second call is given it to serve");
  });
});

test("no usable spine abandons before any script call", async () => {
  await withEnv(true, async () => {
    const call = stub(goodDoc(), { nonsense: true });
    assert.equal(await writeLongformScript({ event: EVENT, sources: SOURCES, call }), null);
    assert.equal(call.calls.length, 1, "it must not go on to write beats");
  });
});

test("a film cannot be grounded in nothing", async () => {
  await withEnv(true, async () => {
    const call = stub(goodDoc());
    assert.equal(await writeLongformScript({ event: EVENT, sources: [], call }), null);
    assert.equal(call.calls.length, 0);
  });
});

// ── The spine's mechanical parts ────────────────────────────────────────────

test("the question must be posed EARLY and answered LAST", () => {
  assert.deepEqual(validateScript(goodDoc()), []);
  assert.match(
    validateScript(goodDoc({ spine: { ...SPINE, questionBeat: 30 } })).join("\n"),
    /questionBeat 30 of 50 is not in the opening/);
  assert.match(
    validateScript(goodDoc({ spine: { ...SPINE, answerBeat: 5 } })).join("\n"),
    /answerBeat 5 of 50 is not in the closing/);
});

test("THE THROUGH-LINE MUST RECUR — an object named once is a prop", () => {
  const noRecurrence = goodDoc({
    beats: Array.from({ length: BEATS }, () => ({
      text: "Narration that never mentions the object at all, carrying on with enough words to clear the floor for a seven minute film." })),
  });
  assert.match(validateScript(noRecurrence).join("\n"),
    /appears in 0 beat\(s\) — it must recur and escalate, not be named once/);
});

test("the word range is enforced at both ends", () => {
  assert.match(validateScript(goodDoc({ beats: [{ text: "Too short." }] })).join("\n"),
    /too short for 7 minutes/);
  assert.match(validateScript(goodDoc({ beats: beats(200) })).join("\n"),
    /over ten minutes/);
});

test("missing spine fields are named individually", () => {
  const errs = validateScript(goodDoc({ spine: { questionBeat: 2, answerBeat: 18 } }));
  for (const f of ["throughLine", "question", "reveal", "escalation"]) {
    assert.match(errs.join("\n"), new RegExp(`spine.${f}: missing`));
  }
});

// ── Grounding and retry ─────────────────────────────────────────────────────

test("AN UNGROUNDED FIGURE ABANDONS THE FILM, never retried into", async () => {
  await withEnv(true, async () => {
    const bad = goodDoc({ beats: [...beats(BEATS - 1), { text: "Losses reached 9,999 billion dollars." }] });
    const call = stub(bad);
    assert.equal(await writeLongformScript({
      event: EVENT, sources: SOURCES, sourceText: SOURCE_TEXT, call }), null);
    assert.equal(call.calls.length, 2, "spine + ONE script call — no retry on a hallucinated number");
  });
});

test("structural problems ARE retried, with the exact messages fed back", async () => {
  await withEnv(true, async () => {
    const call = stub((n) => (n === 2 ? goodDoc({ spine: { ...SPINE, answerBeat: 3 } }) : goodDoc()));
    const out = await writeLongformScript({
      event: EVENT, sources: SOURCES, sourceText: SOURCE_TEXT, call });
    assert.ok(out, "the retry succeeded");
    assert.equal(call.calls.length, 3, "spine + two script attempts");
    assert.match(call.calls[2], /A PREVIOUS ATTEMPT WAS REJECTED/);
    assert.match(call.calls[2], /answerBeat 3 of 50 is not in the closing/);
  });
});

test("exhaustion abandons — there is no degraded long-form", async () => {
  await withEnv(true, async () => {
    const prev = process.env.LONGFORM_SCRIPT_ATTEMPTS;
    process.env.LONGFORM_SCRIPT_ATTEMPTS = "2";
    try {
      const call = stub(goodDoc({ beats: [{ text: "far too short" }] }));
      assert.equal(await writeLongformScript({
        event: EVENT, sources: SOURCES, sourceText: SOURCE_TEXT, call }), null);
      assert.equal(call.calls.length, 3, "spine + exactly 2 attempts");
    } finally {
      if (prev === undefined) delete process.env.LONGFORM_SCRIPT_ATTEMPTS;
      else process.env.LONGFORM_SCRIPT_ATTEMPTS = prev;
    }
  });
});

test("a throwing model never throws into the caller", async () => {
  await withEnv(true, async () => {
    assert.equal(await writeLongformScript({
      event: EVENT, sources: SOURCES, call: async () => { throw new Error("boom"); } }), null);
  });
});

// ── Rendering ───────────────────────────────────────────────────────────────

test("script.md carries the STORY SPINE block the engine expects", async () => {
  await withEnv(true, async () => {
    const out = await writeLongformScript({
      event: EVENT, sources: SOURCES, sourceText: SOURCE_TEXT, call: stub(goodDoc()) });
    const md = out.markdown;
    assert.match(md, /^# Strait of Hormuz closed/);
    assert.match(md, /STORY SPINE/);
    assert.match(md, /THROUGH-LINE OBJECT — the ship that cannot move/);
    assert.match(md, /THE QUESTION \(beat 2\)/);
    assert.match(md, /ANSWERED — beat 45/);
    assert.match(md, /^1\. /m, "beats are numbered from 1");
  });
});

test("wordCount ignores markdown emphasis", () => {
  assert.equal(wordCount("**bold** and _italic_ words"), 4);
});

test("the prompts state the hard rules", () => {
  assert.match(buildSpinePrompt({ event: EVENT, sources: SOURCES }), /Create a debt and settle it/);
  assert.match(buildSpinePrompt({ event: EVENT, sources: SOURCES }), /Do not open on the reversal/);
  const p = buildScriptPrompt({ event: EVENT, spine: SPINE, sources: SOURCES });
  assert.match(p, new RegExp(`${MIN_WORDS}-1400 words TOTAL`));
  assert.match(p, /GROUNDING: every figure must appear in the SOURCES/);
  assert.match(p, /Assign no blame/);
});
