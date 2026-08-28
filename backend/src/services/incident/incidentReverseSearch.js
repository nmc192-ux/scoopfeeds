/**
 * incidentReverseSearch.js — where else does this image live?
 *
 * A Google Cloud Vision WEB_DETECTION client, and nothing more. It returns
 * PAGES. It does not return a verdict, and `checkPriorAppearance` is written so
 * that no answer from here can produce one.
 *
 * THE LIMITATION IS THE WHOLE REASON THIS FILE IS SHAPED LIKE THIS. Grounding
 * (docs/audits/incident_media_engine_grounding_2026-08.md §6 Q1) established
 * that WEB_DETECTION returns `pagesWithMatchingImages`, `fullMatchingImages`,
 * `partialMatchingImages`, `webEntities` and `bestGuessLabels` — and **no date
 * on any of them**. The rule Phase 2 must enforce is "an appearance predating
 * the claimed incident is a kill", which needs a date. Fetching each returned
 * page to infer one would be the arbitrary website retrieval the brief rules
 * out, and page dates lie anyway.
 *
 * So this gathers what a person needs in order to rule, and a person rules. If a
 * date-aware route is funded later (TinEye returns crawl dates), it becomes a
 * second function beside this one and `checkPriorAppearance` grows a PASS
 * branch — deliberately, in that diff, not by accident in this one.
 *
 * NO NEW DEPENDENCY: native fetch, one POST, base64 in the body.
 *
 * COST, so it is never a surprise: $3.50 per 1,000 images, first 1,000 per month
 * free (confirmed against cloud.google.com/vision/pricing during grounding). At
 * this engine's volumes — tens of candidates a day — that is single-digit
 * dollars a month. It is still a paid external call, so it is opt-in by key
 * presence and it is called once per candidate, never in a loop.
 */

import { readFileSync, existsSync } from "fs";
import { logger } from "../logger.js";

/** https://cloud.google.com/vision/docs/detecting-web — checked 2026-08-28. */
const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

/** How many pages we ask for. The queue shows a bounded list anyway. */
const MAX_RESULTS = 25;

const REQUEST_TIMEOUT_MS = 15_000;

export class ReverseSearchError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "ReverseSearchError";
    this.code = code;
  }
}

/** Configured only when a key exists. No key means unmeasured, not clean. */
export const reverseSearchConfigured = () => Boolean(String(process.env.GOOGLE_VISION_API_KEY || "").trim());

/**
 * Build the reverse-search function `checkPriorAppearance` expects, or null.
 *
 * RETURNS NULL WHEN UNCONFIGURED, deliberately, rather than a stub that resolves
 * to `[]`. An empty-array stub would be indistinguishable from a real search
 * that found nothing, and the check reports those differently for good reason —
 * one is "we did not look", the other is "we looked and the index is silent".
 * Handing back null keeps that distinction alive at the only place it can be
 * made honestly.
 */
export function makeReverseSearch() {
  if (!reverseSearchConfigured()) {
    logger.info("🎥 incident: GOOGLE_VISION_API_KEY unset — prior-appearance evidence will be reported as unmeasured");
    return null;
  }
  return async ({ imageRef }) => searchWebDetection(imageRef);
}

/**
 * One WEB_DETECTION call.
 *
 * `imageRef` is a local file path (we hold the file) or an https URL (Google
 * fetches it). A local path is preferred: it works for media that is not
 * publicly reachable, and it means the candidate's own file is what was
 * searched rather than whatever a URL serves today.
 */
export async function searchWebDetection(imageRef, { apiKey = null, fetchImpl = fetch } = {}) {
  const key = apiKey || String(process.env.GOOGLE_VISION_API_KEY || "").trim();
  if (!key) throw new ReverseSearchError("no GOOGLE_VISION_API_KEY", { code: "unconfigured" });
  if (!imageRef) throw new ReverseSearchError("nothing to search for", { code: "no-image" });

  let image;
  if (/^https?:\/\//i.test(imageRef)) {
    image = { source: { imageUri: imageRef } };
  } else {
    if (!existsSync(imageRef)) throw new ReverseSearchError(`no such file: ${imageRef}`, { code: "no-file" });
    image = { content: readFileSync(imageRef).toString("base64") };
  }

  const body = {
    requests: [{ image, features: [{ type: "WEB_DETECTION", maxResults: MAX_RESULTS }] }],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(`${VISION_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new ReverseSearchError(
      err?.name === "AbortError" ? `timed out after ${REQUEST_TIMEOUT_MS}ms` : String(err?.message).slice(0, 200),
      { code: "request-failed" }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // A 4xx/5xx is a FAILED SEARCH, and the check reports it as such. It must
    // never fall through to "no pages found".
    throw new ReverseSearchError(`vision API returned ${res.status}`, { code: `http-${res.status}` });
  }

  const json = await res.json();
  const err = json?.responses?.[0]?.error;
  if (err) throw new ReverseSearchError(`vision API error: ${String(err.message).slice(0, 200)}`, { code: "api-error" });

  return normaliseWebDetection(json?.responses?.[0]?.webDetection);
}

/**
 * Flatten a webDetection block into pages the queue can render.
 *
 * `matchType` matters to a human: a FULL match is the same image, a PARTIAL
 * match is a crop or an edit of it. Neither carries a date — the `note` on the
 * check says so, and nothing here invents one.
 */
export function normaliseWebDetection(web) {
  if (!web || typeof web !== "object") return [];
  const pages = [];
  const seen = new Set();

  const add = (url, matchType, extra = {}) => {
    const u = String(url || "").trim();
    if (!u || seen.has(u)) return;
    seen.add(u);
    pages.push({ url: u, matchType, ...extra });
  };

  for (const p of web.pagesWithMatchingImages || []) {
    add(p?.url, "page", {
      pageTitle: p?.pageTitle ? String(p.pageTitle).slice(0, 200) : null,
      fullMatches: (p?.fullMatchingImages || []).length,
      partialMatches: (p?.partialMatchingImages || []).length,
    });
  }
  for (const i of web.fullMatchingImages || []) add(i?.url, "full");
  for (const i of web.partialMatchingImages || []) add(i?.url, "partial");

  return pages;
}

/**
 * Labels and entities, offered to the operator as context only.
 *
 * Kept separate from `pages` so it can never be mistaken for match evidence: a
 * `bestGuessLabel` of "flood" tells you what the model thinks the picture shows,
 * which is not a claim about where else it has been.
 */
export function webContext(web) {
  if (!web || typeof web !== "object") return { labels: [], entities: [] };
  return {
    labels: (web.bestGuessLabels || []).map((l) => String(l?.label || "")).filter(Boolean).slice(0, 5),
    entities: (web.webEntities || [])
      .filter((e) => e?.description)
      .map((e) => ({ description: String(e.description).slice(0, 120), score: e.score ?? null }))
      .slice(0, 10),
  };
}
