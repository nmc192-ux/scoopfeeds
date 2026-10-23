/**
 * disclosure.js — how ScoopFeeds Radio tells viewers what it is, without an AI badge on screen (#208).
 *
 * DrJ, 22 Oct 2026: NO continuous AI label on screen, and do NOT tick YouTube's "altered or synthetic
 * content" setting. The stream must never contain what would require it (no AI-generated music, no voice
 * imitating a real person, no photorealistic synthetic imagery). Honest disclosure goes in three places:
 *   1. every broadcast's description (YouTube, via youtubeLive.js) and the X broadcast text;
 *   2. one spoken line in the top-of-hour station ID (STATION_ID_LINE, inserted mechanically, never written
 *      by the model, so it can never be dropped or paraphrased);
 *   3. the channel About (set by hand in YouTube Studio; same sentence, see docs/radio/safety.md).
 *
 * Changing this wording is stop-list item 5 (the AI-disclosure chain): it waits for DrJ.
 */

export const DISCLOSURE = "ScoopFeeds Radio is produced automatically from reporting by the outlets named on screen; bulletins are read by a synthetic voice.";

/** The spoken form: the same sentence, read as one line. */
export const STATION_ID_LINE = DISCLOSURE;   // the same wording, spoken (Kokoro reads the semicolon as a pause)
export const STATION_ID_LINE_ID = "station-id";

const YT_DESC_MAX = 5000;

/**
 * A broadcast description that always carries the disclosure and the music credits. The disclosure and
 * credits are never cut: when the whole is too long for YouTube, the free text is shortened instead.
 * @param {string} body      the editorial part ("One hour of world news...")
 * @param {string[]} credits the music library's exact credit lines for every track that may air
 */
export function withDisclosure(body = "", credits = [], { max = YT_DESC_MAX } = {}) {
  const clean = (s) => String(s || "").replace(/[<>]/g, "");   // YouTube rejects a description containing < or >
  const tail = [DISCLOSURE, credits.length ? ["Music:", ...credits.map(clean)].join("\n") : ""].filter(Boolean).join("\n\n");
  let text = clean(body);
  if (text.endsWith(tail)) text = text.slice(0, -tail.length);   // idempotent: a described body is not described twice
  text = text.replace(DISCLOSURE, "").trim();
  const room = max - tail.length - 2;
  if (room <= 0) return tail.slice(0, max);
  if (text.length > room) text = text.slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, "") + "…";
  return text ? `${text}\n\n${tail}` : tail;
}

export const hasDisclosure = (text) => String(text || "").includes(DISCLOSURE);

/**
 * The X broadcast text (X Media Studio > Producer: title and description are pasted there; there is no
 * API call). Kept under X's post limit with the disclosure always intact; credits follow when they fit,
 * else a pointer to the full list on YouTube.
 */
export function xBroadcastText({ title, credits = [], watchUrl = null, max = 4000 }) {
  const head = [String(title || "ScoopFeeds Radio LIVE").trim(), DISCLOSURE].join("\n\n");
  const full = credits.length ? `${head}\n\nMusic:\n${credits.join("\n")}` : head;
  if (full.length <= max) return full;
  const pointer = `${head}\n\nMusic credits: ${watchUrl || "in the YouTube broadcast description"}`;
  return pointer.slice(0, max);
}

/** Insert the station-ID line into The Hour, right after its "open" line (or first, if there is no open). */
export function withStationId(segments) {
  const seg = segments?.["the-hour"];
  if (!seg || !Array.isArray(seg.lines)) return segments;
  const lines = seg.lines.filter((l) => l.id !== STATION_ID_LINE_ID);
  const at = lines.findIndex((l) => l.id === "open");
  lines.splice(at >= 0 ? at + 1 : 0, 0, { id: STATION_ID_LINE_ID, story: null, text: STATION_ID_LINE, mechanical: true });
  return { ...segments, "the-hour": { ...seg, lines } };
}

// ── #208 item 11: titles and descriptions are factual ──
const CLICKBAIT = [
  [/\bbreaking\b/i, "\"BREAKING\" (the radio's titles are scheduled hours, not breaking alerts)"],
  [/\b(shocking|you won'?t believe|must[- ]see|insane|unbelievable|jaw[- ]dropping|gone wrong|exposed|destroys?|slams?)\b/i, "clickbait wording"],
  [/[!?]{2,}|!/, "an exclamation mark"],
  [/\b(urgent|alert)\b/i, "alarm wording"],
  [/(\b[A-Z]{5,}\b.*){2,}/, "shouting capitals"],
];
/** Problems with a broadcast title (empty = factual enough to publish). "LIVE" is the platform's convention, allowed. */
export function titleProblems(title) {
  const t = String(title || "").replace(/\bLIVE\b/g, "live").replace(/\bScoopFeeds\b/g, "");
  return CLICKBAIT.filter(([re]) => re.test(t)).map(([, why]) => why);
}
/** The title if it is factual, else the safe default (and the reasons, for the log). */
export function factualTitle(title, fallback) {
  const why = titleProblems(title);
  return why.length ? { title: fallback, replaced: true, why } : { title, replaced: false, why };
}
