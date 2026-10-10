/**
 * radioRank.js — group this hour's articles into stories, rank them, pick what airs.
 *
 * GROUPING (DrJ's gate, 8 Oct 2026): cosine ≥ 0.82 on gemini-embedding-001 vectors when
 * ≥ 80% of this build's candidates carry an embedding (articles without one fall back to
 * cleaned-title Jaccard ≥ 0.5), plain Jaccard for everyone otherwise. On 8 Oct only 14 of
 * 3,049 articles (0.5%) were embedded — the embedder stopped 7 Oct 06:32 — which is why
 * the Jaccard path exists and stays: it is the floor. RADIO_GROUP_MODE=auto|cosine|jaccard
 * (default auto) overrides the choice; the mode and the coverage are logged every build.
 *
 * Vectors and cosine come from the event graph's own helpers (eventPromoter's
 * loadArticleVectors / cosine) — no second similarity measure. Which pairs count as the
 * same story is radio-local and touches neither the event graph nor story_clusters.
 * Cosine can still miss a reworded headline, so a second, title-only rule also merges
 * pairs that share ≥ 60% of their named entities / key nouns (sameStoryTitles).
 *
 * SCORE = Σ over DISTINCT outlets that covered the story in the last 60 minutes of
 * that outlet's audience weight (sourceRegions.js: US 1.5, UK/EU 1.2, Gulf/ME 1.2,
 * else 1.0). Recency breaks ties. An outlet counts once per story however many
 * items it files, so a wire flooding one story cannot buy rank.
 *
 * CAPS, across headline + alsoThisHour + music together: at most 2 items whose
 * lead is from one publisher, at most 1 sport item, at most 1 item per TOPICS entry. The IG account ran 85% BBC /
 * 55% sport under a credibility sort; these caps are the fix, not a preference.
 */
import { cleanHeadline } from "../services/socialComposer.js";
import { cosine } from "../realityIndex/intelligence/eventPromoter.js";
import { weightOf } from "./sourceRegions.js";

export const JACCARD_MIN = 0.5;
export const COSINE_MIN = 0.82;          // DrJ's gate, 8 Oct 2026
export const COVERAGE_MIN = 0.8;         // share of candidates with an embedding before cosine is trusted
export const ENTITY_SHARE_MIN = 0.6;     // share of the smaller title's key terms the other must contain
export const ENTITY_MIN_SHARED = 3;      // …and at least this many, so two-word titles cannot merge on one noun
export const GROUP_WINDOW_MS = 90 * 60_000;
export const SCORE_WINDOW_MS = 60 * 60_000;
export const MAX_PER_PUBLISHER = 2;
export const MAX_SPORT = 1;
export const MAX_PER_TOPIC = 1;

// One topic may not fill the rotator (crypto crowded out a whole hour). Deliberately a
// short list of the topics that actually flood: add to it when a new one does.
export const TOPICS = [
  ["crypto", /\b(bitcoin|btc|ethereum|ether|crypto\w*|stablecoin\w*|solana|dogecoin|xrp|binance|coinbase|altcoin\w*|token(?:s|ized)?)\b/i],
  ["markets", /\b(stocks?|wall street|dow jones|s&p 500|nasdaq|shares (?:fall|rise|slip|jump)|sell-?off|futures)\b/i],
  ["ai", /\b(ai|artificial intelligence|chatbots?|openai|chatgpt|anthropic|gemini|llms?)\b/i],
];
export function topicOf(story) {
  const t = String(story?.lead?.title || "");
  for (const [name, re] of TOPICS) if (re.test(t)) return name;
  return null;
}

const STOP = new Set(("a an the and or but of in on at to for from by with as is are was were be been being it its " +
  "this that these those after before over under into out up down off about than then so not no new says say said " +
  "will would could should may might can has have had do does did his her their our your my we you they he she them " +
  "us who what when where why how amid via vs per just more most also").split(" "));

