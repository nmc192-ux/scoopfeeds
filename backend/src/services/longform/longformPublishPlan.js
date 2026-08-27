/**
 * longformPublishPlan.js — publish.json, with the disclosure DERIVED (#78).
 *
 * Builds the publish plan `publish-all.mjs` consumes: film and thumbnail
 * paths, YouTube metadata, the Shorts schedule, the Facebook post, and the
 * AI-provenance disclosure.
 *
 * THE DISCLOSURE IS DERIVED FROM PROVENANCE, NOT AUTHORED.
 *
 * #79's gate checks that four surfaces agree. Checking is the right last line
 * of defence, but it is the wrong FIRST one: pointing that gate at real data
 * immediately found a shipped film (bundibugyo) declaring `isAigc: true` to
 * TikTok while its own LICENSES.md said "AI-generated imagery: None." Someone
 * had authored the disclosure separately from the ground truth, and the two
 * drifted.
 *
 * So here the disclosure is COMPUTED from LICENSES.md — the file genscene.mjs
 * stamps when a generated scene enters a project — and written identically to
 * every surface. The gate then verifies a property that is true by
 * construction, which is what a gate should be doing.
 *
 * SCHEDULING RATIONALE, inherited from publish-all.mjs and not re-derived:
 * the channel has no algorithmic push, so the Shorts are the distribution and
 * the film is the destination. The film therefore lands FIRST, so every Short
 * has somewhere to send people, then one Short per day for five days — five
 * independent shots at the Shorts feed rather than five clips competing on
 * one. 19:00 UTC is 3pm US Eastern: the US afternoon and the European evening
 * on day one, which is the window YouTube uses to decide who else to show it
 * to.
 */

import { AIGC_STAMP } from "./longformQcGate.js";

/** 19:00 UTC — 3pm US Eastern. */
export const SLOT_HOUR_UTC = 19;

/** YouTube category 25 = News & Politics. */
export const CATEGORY_NEWS = "25";

/**
 * The AI-provenance disclosure, computed from the project's own provenance.
 *
 * @param {string|null} licensesText  contents of LICENSES.md, or null if absent
 * @param {string[]} [generatedScenes] scene keys, for a specific sentence
 * @returns {{ hasAigc, syntheticContent, isAigc, descriptionLine }}
 */
export function deriveDisclosure(licensesText, generatedScenes = []) {
  if (licensesText == null) {
    throw new Error(
      "deriveDisclosure: LICENSES.md is missing. A disclosure cannot be derived from " +
      "absent provenance, and must never be guessed — acquire media first.");
  }
  const hasAigc = licensesText.includes(AIGC_STAMP);
  if (!hasAigc) {
    return {
      hasAigc: false,
      // FALSE, not undefined: publish-all.mjs prints "do NOT tick Altered
      // content" from this, and an absent value would read as unknown.
      syntheticContent: false,
      isAigc: false,
      descriptionLine: "No AI-generated imagery is used in this film.",
    };
  }
  const n = generatedScenes.length;
  const what = n
    ? `${n} AI-generated stylized scene${n === 1 ? "" : "s"} (${generatedScenes.join(", ")})`
    : "AI-generated stylized scenes";
  return {
    hasAigc: true,
    syntheticContent: what,
    isAigc: true,
    descriptionLine: `Contains ${what}. No synthetic humans; every person shown is real footage or a cited source.`,
  };
}

/**
 * The publish schedule: film first, then one Short per day.
 *
 * @param {Date|number} startFrom  earliest permissible slot
 * @param {number} shortCount
 * @returns {{ filmAt: string, shortAts: string[], facebookAt: string, reelAt: string }}
 */
