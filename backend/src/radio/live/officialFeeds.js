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
 * #217 fields (entries added on DrJ's 23 Oct decision):
 *   - `licence`: { url, quote } — the publisher's own reuse terms, as read on that URL.
 *   - `credit`: the on-screen credit the licence asks for ("{year}" becomes the current UTC year).
 *   - `nonCommercialOnly`: the terms allow news / editorial use but not commercial or advertising use.
 *     Refused whenever RADIO_STREAM_MONETISED is on (DrJ, 23 Oct: the stream carries no ads and is
 *     not monetised; monetising it switches these feeds off until permission is obtained).
 *   - `macCheck`: null until `node backend/src/radio/live/cli.js check <url>` has passed on the Mac for
 *     this entry; then { passedAt, url, by }. An entry with `macCheck: null` cannot go to air.
 *     (#202 entries have no `macCheck` key and are unaffected.)
 *
 * #223 field:
 *   - `proposed: true`: an entry the ENGINE proposed and DrJ has not yet approved. assertCanAir refuses
 *     it, the publisher-schedule fetch skips it, and `cli.js feeds` marks it PROPOSED. DrJ approves an
 *     entry by deleting its `proposed` line (and setting `addedBy`); striking one means deleting it.
 */

const DRJ_202 = "DrJ, #202 decision, 22 Oct 2026";
const DRJ_217 = "DrJ, #217 decision, 23 Oct 2026";
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

  // ── #217 (DrJ, 23 Oct 2026): more official feeds. Licence quotes were read on the URL given, on
  //    23 Oct 2026, through a fetch tool that returns clause fragments: re-read the full clause there
  //    before relying on it. None of these has passed `cli.js check` yet (macCheck: null), so none can
  //    air until it does. Left OUT as unverified / needs permission: see docs/radio/official-feeds-217.md.
  {
    id: "federal-reserve", publisher: "Federal Reserve Board",
    youtube: ["@federalreserve"], pages: ["federalreserve.gov/live-broadcast.htm"],
    why: "The Federal Reserve Board's own live page and YouTube channel (FOMC press conferences). "
      + "The Board's disclaimer puts its website information in the public domain, to be copied and distributed "
      + "without permission, citing the Board as source. Third-party material and the Board's seal are excluded.",
    licence: { url: "https://www.federalreserve.gov/disclaimer.htm",
      quote: "Unless otherwise indicated, information on Board's website is in the public domain ... and may be copied and distributed without permission. ... Please cite to the Board as the source of the information." },
    credit: "Source: Federal Reserve Board",
    nonCommercialOnly: false, macCheck: null, addedBy: DRJ_217,
  },
  {
    id: "cdc", publisher: "US Centers for Disease Control and Prevention",
    youtube: ["@CDC"], pages: [],
    why: "CDC's own YouTube channel (linked from cdc.gov/other/agencymaterials.html). CDC material is public domain, "
      + "with attribution, no substantive change, a no-endorsement line and a note that it is free at cdc.gov. "
      + "No cdc.gov live page was found, so the YouTube channel only.",
    licence: { url: "https://www.cdc.gov/other/agencymaterials.html",
      quote: "Most of the information on the CDC and ATSDR websites is not subject to copyright ... is in the public domain, and may be freely used or reproduced without obtaining copyright permission. ... Attribution to the agency that developed the material must be provided in your use of the materials." },
    credit: "Source: CDC. Available free at cdc.gov. Does not imply endorsement by CDC, HHS or the US Government",
    nonCommercialOnly: false, macCheck: null, addedBy: DRJ_217,
  },
  {
    id: "us-dod-dvids", publisher: "US Department of Defense (DVIDS)",
    youtube: [], pages: ["dvidshub.net/webcast/"],
    why: "DVIDS webcasts (dvidshub.net/webcast/<id>), the Defense Department's own distribution service. DoD visual "
      + "information may be used for newsworthy purposes; advertising, marketing and promotional use is commercial "
      + "use and is not allowed, hence nonCommercialOnly. DoD asks for its non-endorsement disclaimer on screen. "
      + "DVIDS also carries other agencies' webcasts: check the originator of each event before airing it.",
    licence: { url: "https://dvidshub.net/about/copyright",
      quote: "DoD VI may be distributed, copied, and used, for non-commercial, personal use, ... as well as historical, educational, or newsworthy purposes or activities. ... ALL users of DoD VI are requested to display the following non-DoD endorsement disclaimer" },
    credit: "Source: DVIDS / US Department of Defense. The appearance of U.S. Department of Defense (DoD) visual information does not imply or constitute DoD endorsement.",
    nonCommercialOnly: true, macCheck: null, addedBy: DRJ_217,
  },
  {
    id: "eu-commission", publisher: "European Commission (Europe by Satellite)",
    youtube: [], pages: ["audiovisual.ec.europa.eu/en/ebs/live/"],
    why: "EbS, the European Commission's own live service (EbS and EbS+ live players only). Reuse is allowed with "
      + "credit (CC BY 4.0 notice), without distorting the meaning; EbS material is offered \"free of charge for "
      + "EU-related information and education purposes\", hence nonCommercialOnly. Each file may carry its own conditions.",
    licence: { url: "https://audiovisual.ec.europa.eu/en/conditions-of-use",
      quote: "reuse is allowed provided appropriate credit is given and changes made are clearly indicated ... © European Union, 202X, licensed under CC BY 4.0 (and https://audiovisual.ec.europa.eu/en/about: This material is offered free of charge for EU-related information and education purposes.)" },
    credit: "© European Union, {year}, licensed under CC BY 4.0 – Source: EC – Audiovisual Service (EbS)",
    nonCommercialOnly: true, macCheck: null, addedBy: DRJ_217,
  },
  {
    id: "eu-parliament", publisher: "European Parliament",
    youtube: ["@europeanparliament"], pages: ["multimedia.europarl.europa.eu/en/webstreaming"],
    why: "The European Parliament's own webstreaming player and YouTube channel (plenary sessions). Its legal notice "
      + "authorises reuse of audio and video material, commercial or not, if the whole item is reproduced and the "
      + "source is acknowledged. The Multimedia Centre's own rules PDF could not be read (robots.txt): UNVERIFIED extra conditions.",
    licence: { url: "https://www.europarl.europa.eu/legal-notice/en/",
      quote: "As a general rule, the reuse (reproduction or use) of textual data and multimedia items ... is authorised, for personal use or for further non-commercial or commercial dissemination, provided that the entire item is reproduced and the source is acknowledged." },
    credit: "© European Union, {year} – Source: European Parliament",
    nonCommercialOnly: false, macCheck: null, addedBy: DRJ_217,
  },
  {
    id: "nato", publisher: "NATO",
    youtube: ["@NATO"], pages: [],
    why: "NATO's own YouTube channel (summits, Secretary-General briefings). Material is free for objective and "
      + "balanced content with a NATO credit; it may not be sold or used for advertising or promotion, hence "
      + "nonCommercialOnly. NATO may ask for removal. Its emblem is not ours to use as branding.",
    licence: { url: "https://nato.int/en/about-us/official-texts-and-resources/use-of-nato-content-and-brand",
      quote: "provided, free of charge, for use in objective and balanced content ... No material produced by NATO is to be sold, used for outside advertising or promotional purposes of any kind. ... All content taken from NATO and republished must be clearly credited or sourced to NATO." },
    credit: "Source: NATO",
    nonCommercialOnly: true, macCheck: null, addedBy: DRJ_217,
  },
  {
    id: "esa", publisher: "European Space Agency",
    youtube: ["@EuropeanSpaceAgency"], pages: [],
    why: "ESA's own YouTube channel (launches, briefings). ESA video may be broadcast for editorial or informational "
      + "purposes without separate authorisation, with an on-screen credit; commercial use needs ESA's written "
      + "authorisation, hence nonCommercialOnly. Third-party footage inside an ESA stream may need its own clearance.",
    licence: { url: "https://www.esa.int/esatv/Terms_and_Conditions",
      quote: "can be used, reproduced, broadcasted and publicly performed for educational, editorial or informational purposes ... free of charge and without requesting a separate authorisation from ESA ... A commercial use requires a separate written authorisation by ESA." },
    credit: "European Space Agency - ESA",
    nonCommercialOnly: true, macCheck: null, addedBy: DRJ_217,
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
 * Is the radio stream monetised (#217)? Fails closed: anything but unset, "", "0", "false" or "no"
 * counts as monetised, because "monetised" is the setting that REFUSES feeds.
 */
export function streamMonetised(env = process.env) {
  const v = String(env.RADIO_STREAM_MONETISED ?? "").trim().toLowerCase();
  return !["", "0", "false", "no", "off"].includes(v);
}

/** An entry added with `macCheck: null` has not passed `cli.js check` on the Mac yet. */
export function awaitingMacCheck(entry) {
  return Boolean(entry) && Object.prototype.hasOwnProperty.call(entry, "macCheck") && !entry.macCheck?.passedAt;
}

/** The on-screen credit for an entry: its licence credit, or "Live feed: <publisher>". */
export function creditFor(entry, now = new Date()) {
  if (!entry) return "";
  if (!entry.credit) return `Live feed: ${entry.publisher}`;
  return entry.credit.replaceAll("{year}", String(now.getUTCFullYear()));
}

/**
 * The single on-air gate. Throws unless ALL hold:
 *   - `entryId` is on the allow-list,
 *   - `url` resolves to that same entry (by URL, or by the probe's channel for a watch?v= URL),
 *   - the entry is not `proposed` (#223),
 *   - the pre-air probe ran and passed (public, live, plays without a login),
 *   - (#217) a nonCommercialOnly entry is refused while RADIO_STREAM_MONETISED is on,
 *   - (#217) an entry with `macCheck: null` is refused until its Mac check is recorded.
 *     `ignoreMacCheck` exists only so `cli.js check` can run that very check.
 * Returns the entry.
 */
export function assertCanAir({ entryId, url, probe }, { feeds = OFFICIAL_FEEDS, env = process.env, ignoreMacCheck = false } = {}) {
  const entry = feedById(entryId, feeds);
  if (!entry) throw new Error(`live feed refused: "${entryId}" is not on the official-feeds allow-list`);
  // #223: a proposed entry is not on the list yet. DrJ approves it by removing `proposed`. No override.
  if (isProposed(entry)) throw new Error(`live feed refused: "${entryId}" is proposed and awaiting DrJ's approval`);
  if (entry.nonCommercialOnly && streamMonetised(env)) {
    throw new Error(`live feed refused: "${entry.id}" allows non-commercial use only and RADIO_STREAM_MONETISED is on`);
  }
  if (!ignoreMacCheck && awaitingMacCheck(entry)) {
    throw new Error(`live feed refused: "${entry.id}" has not passed its cli.js check on the Mac yet (macCheck is null)`);
  }
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
