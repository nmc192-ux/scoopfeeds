/**
 * incidentIntake.js — a pasted post URL becomes a named lane, or it is refused.
 * Pure: parses strings, touches no network and no database.
 *
 * WHY AN UNRECOGNISED URL IS REFUSED RATHER THAN STORED AS "unknown". Brief §3:
 * any acquisition that cannot name its lane does not happen. A row with
 * platform="unknown" is a candidate nobody can decide about — its rights lane is
 * unknown, its ToS position is unknown, and it would sit in the queue forever or,
 * worse, get waved through on the assumption that somebody upstream knew. So the
 * parse is the first gate, and it fails loudly with the URL it could not place.
 *
 * CANONICALISATION IS REBUILT FROM IDENTITY, NOT STRIPPED FROM THE INPUT. Every
 * matcher extracts the platform's own identity fields and composes a fresh URL
 * from them. That is what makes `twitter.com/x/status/1?s=20&t=abc` and
 * `https://www.X.com/X/STATUS/1` collapse to one string, and the collapse is
 * what makes `media_candidates.post_url UNIQUE` a real dedupe rather than a
 * dedupe of exact-match pastes. Strip-the-query would have left both rows.
 *
 * MEDIA TYPE IS OFTEN UNKNOWN AND SAYS SO. Only some URL shapes carry it (a
 * TikTok /video/, an Instagram /reel/). Guessing "video" because most incident
 * media is video would put a guess in a column the ledger treats as fact, so
 * unknown is returned and the operator states it at intake.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: fetch anything. Not the post, not a
 * redirect, not an oEmbed. Poster display names and true media types need the
 * platform's API and belong to whichever phase actually calls it. A shortened
 * link therefore cannot be canonicalised here and is refused with that reason,
 * rather than resolved by a network call hiding inside a parser.
 */

/** Lanes this engine can name. Anything else is refused at intake. */
export const PLATFORMS = Object.freeze([
  "bluesky", "mastodon", "reddit", "x", "instagram", "tiktok", "youtube",
]);

/** What we may know about the media from the URL alone. */
export const MEDIA_TYPES = Object.freeze(["video", "photo", "unknown"]);

export class IntakeRefusedError extends Error {
  constructor(message, { url, reason } = {}) {
    super(message);
    this.name = "IntakeRefusedError";
    this.url = url;
    this.reason = reason;
  }
}

/** Hosts that only ever redirect. Resolving them needs a fetch; see the header. */
const SHORTENERS = /^(vm\.tiktok\.com|vt\.tiktok\.com|redd\.it|t\.co|fb\.watch|bit\.ly|tinyurl\.com)$/i;

const stripHostPrefix = (h) => h.replace(/^(www|m|mobile)\./i, "");

/**
 * Each matcher gets the parsed URL and returns the candidate's identity, or null
 * if this is not its platform. Order does not matter — the shapes are disjoint.
 */
