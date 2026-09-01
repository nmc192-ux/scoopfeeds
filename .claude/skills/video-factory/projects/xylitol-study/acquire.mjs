/**
 * acquire.mjs — fetch this film's footage, UNATTENDED.
 *
 *   node acquire.mjs             # fill every key that has no real clip yet
 *   node acquire.mjs --refetch   # re-run keys already acquired
 *   node acquire.mjs --dry       # search and screen, download nothing
 *
 * NOTHING HERE IS NEW. The engine already acquires footage with nobody
 * watching — that is how the autopost loop builds a film — and this only wires
 * that machinery to a HAND-AUTHORED film's named keys. It reuses, verbatim:
 *
 *   searchFootage        engine/footage-search.mjs   finds and classifies
 *   unattendedRefusal    longformAcquire.js          may a robot fetch this?
 *   screenCandidate      longformMediaGate.js        rights and resolution
 *   makeRelevanceScreen  longformFootageRelevance.js is it about the story?
 *   resolveDownloadFor   engine/footage-search.mjs   candidate → real URL
 *
 * Re-deriving any of those here would be a second implementation of a rule
 * that already exists, and the rules are the whole point.
 *
 * WHAT UNATTENDED ACTUALLY PERMITS. longformAcquire refuses anything that is
 * not `verified` (US federal works — public domain by construction) or an
 * approved `platform` source. Pexels is the one approved platform library,
 * added as its own tier by DrJ on 2026-08-27 because its licence is granted BY
 * THE PLATFORM rather than claimed by an uploader. Wikimedia and the Internet
 * Archive are `declared` and are refused: plausible ownership still needs a
 * human. YouTube CC is never downloaded at all.
 *
 * For this film that is fine, and it is worth saying why rather than assuming
 * it: a consumer-health story wants gum packets, supermarket aisles, kitchen
 * scales and dogs. Pexels has all of it. DVIDS, NASA and USGS — the entire
 * `verified` palette — have essentially none of it, which is exactly how the
 * first published film ended up with six clips of unrelated Army b-roll that
 * passed every rights check. So Pexels is not a shortcut here; it is the only
 * tier whose catalogue matches the subject.
 *
 * ONE CLIP PER NAMED KEY, which is why this does not call acquireFootage():
 * that function fills a film with N good clips from a pool of queries, and a
 * hand-authored storyboard instead needs a specific shot for F_DOG_KITCHEN_
 * COUNTER. Same screens, different unit of work.
 *
 * RUN THIS BEFORE slates.mjs. Slates never overwrite an existing file, so the
 * order fills every key it can with real footage and leaves placeholders only
 * where acquisition genuinely failed.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, "../../../../../backend");
const ENGINE = path.join(BACKEND, "src/services/longform/engine");

const { searchFootage, resolveDownloadFor } = await import(`${ENGINE}/footage-search.mjs`);
const { unattendedRefusal, MAX_CLIP_BYTES, keyFor, gateLicenceFor } =
  await import(`${BACKEND}/src/services/longform/longformAcquire.js`);
const { screenCandidate } = await import(`${BACKEND}/src/services/longform/longformMediaGate.js`);

const REFETCH = process.argv.includes("--refetch");
const DRY = process.argv.includes("--dry");
const OUT = path.join(HERE, "out/footage");
const LEDGER = path.join(OUT, "_acquired.json");
mkdirSync(OUT, { recursive: true });

/**
 * Key → the search this shot actually wants, from Section 4 of the brief.
 *
 * These are the brief's OWN terms, not paraphrases. Its Tier-2 rule is that
 * stock illustrates the SUBJECT, never the EVENT — no footage a viewer could
 * mistake for the study, the patients or a cardiac event — and the terms were
 * written to that rule. Rewriting them "better" here would quietly relitigate
 * an editorial decision inside a download script.
 */
const QUERIES = {
  F_GUM_PACKET_HAND:        "hand picking up chewing gum packet",
  F_SUPERMARKET_AISLE:      "supermarket sugar free aisle walking",
  F_LAB_TUBES_RACK:         "laboratory blood sample tubes rack",
  F_CENTRIFUGE_SPINNING:    "centrifuge spinning laboratory",
  F_SCIENTIST_PIPETTE:      "scientist pipette microplate",
  F_HOSPITAL_CORRIDOR:      "hospital corridor walking",
  F_CROWD_STREET_SLOMO:     "crowd walking street slow motion",
  F_KETO_SHELF:             "keto low carb products shelf",
  F_POURING_SWEETENER:      "pouring white granulated sugar close up",
  F_DROPLET_COLLISION_MACRO:"water droplet collision macro slow motion",
  F_NARROW_PIPE_INTERIOR:   "narrow industrial pipe interior",
  F_STOPWATCH_MACRO:        "stopwatch running seconds macro",
  F_EMPTY_BREAKFAST_TABLE:  "empty breakfast table morning light",
  F_BLOOD_DRAW_VIAL:        "blood sample vial filling laboratory",
  F_IV_DRIP_BAG:            "iv drip bag hospital",
  F_DENTIST_CHAIR:          "dentist chair examination",
  F_TOOTHBRUSH_MACRO:       "toothbrush toothpaste macro",
  F_KITCHEN_SCALE_POWDER:   "kitchen scale weighing white powder",
  F_BAKING_MIXING_BOWL:     "baking mixing bowl flour pouring",
  F_ICE_CREAM_TUB:          "ice cream tub scooping close up",
  F_NUTRITION_LABEL_MACRO:  "reading nutrition label supermarket",
  F_DOG_KITCHEN_COUNTER:    "happy dog kitchen counter",
  F_VET_EXAMINING_DOG:      "veterinarian examining dog clinic",
  F_BIRCH_FOREST:           "birch forest trees sunlight",
  F_HEADLINES_SCROLL:       "scrolling news website screen",
  F_SMOKE_ALARM_CEILING:    "smoke detector ceiling",
  F_HANDBAG_ON_CHAIR:       "handbag on chair indoors",
  F_ESC_CONGRESS_FLOOR:     "conference hall audience presentation",
};

