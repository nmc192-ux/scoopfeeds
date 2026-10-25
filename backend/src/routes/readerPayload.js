/**
 * What /api/reader is allowed to send to a client.
 *
 * Extraction still runs server-side (Readability, meta fallback), but the body never
 * leaves the process: readers get a headline, outlet, a summary of at most
 * MAX_SUMMARY_SENTENCES sentences, and the link out. See issue #176.
 */
export const MAX_SUMMARY_SENTENCES = 3;

/** First `max` sentences of `text`, whitespace collapsed. Empty string if none. */
export function firstSentences(text, max = MAX_SUMMARY_SENTENCES) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const parts = flat.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) || [flat];
  return parts.slice(0, max).join("").trim();
}

/** Allow-list copy of an extraction result: no content, no textContent. */
export function toPublicReaderPayload(p) {
  return {
    title:         p.title || null,
    byline:        p.byline || null,
    siteName:      p.siteName || null,
    excerpt:       firstSentences(p.excerpt) || null,
    publishedTime: p.publishedTime || null,
    lang:          p.lang || null,
    url:           p.url,
  };
}
