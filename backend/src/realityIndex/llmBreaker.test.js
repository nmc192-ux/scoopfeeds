import test from "node:test";
import assert from "node:assert/strict";
import { createBreaker } from "./llmBreaker.js";
import { estimateCostUsd, _resetPricingWarnings, LLM_PRICES } from "./llmPricing.js";

function harness(opts = {}) {
  let t = 1_000_000;
  const lines = [];
  const b = createBreaker({ now: () => t, logger: { warn: (m) => lines.push(m) }, ...opts });
  return { b, lines, advance: (ms) => { t += ms; } };
}

test("breaker: opens after 3 consecutive hard failures, not before", () => {
  const { b, lines } = harness();
  b.recordHardFailure("anthropic", "auth 401");
  b.recordHardFailure("anthropic", "auth 401");
  assert.equal(b.isOpen("anthropic"), false);
  b.recordHardFailure("anthropic", "auth 401");
  assert.equal(b.isOpen("anthropic"), true);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /OPEN for anthropic.*3 consecutive hard failures.*auth 401/);
});

test("breaker: a success resets the consecutive count", () => {
  const { b } = harness();
  b.recordHardFailure("gemini", "x"); b.recordHardFailure("gemini", "x");
  b.recordSuccess("gemini");
  b.recordHardFailure("gemini", "x"); b.recordHardFailure("gemini", "x");
  assert.equal(b.isOpen("gemini"), false);
});

test("breaker: stays open ~15 minutes, then allows a probe; probe success closes it with one CLOSED line", () => {
  const { b, lines, advance } = harness();
  for (let i = 0; i < 3; i++) b.recordHardFailure("anthropic", "billing 402");
  advance(14 * 60_000);
  assert.equal(b.isOpen("anthropic"), true);
  advance(61_000);
  assert.equal(b.isOpen("anthropic"), false, "cooldown elapsed → probe allowed");
  b.recordSuccess("anthropic");
  assert.equal(lines.length, 2);
  assert.match(lines[1], /CLOSED for anthropic/);
  b.recordSuccess("anthropic"); // already closed: silent
  assert.equal(lines.length, 2);
});

test("breaker: a failed probe re-opens for another full cooldown", () => {
  const { b, lines, advance } = harness();
  for (let i = 0; i < 3; i++) b.recordHardFailure("anthropic", "auth");
  advance(15 * 60_000 + 1);
  assert.equal(b.isOpen("anthropic"), false);
  b.recordHardFailure("anthropic", "auth still bad");
  assert.equal(b.isOpen("anthropic"), true);
  assert.match(lines.at(-1), /RE-OPENED for anthropic.*auth still bad/);
  advance(14 * 60_000);
  assert.equal(b.isOpen("anthropic"), true);
});

test("breaker: providers are independent", () => {
  const { b } = harness();
  for (let i = 0; i < 3; i++) b.recordHardFailure("anthropic", "x");
  assert.equal(b.isOpen("gemini"), false);
});

test("pricing: haiku-5-5 short and long-prompt tiers; gemini rates", () => {
  _resetPricingWarnings();
  assert.ok(Math.abs(estimateCostUsd("anthropic", "claude-haiku-5-5", 100_000, 100_000) - 0.06) < 1e-9); // at the threshold: short tier
  assert.ok(Math.abs(estimateCostUsd("anthropic", "claude-haiku-5-5", 200_000, 10_000) - (0.2 * 0.5 + 0.01 * 2.5)) < 1e-9);
  assert.ok(Math.abs(estimateCostUsd("gemini", "gemini-3.1-flash-lite", 1_000_000, 1_000_000) - 1.75) < 1e-9);
  assert.ok(Math.abs(estimateCostUsd("gemini", "gemini-3.5-flash", 1_000_000, 1_000_000) - 10.5) < 1e-9);
  assert.equal(LLM_PRICES.anthropic["claude-haiku-5-5"].cacheRead, 0.01);
});

test("pricing: unknown model or unknown tokens → null; warns once per model", () => {
  _resetPricingWarnings();
  const lines = [];
  const logger = { warn: (m) => lines.push(m) };
  assert.equal(estimateCostUsd("gemini", "gemini-9", 10, 10, { logger }), null);
  assert.equal(estimateCostUsd("gemini", "gemini-9", 10, 10, { logger }), null);
  assert.equal(lines.length, 1);
  assert.equal(estimateCostUsd("gemini", "gemini-3.1-flash-lite", null, null, { logger }), null);
  assert.equal(lines.length, 1);
});