const sb = JSON.parse(readFileSync(path.join(HERE, "storyboard.json"), "utf8"));
const keys = [...new Set(Object.values(sb.beats).filter((b) => b.footage).map((b) => b.footage))].sort();

const missingQuery = keys.filter((k) => !QUERIES[k]);
if (missingQuery.length) {
  console.error(`no search term for: ${missingQuery.join(", ")}\nAdd one to QUERIES — a key with no query would silently stay a placeholder.`);
  process.exit(1);
}

const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : {};

/** Stream a URL to disk, refusing anything over the unattended size cap. */
async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number.parseInt(res.headers.get("content-length") || "", 10);
  if (Number.isFinite(len) && len > MAX_CLIP_BYTES()) {
    throw new Error(`${(len / 1024 ** 2).toFixed(0)} MB exceeds the unattended cap`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return statSync(dest).size;
}

const results = [];
for (const key of keys) {
  const dest = path.join(OUT, `${key}.mp4`);
  if (!REFETCH && ledger[key]?.ok) { results.push({ key, status: "cached" }); continue; }

  const q = QUERIES[key];
  let found = [];
  try { found = await searchFootage([q]); } catch (e) { found = [{ error: e.message }]; }

  // Provenance, then rights and resolution. Both are the engine's own rules.
  const eligible = [];
  const refused = [];
  for (const [i, c] of found.entries()) {
    const why = unattendedRefusal(c);
    if (why) { refused.push(`${c.source || "?"}: ${why}`); continue; }
    // screenCandidate REQUIRES a key and returns an ARRAY of problems — empty
    // means clean. Testing it as `{ ok: false }` (it has no such field) left
    // the media gate silently disabled here, which is how AI-generated Pexels
    // stock, sub-1080p upscales and unlicensed clips would all have walked
    // straight through an unattended download.
    // NORMALISE BEFORE SCREENING. footage-search records a human-readable
    // licence; the gate matches machine tokens. Screening the raw candidate
    // refused every source for the wrong reason and made a whole provenance
    // tier look broken — the engine was normalising all along, at the point it
    // builds the acquired record. gateLicenceFor is that same rule.
    // Same two normalisations acquireFootage does when it builds an acquired
    // record: the gate's licence TOKEN, and — for platform stock — the DOWNLOAD
    // url, because the gate checks the media host (videos.pexels.com/
    // video-files) and a Pexels PAGE url would read as unclear provenance.
    // DVIDS and NASA carry no dimensions in a search result and are therefore
    // refused here as "unmeasured", which is the gate working: the engine only
    // clears them after probing a downloaded file.
    const cand = {
      ...c,
      key: c.key || keyFor(c, i),
      licence: gateLicenceFor(c),
      url: c.provenance === "platform" ? (c.download || c.url) : (c.url || c.download),
    };
    const problems = screenCandidate(cand);
    if (problems.length) { refused.push(`${c.source}: ${problems[0]}`); continue; }
    eligible.push(cand);
  }

  if (!eligible.length) {
    results.push({ key, status: "none", q, refused: refused.slice(0, 3) });
    process.stdout.write("x");
    continue;
  }

  const pick = eligible[0];
  if (DRY) {
    results.push({ key, status: "dry", q, source: pick.source, title: pick.title });
    process.stdout.write("?");
    continue;
  }

  try {
    const url = (await resolveDownloadFor(pick)) || pick.download || pick.url;
    const bytes = await download(url, dest);
    ledger[key] = { ok: true, source: pick.source, provenance: pick.provenance,
                    licence: pick.licence, title: pick.title, url: pick.url, bytes, query: q };
    results.push({ key, status: "got", source: pick.source, mb: (bytes / 1024 ** 2).toFixed(1) });
    process.stdout.write(".");
  } catch (e) {
    results.push({ key, status: "failed", q, why: e.message });
    process.stdout.write("!");
  }
}
process.stdout.write("\n");

if (!DRY) writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + "\n");

const by = (s) => results.filter((r) => r.status === s);
console.log(`\n${keys.length} footage keys`);
console.log(`  ${by("got").length} downloaded, ${by("cached").length} already had one, `
  + `${by("none").length} found nothing, ${by("failed").length} failed${DRY ? `, ${by("dry").length} dry` : ""}`);

for (const r of results.filter((x) => x.status === "none" || x.status === "failed")) {
  console.log(`  x ${r.key}  "${r.q}"  ${r.why || (r.refused || []).join(" | ") || "no eligible candidate"}`);
}
console.log(`\n  Provenance is recorded per clip in out/footage/_acquired.json.`);
console.log(`  Run slates.mjs next — it fills only the keys still without a clip.\n`);