export function buildSchedule(startFrom, shortCount = 5) {
  const base = new Date(startFrom);
  // The film takes the next 19:00 UTC that is at least an hour away — a slot
  // minutes from now leaves no room to notice a mistake before it is public.
  const film = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), SLOT_HOUR_UTC, 0, 0));
  if (film.getTime() - base.getTime() < 3600_000) film.setUTCDate(film.getUTCDate() + 1);

  const shortAts = [];
  for (let i = 0; i < shortCount; i++) {
    const d = new Date(film);
    // The first Short lands the day AFTER the film, so the film is already
    // live and is a destination rather than a dead link.
    d.setUTCDate(d.getUTCDate() + i + 1);
    shortAts.push(d.toISOString());
  }
  // Facebook takes the film on the same day, an hour later, so the two
  // platforms do not publish into the same minute.
  const fb = new Date(film); fb.setUTCHours(fb.getUTCHours() + 1);
  const reel = new Date(film); reel.setUTCDate(reel.getUTCDate() + 1); reel.setUTCHours(reel.getUTCHours() + 1);
  return {
    filmAt: film.toISOString(),
    shortAts,
    facebookAt: fb.toISOString(),
    reelAt: reel.toISOString(),
  };
}

/**
 * Compose the full publish plan.
 *
 * Every field publish-all.mjs validates is produced here, so a generated plan
 * cannot fail its preflight for a missing key.
 */
export function buildPublishPlan({
  slug, title, description = "", tags = [], licensesText,
  generatedScenes = [], shorts = [], startFrom = Date.now(),
  facebookCaption = null, sources = [],
} = {}) {
  if (!slug) throw new Error("buildPublishPlan: slug is required");
  if (!title) throw new Error("buildPublishPlan: title is required");
  if (!shorts.length) throw new Error("buildPublishPlan: a film ships with Shorts — none supplied");

  const disc = deriveDisclosure(licensesText, generatedScenes);
  const sched = buildSchedule(startFrom, shorts.length);

  // The disclosure sentence is APPENDED to the description rather than left to
  // the author, so the description can never contradict the provenance — the
  // exact drift that produced the bundibugyo error.
  // The sources are PUBLIC, in the description — DrJ's review of the first
  // film: attribution lived only in small on-card src lines, and a viewer
  // asking "says who?" had nowhere to look. The corpus that grounded the
  // script is the honest answer, stated as outlet — headline.
  const sourceBlock = sources.length
    ? "Sources:\n" + sources.slice(0, 12).map((x) => `• ${x}`).join("\n")
    : "";
  const fullDescription = [description.trim(), sourceBlock, disc.descriptionLine]
    .filter(Boolean).join("\n\n");

  return {
    film: `out/${slug}-scored.mp4`,
    thumb: "out/THUMB.png",
    srt: `out/${slug}.srt`,
    syntheticContent: disc.syntheticContent,
    youtube: {
      title: String(title).slice(0, 100),
      description: fullDescription.slice(0, 4900),
      tags: tags.slice(0, 30),
      categoryId: CATEGORY_NEWS,
      publishAt: sched.filmAt,
    },
    shorts: shorts.map((s, i) => ({
      file: s.file,
      title: String(s.title || "").slice(0, 100),
      desc: s.desc || s.hook || "",
      publishAt: sched.shortAts[i],
    })),
    facebook: {
      caption: facebookCaption || description.trim() || title,
      publishAt: sched.facebookAt,
      reel: {
        file: shorts[0].file,
        caption: shorts[0].hook || shorts[0].title || title,
        publishAt: sched.reelAt,
      },
    },
  };
}

/**
 * The TikTok sidecar, carrying the SAME derived flag.
 * Separate file, one source of truth.
 */
export function buildTikTokPlan({ filmId = null, licensesText, generatedScenes = [], shorts = [] } = {}) {
  const disc = deriveDisclosure(licensesText, generatedScenes);
  return {
    filmId,
    // An un-audited client cannot post otherwise; recorded so nobody reads a
    // private post as a public one.
    privacy: "SELF_ONLY",
    posts: shorts.map((s) => ({ file: s.file, title: s.desc || s.title || "" })),
    isAigc: disc.isAigc,
  };
}
