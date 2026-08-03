/**
 * categoryTags — the deterministic category → IG tag map.
 *
 * Intentionally boring and static. No LLM, no per-post variation, no
 * generation, no DB read. The same category always yields the same tags in the
 * same order, which is the point: tags are a DISCOVERY surface, and a set that
 * drifts post-to-post is a set Instagram cannot learn to associate with the
 * account.
 *
 * KEYED ON THE REAL VOCABULARY. The keys below are the actual values found in
 * `articles.category` / `events.category`, measured over the 23,645-article
 * prod snapshot — not an idealised taxonomy. Counts at time of writing:
 *
 *   business 9388 · international 6372 · pakistan 1543 · top 1199 · tech 899
 *   sports 778 · computer-science 744 · politics 717 · publications 634
 *   local 366 · ai 254 · cars 184 · science 143 · agentic-ai 139 · health 119
 *   environment 95 · self-help 69 · medicine 2
 *   (events add: weather 20886 · geo 259 — the machine-event buckets)
 *
 * Several source categories collapse into one topic bucket, because IG tag
 * targeting is coarser than our editorial taxonomy: nobody searches
 * #agenticai, they search #ai.
 *
 * FEED LABELS ARE NOT TOPICS. `top`, `publications` and `local` describe where
 * an item sits in our feed, not what it is about. They resolve to `default`
 * deliberately — tagging a story #top would be tagging it with our own
 * internal shelf name.
 */

// Every tag: lowercase, no spaces, no trailing punctuation, leading '#'.
//
// The '#' is stored HERE rather than added at the call site so this file is
// the single place a tag is ever written, and the caption assembly is a plain
// join. Flagged at Gate 1 — if tags should be bare tokens instead, it is a
// one-line change to strip them here.
//
// Hard ceiling of 5 per bucket. Instagram's own guidance since 2023 has been
// that a small, specific tag set outperforms a large generic one, which is
// also why this replaces the 12-15 tag block rather than sitting beside it.
export const CATEGORY_TAGS = Object.freeze({
  // international / politics / geo → geopolitics
  //
  // NOTE: `geo` here is the USGS/NOAA MACHINE-EVENT bucket, not "geopolitics"
  // in the editorial sense. It is mapped as instructed, but a geo event should
  // never reach a carousel in the first place — the category exclusion for
  // `weather` and `geo` at carousel selection is tracked separately. If that
  // exclusion lands, this key becomes dead and can be dropped.
  international: Object.freeze(["#geopolitics", "#worldnews", "#globalpolitics", "#internationalnews"]),
  politics:      Object.freeze(["#geopolitics", "#worldnews", "#globalpolitics", "#internationalnews"]),
  geo:           Object.freeze(["#geopolitics", "#worldnews", "#globalpolitics", "#internationalnews"]),

  // business → markets
  business: Object.freeze(["#markets", "#business", "#finance", "#economy", "#stocks"]),

  // tech / ai / computer-science / agentic-ai → tech
  tech:               Object.freeze(["#tech", "#technology", "#ai", "#artificialintelligence", "#innovation"]),
  ai:                 Object.freeze(["#tech", "#technology", "#ai", "#artificialintelligence", "#innovation"]),
  "computer-science": Object.freeze(["#tech", "#technology", "#ai", "#artificialintelligence", "#innovation"]),
  "agentic-ai":       Object.freeze(["#tech", "#technology", "#ai", "#artificialintelligence", "#innovation"]),

  // sports → sport
  sports: Object.freeze(["#sports", "#sportsnews", "#sport", "#sportsupdate"]),

  // health / medicine / science → health
  health:   Object.freeze(["#health", "#healthnews", "#medicine", "#publichealth", "#science"]),
  medicine: Object.freeze(["#health", "#healthnews", "#medicine", "#publichealth", "#science"]),
  science:  Object.freeze(["#health", "#healthnews", "#medicine", "#publichealth", "#science"]),

  // Feed labels and every unmapped category. `pakistan`, `cars`, `environment`,
  // `self-help` and `weather` all land here today: `pakistan` because its
  // handling against the D1 editorial boundary is a separate open question and
  // guessing a tag set now would pre-empt it; `weather` because machine events
  // should not be posting at all; the rest because they are low-volume and no
  // bucket was specified for them. All are additive to add later.
  default: Object.freeze(["#news", "#breakingnews", "#newsupdate", "#currentaffairs"]),
});

// The ceiling is enforced at the boundary, not merely respected by the data
// above — a future edit that adds a sixth tag to a bucket must not be able to
// leak it into a caption.
const MAX_TAGS = 5;

/**
 * Tags for a category. Falls back to `default` on unknown, null, empty or
 * non-string input.
 *
 * Never throws. Never returns more than MAX_TAGS. Always returns a fresh
 * mutable array, so a caller cannot corrupt the shared frozen map for the rest
 * of the process — the per-process-state bug class, one layer down.
 */
export function tagsForCategory(category) {
  let key = "";
  try {
    // String() rather than a template literal: a Symbol survives String() but
    // throws in `${}`. The catch covers the remaining hostile case, an object
    // whose toString() throws.
    key = String(category ?? "").trim().toLowerCase();
  } catch {
    key = "";
  }
  const tags = (Object.prototype.hasOwnProperty.call(CATEGORY_TAGS, key) && CATEGORY_TAGS[key])
    || CATEGORY_TAGS.default;
  return tags.slice(0, MAX_TAGS);
}
