// Hashtags for X — one or two, or none at all.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE DATA SAYS, WHICH IS NOT WHAT THE INSTINCT SAYS
//
// Measured across 2026 studies of X engagement:
//
//     1-2 tags   +21% engagement against none
//     3+ tags    -17%
//     5+ tags    up to -40% reach
//
// X ranks on semantic understanding of the post text now, not on tag matching.
// A tag is a clickable destination, not a megaphone — so a GENERIC tag adds no
// discovery and still costs the reach penalty. "#News #BreakingNews #Shorts",
// which this project appends to TikTok captions, is the worst available pattern:
// three tags, all generic, on a platform that already knows the post is news.
//
// So the rule here is two tags maximum, both specific, and zero rather than one
// bad one.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE TAGS COME FROM THE TITLE AND NOT FROM THE ENTITY TABLE ALONE
//
// `article_entities` has 462,151 rows and resolves entities to Wikidata QIDs,
// which sounds like the obvious source. Sampled against three real published
// videos it returned, alongside "Iran" and "Vietnam":
//
//     UTC+03:30            a timezone
//     orientalist          from a Vietnam story
//     sport in Vietnam     from a story about Starlink
//     (nothing at all)     for a Wired composter review
//
// Roughly half of it is unusable, and #UTC0330 on a news post is worse than no
// tag. The article TITLE is written by the spec writer and reviewed by the
// packaging gate, so requiring an entity to appear in it is a cheap, strong
// filter for both salience and sanity: a subject the headline did not think
// worth naming is not the subject of the post.
//
// IDF is deliberately NOT used to rank. Low IDF means common across our corpus
// — which is exactly what #Iran and #China are, and exactly the tags a reader
// follows. Rarity is the wrong axis for a destination people search.

/** Tags that say nothing on a news account. X already knows this is news. */
const GENERIC = new Set([
  "news", "breaking", "breakingnews", "shorts", "video", "update", "updates",
  "world", "worldnews", "today", "daily", "latest", "report", "reports",
  "media", "press", "story", "headline", "headlines", "trending", "viral",
  "politics", "business", "economy", "markets", "tech", "technology", "science",
  "government", "official", "officials", "people", "study", "research",
]);

/** Entity kinds that make sense as a destination someone would follow. */
const USEFUL_TYPES = new Set(["place", "person", "org", "organization", "organisation", "event", "product"]);

/** "People's Republic of China" -> "China"; "United States" -> "US". */
const CANON = new Map([
  ["peoples republic of china", "China"], ["mainland china", "China"],
  ["united states of america", "US"], ["united states", "US"],
  ["united kingdom", "UK"], ["russian federation", "Russia"],
  ["republic of india", "India"], ["islamic republic of iran", "Iran"],
  ["european union", "EU"], ["socialist republic of vietnam", "Vietnam"],
]);

/**
 * The CANON key for a name.
 *
 * Apostrophes are stripped BEFORE the lookup, not after. Keying on the raw
 * string meant "People's Republic of China" missed its entry and came out as
 * #PeopleRepublicOfChina — a tag nobody searches, on a story about China.
 */
const canonKey = (name) =>
  String(name || "").toLowerCase().replace(/['’]/g, "").replace(/\s+/g, " ").trim();

const canonical = (name) => CANON.get(canonKey(name)) || name;

/** A hashtag body: letters and digits only, words joined in CamelCase. */
export function toTag(name) {
  const canon = canonical(name);
  const words = String(canon || "")
    .replace(/['’]s\b/gi, "")            // Vietnam's -> Vietnam
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")  // drop punctuation, keep letters/digits
    .split(/[\s-]+/).filter(Boolean);
  if (!words.length) return null;
  // A tag must start with a letter — X will not link one that starts with a
  // digit, so "2026Election" is dead text.
  const body = words.map(w => w[0].toUpperCase() + w.slice(1)).join("");
  if (!/^\p{L}/u.test(body)) return null;
  if (body.length < 2 || body.length > 24) return null;
  return body;
}

const isGeneric = (tag) => GENERIC.has(String(tag).toLowerCase());

/**
 * One or two tags for a post, or an empty array.
 *
 * `entities` is whatever the caller has — [{ label, surface, entity_type }].
 * Order of preference is the order the subject appears IN THE TITLE, because
 * the first thing a headline names is what the story is about.
 */
export function hashtagsFor({ title = "", entities = [], max = 2 } = {}) {
  const hay = String(title).toLowerCase();
  const seen = new Set();
  const found = [];

  for (const e of entities) {
    if (e?.entity_type && !USEFUL_TYPES.has(String(e.entity_type).toLowerCase())) continue;
    const name = e?.label || e?.surface;
    if (!name) continue;
    const canon = canonical(name);
    // THE FILTER THAT MAKES THIS USABLE: the headline has to have named it.
    const probe = String(canon).replace(/['’]s\b/gi, "").toLowerCase();
    const at = hay.indexOf(probe.split(/\s+/)[0]);
    if (at < 0 || probe.split(/\s+/)[0].length < 3) continue;
    const tag = toTag(canon);
    if (!tag || isGeneric(tag) || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    found.push({ tag, at });
  }

  return found.sort((a, b) => a.at - b.at).slice(0, max).map(f => "#" + f.tag);
}

/**
 * Append tags to a caption without pushing it past X's limit.
 *
 * Tags are dropped rather than the text being truncated: a cut-off sentence
 * costs more than a missing tag, and the text is the thing being ranked.
 */
export function withHashtags(text, tags, limit = 280) {
  const body = String(text || "").trim();
  if (!tags?.length) return body;
  let out = body;
  for (const tag of tags) {
    const next = `${out}\n\n${tag}`.replace(/\n\n(#\S+)\n\n(#\S+)/, "\n\n$1 $2");
    if ([...next].length > limit) break;
    out = next;
  }
  return out;
}
