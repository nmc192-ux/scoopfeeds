/**
 * incidentChecks.js — the four verification checks, each returning a verdict.
 *
 * ONE VOCABULARY, FOUR CHECKS. Every check returns the same shape:
 *
 *   { verdict, reason, evidence }   verdict ∈ VERDICTS
 *
 * and the orchestrator (incidentVerification.js) combines them. Three verdicts
 * exist and the third is the important one:
 *
 *   PASS         this check is satisfied. Only ever returned when something was
 *                actually measured and the measurement came back clean.
 *   KILL         this check failed. Terminal.
 *   NEEDS_HUMAN  this check could not be settled by machine. NOT a pass, not a
 *                failure — a routing instruction.
 *
 * THERE IS NO "UNKNOWN COUNTS AS FINE". An unmeasured check returns
 * NEEDS_HUMAN, and the orchestrator refuses to verify on anything but PASS. This
 * is the whole design: the repo has twice shipped a guard that passed for the
 * wrong reason, and a verification gate that returns true when it has learned
 * nothing is worse than no gate, because it looks like protection.
 */

import { isSensitiveHeadline } from "../editorialSensitivity.js";
import { isPakistanBlocked } from "../videoPakistanBlock.js";
import { groupByFile } from "./incidentHash.js";
import { logger } from "../logger.js";

export const VERDICTS = Object.freeze({ PASS: "pass", KILL: "kill", NEEDS_HUMAN: "needs_human" });

const pass = (reason, evidence = null) => ({ verdict: VERDICTS.PASS, reason, evidence });
const kill = (reason, evidence = null) => ({ verdict: VERDICTS.KILL, reason, evidence });
const human = (reason, evidence = null) => ({ verdict: VERDICTS.NEEDS_HUMAN, reason, evidence });

// ─── Check 4 (run first, because it is free and it short-circuits) ──────────

/**
 * Sensitivity routing.
 *
 * A story the sensitivity gate flags gets NO third-party incident media at all —
 * typography only, exactly as `cardRenderer` already suppresses the photo
 * background and `videoStockLibrary.cutawaysAllowedFor` already suppresses every
 * cutaway. Wired to the SHARED gate rather than a new classifier: two
 * differently-worded tragedy regexes drifting apart is a failure this repo has
 * had once already.
 *
 * WHOLE-STORY, NOT PER-CANDIDATE, for the same reason the cutaway rule is
 * whole-video: `isSensitiveHeadline` judges a HEADLINE, there is no per-asset
 * signal, and manufacturing one would be a classifier rather than a guard.
 */
export function checkSensitivity({ storyTitle } = {}) {
  if (isSensitiveHeadline(storyTitle)) {
    return kill("sensitive_story", {
      storyTitle: storyTitle ?? null,
      // An empty headline is sensitive by default (editorialSensitivity.js:29).
      note: "the sensitivity gate flags this story; it renders typographically, with no third-party media",
    });
  }
  return pass("story is not flagged by the sensitivity gate");
}

// ─── Check 1 — prior appearance ────────────────────────────────────────────

/**
 * Has this image appeared before the incident it claims to show?
 *
 * THIS CHECK CANNOT PASS BY MACHINE, AND THAT IS THE HONEST ANSWER, not a stub.
 * Grounding (docs/audits/incident_media_engine_grounding_2026-08.md §6, Q1)
 * established: the affordable reverse-search route, Google Vision WEB_DETECTION,
 * returns the PAGES an image appears on and no date for any of them. The rule
 * this check must enforce — "an appearance predating the claimed incident is a
 * kill" — needs a date. Inferring one by fetching each page and reading its
 * markup is both the arbitrary website retrieval the brief rules out and
 * unreliable, because page dates lie.
 *
 * So the machine's job here is EVIDENCE GATHERING and the verdict is always
 * NEEDS_HUMAN. There is deliberately no branch that returns PASS: search the
 * function for VERDICTS.PASS and you will not find it. A test asserts that
 * across every input, including the happy one where the search returns nothing.
 *
 * "No matching pages found" is the most seductive false pass available here —
 * an index that has never crawled the image looks exactly like an image that
 * has never appeared before. That is why zero results routes to a human too.
 *
 * If a date-aware route is funded later (TinEye returns crawl dates), this
 * function gains a PASS branch and this comment gets deleted in the same diff.
 */
