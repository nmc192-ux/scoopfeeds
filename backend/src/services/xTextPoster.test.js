/**
 * Auto-posting the X text queue.
 *
 * The queue has existed for months as a paste-by-hand workflow. Three things
 * make "just post it" wrong, and each has a test here: every post carries our
 * tracking link ($0.20 instead of $0.015), 785 were generated in one day, and
 * a six-hour-old take on a news story is worth nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripOwnLink, groupPosts, isComplete, runXTextCycle } from "./xTextPoster.js";

const withEnv = async (vars, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

test("our tracking link is removed — it costs 13x and gets downranked", () => {
  const real = "📰 Hegseth's Purge of Top Generals Leaves the Army Rudderless\n\nThe leadership vacuum comes as the Army adapts…\n\nhttps://scoopfeeds.com/article/77f9b14b?utm_source=social_x&utm_medium=social";
  const out = stripOwnLink(real);
  assert.ok(!/scoopfeeds\.com/.test(out));
  assert.ok(out.startsWith("📰 Hegseth"));
  assert.ok(!/\n{3,}/.test(out), "the gap the link left must close up");
});

test("a link that is not ours is left alone", () => {
  // Rewriting a quoted URL silently would change what the post says.
  // assertNoLink refuses it downstream instead, loudly.
  const t = "The filing is at https://sec.gov/x — worth reading";
  assert.equal(stripOwnLink(t), t);
});

test("threads are grouped and ordered; singles stand alone", () => {
  const rows = [
    { id: 3, thread_group_id: "g1", thread_position: 2, thread_total: 3 },
    { id: 9, thread_group_id: null, thread_position: null, thread_total: null },
    { id: 1, thread_group_id: "g1", thread_position: 1, thread_total: 3 },
    { id: 5, thread_group_id: "g1", thread_position: 3, thread_total: 3 },
  ];
  const groups = groupPosts(rows);
  assert.equal(groups.length, 2);
  const thread = groups.find(g => g.length === 3);
  assert.deepEqual(thread.map(p => p.thread_position), [1, 2, 3], "parts must chain in order");
});

test("an incomplete thread is not started", () => {
  // A half-posted thread reads worse than none, and the missing part cannot be
  // inserted later.
  assert.equal(isComplete([{ thread_position: 1, thread_total: 3 }]), false);
  assert.equal(isComplete([{ thread_position: 1, thread_total: 3 }, { thread_position: 3, thread_total: 3 }]), false);
  assert.equal(isComplete([1,2,3].map(p => ({ thread_position: p, thread_total: 3 }))), true);
  assert.equal(isComplete([{ thread_total: null }]), true, "a single is complete by itself");
});

test("off by default — the queue is not drained by accident", async () => {
  await withEnv({ X_TEXT_POST_ENABLED: undefined }, async () => {
    assert.equal((await runXTextCycle()).status, "off");
  });
  for (const v of ["", "0", "true"]) {
    await withEnv({ X_TEXT_POST_ENABLED: v }, async () => {
      assert.equal((await runXTextCycle()).status, "off");
    });
  }
});

test("the daily cap stops the backlog becoming a bill", async () => {
  await withEnv({ X_TEXT_POST_ENABLED: "1", X_TEXT_MAX_PER_DAY: "8",
                  X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "ts" }, async () => {
    const r = await runXTextCycle({ deps: { _count: () => 8, _list: () => { throw new Error("must not query"); } } });
    assert.equal(r.status, "capped");
  });
});

test("a thread that does not fit the remaining budget is not begun", async () => {
  await withEnv({ X_TEXT_POST_ENABLED: "1", X_TEXT_MAX_PER_DAY: "3",
                  X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "ts" }, async () => {
    const parts = [1,2,3,4].map(p => ({ id: p, article_id: "a", post_text: "part " + p,
      thread_group_id: "g", thread_position: p, thread_total: 4, article_title: "T" }));
    let posts = 0;
    const r = await runXTextCycle({ deps: {
      _count: () => 1, _list: () => parts, _entities: () => [],
      _postToX: async () => { posts++; return { id: "1" }; }, _mark: () => 1,
    }});
    assert.equal(posts, 0, "starting a 4-part thread with 2 slots left would strand it");
    assert.equal(r.posted, 0);
  });
});

test("a thread chains, and only the first part carries tags", async () => {
  await withEnv({ X_TEXT_POST_ENABLED: "1", X_TEXT_MAX_PER_DAY: "10",
                  X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "ts" }, async () => {
    const parts = [1,2].map(p => ({ id: p, article_id: "a", post_text: "part " + p,
      thread_group_id: "g", thread_position: p, thread_total: 2,
      article_title: "Iran and China meet over oil" }));
    const sent = [];
    await runXTextCycle({ deps: {
      _count: () => 0, _list: () => parts,
      _entities: () => [{ label: "Iran", entity_type: "place" }, { label: "China", entity_type: "place" }],
      _postToX: async (a) => { sent.push(a); return { id: "id" + sent.length }; },
      _mark: () => 2,
    }});
    assert.equal(sent.length, 2);
    assert.equal(sent[0].replyToId, null, "the first part opens the thread");
    assert.equal(sent[1].replyToId, "id1", "the second replies to the first");
    assert.match(sent[0].text, /#/, "tags on the opener");
    assert.ok(!/#/.test(sent[1].text), "repeating tags down a thread pays the penalty twice");
  });
});

test("a mid-thread failure marks what went out and stops", async () => {
  await withEnv({ X_TEXT_POST_ENABLED: "1", X_TEXT_MAX_PER_DAY: "10",
                  X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "ts" }, async () => {
    const parts = [1,2,3].map(p => ({ id: p, article_id: "a", post_text: "p" + p,
      thread_group_id: "g", thread_position: p, thread_total: 3, article_title: "T" }));
    let marked = null, n = 0;
    await runXTextCycle({ deps: {
      _count: () => 0, _list: () => parts, _entities: () => [],
      _postToX: async () => { if (++n === 2) throw new Error("429 rate limit"); return { id: "i" + n }; },
      _mark: (ids) => { marked = ids; return ids.length; },
    }});
    assert.deepEqual(marked, [1], "what was published must never be re-published");
  });
});

// ─── post quality ───────────────────────────────────────────────────────────
//
// DrJ, reading the live feed: "Majority of the posts do not mention the source
// of the story, story is incomplete and text is truncated." All three come from
// one cause — the composer wrote for a human to PASTE, where the link carried
// both the attribution and the "read the rest".

import { stripComposerTags, completeSentencesOnly, addSource } from "./xTextPoster.js";

test("the composer's generic tag block is removed", () => {
  // "#worldnews #global #ScoopFeeds" is three generic tags — measured worst
  // case: 1-2 specific tags earn ~21% over none, 3+ costs ~17%.
  const t = "🌍 Guinea's president dismisses 173 soldiers\n\n#worldnews #global #ScoopFeeds";
  const out = stripComposerTags(t);
  assert.ok(!/#worldnews|#global|#ScoopFeeds/.test(out));
  assert.ok(out.startsWith("🌍 Guinea"));
});

test("a hashtag inside a sentence is not mistaken for a tag block", () => {
  const t = "Traders watched #Nvidia all morning and the price held.";
  assert.equal(stripComposerTags(t), t);
});

test("an unfinished sentence is trimmed back to what was actually said", () => {
  assert.equal(
    completeSentencesOnly("VW bosses face a decisive vote today. The outcome will shape the plant by […]"),
    "VW bosses face a decisive vote today.");
  assert.equal(completeSentencesOnly("Complete already."), "Complete already.");
});

test("a part with nothing complete yields empty, so the caller can drop it", () => {
  // The real one, verbatim from the queue. With the link gone it says nothing.
  assert.equal(
    completeSentencesOnly("Hired as a civil servant under the agency's workforce directive to restore core competencies by […]"),
    "");
});

test("the publisher is named, because the link no longer does it", () => {
  const out = addSource("🌍 Guinea's president dismisses 173 soldiers", "BBC World");
  assert.match(out, /Source: BBC World$/);
});

test("a publisher that looks like a domain is still safe to name", () => {
  // "Source: Investing.com" is a $0.20 post by X's billing.
  assert.match(addSource("Markets moved", "Investing.com"), /Source: Investing$/);
});

test("the source is not repeated if it is already there", () => {
  const once = addSource("Headline\n\nSource: Reuters", "Reuters");
  assert.equal((once.match(/Source:/g) || []).length, 1);
});

test("no publisher means no dangling label", () => {
  assert.equal(addSource("Headline", null), "Headline");
  assert.equal(addSource("Headline", ""), "Headline");
});

// ─── split, don't cut ───────────────────────────────────────────────────────
//
// DrJ: "can we not add follow-up posts where the principal post is longer and
// truncating it would not yield the actual or meaningful sense." X threads
// natively; losing the back half of a story to a character limit is a
// self-inflicted wound.

import { splitForThread, numberThread, stripPartMarkers } from "./xTextPoster.js";

const graphemes = (s) => [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(s)].length;

test("long prose becomes a chain, and nothing is lost", () => {
  const long = "Volkswagen bosses face a decisive vote today at Wolfsburg. The works council has demanded guarantees on three plants and a pay settlement that management says it cannot fund. Analysts expect a compromise on two of the three, with the Osnabrück site left open until the spring. A failure to agree would be the first open breach between the board and labour since 2016.";
  const parts = splitForThread(long);
  assert.ok(parts.length > 1, "should have split");
  for (const p of parts) assert.ok(graphemes(p) <= 280, "every part must fit");
  // Every sentence survives somewhere — that is the whole point.
  for (const sentence of ["decisive vote today", "cannot fund", "left open until the spring", "first open breach"]) {
    assert.ok(parts.some(p => p.includes(sentence)), `lost: ${sentence}`);
  }
});

test("a sentence is never broken across two posts", () => {
  const t = "First sentence here. Second sentence is quite a lot longer and carries the detail. Third one closes it out.";
  for (const p of splitForThread(t, 60)) {
    // Each part ends at a terminator, or is a wrapped over-long sentence.
    assert.ok(/[.!?]$/.test(p) || graphemes(p) >= 40, `broke mid-sentence: "${p}"`);
  }
});

test("a single sentence longer than a post wraps at a word, never mid-word", () => {
  const monster = "The " + "consequential ".repeat(40) + "decision.";
  const parts = splitForThread(monster);
  assert.ok(parts.length > 1);
  for (const p of parts) {
    assert.ok(graphemes(p) <= 280);
    assert.ok(!/\S$/.test(p) || !p.endsWith("consequen"), "must not cut inside a word");
  }
  assert.ok(parts.join(" ").includes("decision."), "the end of the sentence survives");
});

test("short text is left as one post", () => {
  assert.deepEqual(splitForThread("Short and complete."), ["Short and complete."]);
  assert.deepEqual(splitForThread(""), []);
});

test("numbering appears only when it earns its characters", () => {
  assert.deepEqual(numberThread(["a"]), ["a"], "a single post is not 1/1");
  assert.deepEqual(numberThread(["a", "b"]), ["a", "b"], "two read as a thread already");
  assert.deepEqual(numberThread(["a", "b", "c"]), ["a (1/3)", "b (2/3)", "c (3/3)"]);
});

test("the composer's own part markers are removed before we re-split", () => {
  // Ours would otherwise disagree with theirs, and a wrong marker is worse
  // than none.
  assert.equal(stripPartMarkers("🤖 Taking your temperature from the inside (1/3)"),
               "🤖 Taking your temperature from the inside");
  assert.equal(stripPartMarkers("No marker here"), "No marker here");
});

test("a lone hashtag line is stripped, and stops hiding a truncation", () => {
  // Live dry run: "…profits r…\n\n#ScoopFeeds". The stripper required two tags,
  // so the lone one survived — which also placed it AFTER the ellipsis, hiding
  // the truncation from completeSentencesOnly and pushing Source into the
  // middle of the post. One stray tag broke three things.
  const raw = "📰 Cnooc's 1H Profit Rises After Iran War Boosted Oil Prices\n\nChina's biggest offshore driller said its first-half profits r…\n\n#ScoopFeeds";
  const stripped = stripComposerTags(raw);
  assert.ok(!/#ScoopFeeds/.test(stripped), "the lone tag must go");
  assert.ok(/r…$/.test(stripped.trim()), "the truncation is now at the end where it can be detected");
  assert.equal(completeSentencesOnly(stripped),
    "", "nothing in it was finished, so the caller drops it");
});

test("a tag line among real text is removed without touching the text", () => {
  const t = "Headline here\n\n#OnlyTag\n\nA complete sentence follows.";
  const out = stripComposerTags(t);
  assert.ok(!/#OnlyTag/.test(out));
  assert.ok(out.includes("Headline here") && out.includes("A complete sentence follows."));
});