const MATCHERS = [
  // https://bsky.app/profile/<handle>/post/<rkey>
  (u, host, seg) => {
    if (host !== "bsky.app" || seg[0] !== "profile" || seg[2] !== "post" || !seg[1] || !seg[3]) return null;
    const handle = seg[1].toLowerCase();
    return {
      platform: "bluesky",
      posterHandle: handle,
      mediaType: "unknown",
      canonicalUrl: `https://bsky.app/profile/${handle}/post/${seg[3]}`,
    };
  },

  // https://x.com/<handle>/status/<id>  (twitter.com folds into x.com)
  (u, host, seg) => {
    if (host !== "x.com" && host !== "twitter.com") return null;
    if (seg[1] !== "status" || !seg[0] || !/^\d+$/.test(seg[2] || "")) return null;
    const handle = seg[0].toLowerCase();
    return {
      platform: "x",
      posterHandle: handle,
      mediaType: "unknown",
      canonicalUrl: `https://x.com/${handle}/status/${seg[2]}`,
    };
  },

  // https://www.tiktok.com/@<handle>/video/<id>
  (u, host, seg) => {
    if (host !== "tiktok.com" || !seg[0]?.startsWith("@") || seg[1] !== "video" || !/^\d+$/.test(seg[2] || "")) return null;
    const handle = seg[0].slice(1).toLowerCase();
    return {
      platform: "tiktok",
      posterHandle: handle,
      // TikTok's /video/ path is video by definition — the one place the URL
      // states the type rather than implying it.
      mediaType: "video",
      canonicalUrl: `https://www.tiktok.com/@${handle}/video/${seg[2]}`,
    };
  },

  // https://www.instagram.com/{p|reel|tv}/<code>/   — the handle is not in the URL
  (u, host, seg) => {
    if (host !== "instagram.com" || !["p", "reel", "tv"].includes(seg[0]) || !seg[1]) return null;
    return {
      platform: "instagram",
      posterHandle: null,
      // A reel is video; a /p/ post may be either and is not guessed at.
      mediaType: seg[0] === "p" ? "unknown" : "video",
      canonicalUrl: `https://www.instagram.com/${seg[0]}/${seg[1]}/`,
    };
  },

  // https://www.reddit.com/r/<sub>/comments/<id>/<slug>  — no handle in the URL
  (u, host, seg) => {
    if (host !== "reddit.com" || seg[0] !== "r" || seg[2] !== "comments" || !seg[1] || !seg[3]) return null;
    return {
      platform: "reddit",
      posterHandle: null,
      mediaType: "unknown",
      // The slug is decoration; the subreddit and the post id are the identity.
      canonicalUrl: `https://www.reddit.com/r/${seg[1]}/comments/${seg[3]}/`,
    };
  },

  // https://www.youtube.com/watch?v=<id> · youtu.be/<id> · youtube.com/shorts/<id>
  (u, host, seg) => {
    let id = null;
    if (host === "youtube.com") {
      if (seg[0] === "watch") id = u.searchParams.get("v");
      else if (seg[0] === "shorts" && seg[1]) id = seg[1];
    } else if (host === "youtu.be" && seg[0]) {
      id = seg[0];
    }
    if (!id) return null;
    return {
      platform: "youtube",
      posterHandle: null,
      mediaType: "video",
      canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
    };
  },

  // Mastodon is federated, so there is no host list — the shape is the signal:
  // https://<instance>/@<user>/<numeric status id>. The numeric id is what keeps
  // this from swallowing every /@handle/ vanity path on the web.
  (u, host, seg) => {
    if (!seg[0]?.startsWith("@") || !/^\d+$/.test(seg[1] || "") || seg.length !== 2) return null;
    const user = seg[0].slice(1).toLowerCase();
    if (!user) return null;
    return {
      platform: "mastodon",
      // Fully-qualified: a bare @user is ambiguous across instances, and the
      // instance is part of who this person is.
      posterHandle: `${user}@${host}`,
      mediaType: "unknown",
      canonicalUrl: `https://${host}/@${user}/${seg[1]}`,
    };
  },
];

/**
 * Parse a pasted post URL into a named lane.
 *
 * @throws {IntakeRefusedError} on anything it cannot place. The message names
 *   the URL and the reason, because this error is shown to the operator.
 */
export function parsePostUrl(raw) {
  const input = String(raw ?? "").trim();
  if (!input) {
    throw new IntakeRefusedError("no URL given", { url: input, reason: "empty" });
  }

  let u;
  try {
    u = new URL(input);
  } catch {
    throw new IntakeRefusedError(`"${input.slice(0, 120)}" is not a URL`, { url: input, reason: "unparseable" });
  }

  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new IntakeRefusedError(
      `${u.protocol} is not a web URL — paste the post's page address`,
      { url: input, reason: "bad-protocol" }
    );
  }

  const rawHost = u.hostname.toLowerCase();
  if (SHORTENERS.test(rawHost)) {
    throw new IntakeRefusedError(
      `${rawHost} is a link shortener — paste the full post URL instead. ` +
      "Resolving it here would mean this parser making a network call, and following a redirect " +
      "to a place we have not named is how an unnamed lane gets in.",
      { url: input, reason: "shortener" }
    );
  }

  const host = stripHostPrefix(rawHost);
  const seg = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  for (const match of MATCHERS) {
    const hit = match(u, host, seg);
    if (hit) return { ...hit, sourceUrl: input };
  }

  throw new IntakeRefusedError(
    `${rawHost} is not a platform this engine has a lane for (${PLATFORMS.join(", ")}). ` +
    "A candidate whose lane cannot be named cannot be cleared, so it is refused rather than stored.",
    { url: input, reason: "unknown-platform" }
  );
}

/**
 * Platforms whose media may NOT be fetched by us even when the post is public.
 *
 * This is a statement about the acquisition lane, NOT about whether a candidate
 * may exist: an X or TikTok post is a perfectly good candidate, it just has to
 * reach us as a file the poster sent (Lane 2). Recording the distinction here,
 * beside the parser, is deliberate — it is the fact most likely to be forgotten
 * by a future phase that adds a downloader.
 */
export const FETCH_CLOSED_PLATFORMS = Object.freeze(["x", "instagram", "tiktok", "youtube"]);

/** True when we may not acquire the file ourselves and must ask the poster. */
export const requiresPosterSuppliedFile = (platform) => FETCH_CLOSED_PLATFORMS.includes(platform);