export async function checkPriorAppearance({ imageRef = null, claimedAt = null, reverseSearch = null } = {}) {
  if (typeof reverseSearch !== "function") {
    return human("prior_appearance_unmeasured", {
      note: "no reverse-search route is configured, so nothing was measured. This is reported as unmeasured " +
            "rather than clean — an unrun check is not a passed check.",
      imageRef, claimedAt,
    });
  }

  let pages = null;
  try {
    pages = await reverseSearch({ imageRef });
  } catch (err) {
    return human("prior_appearance_search_failed", {
      note: `the reverse search failed (${String(err?.message).slice(0, 200)}). A failed search is not an absence of results.`,
      imageRef,
    });
  }

  const list = Array.isArray(pages) ? pages : [];
  return human(list.length ? "prior_appearance_pages_found" : "prior_appearance_no_pages", {
    // The pages are the point: they are what the operator looks at beside the
    // claimed date. The machine has an opinion about none of them.
    pages: list.slice(0, 25),
    pageCount: list.length,
    claimedAt,
    note: list.length
      ? "these pages carry the same image. Dates are NOT available from this route — compare them against the " +
        "claimed date yourself. An appearance predating the incident is a kill."
      : "the index returned no pages. That is not evidence of absence: an image the index has never crawled " +
        "looks identical to an image that has never appeared before.",
  });
}

// ─── Check 2 — corroboration ───────────────────────────────────────────────

/**
 * Is this incident attested by more than one independent source?
 *
 * INDEPENDENCE, CONCRETELY. Two posts are independent when all three hold:
 *   1. different posters (same handle twice is one person)
 *   2. different underlying FILES (perceptual hash — a repost is one file)
 *   3. neither is declared a repost/quote of the other
 * Same-platform is NOT a disqualifier: two people at the same scene both posting
 * to X are two witnesses. Same FILE on two platforms is one witness.
 *
 * THE ALTERNATIVE ROUTE, per the brief: the poster is the established original
 * with direct evidence of presence. That evidence is a human judgement — it is
 * things like a reply thread, a prior post from the location, a verified
 * account's own footage — so it arrives as `originalityEvidence` from the queue
 * and is never inferred here. Absent it, one post is one post.
 */
export const MIN_INDEPENDENT_SOURCES = 2;

export function checkCorroboration({ posts = [], originalityEvidence = null } = {}) {
  const usable = posts.filter((p) => p && p.id);

  if (!usable.length) {
    return human("corroboration_no_posts", {
      note: "no posts were supplied to compare, so independence was not measured.",
    });
  }

  // Anything declaring itself derived is not a second witness.
  const primary = usable.filter((p) => !p.isRepostOf && !p.isQuoteOf);

  // Collapse same-file reposts. A post with no hashes cannot be shown to be a
  // duplicate, so it stays its own group — which counts MORE sources, so it is
  // the unsafe direction and is flagged below rather than trusted.
  const fileGroups = groupByFile(primary.map((p) => ({ id: p.id, hashes: p.hashes || [] })));
  const unhashed = primary.filter((p) => !(p.hashes || []).length);

  // Then collapse by poster: one person posting twice is one source.
  const byHandle = new Set();
  let anonymous = 0;
  for (const group of fileGroups) {
    const post = primary.find((p) => p.id === group[0]);
    const handle = String(post?.posterHandle || "").toLowerCase().trim();
    if (handle) byHandle.add(handle); else anonymous++;
  }
  const independentSources = byHandle.size + anonymous;

  const evidence = {
    postsSupplied: usable.length,
    afterRepostFilter: primary.length,
    distinctFiles: fileGroups.length,
    independentSources,
    fileGroups,
    unhashedPostIds: unhashed.map((p) => p.id),
  };

  if (independentSources >= MIN_INDEPENDENT_SOURCES) {
    // An unhashed post may be a duplicate we could not detect. If it is load
    // bearing — that is, dropping it would take us below the floor — the count
    // is not trustworthy and a human settles it.
    if (unhashed.length && independentSources - unhashed.length < MIN_INDEPENDENT_SOURCES) {
      return human("corroboration_rests_on_unhashed_post", {
        ...evidence,
        note: "the source count only clears the floor because of posts whose media was never hashed, so a " +
              "same-file repost could be being counted as an independent witness.",
      });
    }
    return pass(`${independentSources} independent sources`, evidence);
  }

  if (originalityEvidence) {
    // The brief's OR branch. It is a human's assertion, recorded verbatim.
    return pass("established original with direct evidence of presence", {
      ...evidence, originalityEvidence,
    });
  }

  return kill("uncorroborated", {
    ...evidence,
    note: `${independentSources} independent source(s), floor is ${MIN_INDEPENDENT_SOURCES}. ` +
          "Supply a second independent post, or evidence that this poster is the established original.",
  });
}