export function titleTokens(title) {
  return new Set(
    cleanHeadline(title).toLowerCase()
      .replace(/['’]s\b/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w))
  );
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// ─── same-story test on titles alone ────────────────────────────────────────

// Reporting verbs that differ between rewordings of one story ("announces" / "agrees") and
// say nothing about which story it is.
const LIGHT_STEMS = new Set(["annou", "agree", "says", "said", "revea", "confi", "warns", "repor", "claim", "plans", "seeks", "calls", "urges", "vows", "sets", "makes", "takes", "gets", "gives", "backs"]);
const stem = (w) => (w.length >= 6 ? w.slice(0, 5) : w);   // russia/russian → russi, release/releases → relea

/**
 * Key terms of a title: stemmed content words, plus which of them are capitalised in the
 * original, past the first word (the named entities). Cached per title string.
 * @returns {{ all: Set<string>, named: Set<string> }}
 */
const keyCache = new Map();
export function keyTerms(title) {
  const raw = cleanHeadline(title);
  let hit = keyCache.get(raw);
  if (hit) return hit;
  const all = new Set(), named = new Set();
  const words = raw.replace(/['’]s\b/g, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  for (const [i, w] of words.entries()) {
    const lower = w.toLowerCase();
    if (STOP.has(lower)) continue;
    if (w.length < 3 && !(w.length === 2 && w === w.toUpperCase() && /[A-Z]/.test(w))) continue;   // keep EU, UN, UK
    const st = stem(lower);
    if (LIGHT_STEMS.has(st)) continue;
    all.add(st);
    if (i > 0 && /^[A-Z]/.test(w)) named.add(st);   // the first word is capitalised whatever it is
  }
  hit = { all, named };
  if (keyCache.size > 5000) keyCache.clear();
  keyCache.set(raw, hit);
  return hit;
}

/**
 * Do two headlines share ≥ ENTITY_SHARE_MIN of the smaller one's key terms (≥ ENTITY_MIN_SHARED
 * of them), including at least one name that is capitalised in both? Catches rewordings that
 * token-Jaccard misses because the union is inflated by the words that differ.
 */
export function sameStoryTitles(titleA, titleB) {
  return sameKeys(keyTerms(titleA), keyTerms(titleB));
}
/** sameStoryTitles() on already-extracted key terms (grouping extracts once per article, not once per pair). */
function sameKeys(a, b) {
  const [small, big] = a.all.size <= b.all.size ? [a, b] : [b, a];
  if (small.all.size < ENTITY_MIN_SHARED) return false;
  let shared = 0;
  for (const t of small.all) if (big.all.has(t)) shared++;
  if (shared < ENTITY_MIN_SHARED || shared / small.all.size < ENTITY_SHARE_MIN) return false;
  for (const t of a.named) if (b.named.has(t) && small.all.has(t)) return true;
  return false;
}

/**
 * The entity rule is the loosest same-story test (two different stories about the same people
 * can share most key terms), so it has its own off switch, independent of RADIO_GROUP_MODE:
 * RADIO_ENTITY_RULE=off disables it in grouping AND in the on-air duplicate check, leaving
 * cosine / title-Jaccard only. Read per call, so an .env change + `up -d` takes effect without code.
 */
export function entityRuleEnabled(raw = process.env.RADIO_ENTITY_RULE) {
  return String(raw ?? "").trim().toLowerCase() !== "off";
}

/** Same story as seen from two articles: embedding cosine when both carry a vector, else title Jaccard; plus the entity rule when enabled. */
function sameArticleStory(x, y, entityRule = entityRuleEnabled()) {
  if (x._vec && y._vec && cosine(x._vec, y._vec) >= COSINE_MIN) return true;
  if (!x._vec || !y._vec) {
    if (jaccard(x._tok || titleTokens(x.title), y._tok || titleTokens(y.title)) >= JACCARD_MIN) return true;
  }
  return entityRule && sameKeys(x._keys || keyTerms(x.title), y._keys || keyTerms(y.title));
}
const articlesOf = (s) => (s?.articles?.length ? s.articles : s?.lead ? [s.lead] : []);
/** Two ranked stories are the same story if ANY pair of their articles is. Used to keep duplicates off the air. */
export function sameStory(a, b, entityRule = entityRuleEnabled()) {
  for (const x of articlesOf(a)) for (const y of articlesOf(b)) if (sameArticleStory(x, y, entityRule)) return true;
  return false;
}

// ─── grouping mode ──────────────────────────────────────────────────────────

export function groupModeSetting(raw = process.env.RADIO_GROUP_MODE) {
  const v = String(raw || "").trim().toLowerCase();
  return v === "cosine" || v === "jaccard" ? v : "auto";
}

/**
 * Decide how this build groups.
 * @param {number} total     candidates considered
 * @param {number} embedded  of those, how many carry a vector
 * @returns {{ mode: "cosine"|"jaccard", setting: string, coverage: number, embedded: number, total: number }}
 */
export function chooseGroupMode(total, embedded, setting = groupModeSetting()) {
  const coverage = total ? embedded / total : 0;
  const mode = setting === "jaccard" ? "jaccard"
    : setting === "cosine" ? "cosine"
    : coverage >= COVERAGE_MIN ? "cosine" : "jaccard";
  return { mode, setting, coverage, embedded, total };
}

/**
 * Single-link grouping (union-find) of articles that are the same story and whose fetch
 * times are within GROUP_WINDOW_MS of each other. A pair is the same story if
 *   • mode "cosine": both have a vector and cosine ≥ COSINE_MIN (a pair with an unembedded
 *     member uses title Jaccard ≥ JACCARD_MIN instead), or
 *   • mode "jaccard": title Jaccard ≥ JACCARD_MIN, or
 *   • in either mode, unless RADIO_ENTITY_RULE=off: sameStoryTitles() (the entity rule).
 * @param {object[]} articles
 * @param {{ mode?: "cosine"|"jaccard", vectors?: Map<string, ArrayLike<number>> }} opts
 * @returns {object[][]} groups of articles
 */
export function groupArticles(articles, { mode = "jaccard", vectors = null, entityRule = entityRuleEnabled() } = {}) {
  const useVec = mode === "cosine" && vectors;
  const items = articles.map((a) => ({ ...a, _tok: titleTokens(a.title), _keys: keyTerms(a.title), _vec: useVec ? vectors.get(a.id) || null : null }));
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (find(i) === find(j)) continue;
      if (Math.abs((items[i].fetched_at || 0) - (items[j].fetched_at || 0)) > GROUP_WINDOW_MS) continue;
      const a = items[i], b = items[j];
      const same = a._vec && b._vec
        ? cosine(a._vec, b._vec) >= COSINE_MIN
        : jaccard(a._tok, b._tok) >= JACCARD_MIN;
      if (same || (entityRule && sameKeys(a._keys, b._keys))) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  items.forEach((a, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(a);
  });
  return [...groups.values()];
}

const SPORT_SOURCES = /\b(sport|espn|sports illustrated)\b/i;
export function isSport(item) {
  return String(item?.category || "").toLowerCase().startsWith("sport") || SPORT_SOURCES.test(String(item?.source_name || ""));
}

// Article category → the music rotator's six display categories.
const CAT = {
  world: ["international", "top", "world", "local", "publications"],
  business: ["business", "markets", "finance", "economy"],
  tech: ["tech", "ai", "computer-science", "agentic-ai", "cars"],
  politics: ["politics"],
  health: ["health", "medicine", "public-health", "self-help"],
  science: ["science", "environment", "climate"],
};
export const MUSIC_CATEGORIES = ["World", "Business", "Tech", "Politics", "Health", "Science"];
export function displayCategory(category) {
  const c = String(category || "").toLowerCase();
  for (const [k, list] of Object.entries(CAT)) if (list.includes(c)) return k[0].toUpperCase() + k.slice(1);
  return "World";
}

/**
 * Turn groups into ranked stories.
 * Each story: { score, outlets (weight-desc), lead, articles, last, sport }
 */
export function rankStories(groups, { now = Date.now() } = {}) {
  const stories = [];
  for (const g of groups) {
    const recent = g.filter((a) => (a.fetched_at || 0) >= now - SCORE_WINDOW_MS);
    if (!recent.length) continue;                       // nothing from this hour
    const outlets = [...new Set(recent.map((a) => a.source_name).filter(Boolean))]
      .sort((x, y) => weightOf(y) - weightOf(x) || x.localeCompare(y));
    const score = outlets.reduce((s, o) => s + weightOf(o), 0);
    const lead = [...g].sort((x, y) => (y.credibility || 0) - (x.credibility || 0) || (y.fetched_at || 0) - (x.fetched_at || 0))[0];
    const last = Math.max(...g.map((a) => a.fetched_at || 0));
    stories.push({ score, outlets, lead, articles: g, last, sport: g.some(isSport) });
  }
  return stories.sort((a, b) => b.score - a.score || b.last - a.last);
}

/** "Reported by X" / "Reported by X and Y" — at most two outlets named. */
export function attribution(outlets) {
  const named = outlets.slice(0, 2);
  if (!named.length) return "";
  return `Reported by ${named.join(" and ")}`;
}

// ─── music = hard news ───────────────────────────────────────────────────────
// A SINGLE-SOURCE story is music-eligible only if it is plainly news. These are the three
// kinds that leaked under the music bed: aggregator links (Hacker News), entertainment / TV /
// streaming announcements, and academic-paper headlines. A story two outlets both ran passes
// regardless — it is news by corroboration. Radio-local, like SOFT_RULES.
const AGGREGATOR_SOURCES = /\b(hacker ?news|y combinator|lobste\.?rs|slashdot|reddit|product hunt|techmeme)\b/i;
const ENTERTAINMENT_CATEGORIES = /^(entertainment|tv|television|movies?|film|streaming|celebrity|culture|gaming|games)\b/i;
const ENTERTAINMENT_TITLE = new RegExp(
  "\\b(" + [
    "tv (?:series|show)", "(?:web|limited|streaming|animated|original) series",
    "series (?:is |are )?(?:back|renewed|cancell?ed|picked up|in development|greenlit|ordered)",
    "(?:show|season|series|film|movie|sequel|reboot|spin-?off|remake|franchise) (?:renewed|cancell?ed|greenlit|picked up|in development)",
    "in development", "greenlit", "showrunner", "box office", "(?:official|movie|teaser) trailer", "season premiere", "series premiere",
    "streaming (?:service|platform|series|debut)", "casts? .{0,30} as",
  ].join("|") + ")\\b",
  "i"
);
const ACADEMIC_TITLE = /(?:\b(?:paper|preprint|study|studies|researchers?|arxiv|theorem|lemma)\b.{0,40}\b(?:argues?|finds?|found|shows?|suggests?|proves?|claims?)\b|\b(?:argues?|finds?|shows?|suggests?|proves?)\b.{0,20}\b(?:paper|preprint|study)\b|\barxiv\b|\b(?:converges?|theorem|lemma|conjecture)\b)/i;

/** @returns {string|null} why a single-source story may not air over music, or null if it may */
export function musicIneligibleReason(s) {
  const titles = articlesOf(s).map((a) => String(a.title || ""));
  const sources = articlesOf(s).map((a) => String(a.source_name || ""));
  if (sources.some((n) => AGGREGATOR_SOURCES.test(n))) return "aggregator";
  if (articlesOf(s).some((a) => ENTERTAINMENT_CATEGORIES.test(String(a.category || ""))) || titles.some((t) => ENTERTAINMENT_TITLE.test(t))) return "entertainment";
  if (titles.some((t) => ACADEMIC_TITLE.test(t))) return "academic";
  return null;
}
export const musicIneligible = (s) => (s.outlets?.length || 0) < 2 && musicIneligibleReason(s) !== null;

/**
 * Pick what airs, honouring the caps across all three slots.
 * @param {object[]} ranked   rankStories() output, already gate-filtered
 * @returns {{ headline: object|null, also: object[], music: object[] }}
 */
export const ALSO_THIS_HOUR = 5;   // DrJ, 8 Oct 2026 (was 3)
export function pickSlots(ranked, { alsoCount = ALSO_THIS_HOUR, musicMin = 4, musicMax = 6 } = {}) {
  const perPublisher = new Map();
  let sportUsed = 0;
  const perTopic = new Map();
  const taken = new Set();
  const fits = (s) => {
    if (taken.has(s)) return false;
    // One story, one slot: a reworded copy of something already on air (cosine ≥ COSINE_MIN or
    // the entity rule) is skipped, wherever in the ranking it sits.
    for (const t of taken) if (sameStory(s, t)) return false;
    const topic = topicOf(s);
    if (topic && (perTopic.get(topic) || 0) >= MAX_PER_TOPIC) return false;
    const pub = s.lead?.source_name || "?";
    if ((perPublisher.get(pub) || 0) >= MAX_PER_PUBLISHER) return false;
    if (s.sport && sportUsed >= MAX_SPORT) return false;
    return true;
  };
  const take = (s) => {
    taken.add(s);
    const pub = s.lead?.source_name || "?";
    perPublisher.set(pub, (perPublisher.get(pub) || 0) + 1);
    if (s.sport) sportUsed++;
    const topic = topicOf(s);
    if (topic) perTopic.set(topic, (perTopic.get(topic) || 0) + 1);
    return s;
  };

  const headline = ranked.find(fits) ? take(ranked.find(fits)) : null;
  const also = [];
  for (const s of ranked) { if (also.length >= alsoCount) break; if (fits(s)) also.push(take(s)); }

  // Music: never a sensitive story (no light music under a death toll), and hard news first.
  // Two passes: stories reported by ≥ 2 outlets, then single-source stories that are not
  // musicIneligible(). One per display category first, then fill to musicMax.
  const music = [];
  const musicOk = (s) => !s.sensitive && fits(s);
  const multi = (s) => (s.outlets?.length || 0) >= 2;
  for (const pool of [(s) => multi(s), (s) => !multi(s) && !musicIneligible(s)]) {
    for (const cat of MUSIC_CATEGORIES) {
      const s = ranked.find((x) => pool(x) && musicOk(x) && displayCategory(x.lead?.category) === cat);
      if (s && music.length < musicMax && !music.some((m) => displayCategory(m.lead?.category) === cat)) music.push(take(s));
    }
    for (const s of ranked) { if (music.length >= musicMax) break; if (pool(s) && musicOk(s)) music.push(take(s)); }
  }
  // Fewer than musicMin is reported, not padded: a quiet hour gets a short rotator.
  return { headline, also, music, musicShort: music.length < musicMin };
}
