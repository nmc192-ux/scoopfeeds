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
 *
 * #223 field:
 *   - `proposed: true`: an entry the ENGINE proposed and DrJ has not yet approved. assertCanAir refuses
 *     it, the publisher-schedule fetch skips it, and `cli.js feeds` marks it PROPOSED. DrJ approves an
 *     entry by deleting its `proposed` line (and setting `addedBy`); striking one means deleting it.
 */

const DRJ_202 = "DrJ, #202 decision, 22 Oct 2026";
const PROPOSED_223 = "PROPOSED (engine), awaiting DrJ";

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
    // DrJ, 25 Oct 2026 (PR #211): the floor-proceedings stream page ONLY, never "any page on senate.gov".
    // Empty until the exact page is confirmed on the Mac (PR #211 test step 7) and DrJ adds it here,
    // so the Senate cannot air yet. Committee and member pages are not covered.
    youtube: [], pages: [],
    why: "The Senate's own floor proceedings feed (floor page only; exact page to be confirmed).",
    addedBy: "DrJ, #202 decision 22 Oct 2026; narrowed to the floor page 25 Oct 2026",
  },
  // Candidates' and campaigns' own streams: DrJ adds each one here (handle + why) before it can air.
  //
  // ── #223 (DrJ, 25 Oct 2026): election night 3 Nov, campaigns' OWN streams for victory and concession
  //    speeches. Everything below is PROPOSED by the engine and CANNOT AIR (`proposed: true`) until DrJ
  //    removes that flag, entry by entry, before 2 Nov. Races: Ballotpedia's 12 Senate and 7 governor
  //    battlegrounds. Each handle was read, on 25 Oct 2026, as a link on the campaign's own website (the
  //    page carrying its "Paid for by" line), via a fetch tool that summarises pages: re-check each one
  //    in a browser before approving. Candidates whose site links no channel, or links one only by a
  //    channel id / legacy URL (no @handle), are left OUT: see docs/radio/campaign-feeds-223.md.
  {
    id: "moody-campaign", publisher: "Ashley Moody campaign", proposed: true,
    youtube: ["@AshleyMoodyFL"], pages: [],
    why: "Florida Senate (special), Republican incumbent. Handle linked from the campaign's own site: https://ashleymoody.com/about/ (footer).",
    addedBy: PROPOSED_223,
  },
  {
    id: "nixon-campaign", publisher: "Angie Nixon campaign", proposed: true,
    youtube: ["@AngieForFL"], pages: [],
    why: "Florida Senate (special), Democratic nominee. Handle linked from the campaign's own site: https://angienixon.com/state-rep-angie-nixon-launchescampaign-for-u-s-senate/ (header, social row).",
    addedBy: PROPOSED_223,
  },
  {
    id: "turek-campaign", publisher: "Josh Turek campaign", proposed: true,
    youtube: ["@JoshTurek4Iowa"], pages: [],
    why: "Iowa Senate, Democratic nominee. Handle linked from the campaign's own site: https://turek4iowa.com/ (Meet Josh, footer).",
    addedBy: PROPOSED_223,
  },
  {
    id: "collins-me-campaign", publisher: "Susan Collins campaign", proposed: true,
    youtube: ["@susancollins4senator"], pages: [],
    why: "Maine Senate, Republican incumbent. Handle linked from the campaign's own site: https://susancollins.com/ (header and footer).",
    addedBy: PROPOSED_223,
  },
  {
    id: "jackson-me-campaign", publisher: "Troy Jackson campaign", proposed: true,
    youtube: ["@troyjacksonformaine"], pages: [],
    why: "Maine Senate, Democratic nominee. Handle linked from the campaign's own site: https://www.jacksonformaine.com/ (header, footer).",
    addedBy: PROPOSED_223,
  },
  {
    id: "rogers-mi-campaign", publisher: "Mike Rogers campaign", proposed: true,
    youtube: ["@MikeRogersForMI"], pages: [],
    why: "Michigan Senate, Republican nominee. Handle linked from the campaign's own site: https://rogersforsenate.com/meet-mike (header, menu, footer).",
    addedBy: PROPOSED_223,
  },
  {
    id: "alme-campaign", publisher: "Kurt Alme campaign", proposed: true,
    youtube: ["@almeforsenate"], pages: [],
    why: "Montana Senate, Republican nominee. Handle linked from the campaign's own site: https://almeforsenate.com/ (footer).",
    addedBy: PROPOSED_223,
  },
  {
    id: "bankhead-campaign", publisher: "Alani Bankhead campaign", proposed: true,
    youtube: ["@montanamatters"], pages: [],
    why: "Montana Senate, Democratic nominee. The channel name is not hers: her press kit calls it \"the campaign's YouTube channel\". Handle linked from the campaign's own site: https://alaniformt.com/press-kit and https://alaniformt.com/ (Watch on YouTube).",
    addedBy: PROPOSED_223,
  },
  {
    id: "bodnar-campaign", publisher: "Seth Bodnar campaign", proposed: true,
    youtube: ["@SethForMontana"], pages: [],
    why: "Montana Senate, independent. Handle linked from the campaign's own site: https://www.sethformontana.com/ (header and footer).",
    addedBy: PROPOSED_223,
  },
  {
    id: "ricketts-campaign", publisher: "Pete Ricketts campaign", proposed: true,
    youtube: ["@rickettsforsenate"], pages: [],
    why: "Nebraska Senate, Republican incumbent. Handle linked from the campaign's own site: https://petericketts.com/news/ (footer; homepage not read).",
    addedBy: PROPOSED_223,
  },
  {
    id: "sununu-campaign", publisher: "John Sununu campaign", proposed: true,
    youtube: ["@sununusenator"], pages: [],
    why: "New Hampshire Senate, Republican nominee. Handle linked from the campaign's own site: https://www.sununusenator.com/ (header and footer).",
    addedBy: PROPOSED_223,
  },
  {
    id: "pappas-campaign", publisher: "Chris Pappas campaign", proposed: true,
    youtube: ["@ChrisPappasNH"], pages: [],
    why: "New Hampshire Senate, Democratic nominee. Handle linked from the campaign's own site: https://chrispappas.org/ (header and footer).",
    addedBy: PROPOSED_223,
  },
  {
    id: "husted-campaign", publisher: "Jon Husted campaign", proposed: true,
    youtube: ["@jonhustedforsenate"], pages: [],
    why: "Ohio Senate (special), Republican incumbent. Handle linked from the campaign's own site: https://www.jonhustedforsenate.com/author/hustedohsenate/ (sitewide social row; homepage not read).",
    addedBy: PROPOSED_223,
  },
  {
    id: "talarico-campaign", publisher: "James Talarico campaign", proposed: true,
    youtube: ["@JamesTalaricoTX"], pages: [],
    why: "Texas Senate, Democratic nominee. Handle linked from the campaign's own site: https://jamestalarico.com/ (footer).",
    addedBy: PROPOSED_223,
  },
  {
    id: "becerra-campaign", publisher: "Xavier Becerra campaign", proposed: true,
    youtube: ["@becerraforgovernor"], pages: [],
    why: "California governor, Democrat (top-two). Handle linked from the campaign's own site: https://www.xavierbecerra2026.com/bio/ (header and footer).",
    addedBy: PROPOSED_223,
  },
  {
    id: "sand-campaign", publisher: "Rob Sand campaign", proposed: true,
    youtube: ["@robsandia"], pages: [],
    why: "Iowa governor, Democratic nominee. Handle linked from the campaign's own site: https://robsand.com/about/.",
    addedBy: PROPOSED_223,
  },
  {
    id: "lahn-campaign", publisher: "Zach Lahn campaign", proposed: true,
    youtube: ["@ZachLahnforGovernor"], pages: [],
    why: "Iowa governor, Republican nominee. Handle linked from the campaign's own site: https://zachlahn.com/ (Follow Zach footer).",
    addedBy: PROPOSED_223,
  },
  {
    id: "benson-campaign", publisher: "Jocelyn Benson campaign", proposed: true,
    youtube: ["@BensonforGovernor"], pages: [],
    why: "Michigan governor, Democratic nominee. Handle linked from the campaign's own site: https://www.jocelynbenson.com/.",
    addedBy: PROPOSED_223,
  },
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

