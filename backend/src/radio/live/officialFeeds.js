/**
 * officialFeeds.js - the ONLY live feeds the radio may put on air (#202).
 *
 * DrJ's decision, 22 Oct 2026: carry live events and speeches only from official, public feeds,
 * published by the body or person themselves (White House, US House and Senate floor, UN Web TV,
 * NASA, government channels, candidates' and campaigns' own streams). NEVER re-air another
 * broadcaster's live feed (CNN, Al Jazeera, BBC, ...): a copyright claim on the 24/7 stream could
 * suspend the channel again.
 *
 * Rules for this file:
 *   - DrJ adds entries. The engine may PROPOSE entries in a PR; it never adds one silently.
 *   - Every entry says who publishes it and why it is allowed.
 *   - A feed that does not resolve to an entry here cannot go to air (assertCanAir throws).
 *     There is no override flag, on purpose.
 *
 * Matching:
 *   - `pages`: https host + path prefix (path matched on segment boundaries; "www." and "m." ignored).
 *   - `youtube`: channel handles. A youtube.com/@Handle/... URL matches by its path; a watch?v= URL
 *     matches only once the pre-air probe (feedProbe.js) reports the uploader's handle or channel URL,
 *     because a video id alone does not say whose stream it is.
 */

const DRJ_202 = "DrJ, #202 decision, 22 Oct 2026";

export const OFFICIAL_FEEDS = Object.freeze([
  {
    id: "nasa", publisher: "NASA",
    youtube: ["@NASA"], pages: ["nasa.gov/", "plus.nasa.gov/"],
    why: "NASA's own channels: launches, spacewalks, briefings. US government work, published by NASA.",
    addedBy: DRJ_202,
  },
  {
    id: "un-webtv", publisher: "United Nations",
    youtube: ["@UnitedNations"], pages: ["webtv.un.org/"],
    why: "UN Web TV and the UN's own YouTube channel: General Assembly, Security Council, briefings.",
    addedBy: DRJ_202,
  },
  {
    id: "white-house", publisher: "The White House",
    youtube: ["@WhiteHouse"], pages: ["whitehouse.gov/live", "whitehouse.gov/videos"],
    why: "The White House's own stream of briefings and remarks.",
    addedBy: DRJ_202,
  },
  {
    id: "us-house", publisher: "US House of Representatives",
    youtube: [], pages: ["live.house.gov/"],
    why: "The House Clerk's own floor feed.",
    addedBy: DRJ_202,
  },
  {
    id: "us-senate", publisher: "US Senate",
    youtube: [], pages: ["senate.gov/"],
    why: "The Senate's own floor proceedings feed.",
    addedBy: DRJ_202,
  },
  // Candidates' and campaigns' own streams: DrJ adds each one here (handle + why) before it can air.
]);

/** Broadcasters whose live feeds must never air, whatever an entry above says. Belt and braces. */
export const NEVER_AIR_HOSTS = Object.freeze([
  "cnn.com", "aljazeera.com", "aljazeera.net", "bbc.com", "bbc.co.uk", "foxnews.com", "msnbc.com",
  "nbcnews.com", "cbsnews.com", "abcnews.go.com", "skynews.com", "news.sky.com", "reuters.com",
  "apnews.com", "bloomberg.com", "cnbc.com", "france24.com", "dw.com", "c-span.org",
]);

const YT_HOSTS = new Set(["youtube.com", "youtu.be", "youtube-nocookie.com"]);

export function normHost(host) {
  return String(host || "").toLowerCase().replace(/\.$/, "").replace(/^(www\.|m\.)/, "");
}

function parse(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== "https:") return null;
    return u;
  } catch { return null; }
}

function hostMatches(host, entryHost) {
  return host === entryHost;
}

function pathPrefixMatches(pathname, prefix) {
  if (prefix === "" || prefix === "/") return true;
  const p = pathname.toLowerCase(), pre = prefix.toLowerCase();
  if (pre.endsWith("/")) return p.startsWith(pre) || p === pre.slice(0, -1);
  return p === pre || p.startsWith(pre + "/");
}

