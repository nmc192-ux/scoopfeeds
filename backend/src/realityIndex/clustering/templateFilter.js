/**
 * templateFilter - detect recurring-template ("boilerplate") articles to exclude PRE-
 * clustering: daily puzzle posts, gold/currency-rate tables, etc. The signal is RECURRENCE
 * of the SAME title skeleton across MULTIPLE DISTINCT DAYS - real multi-day stories vary
 * their headline day to day; templates repeat it. So detection runs over the multi-day
 * corpus, not a single window.
 *
 * Pure: reads the DB, returns the template set; writes nothing. NOT wired into the pipeline.
 */
import { getDb } from "../../models/database.js";

const MONTHS = new Set(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"]);
const WEEKDAYS = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun"]);
const ORDINAL_SUFFIX = new Set(["st", "nd", "rd", "th"]); // bare ordinal residue after digit strip

// straight + curly apostrophes (’), stripped so "today's" -> "todays"
const APOSTROPHES = /['’]/g;

/** Reduce a title to a stable SKELETON: drop digits, dates, ordinals, punctuation, stray
 *  single chars. Recurrences of the same template collapse to one skeleton. */
export function titleSkeleton(title) {
  if (!title) return "";
  let s = String(title).toLowerCase().replace(APOSTROPHES, ""); // today's -> todays
  s = s.replace(/[^a-z0-9\s]/g, " ");                           // punctuation -> space
  return s.split(/\s+/).filter(Boolean).filter((t) =>
    !/\d/.test(t) &&                                            // any digit-bearing token (#1055, 2026, 30)
    t.length >= 2 &&                                            // stray single chars
    !MONTHS.has(t) && !WEEKDAYS.has(t) && !ORDINAL_SUFFIX.has(t)
  ).join(" ");
}

/**
 * detectTemplates -> { templates:[{source,skeleton,count,days}], templateIds:Set<id> }
 * A (source, skeleton) is a recurring template iff it has >= minCount articles across
 * >= minDays DISTINCT days. minTokens guards against ultra-generic 1-word skeletons.
 */
export function detectTemplates({ db = getDb(), minCount = 4, minDays = 3, minTokens = 2 } = {}) {
  const rows = db.prepare(
    "SELECT id, source_name AS source, title, published_at FROM articles WHERE is_duplicate = 0 AND title IS NOT NULL"
  ).all();
  const groups = new Map();
  for (const r of rows) {
    const sk = titleSkeleton(r.title);
    if (!sk || sk.split(" ").length < minTokens) continue;
    const key = r.source + "\u0000" + sk; // NUL separator (ASCII escape): never collides with content
    let g = groups.get(key);
    if (!g) { g = { source: r.source, skeleton: sk, ids: [], days: new Set() }; groups.set(key, g); }
    g.ids.push(r.id);
    g.days.add(Math.floor(r.published_at / 86400000));
  }
  const templates = [];
  const templateIds = new Set();
  for (const g of groups.values()) {
    if (g.ids.length >= minCount && g.days.size >= minDays) {
      templates.push({ source: g.source, skeleton: g.skeleton, count: g.ids.length, days: g.days.size });
      for (const id of g.ids) templateIds.add(id);
    }
  }
  templates.sort((a, b) => b.count - a.count);
  return { templates, templateIds };
}