/** #223: an entry the engine proposed and DrJ has not approved yet. It cannot air. */
export function isProposed(entry) {
  return Boolean(entry) && entry.proposed !== undefined && entry.proposed !== false;
}

/**
 * The single on-air gate. Throws unless ALL hold:
 *   - `entryId` is on the allow-list,
 *   - `url` resolves to that same entry (by URL, or by the probe's channel for a watch?v= URL),
 *   - the entry is not `proposed` (#223),
 *   - the pre-air probe ran and passed (public, live, plays without a login).
 * Returns the entry.
 */
export function assertCanAir({ entryId, url, probe }, { feeds = OFFICIAL_FEEDS } = {}) {
  const entry = feedById(entryId, feeds);
  if (!entry) throw new Error(`live feed refused: "${entryId}" is not on the official-feeds allow-list`);
  // #223: a proposed entry is not on the list yet. DrJ approves it by removing `proposed`. No override.
  if (isProposed(entry)) throw new Error(`live feed refused: "${entryId}" is proposed and awaiting DrJ's approval`);
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
  // A page that resolves to a YouTube stream whose channel the probe could not name is refused too:
  // an unknown channel is not an allowed one.
  if (!h && !youtubeHandleOf(url) && /youtube/i.test(String(probe?.extractor || ""))) {
    throw new Error(`live feed refused: ${url} plays a YouTube stream whose channel could not be confirmed`);
  }
  for (const resolved of [probe?.mediaUrl, probe?.channelUrl]) {
    if (resolved && isNeverAirHost(resolved)) throw new Error(`live feed refused: ${url} resolves to another broadcaster's stream`);
  }
  if (!probe || probe.ok !== true) {
    throw new Error(`live feed refused: pre-air check ${probe ? `failed (${probe.reason})` : "did not run"} for ${url}`);
  }
  return entry;
}
