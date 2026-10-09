/**
 * vision.js on llmQueue/Claude: frames travel as image content blocks, the call
 * is a "video-vision" task on VIDEO_VISION_MODEL (default claude-haiku-5-5), and
 * the check still FAILS CLOSED.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.SCOOP_PERSISTENT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vision-"));
delete process.env.VIDEO_VISION_MODEL;
Object.assign(process.env, { ANTHROPIC_API_KEY: "a-key", LLM_DAILY_CALL_CAP: "100000", LLM_RETRY_DELAYS_MS: "1,1,1" });

const { _test } = await import("../../realityIndex/llmQueue.js");
const { pickInPoints, judgePhoto, VISION_MODEL, MIN_MATCH } = await import("./vision.js");

const claudeOk = (obj, usage = { input_tokens: 3000, output_tokens: 120 }) =>
  ({ content: [{ type: "text", text: JSON.stringify(obj) }], usage, stop_reason: "end_turn" });
function claude(handler) {
  const calls = [];
  _test.setAnthropicClient({ messages: { create: async (params, opts) => { calls.push({ params, opts }); return handler(calls.length, params); } } });
  return calls;
}
const FRAMES = [{ t: 0, jpeg: Buffer.from("frame-a") }, { t: 5, jpeg: Buffer.from("frame-b") }];

test("default vision model is claude-haiku-5-5 and VIDEO_VISION_MODEL overrides it", () => {
  assert.equal(VISION_MODEL(), "claude-haiku-5-5");
  process.env.VIDEO_VISION_MODEL = "claude-sonnet-5-5";
  assert.equal(VISION_MODEL(), "claude-sonnet-5-5");
  delete process.env.VIDEO_VISION_MODEL;
});

test("pickInPoints sends every frame as a base64 image block ahead of the prompt, at temperature 0, 90s timeout", async () => {
  const calls = claude(() => claudeOk({ frames: [{ i: 0, shows_subject: true, match: 4, score: 9 }, { i: 1, shows_subject: true, match: 9, score: 6 }], sensitive_any: false, reason: "ok" }));
  const r = await pickInPoints({ frames: FRAMES, subject: "Himalayas", caption: "c", clipTitle: "t" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.picks.map(p => p.t), [5], `a match below ${MIN_MATCH} is not a pick`);
  const { params, opts } = calls[0];
  assert.equal(params.model, "claude-haiku-5-5");
  assert.equal(params.temperature, 0);
  assert.equal(opts.timeout, 90000);
  const content = params.messages[0].content;
  assert.equal(content.length, 3);
  assert.deepEqual(content[0], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: Buffer.from("frame-a").toString("base64") } });
  assert.equal(content[1].source.data, Buffer.from("frame-b").toString("base64"));
  assert.equal(content[2].type, "text");
  assert.match(content[2].text, /Answer ONLY JSON/);
  assert.equal(r.usage.promptTokenCount, 3000);
});

test("judgePhoto sends one image block and returns usable only when every check passes", async () => {
  const calls = claude(() => claudeOk({ matches: true, match: 9, sensitive: false, screenshot: false, private_person: false, reason: "clear" }));
  const p = await judgePhoto({ jpeg: Buffer.from("photo"), subject: "Joint Base Andrews" });
  assert.equal(p.ok, true);
  assert.equal(p.usable, true);
  assert.equal(calls[0].params.messages[0].content.length, 2);
  claude(() => claudeOk({ matches: true, match: 9, sensitive: false, screenshot: true, private_person: false }));
  assert.equal((await judgePhoto({ jpeg: Buffer.from("photo"), subject: "x" })).usable, false);
});

test("FAILS CLOSED: a hard API error, an unparseable answer and a missing key all mean 'not verified'", async () => {
  claude(() => { throw Object.assign(new Error("denied"), { status: 403 }); });
  let v = await pickInPoints({ frames: FRAMES, subject: "x", caption: "y", clipTitle: "z" });
  assert.deepEqual([v.ok, v.sensitive, v.picks], [false, true, []]);
  _test.breaker.recordSuccess("anthropic");

  claude(() => ({ content: [{ type: "text", text: "I cannot tell" }], usage: {}, stop_reason: "end_turn" }));
  v = await pickInPoints({ frames: FRAMES, subject: "x", caption: "y", clipTitle: "z" });
  assert.equal(v.ok, false);
  assert.match(v.reason, /not JSON/);
  const p = await judgePhoto({ jpeg: Buffer.from("p"), subject: "x" });
  assert.deepEqual([p.ok, p.usable], [false, false]);

  _test.setAnthropicClient(null);
  delete process.env.ANTHROPIC_API_KEY; // llmQueue captured the key at import; the client seam is what gates here
  v = await pickInPoints({ frames: FRAMES, subject: "x", caption: "y", clipTitle: "z" });
  assert.equal(v.ok, false);
});
