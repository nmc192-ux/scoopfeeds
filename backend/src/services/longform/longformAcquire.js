/**
 * longformAcquire.js — downloading footage, unattended (#78).
 *
 * The gap `produceLongformFilm` named: `footage-search.mjs` FINDS candidates
 * and classifies their provenance, `longformMediaGate` SCREENS what it is
 * offered, and nothing in between actually fetched a file.
 *
 * ONLY `verified` PROVENANCE IS DOWNLOADED UNATTENDED, AND THAT IS THE WHOLE
 * DESIGN. footage-search.mjs already ranks sources by provenance rather than
 * relevance, and its own header sets the rule this file enforces:
 *
 *   verified   — the publisher is the rights holder BY CONSTRUCTION. US
 *                federal works (DVIDS, NASA, USGS) are public domain because
 *                they are US government works, full stop. Safe to fetch with
 *                nobody watching.
 *   declared   — an explicit licence attached by an uploader whose ownership
 *                is plausible (Wikimedia Commons, Internet Archive). The
 *                header says it "still needs a human to look at it", so an
 *                unattended run REFUSES it. Plausible is not verified.
 *   unverified — YouTube CC. Lead generation only, never downloaded. A licence
 *                someone cannot grant is not a licence; Content ID matches the
 *                underlying footage regardless of the box they ticked.
 *
 * The consequence is deliberate and worth stating plainly: an unattended film
 * can only be built from public-domain government footage. That is a narrow
 * palette. It is also the only palette where nobody has to check anything
 * before a video goes out with no human in the loop — and a channel strike is
 * not recoverable by editing a description afterwards.
 *
 * NOT ALL DVIDS ASSETS ARE US GOVERNMENT WORKS. Allied and contractor material
 * appears there too; footage-search flags those `declared`, and this file
 * therefore refuses them along with everything else non-verified.
 *
 * Every side effect is injected: search, download and probe. The rules are
 * testable without a network.
 */

import { logger } from "../logger.js";

/** Provenance tiers, in the order footage-search assigns them. */
export const VERIFIED = "verified";
export const DECLARED = "declared";
export const UNVERIFIED = "unverified";

/** Sources whose licence is public domain by construction. */
const PD_SOURCES = new Set(["DVIDS", "NASA", "USGS"]);

/**
 * May this candidate be fetched with nobody watching?
 * @returns {null|string} null to proceed, or the reason to refuse
 */
export function unattendedRefusal(c = {}) {
  if (c.error) return `search error: ${c.error}`;
  if (!c.url && !c.download) return "no downloadable url";
  if (c.provenance === UNVERIFIED) {
    return "provenance 'unverified' (YouTube CC) — a licence the uploader may not hold; never downloaded";
  }
  if (c.provenance === DECLARED) {
    return "provenance 'declared' — plausible ownership still needs a human to look at it, so it cannot enter an unattended film";
  }
  if (c.provenance !== VERIFIED) {
    return `unknown provenance ${JSON.stringify(c.provenance)} — only 'verified' is fetched unattended`;
  }
  if (!PD_SOURCES.has(c.source)) {
    // Verified is asserted by the searcher; the source list is the second
    // check, so a future searcher change cannot quietly widen what is fetched.
    return `source "${c.source}" is marked verified but is not a known public-domain publisher`;
  }
  return null;
}

/** A stable key for the storyboard and LICENSES.md. */
export function keyFor(candidate, index) {
  const base = String(candidate.title || candidate.source || "clip")
    .toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
  return `F_${base || "CLIP"}_${index + 1}`;
}

/**
 * Acquire footage for one film.
 *
 * @param {object} o
 * @param {(queries:string[]) => Promise<object[]>} o.search
 * @param {(url:string, dest:string) => Promise<string>} o.download
 * @param {(file:string) => Promise<{measured:boolean,value?:{width,height},why?:string}>} o.probe
 * @param {string[]} o.queries
 * @param {string} o.destDir
 * @param {number} [o.want]  how many clips the film needs
 * @returns {Promise<{candidates:object[], refused:object[]}>}
 *   `candidates` are in the shape longformMediaGate.screenCandidate expects.
 */