export function isNeverAirHost(url) {
  const u = parse(url);
  if (!u) return false;
  const h = normHost(u.hostname);
  return NEVER_AIR_HOSTS.some((b) => h === b || h.endsWith("." + b));
}

/** The handle in a youtube.com/@Handle/... path, lower-cased with its "@", or null. */
export function youtubeHandleOf(url) {
  const u = parse(url);
  if (!u || !YT_HOSTS.has(normHost(u.hostname))) return null;
  const m = u.pathname.match(/^\/(@[A-Za-z0-9._-]+)(\/|$)/);
  return m ? m[1].toLowerCase() : null;
}

/**
 * The allow-list entry a URL belongs to, by the URL alone (no network). null if none.
 * `probe` (optional): feedProbe's result for this URL; its uploaderHandle / channelUrl let a
 * watch?v= URL resolve to a YouTube entry.
 */
export function entryForUrl(url, { probe = null, feeds = OFFICIAL_FEEDS } = {}) {
  const u = parse(url);
  if (!u) return null;
  if (isNeverAirHost(url)) return null;
  const host = normHost(u.hostname);
  if (YT_HOSTS.has(host)) {
    const handles = [youtubeHandleOf(url), probe?.uploaderHandle?.toLowerCase(), youtubeHandleOf(probe?.channelUrl || "")]
      .filter(Boolean);
    // A probe that names a different channel than the URL path wins as a refusal: both must agree.
    if (handles.length > 1 && new Set(handles).size > 1) return null;
    const h = handles[0];
    if (!h) return null;
    return feeds.find((f) => (f.youtube || []).some((x) => x.toLowerCase() === h)) || null;
  }
  for (const f of feeds) {
    for (const page of f.pages || []) {
      const slash = page.indexOf("/");
      const eHost = normHost(slash < 0 ? page : page.slice(0, slash));
      const ePath = slash < 0 ? "/" : page.slice(slash);
      if (hostMatches(host, eHost) && pathPrefixMatches(u.pathname, ePath)) return f;
    }
  }
  return null;
}

export function feedById(id, feeds = OFFICIAL_FEEDS) {
  return feeds.find((f) => f.id === id) || null;
}

/**
 * The single on-air gate. Throws unless ALL hold:
 *   - `entryId` is on the allow-list,
 *   - `url` resolves to that same entry (by URL, or by the probe's channel for a watch?v= URL),
 *   - the pre-air probe ran and passed (public, live, plays without a login).
 * Returns the entry.
 */
export function assertCanAir({ entryId, url, probe }, { feeds = OFFICIAL_FEEDS } = {}) {
  const entry = feedById(entryId, feeds);
  if (!entry) throw new Error(`live feed refused: "${entryId}" is not on the official-feeds allow-list`);
  if (isNeverAirHost(url)) throw new Error(`live feed refused: ${url} is another broadcaster's feed`);
  const byUrl = entryForUrl(url, { probe, feeds });
  if (!byUrl) throw new Error(`live feed refused: ${url} is not on the official-feeds allow-list`);
  if (byUrl.id !== entry.id) throw new Error(`live feed refused: ${url} belongs to "${byUrl.id}", not "${entry.id}"`);
  // An official page that embeds a YouTube stream from a channel not on this entry is refused:
  // the page is theirs, the stream may not be.
  const h = probe?.uploaderHandle?.toLowerCase();
  if (h && !(entry.youtube || []).some((x) => x.toLowerCase() === h)) {
    throw new Error(`live feed refused: ${url} plays a stream from ${probe.uploaderHandle}, which is not on "${entry.id}"`);
  }
  if (!probe || probe.ok !== true) {
    throw new Error(`live feed refused: pre-air check ${probe ? `failed (${probe.reason})` : "did not run"} for ${url}`);
  }
  return entry;
}
