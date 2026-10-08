/**
 * radioRank.js — group this hour's articles into stories, rank them, pick what airs.
 *
 * GROUPING IS TITLE-ONLY FOR NOW, AND THAT IS A MEASURED DECISION, NOT A SHORTCUT.
 * DrJ's gate (8 Oct 2026): cosine ≥ 0.82 on gemini-embedding-001 vectors if ≥ 80% of
 * the last 24 h were embedded, title token overlap otherwise. Measured on prod that
 * day: 14 of 3,049 articles (0.5%) had an embedding; the article embedder stopped on
 * 7 Oct 06:32 alongside event linking and story_clusters. So grouping is cleaned-title
 * Jaccard ≥ 0.5, self-contained here, touching neither the event graph nor
 * story_clusters. When embeddings recover, `similarity` is the one seam to swap.
 *
 * SCORE = Σ over DISTINCT outlets that covered the story in the last 60 minutes of
 * that outlet's audience weight (sourceRegions.js: US 1.5, UK/EU 1.2, Gulf/ME 1.2,
 * else 1.0). Recency breaks ties. An outlet counts once per story however many
 * items it files, so a wire flooding one story cannot buy rank.
 *
 * CAPS, across headline + alsoThisHour + music together: at most 2 items whose
 * lead is from one publisher, at most 1 sport item. The IG account ran 85% BBC /
 * 55% sport under a credibility sort; these caps are the fix, not a preference.
 */
import { cleanHeadline } from "../services/socialComposer.js";
import { weightOf } from "./sourceRegions.js";

export const JACCARD_MIN = 0.5;
export const GROUP_WINDOW_MS = 90 * 60_000;
export const SCORE_WINDOW_MS = 60 * 60_000;
export const MAX_PER_PUBLISHER = 2;
export const MAX_SPORT = 1;

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

/**
 * Single-link grouping (union-find) of articles whose titles overlap ≥ JACCARD_MIN
 * and whose fetch times are within GROUP_WINDOW_MS of each other.
 * @returns {object[][]} groups of articles
 */
export function groupArticles(articles, { similarity = (x, y) => jaccard(x._tok, y._tok), min = JACCARD_MIN } = {}) {
  const items = articles.map((a) => ({ ...a, _tok: titleTokens(a.title) }));
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (Math.abs((items[i].fetched_at || 0) - (items[j].fetched_at || 0)) > GROUP_WINDOW_MS) continue;
      if (similarity(items[i], items[j]) >= min) parent[find(i)] = find(j);
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

/**
 * Pick what airs, honouring the caps across all three slots.
 * @param {object[]} ranked   rankStories() output, already gate-filtered
 * @returns {{ headline: object|null, also: object[], music: object[] }}
 */
export function pickSlots(ranked, { alsoCount = 3, musicMin = 4, musicMax = 6 } = {}) {
  const perPublisher = new Map();
  let sportUsed = 0;
  const taken = new Set();
  const fits = (s) => {
    if (taken.has(s)) return false;
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
    return s;
  };

  const headline = ranked.find(fits) ? take(ranked.find(fits)) : null;
  const also = [];
  for (const s of ranked) { if (also.length >= alsoCount) break; if (fits(s)) also.push(take(s)); }

  // Music: never a sensitive story (no light music under a death toll); one per
  // display category first, then fill to musicMax from the rest of the ranking.
  const music = [];
  const musicOk = (s) => !s.sensitive && fits(s);
  for (const cat of MUSIC_CATEGORIES) {
    const s = ranked.find((x) => musicOk(x) && displayCategory(x.lead?.category) === cat);
    if (s && music.length < musicMax) music.push(take(s));
  }
  for (const s of ranked) { if (music.length >= musicMax) break; if (musicOk(s)) music.push(take(s)); }
  // Fewer than musicMin is reported, not padded: a quiet hour gets a short rotator.
  return { headline, also, music, musicShort: music.length < musicMin };
}