// ─── Check 3 — location and context sanity ─────────────────────────────────

/**
 * Do the visible cues agree with what is claimed?
 *
 * The vision model is INJECTED and returns one of three things — agrees,
 * contradicts, or cannot tell. The asymmetry the brief specifies lives here:
 *
 *   contradicts                          → KILL, always.
 *   cannot tell + Pakistan/politically live → KILL.
 *   cannot tell + anywhere else          → NEEDS_HUMAN.
 *
 * PAKISTAN IS DETECTED WITH RULE 0's OWN MATCHER, not a second word list. Rule 0
 * is the strictly stronger rule and it is checked at selection, post-generation
 * and publish; reusing `isPakistanBlocked` here means this kill can never be
 * looser than the block that follows it, and there is no second list to drift.
 *
 * A vision model that errors or is absent is `cannot tell`. It is not "fine".
 */
export async function checkContext({
  candidate = {}, story = {}, claimedLocation = null, claimedAt = null,
  vision = null, politicallyLive = false,
} = {}) {
  // Rule 0's matcher over the story AND the candidate's own claimed location,
  // because a claim can name a place the story does not.
  const pakistanish =
    isPakistanBlocked(story).blocked ||
    isPakistanBlocked({ title: claimedLocation, category: "", source_name: "" }).blocked;
  const strict = pakistanish || politicallyLive;

  const cannotConfirm = (reason, evidence) => strict
    ? kill("cannot_confirm", {
        ...evidence,
        strictBecause: pakistanish ? "pakistan_related" : "politically_live",
        note: "on a Pakistan-related or politically live story, \"cannot confirm\" is a kill, not a question.",
      })
    : human(reason, evidence);

  if (typeof vision !== "function") {
    return cannotConfirm("context_unmeasured", {
      note: "no vision pass is configured, so the visible cues were never compared with the claim.",
      claimedLocation, claimedAt,
    });
  }

  let result;
  try {
    result = await vision({ candidate, story, claimedLocation, claimedAt });
  } catch (err) {
    return cannotConfirm("context_vision_failed", {
      note: `the vision pass failed (${String(err?.message).slice(0, 200)}). A failed check is not a passed check.`,
      claimedLocation,
    });
  }

  const agreement = result?.agreement;
  const evidence = {
    agreement: agreement ?? null,
    cues: result?.cues ?? null,
    reasoning: typeof result?.reasoning === "string" ? result.reasoning.slice(0, 800) : null,
    claimedLocation, claimedAt,
  };

  if (agreement === "contradicts") {
    return kill("context_mismatch", {
      ...evidence,
      note: "the visible cues contradict the claimed place or date. This is terminal regardless of the story.",
    });
  }
  if (agreement === "agrees") return pass("visible cues agree with the claim", evidence);

  // Anything else — "cannot_tell", a shape we do not recognise, a null — is
  // unresolved. Unrecognised is deliberately lumped in with cannot_tell rather
  // than thrown away: a model returning something unexpected has not confirmed
  // anything, and treating an unparseable answer as agreement is precisely the
  // vacuous pass this file exists to avoid.
  return cannotConfirm("context_cannot_confirm", evidence);
}

/**
 * The check registry, in run order. Cheap and short-circuiting first.
 *
 * Exported as data so the orchestrator cannot silently run a subset — see
 * incidentVerification.js, which asserts it ran every one of these.
 */
export const CHECK_NAMES = Object.freeze([
  "sensitivity", "prior_appearance", "corroboration", "context",
]);

export { logger as _logger };
