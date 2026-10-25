import test from "node:test";
import assert from "node:assert/strict";
import { firstSentences, toPublicReaderPayload } from "./readerPayload.js";

test("firstSentences caps at three sentences", () => {
  const out = firstSentences("One. Two! Three? Four. Five.");
  assert.equal(out, "One. Two! Three?");
});

test("firstSentences handles empty and unpunctuated input", () => {
  assert.equal(firstSentences(""), "");
  assert.equal(firstSentences(null), "");
  assert.equal(firstSentences("no punctuation here"), "no punctuation here");
});

test("public payload carries no body field", () => {
  const out = toPublicReaderPayload({
    title: "T", byline: "B", siteName: "S", url: "https://x.test/a",
    excerpt: "A. B. C. D.",
    content: "<p>full body</p>", textContent: "full body", length: 9000,
  });
  assert.equal(out.excerpt, "A. B. C.");
  for (const k of ["content", "textContent", "length", "html"]) {
    assert.ok(!(k in out), `${k} must not be exposed`);
  }
  assert.ok(!JSON.stringify(out).includes("full body"));
});