export async function acquireFootage({
  search, download, probe, resolveDownload = null, queries = [], destDir, want = 6,
} = {}) {
  if (!search || !download || !probe) throw new Error("acquireFootage: search, download and probe are required");
  if (!queries.length) throw new Error("acquireFootage: no search queries — a film needs something to look for");
  if (!destDir) throw new Error("acquireFootage: destDir is required");

  const found = await search(queries);
  const refused = [];
  const candidates = [];

  for (const [i, c] of (found || []).entries()) {
    if (candidates.length >= want) break;

    const why = unattendedRefusal(c);
    if (why) { refused.push({ source: c.source, title: c.title, why }); continue; }

    const key = keyFor(c, candidates.length);
    // A search hit's url is often a WEB PAGE (DVIDS is). The source-specific
    // resolver turns it into a direct media url; a hit that cannot be
    // resolved is refused rather than downloaded-and-probed as HTML.
    let url = c.download || null;
    if (!url && resolveDownload) {
      try {
        const r = await resolveDownload(c);
        if (r?.src) url = r.src;
      } catch (e) {
        refused.push({ source: c.source, title: c.title, why: `download resolution failed: ${e.message}` });
        continue;
      }
    }
    if (!url) {
      if (resolveDownload) {
        refused.push({ source: c.source, title: c.title, why: "no direct media file could be resolved (page url only)" });
        continue;
      }
      url = c.url;
    }
    let file;
    try {
      file = await download(url, `${destDir}/${key}.mp4`);
    } catch (e) {
      refused.push({ source: c.source, title: c.title, why: `download failed: ${e.message}` });
      continue;
    }

    // PROBE THE FILE, DO NOT TRUST THE LISTING. A search result's advertised
    // resolution describes what the publisher claims; the media gate refuses
    // an unmeasured resolution precisely because the unmeasured clip is the
    // one that turns out to be an upscale.
    const dim = await probe(file);
    if (!dim.measured) {
      refused.push({ source: c.source, title: c.title, why: `resolution unmeasurable: ${dim.why}` });
      continue;
    }

    candidates.push({
      key,
      file,
      licence: "public-domain",
      url: c.url || url,
      width: dim.value.width,
      height: dim.value.height,
      attribution: c.attribution || `${c.source} — US Government work, public domain`,
      synthetic: false,
      containsPeople: undefined,   // unknown; the gate only bars SYNTHETIC people
    });
  }

  logger.info(
    `🎬 acquisition: ${candidates.length} clip(s) fetched, ${refused.length} refused ` +
    `(${refused.filter((r) => /provenance/.test(r.why)).length} on provenance)`);
  return { candidates, refused };
}

/**
 * The `acquireMedia` stage `produceLongformFilm` expects.
 *
 * Refuses rather than returning a short set: a film built from two clips
 * visibly cycles, and the storyboard was written against the keys this
 * returns. Better to abandon the topic than to ship a film that loops.
 */
export function makeAcquireMedia({ search, download, probe, resolveDownload = null, destDir, want = 6, min = 3 }) {
  return async ({ topic, script }) => {
    const queries = buildQueries(topic, script);
    const { candidates, refused } = await acquireFootage({
      search, download, probe, resolveDownload, queries, destDir, want });
    if (candidates.length < min) {
      throw new Error(
        `acquisition yielded ${candidates.length} usable clip(s), need ${min}. ` +
        `A film built from fewer visibly cycles.\n` +
        refused.slice(0, 8).map((r) => `  refused: ${r.source || "?"} — ${r.why}`).join("\n"));
    }
    return candidates;
  };
}

/**
 * Search phrases for a film's footage.
 *
 * Drawn from the TOPIC, not from the script's prose: the script is narration
 * and its sentences make poor search terms, while the topic carries the
 * entities the story is actually about.
 */
export function buildQueries(topic = {}, script = null) {
  // SHORT NOUN PHRASES, NOT SENTENCES — the same lesson the demand gate paid
  // for: a headline is written to be read, a search query is typed. The first
  // real run sent the full title and the entire through-line SENTENCE to
  // DVIDS and got nothing usable back.
  const out = [];
  for (const k of (topic.keys || []).slice(0, 3)) {
    if (typeof k === "string" && k.trim()) out.push(k.trim());
  }
  const words = String(topic.title || "").toLowerCase()
    .replace(/[^\w\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !QUERY_STOPWORDS.has(w));
  for (let i = 0; i + 2 <= words.length && out.length < 5; i++) {
    out.push(words.slice(i, i + 2).join(" "));
  }
  // The through-line contributes its NOUNS, not its sentence.
  const through = String(script?.spine?.throughLine || "").toLowerCase()
    .replace(/[^\w\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 3 && !QUERY_STOPWORDS.has(w)).slice(0, 3);
  if (through.length >= 2) out.push(through.slice(0, 2).join(" "));
  return [...new Set(out.filter(Boolean))].slice(0, 5);
}

const QUERY_STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "how", "why", "what", "when",
  "and", "or", "but", "to", "of", "in", "on", "at", "for", "with", "by",
  "from", "as", "that", "this", "its", "it", "after", "before", "into",
  "making", "makes", "harder", "easier", "single", "global", "every", "report",
  "debate", "debates", "putting", "online",
]);
