/**
 * broadcastCopy.js — the words ScoopFeeds Radio publishes around its streams (#208): YouTube descriptions,
 * the X broadcast text, the music credits in both, and factual titles.
 *
 * DrJ, 22 Oct 2026: no continuous AI label on screen, and YouTube's "altered or synthetic content" setting is
 * never sent. DrJ, 23 Oct 2026 (stop-list item 5, PR #214): no disclosure sentence either: not in descriptions,
 * not in the X text, not spoken in the station ID. This covers the radio only; the long-form film disclosure
 * chain (longformQcGate.js) is unchanged. Reintroducing any disclosure wording here is stop-list item 5.
 *
 * Music credits (CC BY 4.0) are never cut mid-credit (DrJ, 25 Oct 2026). When every credit does not fit, whole
 * credits are left out and a link to the full list (RADIO_MUSIC_CREDITS_URL) is added; with no link, it throws
 * rather than publish an incomplete attribution. CC BY 4.0 §3(a)(2) allows attribution by such a link.
 */

export const YT_DESC_MAX = 5000;
export const X_TEXT_MAX = 4000;

/** Thrown when the credits cannot be published complete: too long for the limit and no credits page to link. */
export class CreditsDoNotFit extends Error {
  constructor(n, max) { super(`${n} music credit(s) do not fit in ${max} characters and RADIO_MUSIC_CREDITS_URL is not set; refusing to publish incomplete attribution`); this.name = "CreditsDoNotFit"; }
}

const clean = (s) => String(s || "").replace(/[<>]/g, "");   // YouTube rejects a description containing < or >

/**
 * The credits block that fits in `room` characters: every credit whole, or as many whole credits as fit plus
 * the link to the full list. `listAll: false` gives the link alone (the 24/7 stream, whose library is large).
 * Returns null when nothing honest fits.
 */
function creditsBlock(credits, room, { creditsUrl = null, listAll = true } = {}) {
  const list = credits.map(clean).filter(Boolean);
  if (!list.length) return "";
  const link = creditsUrl ? `Music credits: ${clean(creditsUrl)}` : null;
  const sep = list.some((c) => c.includes("\n")) ? "\n\n" : "\n";   // multi-line library credits stay visibly apart
  const join = (xs) => ["Music:", ...xs].join(sep);
  const full = join(list) + (link ? `\n\n${link}` : "");
  if (listAll && full.length <= room) return full;
  if (!link) return null;
  if (listAll) {
    for (let n = list.length - 1; n >= 1; n--) {
      const part = join(list.slice(0, n)) + `\n\n${link.replace("Music credits:", "All music credits:")}`;
      if (part.length <= room) return part;
    }
  }
  return link.length <= room ? link : null;
}

/**
 * A broadcast description: the editorial body, then the music credits. Credits are never cut; when the whole is
 * too long, the free text is shortened first, then whole credits give way to the link, else CreditsDoNotFit.
 * @param {string} body      the editorial part ("One hour of world news...")
 * @param {string[]} credits the music library's exact credit lines (the tracks that aired, or may air)
 */
export function withCredits(body = "", credits = [], { max = YT_DESC_MAX, creditsUrl = null, listAll = true } = {}) {
  let text = clean(body).trim();
  const MIN_BODY = Math.min(text.length, 200);   // the body keeps at least its first ~200 characters
  const block = creditsBlock(credits, max - (MIN_BODY ? MIN_BODY + 2 : 0), { creditsUrl, listAll });
  if (block === null) throw new CreditsDoNotFit(credits.length, max);
  if (!block) return text.length > max ? text.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : text;
  const room = max - block.length - 2;
  if (text.length > room) text = text.slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, "") + "…";
  return text ? `${text}\n\n${block}` : block;
}

/**
 * The X broadcast text (X Media Studio > Producer: pasted by hand; there is no API call). Same credit rule as
 * YouTube: whole credits or the link, never a cut credit.
 */
export function xBroadcastText({ title, credits = [], creditsUrl = null, max = X_TEXT_MAX, listAll = true }) {
  return withCredits(String(title || "ScoopFeeds Radio LIVE").trim(), credits, { max, creditsUrl, listAll });
}

/** Every credit in `credits` appears whole in `text` (or the text links the full list). For tests and the generator. */
export function creditsComplete(text, credits, creditsUrl = null) {
  const shown = credits.map(clean).filter((c) => text.includes(c));
  return shown.length === credits.length || Boolean(creditsUrl && text.includes(clean(creditsUrl)));
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
