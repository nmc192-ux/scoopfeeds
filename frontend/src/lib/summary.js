/** First `max` sentences of `text` (mirrors backend/src/routes/readerPayload.js). */
export function firstSentences(text, max = 3) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const parts = flat.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) || [flat];
  return parts.slice(0, max).join("").trim();
}
