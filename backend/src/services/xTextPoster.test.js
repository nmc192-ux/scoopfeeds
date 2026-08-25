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
